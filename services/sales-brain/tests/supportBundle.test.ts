import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { supportBundle, renderSupportBundle } from '../src/release/supportBundle.js';
import { resetBuildIdentity } from '../src/release/identity.js';

/**
 * One file to hand over when something is wrong, safe to attach to an email.
 * Authority: Issue #3 V.
 *
 * Five reports already existed and an operator with a broken system should not have
 * to know which to run. But concatenating them was not the point: the first thing
 * anybody asks is "what was the error", and not one of the five carried error text.
 * They report counts, and a count cannot say that a provider rejected a credential
 * or that a page returned HTML where JSON was expected.
 *
 * Error text is also exactly where a secret leaks -- a database driver's exception
 * carries the connection string, a provider client puts the Authorization header in
 * its message. So most of this file is about what the bundle must not contain.
 */

const SECRETS = {
  DATAFORSEO_PASSWORD: 'bundle-secret-dataforseo',
  DATAFORSEO_LOGIN: 'bundle-login@example.invalid',
  ANTHROPIC_API_KEY: 'bundle-secret-anthropic',
  TWILIO_AUTH_TOKEN: 'bundle-secret-twilio',
  SESSION_SECRET: 'bundle-secret-session-value-long',
};

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  for (const key of Object.keys(SECRETS)) delete process.env[key];
  resetBuildIdentity();
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  for (const [key, value] of Object.entries(SECRETS)) process.env[key] = value;
});

async function failedJob(error: string): Promise<void> {
  await query(
    `insert into jobs (job_type, idempotency_key, payload, status, attempts,
                       last_error, outcome, completed_at)
     values ('market_mine', $1, '{}'::jsonb, 'FAILED', 3, $2, 'FAILED', now())`,
    [`bundle-${Math.random().toString(36).slice(2)}`, error]);
}

// ------------------------------------------------- what it must not contain -----

test('a credential in an error message does not reach the bundle', async () => {
  // The exact shapes that carry one: a connection string, an auth header, a
  // key=value pair, and the configured value itself appearing verbatim.
  await failedJob('connect ECONNREFUSED postgres://yad:supersecretpw@10.0.0.4:5432/yad');
  await failedJob('provider rejected request: Authorization: Basic '
    + 'ZGF0YWZvcnNlbzpzZWNyZXRwYXNzd29yZA==');
  await failedJob('config error: api_key=live_abc123def456 was not accepted');
  await failedJob(`login failed for ${SECRETS.DATAFORSEO_LOGIN} with password `
    + `${SECRETS.DATAFORSEO_PASSWORD}`);

  const bundle = await supportBundle();
  const text = JSON.stringify(bundle) + renderSupportBundle(bundle);

  for (const [key, value] of Object.entries(SECRETS)) {
    assert.ok(!text.includes(value), `the bundle carries the value of ${key}`);
  }
  for (const leak of ['supersecretpw', 'ZGF0YWZvcnNlbzpzZWNyZXRwYXNzd29yZA',
    'live_abc123def456']) {
    assert.ok(!text.includes(leak), `the bundle carries "${leak}" from an error message`);
  }
  // And the errors are still there, redacted rather than dropped -- an empty error
  // list would make the bundle useless for the thing it exists for.
  assert.equal(bundle.recentFailures.length, 4);
  assert.ok(bundle.recentFailures.some((failure) => /redacted/.test(failure.error ?? '')),
    'the error text was dropped rather than redacted, so support has nothing to read');
});

test('redaction does not blank the shell user out of every file path', async () => {
  // The counterweight to the rule above: a service-scoped login is redacted, but the
  // machine's own user name appears in every path an error quotes, and blanking it
  // would leave support reading `/home/[redacted]/...` in place of a stack trace.
  const osUser = process.env.USER ?? process.env.LOGNAME ?? 'roothecks';
  process.env.USER = osUser;
  await failedJob(`ENOENT: no such file '/home/${osUser}/AiDepartment/missing.yaml'`);

  const bundle = await supportBundle();
  const failure = bundle.recentFailures[0]!;
  assert.match(failure.error ?? '', new RegExp(`/home/${osUser}/AiDepartment`),
    'the path support needs to read was redacted away');
});

test('no company name, phone number or email address appears', async () => {
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Zzyzx Distinctive Roofing', website: 'https://zzyzxdistinct.invalid',
    phone: '904-555-7654', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));
  await query(
    `insert into contacts (account_id, full_name, role_category, status)
     select account_id, 'Dana Distinctive', 'owner', 'ACTIVE' from accounts limit 1`);

  const bundle = await supportBundle();
  const text = JSON.stringify(bundle) + renderSupportBundle(bundle);

  for (const identifying of ['Zzyzx', 'zzyzxdistinct', '904-555-7654',
    'Dana Distinctive']) {
    assert.ok(!text.includes(identifying),
      `the bundle carries "${identifying}", so a file sent by email carries prospects`);
  }
  // The counts are there, which is what a support reader needs.
  assert.ok(bundle.tableCounts.some(
    (entry) => entry.table === 'accounts' && entry.rows > 0));
});

test('no page content reaches the bundle', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Content Co', website: 'https://contentco.invalid', phone: null,
    city: 'St. Augustine', state: 'FL', postalCode: '32095', verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, expires_at, freshness)
     values ($1, 'urgency', 'emergency_24_7_service',
             'DISTINCTIVE PAGE SENTENCE about 24/7 cover', 'yes', 'confirmed', true,
             'first_party', now() + interval '30 days', 'fresh')`, [accountId]);

  const bundle = await supportBundle();
  const text = JSON.stringify(bundle) + renderSupportBundle(bundle);
  assert.ok(!text.includes('DISTINCTIVE PAGE SENTENCE'),
    'a sentence quoted from a company website reached the support bundle');
});

test('the promise printed at the end is one the bundle keeps', async () => {
  const bundle = await supportBundle();
  const rendered = renderSupportBundle(bundle);
  assert.match(rendered, /No credentials, company names, phone numbers/);
  // A claim in a report is only worth what the tests above make it worth, so this
  // asserts the claim is present rather than treating it as evidence.
  assert.match(rendered, /It is about the machine/);
});

// -------------------------------------------------------- what it does carry ----

test('the bundle answers the first three questions support asks', async () => {
  await failedJob('the provider did not answer: HTTP 503');
  const bundle = await supportBundle();

  // What is running.
  assert.ok(bundle.manifest.build.sha.length > 0);
  assert.equal(bundle.manifest.build.migrationsApplied,
    bundle.manifest.build.migrationsShipped);
  // What state it is in.
  assert.ok(bundle.diagnoses.length > 0);
  // What broke.
  assert.ok(bundle.recentFailures.some((failure) => /503/.test(failure.error ?? '')),
    'the failure that would be reported is not in the bundle');
});

test('provider errors are counted by code, never by body', async () => {
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at, units,
                                 estimated_cost_usd, status, error_code)
     values ('dataforseo', 'serp.discover', now(), now(), 1, 0, 'FAILED', 'HTTP_401'),
            ('dataforseo', 'serp.discover', now(), now(), 1, 0, 'FAILED', 'HTTP_401'),
            ('dataforseo', 'serp.discover', now(), now(), 1, 0, 'FAILED', 'RATE_LIMITED')`);

  const bundle = await supportBundle();
  const codes = bundle.providerErrors.map((entry) => `${entry.errorCode}:${entry.n}`);
  assert.ok(codes.includes('HTTP_401:2'), codes.join(', '));
  assert.ok(codes.includes('RATE_LIMITED:1'));
  // A 401 twice is the single most useful line in a support bundle: it says the
  // credential is wrong rather than the market being empty.
  assert.match(renderSupportBundle(bundle), /dataforseo HTTP_401: 2/);
});

test('a table this build expects and the database lacks is reported, not skipped', async () => {
  // The shape of a partial migration. A missing table that silently produced no row
  // would leave a support reader comparing counts that are not there.
  //
  // Hidden by renaming rather than dropping: the test database is shared by every
  // file in the suite, and a dropped table outlives this process. A rename is
  // reversible in a finally, and it keeps the rows, indexes and constraints.
  await query('alter table duplicate_reviews rename to duplicate_reviews_hidden');
  try {
    const bundle = await supportBundle();
    const entry = bundle.tableCounts.find((row) => row.table === 'duplicate_reviews')!;
    assert.equal(entry.rows, -1);
    assert.match(renderSupportBundle(bundle),
      /MISSING — this build and this database disagree/);
  } finally {
    await query('alter table duplicate_reviews_hidden rename to duplicate_reviews');
  }
  // Proof the rename came back, so the next file in the suite starts from a whole
  // schema. Without this the failure would land somewhere else and look unrelated.
  const restored = await supportBundle();
  assert.equal(restored.tableCounts.find((row) => row.table === 'duplicate_reviews')!.rows, 0);
});

test('the bundle only reads', async () => {
  const before = await query<{ n: number }>(
    `select (select count(*) from accounts) + (select count(*) from jobs)
            + (select count(*) from retention_runs) as n`);
  await supportBundle();
  const after = await query<{ n: number }>(
    `select (select count(*) from accounts) + (select count(*) from jobs)
            + (select count(*) from retention_runs) as n`);
  assert.equal(Number(after.rows[0]!.n), Number(before.rows[0]!.n),
    'generating a support bundle changed the system it describes');
});
