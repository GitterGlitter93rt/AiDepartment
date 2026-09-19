import { query } from '../db/pool.js';
import { resolveAccountId } from '../domain/merge.js';
import { pool } from '../db/pool.js';
import { formatDuration } from './latency.js';
import { MEASURED_STATUSES, type ProbeStatus } from './states.js';
import type { AttributionConfidence } from './attribution.js';

/**
 * What a probe is allowed to have taught us, and what a rep is allowed to say.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §17, §18, §19.
 *
 * Three filters stand between the ledger and a sentence, and each one exists because
 * the alternative produces a claim somebody would repeat to a prospect.
 *
 * **Live only, by default.** A dry-run probe is a real row that never happened to a
 * real company. It exercises the state machine, the allocator and the ladder, and it
 * must never reach a rep as a measurement. Callers who want simulated rows -- the
 * operator packet, and nothing else -- ask for them, and get them labelled.
 *
 * **Measured statuses only.** AMBIGUOUS and FAILED are excluded at the query. An
 * attribution failure is our failure and an unreachable form is a fact about the
 * form; neither is evidence about the company, so neither reaches this layer at all.
 *
 * **Both latency figures or neither.** The renderer emits raw and business-hours
 * adjusted together, and where the adjusted figure is null it says so in words. A
 * 16-hour overnight wait shown only as raw invites "they ignore leads for sixteen
 * hours"; shown only as adjusted it hides that a customer waited overnight.
 */

export interface ProbeSignalValue {
  signalId: string;
  state: 'YES' | 'NOT_OBSERVED' | 'NOT_CHECKED' | 'UNKNOWN';
  /** Present only when the state is YES. */
  value: string | number | null;
  detail: string;
  observedAt: Date | null;
  /** True only when a rep may state this out loud. */
  canStateAsFact: boolean;
}

export interface ProbeObservation {
  probeId: string;
  accountId: string;
  status: ProbeStatus;
  executionMode: 'DRY_RUN' | 'LIVE';
  submittedAt: Date | null;
  attributionConfidence: AttributionConfidence;
  firstAutomatedAt: Date | null;
  firstHumanAt: Date | null;
  firstMeaningfulAt: Date | null;
  elapsedSeconds: number | null;
  meaningfulElapsedSeconds: number | null;
  businessHoursAdjustedSeconds: number | null;
  businessHoursSource: string;
  submittedOutsideBusinessHours: boolean | null;
  responseChannel: string | null;
  responseActorType: string | null;
  selectedFromPaidAd: boolean;
  /**
   * From the event ledger rather than the milestone columns, because an
   * UNKNOWN-actor event sets no milestone and is still a response.
   */
  attributedResponses: number;
  humanResponses: number;
  automatedResponses: number;
  unknownActorResponses: number;
  firstAttributedResponseAt: Date | null;
  /**
   * Events that touched this probe without producing a measurement: attributed at
   * LOW/NONE confidence, or naming it among the candidates of an ambiguous event.
   *
   * They establish nothing about the company, and crucially they also destroy the
   * *absence* claim: something arrived on this probe's number that might have been
   * this company, so "no response was observed" is no longer a safe sentence.
   */
  inconclusiveEvents: number;
}

interface ProbeRow {
  probe_id: string; account_id: string; status: ProbeStatus;
  execution_mode: 'DRY_RUN' | 'LIVE';
  submitted_at: Date | null; attribution_confidence: AttributionConfidence;
  first_automated_sms_at: Date | null; first_automated_call_at: Date | null;
  first_human_sms_at: Date | null; first_human_call_at: Date | null;
  first_email_response_at: Date | null; first_meaningful_contact_at: Date | null;
  elapsed_to_first_response_seconds: number | null;
  elapsed_to_first_meaningful_seconds: number | null;
  business_hours_adjusted_seconds: number | null;
  business_hours_source: string;
  submitted_outside_business_hours: boolean | null;
  paid_ad_evidence_ids: string[] | null;
  attributed_responses: number;
  human_responses: number;
  automated_responses: number;
  unknown_actor_responses: number;
  first_attributed_response_at: Date | null;
  inconclusive_events: number;
}

function earliest(...dates: (Date | null)[]): Date | null {
  const present = dates.filter((date): date is Date => date instanceof Date);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (a <= b ? a : b));
}

function toObservation(row: ProbeRow): ProbeObservation {
  const firstAutomated = earliest(row.first_automated_sms_at, row.first_automated_call_at);
  const firstHuman = earliest(row.first_human_sms_at, row.first_human_call_at);
  const first = earliest(firstAutomated, firstHuman, row.first_email_response_at);

  const channels: string[] = [];
  if (row.first_automated_sms_at || row.first_human_sms_at) channels.push('SMS');
  if (row.first_automated_call_at || row.first_human_call_at) channels.push('CALL');
  if (row.first_email_response_at) channels.push('EMAIL');

  return {
    probeId: row.probe_id,
    accountId: row.account_id,
    status: row.status,
    executionMode: row.execution_mode,
    submittedAt: row.submitted_at,
    attributionConfidence: row.attribution_confidence,
    firstAutomatedAt: firstAutomated,
    firstHumanAt: firstHuman,
    firstMeaningfulAt: row.first_meaningful_contact_at,
    elapsedSeconds: row.elapsed_to_first_response_seconds,
    meaningfulElapsedSeconds: row.elapsed_to_first_meaningful_seconds,
    businessHoursAdjustedSeconds: row.business_hours_adjusted_seconds,
    businessHoursSource: row.business_hours_source,
    submittedOutsideBusinessHours: row.submitted_outside_business_hours,
    responseChannel: channels.length === 0 ? null
      : channels.length > 1 ? 'MULTIPLE' : channels[0]!,
    // Ordered by what can be defended: a person speaking outranks a template, and
    // a response we could not classify is UNKNOWN rather than either.
    responseActorType: row.human_responses > 0 ? 'HUMAN'
      : row.automated_responses > 0 ? 'AUTOMATED'
      : row.attributed_responses > 0 ? 'UNKNOWN' : null,
    selectedFromPaidAd: (row.paid_ad_evidence_ids ?? []).length > 0,
    attributedResponses: row.attributed_responses,
    humanResponses: row.human_responses,
    automatedResponses: row.automated_responses,
    unknownActorResponses: row.unknown_actor_responses,
    firstAttributedResponseAt: row.first_attributed_response_at ?? first,
    inconclusiveEvents: row.inconclusive_events,
  };
}

/**
 * The measured probes for one Account, newest first.
 *
 * `includeSimulated` is the only way a DRY_RUN row ever leaves the ledger, and no
 * production caller passes it.
 */
export async function measuredProbesFor(
  accountId: string, options: { includeSimulated?: boolean } = {},
): Promise<ProbeObservation[]> {
  const resolved = await resolveAccountId(pool, accountId);
  if (!resolved) return [];
  const modes = options.includeSimulated ? ['LIVE', 'DRY_RUN'] : ['LIVE'];
  const { rows } = await query<ProbeRow>(
    `select probe_id, account_id, status, execution_mode, submitted_at,
            attribution_confidence, first_automated_sms_at, first_automated_call_at,
            first_human_sms_at, first_human_call_at, first_email_response_at,
            first_meaningful_contact_at, elapsed_to_first_response_seconds,
            elapsed_to_first_meaningful_seconds, business_hours_adjusted_seconds,
            business_hours_source, submitted_outside_business_hours,
            paid_ad_evidence_ids,
            coalesce(events.attributed, 0)::int as attributed_responses,
            coalesce(events.human, 0)::int as human_responses,
            coalesce(events.automated, 0)::int as automated_responses,
            coalesce(events.unknown_actor, 0)::int as unknown_actor_responses,
            events.first_at as first_attributed_response_at,
            coalesce(inconclusive.n, 0)::int as inconclusive_events
       from lead_response_probes p
       left join lateral (
         select count(*) as attributed,
                count(*) filter (where actor_type = 'HUMAN') as human,
                count(*) filter (where actor_type = 'AUTOMATED') as automated,
                count(*) filter (where actor_type = 'UNKNOWN') as unknown_actor,
                min(occurred_at) as first_at
           from probe_inbound_events e
          where e.attributed_probe_id = p.probe_id
            and e.attribution_confidence in ('HIGH','MEDIUM')
       ) events on true
       left join lateral (
         select count(*) as n
           from probe_inbound_events e
          where (e.attributed_probe_id = p.probe_id
                   and e.attribution_confidence in ('LOW','NONE'))
             or (e.attributed_probe_id is null
                   and p.probe_id = any(e.candidate_probe_ids))
       ) inconclusive on true
      where account_id = $1
        and status = any($2::text[])
        and execution_mode = any($3::text[])
      order by submitted_at desc nulls last`,
    [resolved, MEASURED_STATUSES as unknown as string[], modes]);
  return rows.map(toObservation);
}

const NOT_CHECKED = (signalId: string): ProbeSignalValue => ({
  signalId, state: 'NOT_CHECKED', value: null, observedAt: null, canStateAsFact: false,
  detail: 'No controlled lead-response audit has been run for this company.',
});

/**
 * Canonical signal values from the probe ledger.
 *
 * Only HIGH and MEDIUM attribution produce a stateable fact. A LOW or NONE
 * confidence probe reaching this point is a measurement we cannot attach to anybody,
 * and the honest state for it is UNKNOWN rather than a number with a caveat.
 */
export async function probeSignalsFor(
  accountId: string, options: { includeSimulated?: boolean } = {},
): Promise<ProbeSignalValue[]> {
  const probes = await measuredProbesFor(accountId, options);
  const ids = [
    'lead_response_probe_completed', 'lead_response_latency', 'human_response_latency',
    'after_hours_response_gap', 'paid_lead_followup_gap', 'no_human_followup_observed',
    'response_channel', 'response_actor_type', 'response_attribution_confidence',
  ];
  if (probes.length === 0) return ids.map(NOT_CHECKED);

  const probe = probes[0]!;
  const values: ProbeSignalValue[] = [];

  const unknown = (signalId: string, detail: string): ProbeSignalValue => ({
    signalId, state: 'UNKNOWN', value: null, observedAt: probe.submittedAt,
    canStateAsFact: false, detail,
  });

  /**
   * Attribution confidence gates claims *about a response*, not the absence of one.
   *
   * A probe where nothing came back has nothing to attribute, so its confidence
   * stays NONE -- and gating on that suppressed the one thing it did establish. A
   * closed window with no attributable response is a real bounded observation, and
   * reporting it as "we cannot say anything" threw away the finding while keeping
   * the cost of having probed.
   */
  const hasResponse = probe.attributedResponses > 0;
  const attributable = probe.attributionConfidence === 'HIGH'
    || probe.attributionConfidence === 'MEDIUM';

  if (hasResponse && !attributable) {
    const detail = `A probe ran, and its response could not be attributed with `
      + `enough confidence (${probe.attributionConfidence}) to say anything. This is `
      + 'a statement about our attribution, not about the company.';
    return ids.map((signalId) => unknown(signalId, detail));
  }

  values.push({
    signalId: 'lead_response_probe_completed', state: 'YES', value: probe.probeId,
    observedAt: probe.submittedAt, canStateAsFact: true,
    detail: `One controlled inquiry was submitted and measured on `
      + `${probe.submittedAt?.toISOString() ?? 'an unrecorded date'}.`,
  });

  values.push(probe.elapsedSeconds !== null
    ? {
        signalId: 'lead_response_latency', state: 'YES', value: probe.elapsedSeconds,
        observedAt: probe.submittedAt, canStateAsFact: true,
        detail: `First attributable response after ${formatDuration(probe.elapsedSeconds)}, `
          + 'of any actor type.',
      }
    : {
        signalId: 'lead_response_latency', state: 'NOT_OBSERVED', value: null,
        observedAt: probe.submittedAt, canStateAsFact: false,
        detail: 'No response attributable to this inquiry arrived on the monitored '
          + 'channels before the window closed.',
      });

  values.push(probe.meaningfulElapsedSeconds !== null
    ? {
        signalId: 'human_response_latency', state: 'YES',
        value: probe.meaningfulElapsedSeconds, observedAt: probe.submittedAt,
        canStateAsFact: true,
        detail: `First human contact engaging the inquiry after `
          + `${formatDuration(probe.meaningfulElapsedSeconds)}.`,
      }
    : probe.unknownActorResponses > 0 || probe.inconclusiveEvents > 0
      ? {
          signalId: 'human_response_latency', state: 'UNKNOWN', value: null,
          observedAt: probe.submittedAt, canStateAsFact: false,
          detail: `${probe.unknownActorResponses} response(s) arrived that could not `
            + 'be identified as a person or a system, so whether a human answered is '
            + 'genuinely unknown rather than observed to be absent.',
        }
      : {
          signalId: 'human_response_latency', state: 'NOT_OBSERVED', value: null,
          observedAt: probe.submittedAt, canStateAsFact: false,
          detail: 'No human contact attributable to this inquiry was observed in the '
            + 'window. They may have used a channel we did not monitor.',
        });

  // Only where the hours are genuinely known. Without them, whether the submission
  // was after hours is not a fact we hold, so the gap is not one either.
  const hoursKnown = probe.businessHoursSource !== 'NONE';
  values.push(hoursKnown && probe.submittedOutsideBusinessHours === true
      && probe.meaningfulElapsedSeconds !== null
    ? {
        signalId: 'after_hours_response_gap', state: 'YES',
        value: probe.meaningfulElapsedSeconds, observedAt: probe.submittedAt,
        canStateAsFact: true,
        detail: `Submitted outside their published hours and answered by a person `
          + `${formatDuration(probe.meaningfulElapsedSeconds)} later.`,
      }
    : unknown('after_hours_response_gap', hoursKnown
        ? 'This inquiry was not submitted outside their hours, or no human answered it.'
        : 'This company\'s business hours are not known, so an after-hours gap cannot '
          + 'be calculated. Not zero -- absent.'));

  values.push(probe.selectedFromPaidAd && probe.meaningfulElapsedSeconds !== null
    ? {
        signalId: 'paid_lead_followup_gap', state: 'YES',
        value: probe.meaningfulElapsedSeconds, observedAt: probe.submittedAt,
        canStateAsFact: true,
        detail: `This company was observed paying for demand, and one inquiry from `
          + `that funnel waited ${formatDuration(probe.meaningfulElapsedSeconds)} for `
          + 'a person.',
      }
    : unknown('paid_lead_followup_gap',
        probe.selectedFromPaidAd
          ? 'No human response was attributed, so no paid-lead gap can be stated.'
          : 'This probe was not selected from paid-ad evidence.'));

  // Three outcomes, not two. The middle one is the whole point: a response we could
  // not classify is not evidence that no human answered, and collapsing it into YES
  // would turn our own uncertainty into a finding about the company.
  values.push(probe.firstMeaningfulAt !== null || probe.humanResponses > 0
    ? {
        signalId: 'no_human_followup_observed', state: 'NOT_OBSERVED', value: null,
        observedAt: probe.firstMeaningfulAt ?? probe.firstAttributedResponseAt,
        canStateAsFact: true,
        detail: 'A human did follow up, so this absence was not observed.',
      }
    : probe.unknownActorResponses > 0 || probe.inconclusiveEvents > 0
      ? {
          signalId: 'no_human_followup_observed', state: 'UNKNOWN', value: null,
          observedAt: probe.firstAttributedResponseAt, canStateAsFact: false,
          detail: probe.unknownActorResponses > 0
            ? `${probe.unknownActorResponses} attributed response(s) could not be `
              + 'identified as a person or a system. That is uncertainty about our '
              + 'classification, not an observed absence of human follow-up.'
            : `${probe.inconclusiveEvents} event(s) on this probe's number could not `
              + 'be attributed confidently. One of them may have been this company, '
              + 'so no absence was observed.',
        }
      : {
          signalId: 'no_human_followup_observed', state: 'YES', value: 'observed',
          observedAt: probe.submittedAt, canStateAsFact: true,
          detail: 'The window closed with no contact attributable to this inquiry '
            + 'from a person on the channels we monitored'
            + (probe.automatedResponses > 0
              ? ', only an automated acknowledgement. ' : '. ')
            + 'Not a claim that nobody responded.',
        });

  values.push(probe.responseChannel
    ? {
        signalId: 'response_channel', state: 'YES', value: probe.responseChannel,
        observedAt: probe.submittedAt, canStateAsFact: true,
        detail: `The first attributable response arrived by ${probe.responseChannel}.`,
      }
    : unknown('response_channel', 'No attributable response arrived, so no channel.'));

  values.push(probe.responseActorType
    ? {
        signalId: 'response_actor_type', state: 'YES', value: probe.responseActorType,
        observedAt: probe.submittedAt,
        // UNKNOWN actor is a real answer and must not be spoken as either.
        canStateAsFact: probe.responseActorType !== 'UNKNOWN',
        detail: `The first attributable response came from: ${probe.responseActorType}.`,
      }
    : unknown('response_actor_type', 'No attributable response arrived.'));

  values.push(hasResponse
    ? {
        signalId: 'response_attribution_confidence', state: 'YES',
        value: probe.attributionConfidence, observedAt: probe.submittedAt,
        canStateAsFact: true,
        detail: `Attribution confidence for this measurement: ${probe.attributionConfidence}.`,
      }
    : unknown('response_attribution_confidence',
        'No response arrived, so there is nothing to attribute.'));

  return values;
}

export interface RenderedProbeEvidence {
  renderable: boolean;
  /** Why nothing may be said, when nothing may be. */
  refusal: string | null;
  lines: string[];
  /** The one-inquiry disclaimer, always present when lines are. */
  disclaimer: string | null;
  simulated: boolean;
}

/**
 * The paragraph a rep reads, or an explicit refusal.
 *
 * There is no partial render. A measurement missing its date, its attribution or its
 * elapsed time is not a weaker version of this paragraph -- it is a sentence that
 * cannot be defended, and the honest output is to say why there is nothing to say.
 */
export function renderProbeEvidence(probe: ProbeObservation | null): RenderedProbeEvidence {
  if (!probe) {
    return {
      renderable: false, lines: [], disclaimer: null, simulated: false,
      refusal: 'No controlled lead-response audit has been measured for this company.',
    };
  }
  // Same asymmetry as the signal layer: confidence gates a stated response time, and
  // a probe with no response has none to state. "We submitted one enquiry and
  // nothing attributable came back inside the window" is sayable and useful.
  if (probe.attributedResponses > 0
      && probe.attributionConfidence !== 'HIGH'
      && probe.attributionConfidence !== 'MEDIUM') {
    return {
      renderable: false, lines: [], disclaimer: null,
      simulated: probe.executionMode === 'DRY_RUN',
      refusal: `Attribution confidence is ${probe.attributionConfidence}. A response `
        + 'nobody can attribute is not a response anybody may quote.',
    };
  }

  // Nothing measurement-grade, and something inconclusive. There is no fact here in
  // either direction -- not a response time, not an absence -- and §19 is explicit
  // that a paragraph missing its attribution is not a weaker version of the
  // paragraph. The reason carries the information to whoever asks.
  if (probe.attributedResponses === 0 && probe.inconclusiveEvents > 0) {
    return {
      renderable: false, lines: [], disclaimer: null,
      simulated: probe.executionMode === 'DRY_RUN',
      refusal: `${probe.inconclusiveEvents} inbound event(s) reached this probe's `
        + 'number without being attributable to this company. Neither a response time '
        + 'nor an absence of response can be stated.',
    };
  }
  if (!probe.submittedAt) {
    return {
      renderable: false, lines: [], disclaimer: null,
      simulated: probe.executionMode === 'DRY_RUN',
      refusal: 'The submission time was never recorded, so no elapsed time can be stated.',
    };
  }

  const lines: string[] = [];
  const stamp = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';

  lines.push(`Lead submitted ${stamp(probe.submittedAt)}.`);
  if (probe.firstAutomatedAt) {
    lines.push(`Automated acknowledgement ${stamp(probe.firstAutomatedAt)}.`);
  }
  if (probe.firstMeaningfulAt) {
    lines.push(`First human contact ${stamp(probe.firstMeaningfulAt)}.`);
    lines.push(`Elapsed human response time ${formatDuration(probe.meaningfulElapsedSeconds)}.`);
  } else if (probe.unknownActorResponses > 0) {
    // A real, attributed response that we could not classify. Saying "no further
    // response arrived" here would be false, and saying a human answered would be
    // unsupported. The honest sentence is that something answered and we cannot say
    // what.
    lines.push(`${probe.unknownActorResponses} further response(s) attributable to this `
      + 'inquiry arrived, but could not be identified as coming from a person or from '
      + 'a system. No human response time can be stated from them.');
  } else if (probe.attributedResponses === 0) {
    lines.push('No response attributable to this inquiry arrived by SMS, call or email '
      + 'before the window closed. This does not establish that nobody responded: they '
      + 'may have used a number or address we were not monitoring.');
  } else {
    lines.push('No further response attributable to this inquiry arrived by SMS, call '
      + 'or email before the window closed. This does not establish that nobody responded.');
  }

  // Both figures, always. The null case says so in words rather than resolving to a
  // number the reader would treat as measured.
  if (probe.firstMeaningfulAt) {
    lines.push(probe.businessHoursAdjustedSeconds !== null
      ? `Business-hours-adjusted ${formatDuration(probe.businessHoursAdjustedSeconds)} `
        + `(hours from ${probe.businessHoursSource.toLowerCase().replace(/_/g, ' ')}).`
      : 'Business-hours-adjusted figure not available: this company\'s hours are not known.');
  }
  lines.push(`Attribution confidence: ${probe.attributionConfidence}.`);

  return {
    renderable: true, refusal: null, lines,
    disclaimer: 'One inquiry, one date. Not a measure of typical performance.',
    simulated: probe.executionMode === 'DRY_RUN',
  };
}
