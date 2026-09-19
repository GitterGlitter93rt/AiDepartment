import { pool, query, withTransaction, type Queryable } from '../db/pool.js';
import { resolveAccountId } from '../domain/merge.js';
import { config } from '../config.js';
import { collisionKeys, allocatePoolNumber, type PoolNumberState, type AllocationOutcome } from './collision.js';
import { newProbeToken, planAlias } from './identity.js';
import { assertTransition, OPEN_STATUSES, AWAITING_RESPONSE_STATUSES, type ProbeStatus } from './states.js';
import type { EligibilityVerdict } from './forms.js';
import type { OpenProbeCandidate } from './attribution.js';

/**
 * Reading and writing the probe ledger.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §5, §6, §12.4, §14.
 *
 * Every write goes through a transaction that also writes a state event, because a
 * probe's path is evidence: "it says NO_RESPONSE_FINAL now" is not the same claim as
 * "it was submitted, acknowledged in four seconds, and nothing else ever arrived".
 *
 * Nothing here creates a company. `account_id` references `accounts`, resolves
 * through `resolveAccountId` so a merge cannot orphan a probe, and the snapshot
 * columns exist only so a later rename cannot rewrite what attribution was based on.
 */

/** Roles that are the company's own published lines. */
const MAIN_ROLES = [
  'MAIN_BUSINESS_LINE', 'DIRECT_BUSINESS_LINE', 'LOCATION_BUSINESS_LINE',
  'MOBILE_ASSERTED_BUSINESS',
];

/**
 * Roles that may reach a shared system.
 *
 * Toll-free and call-tracking numbers are exactly the ones a franchise or an
 * answering service puts in front of several locations, which is why a match on one
 * of them caps at MEDIUM.
 */
const ALTERNATE_ROLES = [
  'TOLL_FREE_BUSINESS', 'CALL_TRACKING_NUMBER', 'MOBILE_UNKNOWN_USE', 'UNKNOWN_PHONE_TYPE',
];

export interface AccountSnapshot {
  accountId: string;
  name: string | null;
  domain: string | null;
  verticalProfileId: string | null;
  phones: string[];
  alternatePhones: string[];
  /** False when any alternate number is also held by another Account. */
  alternatesAreExclusive: boolean;
  parentAccountId: string | null;
}

export async function snapshotAccount(accountId: string): Promise<AccountSnapshot | null> {
  const resolved = await resolveAccountId(pool, accountId);
  if (!resolved) return null;

  const { rows: accountRows } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
    primary_vertical_profile_id: string | null; parent_account_id: string | null;
  }>(
    `select account_id, canonical_name, canonical_domain, primary_vertical_profile_id,
            parent_account_id
       from accounts where account_id = $1`, [resolved]);
  const account = accountRows[0];
  if (!account) return null;

  const { rows: endpoints } = await query<{
    normalized_value: string; endpoint_role: string; shared_with_others: boolean;
  }>(
    `select e.normalized_value, e.endpoint_role,
            exists (select 1 from contact_endpoints o
                     where o.endpoint_type = 'PHONE'
                       and o.normalized_value = e.normalized_value
                       and o.account_id <> e.account_id) as shared_with_others
       from contact_endpoints e
      where e.account_id = $1 and e.endpoint_type = 'PHONE'
      order by e.endpoint_role, e.normalized_value`, [resolved]);

  const phones = [...new Set(endpoints
    .filter((row) => MAIN_ROLES.includes(row.endpoint_role))
    .map((row) => row.normalized_value))];
  const alternates = endpoints.filter((row) => ALTERNATE_ROLES.includes(row.endpoint_role));
  const alternatePhones = [...new Set(alternates.map((row) => row.normalized_value))];

  return {
    accountId: resolved,
    name: account.canonical_name,
    domain: account.canonical_domain,
    verticalProfileId: account.primary_vertical_profile_id,
    phones,
    alternatePhones,
    // Derived, not asserted: a toll-free number this Account shares with another is
    // not exclusive whatever anybody labelled it.
    alternatesAreExclusive: alternates.every((row) => !row.shared_with_others),
    parentAccountId: account.parent_account_id,
  };
}

export type PlanRefusal =
  | 'ALREADY_OPEN'
  | 'IN_COOLDOWN'
  | 'PROBE_SUPPRESSED'
  | 'ACCOUNT_SUPPRESSED'
  | 'ACCOUNT_MISSING'
  | 'FORM_INELIGIBLE'
  | 'KILL_SWITCH';

export interface PlanResult {
  planned: boolean;
  probeId: string | null;
  refusal: PlanRefusal | null;
  detail: string;
}

/**
 * Whether this Account may be probed at all, before a form is even considered.
 *
 * Order matters only in what gets reported first; every check is independent. The
 * suppression checks come before cooldown because "do not audit us" is a standing
 * instruction and reporting a cooldown instead would suggest it expires.
 */
export async function probeEligibilityForAccount(
  accountId: string, now: Date,
): Promise<{ ok: boolean; refusal: PlanRefusal | null; detail: string }> {
  if (config.probe.killSwitch) {
    return { ok: false, refusal: 'KILL_SWITCH', detail: 'The probe kill switch is on.' };
  }

  const { rows } = await query<{
    probe_audit_suppressed: boolean; dnc_suppressed: boolean;
    open_probe_id: string | null; cooldown_until: Date | null;
  }>(
    `select
       exists (select 1 from suppressions s
                where s.account_id = $1 and s.is_active
                  and s.suppression_type = 'PROBE_AUDIT') as probe_audit_suppressed,
       -- Any active suppression, not an allow-list of three types.
       --
       -- A probe is an inbound-inducing action: it asks a company to contact us.
       -- Doing that to somebody who has asked us to stop contacting them is a
       -- workaround, whatever the suppression was filed under -- and an
       -- OTHER_APPROVED row is exactly the "we are not sure what they meant" case
       -- that Decision 9 says must fail closed. An allow-list let it through.
       exists (select 1 from suppressions s
                where s.account_id = $1 and s.is_active
                  and s.scope in ('ACCOUNT','CONTACT')
                  and s.suppression_type <> 'PROBE_AUDIT'
                  and (s.expires_at is null or s.expires_at > $2::timestamptz)) as dnc_suppressed,
       (select p.probe_id from lead_response_probes p
         where p.account_id = $1 and p.status = any($3::text[]) limit 1) as open_probe_id,
       (select max(p.cooldown_until) from lead_response_probes p
         where p.account_id = $1) as cooldown_until`,
    [accountId, now, OPEN_STATUSES as unknown as string[]]);
  const state = rows[0]!;

  if (state.probe_audit_suppressed) {
    return {
      ok: false, refusal: 'PROBE_SUPPRESSED',
      detail: 'This company asked not to be audited again. Permanent, and separate '
        + 'from ordinary outreach suppression.',
    };
  }
  if (state.dnc_suppressed) {
    return {
      ok: false, refusal: 'ACCOUNT_SUPPRESSED',
      detail: 'The Account carries an active suppression. We do not measure the '
        + 'response time of a company we may not contact, and we do not induce a '
        + 'company that asked us to stop to contact us instead.',
    };
  }
  if (state.open_probe_id) {
    return {
      ok: false, refusal: 'ALREADY_OPEN',
      detail: `Probe ${state.open_probe_id} is already open for this Account.`,
    };
  }
  if (state.cooldown_until && state.cooldown_until > now) {
    return {
      ok: false, refusal: 'IN_COOLDOWN',
      detail: `Cooled down until ${state.cooldown_until.toISOString()}. A re-probe `
        + 'inside cooldown is refused, not queued.',
    };
  }
  return { ok: true, refusal: null, detail: 'Eligible to plan.' };
}

export interface PlanProbeInput {
  accountId: string;
  eligibility: EligibilityVerdict;
  targetFormUrl: string | null;
  geographyType?: string | null;
  geographyValue?: string | null;
  discoveryObservationId?: string | null;
  paidAdEvidenceIds?: readonly string[];
  identityId: string | null;
  now: Date;
  executionMode?: 'DRY_RUN' | 'LIVE';
}

/**
 * Create a probe in PLANNED.
 *
 * A form that is ineligible still produces a row, in FAILED with its reason. That is
 * deliberate: "we looked at this company's form and could not probe it" is worth
 * knowing, it is what the operator packet counts, and it is emphatically not
 * evidence about the company.
 */
export async function planProbe(input: PlanProbeInput): Promise<PlanResult> {
  const snapshot = await snapshotAccount(input.accountId);
  if (!snapshot) {
    return { planned: false, probeId: null, refusal: 'ACCOUNT_MISSING',
      detail: 'No live Account for this id.' };
  }

  const gate = await probeEligibilityForAccount(snapshot.accountId, input.now);
  if (!gate.ok) {
    return { planned: false, probeId: null, refusal: gate.refusal, detail: gate.detail };
  }

  const keys = collisionKeys({
    phones: snapshot.phones,
    alternatePhones: snapshot.alternatePhones,
    corporateParentId: snapshot.parentAccountId,
    domain: snapshot.domain,
  });
  const token = newProbeToken();
  const alias = planAlias({
    token,
    aliasDomain: config.probe.aliasDomain,
    plusAddressingAllowed: input.eligibility.plusAddressingAllowed,
  });

  const status: ProbeStatus = input.eligibility.eligible ? 'PLANNED' : 'FAILED';
  const cooldownUntil = new Date(
    input.now.getTime() + config.probe.cooldownDays * 24 * 3_600_000);

  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query<{ probe_id: string }>(
        `insert into lead_response_probes (
           account_id, geography_type, geography_value, vertical_profile_id,
           discovery_observation_id, paid_ad_evidence_ids, target_form_url,
           submitted_identity_id, probe_token, submitted_email_alias,
           consent_checkboxes_presented,
           account_name_at_submission, account_domain_at_submission,
           account_phones_at_submission, account_alternate_phones_at_submission,
           collision_keys, status, ineligible_reason, cooldown_until, execution_mode
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         returning probe_id`,
        [
          snapshot.accountId, input.geographyType ?? null, input.geographyValue ?? null,
          snapshot.verticalProfileId, input.discoveryObservationId ?? null,
          input.paidAdEvidenceIds ?? [], input.targetFormUrl,
          input.identityId, token, alias.address,
          JSON.stringify(input.eligibility.checkboxesPresented),
          snapshot.name, snapshot.domain, snapshot.phones, snapshot.alternatePhones,
          keys, status, input.eligibility.reason,
          // An ineligible probe still occupies its cooldown: re-examining the same
          // form nightly is the repetition the cooldown exists to stop.
          cooldownUntil, input.executionMode ?? 'DRY_RUN',
        ]);
      const probeId = rows[0]!.probe_id;
      await recordStateEvent(client, {
        probeId, from: null, to: status,
        reason: input.eligibility.eligible ? 'planned' : input.eligibility.detail,
        actor: 'planner',
      });
      return {
        planned: input.eligibility.eligible, probeId,
        refusal: input.eligibility.eligible ? null : 'FORM_INELIGIBLE',
        detail: input.eligibility.detail,
      };
    });
  } catch (error) {
    // The unique partial index is the real guard; this is the race it catches.
    if ((error as { code?: string }).code === '23505') {
      return { planned: false, probeId: null, refusal: 'ALREADY_OPEN',
        detail: 'Another probe for this Account opened concurrently.' };
    }
    throw error;
  }
}

export async function recordStateEvent(client: Queryable, input: {
  probeId: string; from: ProbeStatus | null; to: ProbeStatus;
  reason: string | null; actor: string;
}): Promise<void> {
  await client.query(
    `insert into probe_state_events (probe_id, from_status, to_status, reason, actor)
     values ($1,$2,$3,$4,$5)`,
    [input.probeId, input.from, input.to, input.reason, input.actor]);
}

/** Move a probe, refusing an illegal transition and recording the legal one. */
export async function transitionProbe(input: {
  probeId: string; to: ProbeStatus; reason: string; actor: string;
  set?: Record<string, unknown>;
}): Promise<ProbeStatus> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: ProbeStatus }>(
      `select status from lead_response_probes where probe_id = $1 for update`,
      [input.probeId]);
    const current = rows[0]?.status;
    if (!current) throw new Error(`No probe ${input.probeId}`);
    assertTransition(current, input.to);

    const assignments = ['status = $2', 'updated_at = now()'];
    const values: unknown[] = [input.probeId, input.to];
    for (const [column, value] of Object.entries(input.set ?? {})) {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }
    await client.query(
      `update lead_response_probes set ${assignments.join(', ')} where probe_id = $1`,
      values);
    if (current !== input.to) {
      await recordStateEvent(client, {
        probeId: input.probeId, from: current, to: input.to,
        reason: input.reason, actor: input.actor,
      });
    }
    return input.to;
  });
}

/** Pool state, with the collision keys of everything currently open on each number. */
export async function loadPoolState(now: Date): Promise<PoolNumberState[]> {
  const { rows } = await query<{
    pool_number_id: string; e164: string; status: 'ACTIVE' | 'QUARANTINED' | 'RELEASED';
    market_affinity: string | null; max_concurrent_open_probes: number;
    quarantined_until: Date | null;
    open_probes: { probeId: string; collisionKeys: string[] }[] | null;
  }>(
    `select n.pool_number_id, n.e164, n.status, n.market_affinity,
            n.max_concurrent_open_probes, n.quarantined_until,
            coalesce(
              (select json_agg(json_build_object(
                        'probeId', p.probe_id, 'collisionKeys', p.collision_keys))
                 from lead_response_probes p
                where p.assigned_pool_number_id = n.pool_number_id
                  and p.status = any($1::text[])), '[]'::json) as open_probes
       from probe_pool_numbers n
      order by n.e164`,
    [AWAITING_RESPONSE_STATUSES as unknown as string[]]);

  return rows.map((row) => ({
    poolNumberId: row.pool_number_id,
    e164: row.e164,
    status: row.status,
    marketAffinity: row.market_affinity,
    maxConcurrentOpenProbes: row.max_concurrent_open_probes,
    quarantinedUntil: row.quarantined_until,
    openProbes: (row.open_probes ?? []).map((open) => ({
      probeId: open.probeId, collisionKeys: open.collisionKeys ?? [],
    })),
  }));
}

/**
 * Allocate a number, or leave the probe in PLANNED.
 *
 * Deferral is a normal outcome and not an error. The probe keeps its state, the
 * reason is written to the state history, and the next run tries again -- possibly
 * after the colliding probe closes.
 */
export async function allocateForProbe(input: {
  probeId: string; now: Date; marketAffinity?: string | null;
}): Promise<AllocationOutcome> {
  const { rows } = await query<{ collision_keys: string[]; status: ProbeStatus }>(
    `select collision_keys, status from lead_response_probes where probe_id = $1`,
    [input.probeId]);
  const probe = rows[0];
  if (!probe) throw new Error(`No probe ${input.probeId}`);

  const pool_ = await loadPoolState(input.now);
  const outcome = allocatePoolNumber({
    candidateKeys: probe.collision_keys ?? [],
    pool: pool_,
    marketAffinity: input.marketAffinity ?? null,
    now: input.now,
  });

  if (outcome.allocated) {
    await query(
      `update lead_response_probes
          set assigned_pool_number_id = $2, updated_at = now()
        where probe_id = $1`, [input.probeId, outcome.poolNumberId]);
  } else {
    await withTransaction(async (client) => {
      await recordStateEvent(client, {
        probeId: input.probeId, from: probe.status, to: probe.status,
        reason: `${outcome.reason}: ${outcome.detail}`, actor: 'allocator',
      });
    });
  }
  return outcome;
}

/** The probes an inbound event on a pool number could plausibly belong to. */
export async function openProbesOnNumber(
  poolNumberId: string,
): Promise<OpenProbeCandidate[]> {
  const { rows } = await query<{
    probe_id: string; account_id: string; probe_token: string;
    account_name_at_submission: string | null;
    account_domain_at_submission: string | null;
    account_phones_at_submission: string[];
    account_alternate_phones_at_submission: string[];
  }>(
    `select probe_id, account_id, probe_token, account_name_at_submission,
            account_domain_at_submission, account_phones_at_submission,
            account_alternate_phones_at_submission
       from lead_response_probes
      where assigned_pool_number_id = $1 and status = any($2::text[])
      order by submitted_at nulls last, probe_id`,
    [poolNumberId, AWAITING_RESPONSE_STATUSES as unknown as string[]]);

  const shared = await sharedAlternateNumbers(
    rows.flatMap((row) => row.account_alternate_phones_at_submission ?? []));

  return rows.map((row) => ({
    probeId: row.probe_id,
    accountId: row.account_id,
    probeToken: row.probe_token,
    accountName: row.account_name_at_submission,
    accountDomain: row.account_domain_at_submission,
    phones: row.account_phones_at_submission ?? [],
    alternatePhones: row.account_alternate_phones_at_submission ?? [],
    alternatesAreExclusive: (row.account_alternate_phones_at_submission ?? [])
      .every((number) => !shared.has(number)),
  }));
}

async function sharedAlternateNumbers(numbers: readonly string[]): Promise<Set<string>> {
  if (numbers.length === 0) return new Set();
  const { rows } = await query<{ normalized_value: string }>(
    `select normalized_value from contact_endpoints
      where endpoint_type = 'PHONE' and normalized_value = any($1::text[])
      group by normalized_value having count(distinct account_id) > 1`,
    [numbers as string[]]);
  return new Set(rows.map((row) => row.normalized_value));
}
