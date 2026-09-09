import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { analyzeForm, type IneligibleReason } from './forms.js';
import { FIXTURE_FORMS, parseFormHtml, fixtureForm } from './fixtures.js';
import { planProbe, type PlanRefusal } from './ledger.js';
import { dryRunSubmit, liveBlockers } from './submitter.js';
import { ingestProbeInboundEvent } from './inbound.js';
import { closeWindow } from './inbound.js';
import { measureLatency, weekdayHours, formatDuration } from './latency.js';
import { probeHookFor, publishProbeEvidence } from './publish.js';
import type { ProbeStatus } from './states.js';

/**
 * What would happen to a hundred prospects, run end to end, sending nothing.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §21.
 *
 * This is the acceptance gate and the operator packet at once. It seeds synthetic
 * companies, runs them through the real planner, the real form analyzer, the real
 * allocator, the real ladder and the real evidence layer, and reports what came out.
 *
 * Everything it touches is synthetic: names are obviously fixtures, domains are
 * `.example`, and every phone number is in the 555 range that cannot be dialled. No
 * real company is named and no real customer data is read, which is what makes it
 * safe to run and safe to paste into an issue.
 */

const FIXTURE_PHONE_PREFIX = '+1904555';

export interface BatchOptions {
  size?: number;
  now?: Date;
  /** Deterministic seeding, so two runs of the packet agree. */
  poolSize?: number;
}

export interface ProspectPlan {
  label: string;
  accountId: string;
  verticalProfileId: string;
  formKey: string;
  cluster: string | null;
  probeId: string | null;
  planRefusal: PlanRefusal | null;
  ineligibleReason: IneligibleReason | null;
  allocatedNumber: string | null;
  allocationRefusal: string | null;
  status: ProbeStatus | null;
  payloadDigest: string | null;
  responseSummary: string;
  attribution: string;
  evidence: string[];
  hookLine: string | null;
}

/**
 * Every prospect in exactly one bucket, summing to the batch size.
 *
 * The stage counters below it are *stage* counts and overlap by design -- a probe
 * that was prepared, acknowledged and then answered appears in three of them. Read
 * as terminal counts they do not add up, and a report whose numbers do not add up
 * invites the reader to assume the awkward rows were dropped. This partition is the
 * answer to "where is each of the hundred right now".
 */
export interface Reconciliation {
  total: number;
  refusedBeforePlanning: number;
  formIneligible: number;
  deferredAwaitingNumber: number;
  preparationFailed: number;
  awaitingManualResolution: number;
  terminalAttributed: number;
  terminalNoResponse: number;
  terminalAmbiguous: number;
  cancelled: number;
  /** Anything the partition failed to classify. Must be zero. */
  unaccounted: number;
  balances: boolean;
}

export interface BatchReport {
  ranAt: string;
  size: number;
  poolNumbers: string[];
  counts: Record<string, number>;
  ineligibleByReason: Record<string, number>;
  refusalsByReason: Record<string, number>;
  statusCounts: Record<string, number>;
  prospects: ProspectPlan[];
  reconciliation: Reconciliation;
  liveBlockedBy: string[];
  submissionsActuallySent: 0;
  publishAttempts: { probeId: string; refusal: string | null; detail: string }[];
  worked: { label: string; hookLine: string | null; evidence: string[] }[];
}

/** Verticals for the batch, including two that are categorically excluded. */
const VERTICAL_MIX: readonly string[] = [
  // The five approved for V1 ...
  'hvac', 'roofing', 'plumbing', 'collision-repair', 'real-estate-brokerages',
  'hvac', 'roofing', 'plumbing', 'hvac',
  // ... plus two the registry really has and V1 really refuses: one categorically
  // excluded, one simply not approved yet. Both must appear in the packet.
  'law-firms', 'garage-door',
];

const FORM_MIX: readonly string[] = FIXTURE_FORMS.map((form) => form.key);

/**
 * The first fourteen rows are fixed so the interesting cases actually occur.
 *
 * Rotating both vertical and form by index looks fair and is not: the cluster ended
 * up with mostly ineligible forms, so nothing ever contended for a number, and the
 * report showed zero deferrals for a subsystem whose main refusal is deferral.
 */
function verticalFor(index: number): string {
  if (index < 14) return 'hvac';
  return VERTICAL_MIX[index % VERTICAL_MIX.length]!;
}

function formFor(index: number): string {
  if (index < 14) return 'ordinary';
  return FORM_MIX[index % FORM_MIX.length]!;
}

/**
 * Genuine T4 ambiguity, which the main batch cannot produce.
 *
 * Two similarly named companies must be open on the *same* pool number for a
 * name-only callback to be ambiguous, and the allocator's fewest-open tie-break
 * deliberately spreads non-colliding probes across the pool instead -- so under a
 * comfortable pool they never share, and a name-only callback merely fails to
 * attribute. Sharing begins when the pool is tight, which is exactly when this risk
 * appears. A one-number pool is the smallest honest way to show it, and it is the
 * real allocator doing the placing.
 */
async function ambiguityDemo(now: Date, identityId: string): Promise<{
  state: string; candidates: number; detail: string;
}> {
  const { rows } = await query<{ pool_number_id: string; e164: string }>(
    `insert into probe_pool_numbers (e164, market_affinity, execution_mode)
     values ('+19045558001','ambiguity-demo','DRY_RUN') returning pool_number_id, e164`);
  const poolE164 = rows[0]!.e164;
  // Every other number is out of the running, so the two probes must share this one.
  await query(
    `update probe_pool_numbers set status = 'QUARANTINED'
      where e164 <> $1`, [poolE164]);

  const form = parseFormHtml(fixtureForm('ordinary').html, 'https://twins.example/contact');
  const eligibility = analyzeForm({ form, verticalProfileId: 'hvac' });
  const twins = ['Coastal Air Services', 'Coastal Air and Heating'];
  for (const [offset, name] of twins.entries()) {
    const { rows: created } = await query<{ account_id: string }>(
      `insert into accounts (canonical_name, normalized_name, canonical_domain,
                             primary_vertical_profile_id, account_type)
       values ($1,$2,$3,'hvac','independent_business') returning account_id`,
      [name, name.toLowerCase(), `twin-${offset}.example`]);
    const accountId = created[0]!.account_id;
    await query(
      `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
         display_value, endpoint_role, quality_state, endpoint_source, freshness)
       values ($1,'PHONE',$2,$2,'MAIN_BUSINESS_LINE','PUBLIC_OBSERVED_UNVERIFIED',
               'COMPANY_WEBSITE','fresh')`,
      [accountId, `+1904555810${offset}`]);
    const plan = await planProbe({
      accountId, eligibility, targetFormUrl: form.url, identityId, now });
    await dryRunSubmit({
      probeId: plan.probeId!, form, identityName: 'A. Fixture',
      emailAlias: `probe+twin${offset}@probes.example`,
      verticalProfileId: 'hvac', now });
  }

  const result = await ingestProbeInboundEvent({
    providerSid: 'CA-ambiguity-demo', channel: 'CALL', fromNumber: null,
    toNumber: poolE164, callDisposition: 'ANSWERED',
    identificationAnswer: 'Coastal Air',
    occurredAt: new Date(now.getTime() + 5 * 3_600_000),
  });

  await query(`update probe_pool_numbers set status = 'ACTIVE' where status = 'QUARANTINED'`);
  return {
    state: result.attribution.state,
    candidates: result.attribution.candidateProbeIds.length,
    detail: result.detail,
  };
}

/**
 * Which response story a probe gets.
 *
 * `index % 5` looked obvious and was wrong: form eligibility cycles every ten, so a
 * modulus of five is correlated with it and scenarios 3 and 4 never occurred at all
 * -- the report claimed zero no-response probes for a subsystem whose most likely
 * real outcome is no response. Dividing by ten instead fixed that only for a batch
 * of a hundred; a batch of forty could not reach scenario 4, so the acceptance test
 * asserted a category the fixture could never produce.
 *
 * Grouping in threes gives all five stories inside the first forty rows, verified
 * against the eligible index set rather than reasoned about.
 */
function scenarioFor(index: number): number {
  return Math.floor(index / 3) % 5;
}

interface SeededAccount {
  accountId: string;
  label: string;
  cluster: string | null;
}

/**
 * Synthetic companies, some of which share a phone system.
 *
 * The clusters are the point of the exercise: a market of independents never
 * exercises the allocator, and the allocator is where the interesting refusal lives.
 */
async function seedAccounts(size: number): Promise<SeededAccount[]> {
  const seeded: SeededAccount[] = [];
  for (let index = 0; index < size; index += 1) {
    const vertical = verticalFor(index);
    // One franchise cluster of twelve, all sharing a toll-free line, against a pool
    // of ten. Twelve colliding probes cannot all be placed, which is the whole point:
    // a smaller cluster would simply spread across the pool and defer nothing, and
    // the deferral is the behaviour worth demonstrating.
    // Fourteen, not twelve: two of them are consumed by the deliberate server error
    // and the deliberate crash, and a cluster of twelve then fitted the pool exactly
    // and deferred nothing.
    const cluster = index < 14 ? 'cluster-a' : null;
    const label = `Probe Fixture ${String(index + 1).padStart(3, '0')}`;

    const accountId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ account_id: string }>(
        `insert into accounts (canonical_name, normalized_name, canonical_domain,
                               primary_vertical_profile_id, account_type)
         values ($1,$2,$3,$4,'independent_business') returning account_id`,
        [label, label.toLowerCase().replace(/\W+/g, ' ').trim(),
         `fixture-${index + 1}.example`, vertical]);
      const accountId = rows[0]!.account_id;

      const main = `${FIXTURE_PHONE_PREFIX}${String(1000 + index).slice(-4)}`;
      await client.query(
        `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
           display_value, endpoint_role, quality_state, endpoint_source, freshness)
         values ($1,'PHONE',$2,$2,'MAIN_BUSINESS_LINE','PUBLIC_OBSERVED_UNVERIFIED',
                 'COMPANY_WEBSITE','fresh')`,
        [accountId, main]);

      if (cluster) {
        // One shared toll-free number per cluster. This is what makes five companies
        // one collision domain.
        const shared = cluster === 'cluster-a' ? `${FIXTURE_PHONE_PREFIX}0001`
                                               : `${FIXTURE_PHONE_PREFIX}0002`;
        await client.query(
          `insert into contact_endpoints (account_id, endpoint_type, normalized_value,
             display_value, endpoint_role, quality_state, endpoint_source, freshness)
           values ($1,'PHONE',$2,$2,'TOLL_FREE_BUSINESS','PUBLIC_OBSERVED_UNVERIFIED',
                   'COMPANY_WEBSITE','fresh')`,
          [accountId, shared]);
      }
      return accountId;
    });

    seeded.push({ accountId, label, cluster });
  }
  return seeded;
}

async function ensurePool(size: number, now: Date): Promise<string[]> {
  const numbers: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const e164 = `${FIXTURE_PHONE_PREFIX}${String(9000 + index).slice(-4)}`;
    await query(
      `insert into probe_pool_numbers (e164, market_affinity, execution_mode)
       values ($1,'jacksonville','DRY_RUN') on conflict (e164) do nothing`, [e164]);
    numbers.push(e164);
  }
  void now;
  return numbers;
}

async function ensureIdentity(): Promise<string> {
  const { rows } = await query<{ probe_identity_id: string }>(
    `insert into probe_identities (full_name, approved_by, notes)
     values ('A. Fixture', 'operator packet',
             'Synthetic identity used only by the dry-run packet.')
     on conflict (full_name, version) do update set is_active = true
     returning probe_identity_id`);
  return rows[0]!.probe_identity_id;
}

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

/**
 * Run the batch.
 *
 * Written as one pass rather than staged jobs so the report can say, per prospect,
 * exactly where it stopped and why. In production these are separate worker steps;
 * the sequence is the same.
 */
/**
 * Clear the previous run.
 *
 * The packet is meant to be run repeatedly while reading it, so it starts from a
 * known state rather than colliding with its own leftovers. Safe because the CLI
 * refuses to run against the live database at all -- this only ever truncates a
 * scratch one.
 */
async function resetFixtures(): Promise<void> {
  await query(`truncate table
    probe_state_events, probe_inbound_events, lead_response_probes,
    probe_pool_numbers, probe_identities, evidence_records, suppressions,
    contact_endpoints, contacts, locations, accounts
    restart identity cascade`);
}

export async function simulateBatch(options: BatchOptions = {}): Promise<BatchReport> {
  await resetFixtures();
  const size = options.size ?? 100;
  const now = options.now ?? new Date('2026-09-08T22:03:00Z');
  const poolNumbers = await ensurePool(options.poolSize ?? 10, now);
  const identityId = await ensureIdentity();
  const accounts = await seedAccounts(size);

  const counts: Record<string, number> = {};
  const ineligibleByReason: Record<string, number> = {};
  const refusalsByReason: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const prospects: ProspectPlan[] = [];
  const publishAttempts: BatchReport['publishAttempts'] = [];

  // Pre-existing conditions: three companies already cooled down, one asked not to be
  // audited. Both are ordinary states and both must refuse.
  for (const account of accounts.slice(30, Math.min(33, size))) {
    await query(
      `insert into lead_response_probes (account_id, probe_token, status, cooldown_until,
                                          execution_mode)
       values ($1,$2,'ATTRIBUTED',$3,'DRY_RUN')`,
      [account.accountId, `cooldown-${account.accountId.slice(0, 8)}`,
       new Date(now.getTime() + 90 * 24 * 3_600_000)]);
  }
  if (accounts[35]) {
    await query(
      `insert into suppressions (scope, account_id, suppression_type, source, reason)
       values ('ACCOUNT', $1, 'PROBE_AUDIT', 'PROSPECT_REQUEST',
               'Asked not to be audited again.')`,
      [accounts[35].accountId]);
  }

  /**
   * Pass one: plan and prepare every probe before any of them closes.
   *
   * This is not a stylistic choice. Running each prospect end to end -- submit,
   * respond, close -- freed its pool number before the next one asked for one, so
   * nothing ever contended and the report showed zero deferrals for a subsystem
   * whose principal refusal is deferral. A real night holds every probe open for
   * a day and a half at once, and the allocator has to be exercised that way.
   */
  const submitted: { row: ProspectPlan; index: number; probeId: string; poolE164: string }[] = [];
  let plannedCount = 0;

  for (const [index, account] of accounts.entries()) {
    const vertical = verticalFor(index);
    const formKey = formFor(index);
    const fixture = fixtureForm(formKey);
    const form = parseFormHtml(fixture.html, `https://fixture-${index + 1}.example/contact`);
    const eligibility = analyzeForm({ form, verticalProfileId: vertical });

    const plan = await planProbe({
      accountId: account.accountId, eligibility, targetFormUrl: form.url,
      geographyType: 'zip_zcta', geographyValue: '32256',
      paidAdEvidenceIds: [], identityId, now,
    });

    const row: ProspectPlan = {
      label: account.label, accountId: account.accountId,
      verticalProfileId: vertical, formKey, cluster: account.cluster,
      probeId: plan.probeId, planRefusal: plan.refusal,
      ineligibleReason: eligibility.reason,
      allocatedNumber: null, allocationRefusal: null, status: null,
      payloadDigest: null, responseSummary: 'not reached', attribution: 'n/a',
      evidence: [], hookLine: null,
    };

    if (!plan.planned) {
      bump(refusalsByReason, plan.refusal ?? 'UNKNOWN');
      if (plan.refusal === 'FORM_INELIGIBLE' && eligibility.reason) {
        bump(ineligibleByReason, eligibility.reason);
      }
      row.status = plan.probeId ? 'FAILED' : null;
      row.responseSummary = plan.detail;
      prospects.push(row);
      continue;
    }
    bump(counts, 'eligible_planned');
    plannedCount += 1;

    // One deliberate server error and one deliberate crash, so both appear in the
    // packet rather than only in the suite.
    //
    // Chosen by ordinal rather than by absolute index. Pinning them to index 40 and
    // 41 meant a batch smaller than that produced neither, and the acceptance test
    // asserted two categories the fixture could not reach. Ordinals 3 and 4 are
    // inside the first ten prepared probes, so their allocation always succeeds.
    const simulate = plannedCount === 3 ? { kind: 'SERVER_ERROR' as const, statusCode: 500 }
      : plannedCount === 4 ? { kind: 'CRASH_BEFORE_CONFIRMATION' as const }
      : undefined;

    const dry = await dryRunSubmit({
      probeId: plan.probeId!, form, identityName: 'A. Fixture',
      emailAlias: `probe+${plan.probeId!.slice(0, 16)}@probes.example`,
      verticalProfileId: vertical, zipOrCity: '32256', now,
      simulate, marketAffinity: 'jacksonville',
    });
    row.allocatedNumber = dry.poolNumberE164;
    row.status = dry.status;
    row.payloadDigest = dry.payloadDigest;

    if (!dry.poolNumberE164) {
      row.allocationRefusal = dry.detail;
      bump(counts, 'collision_deferred');
      bump(statusCounts, dry.status);
      row.responseSummary = dry.detail;
      prospects.push(row);
      continue;
    }
    if (dry.status === 'FAILED') {
      bump(counts, 'submit_failed_simulated');
      bump(statusCounts, dry.status);
      row.responseSummary = dry.detail;
      prospects.push(row);
      continue;
    }
    if (dry.status === 'SUBMITTING') {
      bump(counts, 'awaiting_manual_resolution');
      bump(statusCounts, dry.status);
      row.responseSummary = dry.detail;
      prospects.push(row);
      continue;
    }

    bump(counts, 'simulated_submissions');
    submitted.push({ row, index, probeId: plan.probeId!, poolE164: dry.poolNumberE164 });
  }

  // --- pass two: responses arrive, then the windows close ------------------------
  for (const item of submitted) {
    const { row, index, probeId, poolE164 } = item;
    const scenario = scenarioFor(index);
    const submittedAt = now;
    let summary = '';

    if (scenario !== 4) {
      const ack = await ingestProbeInboundEvent({
        providerSid: `SM-ack-${probeId}`,
        channel: 'SMS',
        fromNumber: `${FIXTURE_PHONE_PREFIX}${String(1000 + index).slice(-4)}`,
        toNumber: poolE164,
        body: 'Thanks for contacting us! A representative will be in touch shortly.',
        occurredAt: new Date(submittedAt.getTime() + 4_000),
      });
      summary += `auto-ack ${ack.actorType} @+4s`;
      bump(counts, 'simulated_automated_acknowledgements');
    }

    if (scenario === 0 || scenario === 1) {
      const at = new Date(submittedAt.getTime() + 16 * 3_600_000 + 4 * 60_000);
      const human = await ingestProbeInboundEvent({
        providerSid: `CA-human-${probeId}`,
        channel: 'CALL',
        fromNumber: `${FIXTURE_PHONE_PREFIX}${String(1000 + index).slice(-4)}`,
        toNumber: poolE164, callDisposition: 'ANSWERED',
        identificationAnswer: row.label, twoWay: true, occurredAt: at,
      });
      summary += `; human call ${human.attribution.tier} @+16h04m`;
      bump(counts, 'simulated_human_callbacks');

      if (scenario === 0) {
        const hours = weekdayHours({
          timeZone: 'America/New_York', open: '08:00', close: '17:00',
          source: 'OPERATOR_CONFIRMED',
        });
        const measured = measureLatency({ submittedAt, respondedAt: at, hours });
        await query(
          `update lead_response_probes
              set business_hours_adjusted_seconds = $2, business_hours_source = $3,
                  business_hours = $4::jsonb, submitted_outside_business_hours = $5
            where probe_id = $1`,
          [probeId, measured.businessHoursAdjustedSeconds, measured.businessHoursSource,
           JSON.stringify(hours), measured.submittedOutsideBusinessHours]);
        bump(counts, 'business_hours_known');
      } else {
        bump(counts, 'business_hours_unknown');
      }
    }

    if (scenario === 2) {
      const at = new Date(submittedAt.getTime() + 5 * 3_600_000);
      const ambiguous = await ingestProbeInboundEvent({
        providerSid: `CA-amb-${probeId}`,
        channel: 'CALL', fromNumber: null, toNumber: poolE164,
        callDisposition: 'ANSWERED', identificationAnswer: 'Coastal Air',
        occurredAt: at,
      });
      summary += `; unknown-ANI call -> ${ambiguous.attribution.state}`;
      // Two different failures, counted apart. "Nothing matched" is an event that may
      // have nothing to do with any probe; "more than one matched" is our allocation
      // letting two confusable probes share a number.
      if (ambiguous.attribution.state === 'AMBIGUOUS') bump(counts, 'ambiguous_callbacks');
      if (ambiguous.attribution.state === 'UNATTRIBUTED') bump(counts, 'unattributed_callbacks');
    }

    if (scenario === 4) {
      summary = 'no response of any kind';
      bump(counts, 'no_attributable_response');
    }

    await closeWindow({
      probeId, window: 1, now: new Date(submittedAt.getTime() + 4 * 3_600_000) });
    const finalStatus = await closeWindow({
      probeId, window: 'FINAL', now: new Date(submittedAt.getTime() + 72 * 3_600_000) });
    row.status = finalStatus;
    bump(statusCounts, finalStatus);
    row.responseSummary = summary || 'none';

    const attempt = await publishProbeEvidence({ probeId, now });
    publishAttempts.push({ probeId, refusal: attempt.refusal, detail: attempt.detail });

    // The packet is the one caller allowed to read simulated rows, and it says so.
    const hook = await probeHookFor(row.accountId, { includeSimulated: true });
    row.hookLine = hook.hookLine;
    row.evidence = hook.evidenceLines;
    row.attribution = hook.detail;
    prospects.push(row);
  }

  const ambiguity = await ambiguityDemo(now, identityId);
  if (ambiguity.state === 'AMBIGUOUS') bump(counts, 'ambiguous_callbacks');
  counts['ambiguity_demo_candidates'] = ambiguity.candidates;

  const worked = prospects
    .filter((row) => row.evidence.length > 0)
    .slice(0, 4)
    .map((row) => ({ label: row.label, hookLine: row.hookLine, evidence: row.evidence }));

  return {
    ranAt: now.toISOString(), size, poolNumbers, counts, ineligibleByReason,
    refusalsByReason, statusCounts, prospects, reconciliation: reconcile(prospects, size),
    liveBlockedBy: liveBlockers(),
    submissionsActuallySent: 0, publishAttempts, worked,
  };
}

/**
 * Partition the batch. One bucket each, and it must balance.
 *
 * Order matters: a probe refused before planning has no status, so the refusal is
 * checked first. Everything else is classified by the state it is actually in.
 */
export function reconcile(prospects: readonly ProspectPlan[], total: number): Reconciliation {
  let refusedBeforePlanning = 0;
  let formIneligible = 0;
  let deferredAwaitingNumber = 0;
  let preparationFailed = 0;
  let awaitingManualResolution = 0;
  let terminalAttributed = 0;
  let terminalNoResponse = 0;
  let terminalAmbiguous = 0;
  let cancelled = 0;
  let unaccounted = 0;

  for (const row of prospects) {
    if (row.planRefusal === 'FORM_INELIGIBLE') { formIneligible += 1; continue; }
    if (row.planRefusal) { refusedBeforePlanning += 1; continue; }
    switch (row.status) {
      case 'PLANNED': case 'AUTHORIZED': deferredAwaitingNumber += 1; break;
      case 'FAILED': preparationFailed += 1; break;
      case 'SUBMITTING': awaitingManualResolution += 1; break;
      case 'ATTRIBUTED': terminalAttributed += 1; break;
      case 'NO_RESPONSE_FINAL': case 'NO_RESPONSE_WINDOW_1': terminalNoResponse += 1; break;
      case 'AMBIGUOUS': terminalAmbiguous += 1; break;
      case 'CANCELLED': cancelled += 1; break;
      default: unaccounted += 1; break;
    }
  }

  const sum = refusedBeforePlanning + formIneligible + deferredAwaitingNumber
    + preparationFailed + awaitingManualResolution + terminalAttributed
    + terminalNoResponse + terminalAmbiguous + cancelled + unaccounted;

  return {
    total, refusedBeforePlanning, formIneligible, deferredAwaitingNumber,
    preparationFailed, awaitingManualResolution, terminalAttributed,
    terminalNoResponse, terminalAmbiguous, cancelled, unaccounted,
    balances: sum === total && unaccounted === 0,
  };
}

export function renderBatchReport(report: BatchReport): string {
  const out: string[] = [];
  const pad = (label: string, value: string | number): string =>
    `  ${label.padEnd(42)} ${value}`;

  out.push('SPEED-TO-LEAD PROBE — DRY RUN OPERATOR PACKET');
  out.push(`  simulated batch of ${report.size}, as at ${report.ranAt}`);
  out.push(`  pool: ${report.poolNumbers.length} numbers (${report.poolNumbers[0]} … ${report.poolNumbers.at(-1)})`);
  out.push('');
  const r = report.reconciliation;
  out.push('=== where each of the ' + r.total + ' prospects ended up (one bucket each)');
  out.push(pad('refused before planning', r.refusedBeforePlanning));
  out.push(pad('form ineligible', r.formIneligible));
  out.push(pad('deferred, awaiting a pool number', r.deferredAwaitingNumber));
  out.push(pad('preparation failed', r.preparationFailed));
  out.push(pad('awaiting manual resolution', r.awaitingManualResolution));
  out.push(pad('terminal: ATTRIBUTED', r.terminalAttributed));
  out.push(pad('terminal: no attributable response', r.terminalNoResponse));
  out.push(pad('terminal: AMBIGUOUS', r.terminalAmbiguous));
  out.push(pad('cancelled', r.cancelled));
  out.push(pad('unaccounted (must be 0)', r.unaccounted));
  out.push(pad('reconciles to total', r.balances ? 'YES' : 'NO — REPORT IS WRONG'));
  out.push('');
  out.push('=== stage counters (these OVERLAP by lifecycle stage, and are not a partition)');
  out.push('  One probe can appear in several: prepared, then acknowledged, then answered.');
  const order = [
    'eligible_planned', 'simulated_submissions', 'collision_deferred',
    'submit_failed_simulated', 'awaiting_manual_resolution',
    'simulated_automated_acknowledgements', 'simulated_human_callbacks',
    'ambiguous_callbacks', 'unattributed_callbacks', 'no_attributable_response',
    'business_hours_known', 'business_hours_unknown',
  ];
  for (const key of order) out.push(pad(key.replace(/_/g, ' '), report.counts[key] ?? 0));

  out.push('');
  out.push('=== refused before a form was ever prepared');
  for (const [reason, count] of Object.entries(report.refusalsByReason).sort()) {
    out.push(pad(reason, count));
  }

  out.push('');
  out.push('=== forms we declined to submit, by reason');
  out.push('  (each is a fact about the form or about us, never about the company)');
  for (const [reason, count] of Object.entries(report.ineligibleByReason).sort()) {
    out.push(pad(reason, count));
  }

  out.push('');
  out.push('=== final probe status');
  for (const [status, count] of Object.entries(report.statusCounts).sort()) {
    out.push(pad(status, count));
  }

  out.push('');
  out.push('=== why ambiguous callbacks do not appear as terminal AMBIGUOUS probes');
  const ambiguousEvents = report.counts['ambiguous_callbacks'] ?? 0;
  const terminalAmbiguous = report.reconciliation.terminalAmbiguous;
  out.push(pad('ambiguous inbound events', ambiguousEvents));
  out.push(pad('probes terminal in AMBIGUOUS', terminalAmbiguous));
  out.push('  These are different things, and the difference is deliberate:');
  out.push('    · the ambiguous count is of inbound EVENTS, not of probes;');
  out.push('    · none of them could be attributed to a single probe, so none named one;');
  out.push('    · picking one candidate would be a coin toss with a company name on it,');
  out.push('      so no probe was made terminal AMBIGUOUS arbitrarily;');
  out.push('    · every candidate probe carries the event as inconclusive evidence, which');
  out.push('      blocks it from later asserting silence -- that call may have been theirs.');
  out.push('  A probe reaches terminal AMBIGUOUS only when its own attribution is');
  out.push('  contested, which no event in this batch produced.');
  out.push('');
  out.push('=== evidence published to the hypothesis engine');
  const refusals = new Map<string, number>();
  for (const attempt of report.publishAttempts) {
    const key = attempt.refusal ?? 'PUBLISHED';
    refusals.set(key, (refusals.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...refusals].sort()) out.push(pad(key, count));
  out.push('  SIMULATED_PROBE is the expected answer for every row in a dry run: a');
  out.push('  simulated measurement must never become evidence a rep can read.');

  out.push('');
  out.push('=== what a rep would see, for the ones that were answered');
  for (const item of report.worked) {
    out.push(`  ${item.label}`);
    out.push(`    hook: ${item.hookLine}`);
    for (const line of item.evidence) out.push(`    · ${line}`);
    out.push('');
  }

  out.push('=== live boundary');
  out.push(pad('form submissions actually sent', report.submissionsActuallySent));
  for (const blocker of report.liveBlockedBy) out.push(`  blocked by: ${blocker}`);
  out.push('');
  out.push(`  PROBE_SUBMISSION_ENABLED=${config.probe.submissionEnabled}  `
    + `caps global/market/vertical=${config.probe.globalNightlyCap}/`
    + `${config.probe.perMarketNightlyCap}/${config.probe.perVerticalNightlyCap}  `
    + `cooldown=${config.probe.cooldownDays}d`);
  out.push('');
  out.push('  No bytes left this machine. There is no HTTP client in src/probe.');
  return out.join('\n');
}

export { formatDuration };
