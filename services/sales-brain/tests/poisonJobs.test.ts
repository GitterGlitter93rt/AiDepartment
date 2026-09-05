import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue, registerHandler } from '../src/workers/runner.js';
import { redactSecrets, terminalFailureReason } from '../src/workers/redaction.js';
import '../src/workers/marketMiner.js';
import '../src/workers/contactResearch.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch, enqueueAccountResearch } from '../src/workers/enqueue.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Jobs that will never succeed.
 * Authority: Issue #3 Phase O.
 *
 * A single malformed row or a broken company must not jam a worker that is supposed
 * to run all night. What matters is that attempts are bounded, the terminal state
 * says something an operator can act on, the queue behind it keeps moving, and
 * nothing in the failure text is a credential.
 */

let app: FastifyInstance;
let manager: Awaited<ReturnType<typeof makeUser>>;
const PASSWORD = 'poison-password';
let sequence = 0;

before(async () => { app = await buildServer(); await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Poison Manager', 'SALES_MANAGER');
});

// ---------------------------------------------------------------- redaction --

test('a credential in an error message never becomes a database row', () => {
  const env = {
    DATAFORSEO_PASSWORD: 'super-secret-provider-password',
    DATABASE_URL: 'postgres://yad:hunter2hunter2@localhost:5432/yad',
  } as unknown as NodeJS.ProcessEnv;

  const leaked = 'request failed: super-secret-provider-password rejected';
  assert.equal(redactSecrets(leaked, env).includes('super-secret-provider-password'), false);
  assert.match(redactSecrets(leaked, env), /\[redacted\]/);

  // The connection string's password on its own, which is what a driver quotes.
  assert.equal(
    redactSecrets('auth failed for hunter2hunter2', env).includes('hunter2hunter2'), false);
});

test('credential shapes are redacted even when nothing is configured', () => {
  const env = {} as unknown as NodeJS.ProcessEnv;
  const cases = [
    'Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l',
    'sent Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'connect failed postgres://yad:hunter2@db:5432/yad',
    'called https://api.example.com/serp?api_key=abcd1234efgh',
    'config was password=correcthorsebattery',
  ];
  for (const text of cases) {
    const cleaned = redactSecrets(text, env);
    assert.match(cleaned, /\[redacted\]/, text);
    assert.equal(/YWxhZGRpbjpvcGVuc2VzYW1l|eyJhbGciOiJ|hunter2|abcd1234efgh|correcthorsebattery/
      .test(cleaned), false, `${text} -> ${cleaned}`);
  }
});

test('ordinary failure text survives redaction intact', () => {
  const env = {} as unknown as NodeJS.ProcessEnv;
  const message = 'the provider returned HTTP 503 after 3 attempts';
  assert.equal(redactSecrets(message, env), message,
    'redaction that eats normal errors makes the page useless');
});

test('a terminal reason tells an operator what it means for the work', () => {
  const market = terminalFailureReason('market_mine', 'provider exploded');
  assert.match(market, /will not be retried automatically/);
  assert.match(market, /Nothing about the market has been learned/);

  const research = terminalFailureReason('account_research', 'page unreadable');
  assert.match(research, /still in inventory/);
  assert.match(research, /by hand/);
});

// ------------------------------------------------------------- poison shapes --

async function runPoison(jobType: string, payload: Record<string, unknown> = {}): Promise<{
  status: string; attempts: number; last_error: string | null; outcome_reason: string | null;
}> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload, max_attempts)
     values ($1, 'QUEUED', $2::jsonb, 3) returning job_id`,
    [jobType, JSON.stringify(payload)]);

  // Run it to exhaustion, bringing each backoff forward as time would.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await drainQueue(5);
    await query(`update jobs set run_after = now() - interval '1 hour' where job_id = $1`,
      [rows[0]!.job_id]);
  }

  const { rows: final } = await query<{
    status: string; attempts: number; last_error: string | null; outcome_reason: string | null;
  }>('select status, attempts, last_error, outcome_reason from jobs where job_id = $1',
    [rows[0]!.job_id]);
  return final[0]!;
}

test('a job with no handler fails once, the same way on every path', async () => {
  // Two code paths handled this and handled it differently: the worker loop named
  // the job type, drainQueue wrote the words "no handler", and neither set an
  // outcome -- so the Mining page showed the fallback pill instead of a failure.
  const result = await runPoison('a_job_type_nobody_registered');
  assert.equal(result.status, 'FAILED');
  assert.match(result.last_error ?? '', /No handler registered/);
  assert.match(result.outcome_reason ?? '', /older build/,
    'the usual cause is not named, so an operator has to guess');

  const { rows } = await query<{ outcome: string }>(
    `select outcome from jobs where job_type = 'a_job_type_nobody_registered'`);
  assert.equal(rows[0]!.outcome, 'FAILED', 'a failure with no outcome renders as "Ran"');
});

test('research for an account that no longer exists ends terminally', async () => {
  const result = await runPoison('account_research', {
    account_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(result.status, 'FAILED');
  assert.ok(result.attempts <= 3, `it tried ${result.attempts} times`);
  assert.match(result.outcome_reason ?? '', /will not be retried automatically/);
});

test('a malformed payload fails with a reason rather than looping', async () => {
  const result = await runPoison('account_research', { account_id: '' });
  assert.equal(result.status, 'FAILED');
  assert.match(result.last_error ?? '', /account_id/);
  assert.match(result.outcome_reason ?? '', /still in inventory/);
});

test('a deterministically failing job stops after its attempts are spent', async () => {
  let calls = 0;
  registerHandler('poison_always_fails', async () => {
    calls += 1;
    throw new Error('this will never work');
  });

  const result = await runPoison('poison_always_fails');
  assert.equal(result.status, 'FAILED');
  assert.equal(result.attempts, 3, `it ran ${result.attempts} times`);
  assert.equal(calls, 3, `the handler ran ${calls} times`);
});

test('a poison job does not stop the queue behind it', async () => {
  let good = 0;
  registerHandler('poison_blocker', async () => { throw new Error('nope'); });
  registerHandler('poison_good', async () => { good += 1; return { outcome: 'COMPLETED' as const }; });

  await query(
    `insert into jobs (job_type, status, payload, max_attempts, priority)
     values ('poison_blocker', 'QUEUED', '{}'::jsonb, 3, 1)`);
  for (let index = 0; index < 4; index += 1) {
    await query(
      `insert into jobs (job_type, status, payload, priority)
       values ('poison_good', 'QUEUED', '{}'::jsonb, 50)`);
  }

  await drainQueue(20);
  assert.equal(good, 4, 'one job that could not succeed held up the ones that could');
});

test('a provider that always fails does not fail the job for ever', async () => {
  registerDiscoveryAdapter({
    name: 'always-down', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, reason: 'the provider is down',
      };
    },
  });

  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(5);

  const { rows } = await query<{ status: string; outcome: string; attempts: number }>(
    'select status, outcome, attempts from jobs where job_id = $1', [job.jobId]);
  // An adapter that reports its failure is not an exception: the job succeeded at
  // running, and the outcome carries the truth. Retrying it would spend money.
  assert.equal(rows[0]!.status, 'SUCCEEDED');
  assert.equal(rows[0]!.outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(rows[0]!.attempts, 1, 'a reported provider outage was retried');
});

test('an adapter that throws is contained rather than failing the whole job', async () => {
  registerDiscoveryAdapter({
    name: 'throws', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> { throw new Error('adapter bug'); },
  });

  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(5);

  const { rows } = await query<{ status: string; outcome: string }>(
    'select status, outcome from jobs where job_id = $1', [job.jobId]);
  assert.equal(rows[0]!.status, 'SUCCEEDED');
  assert.equal(rows[0]!.outcome, 'PROVIDER_UNAVAILABLE',
    'a bug in one adapter took down the whole market search');
});

// ------------------------------------------------- what the operator can see --

test('a failure on the Mining page carries no credential', async () => {
  const marker = 'sk-live-poison-marker-value';
  process.env['DATAFORSEO_PASSWORD'] = marker;
  try {
    registerHandler('poison_leaks', async () => {
      throw new Error(`provider rejected credential ${marker} at Basic ${marker}`);
    });
    await runPoison('poison_leaks');

    const { rows } = await query<{ last_error: string; outcome_reason: string }>(
      `select last_error, outcome_reason from jobs where job_type = 'poison_leaks'`);
    assert.equal(rows[0]!.last_error.includes(marker), false,
      'the credential is in the database');
    assert.equal(rows[0]!.outcome_reason.includes(marker), false);

    await createUser({
      email: 'poison.ops@test.local', displayName: 'Poison Ops', role: 'RESEARCH_OPS',
      password: PASSWORD });
    const login = await app.inject({
      method: 'POST', url: '/login',
      payload: { email: 'poison.ops@test.local', password: PASSWORD } });
    const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
    const page = await app.inject({
      method: 'GET', url: '/mining',
      headers: { cookie: `yad_sales_session=${cookie.value}` } });

    assert.equal(page.statusCode, 200);
    assert.equal(page.body.includes(marker), false,
      'the Mining page rendered a credential from a job error');
  } finally {
    delete process.env['DATAFORSEO_PASSWORD'];
  }
});

test('a manual retry of a terminally failed job is possible', async () => {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Retryable Co',
    website: `https://poison${sequence}.invalid`,
    phone: `904-555-${String(9800 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'market_miner:dataforseo' }));

  await query(
    `insert into jobs (job_type, account_id, status, payload, completed_at, attempts, max_attempts)
     values ('account_research', $1, 'FAILED', '{}'::jsonb, now(), 3, 3)`, [accountId]);

  // Terminal is terminal for the automatic path only.
  const manual = await enqueueAccountResearch(accountId, manager.userId, 'human_requested');
  assert.equal(manual.created, true, 'an operator could not retry a failed job');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs
      where account_id = $1 and status = 'QUEUED'`, [accountId]);
  assert.equal(rows[0]!.n, 1);
});
