import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { config } from '../config.js';

/**
 * Loads the Sales AI knowledge assets from the repository.
 * Authority: CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md.
 *
 * These are a gold behavioral library, not a script to concatenate into a prompt.
 * The agent composes a turn from Call Pack + opener + question family + working
 * memory + the one relevant card; it does not recite a transcript.
 */

const docsRoot = resolve(config.packageRoot, '..', '..', 'docs', '09-software');

function loadYaml<T>(fileName: string, fallback: T): T {
  const path = resolve(docsRoot, fileName);
  if (!existsSync(path)) return fallback;
  try {
    return (parseYaml(readFileSync(path, 'utf8')) as T) ?? fallback;
  } catch (error) {
    // A malformed asset must not take the agent down; it degrades to defaults.
    console.error(`[callbrain] could not parse ${fileName}`, error);
    return fallback;
  }
}

// -------------------------------------------------------------- question bank

export interface QuestionFamily {
  use_when?: string[];
  likely_roles?: string[];
  first_questions?: string[];
  probes?: Record<string, string>;
  strong_gap_signals?: string[];
  handled_signals?: string[];
  meeting_frame?: string;
}

export interface QuestionBank {
  rules?: string[];
  families: Record<string, QuestionFamily>;
}

let questionBankCache: QuestionBank | null = null;

export function questionBank(): QuestionBank {
  questionBankCache ??= loadYaml<QuestionBank>(
    'outbound-sales-brain-sales-ai-hypothesis-question-bank.v1.yaml',
    { families: {} },
  );
  return questionBankCache;
}

/** Maps an opportunity-hypothesis category onto a question family. */
const CATEGORY_TO_FAMILY: Record<string, string> = {
  // Every hypothesis category the repository actually uses maps to a real question
  // family. An unmapped category leaves the agent with no question to ask.
  inbound_lead_handling: 'speed_to_lead',
  paid_lead_handling: 'speed_to_lead',
  lead_response: 'speed_to_lead',
  lead_routing: 'speed_to_lead',
  urgent_lead_handling: 'speed_to_lead',
  new_patient_response: 'speed_to_lead',
  intake_response: 'speed_to_lead',
  intake_followup: 'intake_qualification',
  front_office_capacity: 'admin_employee_capacity',
  estimate_followup: 'unsold_estimate_proposal_followup',
  treatment_followup: 'unsold_estimate_proposal_followup',
  lead_followup: 'crm_workflow',
  lead_nurture: 'reactivation_nurture',
  missed_call: 'missed_calls_overflow',
  missed_call_recovery: 'missed_calls_overflow',
  call_overflow: 'missed_calls_overflow',
  simultaneous_call_overflow: 'missed_calls_overflow',
  after_hours: 'after_hours_response',
  after_hours_paid_lead_handling: 'after_hours_response',
  speed_to_lead: 'speed_to_lead',
  urgent_lead_response: 'speed_to_lead',
  unsold_estimate: 'unsold_estimate_proposal_followup',
  unsold_proposal_followup: 'unsold_estimate_proposal_followup',
  proposal_followup: 'unsold_estimate_proposal_followup',
  sales_followup: 'unsold_estimate_proposal_followup',
  follow_up: 'crm_workflow',
  crm_followup: 'crm_workflow',
  attribution: 'marketing_attribution',
  paid_acquisition: 'marketing_attribution',
  employee_capacity: 'admin_employee_capacity',
  admin_capacity: 'admin_employee_capacity',
  reporting: 'admin_employee_capacity',
  reactivation: 'reactivation_nurture',
  long_term_nurture: 'reactivation_nurture',
  appointment_no_show: 'appointment_no_show',
  intake: 'intake_qualification',
  customer_communication: 'missed_calls_overflow',
};

export function familyFor(hypothesisCategory: string | null): {
  key: string | null; family: QuestionFamily | null;
} {
  if (!hypothesisCategory) return { key: null, family: null };
  const bank = questionBank();
  const direct = bank.families[hypothesisCategory];
  if (direct) return { key: hypothesisCategory, family: direct };
  const mapped = CATEGORY_TO_FAMILY[hypothesisCategory];
  if (mapped && bank.families[mapped]) return { key: mapped, family: bank.families[mapped]! };
  return { key: null, family: null };
}

/**
 * Picks the next probe.
 * Probes are used one at a time and never exhaustively — "do_not_use_all_probes"
 * is a rule in the bank itself.
 */
export function nextProbe(
  family: QuestionFamily | null, alreadyAsked: string[],
): { key: string; question: string } | null {
  if (!family?.probes) return null;
  for (const [key, question] of Object.entries(family.probes)) {
    if (!alreadyAsked.includes(key)) return { key, question };
  }
  return null;
}

/**
 * Does the prospect's answer indicate a real gap, or a handled process?
 * Matched against the family's own signal vocabulary rather than generic sentiment.
 */
export type SignalRead = 'gap' | 'handled' | 'unclear';

const GAP_PHRASES: Record<string, RegExp> = {
  voicemail_only: /voicemail|voice mail|answering machine/i,
  message_taken_manual_callback: /take[s]? (?:a )?message|leaves? a message|call (?:them )?back/i,
  callback_depends_on_memory: /whoever|depends on|if (?:someone|somebody) remembers|try to remember/i,
  no_visibility: /(?:don'?t|do not|can'?t|cannot)\s+(?:really\s+)?(?:know|track|see|tell)/i,
  next_day_response: /next (?:morning|day|business day)|in the morning/i,
  frequent_overflow: /a lot|often|all the time|constantly|pretty (?:often|regularly)/i,
  inconsistent: /sometimes|hit or miss|varies|inconsisten|supposed to/i,
};

const HANDLED_PHRASES: Record<string, RegExp> = {
  defined_followup_cadence: /\b(?:\d+|two|three|four|five|six|seven)[- ]touch\b|\bdrip (?:sequence|campaign)\b|\bfollow.?up (?:sequence|cadence)\b|\bautomated (?:sequence|follow.?ups?)\b/i,
  someone_reviews_it:
    /\b(?:manager|owner|supervisor)s?\s+review|\breview(?:s|ed)?\s+(?:it|them|anything|everything)\b/i,
  books_or_dispatches_directly: /\bbooks?\b[^.]{0,30}\b(?:directly|straight|into (?:our|the))\b|\bbooked automatically\b|\bbooks? (?:the )?(?:jobs?|appointments?|calls?)\b|\btexts? (?:our|the) on.?call\b|\bdispatch(?:es|ed)? (?:it|them|the tech)\b/i,
  reliable_live_answering: /24[\/ ]?7|always (?:answer|someone|somebody)|never miss|live (?:answer|person)/i,
  automated_task_and_followup: /automatic|automated|the system (?:creates|books|sends)|books? (?:directly )?into/i,
  measured_service_level: /we (?:track|measure|report)|dashboard|service level|every lead is tracked/i,
  clear_owner_and_visibility: /(?:sales )?manager reviews|owner (?:is|assigned)|someone owns/i,
  explicitly_fine: /we'?re (?:good|fine|all set)\b|\b(?:that'?s|we|it)\b[^.]{0,24}\b(?:handled|covered|sorted|taken care of)\b/i,
};

export function readSignal(answer: string, family: QuestionFamily | null): {
  read: SignalRead; matched: string[];
} {
  const matchedGap: string[] = [];
  const matchedHandled: string[] = [];

  for (const [key, pattern] of Object.entries(GAP_PHRASES)) {
    if (pattern.test(answer)) matchedGap.push(key);
  }
  for (const [key, pattern] of Object.entries(HANDLED_PHRASES)) {
    if (pattern.test(answer)) matchedHandled.push(key);
  }

  // The family's own vocabulary refines the read where it says something specific.
  const familyGap = (family?.strong_gap_signals ?? []).filter((signal) => matchedGap.includes(signal));
  const familyHandled = (family?.handled_signals ?? []).filter((signal) => matchedHandled.includes(signal));

  if (familyHandled.length > 0 || matchedHandled.length > matchedGap.length) {
    return { read: 'handled', matched: familyHandled.length ? familyHandled : matchedHandled };
  }
  if (familyGap.length > 0 || matchedGap.length > 0) {
    return { read: 'gap', matched: familyGap.length ? familyGap : matchedGap };
  }
  return { read: 'unclear', matched: [] };
}

// ------------------------------------------------------------- response cards

export interface ResponseCard {
  objective?: string;
  preferred_variant?: number;
  variants?: string[];
  behavior?: string[];
  examples?: Record<string, string> | string[];
  variants_by_source?: Record<string, string>;
  follow_up_options?: string[];
  next?: string[];
  prohibited?: string[];
  max_cycles?: number;
  clear_exit_override?: boolean;
}

let cardsCache: Record<string, ResponseCard> | null = null;

export function responseCards(): Record<string, ResponseCard> {
  cardsCache ??= loadYaml<{ cards: Record<string, ResponseCard> }>(
    'outbound-sales-brain-sales-ai-response-cards.v1.yaml', { cards: {} },
  ).cards ?? {};
  return cardsCache;
}

let ownerCardsCache: Record<string, ResponseCard> | null = null;

export function ownerQuestionCards(): Record<string, ResponseCard> {
  ownerCardsCache ??= loadYaml<{ cards: Record<string, ResponseCard> }>(
    'outbound-sales-brain-sales-ai-owner-question-cards.v1.yaml', { cards: {} },
  ).cards ?? {};
  return ownerCardsCache;
}

/** Which card an utterance calls for. Order matters: the most specific wins. */
const CARD_TRIGGERS: [string, RegExp][] = [
  ['discriminatory_routing', /\b(?:route|routing|filter|screen|sort|target)\b.{0,60}\b(?:ethnicit|race|racial|religion|national origin|colou?r of|nationality|immigrant|disabilit|family status|children)\b/i],
  ['how_did_you_get_my_number', /how (?:did|do) you get (?:my|this) number|where did you get (?:my|this)/i],
  ['where_did_you_see_our_ad', /where did you see (?:our|the) ad|what ad|which ad/i],
  ['are_you_recording', /(?:are you|is this) record(?:ing|ed)/i],
  ['asks_if_ai', /\b(?:are you|is this)\b.{0,20}\b(?:a )?(?:robot|bot|ai|a\.?i\.?|recording|automated|machine|real person|human)\b/i],
  ['is_this_a_sales_call', /is this a sales call|are you selling|what are you selling/i],
  ['why_are_you_calling_me', /why (?:are you|did you) call(?:ing)? me|why me\b/i],
  ['who_are_you_again', /who (?:are you|is this) again|say that again|who'?s this/i],
  ['what_do_you_do', /what (?:exactly )?do you (?:guys )?do|what is (?:this|your company)/i],
  ['who_have_you_worked_with', /who (?:have|do) you work(?:ed)? with|any (?:clients|customers|references)/i],
  ['can_you_guarantee_results', /guarantee|what (?:kind of )?results|roi\b/i],
  ['uses_chatgpt', /chat ?gpt|we (?:already )?(?:use|have|got) (?:ai|a\.?i\.?)\b|copilot|gemini|claude\b/i],
  ['has_receptionist', /(?:we have|got) (?:a )?receptionist|front desk (?:person|girl|guy)/i],
  ['has_answering_service', /answering service/i],
  ['has_crm', /\bcrm\b|servicetitan|housecall|jobber|salesforce|hubspot/i],
  ['has_it_company', /\bit (?:company|guy|team|provider)\b|managed service/i],
  ['has_marketing_agency', /marketing (?:agency|company|firm)|we have (?:an )?agency/i],
  ['customers_want_humans', /(?:customers|clients|people) want (?:to talk to )?(?:a )?human|prefer (?:a )?person/i],
  ['ai_not_ready', /not ready for ai|don'?t trust ai|ai (?:is )?(?:risky|scary|too much)|(?:tried|had) (?:automation|ai|a bot|chatbots?)[^.]{0,40}\b(?:hated|didn'?t work|was a disaster|waste|nightmare|useless)\b|\bburn(?:ed|t) (?:us|me) (?:before|last time)\b/i],
  ['send_email', /send (?:me )?(?:an? )?(?:email|info|information|something)/i],
  ['call_me_back', /call me back|call me (?:later|tomorrow|next week)|try me (?:again|later)/i],
  // Cards that hold approved copy but had no way to fire. A card the prospect can
  // trigger in ordinary language and never does is the same as not having it.
  ['price_early', /how much (?:is|does|would) (?:it|this|that)|what (?:does|would) (?:it|this) cost|what'?s the (?:price|cost)|ballpark|price range|pricing/i],
  ['too_expensive_later', /(?:too|bit) (?:expensive|pricey|steep|much money)|can'?t afford|out of (?:our|my) budget/i],
  ['think_about_it', /(?:let me|i'?ll|we'?ll|need to) think (?:about|it)|think it over|get back to you/i],
  ['what_happens_on_strategy_call', /what (?:happens|would happen|goes on) (?:on|in|during) (?:the|that|a) (?:call|meeting)|what (?:is|would) (?:the|that) call (?:about|like)/i],
  ['already_handled_well', /(?:that'?s|it'?s) (?:already )?(?:handled|covered|sorted|taken care of)|we have that (?:handled|covered)/i],
  ['wrong_person', /(?:that'?s|that is) not (?:me|my|mine)|i don'?t (?:handle|deal with|do) that|not my (?:area|department|job)|corporate (?:handles|does|deals with)|head office (?:handles|does)/i],
  ['not_interested', /not interested|no thanks|we'?re (?:all )?(?:good|set|fine)/i],
  ['busy', /(?:i'?m|i am|we'?re|we are) (?:really |pretty |very )?busy|bad time|\b(?:in|into|heading into|walking into)\s+a\s+meeting\b|with a (?:customer|patient|client)|driving|slammed|swamped|on my way/i],
];

export function cardFor(utterance: string): { id: string; card: ResponseCard } | null {
  const cards = responseCards();
  for (const [id, pattern] of CARD_TRIGGERS) {
    if (pattern.test(utterance) && cards[id]) return { id, card: cards[id]! };
  }
  return null;
}

/**
 * The line to use from a card.
 * `preferred_variant` is honoured: variant policy in the asset marks some variants
 * production-default and others optional, so a variant is never picked at random.
 */
export function cardLine(
  card: ResponseCard, context: Record<string, string> = {}, exampleKey?: string,
): string | null {
  // Some cards carry approved copy under `examples` rather than `variants`; both are
  // approved wording, and ignoring one silently drops the answer entirely.
  const variants = card.variants && card.variants.length > 0
    ? card.variants
    : approvedExamples(card, exampleKey);
  if (!variants || variants.length === 0) return null;
  const index = Math.min(card.preferred_variant ?? 0, variants.length - 1);
  let line = variants[index]!;
  for (const [key, value] of Object.entries(context)) {
    line = line.replace(new RegExp(`\\[${key}\\]`, 'g'), value);
  }
  // An unresolved placeholder would be spoken aloud, so the line is rejected instead.
  return /\[[a-z_]+\]/i.test(line) ? null : line;
}

/** Approved copy held under `examples`, keyed where the card is keyed. */
function approvedExamples(card: ResponseCard, exampleKey?: string): string[] | null {
  const examples = (card as { examples?: unknown }).examples;
  if (Array.isArray(examples)) return examples.filter((line): line is string => typeof line === 'string');
  if (examples && typeof examples === 'object') {
    const byKey = examples as Record<string, string>;
    if (exampleKey && typeof byKey[exampleKey] === 'string') return [byKey[exampleKey]!];
    const first = Object.values(byKey).find((line) => typeof line === 'string');
    return first ? [first] : null;
  }
  const template = (card as { template?: unknown }).template;
  return typeof template === 'string' ? [template] : null;
}

/**
 * Provenance-aware answer to "how did you get my number".
 * The card forbids claiming a public source when a provider supplied it (§prohibited),
 * so the answer is selected from the endpoint's stored source class.
 */
export function numberProvenanceAnswer(endpointSource: string | null): string {
  const card = responseCards()['how_did_you_get_my_number'];
  const bySource = card?.variants_by_source ?? {};
  const key = (() => {
    switch (endpointSource) {
      case 'COMPANY_WEBSITE': case 'COMPANY_SCHEMA': case 'PUBLIC_DIRECTORY':
      case 'PUBLIC_REGISTRY': case 'PUBLIC_LICENSE': case 'SEARCH_INDEXED':
        return 'official_public_business';
      case 'PROSPECT_SUPPLIED': case 'GATEKEEPER_SUPPLIED': return 'business_supplied';
      case 'PAID_PROVIDER': return 'licensed_business_provider';
      case 'IMPORT': return 'imported_internal_source';
      default: return 'unknown';
    }
  })();
  return bySource[key]
    ?? "I don't want to guess about the source. I can have the team review it, and if you don't "
     + "want us contacting this number I'll mark that now.";
}

// ------------------------------------------------------------ roleplay fixtures

export interface RoleplayCase {
  id: string;
  context: {
    vertical?: string; target_role?: string; confirmed_public?: string[];
    hypothesis?: string; [key: string]: unknown;
  };
  prospect_turns: string[];
  expect: string[];
}

export function roleplayFixtures(): RoleplayCase[] {
  const loaded = loadYaml<{ cases: RoleplayCase[] }>(
    'outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml', { cases: [] },
  );
  return loaded.cases ?? [];
}

/** Clears the caches. Tests use this after editing an asset. */
export function resetKnowledgeCaches(): void {
  questionBankCache = null;
  cardsCache = null;
  ownerCardsCache = null;
}
