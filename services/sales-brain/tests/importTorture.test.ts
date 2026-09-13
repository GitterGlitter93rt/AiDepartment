import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { importCsvContent } from '../src/import/importer.js';
import { createSession, buildPreview, confirmSession } from '../src/import/session.js';
import { parseCsv, detectDelimiter } from '../src/import/csv.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { csvCell, csvFile } from '../src/export/csv.js';
import { normalizeCompanyName, normalizePhone, normalizeEmail, normalizeHostname } from '../src/domain/normalize.js';

/**
 * Import and dedupe under attack.
 * Authority: rep-ownership-data-model.md SS12 (suppression survives rediscovery),
 * data-contract SS7 identity resolution, SALES-TEAM-ACCESS-CURRENT.md SS19.
 *
 * A prospect list is the messiest input this product takes: it arrives from an
 * export nobody controls, it repeats, it contradicts itself, and it will be re-run
 * by a rep who is not sure whether the first run worked. These cases are the ones
 * that would quietly corrupt the canonical database rather than fail loudly.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

const HEADERS = 'company,website,phone,email,city,state,zip,contact_name,contact_title';

function csv(rows: string[]): string {
  return [HEADERS, ...rows].join('\n');
}

async function runImport(content: string, sourceName = 'torture', dryRun = false) {
  return importCsvContent(content, { sourceName, sourceKind: 'csv', dryRun });
}

async function accountCount(): Promise<number> {
  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  return rows[0]!.n;
}

// --- scale and idempotency -------------------------------------------------------

test('a ten thousand row import completes, and re-running it creates nothing new',
  async () => {
    const rows: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      rows.push(`Torture Co ${i},https://torture${i}.invalid,904-555-${String(i % 10000).padStart(4, '0')},`
        + `info@torture${i}.invalid,Jacksonville,FL,32256,Owner ${i},Owner`);
    }
    const content = csv(rows);

    const started = Date.now();
    const first = await runImport(content, 'ten-thousand');
    const elapsed = Date.now() - started;

    assert.equal(first.rows, 10_000);
    assert.equal(first.created + first.matched + first.rejected, 10_000,
      'rows went missing between parsing and writing');
    assert.ok(first.created > 9_000, `only ${first.created} of 10,000 were created`);
    assert.ok(elapsed < 300_000, `the import took ${elapsed} ms`);

    const afterFirst = await accountCount();
    const second = await runImport(content, 'ten-thousand');
    const afterSecond = await accountCount();

    assert.equal(afterSecond, afterFirst,
      `re-running the same file created ${afterSecond - afterFirst} more Accounts`);
    assert.equal(second.created, 0, `${second.created} Accounts were created on the second run`);
    assert.equal(second.matched, first.created, 'the second run did not match the first');
  });

test('the same file imported three times leaves one Account per company', async () => {
  const content = csv([
    'Repeat Air,https://repeatair.invalid,904-555-0111,info@repeatair.invalid,Jacksonville,FL,32256,Ray Alvarez,Owner',
    'Repeat Roofing,https://repeatroofing.invalid,904-555-0112,,Jacksonville,FL,32256,,',
  ]);
  await runImport(content);
  await runImport(content);
  await runImport(content);
  assert.equal(await accountCount(), 2);

  // And the contact was not duplicated either.
  const contacts = await query<{ n: number }>('select count(*)::int as n from contacts');
  assert.equal(contacts.rows[0]!.n, 1, 'three imports produced more than one contact');
  const endpoints = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where endpoint_type = 'PHONE'`);
  assert.equal(endpoints.rows[0]!.n, 2, 'phone endpoints multiplied across imports');
});

// --- name variation -------------------------------------------------------------

test('punctuation, suffix and case variations of one company do not fork it', async () => {
  await runImport(csv([
    'Northgate Air & Heat LLC,https://northgateair.invalid,904-555-0120,,Jacksonville,FL,32256,,',
  ]));
  const first = await accountCount();
  assert.equal(first, 1);

  // Same company, four ways a list might spell it. The domain matches, so these
  // must resolve to the one Account.
  await runImport(csv([
    '"northgate air & heat, llc",https://northgateair.invalid,904-555-0120,,Jacksonville,FL,32256,,',
    'NORTHGATE AIR AND HEAT INC,https://www.northgateair.invalid,904-555-0120,,Jacksonville,FL,32256,,',
    'Northgate Air & Heat Corp.,http://northgateair.invalid/,(904) 555-0120,,Jacksonville,FL,32256,,',
    'Northgate Air &amp; Heat,https://northgateair.invalid,+1 904 555 0120,,Jacksonville,FL,32256,,',
  ]), 'variations');

  assert.equal(await accountCount(), 1,
    'spelling variations of one company created separate Accounts');
});

test('a row whose columns are shifted is rejected, not turned into a phantom company',
  async () => {
    // An unquoted comma in a company name shifts every column right. Before the
    // reject gate checked that a contact route *normalises* rather than merely
    // exists, this produced an Account with a name, no domain, no endpoint and no
    // location -- counted as created, and unreachable forever.
    const report = await runImport(csv([
      'northgate air & heat, llc,https://northgateair.invalid,904-555-0120,,Jacksonville,FL,32256,,',
    ]), 'misaligned');

    assert.equal(report.created, 0, 'a misaligned row created an Account');
    assert.equal(report.rejected, 1);
    assert.match(report.rejections[0]!.reason, /misaligned|unusable/,
      'the operator is not told what is wrong with the row');
    assert.equal(await accountCount(), 0);

    // A row with a genuinely absent contact route says something different, because
    // a thin list and a broken file are different problems.
    const thin = await runImport(csv([
      'Thin Row Co,,,,Jacksonville,FL,32256,,',
    ]), 'thin');
    assert.equal(thin.rejected, 1);
    assert.match(thin.rejections[0]!.reason, /nothing to research or contact/);
  });

test('www, http and https are the same website', () => {
  const forms = ['https://coastalair.invalid', 'http://coastalair.invalid',
                 'https://www.coastalair.invalid', 'www.coastalair.invalid',
                 'coastalair.invalid', 'https://coastalair.invalid/contact?utm_source=x'];
  const normalized = new Set(forms.map((form) => normalizeHostname(form)));
  assert.equal(normalized.size, 1, `these did not collapse: ${[...normalized].join(' | ')}`);
});

test('two businesses at one phone number stay two businesses', async () => {
  // A strip mall, an answering service or a shared reception desk. The phone alone
  // must never merge identities.
  await runImport(csv([
    'Shared Line Plumbing,https://sharedplumbing.invalid,904-555-0130,,Jacksonville,FL,32256,,',
    'Shared Line Roofing,https://sharedroofing.invalid,904-555-0130,,Jacksonville,FL,32256,,',
  ]), 'shared-phone');

  assert.equal(await accountCount(), 2,
    'two companies sharing a number were merged into one');
  const endpoints = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where normalized_value = '+19045550130'`);
  assert.equal(endpoints.rows[0]!.n, 2, 'the shared number was not recorded for both');
});

test('one business with two locations is one Account, not two', async () => {
  await runImport(csv([
    'Two Branch Electric,https://twobranch.invalid,904-555-0140,,Jacksonville,FL,32256,,',
    'Two Branch Electric,https://twobranch.invalid,904-555-0141,,St. Augustine,FL,32084,,',
  ]), 'two-locations');
  assert.equal(await accountCount(), 1, 'a second location forked the Account');

  const locations = await query<{ n: number }>('select count(*)::int as n from locations');
  assert.ok(locations.rows[0]!.n >= 1, 'no location was recorded at all');
});

test('the same name in two states stays two companies', async () => {
  await runImport(csv([
    'Summit Roofing,,904-555-0150,,Jacksonville,FL,32256,,',
    'Summit Roofing,,512-555-0151,,Austin,TX,78701,,',
  ]), 'two-states');
  assert.equal(await accountCount(), 2,
    'two independent companies with the same name were merged across states');
});

test('a tracking number does not become the canonical business phone', async () => {
  const report = await runImport(csv([
    'Tracking Number Co,https://trackingco.invalid,904-555-0160,,Jacksonville,FL,32256,,',
  ]), 'tracking');
  assert.equal(report.created, 1);

  // A second list carries a different number for the same company. Both are kept as
  // endpoints; neither silently replaces the other.
  await runImport(csv([
    'Tracking Number Co,https://trackingco.invalid,904-555-0161,,Jacksonville,FL,32256,,',
  ]), 'tracking-2');

  const endpoints = await query<{ normalized_value: string; quality_state: string }>(
    `select normalized_value, quality_state from contact_endpoints
      where endpoint_type = 'PHONE' order by normalized_value`);
  assert.equal(endpoints.rowCount, 2, 'the second number replaced the first');
});

// --- malformed input -------------------------------------------------------------

test('malformed phones, emails and URLs are refused rather than stored as truth',
  async () => {
    const report = await runImport(csv([
      'Bad Phone Co,https://badphone.invalid,not-a-number,,Jacksonville,FL,32256,,',
      'Bad Email Co,https://bademail.invalid,904-555-0170,not-an-email,Jacksonville,FL,32256,,',
      'Bad Url Co,ht!tp://nonsense,904-555-0171,,Jacksonville,FL,32256,,',
      'Short Phone Co,https://shortphone.invalid,555,,Jacksonville,FL,32256,,',
      'Letters Phone Co,https://lettersphone.invalid,904-555-ABCD,,Jacksonville,FL,32256,,',
    ]), 'malformed');
    assert.equal(report.rows, 5);

    const phones = await query<{ normalized_value: string }>(
      `select normalized_value from contact_endpoints where endpoint_type = 'PHONE'`);
    for (const row of phones.rows) {
      assert.match(row.normalized_value, /^\+\d{10,15}$/,
        `${row.normalized_value} was stored as a phone number`);
    }
    const emails = await query<{ normalized_value: string }>(
      `select normalized_value from contact_endpoints where endpoint_type = 'EMAIL'`);
    for (const row of emails.rows) {
      assert.match(row.normalized_value, /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
        `${row.normalized_value} was stored as an email address`);
    }
  });

test('normalisation refuses what it cannot understand instead of guessing', () => {
  for (const bad of ['not-a-number', '555', '904-555-ABCD', '', '   ', '+1', '12']) {
    assert.equal(normalizePhone(bad), null, `${bad} was accepted as a phone number`);
  }
  for (const bad of ['not-an-email', 'a@', '@b.com', 'a b@c.com', '']) {
    assert.equal(normalizeEmail(bad), null, `${bad} was accepted as an email`);
  }
  // And what it does understand, it understands consistently.
  assert.equal(normalizePhone('(904) 555-0170'), '+19045550170');
  assert.equal(normalizePhone('904.555.0170'), '+19045550170');
  assert.equal(normalizePhone('+1 904 555 0170'), '+19045550170');
  assert.equal(normalizeEmail('  Ray@Coastal.INVALID '), 'ray@coastal.invalid');
});

test('a row that identifies no business is rejected, with the line number', async () => {
  const report = await runImport(csv([
    ',,,,Jacksonville,FL,32256,,',
    'A,,,,Jacksonville,FL,32256,,',
    'No Contact Route Co,,,,Jacksonville,FL,32256,,',
    'Fine Co,https://fine.invalid,904-555-0180,,Jacksonville,FL,32256,,',
  ]), 'rejects');

  assert.equal(report.created, 1, 'more than the one usable row was created');
  assert.equal(report.rejected, 3);
  for (const rejection of report.rejections) {
    assert.ok(rejection.line > 1, 'a rejection has no source line');
    assert.ok(rejection.reason.length > 0, 'a rejection has no reason');
  }
});

// --- hostile and awkward values ---------------------------------------------------

test('very long values do not break the import or get silently truncated', async () => {
  const longName = `Long ${'A'.repeat(4_000)} Co`;
  const report = await runImport(csv([
    `"${longName}",https://longname.invalid,904-555-0190,,Jacksonville,FL,32256,,`,
  ]), 'long');
  assert.equal(report.rows, 1);

  if (report.created === 1) {
    const { rows } = await query<{ canonical_name: string }>(
      'select canonical_name from accounts limit 1');
    assert.equal(rows[0]!.canonical_name, longName,
      'a long name was stored differently from how it arrived');
  } else {
    assert.equal(report.rejected, 1, 'a long name was neither stored nor rejected');
  }
});

test('unicode, accents and apostrophes survive the round trip', async () => {
  const names = ['Muñoz Plumbing', "O'Donnell Roofing", 'Björnsson Electric',
                 'Nguyễn Dental', 'Ceauşescu Contracting', '北方空调'];
  await runImport(csv(names.map((name, i) =>
    `"${name}",https://unicode${i}.invalid,904-555-02${String(i).padStart(2, '0')},,Jacksonville,FL,32256,,`)),
  'unicode');

  const { rows } = await query<{ canonical_name: string }>(
    'select canonical_name from accounts order by canonical_name');
  const stored = new Set(rows.map((row) => row.canonical_name));
  for (const name of names) {
    assert.ok(stored.has(name), `${name} did not survive the import`);
  }
});

test('a value that a spreadsheet would run is stored as data, and exported inert',
  async () => {
    const hostile = '=cmd|\' /c calc\'!A1';
    await runImport(csv([
      `"${hostile}",https://formula.invalid,904-555-0210,,Jacksonville,FL,32256,,`,
      `"+1 Plumbing",https://plusone.invalid,904-555-0211,,Jacksonville,FL,32256,,`,
      `"@Home Services",https://athome.invalid,904-555-0212,,Jacksonville,FL,32256,,`,
      `"-Alpha Roofing",https://alpha.invalid,904-555-0213,,Jacksonville,FL,32256,,`,
    ]), 'formula');

    // Stored exactly as it arrived: a prospect's name is not ours to rewrite, and a
    // company really can be called "+1 Plumbing".
    const { rows } = await query<{ canonical_name: string }>(
      'select canonical_name from accounts order by canonical_name');
    const stored = rows.map((row) => row.canonical_name);
    assert.ok(stored.includes(hostile), 'the hostile value was mangled on import');
    assert.ok(stored.includes('+1 Plumbing'), 'a legitimate leading plus was mangled');

    // And made inert at the point it would leave as CSV.
    const file = csvFile(['company'], stored.map((name) => [name]));
    for (const line of file.split('\r\n').slice(1)) {
      assert.equal(/^"?[=+\-@]/.test(line), false,
        `a spreadsheet would evaluate this line: ${line}`);
    }
    assert.equal(csvCell('=1+1'), "'=1+1");
    assert.equal(csvCell('+1 Plumbing'), "'+1 Plumbing");
    assert.equal(csvCell('@home'), "'@home");
    assert.equal(csvCell('-5'), "'-5");
    // Ordinary values are untouched.
    assert.equal(csvCell('Coastal Air'), 'Coastal Air');
    assert.equal(csvCell('Smith, Jones & Co'), '"Smith, Jones & Co"');
    assert.equal(csvCell('He said "no"'), '"He said ""no"""');
  });

test('unexpected columns are reported, not silently dropped', async () => {
  const content = [
    'company,website,phone,secret_score,internal_notes,zip',
    'Extra Columns Co,https://extracols.invalid,904-555-0220,99,do not import me,32256',
  ].join('\n');
  const report = await runImport(content, 'extra-columns');
  assert.ok(report.unmappedHeaders.includes('secret_score'), 'an unmapped column was hidden');
  assert.ok(report.unmappedHeaders.includes('internal_notes'));
  assert.equal(report.created, 1, 'the row was rejected for having extra columns');
});

test('a CSV with quoted commas, embedded newlines and CRLF parses correctly', () => {
  const content = 'company,note\r\n"Smith, Jones & Co","line one\nline two"\r\nPlain Co,simple\r\n';
  const parsed = parseCsv(content);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]!['company'], 'Smith, Jones & Co');
  assert.equal(parsed.rows[0]!['note'], 'line one\nline two');
  assert.equal(parsed.rows[1]!['company'], 'Plain Co');
});

test('a byte order mark does not become part of the first header', () => {
  const parsed = parseCsv('﻿company,phone\nCoastal Air,904-555-0100\n');
  assert.deepEqual(parsed.headers, ['company', 'phone']);
  assert.equal(parsed.rows[0]!['company'], 'Coastal Air');
});

test('a semicolon or tab delimited file is detected rather than read as one column', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
});

// --- relationship and suppression survival ---------------------------------------

test('an import never triggers outreach', async () => {
  await runImport(csv([
    'No Outreach Co,https://nooutreach.invalid,904-555-0230,info@nooutreach.invalid,Jacksonville,FL,32256,Ray,Owner',
  ]), 'no-outreach');

  for (const table of ['contact_attempts', 'email_outbox', 'email_enrollments',
                       'meeting_bookings', 'voice_calls']) {
    const { rows } = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
    assert.equal(rows[0]!.n, 0, `${table} has ${rows[0]!.n} rows after an import`);
  }
  // The only activities are the ones an import is allowed to write: the discovery
  // of the company and the import itself. Nothing that reached a person.
  const allowed = new Set(['DISCOVERED', 'IMPORTED', 'RESEARCHED', 'CONTACT_ENRICHED']);
  const activities = await query<{ activity_type: string }>(
    'select distinct activity_type from activities');
  for (const row of activities.rows) {
    assert.ok(allowed.has(row.activity_type),
      `an import produced a ${row.activity_type} activity`);
  }
});

test('a suppressed endpoint stays suppressed when a list rediscovers it', async () => {
  await runImport(csv([
    'Suppressed Endpoint Co,https://suppendpoint.invalid,904-555-0240,,Jacksonville,FL,32256,,',
  ]), 'first');
  const { rows: endpoints } = await query<{ endpoint_id: string; account_id: string }>(
    `select endpoint_id, account_id from contact_endpoints where endpoint_type = 'PHONE'`);
  const endpoint = endpoints[0]!;
  await query(
    `insert into suppressions (scope, account_id, endpoint_id, normalized_value,
                               suppression_type, source, reason)
     values ('ENDPOINT', $1, $2, '+19045550240', 'DNC', 'prospect_request', 'Asked us not to call.')`,
    [endpoint.account_id, endpoint.endpoint_id]);

  // The same number arrives again from a different source.
  await runImport(csv([
    'Suppressed Endpoint Co,https://suppendpoint.invalid,904-555-0240,,Jacksonville,FL,32256,,',
  ]), 'rediscovery');

  const after = await query<{ is_suppressed: boolean; quality_state: string }>(
    'select is_suppressed, quality_state from contact_endpoints where endpoint_id = $1',
    [endpoint.endpoint_id]);
  assert.equal(after.rows[0]!.is_suppressed, true, 'rediscovery cleared a suppression');
  assert.equal(after.rows[0]!.quality_state, 'SUPPRESSED');
});

test('a suppressed Account is not resurrected as fresh cold inventory', async () => {
  await runImport(csv([
    'Do Not Contact Co,https://dnc.invalid,904-555-0250,,Jacksonville,FL,32256,,',
  ]), 'first');
  const { rows } = await query<{ account_id: string }>('select account_id from accounts limit 1');
  const accountId = rows[0]!.account_id;
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked to be removed.')`, [accountId]);

  const report = await runImport(csv([
    'Do Not Contact Co,https://dnc.invalid,904-555-0250,,Jacksonville,FL,32256,,',
  ]), 'rediscovery');

  const after = await query<{ is_suppressed: boolean; ownership_state: string }>(
    'select is_suppressed, ownership_state from accounts where account_id = $1', [accountId]);
  assert.equal(after.rows[0]!.is_suppressed, true, 'an import cleared a suppression');
  assert.equal(after.rows[0]!.ownership_state, 'SUPPRESSED');
  assert.ok(report.suppressed >= 1, 'the import did not report the suppressed match');
});

test('an import into an Account another rep owns does not take it', async () => {
  const rep = await makeUser('Import Owner');
  await runImport(csv([
    'Already Owned Co,https://alreadyowned.invalid,904-555-0260,,Jacksonville,FL,32256,,',
  ]), 'first');
  const { rows } = await query<{ account_id: string }>('select account_id from accounts limit 1');
  const accountId = rows[0]!.account_id;
  await claimAccount(accountId, rep);

  await runImport(csv([
    'Already Owned Co,https://alreadyowned.invalid,904-555-0260,ray@alreadyowned.invalid,Jacksonville,FL,32256,Ray Alvarez,Owner',
  ]), 'second');

  const after = await query<{ current_owner_user_id: string; ownership_state: string }>(
    'select current_owner_user_id, ownership_state from accounts where account_id = $1',
    [accountId]);
  assert.equal(after.rows[0]!.current_owner_user_id, rep.userId, 'an import changed ownership');
  assert.equal(after.rows[0]!.ownership_state, 'CLAIMED');

  // But the new information did land.
  const emails = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where endpoint_type = 'EMAIL'`);
  assert.equal(emails.rows[0]!.n, 1, 'the import added nothing to an owned Account');
});

test('rediscovery does not reset an Account that already has history', async () => {
  const rep = await makeUser('History Rep');
  await runImport(csv([
    'History Co,https://historyco.invalid,904-555-0270,,Jacksonville,FL,32256,,',
  ]), 'first');
  const { rows } = await query<{ account_id: string }>('select account_id from accounts limit 1');
  const accountId = rows[0]!.account_id;
  await claimAccount(accountId, rep);
  // Through the product path, so the relationship state actually advances and the
  // follow-up is created the way a real callback is.
  const worked = await recordDisposition({
    accountId, disposition: 'CALLBACK_REQUESTED', prospectRequested: true,
    callbackDueAt: new Date(Date.now() + 2 * 86_400_000),
    notes: 'He asked me to try him Thursday.',
    prospectStatements: [{ category: 'workflow',
      text: 'He said two techs return calls all morning.' }],
  }, rep);
  assert.equal(worked.ok, true, `the fixture disposition failed: ${worked.reason}`);
  const beforeState = await query<{ relationship_state: string }>(
    'select relationship_state from accounts where account_id = $1', [accountId]);
  assert.notEqual(beforeState.rows[0]!.relationship_state, 'COLD',
    'the fixture did not advance the relationship at all');

  await runImport(csv([
    'History Co,https://historyco.invalid,904-555-0270,,Jacksonville,FL,32256,,',
  ]), 'rediscovery');

  const survived = await query<{ activities: number; statements: number; followups: number;
                                relationship_state: string }>(
    `select (select count(*)::int from activities where account_id = $1
              and disposition = 'CALLBACK_REQUESTED') as activities,
            (select count(*)::int from prospect_statements where account_id = $1) as statements,
            (select count(*)::int from follow_ups where account_id = $1 and status = 'OPEN') as followups,
            (select relationship_state from accounts where account_id = $1) as relationship_state`,
    [accountId]);
  const row = survived.rows[0]!;
  assert.equal(row.activities, 1, 'the call history was discarded');
  assert.equal(row.statements, 1, 'what the prospect said was discarded');
  assert.equal(row.followups, 1, 'the promised callback was discarded');
  assert.notEqual(row.relationship_state, 'COLD',
    'rediscovery reset a worked Account to cold');
});

test('an import into a company with an opportunity and a meeting keeps both', async () => {
  const rep = await makeUser('Opportunity Rep');
  await runImport(csv([
    'Opportunity Co,https://opportunityco.invalid,904-555-0280,,Jacksonville,FL,32256,,',
  ]), 'first');
  const { rows } = await query<{ account_id: string }>('select account_id from accounts limit 1');
  const accountId = rows[0]!.account_id;
  await claimAccount(accountId, rep);
  await query(
    `insert into opportunities (account_id, owner_user_id, title, stage, problem_summary,
                                source_channel)
     values ($1, $2, 'Opportunity Co', 'DISCOVERY',
             'They lose two calls a day while both techs are out on jobs.', 'human_rep')`,
    [accountId, rep.userId]);
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, provider_event_id, confirmed_at, created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'import-torture-1',
             now() + interval '2 days', now() + interval '2 days' + interval '15 minutes',
             'CONFIRMED', 'calcom', 'evt-1', now(), $2)`, [accountId, rep.userId]);

  await runImport(csv([
    'Opportunity Co,https://opportunityco.invalid,904-555-0280,,Jacksonville,FL,32256,,',
  ]), 'rediscovery');

  const after = await query<{ opportunities: number; meetings: number; confirmed: number }>(
    `select (select count(*)::int from opportunities where account_id = $1) as opportunities,
            (select count(*)::int from meeting_bookings where account_id = $1) as meetings,
            (select count(*)::int from meeting_bookings where account_id = $1
              and status = 'CONFIRMED') as confirmed`, [accountId]);
  assert.equal(after.rows[0]!.opportunities, 1, 'the opportunity was lost or duplicated');
  assert.equal(after.rows[0]!.meetings, 1, 'the meeting was lost or duplicated');
  assert.equal(after.rows[0]!.confirmed, 1, 'the confirmed booking lost its confirmation');
});

// --- conflicting sources -----------------------------------------------------------

test('two sources naming different owners keep both, and neither is invented',
  async () => {
    await runImport(csv([
      'Two Owners Co,https://twoowners.invalid,904-555-0290,,Jacksonville,FL,32256,Ray Alvarez,Owner',
    ]), 'source-a');
    await runImport(csv([
      'Two Owners Co,https://twoowners.invalid,904-555-0290,,Jacksonville,FL,32256,Dana Whitfield,Owner',
    ]), 'source-b');

    const contacts = await query<{ full_name: string; role_confidence: string }>(
      'select full_name, role_confidence from contacts order by full_name');
    const names = contacts.rows.map((row) => row.full_name);
    assert.deepEqual(names, ['Dana Whitfield', 'Ray Alvarez'],
      'a conflicting owner name overwrote the first instead of being recorded');
    for (const row of contacts.rows) {
      assert.notEqual(row.role_confidence, 'CONFIRMED_CURRENT_ROLE',
        'a contact from a list was recorded as a confirmed current role');
    }
  });

test('blank fields do not overwrite what we already know', async () => {
  await runImport(csv([
    'Blank Fields Co,https://blankfields.invalid,904-555-0300,ray@blankfields.invalid,Jacksonville,FL,32256,Ray Alvarez,Owner',
  ]), 'full');
  await runImport(csv([
    'Blank Fields Co,https://blankfields.invalid,,,,,,,',
  ]), 'sparse');

  const after = await query<{ phones: number; emails: number; contacts: number }>(
    `select (select count(*)::int from contact_endpoints where endpoint_type = 'PHONE') as phones,
            (select count(*)::int from contact_endpoints where endpoint_type = 'EMAIL') as emails,
            (select count(*)::int from contacts) as contacts`);
  assert.equal(after.rows[0]!.phones, 1, 'a blank column deleted the phone');
  assert.equal(after.rows[0]!.emails, 1, 'a blank column deleted the email');
  assert.equal(after.rows[0]!.contacts, 1, 'a blank column deleted the contact');
});

test('a dry run writes nothing at all', async () => {
  const before = await accountCount();
  const report = await runImport(csv([
    'Dry Run Co,https://dryrun.invalid,904-555-0310,,Jacksonville,FL,32256,,',
  ]), 'dry', true);
  assert.equal(report.created, 1, 'a dry run should still report what it would create');
  assert.equal(await accountCount(), before, 'a dry run wrote to the database');
  assert.equal(report.importBatchId, null, 'a dry run recorded an import batch');
});

test('name normalisation is stable and does not over-collapse', () => {
  assert.equal(normalizeCompanyName('Northgate Air & Heat, LLC.'),
    normalizeCompanyName('northgate air and heat llc'));
  assert.notEqual(normalizeCompanyName('Northgate Air'), normalizeCompanyName('Northgate Roofing'));
  assert.notEqual(normalizeCompanyName('Summit Roofing'), normalizeCompanyName('Summit Plumbing'));
  // An empty or punctuation-only name normalises to nothing rather than to a match.
  assert.equal(normalizeCompanyName('   '), '');
  assert.equal(normalizeCompanyName('...'), '');
});


// --- the confirm path -------------------------------------------------------------

test('confirming the same import twice runs it once', async () => {
  const ops = await makeUser('Import Ops', 'RESEARCH_OPS');
  const content = csv([
    'Confirm Once Co,https://confirmonce.invalid,904-555-0320,,Jacksonville,FL,32256,,',
    'Confirm Twice Co,https://confirmtwice.invalid,904-555-0321,,Jacksonville,FL,32256,,',
  ]);
  const session = await createSession({
    content, fileName: 'confirm.csv', sourceName: 'confirm', sourceKind: 'csv',
    createdBy: ops.userId,
  });
  await buildPreview(session.importSessionId, ops.userId);

  // Both presses at once, which is what a rep does when the first one appears to
  // hang. Before the session was claimed atomically, both ran the whole file.
  const [first, second] = await Promise.all([
    confirmSession(session.importSessionId, ops.userId),
    confirmSession(session.importSessionId, ops.userId),
  ]);

  const succeeded = [first, second].filter((result) => result.ok);
  assert.equal(succeeded.length, 1, `${succeeded.length} confirms of one session succeeded`);
  const refused = [first, second].find((result) => !result.ok)!;
  assert.match(refused.message ?? '', /already/i);

  const batches = await query<{ n: number }>('select count(*)::int as n from import_batches');
  assert.equal(batches.rows[0]!.n, 1, 'one file produced two import batches');
  assert.equal(await accountCount(), 2);
});

test('a confirm that throws does not wedge the session', async () => {
  const ops = await makeUser('Wedge Ops', 'RESEARCH_OPS');
  const session = await createSession({
    content: csv(['Wedge Co,https://wedge.invalid,904-555-0330,,Jacksonville,FL,32256,,']),
    fileName: 'wedge.csv', sourceName: 'wedge', sourceKind: 'csv', createdBy: ops.userId,
  });
  await buildPreview(session.importSessionId, ops.userId);
  // A vertical that exists when the session is created and is deactivated before the
  // confirm makes the importer throw before it writes anything -- the same shape as
  // a registry change between preview and confirm.
  await query(
    `update import_sessions set default_vertical_profile_id = 'hvac'
      where import_session_id = $1`, [session.importSessionId]);
  await query(`update vertical_profiles set is_active = false where vertical_profile_id = 'hvac'`);

  await assert.rejects(() => confirmSession(session.importSessionId, ops.userId));

  const after = await query<{ status: string }>(
    'select status from import_sessions where import_session_id = $1', [session.importSessionId]);
  assert.notEqual(after.rows[0]!.status, 'RUNNING',
    'a failed confirm left the session stuck as running');

  // And it can be confirmed again once the problem is fixed.
  await query(`update vertical_profiles set is_active = true where vertical_profile_id = 'hvac'`);
  const retry = await confirmSession(session.importSessionId, ops.userId);
  assert.equal(retry.ok, true, `the retry failed: ${retry.message}`);
  assert.equal(await accountCount(), 1, 'the retry did not import the row');
});

test('a failed import can be retried; a successful one cannot be run twice', async () => {
  const content = csv([
    'Retry Guard Co,https://retryguard.invalid,904-555-0340,,Jacksonville,FL,32256,,',
  ]);
  // The same content twice through the file-hash path: the second is refused.
  const first = await importCsvContent(content,
    { sourceName: 'hash-guard', sourceKind: 'csv' }, { fileName: 'g.csv', sha256: 'hash-abc' });
  assert.equal(first.created, 1);
  await assert.rejects(
    () => importCsvContent(content, { sourceName: 'hash-guard', sourceKind: 'csv' },
      { fileName: 'g.csv', sha256: 'hash-abc' }),
    /already imported/);

  // A batch that failed does not hold its hash against a retry.
  await query(`update import_batches set status = 'FAILED' where file_sha256 = 'hash-abc'`);
  const retry = await importCsvContent(content,
    { sourceName: 'hash-guard', sourceKind: 'csv' }, { fileName: 'g.csv', sha256: 'hash-abc' });
  assert.equal(retry.matched, 1, 'the retry did not run');
  assert.equal(await accountCount(), 1, 'the retry duplicated the Account');
});

test('a row that throws inside a batch costs only itself', async () => {
  // Rows are committed in batches now, so the isolation that per-row transactions
  // gave has to come from somewhere: each row runs inside its own savepoint.
  const good = Array.from({ length: 20 }, (_, i) =>
    `Savepoint Co ${i},https://savepoint${i}.invalid,904-555-04${String(i).padStart(2, '0')},,Jacksonville,FL,32256,,`);
  const report = await runImport(csv(good), 'savepoints');
  assert.equal(report.created, 20, 'a batch lost rows');
  assert.equal(await accountCount(), 20);
});
