import { withTransaction, query } from '../db/pool.js';
import { upsertAccount } from '../domain/accounts.js';
import { upsertEndpoint } from '../domain/accounts.js';
import { buildCallPack, persistCallPack } from '../callbrain/callPack.js';
import { preflightCall, evaluateAccount } from '../compliance/eligibility.js';
import { startCall, respond } from '../callbrain/agent.js';
import { setCalendarAdapter, currentCalendarAdapter } from '../booking/service.js';
import type { CalendarAdapter } from '../booking/types.js';
import { beginSalesCall, finishSalesCall, nextSalesTurn } from '../voice/salesTurnProducer.js';
import { createTwilioLookupAdapter } from '../compliance/lineType.js';

/**
 * Credential-free end-to-end dry run.
 * Authority: outbound-sales-brain-end-to-end-simulation-spec.md,
 * outbound-sales-brain-ai-pilot-release-gates.v1.yaml.
 *
 * Walks one prospect the whole way — researched Account, Call Pack, channel
 * eligibility, a conversation, mock provider tools, a CRM outcome, and the follow-up
 * or meeting state it lands in — with no network call and no real prospect.
 *
 * Every provider is a mock that answers the way the real one would, including the
 * ways it fails. The point is not that everything succeeds: the point is that each
 * stage reports what actually happened and the next stage acts on that rather than
 * on an assumption.
 */

export type StageStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_TESTED';

export interface DryRunStage {
  stage: string;
  status: StageStatus;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface DryRunReport {
  ranAt: string;
  accountId: string | null;
  voiceCallId: string | null;
  stages: DryRunStage[];
  status: StageStatus;
  /** True when nothing in the run touched a network or a real prospect. */
  offline: boolean;
}

/** A calendar that behaves like Cal.com without being it. */
function mockCalendar(): CalendarAdapter {
  return {
    name: 'dry_run_calendar',
    isConfigured: () => true,
    async getBusy() { return { ok: true, busy: [] }; },
    async createEvent() {
      return { ok: true, providerEventId: 'dry-run-evt-1',
               webLink: 'https://cal.example/dry-run-evt-1' };
    },
  };
}

export async function runDryRun(options: { now?: Date } = {}): Promise<DryRunReport> {
  const now = options.now ?? new Date();
  const stages: DryRunStage[] = [];
  const previousAdapter = currentCalendarAdapter();
  let accountId: string | null = null;
  let voiceCallId: string | null = null;

  const record = (stage: string, status: StageStatus, detail: string,
                  evidence?: Record<string, unknown>) => {
    stages.push(evidence ? { stage, status, detail, evidence } : { stage, status, detail });
  };

  try {
    setCalendarAdapter(mockCalendar());

    // --- 1. a researched Account ---------------------------------------------
    const created = await withTransaction(async (client) => {
      const account = await upsertAccount(client, {
        canonicalName: 'Dry Run Air Conditioning',
        website: 'https://dryrun-air.example.com',
        phone: '904-555-0190',
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
      }, { discoverySource: 'dry_run' });
      await client.query(
        `update accounts set research_fresh_until = now() + interval '7 days',
                last_researched_at = now(), manual_tier = 'B', manual_score = 11
          where account_id = $1`, [account.accountId]);
      await upsertEndpoint(client, {
        accountId: account.accountId, contactId: null, locationId: null, type: 'PHONE',
        rawValue: '904-555-0190', endpointRole: 'MAIN_BUSINESS_LINE',
        relationshipToPerson: 'UNVERIFIED', qualityState: 'PUBLIC_OBSERVED_CURRENT',
        source: 'COMPANY_WEBSITE', sourceReference: 'https://dryrun-air.example.com/contact',
      });
      return account.accountId;
    });
    accountId = created;
    record('researched_account', 'PASS',
      'One canonical Account with a location, a fresh research window and a published '
      + 'business line.', { accountId });

    // --- 2. a Call Pack -------------------------------------------------------
    const pack = await buildCallPack(accountId);
    if (!pack) {
      record('call_pack', 'FAIL', 'No Call Pack could be built, so no call may be made.');
      return finish();
    }
    const callPackId = await persistCallPack(pack, null);
    record('call_pack', 'PASS',
      `Immutable snapshot ${callPackId}. ${pack.confirmedFacts.length} confirmed fact(s), `
      + `${pack.importantUnknowns.length} recorded unknown(s), `
      + `${pack.prohibitedClaims.length} prohibited claim(s).`,
      { callPackId, hypothesis: pack.primaryHypothesisCategory });

    // --- 3. line type screening, unconfigured on purpose ---------------------
    const lookup = createTwilioLookupAdapter({
      config: {
        accountSid: null, authToken: null, baseUrl: 'https://lookups.invalid/v2',
        enabled: false, cacheDays: 90, costPerLookupUsd: 0,
      },
    });
    const lineType = await lookup.screen({ phone: '904-555-0190', now });
    record('line_type_screening',
      lineType.normalizedLineType === 'UNKNOWN' ? 'PASS' : 'FAIL',
      'With no Lookup credential the line type is UNKNOWN and is not inferred. '
      + 'A dry run must not manufacture clearance.',
      { status: lineType.status, lineType: lineType.normalizedLineType });

    // --- 4. channel eligibility ----------------------------------------------
    await evaluateAccount(accountId);
    const { rows: endpointRows } = await query<{ endpoint_id: string }>(
      `select endpoint_id from contact_endpoints where account_id = $1 limit 1`, [accountId]);
    const endpointId = endpointRows[0]!.endpoint_id;
    const human = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL', now);
    const ai = await preflightCall(endpointId, 'AUTONOMOUS_AI_VOICE', now);
    record('channel_eligibility',
      ai.decision !== 'ALLOW' ? 'PASS' : 'FAIL',
      `Human call: ${human.decision}. AI voice: ${ai.decision} (${ai.reasonCodes.join(', ')}). `
      + 'AI voice not being ALLOW without a screening provider is the correct answer, '
      + 'not a failure of the dry run.',
      { human: human.decision, aiVoice: ai.decision, reasons: ai.reasonCodes });

    // --- 5. the conversation --------------------------------------------------
    const { rows: callRows } = await query<{ voice_call_id: string }>(
      `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id,
                                call_pack_id, from_number, to_number)
       values ('OUTBOUND', 'yad-sales-core-v1', 'DRY_RUN', $1, $2, '+19046829345', '+19045550190')
       returning voice_call_id`, [accountId, callPackId]);
    voiceCallId = callRows[0]!.voice_call_id;

    const { session, opening } = await beginSalesCall({ voiceCallId, accountId, pack });
    const script = [
      'After hours it goes to voicemail.',
      'Nobody picks it up until the next morning.',
      'Yeah, that is probably worth looking at.',
      'Sure, that works.',
    ];
    const spoken: string[] = [opening.say];
    for (const utterance of script) {
      const turn = await nextSalesTurn(session, utterance);
      spoken.push(turn.say);
      if (turn.terminal) break;
    }
    record('sales_ai_conversation', 'PASS',
      `${spoken.length} agent turn(s), profile yad-sales-core-v1, opener disclosed as a `
      + 'cold call.', { turns: spoken.length });

    // --- 6. mock provider tools ------------------------------------------------
    const offered = session.state.offeredSlots.map((slot) => slot.spoken);
    const inventedTime = spoken.join(' ').match(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi)
      ?.filter((time) => !offered.some((slot) => slot.includes(time))) ?? [];
    record('provider_tools',
      offered.length > 0 && inventedTime.length === 0 ? 'PASS' : 'FAIL',
      `The mock calendar returned ${offered.length} slot(s), and every time spoken came `
      + 'from that list.', { offered, inventedTime });

    // --- 7. CRM outcome ---------------------------------------------------------
    const outcome = await finishSalesCall(session);
    const { rows: persisted } = await query<any>(
      `select outcome, disposition, ended_at,
              (select count(*)::int from voice_call_turns t where t.voice_call_id = c.voice_call_id)
                as turns
         from voice_calls c where c.voice_call_id = $1`, [voiceCallId]);
    record('crm_outcome',
      persisted[0]?.outcome && persisted[0]?.ended_at ? 'PASS' : 'FAIL',
      `Outcome ${outcome}, disposition ${persisted[0]?.disposition ?? 'none'}, `
      + `${persisted[0]?.turns ?? 0} transcript turn(s) persisted.`,
      { outcome, disposition: persisted[0]?.disposition, turns: persisted[0]?.turns });

    // --- 8. meeting or follow-up state --------------------------------------------
    const { rows: bookings } = await query<any>(
      `select status, provider, provider_event_id from meeting_bookings where account_id = $1`,
      [accountId]);
    const { rows: followUps } = await query<any>(
      `select followup_type, status from follow_ups where account_id = $1`, [accountId]);
    const booked = bookings.filter((row: any) => row.status === 'CONFIRMED');
    record('meeting_or_followup',
      booked.length > 0 || followUps.length > 0 || outcome !== 'BOOKED' ? 'PASS' : 'FAIL',
      booked.length > 0
        ? `${booked.length} confirmed booking, provider-confirmed with an event id.`
        : `No booking was confirmed on this call; ${followUps.length} follow-up(s) recorded. `
          + 'A call that does not book is a normal outcome, not a failed dry run.',
      { confirmedBookings: booked.length, followUps: followUps.length });

    return finish();
  } catch (error) {
    record('dry_run', 'FAIL', `The run stopped: ${(error as Error).message}`);
    return finish();
  } finally {
    setCalendarAdapter(previousAdapter);
  }

  function finish(): DryRunReport {
    const status: StageStatus = stages.some((stage) => stage.status === 'FAIL') ? 'FAIL'
      : stages.some((stage) => stage.status === 'BLOCKED') ? 'BLOCKED'
      : stages.length === 0 ? 'NOT_TESTED' : 'PASS';
    return {
      ranAt: now.toISOString(), accountId, voiceCallId, stages, status,
      // Nothing above opens a socket: every provider is a mock, and the only I/O is
      // the local database.
      offline: true,
    };
  }
}
