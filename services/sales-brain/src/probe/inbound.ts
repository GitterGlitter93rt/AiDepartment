import { query, withTransaction } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';
import { attributeInboundEvent, type AttributionResult } from './attribution.js';
import { bodyFingerprint, classifyActor, isMeaningfulContact, type ActorType } from './actor.js';
import { openProbesOnNumber, recordStateEvent } from './ledger.js';
import { elapsedSeconds } from './latency.js';
import { assertTransition, type ProbeStatus } from './states.js';

/**
 * An inbound event becomes a measurement, or becomes nothing, and says which.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §6, §7, §8.
 *
 * Every event is stored whether or not it attributes. That is not completeness for
 * its own sake: an AMBIGUOUS verdict is only reviewable if the candidates were
 * written down, and a stream of unattributable events on one pool number is how we
 * would find out the allocator is wrong.
 *
 * `provider_sid` is the idempotency key, so a redelivered Twilio webhook is the same
 * event rather than a second response. Getting that wrong would not merely
 * double-count; it would make a single autoresponder look like a conversation.
 */

export interface InboundEventInput {
  providerSid: string;
  channel: 'CALL' | 'SMS' | 'EMAIL';
  fromNumber?: string | null;
  fromEmail?: string | null;
  toNumber?: string | null;
  toEmail?: string | null;
  body?: string | null;
  callDisposition?: string | null;
  identificationAnswer?: string | null;
  twoWay?: boolean;
  occurredAt: Date;
  executionMode?: 'DRY_RUN' | 'LIVE';
}

export interface IngestResult {
  eventId: string;
  duplicate: boolean;
  attribution: AttributionResult;
  actorType: ActorType;
  /** The milestone this event set, when it set one. */
  milestone: string | null;
  probeStatus: ProbeStatus | null;
  detail: string;
}

/**
 * How many *other* probes have already seen this exact body.
 *
 * Cross-probe rather than per-probe on purpose: the same words sent to two different
 * audits were written once, in advance, by nobody. Restricting to other probes
 * matters -- a company that sends the same template twice to one probe is repeating
 * itself, which is not the same finding.
 */
async function fingerprintSeenOnOtherProbes(
  fingerprint: string | null, excludeProbeIds: readonly string[],
): Promise<number> {
  if (!fingerprint) return 0;
  const { rows } = await query<{ n: string }>(
    `select count(distinct attributed_probe_id)::text as n
       from probe_inbound_events
      where body_fingerprint = $1
        and attributed_probe_id is not null
        and not (attributed_probe_id = any($2::uuid[]))`,
    [fingerprint, (excludeProbeIds.length > 0 ? excludeProbeIds : ['00000000-0000-0000-0000-000000000000']) as string[]]);
  return Number(rows[0]?.n ?? 0);
}

/** Which milestone column an (channel, actor) pair sets. */
function milestoneColumn(
  channel: 'CALL' | 'SMS' | 'EMAIL', actor: ActorType,
): { at: string; event: string } | null {
  if (channel === 'EMAIL') {
    return { at: 'first_email_response_at', event: 'first_email_response_event_id' };
  }
  if (channel === 'SMS') {
    if (actor === 'AUTOMATED') {
      return { at: 'first_automated_sms_at', event: 'first_automated_sms_event_id' };
    }
    if (actor === 'HUMAN') {
      return { at: 'first_human_sms_at', event: 'first_human_sms_event_id' };
    }
    // UNKNOWN sets no channel milestone. It is a response we cannot characterise,
    // and filing it under either heading would assert the thing we could not tell.
    return null;
  }
  if (actor === 'AUTOMATED') {
    return { at: 'first_automated_call_at', event: 'first_automated_call_event_id' };
  }
  if (actor === 'HUMAN') {
    return { at: 'first_human_call_at', event: 'first_human_call_event_id' };
  }
  return null;
}

/**
 * The most inbound prose this subsystem will keep.
 *
 * Matches the column's own bound. An SMS fits comfortably; an email is kept only as
 * much as the actor classifier needs, because archiving a full email body here would
 * make the ledger a store of somebody else's content, which is what
 * `tests/retention.test.ts` exists to prevent.
 */
export const MAX_STORED_BODY_CHARS = 2000;

function boundedBody(body: string | null | undefined): string | null {
  if (!body) return null;
  return body.length <= MAX_STORED_BODY_CHARS
    ? body
    // Marked, so nobody later reads a clipped body as the whole message.
    : `${body.slice(0, MAX_STORED_BODY_CHARS - 14)} …[truncated]`;
}

export async function ingestProbeInboundEvent(
  input: InboundEventInput,
): Promise<IngestResult> {
  const existing = await query<{ event_id: string; attributed_probe_id: string | null;
    actor_type: ActorType; attribution_tier: string | null }>(
    `select event_id, attributed_probe_id, actor_type, attribution_tier
       from probe_inbound_events where provider_sid = $1`, [input.providerSid]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      eventId: row.event_id, duplicate: true,
      attribution: {
        state: row.attributed_probe_id ? 'ATTRIBUTED' : 'UNATTRIBUTED',
        tier: (row.attribution_tier ?? 'T5_UNRESOLVED') as AttributionResult['tier'],
        confidence: 'NONE', probeId: row.attributed_probe_id,
        candidateProbeIds: [], evidence: [],
      },
      actorType: row.actor_type, milestone: null, probeStatus: null,
      detail: 'Already ingested. A redelivered webhook is the same event.',
    };
  }

  const toNumber = normalizePhone(input.toNumber) ?? input.toNumber ?? null;
  const poolRow = toNumber
    ? await query<{ pool_number_id: string }>(
        `select pool_number_id from probe_pool_numbers where e164 = $1`, [toNumber])
    : { rows: [] as { pool_number_id: string }[] };
  const poolNumberId = poolRow.rows[0]?.pool_number_id ?? null;

  const candidates = poolNumberId ? await openProbesOnNumber(poolNumberId) : [];
  const attribution = attributeInboundEvent({
    channel: input.channel,
    fromNumber: input.fromNumber ?? null,
    fromEmail: input.fromEmail ?? null,
    toEmail: input.toEmail ?? null,
    body: input.body ?? null,
    identificationAnswer: input.identificationAnswer ?? null,
    candidates,
  });

  const fingerprint = bodyFingerprint(input.body);
  const seenElsewhere = await fingerprintSeenOnOtherProbes(
    fingerprint, attribution.probeId ? [attribution.probeId] : []);

  // Elapsed time is only meaningful against the probe this event belongs to.
  let secondsSince: number | null = null;
  let submittedAt: Date | null = null;
  if (attribution.probeId) {
    const { rows } = await query<{ submitted_at: Date | null; status: ProbeStatus }>(
      `select submitted_at, status from lead_response_probes where probe_id = $1`,
      [attribution.probeId]);
    submittedAt = rows[0]?.submitted_at ?? null;
    if (submittedAt) secondsSince = elapsedSeconds(submittedAt, input.occurredAt);
  }

  const containsProbeSpecificDetail = Boolean(
    attribution.probeId && input.body
    && candidates.some((probe) => probe.probeId === attribution.probeId
      && input.body!.toLowerCase().includes(probe.probeToken.toLowerCase())));

  const actor = classifyActor({
    channel: input.channel,
    secondsSinceSubmission: secondsSince,
    body: input.body ?? null,
    from: input.fromNumber ?? input.fromEmail ?? null,
    callDisposition: input.callDisposition ?? null,
    fingerprintSeenOnOtherProbes: seenElsewhere,
    identificationAnswered: Boolean(input.identificationAnswer),
    twoWay: input.twoWay,
    containsProbeSpecificDetail,
  });

  return withTransaction(async (client) => {
    const { rows: inserted } = await client.query<{ event_id: string }>(
      `insert into probe_inbound_events (
         provider_sid, channel, from_number, from_number_raw, from_email, to_number,
         pool_number_id, occurred_at, message_body, body_fingerprint, call_disposition,
         actor_type, actor_type_evidence, identification_answer,
         attributed_probe_id, attribution_tier, attribution_confidence,
         attribution_evidence, candidate_probe_ids, execution_mode
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18::jsonb,$19,$20)
       returning event_id`,
      [
        input.providerSid, input.channel,
        normalizePhone(input.fromNumber), input.fromNumber ?? null,
        input.fromEmail ?? null, toNumber, poolNumberId, input.occurredAt,
        boundedBody(input.body), fingerprint, input.callDisposition ?? null,
        actor.actorType, JSON.stringify(actor.evidence),
        input.identificationAnswer ?? null,
        attribution.probeId, attribution.tier, attribution.confidence,
        JSON.stringify(attribution.evidence), attribution.candidateProbeIds,
        input.executionMode ?? 'DRY_RUN',
      ]);
    const eventId = inserted[0]!.event_id;

    if (!attribution.probeId) {
      // Ambiguous or unattributable. Stored, reviewable, and productive of nothing.
      if (attribution.state === 'AMBIGUOUS') {
        for (const probeId of attribution.candidateProbeIds) {
          await recordStateEvent(client, {
            probeId, from: null, to: 'AMBIGUOUS',
            reason: `event ${eventId} could not be attributed between `
              + `${attribution.candidateProbeIds.length} candidates`,
            actor: 'attribution',
          });
        }
      }
      return {
        eventId, duplicate: false, attribution, actorType: actor.actorType,
        milestone: null, probeStatus: null,
        detail: attribution.state === 'AMBIGUOUS'
          ? 'Ambiguous: recorded against every candidate, and no measurement taken.'
          : 'Not attributable to any open probe. Not evidence about any company.',
      };
    }

    const { rows: probeRows } = await client.query<Record<string, unknown>>(
      `select status, first_meaningful_contact_at, elapsed_to_first_response_seconds
         from lead_response_probes where probe_id = $1 for update`,
      [attribution.probeId]);
    const current = probeRows[0]!;
    const status = current['status'] as ProbeStatus;

    const column = milestoneColumn(input.channel, actor.actorType);
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [attribution.probeId];

    if (column) {
      // `coalesce` so the *first* of each kind survives: a second automated SMS does
      // not overwrite the acknowledgement we measured.
      values.push(input.occurredAt);
      sets.push(`${column.at} = coalesce(${column.at}, $${values.length})`);
      values.push(eventId);
      sets.push(`${column.event} = coalesce(${column.event}, $${values.length})`);
    }

    if (secondsSince !== null && current['elapsed_to_first_response_seconds'] === null) {
      values.push(secondsSince);
      sets.push(`elapsed_to_first_response_seconds = $${values.length}`);
    }

    const meaningful = isMeaningfulContact({
      actorType: actor.actorType,
      attributionConfidence: attribution.confidence,
      // A person who called and identified themselves engaged the inquiry; a person
      // whose message references the probe did too.
      engagesInquiry: Boolean(input.identificationAnswer) || Boolean(input.twoWay)
        || containsProbeSpecificDetail || input.channel !== 'SMS',
    });
    if (meaningful && current['first_meaningful_contact_at'] === null) {
      values.push(input.occurredAt);
      sets.push(`first_meaningful_contact_at = $${values.length}`);
      values.push(eventId);
      sets.push(`first_meaningful_contact_event_id = $${values.length}`);
      if (submittedAt) {
        values.push(elapsedSeconds(submittedAt, input.occurredAt));
        sets.push(`elapsed_to_first_meaningful_seconds = $${values.length}`);
      }
    }

    values.push(attribution.confidence);
    sets.push(`attribution_confidence = $${values.length}`);
    sets.push(`attribution_state = 'ATTRIBUTED'`);
    values.push(JSON.stringify(attribution.evidence));
    sets.push(`attribution_evidence = $${values.length}::jsonb`);

    // An automated-only response is AUTO_ACKNOWLEDGED, which is the more specific
    // truth than RESPONDED. Anything else that attributed is RESPONDED.
    const next: ProbeStatus = actor.actorType === 'AUTOMATED' && status === 'SUBMITTED'
      ? 'AUTO_ACKNOWLEDGED'
      : 'RESPONDED';
    let applied: ProbeStatus = status;
    try {
      assertTransition(status, next);
      applied = next;
      values.push(next);
      sets.push(`status = $${values.length}`);
    } catch {
      // A late event on a probe already past this point updates milestones without
      // rewinding the state machine.
      applied = status;
    }

    await client.query(
      `update lead_response_probes set ${sets.join(', ')} where probe_id = $1`, values);
    if (applied !== status) {
      await recordStateEvent(client, {
        probeId: attribution.probeId, from: status, to: applied,
        reason: `${attribution.tier} / ${actor.actorType} via event ${eventId}`,
        actor: 'attribution',
      });
    }

    return {
      eventId, duplicate: false, attribution, actorType: actor.actorType,
      milestone: column?.at ?? null, probeStatus: applied,
      detail: `Attributed at ${attribution.tier} (${attribution.confidence}), actor `
        + `${actor.actorType}.`,
    };
  });
}

/**
 * Close a response window.
 *
 * Window 1 closing is provisional by design: a human callback the next afternoon is
 * the single most interesting measurement this subsystem takes, and a verdict
 * written at window 1 must not be defended by discarding it.
 */
export async function closeWindow(input: {
  probeId: string; window: 1 | 'FINAL'; now: Date;
}): Promise<ProbeStatus> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: ProbeStatus }>(
      `select status from lead_response_probes where probe_id = $1 for update`,
      [input.probeId]);
    const probe = rows[0];
    if (!probe) throw new Error(`No probe ${input.probeId}`);

    // The event ledger is the authority on whether a response arrived, not the six
    // milestone columns.
    //
    // Those columns are a convenience for "first human SMS", "first automated call"
    // and so on, and an UNKNOWN-actor event deliberately populates none of them --
    // filing it under either heading would assert the very thing we could not tell.
    // Deciding presence from them therefore closed a probe that *did* get an
    // attributed reply as NO_RESPONSE_FINAL, while the same row carried an elapsed
    // response time. Internally contradictory, and it understated what happened:
    // UNKNOWN actor is not the same fact as no response.
    const { rows: tally } = await client.query<{
      attributed: string; human: string; automated: string; unknown: string;
    }>(
      `select count(*)::text as attributed,
              count(*) filter (where actor_type = 'HUMAN')::text as human,
              count(*) filter (where actor_type = 'AUTOMATED')::text as automated,
              count(*) filter (where actor_type = 'UNKNOWN')::text as unknown
         from probe_inbound_events
        where attributed_probe_id = $1
          and attribution_confidence in ('HIGH','MEDIUM')`,
      [input.probeId]);
    const counts = tally[0]!;
    const anyAttributedResponse = Number(counts.attributed) > 0;

    const to: ProbeStatus = input.window === 1
      ? (anyAttributedResponse ? probe.status : 'NO_RESPONSE_WINDOW_1')
      : (anyAttributedResponse ? 'ATTRIBUTED' : 'NO_RESPONSE_FINAL');

    const column = input.window === 1 ? 'window_1_closed_at' : 'window_final_closed_at';
    if (to === probe.status) {
      await client.query(
        `update lead_response_probes set ${column} = $2, updated_at = now()
          where probe_id = $1`, [input.probeId, input.now]);
      return probe.status;
    }

    assertTransition(probe.status, to);
    await client.query(
      `update lead_response_probes
          set status = $2, ${column} = $3, final_outcome = $4, updated_at = now()
        where probe_id = $1`,
      [input.probeId, to, input.now, to]);
    await recordStateEvent(client, {
      probeId: input.probeId, from: probe.status, to,
      reason: `window ${input.window} closed; `
        + (anyAttributedResponse
          ? `${counts.attributed} attributed response(s): `
            + `${counts.human} human, ${counts.automated} automated, `
            + `${counts.unknown} of unknown actor`
          : 'no attributed response on monitored channels'),
      actor: 'window',
    });
    return to;
  });
}
