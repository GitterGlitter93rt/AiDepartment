import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { Rng, seedFrom } from '../src/synthetic/random.js';
import {
  generateDataset, normalizeForCompare, formatPhone, DATASET_ORIGIN,
} from '../src/synthetic/generator.js';
import { MARKETS, RESERVED_LINE, SYNTHETIC_MARKER, VERTICALS } from '../src/synthetic/vocabulary.js';

/**
 * The synthetic generator itself.
 *
 * A fixture that is wrong is worse than no fixture: every scale, concurrency and
 * analytics conclusion in this session rests on it. So the generator is tested for
 * the two things that would invalidate those conclusions -- a shape that does not
 * match the declared distribution, and data that could be mistaken for real.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

// --- the random number generator -----------------------------------------------

test('the same seed produces the same stream, and a different seed does not', () => {
  const a = new Rng('seed-a', 'account', 7);
  const b = new Rng('seed-a', 'account', 7);
  const c = new Rng('seed-b', 'account', 7);
  const first = Array.from({ length: 10 }, () => a.next());
  const second = Array.from({ length: 10 }, () => b.next());
  const third = Array.from({ length: 10 }, () => c.next());
  assert.deepEqual(first, second, 'the same seed diverged');
  assert.notDeepEqual(first, third, 'two seeds produced the same stream');
});

test('a low-probability draw holds its rate in every slice, not only overall', () => {
  // The failure this guards against was real: seeded straight from the hash, the
  // eighth draw across the first two hundred consecutive indices never once fell
  // below 0.03 for one seed, although the long-run rate was 2.8%. Fixtures are read
  // in slices, so a skewed slice is a wrong fixture.
  const problems: string[] = [];
  for (const seed of ['smoke-v1', 'yad-scale-v1', 'a', 'x2']) {
    for (let prior = 0; prior <= 12; prior += 1) {
      let hits = 0;
      const draws = 500;
      for (let i = 0; i < draws; i += 1) {
        const rng = new Rng(seed, 'account', i);
        for (let k = 0; k < prior; k += 1) rng.next();
        if (rng.next() < 0.03) hits += 1;
      }
      // Three standard deviations either side of 15 expected hits is 4 to 26.
      if (hits < 4 || hits > 26) {
        problems.push(`seed ${seed} at draw ${prior}: ${hits} of ${draws}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('the first draw is uniform across many seeds', () => {
  const buckets = new Array(10).fill(0);
  const draws = 50_000;
  for (let i = 0; i < draws; i += 1) buckets[Math.floor(new Rng('u', i).next() * 10)] += 1;
  const expected = draws / 10;
  for (const [bucket, count] of buckets.entries()) {
    // Four standard deviations on a binomial with p = 0.1.
    const sigma = Math.sqrt(draws * 0.1 * 0.9);
    assert.ok(Math.abs(count - expected) < 4 * sigma,
      `bucket ${bucket} held ${count}, expected about ${expected}`);
  }
});

test('weighted picks respect their weights', () => {
  const rng = new Rng('weights');
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 30_000; i += 1) {
    counts[rng.weighted<'a' | 'b' | 'c'>([['a', 1], ['b', 3], ['c', 6]])] += 1;
  }
  assert.ok(Math.abs(counts.a / 30_000 - 0.1) < 0.02, `a: ${counts.a}`);
  assert.ok(Math.abs(counts.b / 30_000 - 0.3) < 0.02, `b: ${counts.b}`);
  assert.ok(Math.abs(counts.c / 30_000 - 0.6) < 0.02, `c: ${counts.c}`);
});

test('the seed hash separates the parts it is given', () => {
  // ('ab', 'c') and ('a', 'bc') must not hash the same, or two different fixtures
  // would share a stream.
  assert.notEqual(seedFrom('ab', 'c'), seedFrom('a', 'bc'));
  assert.notEqual(seedFrom('account', 1), seedFrom('account', 10));
  assert.equal(seedFrom('x', 1), seedFrom('x', 1));
});

// --- what the generator writes ---------------------------------------------------

/** The scale target guard is bypassed here: the test database is the right target. */
async function generate(accounts: number, seed = 'test-fixture-v1') {
  return generateDataset({ accounts, seed, chunkSize: 100, allowNonScaleDatabase: true });
}

test('nothing generated can be reached: every phone is 555 and every domain .invalid',
  async () => {
    await generate(120);

    const phones = await query<{ normalized_value: string }>(
      `select normalized_value from contact_endpoints where endpoint_type = 'PHONE'`);
    assert.ok(phones.rows.length > 0, 'no phone endpoints were generated');
    for (const row of phones.rows) {
      assert.match(row.normalized_value, /^\+1\d{3}555\d{4}$/,
        `${row.normalized_value} is not a 555 number`);
      assert.notEqual(row.normalized_value.slice(-4), String(RESERVED_LINE),
        'directory assistance must not be in the pool');
    }

    const domains = await query<{ hostname: string }>('select hostname from account_domains');
    for (const row of domains.rows) {
      assert.match(row.hostname, /\.invalid$/, `${row.hostname} could resolve`);
    }
    const emails = await query<{ normalized_value: string }>(
      `select normalized_value from contact_endpoints where endpoint_type = 'EMAIL'`);
    for (const row of emails.rows) {
      assert.match(row.normalized_value, /\.invalid$/, `${row.normalized_value} could receive mail`);
    }
    const users = await query<{ email: string }>('select email from users');
    for (const row of users.rows) {
      assert.match(row.email, /@fixture\.invalid$/);
    }
  });

test('the generator writes nothing that looks like outreach or spend', async () => {
  await generate(120);
  for (const table of ['contact_attempts', 'email_outbox', 'provider_usage',
                       'dnc_screen_log', 'channel_eligibility_decisions']) {
    const { rows } = await query<{ n: number }>(`select count(*)::int as n from ${table}`);
    assert.equal(rows[0]!.n, 0, `${table} has ${rows[0]!.n} rows after generation`);
  }
  // Calls exist as review fixtures, and every one is a dry run.
  const calls = await query<{ mode_at_start: string }>('select distinct mode_at_start from voice_calls');
  for (const row of calls.rows) {
    assert.equal(row.mode_at_start, 'DRY_RUN', 'a generated call claims a live mode');
  }
});

test('every generated row says it is synthetic', async () => {
  await generate(120);
  const provenance = await query<{ source_provider: string | null }>(
    'select distinct source_provider from evidence_records');
  for (const row of provenance.rows) {
    assert.equal(row.source_provider, SYNTHETIC_MARKER);
  }
  const identities = await query<{ provider: string }>('select distinct provider from source_identities');
  for (const row of identities.rows) {
    assert.equal(row.provider, SYNTHETIC_MARKER);
  }
  const contacts = await query<{ source_provider: string | null }>(
    'select distinct source_provider from contacts');
  for (const row of contacts.rows) {
    assert.equal(row.source_provider, SYNTHETIC_MARKER);
  }
});

test('the ledger matches what is actually in the database', async () => {
  const ledger = await generate(300);

  const actual = await query<{
    accounts: number; locations: number; contacts: number; endpoints: number;
    evidence: number; activities: number; followups: number; opportunities: number;
    meetings: number; enrollments: number; calls: number; hooks: number;
    suppressed: number; claimed: number;
  }>(
    `select (select count(*)::int from accounts) as accounts,
            (select count(*)::int from locations) as locations,
            (select count(*)::int from contacts) as contacts,
            (select count(*)::int from contact_endpoints) as endpoints,
            (select count(*)::int from evidence_records) as evidence,
            (select count(*)::int from activities) as activities,
            (select count(*)::int from follow_ups) as followups,
            (select count(*)::int from opportunities) as opportunities,
            (select count(*)::int from meeting_bookings) as meetings,
            (select count(*)::int from email_enrollments) as enrollments,
            (select count(*)::int from voice_calls) as calls,
            (select count(*)::int from hook_attempts) as hooks,
            (select count(*)::int from accounts where is_suppressed) as suppressed,
            (select count(*)::int from accounts where current_owner_user_id is not null) as claimed`);
  const row = actual.rows[0]!;

  assert.equal(row.accounts, ledger.accounts);
  assert.equal(row.locations, ledger.locations);
  assert.equal(row.contacts, ledger.contacts);
  assert.equal(row.endpoints, ledger.endpoints);
  assert.equal(row.evidence, ledger.evidenceRecords);
  assert.equal(row.activities, ledger.activities);
  assert.equal(row.followups, ledger.followUps);
  assert.equal(row.opportunities, ledger.opportunities);
  assert.equal(row.meetings, ledger.meetings);
  assert.equal(row.enrollments, ledger.emailEnrollments);
  assert.equal(row.calls, ledger.voiceCalls);
  assert.equal(row.hooks, ledger.hookAttempts);
  assert.equal(row.suppressed, ledger.dncAccounts,
    'the suppression trigger and the ledger disagree');
  // A claimed Account whose suppression arrived afterwards is unclaimed by the
  // trigger, so claimed is the ledger count less any that were suppressed.
  assert.ok(row.claimed <= ledger.claimedAccounts);
});

test('the same seed regenerates the same shape', async () => {
  const first = await generate(150, 'repeat-v1');
  await resetDatabase();
  const second = await generate(150, 'repeat-v1');

  for (const key of ['accounts', 'locations', 'contacts', 'endpoints', 'evidenceRecords',
                     'activities', 'followUps', 'opportunities', 'meetings',
                     'emailEnrollments', 'voiceCalls', 'hookAttempts', 'dncAccounts',
                     'duplicatePairs', 'sharedPhonePairs'] as const) {
    assert.equal(second[key], first[key], `${key} differed between two runs of one seed`);
  }
  assert.deepEqual(second.accountsByVertical, first.accountsByVertical);
  assert.deepEqual(second.accountsByTier, first.accountsByTier);
});

test('a different seed produces a different shape', async () => {
  const first = await generate(150, 'shape-a');
  await resetDatabase();
  const second = await generate(150, 'shape-b');
  // Not every count has to differ, but the whole shape must not be identical.
  const identical = ['contacts', 'endpoints', 'evidenceRecords', 'activities',
                     'opportunities', 'meetings'].every(
    (key) => (second as never as Record<string, number>)[key]
      === (first as never as Record<string, number>)[key]);
  assert.equal(identical, false, 'two seeds produced the same dataset');
});

test('the messy cases a dedupe test needs are actually present', async () => {
  const ledger = await generate(300);
  assert.ok(ledger.duplicatePairs >= 3, `only ${ledger.duplicatePairs} duplicate name pairs`);
  assert.ok(ledger.sharedPhonePairs >= 2, `only ${ledger.sharedPhonePairs} shared-phone pairs`);
  assert.ok(ledger.multiLocationAccounts > 10, `only ${ledger.multiLocationAccounts} multi-location`);
  assert.ok(ledger.rolePlaceholderContacts > 10, 'no role-only contacts');
  assert.ok(ledger.contradictedEvidence > 5, 'no contradicted evidence');
  assert.ok(ledger.staleEvidence > 20, 'no stale evidence');
  assert.ok(ledger.wrongNumberEndpoints > 2, 'no wrong numbers');
  assert.ok(ledger.staleEndpoints > 5, 'no stale endpoints');
  assert.ok(ledger.dncAccounts > 1, 'no DNC accounts');

  // Two businesses really do share a number.
  const shared = await query<{ n: number }>(
    `select count(*)::int as n from (
       select normalized_value from contact_endpoints
        where endpoint_type = 'PHONE'
        group by normalized_value having count(distinct account_id) > 1) t`);
  assert.ok(shared.rows[0]!.n >= 2, 'no number reaches two businesses');

  // And two companies really do normalise to the same name.
  const twins = await query<{ n: number }>(
    `select count(*)::int as n from (
       select normalized_name from accounts group by normalized_name having count(*) > 1) t`);
  assert.ok(twins.rows[0]!.n >= 3, 'no two companies normalise alike');
});

test('an endpoint display value is the same number as the value stored', async () => {
  await generate(200);
  const { rows } = await query<{ normalized_value: string; display_value: string }>(
    `select normalized_value, display_value from contact_endpoints where endpoint_type = 'PHONE'`);
  for (const row of rows) {
    assert.equal(row.display_value, formatPhone(row.normalized_value),
      `${row.display_value} is not how ${row.normalized_value} is written`);
  }
});

test('generated verticals and markets are real reference values', async () => {
  await generate(120);
  const verticals = await query<{ primary_vertical_profile_id: string }>(
    'select distinct primary_vertical_profile_id from accounts where primary_vertical_profile_id is not null');
  const known = new Set(VERTICALS.map((v) => v.id));
  for (const row of verticals.rows) {
    assert.ok(known.has(row.primary_vertical_profile_id),
      `${row.primary_vertical_profile_id} is not one of ours`);
  }
  const zips = await query<{ postal_code: string }>(
    'select distinct postal_code from locations where postal_code is not null');
  const knownZips = new Set(MARKETS.map((m) => m.postalCode));
  for (const row of zips.rows) {
    assert.ok(knownZips.has(row.postal_code), `${row.postal_code} is not a fixture market`);
  }
});

test('the dataset does not move with the wall clock', async () => {
  await generate(120);
  // Every generated timestamp is derived from a fixed origin, so a run tomorrow
  // produces the same relative shape. Nothing is dated after the origin except the
  // deliberately future-dated follow-ups and meetings.
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where created_at > $1`, [DATASET_ORIGIN]);
  assert.equal(rows[0]!.n, 0, 'an Account was created after the dataset origin');
});

test('name normalisation collapses the punctuation a rep would not notice', () => {
  const variants = [
    'Northgate Air & Heat LLC', 'northgate air & heat, llc', 'Northgate Air & Heat, LLC.',
    'NORTHGATE AIR & HEAT Inc',
  ];
  const normalized = new Set(variants.map(normalizeForCompare));
  assert.equal(normalized.size, 1, `these did not collapse: ${[...normalized].join(' | ')}`);
  assert.notEqual(normalizeForCompare('Northgate Air'), normalizeForCompare('Northgate Roofing'));
});
