import { query, withTransaction } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * National DNC screening: the provider interface, and a fixture provider.
 * Authority: outbound-sales-brain-ftc-dnc-ingestion-contract.v1.yaml,
 * outbound-sales-brain-dnc-provider-selection-current.md,
 * outbound-sales-brain-dnc-provider-benchmark-plan.md §3.
 *
 * The interface exists so a provider can be chosen and swapped after benchmarking
 * without touching the eligibility engine. The fixture provider exists so every rule
 * below is testable now, before anyone subscribes to anything.
 *
 * Three rules the whole file is built around:
 *
 *  1. a NO_MATCH is an input, never a permission. Nothing here can make a number
 *     callable by an AI; it can only remove one reason it was not.
 *  2. an unavailable or stale screen fails closed. A provider outage must never look
 *     like a clean number, which is the single most dangerous confusion available.
 *  3. a number outside the subscribed area codes is NOT_APPLICABLE, not NO_MATCH.
 *     Reporting "not on the list" about a list we did not check is a false negative
 *     with a person on the other end of it.
 */

export type DncStatus =
  | 'MATCH' | 'NO_MATCH' | 'NOT_APPLICABLE' | 'UNKNOWN'
  | 'ERROR_RETRYABLE' | 'ERROR_BLOCKING';

export type DncNormalizedResult =
  | 'DNC_MATCH' | 'DNC_NO_MATCH' | 'SCREEN_NOT_AVAILABLE_FOR_SCOPE'
  | 'REFRESH_REQUIRED_OR_POLICY_DECISION' | 'REQUIRED_SCREEN_UNAVAILABLE'
  | 'SCREENING_ERROR';

export interface DncScreenResult {
  status: DncStatus;
  normalizedResult: DncNormalizedResult;
  reasonCode: string;
  snapshotId: string | null;
  screenedAt: Date;
  providerReference: string | null;
  /** True only for MATCH and NO_MATCH: the two answers a policy may rely on. */
  conclusive: boolean;
}

export interface DncScreenRequest {
  normalizedPhone: string;
  endpointId?: string | null;
  destinationCountry?: string;
  channel: 'HUMAN_MANUAL_CALL' | 'AUTONOMOUS_AI_VOICE' | 'SMS';
  policyVersion: string;
  now?: Date;
}

/**
 * Every DNC provider satisfies this. Implementations live behind it so the
 * eligibility engine never learns a provider's shape.
 */
export interface DncProvider {
  readonly providerId: string;
  readonly sourceClass: string;
  isConfigured(): boolean;
  /** Whether the data behind it is fresh enough to rely on. */
  freshness(now?: Date): Promise<{
    state: 'CURRENT' | 'STALE_WARNING' | 'STALE_BLOCKING' | 'NO_SNAPSHOT';
    snapshotId: string | null; downloadedAt: Date | null;
  }>;
  screen(request: DncScreenRequest): Promise<DncScreenResult>;
}

export interface FreshnessPolicy {
  /** Beyond this, a warning; the number is still screened. */
  warnAfterHours: number;
  /** Beyond this, a required AI screen fails closed. */
  blockAfterHours: number;
}

/** Configurable, never hard-coded: the reviewed FTC policy sets the real values. */
export function defaultFreshnessPolicy(env: NodeJS.ProcessEnv = process.env): FreshnessPolicy {
  return {
    warnAfterHours: Number(env['DNC_SNAPSHOT_WARN_HOURS'] ?? '24'),
    blockAfterHours: Number(env['DNC_SNAPSHOT_BLOCK_HOURS'] ?? '31' /* days */) * 24,
  };
}

/**
 * The registry-backed provider.
 *
 * It answers from the current snapshot in our own database, which is how a bulk
 * registry works: there is no per-number call to make. That means the interesting
 * failures are about snapshot state rather than about HTTP.
 */
export function createRegistryDncProvider(options: {
  policy?: FreshnessPolicy; env?: NodeJS.ProcessEnv;
} = {}): DncProvider {
  const policy = options.policy ?? defaultFreshnessPolicy(options.env);
  const env = options.env ?? process.env;

  return {
    providerId: 'FTC_NATIONAL_DNC',
    sourceClass: 'FEDERAL_REGISTRY',

    isConfigured(): boolean {
      // A subscription record and a credential must both exist. Neither alone screens
      // anything, and the credential itself never comes near this code.
      return Boolean(env['DNC_PROVIDER'] === 'ftc_national_dnc'
        && (env['DNC_SUBSCRIPTION_CREDENTIAL_ENV'] ?? '').trim().length > 0);
    },

    async freshness(now = new Date()) {
      const { rows } = await query<{
        snapshot_id: string; downloaded_at: Date;
      }>(`select snapshot_id, downloaded_at from dnc_snapshots where state = 'CURRENT'`);
      const snapshot = rows[0];
      if (!snapshot) return { state: 'NO_SNAPSHOT', snapshotId: null, downloadedAt: null };

      const ageHours = (now.getTime() - snapshot.downloaded_at.getTime()) / 3_600_000;
      const state = ageHours > policy.blockAfterHours ? 'STALE_BLOCKING'
        : ageHours > policy.warnAfterHours ? 'STALE_WARNING'
        : 'CURRENT';
      return { state, snapshotId: snapshot.snapshot_id, downloadedAt: snapshot.downloaded_at };
    },

    async screen(request): Promise<DncScreenResult> {
      const now = request.now ?? new Date();
      const record = (result: Omit<DncScreenResult, 'screenedAt' | 'conclusive'>) =>
        persist({ ...result, screenedAt: now,
                  conclusive: result.status === 'MATCH' || result.status === 'NO_MATCH' },
                request);

      // A malformed number is never a clean result.
      const normalized = normalizePhone(request.normalizedPhone);
      if (!normalized) {
        return record({
          status: 'ERROR_BLOCKING', normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: 'phone_format_invalid', snapshotId: null, providerReference: null,
        });
      }

      const fresh = await this.freshness(now);
      if (fresh.state === 'NO_SNAPSHOT') {
        return record({
          status: 'ERROR_BLOCKING', normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: 'no_current_snapshot', snapshotId: null, providerReference: null,
        });
      }
      if (fresh.state === 'STALE_BLOCKING') {
        return record({
          status: 'ERROR_BLOCKING', normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: 'registry_snapshot_stale_blocking',
          snapshotId: fresh.snapshotId, providerReference: null,
        });
      }

      // Scope. Outside the subscribed area codes we have not checked anything, and
      // saying "not on the list" about a list we did not read is a false negative.
      const areaCode = normalized.replace(/\D+/g, '').slice(-10, -7);
      const { rows: scope } = await query<{ subscribed_area_codes: string[] }>(
        `select s.subscribed_area_codes
           from dnc_snapshots n
           join dnc_subscriptions s on s.subscription_id = n.subscription_id
          where n.snapshot_id = $1`,
        [fresh.snapshotId]);
      const subscribed = scope[0]?.subscribed_area_codes ?? [];
      if (subscribed.length > 0 && !subscribed.includes(areaCode)) {
        return record({
          status: 'NOT_APPLICABLE', normalizedResult: 'SCREEN_NOT_AVAILABLE_FOR_SCOPE',
          reasonCode: 'area_code_not_subscribed',
          snapshotId: fresh.snapshotId, providerReference: null,
        });
      }

      let member = false;
      try {
        const { rows } = await query<{ n: number }>(
          `select count(*)::int as n from dnc_membership
            where snapshot_id = $1 and normalized_value = $2`,
          [fresh.snapshotId, normalized]);
        member = (rows[0]?.n ?? 0) > 0;
      } catch {
        return record({
          status: 'ERROR_RETRYABLE', normalizedResult: 'SCREENING_ERROR',
          reasonCode: 'registry_lookup_error',
          snapshotId: fresh.snapshotId, providerReference: null,
        });
      }

      if (member) {
        return record({
          status: 'MATCH', normalizedResult: 'DNC_MATCH', reasonCode: 'federal_registry_match',
          snapshotId: fresh.snapshotId, providerReference: fresh.snapshotId,
        });
      }
      if (fresh.state === 'STALE_WARNING') {
        // Not on the list, but the list is older than policy likes. That is a decision
        // for policy, not a clean pass.
        return record({
          status: 'UNKNOWN', normalizedResult: 'REFRESH_REQUIRED_OR_POLICY_DECISION',
          reasonCode: 'registry_snapshot_stale',
          snapshotId: fresh.snapshotId, providerReference: fresh.snapshotId,
        });
      }
      return record({
        status: 'NO_MATCH', normalizedResult: 'DNC_NO_MATCH',
        reasonCode: 'federal_registry_no_match',
        snapshotId: fresh.snapshotId, providerReference: fresh.snapshotId,
      });
    },
  };
}

async function persist(
  result: DncScreenResult, request: DncScreenRequest,
): Promise<DncScreenResult> {
  await query(
    `insert into dnc_screen_log
       (endpoint_id, normalized_value, snapshot_id, status, normalized_result, reason_code,
        policy_version, provider_reference, screened_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [request.endpointId ?? null, request.normalizedPhone, result.snapshotId, result.status,
     result.normalizedResult, result.reasonCode, request.policyVersion,
     result.providerReference, result.screenedAt],
  );
  return result;
}

// --------------------------------------------------------------- ingestion ----

export interface ChangeRecord { operation: 'ADD' | 'DELETE'; normalizedPhone: string }

export interface IngestResult {
  ok: boolean;
  snapshotId?: string;
  applied?: number;
  reason?: string;
}

/**
 * Applies a full list, becoming the current snapshot only once validated.
 *
 * A malformed file never replaces the current snapshot: it is recorded as REJECTED
 * and the previous snapshot stays current. That is the difference between a bad
 * download and an outage that silently empties the registry.
 */
export async function ingestFullList(input: {
  subscriptionId: string; batchReference: string; numbers: string[];
  sourceGeneratedAt?: Date; checksum?: string; areaCodes?: string[];
}): Promise<IngestResult> {
  const normalized: string[] = [];
  for (const raw of input.numbers) {
    const value = normalizePhone(raw);
    if (!value) {
      const snapshot = await recordSnapshot({ ...input, dataKind: 'FULL_LIST',
        state: 'REJECTED', rejectedReason: `Malformed number in the file: ${raw.slice(0, 24)}` });
      return { ok: false, snapshotId: snapshot,
        reason: 'The file contains a number we cannot parse, so it was not applied.' };
    }
    normalized.push(value);
  }
  if (normalized.length === 0) {
    const snapshot = await recordSnapshot({ ...input, dataKind: 'FULL_LIST',
      state: 'REJECTED', rejectedReason: 'An empty full list would erase the registry.' });
    return { ok: false, snapshotId: snapshot,
      reason: 'An empty full list is treated as a bad download, not as an empty registry.' };
  }

  return withTransaction(async (client) => {
    const existing = await client.query<{ snapshot_id: string }>(
      `select snapshot_id from dnc_snapshots
        where source_id = 'FTC_NATIONAL_DNC' and batch_reference = $1`,
      [input.batchReference]);
    if (existing.rows[0]) {
      return { ok: true, snapshotId: existing.rows[0].snapshot_id, applied: 0,
        reason: 'That batch was already applied.' };
    }

    const { rows } = await client.query<{ snapshot_id: string }>(
      `insert into dnc_snapshots
         (subscription_id, data_kind, batch_reference, checksum, source_generated_at,
          validated_at, applied_at, subscribed_area_codes, record_count, state)
       values ($1,'FULL_LIST',$2,$3,$4, now(), now(), $5, $6, 'APPLIED')
       returning snapshot_id`,
      [input.subscriptionId, input.batchReference, input.checksum ?? null,
       input.sourceGeneratedAt ?? null, input.areaCodes ?? [], normalized.length]);
    const snapshotId = rows[0]!.snapshot_id;

    for (const value of normalized) {
      await client.query(
        `insert into dnc_membership (snapshot_id, normalized_value) values ($1, $2)
         on conflict do nothing`, [snapshotId, value]);
    }

    await client.query(`update dnc_snapshots set state = 'SUPERSEDED' where state = 'CURRENT'`);
    await client.query(`update dnc_snapshots set state = 'CURRENT' where snapshot_id = $1`,
      [snapshotId]);
    return { ok: true, snapshotId, applied: normalized.length };
  });
}

/**
 * Applies a change list on top of the current snapshot.
 *
 * The same validated batch cannot apply twice, a repeated add does not duplicate
 * membership, and a repeated delete does not create negative membership.
 */
export async function ingestChangeList(input: {
  subscriptionId: string; batchReference: string; changes: ChangeRecord[];
  sourceGeneratedAt?: Date; checksum?: string;
}): Promise<IngestResult> {
  for (const change of input.changes) {
    if (!normalizePhone(change.normalizedPhone)) {
      const snapshot = await recordSnapshot({ ...input, dataKind: 'CHANGE_LIST',
        state: 'REJECTED',
        rejectedReason: `Malformed number in the batch: ${change.normalizedPhone.slice(0, 24)}` });
      return { ok: false, snapshotId: snapshot,
        reason: 'The batch contains a number we cannot parse, so none of it was applied.' };
    }
  }

  return withTransaction(async (client) => {
    const existing = await client.query<{ snapshot_id: string; state: string }>(
      `select snapshot_id, state from dnc_snapshots
        where source_id = 'FTC_NATIONAL_DNC' and batch_reference = $1`,
      [input.batchReference]);
    if (existing.rows[0]) {
      return { ok: true, snapshotId: existing.rows[0].snapshot_id, applied: 0,
        reason: 'That batch was already applied.' };
    }

    const current = await client.query<{ snapshot_id: string }>(
      `select snapshot_id from dnc_snapshots where state = 'CURRENT'`);
    if (!current.rows[0]) {
      return { ok: false, reason: 'There is no current snapshot to change.' };
    }
    const snapshotId = current.rows[0].snapshot_id;

    let applied = 0;
    for (const change of input.changes) {
      const value = normalizePhone(change.normalizedPhone)!;
      if (change.operation === 'ADD') {
        await client.query(
          `insert into dnc_membership (snapshot_id, normalized_value) values ($1, $2)
           on conflict do nothing`, [snapshotId, value]);
      } else {
        await client.query(
          `delete from dnc_membership where snapshot_id = $1 and normalized_value = $2`,
          [snapshotId, value]);
      }
      applied += 1;
    }

    // The batch is recorded as applied so it cannot be applied again, and so the
    // audit shows what happened to the current snapshot.
    await client.query(
      `insert into dnc_snapshots
         (subscription_id, data_kind, batch_reference, checksum, source_generated_at,
          validated_at, applied_at, record_count, state)
       values ($1,'CHANGE_LIST',$2,$3,$4, now(), now(), $5, 'APPLIED')`,
      [input.subscriptionId, input.batchReference, input.checksum ?? null,
       input.sourceGeneratedAt ?? null, input.changes.length]);
    return { ok: true, snapshotId, applied };
  });
}

async function recordSnapshot(input: {
  subscriptionId: string; batchReference: string; dataKind: 'FULL_LIST' | 'CHANGE_LIST';
  state: 'REJECTED'; rejectedReason: string; checksum?: string; sourceGeneratedAt?: Date;
}): Promise<string> {
  const { rows } = await query<{ snapshot_id: string }>(
    `insert into dnc_snapshots
       (subscription_id, data_kind, batch_reference, checksum, source_generated_at,
        state, rejected_reason)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (source_id, batch_reference) do update set rejected_reason = excluded.rejected_reason
     returning snapshot_id`,
    [input.subscriptionId, input.dataKind, input.batchReference, input.checksum ?? null,
     input.sourceGeneratedAt ?? null, input.state, input.rejectedReason]);
  return rows[0]!.snapshot_id;
}

/** A fixture provider, so every rule above is testable with no subscription. */
export function createFixtureDncProvider(options: {
  members?: string[]; behaviour?: 'ok' | 'outage' | 'stale_blocking' | 'unconfigured';
} = {}): DncProvider {
  const members = new Set((options.members ?? []).map((value) => normalizePhone(value) ?? value));
  const behaviour = options.behaviour ?? 'ok';

  return {
    providerId: 'FIXTURE_DNC',
    sourceClass: 'TEST_FIXTURE',
    isConfigured: () => behaviour !== 'unconfigured',
    async freshness() {
      if (behaviour === 'stale_blocking') {
        return { state: 'STALE_BLOCKING', snapshotId: 'fixture', downloadedAt: new Date(0) };
      }
      if (behaviour === 'outage') {
        return { state: 'NO_SNAPSHOT', snapshotId: null, downloadedAt: null };
      }
      return { state: 'CURRENT', snapshotId: 'fixture', downloadedAt: new Date() };
    },
    async screen(request) {
      const now = request.now ?? new Date();
      const base = { snapshotId: 'fixture', providerReference: 'fixture', screenedAt: now };
      if (behaviour === 'unconfigured' || behaviour === 'outage') {
        return { ...base, snapshotId: null, providerReference: null,
          status: 'ERROR_BLOCKING', normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: behaviour === 'outage' ? 'no_current_snapshot' : 'provider_not_configured',
          conclusive: false };
      }
      if (behaviour === 'stale_blocking') {
        return { ...base, status: 'ERROR_BLOCKING',
          normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: 'registry_snapshot_stale_blocking', conclusive: false };
      }
      const value = normalizePhone(request.normalizedPhone);
      if (!value) {
        return { ...base, status: 'ERROR_BLOCKING',
          normalizedResult: 'REQUIRED_SCREEN_UNAVAILABLE',
          reasonCode: 'phone_format_invalid', conclusive: false };
      }
      return members.has(value)
        ? { ...base, status: 'MATCH', normalizedResult: 'DNC_MATCH',
            reasonCode: 'federal_registry_match', conclusive: true }
        : { ...base, status: 'NO_MATCH', normalizedResult: 'DNC_NO_MATCH',
            reasonCode: 'federal_registry_no_match', conclusive: true };
    },
  };
}
