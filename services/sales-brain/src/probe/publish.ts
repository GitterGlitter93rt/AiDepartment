import { query, withTransaction } from '../db/pool.js';
import { formatDuration } from './latency.js';
import { measuredProbesFor, probeSignalsFor, renderProbeEvidence, type ProbeObservation } from './evidence.js';

/**
 * How a measurement joins the rest of what we know.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §17, §20.
 *
 * The hypothesis engine already reads `evidence_records` by `claim_key`, and the
 * call pack already reads hypotheses. So the probe does not need a path of its own
 * into either: it publishes evidence, and the existing chain picks it up unchanged.
 * That is the whole integration, and it is deliberately the smallest one -- a second
 * route into the call pack would be a second place for a claim to be born.
 *
 * The gate is `execution_mode`. A DRY_RUN probe never publishes, because
 * `evidence_records` is what a rep reads: a simulated 16-hour latency written there
 * would be indistinguishable from a measured one, and it would be a fabricated claim
 * about a real company. The refusal is returned rather than thrown so the operator
 * packet can show that it happened.
 */

export type PublishRefusal =
  | 'SIMULATED_PROBE'
  | 'NOT_MEASURED'
  | 'NOT_ATTRIBUTABLE'
  | 'ALREADY_PUBLISHED';

export interface PublishResult {
  published: boolean;
  refusal: PublishRefusal | null;
  claimKeys: string[];
  detail: string;
}

interface ProbeRow {
  probe_id: string; account_id: string; status: string; execution_mode: string;
  attribution_confidence: string;
}

export async function publishProbeEvidence(input: {
  probeId: string;
  /** Only the operator packet passes this, and only against a scratch database. */
  allowSimulated?: boolean;
  now: Date;
}): Promise<PublishResult> {
  const { rows } = await query<ProbeRow>(
    `select probe_id, account_id, status, execution_mode, attribution_confidence
       from lead_response_probes where probe_id = $1`, [input.probeId]);
  const probe = rows[0];
  if (!probe) throw new Error(`No probe ${input.probeId}`);

  if (probe.execution_mode !== 'LIVE' && !input.allowSimulated) {
    return {
      published: false, refusal: 'SIMULATED_PROBE', claimKeys: [],
      detail: 'This probe is a dry run. It never happened to a real company, so it '
        + 'publishes no evidence a rep could read.',
    };
  }
  if (probe.status !== 'ATTRIBUTED' && probe.status !== 'NO_RESPONSE_FINAL') {
    return {
      published: false, refusal: 'NOT_MEASURED', claimKeys: [],
      detail: `Status ${probe.status} is not a measured outcome. AMBIGUOUS and FAILED `
        + 'publish nothing: neither is evidence about the company.',
    };
  }
  if (probe.attribution_confidence !== 'HIGH' && probe.attribution_confidence !== 'MEDIUM') {
    return {
      published: false, refusal: 'NOT_ATTRIBUTABLE', claimKeys: [],
      detail: `Attribution confidence ${probe.attribution_confidence} is too low to `
        + 'attach a measurement to this company.',
    };
  }

  const existing = await query<{ n: string }>(
    `select count(*)::text as n from evidence_records
      where account_id = $1 and source_reference = $2`,
    [probe.account_id, `probe:${probe.probe_id}`]);
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    return {
      published: false, refusal: 'ALREADY_PUBLISHED', claimKeys: [],
      detail: 'Evidence for this probe already exists. Never republished: a second '
        + 'row would read as a second measurement.',
    };
  }

  const signals = await probeSignalsFor(probe.account_id,
    { includeSimulated: input.allowSimulated });
  const stateable = signals.filter((signal) => signal.state === 'YES' && signal.canStateAsFact);

  await withTransaction(async (client) => {
    for (const signal of stateable) {
      await client.query(
        `insert into evidence_records (
           account_id, category, claim_key, claim_text, normalized_value, confidence,
           can_state_as_fact, source_provider, source_type, source_reference,
           observed_at, expires_at, freshness, retention_class, precedence_rank, notes
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          probe.account_id, 'lead_response', signal.signalId, signal.detail,
          signal.value === null ? null : String(signal.value),
          // A controlled measurement we performed ourselves is `confirmed`. What it
          // confirms is one interaction, which the claim text says plainly.
          'confirmed', signal.canStateAsFact,
          'yad_speed_to_lead_probe', 'FIRST_PARTY_MEASUREMENT',
          `probe:${probe.probe_id}`,
          signal.observedAt ?? input.now,
          // Six months, matching the signal freshness: a response time measured in
          // spring is not a fact about the company in autumn.
          new Date(input.now.getTime() + 180 * 24 * 3_600_000),
          'fresh', 'durable',
          // Ahead of a scraped page, behind something the prospect told us directly.
          3,
          'One controlled inquiry on one date. Never a rate, an average, or a '
          + 'statement about typical performance.',
        ]);
    }
  });

  return {
    published: stateable.length > 0, refusal: null,
    claimKeys: stateable.map((signal) => signal.signalId),
    detail: stateable.length > 0
      ? `Published ${stateable.length} claim(s) the hypothesis engine can read.`
      : 'Nothing was stateable, so nothing was published.',
  };
}

export interface ProbeHook {
  available: boolean;
  /** The question a rep opens with. A question, never an accusation. */
  hookLine: string | null;
  /** The observation behind it, in the words it can be defended in. */
  evidenceLines: string[];
  disclaimer: string | null;
  /** Carried into the call pack so the prohibition travels with the fact. */
  mustNotClaim: string[];
  simulated: boolean;
  detail: string;
}

/**
 * The hook language for a measured probe.
 *
 * A question rather than a statistic, for a reason that is commercial as much as
 * epistemic: "you took sixteen hours" invites a defence, and "what happens when
 * somebody submits your form at ten at night" invites the owner to describe their own
 * process -- which is the thing the rep actually needs, and which the vertical
 * profile's `questions_to_verify` already asks for.
 *
 * The measurement rides along as evidence the rep holds, not as the opener.
 */
export async function probeHookFor(
  accountId: string, options: { includeSimulated?: boolean } = {},
): Promise<ProbeHook> {
  const probes = await measuredProbesFor(accountId, options);
  const probe: ProbeObservation | null = probes[0] ?? null;
  const rendered = renderProbeEvidence(probe);

  const mustNotClaim = [
    'current_response_time_without_measurement — this is one inquiry, not their average',
    'invented_speed_to_lead_gain — no revenue figure follows from one measurement',
    'never_responds — the window was bounded and the channels were ours',
  ];

  if (!rendered.renderable || !probe) {
    return {
      available: false, hookLine: null, evidenceLines: [], disclaimer: null,
      mustNotClaim, simulated: rendered.simulated,
      detail: rendered.refusal ?? 'No measured probe.',
    };
  }

  const hookLine = probe.firstMeaningfulAt === null
    // "Nobody picks it up" is unsupported when something did answer and we could not
    // tell what it was. The question then is about visibility, which is true either
    // way and claims nothing.
    ? (probe.unknownActorResponses > 0
      ? 'When a new web enquiry comes in, how do you know who picked it up and when?'
      : 'When somebody fills in your contact form and nobody picks it up, how would you find out?')
    : probe.submittedOutsideBusinessHours === true
      ? 'When somebody submits your form after hours, what is the first thing that happens?'
      : 'How quickly does a brand-new web enquiry normally hear from somebody?';

  const evidenceLines = [...rendered.lines];
  if (probe.firstMeaningfulAt && probe.meaningfulElapsedSeconds !== null) {
    evidenceLines.push(
      `If asked how we know: we submitted one enquiry through your own form and `
      + `timed the reply. ${formatDuration(probe.meaningfulElapsedSeconds)} to a person.`);
  }

  return {
    available: true, hookLine, evidenceLines,
    disclaimer: rendered.disclaimer, mustNotClaim,
    simulated: rendered.simulated,
    detail: `Measured probe ${probe.probeId} at ${probe.attributionConfidence} confidence.`,
  };
}
