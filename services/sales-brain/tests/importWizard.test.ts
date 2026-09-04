import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import {
  buildPreview, confirmSession, createSession, getSession, setColumnMap, expireStaleSessions,
} from '../src/import/session.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * The browser import wizard.
 * Authority: CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §2 — uploading a prospect list must
 * be a normal product workflow rather than an SSH task, and the operator must see
 * exactly what confirming will do before anything is written.
 */

let ops: Awaited<ReturnType<typeof makeUser>>;
let rep: Awaited<ReturnType<typeof makeUser>>;

const CSV = [
  'Company Name,Website,Business Phone,First Name,Last Name,Title,Email,City,State,Zip,Primary Industry',
  '"Northgate Air & Heating, LLC",https://northgate.example.com,(904) 555-0101,Dana,Fielder,Owner,dana@northgate.example.com,Jacksonville,FL,32256,"Heating & AC"',
  '"Riverbend Plumbing Inc.",https://riverbend.example.com,904.555.0202,Riley,Marsh,General Manager,riley@riverbend.example.com,Jacksonville,FL,32224,Plumbing',
  'Sable Run Roofing,,904-555-0303,Jordan,Quill,Sales Manager,,St. Augustine,FL,32084,Roofing',
  'X,,,,,,,,,,',
].join('\n');

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  ops = await makeUser('Ops User', 'RESEARCH_OPS');
  rep = await makeUser('Rep A');
});

test('an upload infers the column mapping and writes nothing yet', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });

  assert.equal(session.rowCount, 4);
  assert.equal(session.columnMap.company, 'Company Name');
  assert.equal(session.columnMap.phone, 'Business Phone');
  assert.equal(session.status, 'MAPPED');

  // Crucially: no canonical state has changed.
  const accounts = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(accounts.rows[0]!.n, 0, 'uploading writes no accounts');
  const batches = await query<{ n: number }>('select count(*)::int as n from import_batches');
  assert.equal(batches.rows[0]!.n, 0, 'and creates no import batch');
});

test('the preview shows exactly what confirming would do', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  const preview = await buildPreview(session.importSessionId, ops.userId);

  assert.ok(preview);
  assert.equal(preview!.totals.rows, 4);
  assert.equal(preview!.totals.create, 3, 'three usable new companies');
  assert.equal(preview!.totals.reject, 1, 'the one-character name is skipped');

  const rejected = preview!.rows.find((row) => row.outcome === 'REJECT');
  assert.match(rejected!.detail ?? '', /too short/i);

  // Still nothing written.
  const accounts = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(accounts.rows[0]!.n, 0);
});

test('the preview names the account a row would merge into', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com',
      city: 'Jacksonville', state: 'FL',
    }, { discoverySource: 'market_miner' }));

  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  const preview = await buildPreview(session.importSessionId, ops.userId);

  const merge = preview!.rows.find((row) => row.outcome === 'MERGE');
  assert.ok(merge, 'the already-known company is flagged as a merge');
  assert.equal(merge!.matchedAccount?.accountId, accountId);
  assert.match(merge!.detail ?? '', /Merges into "Northgate Air & Heating"/);
  assert.equal(preview!.totals.merge, 1);
  assert.equal(preview!.totals.create, 2);
});

test('the preview warns before merging into another rep\'s account', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com',
    }, { discoverySource: 'market_miner' }));
  await claimAccount(accountId, rep);

  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  const preview = await buildPreview(session.importSessionId, ops.userId);

  const owned = preview!.rows.find((row) => row.outcome === 'OWNED_BY_OTHER');
  assert.ok(owned);
  assert.match(owned!.detail ?? '', /already owned by Rep A/);
  assert.equal(preview!.totals.ownedByOther, 1);
});

test('the preview flags a suppressed company before anything is written', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northgate Air & Heating', website: 'https://northgate.example.com',
    }, { discoverySource: 'market_miner' }));
  await claimAccount(accountId, rep);
  await recordDisposition({ accountId, disposition: 'DO_NOT_CONTACT', notes: 'remove us' }, rep);

  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  const preview = await buildPreview(session.importSessionId, ops.userId);

  const suppressed = preview!.rows.find((row) => row.outcome === 'SUPPRESSED');
  assert.ok(suppressed);
  assert.match(suppressed!.detail ?? '', /will not make it contactable/);
  assert.ok(preview!.qualityNotes.some((note) => /asked not to be contacted/.test(note)));
});

test('quality notes report what the list is missing', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  const preview = await buildPreview(session.importSessionId, ops.userId);
  // One of three usable rows has no website and no email.
  assert.ok(preview!.qualityNotes.some((note) => /no website/.test(note)));
  assert.ok(preview!.qualityNotes.some((note) => /no email address/.test(note)));
});

test('a corrected mapping changes the preview', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  // Deliberately drop the company column, as a mis-mapping would.
  await setColumnMap(session.importSessionId, ops.userId,
    { domain: 'Website', phone: 'Business Phone' } as never, null);
  const preview = await buildPreview(session.importSessionId, ops.userId);

  // Rows with no website now have nothing to identify them.
  assert.ok(preview!.totals.reject >= 2, 'the mis-mapping is visible before committing');

  // Correcting it restores the good result.
  await setColumnMap(session.importSessionId, ops.userId,
    { company: 'Company Name', domain: 'Website', phone: 'Business Phone' } as never, null);
  const corrected = await buildPreview(session.importSessionId, ops.userId);
  assert.equal(corrected!.totals.reject, 1);
});

test('confirming writes through the same importer and starts no outreach', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  await buildPreview(session.importSessionId, ops.userId);

  const result = await confirmSession(session.importSessionId, ops.userId);
  assert.equal(result.ok, true);
  assert.equal(result.report!.created, 3);
  assert.equal(result.report!.rejected, 1);

  const accounts = await query<{ n: number; unclaimed: number }>(
    `select count(*)::int as n,
            count(*) filter (where ownership_state = 'UNCLAIMED')::int as unclaimed
       from accounts`);
  assert.equal(accounts.rows[0]!.n, 3);
  assert.equal(accounts.rows[0]!.unclaimed, 3, 'imported accounts enter shared inventory unclaimed');

  const outreach = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where activity_type in ('CALL_ATTEMPT','EMAIL_SENT','VOICEMAIL')`);
  assert.equal(outreach.rows[0]!.n, 0, 'confirming an import contacts nobody');

  // The uploaded rows are cleared once committed.
  const stored = await query<{ raw_rows: unknown }>(
    'select raw_rows from import_sessions where import_session_id = $1', [session.importSessionId]);
  assert.equal(stored.rows[0]!.raw_rows, null);
});

test('a session cannot be confirmed twice', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  await confirmSession(session.importSessionId, ops.userId);
  const second = await confirmSession(session.importSessionId, ops.userId);
  assert.equal(second.ok, false);
  assert.match(second.message ?? '', /already been confirmed/);
});

test('an import session belongs to the person who started it', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'airtable-test', createdBy: ops.userId,
  });
  assert.equal(await getSession(session.importSessionId, rep.userId), null);
  const stolen = await confirmSession(session.importSessionId, rep.userId);
  assert.equal(stolen.ok, false);
  assert.match(stolen.message ?? '', /belongs to someone else/);
});

test('re-uploading an already imported file is refused at upload time', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'first', createdBy: ops.userId,
  });
  await confirmSession(session.importSessionId, ops.userId);

  await assert.rejects(
    () => createSession({ content: CSV, fileName: 'list.csv', sourceName: 'again', createdBy: ops.userId }),
    /already imported/,
    'the operator is told before they invest in mapping it again',
  );
});

test('a file with no header row is rejected clearly', async () => {
  await assert.rejects(
    () => createSession({ content: '', fileName: 'empty.csv', sourceName: 'empty', createdBy: ops.userId }),
    /no header row/,
  );
});

test('an abandoned upload expires and its rows are dropped', async () => {
  const session = await createSession({
    content: CSV, fileName: 'list.csv', sourceName: 'abandoned', createdBy: ops.userId,
  });
  await query(`update import_sessions set expires_at = now() - interval '1 hour'
                where import_session_id = $1`, [session.importSessionId]);

  const expired = await expireStaleSessions();
  assert.equal(expired, 1);

  const stored = await query<{ status: string; raw_rows: unknown }>(
    'select status, raw_rows from import_sessions where import_session_id = $1',
    [session.importSessionId]);
  assert.equal(stored.rows[0]!.status, 'EXPIRED');
  assert.equal(stored.rows[0]!.raw_rows, null, 'an unconfirmed upload does not linger');
});

test('the upload endpoint is manager/ops only', async () => {
  const { buildServer } = await import('../src/api/server.js');
  const { createUser } = await import('../src/domain/auth.js');
  const app = await buildServer();
  try {
    await createUser({
      email: 'plainrep@test.local', displayName: 'Plain Rep', role: 'SALES_REP', password: 'pw-import-test',
    });
    const login = await app.inject({
      method: 'POST', url: '/login', payload: { email: 'plainrep@test.local', password: 'pw-import-test' },
    });
    const cookie = `yad_sales_session=${login.cookies.find((c) => c.name === 'yad_sales_session')!.value}`;

    for (const url of ['/imports', '/mining', '/research-health']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(response.statusCode, 403, `${url} must refuse an ordinary rep`);
    }
  } finally {
    await app.close();
  }
});
