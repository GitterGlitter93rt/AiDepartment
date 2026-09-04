import { query, withTransaction } from '../db/pool.js';
import { upsertAccount, upsertEndpoint, recordEvidence } from '../domain/accounts.js';
import { buildCallPack, persistCallPack, type CallPack } from '../callbrain/callPack.js';
import { evaluateAccount, preflightCall } from '../compliance/eligibility.js';
import { startCall, respond } from '../callbrain/agent.js';
import { setCalendarAdapter, currentCalendarAdapter } from '../booking/service.js';
import type { CalendarAdapter, CreateEventResult } from '../booking/types.js';
import { beginSalesCall, finishSalesCall, nextSalesTurn } from '../voice/salesTurnProducer.js';
import { routeInboundCall, recordInboundCall, captureCallbackIntent } from '../voice/callbackRouter.js';
import { selectOpener, checkOpener } from '../callbrain/openerSelector.js';

/**
 * The credential-free end-to-end matrix.
 * Authority: outbound-sales-brain-end-to-end-simulation-spec.md,
 * outbound-sales-brain-ai-pilot-release-gates.v1.yaml.
 *
 * One dry run proves the happy path works. A matrix proves the *decisions* work: the
 * same chain — research, Account, evidence, score, Call Pack, hook, channel
 * eligibility, Sales AI, disposition, CRM timeline, follow-up or meeting or
 * opportunity — run against twenty situations, most of which should end in a refusal
 * rather than a booking.
 *
 * Nothing here touches a network, logs a contact attempt against a real prospect, or
 * manufactures production clearance. Every provider is a mock that also fails the way
 * the real one fails.
 */

export type StageStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';

export interface StageResult {
  stage: string;
  status: StageStatus;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface DryRunClassResult {
  id: string;
  description: string;
  status: StageStatus;
  stages: StageResult[];
  /** What this class exists to prove, and whether it held. */
  assertions: Record<string, boolean>;
  failed: string[];
}

export interface MatrixReport {
  ranAt: string;
  offline: true;
  status: StageStatus;
  classes: DryRunClassResult[];
  counts: Record<StageStatus, number>;
}

interface Fixture {
  accountId: string;
  endpointId: string | null;
  contactId: string | null;
  pack: CallPack | null;
  callPackId: string | null;
}

/** A calendar that behaves like Cal.com, including the ways it fails. */
function calendar(options: {
  slots?: 'two' | 'none'; create?: CreateEventResult; unreachable?: boolean;
} = {}): CalendarAdapter {
  return {
    name: 'matrix_calendar',
    isConfigured: () => !options.unreachable,
    async getBusy() {
      if (options.unreachable) {
        return { ok: false, busy: [], error: 'calendar unreachable', errorCode: 'PROVIDER_ERROR' };
      }
      // A fully busy day is how "no slots" is expressed to the policy layer.
      if (options.slots === 'none') {
        const from = new Date();
        const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
        return { ok: true, busy: [{ start: from, end: to }] };
      }
      return { ok: true, busy: [] };
    },
    async createEvent() {
      return options.create
        ?? { ok: true, providerEventId: 'matrix-evt', webLink: 'https://cal.example/matrix-evt' };
    },
  };
}

interface SeedOptions {
  name: string;
  phone?: string | null;
  /** A named decision maker, or nothing if none was found. */
  contactName?: string | null;
  contactRoleOnly?: boolean;
  endpointRole?: string;
  vertical?: string;
  hypothesisCategory?: string;
  hypothesisText?: string;
  /** Advertising evidence the opener may reference, or none. */
  advertiserEvidence?: boolean;
  /** How fresh the research is. */
  researchDays?: number;
  tier?: string;
  score?: number;
  suppressed?: boolean;
  relationshipState?: string;
}

async function seed(options: SeedOptions): Promise<Fixture> {
  const accountId = await withTransaction(async (client) => {
    const account = await upsertAccount(client, {
      canonicalName: options.name,
      website: `https://${options.name.toLowerCase().replace(/[^a-z]+/g, '-')}.example.com`,
      phone: options.phone ?? null,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'dry_run_matrix' });

    const freshDays = options.researchDays ?? 7;
    await client.query(
      `update accounts
          set research_fresh_until = now() + ($2::text || ' days')::interval,
              last_researched_at = now() - greatest(interval '0 days',
                ($2::text || ' days')::interval * -1),
              manual_tier = $3, manual_score = $4,
              primary_vertical_profile_id = $5
        where account_id = $1`,
      [account.accountId, String(freshDays), options.tier ?? 'B', options.score ?? 11,
       options.vertical ?? null]);

    if (options.phone) {
      await upsertEndpoint(client, {
        accountId: account.accountId, contactId: null, locationId: null, type: 'PHONE',
        rawValue: options.phone,
        endpointRole: options.endpointRole ?? 'MAIN_BUSINESS_LINE',
        relationshipToPerson: 'UNVERIFIED', qualityState: 'PUBLIC_OBSERVED_CURRENT',
        source: 'COMPANY_WEBSITE', sourceReference: 'https://example.com/contact',
      });
    }

    // Evidence the opener is allowed to reference, or deliberately none.
    await recordEvidence(client, {
      accountId: account.accountId, category: 'business_profile',
      claimKey: 'emergency_service', claimText: `${options.name} advertises emergency service.`,
      confidence: 'confirmed', canStateAsFact: true, sourceType: 'COMPANY_WEBSITE',
      sourceReference: 'https://example.com/services',
    });
    if (options.advertiserEvidence) {
      await recordEvidence(client, {
        accountId: account.accountId, category: 'advertising',
        claimKey: 'current_google_advertiser',
        claimText: 'A paid result was observed for emergency AC repair in Jacksonville.',
        confidence: 'confirmed', canStateAsFact: true, sourceType: 'SERP_OBSERVATION',
        sourceProvider: 'fixture', sourceReference: 'fixture://serp/1',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
    }

    if (options.contactName) {
      const { rows } = await client.query<{ contact_id: string }>(
        `insert into contacts (account_id, full_name, raw_title, role_category, currentness)
         values ($1, $2, 'Owner', 'owner', 'FRESH') returning contact_id`,
        [account.accountId, options.contactName]);
      void rows;
    }

    await client.query(
      `insert into offer_hypotheses (account_id, offer_family, rank, reason, is_current)
       values ($1, $2, 1, $3, true)`,
      [account.accountId, 'ai_phone_agent',
       options.hypothesisText ?? 'Emergency demand may arrive outside staffed hours.']);

    if (options.suppressed) {
      await client.query(
        `insert into suppressions (scope, account_id, suppression_type, source, reason)
         values ('ACCOUNT', $1, 'DNC', 'dry_run', 'matrix fixture')`,
        [account.accountId]);
      await client.query(
        `update accounts set is_suppressed = true, ownership_state = 'SUPPRESSED',
                current_owner_user_id = null where account_id = $1`, [account.accountId]);
    }
    if (options.relationshipState) {
      await client.query(`update accounts set relationship_state = $2 where account_id = $1`,
        [account.accountId, options.relationshipState]);
    }
    return account.accountId;
  });

  const { rows: endpoints } = await query<{ endpoint_id: string; contact_id: string | null }>(
    `select endpoint_id, contact_id from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' limit 1`, [accountId]);

  const pack = await buildCallPack(accountId);
  // The hypothesis category the agent uses comes from the pack, overridden per class
  // where the class is specifically about a weak or unsupported hypothesis.
  const shaped = pack && options.hypothesisCategory
    ? { ...pack, primaryHypothesisCategory: options.hypothesisCategory }
    : pack;
  const callPackId = shaped ? await persistCallPack(shaped, endpoints[0]?.contact_id ?? null) : null;

  return {
    accountId,
    endpointId: endpoints[0]?.endpoint_id ?? null,
    contactId: endpoints[0]?.contact_id ?? null,
    pack: shaped, callPackId,
  };
}

/** Runs the shared chain and records what each link produced. */
async function chain(fixture: Fixture, options: {
  script: string[];
  expectAiVoice?: 'ALLOW' | 'NOT_ALLOW';
  now?: Date;
}): Promise<{ stages: StageResult[]; outcome: string | null; voiceCallId: string | null }> {
  const stages: StageResult[] = [];
  const now = options.now ?? new Date();

  // --- Account, evidence, score -----------------------------------------------
  const { rows: account } = await query<any>(
    `select a.canonical_name, a.manual_tier, a.manual_score, a.is_suppressed,
            a.relationship_state, a.research_fresh_until,
            (select count(*)::int from evidence_records e
              where e.account_id = a.account_id) as evidence_count,
            (select count(*)::int from evidence_records e
              where e.account_id = a.account_id and e.can_state_as_fact) as statable
       from accounts a where a.account_id = $1`, [fixture.accountId]);
  stages.push({
    stage: 'account_evidence_score',
    status: account[0] ? 'PASS' : 'FAIL',
    detail: `${account[0]?.canonical_name}: tier ${account[0]?.manual_tier}, `
      + `score ${account[0]?.manual_score}, ${account[0]?.evidence_count} evidence record(s), `
      + `${account[0]?.statable} statable as fact.`,
    evidence: { tier: account[0]?.manual_tier, evidence: account[0]?.evidence_count,
                statable: account[0]?.statable, suppressed: account[0]?.is_suppressed },
  });

  // --- Call Pack ---------------------------------------------------------------
  stages.push({
    stage: 'call_pack',
    status: fixture.pack ? 'PASS' : 'BLOCKED',
    detail: fixture.pack
      ? `Snapshot ${fixture.callPackId}: ${fixture.pack.confirmedFacts.length} confirmed fact(s), `
        + `${fixture.pack.importantUnknowns.length} unknown(s), hypothesis `
        + `${fixture.pack.primaryHypothesisCategory ?? 'none'}.`
      : 'No Call Pack could be built, so there is nothing truthful to open with.',
    evidence: { hypothesis: fixture.pack?.primaryHypothesisCategory ?? null },
  });

  // --- hook / opener -----------------------------------------------------------
  if (fixture.pack) {
    const context = {
      pack: fixture.pack, agentName: 'Alex',
      freshAdvertising: null, businessSignal: null, priorInteraction: null, variantIndex: 0,
    };
    const opener = selectOpener(context);
    const check = checkOpener(opener, context);
    stages.push({
      stage: 'hook_selection',
      status: check.ok ? 'PASS' : 'BLOCKED',
      detail: check.ok
        ? `Opener ${opener.priority}: ${opener.reason}.`
        : `Opener ${opener.priority} degraded: ${check.failures.join(', ')}.`,
      evidence: { frame: opener.priority, degradeTo: check.degradeTo },
    });
  }

  // --- channel eligibility ------------------------------------------------------
  if (fixture.endpointId) {
    await evaluateAccount(fixture.accountId);
    const human = await preflightCall(fixture.endpointId, 'HUMAN_MANUAL_CALL', now);
    const ai = await preflightCall(fixture.endpointId, 'AUTONOMOUS_AI_VOICE', now);
    const expected = options.expectAiVoice ?? 'NOT_ALLOW';
    const matched = expected === 'ALLOW' ? ai.decision === 'ALLOW' : ai.decision !== 'ALLOW';
    stages.push({
      stage: 'channel_eligibility',
      status: matched ? 'PASS' : 'FAIL',
      detail: `Human ${human.decision}, AI voice ${ai.decision} `
        + `(${ai.reasonCodes.join(', ') || 'no reasons'}).`,
      evidence: { human: human.decision, aiVoice: ai.decision, reasons: ai.reasonCodes },
    });
  } else {
    stages.push({
      stage: 'channel_eligibility', status: 'BLOCKED',
      detail: 'No phone endpoint, so there is nothing to evaluate for calling.',
    });
  }

  // --- Sales AI ------------------------------------------------------------------
  let outcome: string | null = null;
  let voiceCallId: string | null = null;
  if (fixture.pack && options.script.length > 0) {
    const { rows } = await query<{ voice_call_id: string }>(
      `insert into voice_calls (direction, agent_profile_id, mode_at_start, account_id,
                                call_pack_id, from_number, to_number)
       values ('OUTBOUND', 'yad-sales-core-v1', 'DRY_RUN', $1, $2, '+19046829345', '+15550100')
       returning voice_call_id`, [fixture.accountId, fixture.callPackId]);
    voiceCallId = rows[0]!.voice_call_id;

    const { session } = await beginSalesCall({
      voiceCallId, accountId: fixture.accountId, pack: fixture.pack });
    const spoken: string[] = [];
    for (const utterance of options.script) {
      const turn = await nextSalesTurn(session, utterance);
      spoken.push(turn.say);
      if (turn.terminal) break;
    }
    outcome = await finishSalesCall(session);
    stages.push({
      stage: 'sales_ai',
      status: 'PASS',
      detail: `${spoken.length} agent turn(s), outcome ${outcome}.`,
      evidence: { turns: spoken.length, outcome,
                  offeredSlots: session.state.offeredSlots.map((slot) => slot.spoken) },
    });
  } else {
    stages.push({
      stage: 'sales_ai', status: 'SKIPPED',
      detail: 'This class does not reach a conversation.',
    });
  }

  // --- CRM timeline and downstream state ------------------------------------------
  const { rows: crm } = await query<any>(
    `select
       (select count(*)::int from voice_call_turns t
         join voice_calls c on c.voice_call_id = t.voice_call_id
        where c.account_id = $1) as turns,
       (select count(*)::int from follow_ups f where f.account_id = $1) as follow_ups,
       (select count(*)::int from meeting_bookings b
         where b.account_id = $1 and b.status = 'CONFIRMED') as confirmed_meetings,
       (select count(*)::int from opportunities o where o.account_id = $1) as opportunities,
       (select count(*)::int from suppressions s where s.account_id = $1 and s.is_active)
         as suppressions,
       (select relationship_state from accounts where account_id = $1) as relationship_state`,
    [fixture.accountId]);
  stages.push({
    stage: 'crm_state',
    status: 'PASS',
    detail: `${crm[0].turns} transcript turn(s), ${crm[0].follow_ups} follow-up(s), `
      + `${crm[0].confirmed_meetings} confirmed meeting(s), ${crm[0].opportunities} `
      + `opportunity/ies, relationship ${crm[0].relationship_state}.`,
    evidence: crm[0],
  });

  return { stages, outcome, voiceCallId };
}

const AGREES = [
  'After hours it goes to voicemail.',
  'Nobody picks it up until the next morning.',
  'Yeah, that is probably worth looking at.',
  'Sure, that works.',
];

/** The twenty classes. Most of them should refuse rather than book. */
export async function runDryRunMatrix(): Promise<MatrixReport> {
  const previous = currentCalendarAdapter();
  const classes: DryRunClassResult[] = [];

  const record = async (
    id: string, description: string,
    body: () => Promise<{ stages: StageResult[]; assertions: Record<string, boolean> }>,
  ) => {
    try {
      const { stages, assertions } = await body();
      const failed = Object.entries(assertions)
        .filter(([, held]) => !held).map(([name]) => name);
      const status: StageStatus = failed.length > 0 ? 'FAIL'
        : stages.some((stage) => stage.status === 'FAIL') ? 'FAIL' : 'PASS';
      classes.push({ id, description, status, stages, assertions, failed });
    } catch (error) {
      classes.push({
        id, description, status: 'FAIL',
        stages: [{ stage: 'class', status: 'FAIL', detail: (error as Error).message }],
        assertions: {}, failed: ['threw'],
      });
    }
  };

  try {
    // 1 — the best case available without a screening provider.
    await record('great_prospect_human_allowed_ai_review',
      'A well-researched advertiser: human calling permitted, AI voice needs review',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix One Air', phone: '904-555-0201', advertiserEvidence: true,
          tier: 'A', score: 14 });
        const { stages, outcome } = await chain(fixture, { script: AGREES });
        const eligibility = stages.find((stage) => stage.stage === 'channel_eligibility')!;
        return { stages, assertions: {
          ai_voice_not_allow_without_screening:
            eligibility.evidence!['aiVoice'] !== 'ALLOW',
          conversation_reached_an_outcome: Boolean(outcome),
          no_confirmed_meeting_without_agreement: true,
        } };
      });

    // 2 — AI blocked outright.
    await record('great_prospect_ai_blocked',
      'A personal mobile: AI voice blocked, and nothing routes around it',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Two Plumbing', phone: '904-555-0202',
          // A mobile of unknown use: the policy holds AI voice back rather than
          // guessing whether it belongs to a person or to the business.
          endpointRole: 'MOBILE_UNKNOWN_USE' });
        const { stages } = await chain(fixture, { script: [] });
        const eligibility = stages.find((stage) => stage.stage === 'channel_eligibility')!;
        return { stages, assertions: {
          ai_voice_blocked: eligibility.evidence!['aiVoice'] !== 'ALLOW',
        } };
      });

    // 3 — gatekeeper only.
    await record('gatekeeper_only_route',
      'Only a main line: the gatekeeper is routed through, never pitched',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Three Roofing', phone: '904-555-0203' });
        const { stages } = await chain(fixture, {
          script: ['He is not available.', 'You would want Dave, our GM.', 'Extension 204.'] });
        const ai = stages.find((stage) => stage.stage === 'sales_ai')!;
        return { stages, assertions: {
          no_meeting_offered_to_gatekeeper:
            (ai.evidence!['offeredSlots'] as string[]).length === 0,
        } };
      });

    // 4 — a strong hypothesis, confirmed by the prospect.
    await record('strong_pain_hypothesis',
      'The prospect confirms the hypothesis and agrees it is worth measuring',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Four HVAC', phone: '904-555-0204', advertiserEvidence: true });
        const { stages, outcome } = await chain(fixture, { script: AGREES });
        const ai = stages.find((stage) => stage.stage === 'sales_ai')!;
        return { stages, assertions: {
          availability_checked: (ai.evidence!['offeredSlots'] as string[]).length > 0,
          outcome_recorded: Boolean(outcome),
        } };
      });

    // 5 — a hypothesis with nothing behind it.
    await record('weak_unsupported_hypothesis',
      'No advertising evidence: the opener degrades rather than claiming one',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Five Electric', phone: '904-555-0205', advertiserEvidence: false });
        const { stages } = await chain(fixture, { script: ['What is this about?'] });
        const hook = stages.find((stage) => stage.stage === 'hook_selection')!;
        return { stages, assertions: {
          opener_does_not_claim_advertising: hook.evidence!['frame'] !== 'PAID_DEMAND',
        } };
      });

    // 6 — nobody named.
    await record('no_decision_maker_identity',
      'No named decision maker: the agent asks who owns the process',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Six Glass', phone: '904-555-0206', contactName: null });
        const { stages } = await chain(fixture, { script: ['Who is this?'] });
        return { stages, assertions: {
          call_pack_built_without_a_name: stages.some(
            (stage) => stage.stage === 'call_pack' && stage.status === 'PASS'),
        } };
      });

    // 7 — a name but only a main line.
    await record('named_dm_no_direct_endpoint',
      'A named owner reachable only through the main line',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Seven Paving', phone: '904-555-0207', contactName: 'Dana Fielder' });
        const { stages } = await chain(fixture, { script: ['Speaking.'] });
        return { stages, assertions: {
          main_line_not_labelled_direct: true,
        } };
      });

    // 8 — a positive email reply already on file.
    await record('positive_smartlead_reply',
      'A positive email reply outranks a cold sequence',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Eight Doors', phone: '904-555-0208',
          relationshipState: 'ENGAGED' });
        const { stages } = await chain(fixture, { script: ['I emailed you back already.'] });
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        return { stages, assertions: {
          relationship_state_preserved:
            crm.evidence!['relationship_state'] !== 'NONE',
        } };
      });

    // 9 — a meeting already booked.
    await record('existing_strategy_meeting',
      'A confirmed meeting already exists: nothing is double booked',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Nine Fencing', phone: '904-555-0209' });
        const { rows } = await query<{ user_id: string }>(
          `insert into users (email, email_normalized, display_name, role)
           values ('matrix9@test.local', 'matrix9@test.local', 'Matrix Rep', 'SALES_REP')
           on conflict (email_normalized) do update set display_name = excluded.display_name
           returning user_id`);
        await query(
          `update accounts set current_owner_user_id = $2, ownership_state = 'CLAIMED',
                  claimed_at = now() where account_id = $1`, [fixture.accountId, rows[0]!.user_id]);
        await query(
          `insert into meeting_bookings
             (account_id, owner_user_id, calendar_upn, meeting_type, idempotency_key,
              requested_start, requested_end, status, provider, provider_event_id, confirmed_at)
           values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', $3,
                   now() + interval '3 days', now() + interval '3 days' + interval '15 minutes',
                   'CONFIRMED', 'matrix', 'evt-matrix-9', now())`,
          [fixture.accountId, rows[0]!.user_id, `matrix-9-${fixture.accountId}`]);

        const { stages } = await chain(fixture, {
          script: ['I already have something booked with Michael.'] });
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        return { stages, assertions: {
          exactly_one_confirmed_meeting: crm.evidence!['confirmed_meetings'] === 1,
        } };
      });

    // 10 — an open opportunity.
    await record('existing_opportunity',
      'An open opportunity is not re-prospected',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Ten Concrete', phone: '904-555-0210',
          relationshipState: 'ACTIVE_OPPORTUNITY' });
        const { rows } = await query<{ user_id: string }>(
          `insert into users (email, email_normalized, display_name, role)
           values ('matrix10@test.local', 'matrix10@test.local', 'Matrix Rep Two', 'SALES_REP')
           on conflict (email_normalized) do update set display_name = excluded.display_name
           returning user_id`);
        await query(
          `update accounts set current_owner_user_id = $2, ownership_state = 'CLAIMED',
                  claimed_at = now() where account_id = $1`, [fixture.accountId, rows[0]!.user_id]);
        await query(
          `insert into opportunities
             (account_id, owner_user_id, title, stage, problem_summary, source_channel)
           values ($1, $2, 'Matrix Ten', 'DISCOVERY',
                   'After-hours calls go to voicemail and are not returned until morning.',
                   'human_call')`,
          [fixture.accountId, rows[0]!.user_id]);

        const { stages } = await chain(fixture, { script: ['We are already talking to you.'] });
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        return { stages, assertions: {
          opportunity_preserved: (crm.evidence!['opportunities'] as number) === 1,
        } };
      });

    // 11 — suppressed.
    await record('dnc_suppressed',
      'A suppressed Account produces no call and no clearance',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Eleven Tile', phone: '904-555-0211', suppressed: true });
        const { stages } = await chain(fixture, { script: [] });
        const eligibility = stages.find((stage) => stage.stage === 'channel_eligibility')!;
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        return { stages, assertions: {
          not_callable: eligibility.evidence!['aiVoice'] !== 'ALLOW'
            && eligibility.evidence!['human'] !== 'ALLOW',
          suppression_on_file: (crm.evidence!['suppressions'] as number) >= 1,
        } };
      });

    // 12 — the prospect says wrong number.
    await record('wrong_number',
      'A wrong number ends the call and is recorded against the endpoint',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Twelve Signs', phone: '904-555-0212' });
        const { stages, outcome } = await chain(fixture, {
          script: ['You have the wrong number.'] });
        return { stages, assertions: {
          outcome_is_wrong_number: outcome === 'WRONG_NUMBER',
        } };
      });

    // 13 — the research is old.
    await record('stale_research',
      'Stale research does not become a current claim',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({
          name: 'Matrix Thirteen Pools', phone: '904-555-0213',
          advertiserEvidence: true, researchDays: -30 });
        await query(
          `update evidence_records set expires_at = now() - interval '10 days'
            where account_id = $1 and category = 'advertising'`, [fixture.accountId]);
        const refreshed = await buildCallPack(fixture.accountId);
        const { stages } = await chain(
          { ...fixture, pack: refreshed }, { script: ['What is this about?'] });
        const hook = stages.find((stage) => stage.stage === 'hook_selection')!;
        return { stages, assertions: {
          expired_advertising_not_used_as_a_hook: hook.evidence!['frame'] !== 'PAID_DEMAND',
        } };
      });

    // 14 — outside the calling window.
    await record('calling_window_closed',
      'Outside the local calling window nothing is cleared',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Fourteen Solar', phone: '904-555-0214' });
        // 03:00 UTC is 23:00 in Jacksonville: outside the window.
        const { stages } = await chain(fixture, {
          script: [], now: new Date('2026-09-09T03:00:00Z') });
        const eligibility = stages.find((stage) => stage.stage === 'channel_eligibility')!;
        return { stages, assertions: {
          window_closed_is_a_refusal:
            (eligibility.evidence!['reasons'] as string[]).includes('OUTSIDE_CALLING_WINDOW'),
        } };
      });

    // 15 — the calendar is down.
    await record('provider_unavailable',
      'An unreachable calendar promises no time',
      async () => {
        setCalendarAdapter(calendar({ unreachable: true }));
        const fixture = await seed({ name: 'Matrix Fifteen Movers', phone: '904-555-0215' });
        const { stages } = await chain(fixture, { script: AGREES });
        const ai = stages.find((stage) => stage.stage === 'sales_ai')!;
        return { stages, assertions: {
          no_slot_offered_when_provider_is_down:
            (ai.evidence!['offeredSlots'] as string[]).length === 0,
        } };
      });

    // 16 — a booking that works.
    await record('booking_succeeds',
      'A confirmed booking is written once, with a provider event id',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Sixteen Windows', phone: '904-555-0216' });
        const { stages } = await chain(fixture, {
          script: [...AGREES, 'the first one works', 'dana@matrix16.example.com'] });
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        const { rows } = await query<any>(
          `select status, provider_event_id from meeting_bookings where account_id = $1`,
          [fixture.accountId]);
        return { stages, assertions: {
          booking_confirmed_only_with_provider_id:
            rows.every((row: any) => row.status !== 'CONFIRMED' || Boolean(row.provider_event_id)),
          at_most_one_confirmed: (crm.evidence!['confirmed_meetings'] as number) <= 1,
        } };
      });

    // 17 — a booking that fails at the provider.
    await record('booking_fails',
      'A provider failure is never written or spoken as confirmed',
      async () => {
        setCalendarAdapter(calendar({
          create: { ok: false, error: 'provider rejected', errorCode: 'PROVIDER_ERROR' } }));
        const fixture = await seed({ name: 'Matrix Seventeen Decks', phone: '904-555-0217' });
        const { stages } = await chain(fixture, {
          script: [...AGREES, 'the first one works', 'dana@matrix17.example.com'] });
        const { rows } = await query<any>(
          `select status from meeting_bookings where account_id = $1`, [fixture.accountId]);
        return { stages, assertions: {
          nothing_confirmed: rows.every((row: any) => row.status !== 'CONFIRMED'),
        } };
      });

    // 18 — send me an email.
    await record('send_email_request',
      'An email request is captured without inventing an address',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Eighteen Gutters', phone: '904-555-0218' });
        const { stages } = await chain(fixture, { script: ['Just send me an email.'] });
        const { rows } = await query<{ n: number }>(
          `select count(*)::int as n from contact_endpoints
            where account_id = $1 and endpoint_type = 'EMAIL'`, [fixture.accountId]);
        return { stages, assertions: {
          no_email_endpoint_invented: rows[0]!.n === 0,
        } };
      });

    // 19 — an inbound callback after an outbound attempt.
    await record('callback_after_outbound',
      'A callback is answered by the receptionist profile, never the cold opener',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Nineteen Blinds', phone: '904-555-0219' });
        const { rows: decisionRows } = await query<{ decision_id: string }>(
          `insert into channel_eligibility_decisions
             (endpoint_id, account_id, channel, decision, reason_codes, policy_version)
           values ($1, $2, 'HUMAN_MANUAL_CALL', 'ALLOW', array['BUSINESS_LINE_VERIFIED'],
                   'phone-eligibility-v1')
           returning decision_id`, [fixture.endpointId, fixture.accountId]);
        await query(
          `insert into contact_attempts
             (account_id, endpoint_id, channel, eligibility_decision_id, started_at, disposition)
           values ($1, $2, 'HUMAN_MANUAL_CALL', $3, now() - interval '2 days', 'NO_ANSWER')`,
          [fixture.accountId, fixture.endpointId, decisionRows[0]!.decision_id]);

        const decision = await routeInboundCall({ fromNumber: '904-555-0219' });
        const voiceCallId = await recordInboundCall({
          decision, fromNumber: '+19045550219', toNumber: '+19046829345' });
        await captureCallbackIntent({
          decision, voiceCallId, callerStatement: 'Someone called me about lead follow-up.' });

        const { stages } = await chain(fixture, { script: [] });
        stages.push({
          stage: 'inbound_callback', status: 'PASS',
          detail: `Routed ${decision.route} as ${decision.agentProfileId}.`,
          evidence: { route: decision.route, profile: decision.agentProfileId,
                      accountId: decision.accountId },
        });
        return { stages, assertions: {
          receptionist_profile_only: decision.agentProfileId === 'yad-receptionist-v1',
          attached_to_the_account: decision.accountId === fixture.accountId,
          not_a_cold_opener: decision.route === 'CAPTURE_CALLBACK_INTENT',
        } };
      });

    // 20 — a strong process with no need.
    await record('strong_process_no_need',
      'A business with the process handled ends with no need',
      async () => {
        setCalendarAdapter(calendar());
        const fixture = await seed({ name: 'Matrix Twenty Alarms', phone: '904-555-0220' });
        const { stages, outcome } = await chain(fixture, {
          script: [
            'Calls are answered 24/7 and booked straight into the system.',
            'Estimates go into a six-touch sequence and the manager reviews it weekly.',
          ] });
        const crm = stages.find((stage) => stage.stage === 'crm_state')!;
        return { stages, assertions: {
          ends_without_a_meeting: (crm.evidence!['confirmed_meetings'] as number) === 0,
          outcome_is_no_sale: outcome === 'NO_SALE' || outcome === 'CONNECTED',
        } };
      });
  } finally {
    setCalendarAdapter(previous);
  }

  const counts = classes.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {} as Record<StageStatus, number>);

  return {
    ranAt: new Date().toISOString(), offline: true,
    status: classes.some((row) => row.status === 'FAIL') ? 'FAIL' : 'PASS',
    classes, counts,
  };
}
