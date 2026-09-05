import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool.js';
import { parseCsv, detectDelimiter } from '../src/import/csv.js';
import { inferColumnMap, applyColumnMap, verticalHintFor } from '../src/import/mapping.js';
import { importCsvContent } from '../src/import/importer.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { recordDisposition } from '../src/domain/activities.js';
import { claimAccount } from '../src/domain/ownership.js';
import { searchProspects } from '../src/domain/search.js';
import { resetDatabase, makeUser } from './helpers.js';

/** Authority: market-miner-lead-import-export-spec.md §1, §7, §12, §13, §15. */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

test('CSV parsing survives the shapes real exports actually have', () => {
  const csv = 'Company,Phone,Notes\r\n'
    + '"Acme, Inc.",904-555-0100,"He said ""urgent"", twice"\r\n'
    + '\r\n'                                   // blank line
    + 'Beta LLC,904-555-0101,\r\n'
    + '"Multi\nline name",904-555-0102,ok\r\n';
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['Company', 'Phone', 'Notes']);
  assert.equal(parsed.rows.length, 3, 'the blank line is skipped, not emitted as a row');
  assert.equal(parsed.rows[0]!['Company'], 'Acme, Inc.');
  assert.equal(parsed.rows[0]!['Notes'], 'He said "urgent", twice');
  assert.equal(parsed.rows[2]!['Company'], 'Multi\nline name');
});

test('delimiter detection handles tab and semicolon exports', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
});

test('column mapping binds each field once and keeps unknown headers as raw only', () => {
  const headers = [
    'Company Name', 'Website', 'Business Phone', 'Direct Phone', 'First Name', 'Last Name',
    'Title', 'Email', 'City', 'State', 'Zip', 'Primary Industry', 'Apollo ID', 'Lead Score',
  ];
  const map = inferColumnMap(headers);
  assert.equal(map.company, 'Company Name');
  assert.equal(map.phone, 'Business Phone');
  // "Direct Phone" must not be swallowed by the generic phone matcher.
  assert.equal(map.direct_phone, 'Direct Phone');
  assert.equal(map.provider_id, 'Apollo ID');
  assert.equal(Object.values(map).includes('Lead Score'), false, 'unknown headers are not mapped');

  const mapped = applyColumnMap(
    { 'First Name': 'Dana', 'Last Name': 'Fielder', 'Company Name': 'Northgate' } as never, map,
  );
  assert.equal(mapped.contactName, 'Dana Fielder', 'split name columns combine');
});

test('source industry is a hint, never authority', () => {
  assert.equal(verticalHintFor('Heating, Ventilation & AC'), 'hvac');
  assert.equal(verticalHintFor('Plumbing Contractor'), 'plumbing');
  assert.equal(verticalHintFor('Widget Manufacturing'), null, 'an unmatched label yields null, not a guess');
  assert.equal(verticalHintFor(null), null);
});

const LIST = [
  'Company Name,Website,Business Phone,Direct Phone,First Name,Last Name,Title,Email,City,State,Zip,Primary Industry,Apollo ID',
  '"Northgate Air & Heating, LLC",https://www.northgate.example.com,(904) 555-0101,904-555-9101,Dana,Fielder,Owner,dana@northgate.example.com,Jacksonville,FL,32256-1234,"Heating & AC",APL-001',
  'Northgate Air and Heating,northgate.example.com,9045550101,,,,,info@northgate.example.com,Jacksonville,Florida,32256,HVAC,APL-001',
  '"Riverbend Plumbing Inc.",http://riverbend.example.com/,904.555.0202,,Riley,Marsh,General Manager,riley@riverbend.example.com,Jacksonville,FL,32224,Plumbing,APL-002',
  ',,,,,,,,,,,,',
  'X,,,,,,,,,,,,',
].join('\n');

test('an import resolves duplicates instead of creating parallel accounts', async () => {
  const report = await importCsvContent(LIST, { sourceName: 'test-list', sourceKind: 'apollo_export' });

  assert.equal(report.rows, 5);
  assert.equal(report.rejected, 2, 'the empty row and the one-character name are rejected with reasons');
  assert.equal(report.quality.uniqueAccounts, 2, 'three usable rows resolve to two companies');
  assert.equal(report.matched, 1, 'the repeated company matched rather than being created again');

  const { rows } = await pool.query('select count(*)::int as n from accounts');
  assert.equal(rows[0].n, 2);

  // The raw row is preserved untouched for audit.
  const rawRows = await pool.query(
    `select raw from import_rows where import_batch_id = $1 and row_number = 1`, [report.importBatchId],
  );
  assert.equal(rawRows.rows[0].raw['Company Name'], 'Northgate Air & Heating, LLC');
});

test('a list arriving after discovery merges into the account the miner already knew', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      {
        canonicalName: 'Northgate Air & Heating',
        website: 'https://northgate.example.com',
        phone: '904-555-0101',
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
      },
      { discoverySource: 'market_miner' },
    ),
  );

  const report = await importCsvContent(LIST, { sourceName: 'test-list', sourceKind: 'apollo_export' });
  assert.equal(report.created, 1, 'only Riverbend is new');
  assert.equal(report.matched, 2, 'both Northgate rows resolve to the existing account');

  const { rows } = await pool.query(
    'select account_id from import_rows where row_number = 1',
  );
  assert.equal(rows[0].account_id, accountId);

  // The imported direct line is provider-asserted; the discovered main line stays
  // what it was. Two endpoints, two honest labels, no conflation.
  const endpoints = await pool.query(
    `select endpoint_role, quality_state, relationship_to_person
       from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'
      order by endpoint_role`,
    [accountId],
  );
  assert.equal(endpoints.rows.length, 2);
  const direct = endpoints.rows.find((r) => r.endpoint_role === 'DIRECT_BUSINESS_LINE');
  const main = endpoints.rows.find((r) => r.endpoint_role === 'MAIN_BUSINESS_LINE');
  assert.equal(direct.quality_state, 'PROVIDER_ASSERTED_CURRENT');
  assert.equal(direct.relationship_to_person, 'DIRECT_PROVIDER_ASSERTED');
  assert.equal(main.quality_state, 'PUBLIC_OBSERVED_UNVERIFIED');
});

test('an imported title is recorded as a claim, not as a fact', async () => {
  const report = await importCsvContent(LIST, { sourceName: 'test-list', sourceKind: 'apollo_export' });
  assert.ok(report.importBatchId);

  const { rows } = await pool.query(
    `select confidence, can_state_as_fact, source_type from evidence_records
      where claim_key = 'imported_contact_title'`,
  );
  assert.ok(rows.length > 0, 'the asserted title is captured as evidence');
  for (const row of rows) {
    assert.equal(row.can_state_as_fact, false, 'an imported title may never be spoken as fact');
    assert.equal(row.confidence, 'unknown');
    assert.equal(row.source_type, 'import');
  }

  // And the Contact itself does not claim a confirmed current role.
  const contacts = await pool.query(
    `select role_confidence, employer_match, currentness from contacts where full_name = 'Dana Fielder'`,
  );
  assert.equal(contacts.rows[0].role_confidence, 'UNKNOWN_ROLE');
  assert.equal(contacts.rows[0].employer_match, 'UNCERTAIN');
});

test('a new import cannot resurrect a suppressed company', async () => {
  const rep = await makeUser('Rep A');
  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com', phone: '904-555-0101' },
      { discoverySource: 'market_miner' },
    ),
  );
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', notes: 'Remove us' }, rep);

  const report = await importCsvContent(LIST, { sourceName: 'later-list', sourceKind: 'apollo_export' });
  assert.equal(report.suppressed, 2, 'both rows for the suppressed company are flagged');

  const { rows } = await pool.query(
    'select is_suppressed, ownership_state from accounts where account_id = $1', [accountId],
  );
  assert.equal(rows[0].is_suppressed, true, 'a fresh list must not lift a DNC');
  assert.equal(rows[0].ownership_state, 'SUPPRESSED');

  const search = await searchProspects({ ownership: 'UNCLAIMED' }, rep);
  assert.equal(
    search.results.some((row) => row.account_id === accountId), false,
    'the suppressed company never re-enters claimable inventory',
  );

  const outcomes = await pool.query(
    `select outcome from import_rows where account_id = $1`, [accountId],
  );
  assert.ok(outcomes.rows.every((row) => row.outcome === 'SUPPRESSED'));
});

test('an import does not reset ownership or contact history', async () => {
  const rep = await makeUser('Rep A');
  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      { canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com', phone: '904-555-0101' },
      { discoverySource: 'market_miner' },
    ),
  );
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'VOICEMAIL', notes: 'Left a message' }, rep);

  await importCsvContent(LIST, { sourceName: 'later-list', sourceKind: 'apollo_export' });

  const { rows } = await pool.query(
    'select current_owner_user_id, ownership_state, relationship_state from accounts where account_id = $1',
    [accountId],
  );
  assert.equal(rows[0].current_owner_user_id, rep.userId, 'ownership survives a later import');
  assert.equal(rows[0].ownership_state, 'CLAIMED');

  const activities = await pool.query(
    `select count(*)::int as n from activities where account_id = $1 and activity_type = 'VOICEMAIL'`,
    [accountId],
  );
  assert.equal(activities.rows[0].n, 1, 'prior contact history is untouched');
});

test('re-uploading the identical file is refused rather than double-imported', async () => {
  await importCsvContent(LIST, { sourceName: 'test-list' }, { sha256: 'deadbeef', fileName: 'list.csv' });
  await assert.rejects(
    () => importCsvContent(LIST, { sourceName: 'test-list-again' }, { sha256: 'deadbeef', fileName: 'list.csv' }),
    /already imported/,
  );
  const { rows } = await pool.query('select count(*)::int as n from import_batches');
  assert.equal(rows[0].n, 1);
});

test('a dry run writes nothing', async () => {
  const report = await importCsvContent(LIST, { sourceName: 'preview', dryRun: true });
  assert.equal(report.importBatchId, null);
  assert.ok(report.rows > 0);
  const accounts = await pool.query('select count(*)::int as n from accounts');
  const batches = await pool.query('select count(*)::int as n from import_batches');
  assert.equal(accounts.rows[0].n, 0);
  assert.equal(batches.rows[0].n, 0);
});

test('import never starts outreach', async () => {
  await importCsvContent(LIST, { sourceName: 'test-list' });

  // The schema forbids it outright; assert the guard is real.
  await assert.rejects(
    () => pool.query('update import_batches set outreach_on_import = true'),
    /outreach_on_import/,
  );

  const contactActivities = await pool.query(
    `select count(*)::int as n from activities
      where activity_type in ('CALL_ATTEMPT','EMAIL_SENT','VOICEMAIL')`,
  );
  assert.equal(contactActivities.rows[0].n, 0);

  // Imported accounts enter shared inventory unclaimed, exactly like mined ones.
  const { rows } = await pool.query('select distinct ownership_state from accounts');
  assert.deepEqual(rows.map((r) => r.ownership_state), ['UNCLAIMED']);
});
