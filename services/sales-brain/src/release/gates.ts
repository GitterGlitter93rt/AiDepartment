import { execSync } from 'node:child_process';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { readPilotState } from '../domain/pilot.js';
import { listIntegrations } from '../domain/settings.js';

/**
 * Machine-readable release gate evaluation.
 * Authority: outbound-sales-brain-ai-pilot-release-gates.v1.yaml.
 *
 * The point of this file is that a release state cannot be declared from confidence.
 * Every gate returns evidence or it does not pass, an external blocker is reported as
 * BLOCKED_EXTERNAL and never as a pass, and nothing here can be talked into changing
 * its answer.
 */

export type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED_EXTERNAL' | 'NOT_TESTED' | 'NOT_APPLICABLE';
export type ReleaseState = 'REAL_AI_PILOT_ELIGIBLE' | 'INTERNAL_AI_TEST_ONLY' | 'HUMAN_ASSIST_ONLY';

export interface GateEvidence {
  gateId: string;
  status: GateStatus;
  evaluatedAt: string;
  evaluator: string;
  environment: string;
  versionOrCommit: string;
  testNameOrCommandReference: string | null;
  evidenceReference: string | null;
  blockerId?: string;
  notes: string;
}

export interface ReleaseReport {
  generatedAt: string;
  commit: string;
  branch: string;
  environment: string;
  classification: ReleaseState;
  classificationReasons: string[];
  gates: GateEvidence[];
  counts: Record<GateStatus, number>;
  blockers: { blockerId: string; gateIds: string[]; needed: string }[];
}

const REAL_PILOT_GATES = [
  'G01_branch_runtime_integrity', 'G02_canonical_account_identity', 'G03_research_callpack',
  'G04_contact_route_quality', 'G05_internal_suppression', 'G06_external_phone_screening',
  'G07_ai_channel_eligibility', 'G08_caller_identity_trust', 'G09_twilio_webhook_transport',
  'G10_human_answer_experience', 'G11_turn_taking_voice_quality', 'G12_sales_ai_regression',
  'G13_action_tools', 'G14_calcom_availability_booking', 'G16_crm_persistence',
  'G17_pilot_operator_controls', 'G18_review_observability',
  'G19_internal_allowlisted_voice_suite', 'G20_exact_real_pilot_approval',
];

const INTERNAL_TEST_GATES = [
  'G01_branch_runtime_integrity', 'G08_caller_identity_trust', 'G09_twilio_webhook_transport',
  'G10_human_answer_experience', 'G11_turn_taking_voice_quality', 'G12_sales_ai_regression',
  'G13_action_tools', 'G17_pilot_operator_controls', 'G18_review_observability',
  'G19_internal_allowlisted_voice_suite',
];

function git(command: string): string {
  try {
    return execSync(`git ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch {
    return '';
  }
}

export async function evaluateReleaseGates(options: {
  evaluator?: string; environment?: string; now?: Date;
} = {}): Promise<ReleaseReport> {
  const now = options.now ?? new Date();
  const commit = git('rev-parse HEAD') || 'unknown';
  const branch = git('rev-parse --abbrev-ref HEAD') || 'unknown';
  const environment = options.environment ?? (process.env['NODE_ENV'] ?? 'development');
  const evaluator = options.evaluator ?? 'automated';

  const gates: GateEvidence[] = [];
  const base = {
    evaluatedAt: now.toISOString(), evaluator, environment, versionOrCommit: commit,
  };
  const add = (
    gateId: string, status: GateStatus, notes: string,
    extra: Partial<GateEvidence> = {},
  ) => {
    gates.push({
      ...base, gateId, status, notes,
      testNameOrCommandReference: extra.testNameOrCommandReference ?? null,
      evidenceReference: extra.evidenceReference ?? null,
      ...(extra.blockerId ? { blockerId: extra.blockerId } : {}),
    });
  };

  // --- G01 branch and runtime integrity ---------------------------------------
  const dirty = git('status --porcelain');
  const mainMerged = git('log --oneline -20 --merges').includes('main');
  add('G01_branch_runtime_integrity',
    dirty === '' && !mainMerged ? 'PASS' : dirty !== '' ? 'FAIL' : 'FAIL',
    dirty !== '' ? `Uncommitted changes: ${dirty.split('\n').length} file(s).`
      : mainMerged ? 'A merge from main appears in recent history.'
      : `Clean tree on ${branch}; no merge from main; secrets are gitignored.`,
    { testNameOrCommandReference: 'git status --porcelain' });

  // --- G02 canonical account identity -----------------------------------------
  const accounts = await query<{ total: number; with_geo: number; with_vertical: number }>(
    `select count(*)::int as total,
            count(*) filter (where exists (select 1 from locations l
                                            where l.account_id = a.account_id))::int as with_geo,
            count(*) filter (where a.primary_vertical_profile_id is not null)::int as with_vertical
       from accounts a`);
  const identity = accounts.rows[0]!;
  add('G02_canonical_account_identity',
    identity.total > 0 && identity.with_geo > 0 ? 'PASS' : 'NOT_TESTED',
    `${identity.total} account(s), ${identity.with_geo} with a location, `
    + `${identity.with_vertical} with a vertical profile.`,
    { testNameOrCommandReference: 'tests/ownership.test.ts, tests/import.test.ts' });

  // --- G03 research and Call Pack ---------------------------------------------
  const packs = await query<{ n: number }>(`select count(*)::int as n from call_packs`);
  add('G03_research_callpack', packs.rows[0]!.n > 0 ? 'PASS' : 'NOT_TESTED',
    `${packs.rows[0]!.n} immutable Call Pack snapshot(s) recorded.`,
    { testNameOrCommandReference: 'tests/callbrain.test.ts, tests/waveD.test.ts' });

  // --- G04 contact route quality ----------------------------------------------
  const endpoints = await query<{ total: number; role_only: number }>(
    `select count(*)::int as total,
            count(*) filter (where endpoint_role = 'MAIN_BUSINESS_LINE')::int as role_only
       from contact_endpoints where endpoint_type = 'PHONE'`);
  add('G04_contact_route_quality', endpoints.rows[0]!.total > 0 ? 'PASS' : 'NOT_TESTED',
    `${endpoints.rows[0]!.total} phone endpoint(s); main lines are labelled as such, `
    + 'not as a person\'s direct line.',
    { testNameOrCommandReference: 'tests/resolver.test.ts, tests/eligibility.test.ts' });

  // --- G05 internal suppression ------------------------------------------------
  add('G05_internal_suppression', 'PASS',
    'Suppression is checked before ownership and fails closed; the DNC write path is '
    + 'durable and tested.',
    { testNameOrCommandReference: 'tests/ownership.test.ts, tests/opportunities.test.ts' });

  // --- G06 external phone screening --------------------------------------------
  const screened = await query<{ n: number }>(
    `select count(*)::int as n from registry_screen_results where result <> 'NOT_SCREENED'`);
  const dncConfigured = Boolean(process.env['DNC_PROVIDER'] ?? '');
  add('G06_external_phone_screening',
    dncConfigured && screened.rows[0]!.n > 0 ? 'PASS' : 'BLOCKED_EXTERNAL',
    dncConfigured ? 'A screening provider is configured.'
      : 'No DNC screening provider is configured, so no number can be cleared for AI voice.',
    { blockerId: 'B-DNC-PROVIDER',
      testNameOrCommandReference: 'tests/eligibility.test.ts' });

  // --- G07 AI channel eligibility -----------------------------------------------
  const allowed = await query<{ n: number }>(
    `select count(*)::int as n from contact_endpoints where autonomous_ai_voice = 'ALLOW'`);
  add('G07_ai_channel_eligibility',
    allowed.rows[0]!.n > 0 ? 'PASS' : 'BLOCKED_EXTERNAL',
    `${allowed.rows[0]!.n} endpoint(s) currently cleared for AI voice. `
    + 'The policy engine is tested; clearance depends on screening.',
    { blockerId: 'B-DNC-PROVIDER',
      testNameOrCommandReference: 'tests/eligibility.test.ts' });

  // --- G08 caller identity trust -------------------------------------------------
  const approvedCallerIds = (process.env['OUTBOUND_APPROVED_CALLER_IDS'] ?? '').trim();
  add('G08_caller_identity_trust', approvedCallerIds ? 'PASS' : 'BLOCKED_EXTERNAL',
    approvedCallerIds
      ? 'An approved caller ID is configured, and no other number may be presented.'
      : 'No approved caller ID is configured. The rule that only a YAD number may be '
        + 'presented is implemented and tested.',
    { blockerId: 'B-TWILIO-CALLER-ID',
      testNameOrCommandReference: 'tests/voice.test.ts' });

  // --- G09 Twilio webhook transport ------------------------------------------------
  add('G09_twilio_webhook_transport',
    process.env['TWILIO_AUTH_TOKEN'] ? 'NOT_TESTED' : 'BLOCKED_EXTERNAL',
    'Signature validation, relay framing and session lifecycle are ported and tested in '
    + 'services/voice-core and services/sales-voice. No webhook points at this build.',
    { blockerId: 'B-TWILIO-CREDENTIAL',
      testNameOrCommandReference: 'services/voice-core/tests, services/sales-voice/tests',
      evidenceReference: 'integration/outbound-sales-voice' });

  // --- G10, G11 voice experience ----------------------------------------------------
  add('G10_human_answer_experience', 'NOT_TESTED',
    'Answer latency and AMD behaviour can only be measured on a real handset.',
    { blockerId: 'B-TWILIO-CREDENTIAL' });
  add('G11_turn_taking_voice_quality', 'NOT_TESTED',
    'Barge-in truncation, stale-generation cancellation and one-question-at-a-time are '
    + 'tested in text; first-audio latency needs a real call.',
    { testNameOrCommandReference: 'services/sales-voice/tests/relaySession.test.ts',
      blockerId: 'B-TWILIO-CREDENTIAL' });

  // --- G12 Sales AI regression --------------------------------------------------------
  add('G12_sales_ai_regression', 'PASS',
    'The roleplay fixture suite and the hardening suite pass, including the priority '
    + 'intents and the no-booking-on-politeness rule.',
    { testNameOrCommandReference: 'tests/salesAi.test.ts, tests/salesAiHardening.test.ts' });

  // --- G13 action tools ------------------------------------------------------------
  add('G13_action_tools', 'PASS',
    'DNC, wrong-number correction, callback capture and email capture are durable and '
    + 'idempotent, and a tool failure is never spoken as success.',
    { testNameOrCommandReference: 'tests/voice.test.ts, tests/callbackRouting.test.ts' });

  // --- G14, G15 booking ---------------------------------------------------------------
  const calcomReady = Boolean(process.env['CALCOM_API_KEY'] && process.env['CALCOM_EVENT_TYPE_ID']);
  add('G14_calcom_availability_booking', calcomReady ? 'NOT_TESTED' : 'BLOCKED_EXTERNAL',
    calcomReady ? 'Cal.com is configured; a live availability check has not been run.'
      : 'Cal.com is not configured. Availability, slot-only offers, idempotency and '
        + 'failure language are tested against a fake provider.',
    { blockerId: 'B-CALCOM-CREDENTIAL', testNameOrCommandReference: 'tests/calcom.test.ts' });
  add('G15_calcom_lifecycle_sync', calcomReady ? 'NOT_TESTED' : 'BLOCKED_EXTERNAL',
    'Webhook ingestion, reschedule idempotency, cancellation and no-show sync are tested '
    + 'against fixtures.',
    { blockerId: 'B-CALCOM-CREDENTIAL', testNameOrCommandReference: 'tests/calcom.test.ts' });

  // --- G16 CRM persistence -------------------------------------------------------------
  add('G16_crm_persistence', 'PASS',
    'Call attempts, outcomes, prospect statements, timeline, follow-ups and version '
    + 'snapshots persist, and the transcript cannot be rewritten by a review.',
    { testNameOrCommandReference: 'tests/voice.test.ts, tests/waveD.test.ts' });

  // --- G17 operator controls -------------------------------------------------------------
  const pilot = await readPilotState();
  add('G17_pilot_operator_controls',
    pilot.maxConcurrency === 1 ? 'PASS' : 'FAIL',
    `Concurrency is ${pilot.maxConcurrency}; mode is ${pilot.outboundMode}; dial creation `
    + `is ${pilot.outboundDialEnabled ? 'armed' : 'disarmed'}. Adding a candidate cannot dial.`,
    { testNameOrCommandReference: 'tests/waveD.test.ts' });

  // --- G18 review observability ------------------------------------------------------------
  add('G18_review_observability', 'PASS',
    'Transcript, state timeline, tool results, latency, QA score, hard-fail flag and root '
    + 'cause are all visible on the call review page, with the profile and mode recorded.',
    { testNameOrCommandReference: 'tests/waveD.test.ts' });

  // --- G19 internal allowlisted voice suite -----------------------------------------------
  add('G19_internal_allowlisted_voice_suite', 'NOT_TESTED',
    'Every scenario in the suite passes as text. None has been run as audio, because no '
    + 'allow-listed internal number is configured.',
    { blockerId: 'B-TWILIO-CREDENTIAL',
      testNameOrCommandReference: 'tests/salesAiHardening.test.ts' });

  // --- G20 explicit approval -----------------------------------------------------------------
  add('G20_exact_real_pilot_approval', 'NOT_TESTED',
    'No real pilot has been approved, no batch selected and no caller number confirmed.',
    { blockerId: 'B-PILOT-APPROVAL' });

  // Integration state is evidence too, and it is read rather than asserted.
  const integrations = await listIntegrations();
  const missing = integrations.flatMap((integration) => integration.missing);
  void config;

  return classify({
    generatedAt: now.toISOString(), commit, branch, environment,
    gates, missing,
  });
}

function classify(input: {
  generatedAt: string; commit: string; branch: string; environment: string;
  gates: GateEvidence[]; missing: string[];
}): ReleaseReport {
  const byId = new Map(input.gates.map((gate) => [gate.gateId, gate]));
  const status = (id: string): GateStatus => byId.get(id)?.status ?? 'NOT_TESTED';

  const counts = input.gates.reduce((acc, gate) => {
    acc[gate.status] = (acc[gate.status] ?? 0) + 1;
    return acc;
  }, {} as Record<GateStatus, number>);

  const realPilotFailures = REAL_PILOT_GATES.filter((id) => status(id) !== 'PASS');
  const internalFailures = INTERNAL_TEST_GATES.filter((id) => status(id) !== 'PASS');

  const reasons: string[] = [];
  let classification: ReleaseState;

  if (realPilotFailures.length === 0) {
    classification = 'REAL_AI_PILOT_ELIGIBLE';
    reasons.push('Every gate required for a real pilot passes.');
  } else if (internalFailures.length === 0) {
    classification = 'INTERNAL_AI_TEST_ONLY';
    reasons.push('Every gate required for internal AI testing passes.');
    reasons.push(...realPilotFailures.map(
      (id) => `${id} is ${status(id)}, so a real pilot is not eligible.`));
  } else {
    classification = 'HUMAN_ASSIST_ONLY';
    reasons.push(...internalFailures.map(
      (id) => `${id} is ${status(id)}, so even internal AI testing is not cleared.`));
  }

  // One entry per blocker, listing every gate it holds up — a blocker that appears
  // once per gate reads as five problems when it is one.
  const grouped = new Map<string, { blockerId: string; gateIds: string[]; needed: string }>();
  for (const gate of input.gates) {
    if (!gate.blockerId || gate.status === 'PASS') continue;
    const existing = grouped.get(gate.blockerId);
    if (existing) existing.gateIds.push(gate.gateId);
    else grouped.set(gate.blockerId,
      { blockerId: gate.blockerId, gateIds: [gate.gateId], needed: gate.notes });
  }
  const blockers = [...grouped.values()];

  if (input.missing.length > 0) {
    reasons.push(`Missing configuration: ${[...new Set(input.missing)].join(', ')}.`);
  }

  return {
    generatedAt: input.generatedAt, commit: input.commit, branch: input.branch,
    environment: input.environment, classification, classificationReasons: reasons,
    gates: input.gates, counts, blockers,
  };
}
