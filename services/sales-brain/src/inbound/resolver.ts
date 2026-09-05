import { pool, query } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';
import { resolveAccountId } from '../domain/merge.js';
import {
  canEstablishCallback, evidenceRank, evidenceRule, isFresh, type EvidenceKind,
} from './evidence.js';

/**
 * Deterministic inbound mode resolution.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md §1, §4, §5, §6.
 *
 * This runs before any prompt is built, and the model never sees the question it
 * answers. Given a Twilio From number and the CRM, it decides one thing: is this
 * person returning our call, or is this an ordinary inbound caller?
 *
 * Every rule here is written to fail towards INBOUND_GENERAL. Greeting a stranger as
 * a prospect we know is worse than treating a known prospect as a stranger: the
 * first is a lie about a person, the second is a wasted sentence.
 *
 * Three things it will not do:
 *
 *   - guess. An endpoint that reaches two Accounts is ambiguous, and ambiguous is
 *     general handling with the reason recorded, not a coin toss on `created_at`;
 *   - remember what it cannot see. Facts are OBSERVED, INFERRED or UNKNOWN, and
 *     UNKNOWN is preferred to INFERRED wherever the two compete;
 *   - let suppression decide whether to answer. DNC governs future outbound
 *     initiation; somebody who rings us voluntarily is answered.
 */

export type InboundMode = 'INBOUND_CALLBACK' | 'INBOUND_GENERAL';

/** What the agent may act on, and how sure we are of it. */
export type FactConfidence = 'OBSERVED' | 'INFERRED' | 'UNKNOWN';

export interface RelationshipFact {
  key: string;
  /** Rendered for a person. Never a template the model fills in. */
  statement: string;
  confidence: FactConfidence;
  /** When the thing happened, where that is meaningful. */
  at?: string;
}

export interface WithheldFact {
  key: string;
  reason: string;
}

export type SuppressionStatus =
  | 'NONE'
  | 'ACCOUNT_DNC'
  | 'ACCOUNT_OTHER_SUPPRESSION'
  | 'ENDPOINT_SUPPRESSED';

export type NextAction =
  | 'ORDINARY_INTAKE'
  | 'ACKNOWLEDGE_RETURNED_CALL'
  | 'ACKNOWLEDGE_REQUESTED_CALLBACK'
  | 'CONFIRM_EXISTING_MEETING'
  | 'ROUTE_TO_OWNER'
  | 'ANSWER_WITHOUT_SALES_CONTEXT'
  | 'CONFIRM_WRONG_NUMBER';

export interface InboundResolution {
  mode: InboundMode;
  /** Null unless the match is unambiguous and fresh enough to name. */
  accountId: string | null;
  contactId: string | null;
  companyName: string | null;
  contactName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  /** The evidence that decided the mode, or null when nothing did. */
  decidingEvidence: EvidenceKind | null;
  confidence: 'HIGH' | 'MEDIUM' | 'NONE';
  reasonCodes: string[];
  /** Facts the prompt may use. Empty for general handling. */
  facts: RelationshipFact[];
  /** Facts deliberately kept out of the prompt, and why. */
  withheld: WithheldFact[];
  /** Set when a match existed but was not safe to use. */
  ambiguityReason: string | null;
  suppression: SuppressionStatus;
  nextAction: NextAction;
  /** The endpoint the caller rang from, when we hold it. */
  endpointId: string | null;
  endpointState: 'ACTIVE' | 'WRONG_NUMBER' | 'SUPPRESSED' | 'INACTIVE' | 'UNKNOWN';
  /** How many distinct Accounts this number reaches. Two is ambiguous. */
  matchedAccountCount: number;
  resolvedAt: string;
}

interface EndpointMatch {
  endpoint_id: string;
  account_id: string;
  contact_id: string | null;
  quality_state: string;
  is_active: boolean;
  is_suppressed: boolean;
  endpoint_role: string;
  contact_name: string | null;
}

interface AccountRow {
  account_id: string;
  canonical_name: string;
  is_suppressed: boolean;
  suppression_summary: string | null;
  relationship_state: string;
  owner_user_id: string | null;
  owner_name: string | null;
  merged_into_account_id: string | null;
}

interface SignalRow {
  requested_callback_at: Date | null;
  requested_callback_context: string | null;
  open_opportunity_at: Date | null;
  confirmed_meeting_at: Date | null;
  positive_reply_at: Date | null;
  two_way_at: Date | null;
  connected_outbound_at: Date | null;
  outbound_attempt_at: Date | null;
  last_outbound_disposition: string | null;
  dnc_suppression: boolean;
  other_suppression: boolean;
}

/**
 * How many digits of a number must agree before it is the same number.
 *
 * Ten, and the comparison is on the exact stored value rather than a suffix match.
 * A `like '%' || digits` comparison matches any longer number ending in those digits
 * -- which is every international format of the same line, and also unrelated
 * numbers -- and cannot use an index.
 */
const NANP_DIGITS = 10;

function last10(value: string): string | null {
  const digits = value.replace(/\D+/g, '');
  return digits.length >= NANP_DIGITS ? digits.slice(-NANP_DIGITS) : null;
}

/**
 * Every endpoint that is this number, on any Account.
 *
 * Both the E.164 form and the last ten digits are compared, because a list import
 * and a Twilio webhook do not always agree on the country code, and a number stored
 * without one is still the same phone.
 */
async function matchEndpoints(fromNumber: string): Promise<EndpointMatch[]> {
  const normalized = normalizePhone(fromNumber);
  const digits = last10(normalized ?? fromNumber);
  if (!digits) return [];

  const { rows } = await query<EndpointMatch>(
    `select e.endpoint_id, e.account_id, e.contact_id, e.quality_state, e.is_active,
            e.is_suppressed, e.endpoint_role, c.full_name as contact_name
       from contact_endpoints e
       left join contacts c on c.contact_id = e.contact_id
      where e.endpoint_type = 'PHONE'
        and right(regexp_replace(e.normalized_value, '\\D', '', 'g'), $1) = $2
      order by e.created_at, e.endpoint_id`,
    [NANP_DIGITS, digits],
  );
  return rows;
}

async function loadAccount(accountId: string): Promise<AccountRow | null> {
  const { rows } = await query<AccountRow>(
    `select a.account_id, a.canonical_name, a.is_suppressed, a.suppression_summary,
            a.relationship_state, a.current_owner_user_id as owner_user_id,
            u.display_name as owner_name, a.merged_into_account_id
       from accounts a left join users u on u.user_id = a.current_owner_user_id
      where a.account_id = $1`, [accountId]);
  return rows[0] ?? null;
}

/**
 * One query for every relationship signal on one Account.
 *
 * Bounded on purpose: each subquery takes the single most recent row of its kind
 * rather than a list. An inbound call is a realtime path and an unbounded search over
 * a busy Account's history is a latency trap.
 */
async function loadSignals(accountId: string, now: Date): Promise<SignalRow> {
  const { rows } = await query<SignalRow>(
    `select
       (select max(f.due_at) from follow_ups f
         where f.account_id = $1 and f.status = 'OPEN'
           and f.followup_type = 'CALLBACK' and f.prospect_requested) as requested_callback_at,
       (select f.context from follow_ups f
         where f.account_id = $1 and f.status = 'OPEN'
           and f.followup_type = 'CALLBACK' and f.prospect_requested
         order by f.due_at desc limit 1) as requested_callback_context,
       (select max(o.created_at) from opportunities o
         where o.account_id = $1
           and o.stage not in ('CLOSED_WON','CLOSED_LOST')) as open_opportunity_at,
       (select min(b.requested_start) from meeting_bookings b
         where b.account_id = $1 and b.status = 'CONFIRMED'
           and b.requested_start > $2::timestamptz) as confirmed_meeting_at,
       (select max(ev.occurred_at) from email_events ev
         where ev.account_id = $1 and ev.event_type = 'REPLIED'
           and ev.reply_class in ('POSITIVE_INTEREST','QUESTION','SEND_INFO')) as positive_reply_at,
       (select max(act.occurred_at) from activities act
         where act.account_id = $1
           and act.disposition in ('DECISION_MAKER_REACHED','POSSIBLE_OPPORTUNITY',
                                   'SEND_INFORMATION','MEETING_SCHEDULED')) as two_way_at,
       (select max(at.started_at) from contact_attempts at
         where at.account_id = $1
           and at.channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')
           and at.disposition is not null
           and at.disposition not in ('NO_ANSWER','WRONG_NUMBER')) as connected_outbound_at,
       (select max(at.started_at) from contact_attempts at
         where at.account_id = $1
           and at.channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')) as outbound_attempt_at,
       (select at.disposition from contact_attempts at
         where at.account_id = $1
           and at.channel in ('HUMAN_MANUAL_CALL','AUTONOMOUS_AI_VOICE')
         order by at.started_at desc limit 1) as last_outbound_disposition,
       exists (select 1 from suppressions s
                where s.account_id = $1 and s.is_active and s.scope in ('ACCOUNT','CONTACT')
                  and s.suppression_type = 'DNC'
                  and (s.expires_at is null or s.expires_at > $2::timestamptz)) as dnc_suppression,
       exists (select 1 from suppressions s
                where s.account_id = $1 and s.is_active and s.scope in ('ACCOUNT','CONTACT')
                  and s.suppression_type <> 'DNC'
                  and (s.expires_at is null or s.expires_at > $2::timestamptz)) as other_suppression`,
    [accountId, now]);
  return rows[0]!;
}

/** A time a person would say out loud, not a timestamp. */
export function spokenAge(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 2) return 'a moment ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'about an hour ago' : `about ${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return weeks < 9 ? `${weeks} weeks ago` : 'a while ago';
}

interface Candidate {
  kind: EvidenceKind;
  at: Date;
  fresh: boolean;
}

function collectCandidates(signals: SignalRow, now: Date): Candidate[] {
  const candidates: Candidate[] = [];
  const add = (kind: EvidenceKind, at: Date | null): void => {
    if (!at) return;
    candidates.push({ kind, at, fresh: isFresh(kind, at, now) });
  };

  // A requested callback is dated by when it is due, and a caller who rings early is
  // still returning the call they asked for -- so the window is measured from the
  // due time in either direction.
  if (signals.requested_callback_at) {
    const due = signals.requested_callback_at;
    const rule = evidenceRule('REQUESTED_CALLBACK');
    const withinWindow = rule.freshnessHours === null
      || Math.abs(now.getTime() - due.getTime()) <= rule.freshnessHours * 3_600_000;
    candidates.push({ kind: 'REQUESTED_CALLBACK', at: due, fresh: withinWindow });
  }
  add('ACTIVE_OPPORTUNITY', signals.open_opportunity_at);
  add('CONFIRMED_UPCOMING_MEETING', signals.confirmed_meeting_at);
  add('POSITIVE_REPLY', signals.positive_reply_at);
  add('RECENT_TWO_WAY_CONVERSATION', signals.two_way_at);
  add('RECENT_CONNECTED_OUTBOUND', signals.connected_outbound_at);
  add('RECENT_OUTBOUND_ATTEMPT', signals.outbound_attempt_at);

  // Anything that fell outside its own window is still worth naming, so the resolver
  // can say why it chose general handling rather than shrugging.
  if (signals.outbound_attempt_at
      && !candidates.some((candidate) => candidate.fresh)) {
    candidates.push({ kind: 'STALE_OUTBOUND_ATTEMPT', at: signals.outbound_attempt_at, fresh: true });
  }
  return candidates.sort((a, b) => evidenceRank(a.kind) - evidenceRank(b.kind));
}

function generalResult(input: {
  reasonCodes: string[]; ambiguityReason?: string | null;
  suppression?: SuppressionStatus; withheld?: WithheldFact[];
  nextAction?: NextAction; endpointId?: string | null;
  endpointState?: InboundResolution['endpointState'];
  matchedAccountCount?: number; now: Date;
}): InboundResolution {
  return {
    mode: 'INBOUND_GENERAL',
    accountId: null, contactId: null, companyName: null, contactName: null,
    ownerUserId: null, ownerName: null,
    decidingEvidence: null, confidence: 'NONE',
    reasonCodes: input.reasonCodes,
    facts: [], withheld: input.withheld ?? [],
    ambiguityReason: input.ambiguityReason ?? null,
    suppression: input.suppression ?? 'NONE',
    nextAction: input.nextAction ?? 'ORDINARY_INTAKE',
    endpointId: input.endpointId ?? null,
    endpointState: input.endpointState ?? 'UNKNOWN',
    matchedAccountCount: input.matchedAccountCount ?? 0,
    resolvedAt: input.now.toISOString(),
  };
}

export interface ResolveInput {
  fromNumber: string;
  toNumber?: string;
  callSid?: string | null;
  now?: Date;
}

export async function resolveInboundMode(input: ResolveInput): Promise<InboundResolution> {
  const now = input.now ?? new Date();
  const matches = await matchEndpoints(input.fromNumber);

  if (matches.length === 0) {
    return generalResult({
      reasonCodes: ['caller_number_not_held'], now,
      ambiguityReason: null,
    });
  }

  // Merged Accounts follow their survivor before anything is counted, so a number
  // attached to a tombstone and to the record it was merged into is one Account, not
  // an ambiguity we invented ourselves.
  const resolvedByEndpoint = new Map<string, string>();
  for (const match of matches) {
    const survivor = await resolveAccountId(pool, match.account_id);
    if (survivor) resolvedByEndpoint.set(match.endpoint_id, survivor);
  }
  const distinctAccounts = [...new Set(resolvedByEndpoint.values())];

  if (distinctAccounts.length === 0) {
    return generalResult({
      reasonCodes: ['matched_endpoint_has_no_live_account'], now,
      matchedAccountCount: 0,
    });
  }

  if (distinctAccounts.length > 1) {
    // A shared reception desk, an answering service, a strip mall. Naming one of
    // them would be a coin toss with a company's name on it.
    return generalResult({
      reasonCodes: ['ambiguous_endpoint', 'multiple_accounts_share_this_number'],
      ambiguityReason: `This number reaches ${distinctAccounts.length} different `
        + 'Accounts, so the caller cannot be identified from it.',
      withheld: [{
        key: 'account_identity',
        reason: 'more than one company holds this number',
      }],
      matchedAccountCount: distinctAccounts.length,
      endpointState: 'UNKNOWN', now,
    });
  }

  const accountId = distinctAccounts[0]!;
  const account = await loadAccount(accountId);
  if (!account) {
    return generalResult({
      reasonCodes: ['account_row_missing'], matchedAccountCount: 1, now,
    });
  }

  // The endpoint on the surviving Account, preferring one that is usable.
  const endpointsForAccount = matches.filter(
    (match) => resolvedByEndpoint.get(match.endpoint_id) === accountId);
  const endpoint = endpointsForAccount.find(
    (match) => match.is_active && !match.is_suppressed
      && match.quality_state !== 'WRONG_NUMBER') ?? endpointsForAccount[0]!;

  const endpointState: InboundResolution['endpointState'] =
    endpoint.quality_state === 'WRONG_NUMBER' ? 'WRONG_NUMBER'
    : endpoint.is_suppressed || endpoint.quality_state === 'SUPPRESSED' ? 'SUPPRESSED'
    : !endpoint.is_active ? 'INACTIVE' : 'ACTIVE';

  // A number already recorded as wrong reaches somebody who is not this company.
  // There is no relationship to resume with whoever is holding the handset, and
  // saying the company's name to them would be both wrong and a disclosure.
  if (endpointState === 'WRONG_NUMBER') {
    return generalResult({
      reasonCodes: ['endpoint_recorded_wrong_number'],
      ambiguityReason: 'This number is recorded as reaching someone other than the '
        + 'company it was listed for.',
      withheld: [
        { key: 'account_identity', reason: 'the number is a recorded wrong number' },
        { key: 'outbound_history', reason: 'the person holding this number is not the prospect' },
      ],
      nextAction: 'CONFIRM_WRONG_NUMBER',
      endpointId: endpoint.endpoint_id, endpointState, matchedAccountCount: 1, now,
    });
  }

  const signals = await loadSignals(accountId, now);
  const suppression: SuppressionStatus = signals.dnc_suppression ? 'ACCOUNT_DNC'
    : signals.other_suppression ? 'ACCOUNT_OTHER_SUPPRESSION'
    : endpointState === 'SUPPRESSED' ? 'ENDPOINT_SUPPRESSED' : 'NONE';

  // A suppressed company is answered like anybody else, and hears nothing about our
  // outreach. Suppression governs what we may start, not whether we pick up.
  if (suppression === 'ACCOUNT_DNC' || suppression === 'ACCOUNT_OTHER_SUPPRESSION') {
    return generalResult({
      reasonCodes: ['account_suppressed', 'answered_without_sales_context'],
      ambiguityReason: null,
      withheld: [
        { key: 'outbound_history', reason: 'the Account is suppressed; our outreach is not mentioned' },
        { key: 'sales_context', reason: 'no pitch and no sales next step on a suppressed Account' },
      ],
      suppression, nextAction: 'ANSWER_WITHOUT_SALES_CONTEXT',
      endpointId: endpoint.endpoint_id, endpointState, matchedAccountCount: 1, now,
    });
  }

  const candidates = collectCandidates(signals, now);
  const deciding = candidates.find(
    (candidate) => candidate.fresh && canEstablishCallback(candidate.kind));

  if (!deciding) {
    const stale = candidates[0];
    return generalResult({
      reasonCodes: stale
        ? ['known_account_no_fresh_relationship', `stale_${stale.kind.toLowerCase()}`]
        : ['known_account_no_relationship_signal'],
      ambiguityReason: stale
        ? `The only contact with this Account was ${spokenAge(stale.at, now)}, which is `
          + 'outside the window that would make this a callback.'
        : null,
      withheld: [{
        key: 'outbound_history',
        reason: 'nothing recent enough to treat this as a returned call',
      }],
      suppression, nextAction: 'ORDINARY_INTAKE',
      endpointId: endpoint.endpoint_id, endpointState, matchedAccountCount: 1, now,
    });
  }

  // --- a callback ------------------------------------------------------------
  const facts: RelationshipFact[] = [];
  const withheld: WithheldFact[] = [];

  facts.push({
    key: 'company_identity',
    statement: `The number belongs to ${account.canonical_name}.`,
    confidence: 'OBSERVED',
  });

  // A contact is named only when the endpoint itself is theirs. A company main line
  // tells us the company and nothing about who picked up the phone.
  if (endpoint.contact_id && endpoint.contact_name) {
    facts.push({
      key: 'contact_identity',
      statement: `This number is recorded as ${endpoint.contact_name}'s.`,
      confidence: 'OBSERVED',
    });
  } else {
    withheld.push({
      key: 'contact_identity',
      reason: endpoint.endpoint_role === 'MAIN_BUSINESS_LINE'
        ? 'this is the company main line, so who is calling is unknown'
        : 'the number is not attached to a named person',
    });
  }

  const describe: Record<EvidenceKind, (at: Date) => RelationshipFact> = {
    REQUESTED_CALLBACK: (at) => ({
      key: 'requested_callback',
      statement: `They asked us to call them back${
        at > now ? ` at ${at.toISOString()}` : ''}, and that callback is still open.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    ACTIVE_OPPORTUNITY: () => ({
      key: 'active_opportunity',
      statement: 'There is an open opportunity with this company.',
      confidence: 'OBSERVED',
    }),
    CONFIRMED_UPCOMING_MEETING: (at) => ({
      key: 'confirmed_meeting',
      statement: 'There is a confirmed strategy call in the diary.',
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    POSITIVE_REPLY: (at) => ({
      key: 'positive_reply',
      statement: `They replied to our email ${spokenAge(at, now)}.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    RECENT_TWO_WAY_CONVERSATION: (at) => ({
      key: 'prior_conversation',
      statement: `We spoke with somebody at this company ${spokenAge(at, now)}.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    RECENT_CONNECTED_OUTBOUND: (at) => ({
      key: 'connected_call',
      statement: `We called ${spokenAge(at, now)} and the call connected.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    RECENT_OUTBOUND_ATTEMPT: (at) => ({
      key: 'missed_call',
      statement: `We called ${spokenAge(at, now)} and did not reach anybody.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    STALE_OUTBOUND_ATTEMPT: (at) => ({
      key: 'old_attempt',
      statement: `The last time we called was ${spokenAge(at, now)}.`,
      confidence: 'OBSERVED', at: at.toISOString(),
    }),
    FUZZY_COMPANY_ASSOCIATION: () => ({
      key: 'association', statement: '', confidence: 'UNKNOWN',
    }),
  };

  for (const candidate of candidates) {
    if (!candidate.fresh) continue;
    if (!canEstablishCallback(candidate.kind)) continue;
    const fact = describe[candidate.kind](candidate.at);
    if (fact.statement) facts.push(fact);
  }

  // What was said on that call is not knowable from an attempt record. Saying we
  // discussed something when all we have is a disposition is the exact fabrication
  // the authority forbids.
  const spoke = candidates.some(
    (candidate) => candidate.fresh
      && (candidate.kind === 'RECENT_TWO_WAY_CONVERSATION'
        || candidate.kind === 'RECENT_CONNECTED_OUTBOUND'));
  withheld.push({
    key: 'conversation_content',
    reason: spoke
      ? 'the CRM records that a call connected, not what was said in it'
      : 'nobody answered, so nothing was discussed',
  });
  withheld.push({
    key: 'research_and_hypothesis',
    reason: 'the reason we called is our working theory, not something they told us',
  });

  const nextAction: NextAction =
    deciding.kind === 'CONFIRMED_UPCOMING_MEETING' ? 'CONFIRM_EXISTING_MEETING'
    : deciding.kind === 'ACTIVE_OPPORTUNITY' ? 'ROUTE_TO_OWNER'
    : deciding.kind === 'REQUESTED_CALLBACK' ? 'ACKNOWLEDGE_REQUESTED_CALLBACK'
    : 'ACKNOWLEDGE_RETURNED_CALL';

  return {
    mode: 'INBOUND_CALLBACK',
    accountId, contactId: endpoint.contact_id, companyName: account.canonical_name,
    contactName: endpoint.contact_name,
    ownerUserId: account.owner_user_id, ownerName: account.owner_name,
    decidingEvidence: deciding.kind,
    confidence: evidenceRule(deciding.kind).strength === 'HIGHEST' ? 'HIGH' : 'MEDIUM',
    reasonCodes: ['endpoint_uniquely_matched', `evidence_${deciding.kind.toLowerCase()}`],
    facts, withheld,
    ambiguityReason: null,
    suppression,
    nextAction,
    endpointId: endpoint.endpoint_id, endpointState,
    matchedAccountCount: 1,
    resolvedAt: now.toISOString(),
  };
}
