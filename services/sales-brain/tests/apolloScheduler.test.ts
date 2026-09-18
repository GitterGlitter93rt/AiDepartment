import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { sweepApolloDue, setApolloAdapter } from '../src/workers/apolloEnrichment.js';
import { nextCheckAfter, judgeApolloEligibility } from '../src/providers/apollo/eligibility.js';
import { beginApolloRequest, apolloFingerprint } from '../src/providers/apollo/ledger.js';
import type { ApolloAdapter } from '../src/providers/apollo/types.js';

/**
 * The periodic re-check, proved without waiting ninety days.
 *
 * Michael's requirement is that Sales Brain looks at Apollo again after its own research,
 * durably, and that a daily sweep is not a daily bill. Both halves are testable by moving
 * `next_check_at` rather than moving the clock: the schedule is a column, which is the
 * whole reason it survives a deployment.
 */

const ENV = { ...process.env };
after(async () => { Object.assign(process.env, ENV); setApolloAdapter(null); await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  process.env['APOLLO_ENABLED'] = 'true';
  setApolloAdapter(null);
});

let phoneSeed = 100;

async function account(name: string, domain: string): Promise<string> {
  // A distinct number each time. Sharing one made entity resolution correctly merge
  // three fixtures into one Account, and the sweep then had one row to find rather
  // than three -- a fixture bug that read exactly like a scheduler bug.
  phoneSeed += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name, website: `https://${domain}`,
    phone: `813-555-0${String(phoneSeed).padStart(3, '0')}`,
    verticalProfileId: 'hvac',
  } as never, { discoverySource: 'import' }));
  await query(`update accounts set entity_status = 'verified' where account_id = $1`, [accountId]);
  return accountId;
}

async function setState(accountId: string, patch: {
  status?: string; nextCheckAt?: Date | null; lastResult?: string | null;
}): Promise<void> {
  await query(
    `insert into apollo_account_state (account_id, status, next_check_at, last_result)
     values ($1, coalesce($2,'APOLLO_ELIGIBLE'), $3, $4)
     on conflict (account_id) do update set
       status = excluded.status, next_check_at = excluded.next_check_at,
       last_result = excluded.last_result`,
    [accountId, patch.status ?? null, patch.nextCheckAt ?? null, patch.lastResult ?? null]);
}

async function queuedFor(accountId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from jobs
      where job_type = 'apollo_enrichment' and account_id = $1
        and status in ('QUEUED','RUNNING')`, [accountId]);
  return Number(rows[0]!.n);
}

/* ------------------------------------------------------------------- cadence --- */

test('each outcome comes round again when it should', () => {
  const now = new Date('2026-09-18T00:00:00Z');
  const days = (d: Date): number => Math.round((d.getTime() - now.getTime()) / 86_400_000);

  // A company with nobody named at it, and one with a name but no way to reach them.
  // Both are the gap Apollo exists to close, and both are worth asking about monthly.
  assert.equal(days(nextCheckAfter({ result: 'MATCHED', now })), 30);
  assert.equal(days(nextCheckAfter({ result: 'ENRICHED', now })), 30);

  // Apollo has never heard of them. Asking monthly would buy the same silence.
  assert.equal(days(nextCheckAfter({ result: 'NO_MATCH', consecutiveNoMatch: 1, now })), 60);

  // A complete Account is re-checked for drift, not for discovery.
  assert.equal(days(nextCheckAfter({ result: 'COMPLETE', now })), 90);

  // Our outage is not their answer, so it is retried tomorrow.
  assert.equal(days(nextCheckAfter({ result: 'ERROR', now })), 1);

  // A repeated silence backs off, bounded so nothing falls off the schedule for ever.
  const second = days(nextCheckAfter({ result: 'NO_MATCH', consecutiveNoMatch: 2, now }));
  const third = days(nextCheckAfter({ result: 'NO_MATCH', consecutiveNoMatch: 3, now }));
  assert.ok(second > 60 && third >= second, `backoff 60 -> ${second} -> ${third}`);
  assert.ok(third <= 60 * 4, 'and it is bounded');
});

test('a changed organisation identity does not wait for its turn', () => {
  const soon = new Date(Date.now() + 20 * 86_400_000);
  const base = {
    accountId: 'a', companyName: 'ABC Air', entityStatus: 'verified', isSuppressed: false,
    hasValidDecisionMaker: false, nextCheckAt: soon,
  };
  assert.equal(judgeApolloEligibility({ ...base, canonicalDomain: 'abcair.example-co',
    previousFingerprint: 'abcair.example-co|abc air',
    currentFingerprint: 'abcair.example-co|abc air' }).verdict,
    'NOT_ELIGIBLE_RECENTLY_CHECKED');

  // A different canonical domain is a different organisation to a people graph, so the
  // previous answer is about a company we are no longer asking about.
  assert.equal(judgeApolloEligibility({ ...base, canonicalDomain: 'newname.example-co',
    previousFingerprint: 'abcair.example-co|abc air',
    currentFingerprint: 'newname.example-co|abc air' }).verdict,
    'ELIGIBLE_IDENTITY_CHANGED');
});

/* -------------------------------------------------------------------- sweeping --- */

test('the sweep queues only the Accounts that are due', async () => {
  const due = await account('Due Air', 'dueair.example-co');
  const notDue = await account('Not Due Air', 'notdueair.example-co');
  const never = await account('Never Air', 'neverair.example-co');

  await setState(due, { nextCheckAt: new Date(Date.now() - 60_000) });
  await setState(notDue, { nextCheckAt: new Date(Date.now() + 30 * 86_400_000) });
  // `never` has no state row at all, which is how a new Account looks.

  const result = await sweepApolloDue();
  assert.equal(await queuedFor(due), 1, 'the due Account was queued');
  assert.equal(await queuedFor(notDue), 0, 'the Account that is not due was left alone');
  assert.equal(await queuedFor(never), 1, 'an Account never checked is due by definition');
  assert.equal(result.queued, 2);
});

test('a second sweep does not queue the same Account twice', async () => {
  const id = await account('Twice Air', 'twiceair.example-co');
  await setState(id, { nextCheckAt: new Date(Date.now() - 60_000) });

  await sweepApolloDue();
  await sweepApolloDue();
  assert.equal(await queuedFor(id), 1,
    'a daily sweep must not become a daily bill for the same Account');

  // Two sweeps racing produce one job between them.
  await query(`delete from jobs where job_type = 'apollo_enrichment'`);
  await Promise.all([sweepApolloDue(), sweepApolloDue()]);
  assert.equal(await queuedFor(id), 1);
});

test('a suppressed or unverified Account is never swept in', async () => {
  const suppressed = await account('Suppressed Air', 'suppressedair.example-co');
  const legacy = await account('Legacy Air', 'legacyair.example-co');
  await query(`update accounts set is_suppressed = true where account_id = $1`, [suppressed]);
  await query(`update accounts set entity_status = 'legacy_unverified' where account_id = $1`,
    [legacy]);

  await sweepApolloDue();
  assert.equal(await queuedFor(suppressed), 0);
  assert.equal(await queuedFor(legacy), 0);
});

test('a key without permission stops that Account being swept for ever', async () => {
  const id = await account('Forbidden Air', 'forbiddenair.example-co');
  await setState(id, { status: 'APOLLO_PERMISSION_ERROR',
    nextCheckAt: new Date(Date.now() - 60_000) });
  await sweepApolloDue();
  assert.equal(await queuedFor(id), 0,
    'a permission problem is ours to fix, not something to retry hourly against Apollo');
});

test('the sweep does nothing at all while Apollo is switched off', async () => {
  const id = await account('Off Air', 'offair.example-co');
  await setState(id, { nextCheckAt: new Date(Date.now() - 60_000) });
  process.env['APOLLO_ENABLED'] = 'false';
  const result = await sweepApolloDue();
  assert.deepEqual(result, { queued: 0, due: 0 });
  assert.equal(await queuedFor(id), 0);
});

/* --------------------------------------------------- no duplicate paid work --- */

test('a worker restart mid-enrichment does not buy the answer twice', async () => {
  const id = await account('Restart Air', 'restartair.example-co');
  const key = apolloFingerprint({
    accountId: id, canonicalDomain: 'restartair.example-co', apolloPersonId: 'p_1',
    operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL', fields: ['email'] });

  // The worker claimed the work and then died before settling it.
  const first = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.ok(first.apolloRequestId);

  // It comes back and tries again. The claim is a row, so it is still held.
  const afterRestart = await beginApolloRequest({ accountId: id, operation: 'PEOPLE_MATCH',
    mode: 'ENRICH_EMAIL', idempotencyKey: key, inputFingerprint: 'f' });
  assert.equal(afterRestart.apolloRequestId, null);
  assert.equal(afterRestart.existing?.result, 'IN_FLIGHT');

  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from apollo_requests where idempotency_key = $1`, [key]);
  assert.equal(Number(rows[0]!.n), 1, 'one paid question, one row, whatever the worker did');
});

test('a sweep never calls the provider for an Account that is not eligible', async () => {
  // The sweep queues; the handler decides. An Account that became complete between the
  // two is simply not eligible when its day arrives, and no request is made.
  let calls = 0;
  const fake: ApolloAdapter = {
    name: 'fake', isConfigured: () => true,
    searchPeople: async () => { calls += 1; throw new Error('should not be called'); },
    enrichPerson: async () => { calls += 1; throw new Error('should not be called'); },
    enrichPeopleBulk: async () => { calls += 1; throw new Error('should not be called'); },
    enrichOrganization: async () => { calls += 1; throw new Error('should not be called'); },
    usageStats: async () => { calls += 1; throw new Error('should not be called'); },
  };
  setApolloAdapter(fake);

  const id = await account('Complete Air', 'completeair.example-co');
  await setState(id, { nextCheckAt: new Date(Date.now() - 60_000) });
  await sweepApolloDue();

  const { drainQueue } = await import('../src/workers/runner.js');
  await import('../src/workers/apolloEnrichment.js');
  await query(
    `insert into contacts (account_id, full_name, raw_title, role_category, currentness)
     values ($1, 'Jane Owner', 'Owner', 'owner', 'FRESH')`, [id]);
  const contact = await query<{ contact_id: string }>(
    `select contact_id from contacts where account_id = $1`, [id]);
  await query(
    `insert into contact_endpoints
       (account_id, contact_id, endpoint_type, endpoint_role, normalized_value,
        display_value, is_active)
     values ($1, $2, 'EMAIL', 'DIRECT_PERSON_EMAIL', 'jane@completeair.example-co',
             'jane@completeair.example-co', true)`, [id, contact.rows[0]!.contact_id]);

  await drainQueue(5);
  assert.equal(calls, 0,
    'a complete Account costs nothing, because eligibility is checked before the provider');
});
