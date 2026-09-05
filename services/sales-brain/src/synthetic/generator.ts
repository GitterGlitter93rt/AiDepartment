import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { Rng } from './random.js';
import {
  FAMILY_NAMES, FIRST_NAMES, MARKETS, NAME_PREFIXES, RESERVED_LINE, STREETS, SUFFIXES,
  SYNTHETIC_MARKER, TITLES, UNICODE_FAMILY_NAMES, VERTICALS,
} from './vocabulary.js';

/**
 * Deterministic synthetic dataset for scale, concurrency and analytics testing.
 *
 * NON-PRODUCTION. Everything generated here is unreachable by construction:
 *
 *   - every domain is under `.invalid`, which RFC 2606 reserves so it can never
 *     resolve, so no crawler or link can reach a real business;
 *   - every phone number uses the 555 exchange, which the NANP does not assign to
 *     subscribers, and the directory-assistance line 555-1212 is excluded;
 *   - every email address is at one of those `.invalid` domains;
 *   - every provenance field says SYNTHETIC_FIXTURE, so a generated row can be told
 *     from a researched one by a query rather than by eye;
 *   - the generator writes no contact_attempts, no email_outbox rows and no
 *     provider_usage rows, so nothing it creates can be mistaken for outreach or
 *     spend, and it refuses to run against a database that is not a scale target.
 *
 * The counts it returns are exact. Analytics can therefore be checked against an
 * answer that is known by construction rather than by re-running the same SQL.
 */

export const SYNTHETIC_DOMAIN_SUFFIX = '.invalid';

/** A fixed origin so a dataset does not change shape with the wall clock. */
export const DATASET_ORIGIN = new Date('2026-09-01T12:00:00Z');

export interface GenerateOptions {
  accounts: number;
  seed?: string;
  /** Accounts written per transaction. Lower uses less memory, higher is faster. */
  chunkSize?: number;
  /** Reps and managers to create. Ownership is spread across the reps. */
  reps?: number;
  onProgress?: (done: number, total: number) => void;
  /** Set true only for a database that is deliberately the primary. */
  allowNonScaleDatabase?: boolean;
}

/**
 * Exact tallies, accumulated while writing. Every analytics rate has its numerator
 * and denominator here, so a truth test does not have to trust a second query.
 */
export interface DatasetLedger {
  seed: string;
  accounts: number;
  suppressedAccounts: number;
  dncAccounts: number;
  claimedAccounts: number;
  unclaimedAccounts: number;
  accountsByVertical: Record<string, number>;
  accountsByPostalCode: Record<string, number>;
  accountsByTier: Record<string, number>;
  advertiserAccounts: number;
  staleAdvertiserOnly: number;
  locations: number;
  multiLocationAccounts: number;
  contacts: number;
  rolePlaceholderContacts: number;
  namedOwnerContacts: number;
  endpoints: number;
  endpointsByRole: Record<string, number>;
  suppressedEndpoints: number;
  wrongNumberEndpoints: number;
  staleEndpoints: number;
  evidenceRecords: number;
  contradictedEvidence: number;
  staleEvidence: number;
  hypotheses: number;
  activities: number;
  activitiesByDisposition: Record<string, number>;
  decisionMakerReachedAccounts: number;
  followUps: number;
  openFollowUps: number;
  overdueFollowUps: number;
  opportunities: number;
  opportunitiesByStage: Record<string, number>;
  meetings: number;
  meetingsByStatus: Record<string, number>;
  attendedMeetings: number;
  emailEnrollments: number;
  emailReplies: number;
  positiveReplies: number;
  voiceCalls: number;
  voiceCallsConnected: number;
  callPacks: number;
  hookAttempts: number;
  hookAttemptsByOpener: Record<string, number>;
  bookedFromHooks: number;
  attendedFromHooks: number;
  ownershipEvents: number;
  duplicatePairs: number;
  sharedPhonePairs: number;
  users: { reps: string[]; managers: string[]; admin: string };
  markets: string[];
  elapsedMs: number;
}

function emptyLedger(seed: string): DatasetLedger {
  return {
    seed, accounts: 0, suppressedAccounts: 0, dncAccounts: 0, claimedAccounts: 0,
    unclaimedAccounts: 0, accountsByVertical: {}, accountsByPostalCode: {}, accountsByTier: {},
    advertiserAccounts: 0, staleAdvertiserOnly: 0, locations: 0, multiLocationAccounts: 0,
    contacts: 0, rolePlaceholderContacts: 0, namedOwnerContacts: 0, endpoints: 0,
    endpointsByRole: {}, suppressedEndpoints: 0, wrongNumberEndpoints: 0, staleEndpoints: 0,
    evidenceRecords: 0, contradictedEvidence: 0, staleEvidence: 0, hypotheses: 0,
    activities: 0, activitiesByDisposition: {}, decisionMakerReachedAccounts: 0,
    followUps: 0, openFollowUps: 0, overdueFollowUps: 0, opportunities: 0,
    opportunitiesByStage: {}, meetings: 0, meetingsByStatus: {}, attendedMeetings: 0,
    emailEnrollments: 0, emailReplies: 0, positiveReplies: 0, voiceCalls: 0,
    voiceCallsConnected: 0, callPacks: 0, hookAttempts: 0, hookAttemptsByOpener: {},
    bookedFromHooks: 0, attendedFromHooks: 0, ownershipEvents: 0, duplicatePairs: 0,
    sharedPhonePairs: 0, users: { reps: [], managers: [], admin: '' }, markets: [],
    elapsedMs: 0,
  };
}

function bump(counter: Record<string, number>, key: string, by = 1): void {
  counter[key] = (counter[key] ?? 0) + by;
}

// --------------------------------------------------------------------- naming --

/**
 * A number this account does not already have.
 *
 * The pool is ten thousand lines per area code, so a collision inside one account is
 * rare but certain to happen somewhere in twenty-five thousand of them.
 */
function uniquePhone(rng: Rng, plan: { market: { areaCode: string } }, used: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = syntheticPhone(rng, plan.market.areaCode);
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  throw new Error('could not find an unused synthetic phone number');
}

/** A phone that cannot ring: 555 exchange, directory assistance excluded. */
function syntheticPhone(rng: Rng, areaCode: string): string {
  let line = rng.int(0, 9999);
  if (line === RESERVED_LINE) line = RESERVED_LINE + 1;
  return `+1${areaCode}555${String(line).padStart(4, '0')}`;
}

function syntheticDomain(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 22);
  // accounts.canonical_domain is unique, and at scale a random suffix collides: a
  // three-digit tail gave a duplicate before twenty thousand accounts. The account
  // index is unique by construction and still leaves the name recognisable to a
  // search-ranking test.
  return `${slug || 'company'}${index}${SYNTHETIC_DOMAIN_SUFFIX}`;
}

export function normalizeForCompare(name: string): string {
  return name.toLowerCase()
    .replace(/\b(llc|inc|corp|co|company|ltd)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface AccountPlan {
  accountId: string;
  name: string;
  normalized: string;
  vertical: string;
  market: (typeof MARKETS)[number];
  tier: 'A' | 'B' | 'C' | 'D';
  score: number;
  advertiserStrength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  researchFreshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  accountType: string;
  locationCount: number;
  domain: string | null;
  mainPhone: string;
  ownerUserId: string | null;
  ownershipState: string;
  relationshipState: string;
  suppressed: boolean;
}

// -------------------------------------------------------------- batch writing --

/**
 * Multi-row INSERT builder. One statement per batch rather than one per row: at
 * 25,000 accounts the per-statement round trip is the whole cost.
 */
class Batch {
  private rows: unknown[][] = [];

  constructor(
    private readonly table: string,
    private readonly columns: string[],
    private readonly suffix = '',
  ) {}

  add(...values: unknown[]): void {
    if (values.length !== this.columns.length) {
      throw new Error(`${this.table}: expected ${this.columns.length} values, got ${values.length}`);
    }
    this.rows.push(values);
  }

  get size(): number { return this.rows.length; }

  async flush(client: PoolClient): Promise<void> {
    if (this.rows.length === 0) return;
    const width = this.columns.length;
    // Postgres caps bind parameters at 65535, so the batch is split to stay under it.
    const perStatement = Math.max(1, Math.floor(60_000 / width));
    for (let start = 0; start < this.rows.length; start += perStatement) {
      const slice = this.rows.slice(start, start + perStatement);
      const values: unknown[] = [];
      const tuples = slice.map((row) => {
        const placeholders = row.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        return `(${placeholders.join(',')})`;
      });
      await client.query(
        `insert into ${this.table} (${this.columns.join(',')}) values ${tuples.join(',')} ${this.suffix}`,
        values,
      );
    }
    this.rows = [];
  }
}

// ------------------------------------------------------------------- the guard --

/**
 * Refuses to write realistic-looking synthetic data anywhere it could be mistaken
 * for researched inventory. The scale dataset belongs in its own database.
 */
export async function assertScaleTarget(allowNonScale = false): Promise<string> {
  const { rows } = await pool.query<{ name: string }>('select current_database() as name');
  const name = rows[0]!.name;
  const looksLikeScaleTarget = /scale|synthetic|bench/i.test(name);
  if (!looksLikeScaleTarget && !allowNonScale) {
    throw new Error(
      `Refusing to generate synthetic data into "${name}". `
      + 'Point DATABASE_URL at a database whose name contains "scale", "synthetic" or '
      + '"bench", or pass allowNonScaleDatabase for a database you meant to fill.',
    );
  }
  return name;
}

// ---------------------------------------------------------------- the generator --

export async function generateDataset(options: GenerateOptions): Promise<DatasetLedger> {
  const startedAt = Date.now();
  const seed = options.seed ?? 'yad-scale-v1';
  const total = options.accounts;
  const chunkSize = options.chunkSize ?? 500;
  const repCount = options.reps ?? 6;
  const ledger = emptyLedger(seed);
  const databaseName = await assertScaleTarget(options.allowNonScaleDatabase);

  // --- people ---------------------------------------------------------------
  const userRng = new Rng(seed, 'users');
  const repIds: string[] = [];
  const managerIds: string[] = [];
  let adminId = '';
  await withTransaction(async (client) => {
    const users = new Batch('users',
      ['user_id', 'email', 'email_normalized', 'display_name', 'role', 'password_hash',
       'is_active'],
      'on conflict (email_normalized) do nothing');
    for (let i = 0; i < repCount; i += 1) {
      const id = randomUUID();
      repIds.push(id);
      const email = `synthetic.rep${i + 1}@fixture.invalid`;
      users.add(id, email, email, `Synthetic Rep ${i + 1}`, 'SALES_REP', null, true);
    }
    for (let i = 0; i < 2; i += 1) {
      const id = randomUUID();
      managerIds.push(id);
      const email = `synthetic.manager${i + 1}@fixture.invalid`;
      users.add(id, email, email, `Synthetic Manager ${i + 1}`, 'SALES_MANAGER', null, true);
    }
    adminId = randomUUID();
    users.add(adminId, 'synthetic.admin@fixture.invalid', 'synthetic.admin@fixture.invalid',
      'Synthetic Admin', 'ADMIN', null, true);
    await users.flush(client);

    // On a second run the insert conflicts and keeps the existing rows, so the ids
    // generated above would point at users that do not exist. Read back what is
    // actually there rather than trusting what we tried to write.
    const { rows: existing } = await client.query<{ user_id: string; email: string; role: string }>(
      `select user_id, email, role from users
        where email like 'synthetic.%@fixture.invalid' order by email`);
    if (existing.length > 0) {
      repIds.length = 0;
      managerIds.length = 0;
      for (const row of existing) {
        if (row.role === 'SALES_REP') repIds.push(row.user_id);
        else if (row.role === 'SALES_MANAGER') managerIds.push(row.user_id);
        else if (row.role === 'ADMIN') adminId = row.user_id;
      }
    }

    // --- markets ------------------------------------------------------------
    const markets = new Batch('saved_markets',
      ['market_id', 'name', 'geography_type', 'geography_definition', 'vertical_profile_id',
       'mining_mode', 'status', 'created_by'],
      'on conflict do nothing');
    for (const market of MARKETS) {
      for (const vertical of VERTICALS.slice(0, 3)) {
        const marketId = randomUUID();
        ledger.markets.push(marketId);
        markets.add(marketId, `${vertical.label} — ${market.city} ${market.postalCode}`,
          'zip_zcta',
          JSON.stringify({ postal_code: market.postalCode, city: market.city, state: market.state }),
          vertical.id, 'advertiser_first', 'ACTIVE', managerIds[0] ?? null);
      }
    }
    await markets.flush(client);
    void userRng;
  });
  ledger.users = { reps: repIds, managers: managerIds, admin: adminId };

  // One campaign for email relationships.
  const campaignId = randomUUID();
  await pool.query(
    `insert into email_campaigns (email_campaign_id, name, provider, status, hook_family, created_by)
     values ($1, $2, 'smartlead', 'ACTIVE', 'missed_call', $3)
     on conflict do nothing`,
    [campaignId, `SYNTHETIC — ${SYNTHETIC_MARKER} sequence`, managerIds[0] ?? null]);

  // --- accounts, in chunks --------------------------------------------------
  for (let offset = 0; offset < total; offset += chunkSize) {
    const count = Math.min(chunkSize, total - offset);
    await writeChunk(seed, offset, count, repIds, managerIds, campaignId, ledger);
    options.onProgress?.(Math.min(offset + count, total), total);
  }

  ledger.elapsedMs = Date.now() - startedAt;
  void databaseName;
  return ledger;
}

/** Plans and writes one chunk of accounts and everything hanging off them. */
async function writeChunk(
  seed: string, offset: number, count: number,
  repIds: string[], managerIds: string[], campaignId: string, ledger: DatasetLedger,
): Promise<void> {
  const plans: AccountPlan[] = [];

  const accounts = new Batch('accounts', [
    'account_id', 'canonical_name', 'normalized_name', 'legal_name', 'dba_names',
    'account_type', 'primary_vertical_profile_id', 'canonical_domain', 'relationship_state',
    'ownership_state', 'current_owner_user_id', 'ownership_updated_at', 'claimed_at',
    'manual_score', 'manual_tier', 'advertiser_strength', 'research_completeness',
    'research_fresh_until', 'last_researched_at', 'location_count_confirmed', 'created_at',
  ]);
  const domains = new Batch('account_domains',
    ['account_id', 'hostname', 'canonical_url', 'domain_role', 'verification_status',
     'first_seen_at'], 'on conflict do nothing');
  const locations = new Batch('locations', [
    'location_id', 'account_id', 'name', 'address_line_1', 'city', 'state_region',
    'postal_code', 'country_code', 'timezone', 'location_type', 'is_headquarters', 'is_active',
  ]);
  const contacts = new Batch('contacts', [
    'contact_id', 'account_id', 'location_id', 'first_name', 'last_name', 'full_name',
    'raw_title', 'role_category', 'company_relationship', 'employer_match', 'role_match',
    'currentness', 'role_confidence', 'decision_maker_priority', 'is_role_placeholder',
    'status', 'source_provider', 'observed_at',
  ]);
  const endpoints = new Batch('contact_endpoints', [
    'endpoint_id', 'account_id', 'contact_id', 'location_id', 'endpoint_type',
    'normalized_value', 'display_value', 'endpoint_role', 'quality_state',
    'relationship_to_person', 'endpoint_source', 'source_reference', 'observed_at',
    'verified_at', 'freshness', 'is_active', 'line_type', 'line_type_source',
  ]);
  const evidence = new Batch('evidence_records', [
    'evidence_id', 'account_id', 'category', 'claim_key', 'claim_text', 'normalized_value',
    'confidence', 'can_state_as_fact', 'source_type', 'source_provider', 'source_reference',
    'observed_at', 'expires_at', 'freshness', 'precedence_rank',
  ]);
  const hypotheses = new Batch('opportunity_hypotheses', [
    'account_id', 'category', 'hypothesis_text', 'missing_fact_questions', 'confidence',
    'priority', 'generated_by', 'is_current', 'generated_at',
  ]);
  const scores = new Batch('canonical_scores',
    ['account_id', 'score_version', 'total_points', 'tier', 'components', 'calculated_at']);
  const completeness = new Batch('research_completeness',
    ['account_id', 'numeric_score', 'label', 'components', 'generated_at']);
  const activities = new Batch('activities', [
    'account_id', 'contact_id', 'actor_user_id', 'owner_user_id', 'activity_type',
    'channel', 'disposition', 'occurred_at', 'notes', 'source_system',
  ]);
  const followUps = new Batch('follow_ups', [
    'account_id', 'contact_id', 'owner_user_id', 'followup_type', 'due_at', 'timezone',
    'status', 'prospect_requested', 'context', 'created_at', 'completed_at',
  ]);
  const opportunities = new Batch('opportunities', [
    'opportunity_id', 'account_id', 'contact_id', 'owner_user_id', 'title', 'stage',
    'problem_summary', 'confirmed_workflow', 'next_step', 'source_channel', 'close_reason',
    'created_at', 'closed_at',
  ]);
  const stageEvents = new Batch('opportunity_stage_events',
    ['opportunity_id', 'from_stage', 'to_stage', 'actor_user_id', 'reason', 'occurred_at']);
  // Column order above is explicit, so the add() calls read in the same order.
  const bookings = new Batch('meeting_bookings', [
    'booking_id', 'account_id', 'contact_id', 'owner_user_id', 'calendar_upn', 'meeting_type',
    'idempotency_key', 'requested_start', 'requested_end', 'prospect_timezone',
    'attendee_name', 'attendee_email', 'status', 'provider', 'provider_event_id',
    'confirmed_at', 'attended_state', 'source_channel', 'created_by', 'created_at',
  ]);
  const enrollments = new Batch('email_enrollments', [
    'enrollment_id', 'email_campaign_id', 'account_id', 'contact_id', 'endpoint_id',
    'normalized_email', 'provider_lead_id', 'status', 'created_at',
  ]);
  const emailEvents = new Batch('email_events', [
    'enrollment_id', 'account_id', 'provider', 'provider_event_id', 'event_type',
    'reply_class', 'reply_excerpt', 'payload', 'occurred_at',
  ]);
  const callPacks = new Batch('call_packs', [
    'call_pack_id', 'account_id', 'contact_id', 'vertical_profile_id', 'context_version',
    'company_summary', 'primary_hypothesis', 'primary_hook', 'recommended_opener',
    'top_confirmed_facts', 'important_unknowns', 'first_questions', 'likely_objections',
    'known_system_signals', 'prohibited_claims', 'allowed_next_steps', 'generated_at',
  ]);
  const calls = new Batch('voice_calls', [
    'voice_call_id', 'direction', 'agent_profile_id', 'prompt_version', 'mode_at_start',
    'account_id', 'contact_id', 'endpoint_id', 'call_pack_id', 'provider_call_sid',
    'from_number', 'to_number', 'started_at', 'connected_at', 'ended_at', 'duration_seconds',
    'outcome', 'latency_ms', 'qa_score', 'qa_hard_failure', 'root_cause', 'reviewed_by',
    'reviewed_at',
  ]);
  const turns = new Batch('voice_call_turns',
    ['voice_call_id', 'turn_index', 'speaker', 'text', 'offset_ms', 'component_id']);
  const hooks = new Batch('hook_attempts', [
    'hook_attempt_id', 'account_id', 'contact_id', 'endpoint_id', 'voice_call_id',
    'opener_version', 'opener_frame', 'hook_family', 'hypothesis_category',
    'contact_route_class', 'vertical_profile_id', 'time_bucket', 'agent_profile_id',
    'prompt_version', 'tier', 'advertiser_evidence_class', 'attempted_at', 'connected_at',
    'human_answered_at', 'right_stakeholder_at', 'first_question_answered_at',
    'useful_fact_at', 'problem_supported_at', 'strategy_offer_at', 'strategy_accepted_at',
    'strategy_booked_at', 'meeting_attended_at', 'opportunity_created_at', 'dnc_at',
    'conversation_outcome', 'michael_quality_score', 'quality_scored_at', 'stakeholder_fit',
    'problem_confirmed_at_meeting',
  ]);
  const ownershipEvents = new Batch('ownership_events',
    ['account_id', 'event_type', 'previous_owner_user_id', 'new_owner_user_id',
     'actor_user_id', 'reason', 'occurred_at']);
  const identities = new Batch('source_identities', [
    'account_id', 'provider', 'provider_entity_type', 'provider_native_id',
    'retention_class', 'first_seen_at', 'last_seen_at',
  ], 'on conflict do nothing');
  const suppressionRows: { scope: string; accountId: string; endpointId: string | null;
                           type: string; reason: string }[] = [];

  for (let i = 0; i < count; i += 1) {
    const index = offset + i;
    // The RNG decides shape, never identity. mulberry32 holds 32 bits of state, so
    // at twenty-five thousand accounts two of them will occasionally seed to the
    // same stream -- harmless for shape, since duplicate companies are a deliberate
    // part of this fixture, but fatal for a primary key. Ids come from randomUUID.
    const rng = new Rng(seed, 'account', index);
    const plan = planAccount(rng, index, repIds, ledger);
    plans.push(plan);

    accounts.add(
      plan.accountId, plan.name, plan.normalized,
      rng.bool(0.3) ? `${plan.name} ${rng.pick(['LLC', 'Inc'])}` : null,
      rng.bool(0.12) ? [`${rng.pick(NAME_PREFIXES)} ${rng.pick(VERTICALS).label}`] : [],
      plan.accountType, plan.vertical, plan.domain, plan.relationshipState,
      plan.ownershipState, plan.ownerUserId,
      plan.ownerUserId ? rng.daysAgo(1, 60, DATASET_ORIGIN) : null,
      plan.ownerUserId ? rng.daysAgo(1, 60, DATASET_ORIGIN) : null,
      plan.score, plan.tier, plan.advertiserStrength,
      plan.researchFreshness === 'stale' ? 'STALE'
        : plan.researchFreshness === 'unknown' ? 'THIN'
        : rng.weighted([['COMPLETE', 2], ['GOOD', 4], ['PARTIAL', 3]]),
      freshUntilFor(plan.researchFreshness, rng),
      plan.researchFreshness === 'unknown' ? null : rng.daysAgo(1, 500, DATASET_ORIGIN),
      plan.locationCount, rng.daysAgo(1, 400, DATASET_ORIGIN),
    );

    if (plan.domain) {
      domains.add(plan.accountId, plan.domain, `https://${plan.domain}/`, 'primary',
        rng.weighted([['verified', 3], ['unverified', 2]]), rng.daysAgo(1, 400, DATASET_ORIGIN));
    }
    identities.add(plan.accountId, SYNTHETIC_MARKER, 'business', `synthetic-${index}`,
      'identifier_only', rng.daysAgo(30, 400, DATASET_ORIGIN),
      rng.daysAgo(1, 30, DATASET_ORIGIN));

    // --- locations ---------------------------------------------------------
    const locationIds: string[] = [];
    for (let l = 0; l < plan.locationCount; l += 1) {
      const locationId = randomUUID();
      locationIds.push(locationId);
      const market = l === 0 ? plan.market : rng.pick(MARKETS);
      locations.add(locationId, plan.accountId,
        l === 0 ? null : `${plan.name} — ${market.city}`,
        `${rng.int(100, 9999)} ${rng.pick(STREETS)}`,
        market.city, market.state, market.postalCode, 'US', market.timezone,
        rng.weighted([['physical', 8], ['service_area', 2]]), l === 0, true);
      ledger.locations += 1;
    }
    if (plan.locationCount > 1) ledger.multiLocationAccounts += 1;

    // --- contacts ----------------------------------------------------------
    const contactCount = rng.weighted([[1, 5], [2, 3], [3, 2], [4, 1]]);
    const contactIds: string[] = [];
    let namedOwner: string | null = null;
    const usedTitles = rng.shuffle(TITLES).slice(0, contactCount);
    for (let c = 0; c < contactCount; c += 1) {
      const contactId = randomUUID();
      contactIds.push(contactId);
      const shape = usedTitles[c]!;
      const rolePlaceholder = rng.bool(0.18);
      const family = rng.bool(0.08) ? rng.pick(UNICODE_FAMILY_NAMES) : rng.pick(FAMILY_NAMES);
      const first = rng.pick(FIRST_NAMES);
      contacts.add(contactId, plan.accountId, locationIds[0] ?? null,
        rolePlaceholder ? null : first, rolePlaceholder ? null : family,
        rolePlaceholder ? null : `${first} ${family}`,
        shape.title, shape.role,
        shape.role === 'owner' ? 'owner' : rng.weighted([['employee', 6], ['officer', 2], ['unknown', 2]]),
        rng.weighted([['CONFIRMED', 3], ['LIKELY', 4], ['UNCERTAIN', 3]]),
        shape.priority <= 2 ? 'PRIMARY_PROCESS_OWNER'
          : shape.priority <= 8 ? 'STRONG_STAKEHOLDER'
          : rng.weighted([['VALID_FALLBACK', 3], ['WEAK', 2]]),
        rng.weighted([['FRESH', 4], ['AGING', 3], ['STALE', 2], ['UNKNOWN', 1]]),
        rolePlaceholder ? 'ROLE_ONLY_TARGET'
          : rng.weighted([['CONFIRMED_CURRENT_ROLE', 2], ['LIKELY_CURRENT_ROLE', 4],
                          ['HISTORICAL_ROLE', 1], ['UNKNOWN_ROLE', 1]]),
        shape.priority, rolePlaceholder, 'ACTIVE', SYNTHETIC_MARKER,
        rng.daysAgo(1, 500, DATASET_ORIGIN));
      ledger.contacts += 1;
      if (rolePlaceholder) ledger.rolePlaceholderContacts += 1;
      if (!rolePlaceholder && shape.role === 'owner') {
        ledger.namedOwnerContacts += 1;
        namedOwner = contactId;
      }
    }

    // --- endpoints ---------------------------------------------------------
    // (account_id, endpoint_type, normalized_value) is unique, so two endpoints on
    // one account must not land on the same number.
    const usedPhones = new Set<string>([plan.mainPhone]);
    const mainEndpointId = randomUUID();
    endpoints.add(mainEndpointId, plan.accountId, null, locationIds[0] ?? null, 'PHONE',
      plan.mainPhone, formatPhone(plan.mainPhone), 'MAIN_BUSINESS_LINE',
      'CURRENT_BUSINESS_CONFIRMED', 'COMPANY_ROUTE', 'COMPANY_WEBSITE',
      plan.domain ? `https://${plan.domain}/contact` : null,
      rng.daysAgo(1, 200, DATASET_ORIGIN), rng.daysAgo(1, 200, DATASET_ORIGIN),
      'fresh', true, rng.weighted([['landline', 5], ['voip', 3], ['unknown', 2]]),
      'SYNTHETIC_LINE_TYPE');
    ledger.endpoints += 1;
    bump(ledger.endpointsByRole, 'MAIN_BUSINESS_LINE');

    let directEndpointId: string | null = null;
    if (rng.bool(0.22)) {
      directEndpointId = randomUUID();
      // One draw per endpoint: drawing again for the display value produced a display
      // string for a different number than the one stored, which is exactly the
      // inconsistency a search-by-phone test is meant to catch in real data.
      const directPhone = uniquePhone(rng, plan, usedPhones);
      endpoints.add(directEndpointId, plan.accountId, namedOwner, locationIds[0] ?? null,
        'PHONE', directPhone, formatPhone(directPhone), 'DIRECT_BUSINESS_LINE',
        'DIRECT_BUSINESS_CONFIRMED', 'DIRECT_CONFIRMED', 'COMPANY_WEBSITE', null,
        rng.daysAgo(1, 120, DATASET_ORIGIN), rng.daysAgo(1, 120, DATASET_ORIGIN),
        'fresh', true, 'landline', 'SYNTHETIC_LINE_TYPE');
      ledger.endpoints += 1;
      bump(ledger.endpointsByRole, 'DIRECT_BUSINESS_LINE');
    }

    if (rng.bool(0.3)) {
      const mobileId = randomUUID();
      const stale = rng.bool(0.35);
      const mobilePhone = uniquePhone(rng, plan, usedPhones);
      endpoints.add(mobileId, plan.accountId, namedOwner, locationIds[0] ?? null, 'PHONE',
        mobilePhone, formatPhone(mobilePhone), 'MOBILE_UNKNOWN_USE',
        stale ? 'STALE' : 'PUBLIC_OBSERVED_UNVERIFIED', 'UNVERIFIED', 'PUBLIC_DIRECTORY',
        null, rng.daysAgo(stale ? 400 : 20, stale ? 900 : 120, DATASET_ORIGIN), null,
        stale ? 'stale' : 'aging', true, 'mobile', 'SYNTHETIC_LINE_TYPE');
      ledger.endpoints += 1;
      bump(ledger.endpointsByRole, 'MOBILE_UNKNOWN_USE');
      if (stale) ledger.staleEndpoints += 1;
    }

    if (rng.bool(0.06)) {
      const wrongId = randomUUID();
      const wrongPhone = uniquePhone(rng, plan, usedPhones);
      endpoints.add(wrongId, plan.accountId, null, locationIds[0] ?? null, 'PHONE',
        wrongPhone, formatPhone(wrongPhone), 'UNKNOWN_PHONE_TYPE',
        'WRONG_NUMBER', 'UNVERIFIED', 'PUBLIC_DIRECTORY', null,
        rng.daysAgo(30, 400, DATASET_ORIGIN), null, 'unknown', true, 'unknown',
        'SYNTHETIC_LINE_TYPE');
      ledger.endpoints += 1;
      ledger.wrongNumberEndpoints += 1;
      bump(ledger.endpointsByRole, 'UNKNOWN_PHONE_TYPE');
    }

    let emailEndpointId: string | null = null;
    let emailAddress: string | null = null;
    if (plan.domain && rng.bool(0.62)) {
      emailEndpointId = randomUUID();
      const local = namedOwner && rng.bool(0.6)
        ? `${rng.pick(FIRST_NAMES).toLowerCase()}`
        : rng.pick(['info', 'office', 'service', 'contact']);
      emailAddress = `${local}@${plan.domain}`;
      const role = local === 'info' || local === 'contact' ? 'GENERAL_BUSINESS_EMAIL'
        : local === 'office' || local === 'service' ? 'ROLE_EMAIL' : 'DIRECT_PERSON_EMAIL';
      endpoints.add(emailEndpointId, plan.accountId,
        role === 'DIRECT_PERSON_EMAIL' ? namedOwner : null, locationIds[0] ?? null,
        'EMAIL', emailAddress, emailAddress, role,
        rng.weighted([['PUBLIC_OBSERVED_CURRENT', 4], ['DOMAIN_VALID_UNVERIFIED', 3],
                      ['GUESSED_UNVERIFIED', 1]]),
        role === 'DIRECT_PERSON_EMAIL' ? 'UNVERIFIED' : 'ROLE_INBOX',
        rng.weighted([['COMPANY_WEBSITE', 5], ['INFERRED_PATTERN', 2]]), null,
        rng.daysAgo(1, 300, DATASET_ORIGIN), null, 'fresh', true, 'unknown', null);
      ledger.endpoints += 1;
      bump(ledger.endpointsByRole, role);
    }

    // --- suppression -------------------------------------------------------
    if (plan.suppressed) {
      suppressionRows.push({
        scope: 'ACCOUNT', accountId: plan.accountId, endpointId: null,
        type: 'DNC', reason: 'Synthetic fixture: asked not to be contacted.',
      });
      ledger.dncAccounts += 1;
      ledger.suppressedAccounts += 1;
    } else if (rng.bool(0.04)) {
      suppressionRows.push({
        scope: 'ENDPOINT', accountId: plan.accountId, endpointId: mainEndpointId,
        type: 'DNC', reason: 'Synthetic fixture: this number is on a registry.',
      });
      ledger.suppressedEndpoints += 1;
    }

    // --- evidence ----------------------------------------------------------
    const evidenceCount = rng.int(2, 6);
    const advertises = plan.advertiserStrength !== 'NONE';
    const advertisingIsStale = advertises && rng.bool(0.3);
    if (advertises) {
      const expires = advertisingIsStale
        ? rng.daysAgo(10, 90, DATASET_ORIGIN)
        : new Date(DATASET_ORIGIN.getTime() + rng.int(5, 60) * 86_400_000);
      evidence.add(randomUUID(), plan.accountId, 'advertising', 'active_google_search_ad',
        `A Google search ad for "${rng.pick(VERTICALS.find((v) => v.id === plan.vertical)!.services)}" showed their site.`,
        'yes', 'confirmed', true, 'serp_observation', SYNTHETIC_MARKER,
        `synthetic-run-${index}`, rng.daysAgo(advertisingIsStale ? 200 : 10, advertisingIsStale ? 500 : 40, DATASET_ORIGIN),
        expires, advertisingIsStale ? 'stale' : 'fresh', 2);
      ledger.evidenceRecords += 1;
      if (advertisingIsStale) { ledger.staleEvidence += 1; ledger.staleAdvertiserOnly += 1; }
      else ledger.advertiserAccounts += 1;
    }
    for (let e = 0; e < evidenceCount; e += 1) {
      const contradicted = rng.bool(0.08);
      const stale = rng.bool(0.2);
      evidence.add(randomUUID(), plan.accountId,
        rng.pick(['hours', 'contact', 'website', 'business_status', 'reviews']),
        rng.pick(['after_hours_answering', 'decision_maker_name', 'website_form',
                  'business_open', 'review_count']),
        `Synthetic observation ${e} for ${plan.name}.`,
        rng.pick(['yes', 'no_confirmed', 'unknown']),
        contradicted ? 'contradicted' : rng.weighted([['confirmed', 3], ['likely', 4], ['unknown', 2]]),
        !contradicted && rng.bool(0.4), rng.pick(['website', 'directory', 'registry']),
        SYNTHETIC_MARKER, `synthetic-run-${index}`,
        rng.daysAgo(stale ? 300 : 5, stale ? 800 : 90, DATASET_ORIGIN),
        stale ? rng.daysAgo(5, 60, DATASET_ORIGIN) : null,
        stale ? 'stale' : rng.weighted([['fresh', 3], ['aging', 2]]),
        rng.int(3, 9));
      ledger.evidenceRecords += 1;
      if (contradicted) ledger.contradictedEvidence += 1;
      if (stale) ledger.staleEvidence += 1;
    }

    // --- hypotheses --------------------------------------------------------
    const verticalShape = VERTICALS.find((v) => v.id === plan.vertical)!;
    const hypothesis = rng.pick(verticalShape.hypotheses);
    hypotheses.add(plan.accountId, hypothesis.category, hypothesis.text,
      [hypothesis.question],
      rng.weighted([['unknown', 5], ['likely', 3], ['confirmed', 1]]),
      1, 'deterministic', true, rng.daysAgo(1, 200, DATASET_ORIGIN));
    ledger.hypotheses += 1;

    scores.add(plan.accountId, 'v1', plan.score, plan.tier,
      JSON.stringify([{ rule_id: 'advertising', points_awarded: advertises ? 4 : 0,
                        points_possible: 5, reason: 'synthetic' }]),
      rng.daysAgo(1, 120, DATASET_ORIGIN));
    completeness.add(plan.accountId, rng.int(20, 95),
      plan.researchFreshness === 'stale' ? 'stale'
        : rng.weighted([['complete', 2], ['good', 4], ['partial', 3], ['thin', 1]]),
      '[]', rng.daysAgo(1, 200, DATASET_ORIGIN));

    // --- activity, follow-ups, opportunity, meetings ------------------------
    const touched = plan.relationshipState !== 'COLD';
    const activityCount = touched ? rng.int(1, 8) : rng.bool(0.25) ? 1 : 0;
    let reachedDecisionMaker = false;
    for (let a = 0; a < activityCount; a += 1) {
      const disposition = rng.weighted<string>([
        ['NO_ANSWER', 8], ['VOICEMAIL', 5], ['GATEKEEPER', 4], ['DECISION_MAKER_REACHED', 3],
        ['SEND_INFORMATION', 2], ['CALLBACK_REQUESTED', 2], ['POSSIBLE_OPPORTUNITY', 1],
        ['NOT_A_FIT', 2], ['WRONG_NUMBER', 1],
      ]);
      if (disposition === 'DECISION_MAKER_REACHED' || disposition === 'POSSIBLE_OPPORTUNITY') {
        reachedDecisionMaker = true;
      }
      activities.add(plan.accountId, contactIds[0] ?? null,
        plan.ownerUserId ?? repIds[0] ?? null, plan.ownerUserId,
        'CALL_ATTEMPT', 'phone', disposition, rng.daysAgo(1, 120, DATASET_ORIGIN),
        `Synthetic activity ${a}.`, SYNTHETIC_MARKER);
      ledger.activities += 1;
      bump(ledger.activitiesByDisposition, disposition);
    }
    if (reachedDecisionMaker) ledger.decisionMakerReachedAccounts += 1;

    if (plan.ownerUserId && rng.bool(0.35)) {
      const overdue = rng.bool(0.4);
      const completed = rng.bool(0.3);
      const dueAt = overdue
        ? rng.daysAgo(1, 20, DATASET_ORIGIN)
        : new Date(DATASET_ORIGIN.getTime() + rng.int(1, 20) * 86_400_000);
      followUps.add(plan.accountId, contactIds[0] ?? null, plan.ownerUserId,
        rng.weighted([['CALLBACK', 5], ['EMAIL', 3], ['RESEARCH', 2], ['GENERAL', 1]]),
        dueAt, plan.market.timezone, completed ? 'COMPLETED' : 'OPEN',
        rng.bool(0.3), 'Synthetic follow-up.', rng.daysAgo(1, 60, DATASET_ORIGIN),
        completed ? rng.daysAgo(1, 10, DATASET_ORIGIN) : null);
      ledger.followUps += 1;
      if (!completed) {
        ledger.openFollowUps += 1;
        if (overdue) ledger.overdueFollowUps += 1;
      }
    }

    let opportunityId: string | null = null;
    if (plan.ownerUserId && reachedDecisionMaker && rng.bool(0.35)) {
      opportunityId = randomUUID();
      const stage = rng.weighted<string>([
        ['DISCOVERY', 5], ['FINANCIAL_DIAGNOSIS', 3], ['STRATEGY', 2],
        ['PROPOSAL_DECISION', 2], ['CLOSED_WON', 1], ['CLOSED_LOST', 2],
      ]);
      const closed = stage === 'CLOSED_WON' || stage === 'CLOSED_LOST';
      opportunities.add(opportunityId, plan.accountId, contactIds[0] ?? null, plan.ownerUserId,
        `${plan.name} — ${verticalShape.label}`, stage,
        'They said two people spend the morning returning calls that came in overnight.',
        'Synthetic confirmed workflow.', 'Synthetic next step.', 'human_rep',
        closed ? (stage === 'CLOSED_WON' ? 'Signed a synthetic engagement.' : 'No business case.') : null,
        rng.daysAgo(5, 90, DATASET_ORIGIN),
        closed ? rng.daysAgo(1, 5, DATASET_ORIGIN) : null);
      stageEvents.add(opportunityId, null, 'DISCOVERY', plan.ownerUserId,
        'Synthetic creation.', rng.daysAgo(5, 90, DATASET_ORIGIN));
      if (stage !== 'DISCOVERY') {
        stageEvents.add(opportunityId, 'DISCOVERY', stage, plan.ownerUserId,
          'Synthetic transition.', rng.daysAgo(1, 5, DATASET_ORIGIN));
      }
      void 0;
      ledger.opportunities += 1;
      bump(ledger.opportunitiesByStage, stage);
    }

    if (plan.ownerUserId && rng.bool(0.12)) {
      const status = rng.weighted<string>([
        ['CONFIRMED', 6], ['PENDING', 2], ['CANCELLED', 1], ['COMPLETED', 3], ['FAILED', 1],
      ]);
      const attended = status === 'COMPLETED'
        ? rng.weighted<string>([['ATTENDED', 7], ['NO_SHOW', 3]])
        : status === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN';
      const confirmed = status === 'CONFIRMED' || status === 'COMPLETED';
      bookings.add(randomUUID(), plan.accountId, contactIds[0] ?? null, plan.ownerUserId,
        'michael@youraidepartment.ai', 'strategy_call', `synthetic-${index}-${rng.int(1, 1e6)}`,
        new Date(DATASET_ORIGIN.getTime() + rng.int(-30, 20) * 86_400_000),
        new Date(DATASET_ORIGIN.getTime() + rng.int(-30, 20) * 86_400_000 + 900_000),
        plan.market.timezone,
        namedOwner ? `Synthetic Attendee ${index}` : null, emailAddress,
        status, 'calcom', confirmed ? `synthetic-event-${index}` : null,
        confirmed ? rng.daysAgo(1, 30, DATASET_ORIGIN) : null,
        attended, 'human_rep', plan.ownerUserId, rng.daysAgo(1, 40, DATASET_ORIGIN));
      ledger.meetings += 1;
      bump(ledger.meetingsByStatus, status);
      if (attended === 'ATTENDED') ledger.attendedMeetings += 1;
    }

    // --- email relationship -------------------------------------------------
    if (emailEndpointId && emailAddress && rng.bool(0.18)) {
      const enrollmentId = randomUUID();
      const replied = rng.bool(0.25);
      const replyClass = replied
        ? rng.weighted<string>([['POSITIVE_INTEREST', 3], ['NOT_INTERESTED', 4],
                                ['UNSUBSCRIBE_OPT_OUT', 1], ['OUT_OF_OFFICE', 2],
                                ['QUESTION', 2], ['WRONG_PERSON', 1]])
        : null;
      enrollments.add(enrollmentId, campaignId, plan.accountId, namedOwner, emailEndpointId,
        emailAddress, `synthetic-lead-${index}`,
        replied ? 'REPLIED' : rng.weighted([['SENT', 4], ['DELIVERED', 4], ['PENDING_EXPORT', 2]]),
        rng.daysAgo(5, 90, DATASET_ORIGIN));
      ledger.emailEnrollments += 1;
      emailEvents.add(enrollmentId, plan.accountId, 'smartlead',
        `synthetic-event-${index}-sent`, 'SENT', null, null, '{}',
        rng.daysAgo(5, 90, DATASET_ORIGIN));
      if (replied) {
        emailEvents.add(enrollmentId, plan.accountId, 'smartlead',
          `synthetic-event-${index}-reply`, 'REPLIED', replyClass,
          'Synthetic reply excerpt.', '{}', rng.daysAgo(1, 40, DATASET_ORIGIN));
        ledger.emailReplies += 1;
        if (replyClass === 'POSITIVE_INTEREST') ledger.positiveReplies += 1;
      }
    }

    // --- call pack, call, hook attempt --------------------------------------
    if (rng.bool(0.08)) {
      const callPackId = randomUUID();
      callPacks.add(callPackId, plan.accountId, contactIds[0] ?? null, plan.vertical, 'v1',
        `Synthetic ${verticalShape.label} company in ${plan.market.city}.`,
        hypothesis.text, hypothesis.category,
        `Synthetic opener for ${plan.name}.`,
        JSON.stringify([{ claim: 'synthetic confirmed fact', source: SYNTHETIC_MARKER }]),
        JSON.stringify(['who answers after hours']),
        JSON.stringify([hypothesis.question]),
        JSON.stringify(['we already have someone for that']),
        JSON.stringify([]),
        JSON.stringify(['no invented pricing', 'no invented customers']),
        JSON.stringify(['offer a strategy call']),
        rng.daysAgo(1, 60, DATASET_ORIGIN));
      ledger.callPacks += 1;

      const callId = randomUUID();
      const outcome = rng.weighted<string>([
        ['NO_ANSWER', 5], ['VOICEMAIL', 3], ['CONNECTED', 4], ['GATEKEEPER', 2],
        ['BOOKED', 1], ['NO_SALE', 2], ['DNC', 1], ['WRONG_NUMBER', 1],
      ]);
      const connected = outcome !== 'NO_ANSWER' && outcome !== 'WRONG_NUMBER';
      const startedAt = rng.daysAgo(1, 60, DATASET_ORIGIN);
      calls.add(callId, 'OUTBOUND', 'yad-sales-core-v1', 'v1', 'DRY_RUN', plan.accountId,
        contactIds[0] ?? null, mainEndpointId, callPackId, `SYNTHETIC-CA-${index}`,
        '+19045550100', plan.mainPhone, startedAt,
        connected ? new Date(startedAt.getTime() + 8_000) : null,
        new Date(startedAt.getTime() + rng.int(20, 400) * 1_000),
        rng.int(20, 400), outcome,
        JSON.stringify({ end_of_turn_to_first_token: [rng.int(600, 1400)] }),
        rng.bool(0.5) ? rng.int(40, 95) : null, rng.bool(0.1),
        rng.bool(0.3) ? rng.pick(['opener', 'dialogue', 'research', 'latency']) : null,
        rng.bool(0.5) ? (managerIds[0] ?? null) : null,
        rng.bool(0.5) ? rng.daysAgo(1, 30, DATASET_ORIGIN) : null);
      ledger.voiceCalls += 1;
      if (connected) ledger.voiceCallsConnected += 1;
      turns.add(callId, 0, 'AGENT', 'Synthetic opener.', 400, 'opener.v1');
      turns.add(callId, 1, 'PROSPECT', 'Synthetic prospect reply.', 2100, null);

      const opener = rng.pick(['opener.observation.v1', 'opener.referral.v1', 'opener.direct.v1']);
      const humanAnswered = connected;
      const rightStakeholder = humanAnswered && rng.bool(0.45);
      const problemSupported = rightStakeholder && rng.bool(0.4);
      const offered = problemSupported && rng.bool(0.6);
      const accepted = offered && rng.bool(0.5);
      const booked = accepted && rng.bool(0.8);
      const attended = booked && rng.bool(0.7);
      const scored = attended && rng.bool(0.7);
      hooks.add(randomUUID(), plan.accountId, contactIds[0] ?? null, mainEndpointId, callId,
        opener, rng.pick(['observation', 'referral', 'direct']), hypothesis.category,
        hypothesis.category, 'named_via_main_line', plan.vertical,
        rng.pick(['MORNING_8_10', 'MIDDAY_10_12', 'MIDDAY_12_14', 'AFTERNOON_14_17']),
        'yad-sales-core-v1', 'v1', plan.tier,
        advertises ? 'OBSERVED_PAID' : 'NONE_OBSERVED', startedAt,
        connected ? startedAt : null, humanAnswered ? startedAt : null,
        rightStakeholder ? startedAt : null, rightStakeholder && rng.bool(0.7) ? startedAt : null,
        rightStakeholder && rng.bool(0.5) ? startedAt : null,
        problemSupported ? startedAt : null, offered ? startedAt : null,
        accepted ? startedAt : null, booked ? startedAt : null,
        attended ? startedAt : null, opportunityId ? startedAt : null,
        outcome === 'DNC' ? startedAt : null,
        outcome, scored ? rng.int(1, 5) : null,
        scored ? rng.daysAgo(1, 20, DATASET_ORIGIN) : null,
        attended ? rng.pick(['DECISION_MAKER', 'PROCESS_OWNER', 'INFLUENCER', 'WRONG_STAKEHOLDER']) : null,
        attended ? rng.pick(['CONFIRMED', 'PARTIALLY_CONFIRMED', 'NOT_CONFIRMED']) : 'NOT_EVALUATED');
      ledger.hookAttempts += 1;
      bump(ledger.hookAttemptsByOpener, opener);
      if (booked) ledger.bookedFromHooks += 1;
      if (attended) ledger.attendedFromHooks += 1;
    }

    // --- ownership ledger ---------------------------------------------------
    if (plan.ownerUserId) {
      ownershipEvents.add(plan.accountId, 'CLAIMED', null, plan.ownerUserId,
        plan.ownerUserId, 'Synthetic claim.', rng.daysAgo(1, 60, DATASET_ORIGIN));
      ledger.ownershipEvents += 1;
      if (rng.bool(0.1)) {
        const newOwner = rng.pick(repIds);
        ownershipEvents.add(plan.accountId, 'REASSIGNED', plan.ownerUserId, newOwner,
          managerIds[0] ?? plan.ownerUserId, 'Synthetic rebalance.',
          rng.daysAgo(1, 20, DATASET_ORIGIN));
        ledger.ownershipEvents += 1;
      }
    }
  }

  await withTransaction(async (client) => {
    await accounts.flush(client);
    await domains.flush(client);
    await identities.flush(client);
    await locations.flush(client);
    await contacts.flush(client);
    await endpoints.flush(client);
    await evidence.flush(client);
    await hypotheses.flush(client);
    await scores.flush(client);
    await completeness.flush(client);
    await activities.flush(client);
    await followUps.flush(client);
    await opportunities.flush(client);
    await stageEvents.flush(client);
    await bookings.flush(client);
    await enrollments.flush(client);
    await emailEvents.flush(client);
    await callPacks.flush(client);
    await calls.flush(client);
    await turns.flush(client);
    await hooks.flush(client);
    await ownershipEvents.flush(client);
  });

  // Suppressions last and outside the batch: each row fires a trigger that rewrites
  // the Account, and the trigger is the behaviour under test elsewhere.
  if (suppressionRows.length > 0) {
    await withTransaction(async (client) => {
      for (const row of suppressionRows) {
        await client.query(
          `insert into suppressions (scope, account_id, endpoint_id, suppression_type,
                                     source, reason, is_active)
           values ($1, $2, $3, $4, $5, $6, true)`,
          [row.scope, row.accountId, row.endpointId, row.type, SYNTHETIC_MARKER, row.reason]);
      }
    });
  }

  for (const plan of plans) {
    ledger.accounts += 1;
    bump(ledger.accountsByVertical, plan.vertical);
    bump(ledger.accountsByPostalCode, plan.market.postalCode);
    bump(ledger.accountsByTier, plan.tier);
    if (plan.ownerUserId) ledger.claimedAccounts += 1;
    else if (!plan.suppressed) ledger.unclaimedAccounts += 1;
  }
}

function freshUntilFor(freshness: AccountPlan['researchFreshness'], rng: Rng): Date | null {
  switch (freshness) {
    case 'fresh': return new Date(DATASET_ORIGIN.getTime() + rng.int(10, 90) * 86_400_000);
    case 'aging': return new Date(DATASET_ORIGIN.getTime() + rng.int(1, 9) * 86_400_000);
    case 'stale': return rng.daysAgo(10, 200, DATASET_ORIGIN);
    default: return null;
  }
}

export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '').slice(-10);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * One account's shape.
 *
 * Duplicate and near-duplicate names are deliberate and deterministic: every
 * seventieth account repeats an earlier name with different punctuation or a
 * different suffix, which is what dedupe and search ranking have to cope with.
 */
function planAccount(
  rng: Rng, index: number, repIds: string[], ledger: DatasetLedger,
): AccountPlan {
  const vertical = VERTICALS[index % VERTICALS.length]!;
  const market = MARKETS[Math.floor(index / VERTICALS.length) % MARKETS.length]!;

  const prefix = NAME_PREFIXES[(index * 7 + rng.int(0, 3)) % NAME_PREFIXES.length]!;
  const noun = rng.pick(vertical.nouns);
  const suffix = rng.pick(SUFFIXES);
  let name = `${prefix} ${noun}${suffix ? ` ${suffix}` : ''}`.trim();

  // A duplicate of an earlier company, differing only in punctuation or suffix.
  const isDuplicate = index > 0 && index % 70 === 0;
  if (isDuplicate) {
    const twinRng = new Rng(ledger.seed, 'account', index - 1);
    const twinPrefix = NAME_PREFIXES[((index - 1) * 7 + twinRng.int(0, 3)) % NAME_PREFIXES.length]!;
    const twinVertical = VERTICALS[(index - 1) % VERTICALS.length]!;
    name = `${twinPrefix} ${twinRng.pick(twinVertical.nouns)}, ${rng.pick(['LLC', 'Inc.', 'Co.'])}`;
    ledger.duplicatePairs += 1;
  }

  const tier = rng.weighted<'A' | 'B' | 'C' | 'D'>([['A', 1], ['B', 3], ['C', 4], ['D', 2]]);
  const score = tier === 'A' ? rng.int(13, 15) : tier === 'B' ? rng.int(10, 12)
    : tier === 'C' ? rng.int(6, 9) : rng.int(0, 5);
  const advertiserStrength = rng.weighted<'NONE' | 'WEAK' | 'MODERATE' | 'STRONG'>(
    [['NONE', 4], ['WEAK', 2], ['MODERATE', 3], ['STRONG', 1]]);
  const researchFreshness = rng.weighted<'fresh' | 'aging' | 'stale' | 'unknown'>(
    [['fresh', 5], ['aging', 3], ['stale', 2], ['unknown', 1]]);

  const suppressed = rng.bool(0.03);
  const claimed = !suppressed && rng.bool(0.28);
  const ownerUserId = claimed ? rng.pick(repIds) : null;
  const relationshipState = ownerUserId
    ? rng.weighted([['COLD', 4], ['CONTACTED', 3], ['ENGAGED', 2], ['CALLBACK_REQUESTED', 1],
                    ['POSITIVE_REPLY', 1], ['MEETING_SCHEDULED', 1]])
    : suppressed ? 'DISQUALIFIED' : 'COLD';
  const ownershipState = suppressed ? 'SUPPRESSED' : ownerUserId ? 'CLAIMED' : 'UNCLAIMED';

  const accountType = rng.weighted([
    ['independent_business', 8], ['multi_location_business', 2], ['franchise_location_group', 1],
  ]);
  const locationCount = accountType === 'franchise_location_group' ? rng.int(3, 20)
    : accountType === 'multi_location_business' ? rng.int(2, 4) : 1;

  const hasDomain = rng.bool(0.82);
  const domain = hasDomain ? syntheticDomain(name, index) : null;

  // Every ninetieth account shares its main line with the previous one: the same
  // number reaching two businesses is a real and awkward case.
  const sharesPhone = index > 0 && index % 90 === 0;
  const phoneRng = sharesPhone ? new Rng(ledger.seed, 'phone', index - 1) : new Rng(ledger.seed, 'phone', index);
  if (sharesPhone) ledger.sharedPhonePairs += 1;
  const mainPhone = syntheticPhone(phoneRng, market.areaCode);

  return {
    accountId: randomUUID(), name, normalized: normalizeForCompare(name),
    vertical: vertical.id, market, tier, score, advertiserStrength, researchFreshness,
    accountType, locationCount, domain, mainPhone, ownerUserId, ownershipState,
    relationshipState, suppressed,
  };
}
