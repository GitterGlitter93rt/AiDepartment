import type { CallPack } from './callPack.js';

/**
 * Opener selection.
 * Authority: outbound-sales-brain-sales-ai-opener-selector-spec.md.
 *
 * The opener is generated from evidence, not from the vertical name, and it uses the
 * strongest *truthful* reason available. Priority 1 requires fresh, claim-safe
 * advertising evidence; if that is missing or stale the opener degrades to a safer
 * context rather than implying ad activity (§9).
 *
 * Variation is semantic and constrained (§8), never creative rewriting.
 */

export type OpenerPriority =
  | 'PAID_DEMAND'        // 1 — fresh, claim-safe advertising observation
  | 'BUSINESS_SIGNAL'    // 2 — first-party business-model signal
  | 'MARKET_CATEGORY'    // 3 — market plus business category
  | 'ROLE_PROCESS'       // 4 — role-based process question
  | 'PRIOR_RELATIONSHIP'; // 6 — actual prior interaction, never called a cold call

export interface OpenerContext {
  pack: CallPack;
  agentName: string;
  /** Fresh, claim-safe advertising evidence with the service it advertised. */
  freshAdvertising?: { service: string | null; market: string | null } | null;
  /** Observable first-party signal, e.g. "24/7 emergency service". */
  businessSignal?: string | null;
  /** A genuine prior interaction. Turns a cold call into a callback. */
  priorInteraction?: { kind: string; description: string } | null;
  /** Deterministic variation index; the caller supplies it so a call is reproducible. */
  variantIndex?: number;
}

export interface SelectedOpener {
  priority: OpenerPriority;
  text: string;
  /** Why this opener was chosen, for the decision trace. */
  reason: string;
  /** The one question that follows. */
  question: string;
  /** Facts referenced, so a reviewer can check each against evidence. */
  claims: string[];
}

/** Approved cold-call framings (§8). Only these three. */
const COLD_FRAMINGS = [
  "This is a cold call, so I'll be brief.",
  "Quick cold call — I'll keep it short.",
  "I know I'm calling you out of nowhere; quick question.",
];

/** Approved reason-context openings (§8). */
const REASON_CONTEXTS = {
  paid: (service: string, market: string) =>
    `I came across you guys while looking at companies advertising ${service}${market ? ` around ${market}` : ''}`,
  signal: (signal: string) => `I saw you guys handle ${signal}`,
  category: (category: string, market: string) =>
    `I was looking at ${category} companies${market ? ` around ${market}` : ''}`,
};

/**
 * Hypothesis → the one question (§4). These are the universal families; the vertical
 * profile chooses which apply, the agent does not invent new ones.
 */
export const HYPOTHESIS_QUESTIONS: Record<string, string> = {
  after_hours:
    'When somebody reaches out after hours looking for a new service, what happens today?',
  after_hours_lead_handling:
    'When somebody reaches out after hours looking for a new service, what happens today?',
  simultaneous_call_overflow:
    "When a new call comes in while everybody's already tied up, what happens next?",
  missed_call:
    'If a legitimate new-business call reaches voicemail, what actually keeps working it until somebody connects?',
  missed_call_recovery:
    'If a legitimate new-business call reaches voicemail, what actually keeps working it until somebody connects?',
  speed_to_lead:
    'How quickly does a brand-new inquiry normally hear from somebody?',
  unsold_estimate:
    "What normally happens to an estimate or proposal that doesn't close the first time?",
  unsold_estimate_or_proposal:
    "What normally happens to an estimate or proposal that doesn't close the first time?",
  follow_up:
    'Once a lead gets into your system, what actually keeps the follow-up moving?',
  crm_workflow:
    'Once a lead gets into your system, what actually keeps the follow-up moving?',
  crm_followup:
    'Once a lead gets into your system, what actually keeps the follow-up moving?',
  attribution:
    'Can you currently trace a lead from the original source all the way to actual revenue?',
  paid_acquisition:
    'Can you currently trace a lead from the original source all the way to actual revenue?',
  employee_capacity:
    'What repetitive office task eats more employee time than you think it should?',
  admin_capacity:
    'What repetitive office task eats more employee time than you think it should?',
  reactivation:
    'What happens to older leads or customers that go quiet — does anything consistently bring them back into the pipeline?',
  appointment_no_show:
    "When somebody books and doesn't show, what happens after that?",
  long_term_nurture:
    "When somebody isn't ready right now but might be in a few months, what keeps that relationship alive?",
  customer_communication:
    'Through a job, who is fielding the "where are we at" calls from customers?',
};

/** Human-readable category for the market/category opener. */
const CATEGORY_LABEL: Record<string, string> = {
  hvac: 'HVAC', plumbing: 'plumbing', roofing: 'roofing', electrical: 'electrical',
  'collision-repair': 'collision', 'law-firms': 'law', dental: 'dental',
  'med-spas': 'med spa', restoration: 'restoration', 'garage-door': 'garage door',
  'real-estate-brokerages': 'real-estate', 'pdr-hail': 'hail repair',
  'general-contractors-remodeling': 'remodeling',
};

export function questionFor(pack: CallPack): string {
  // The Call Pack's own question wins when research produced one.
  if (pack.firstQuestion) return pack.firstQuestion;
  const category = pack.primaryHypothesisCategory ?? '';
  return HYPOTHESIS_QUESTIONS[category]
    ?? 'When a new enquiry comes in and everybody is already busy, what happens to it?';
}

export function selectOpener(context: OpenerContext): SelectedOpener {
  const { pack, agentName } = context;
  const variant = (context.variantIndex ?? 0) % COLD_FRAMINGS.length;
  const question = questionFor(pack);

  // A name is used only when contact identity is supported (§5).
  const greeting = pack.contactName && !pack.contactIsRoleOnly
    ? `Hey ${pack.contactName.split(' ')[0]}`
    : 'Hi there';
  const identity = `this is ${agentName} with Your AI Department`;

  // §6: a genuine prior interaction is never framed as a cold call.
  if (context.priorInteraction) {
    return {
      priority: 'PRIOR_RELATIONSHIP',
      text: `${greeting}, ${identity}. I'm following up on ${context.priorInteraction.description}. ${question}`,
      reason: `Prior interaction on record (${context.priorInteraction.kind}); framing this as a cold call would be false.`,
      question,
      claims: [context.priorInteraction.description],
    };
  }

  const framing = COLD_FRAMINGS[variant]!;

  // Priority 1 — fresh advertising evidence only.
  if (context.freshAdvertising?.service) {
    const market = context.freshAdvertising.market ?? cityOf(pack.geography);
    return {
      priority: 'PAID_DEMAND',
      text: `${greeting}, ${identity}. ${framing} `
        + `${REASON_CONTEXTS.paid(context.freshAdvertising.service, market)}, and I had one question. ${question}`,
      reason: 'Fresh, claim-safe advertising evidence for a specific service and market.',
      // Deliberately narrow: the service and the market, nothing else. Cramming in
      // more public facts reads as surveillance rather than research (§7).
      claims: [`currently advertising ${context.freshAdvertising.service}`, `market: ${market}`],
      question,
    };
  }

  // Priority 2 — an observable first-party business signal.
  if (context.businessSignal) {
    return {
      priority: 'BUSINESS_SIGNAL',
      text: `${greeting}, ${identity}. ${framing} `
        + `${REASON_CONTEXTS.signal(context.businessSignal)}, and I had one question. ${question}`,
      reason: 'First-party website signal, with no claim about advertising.',
      claims: [context.businessSignal],
      question,
    };
  }

  // Priority 3 — market and category. Implies nothing about ad activity.
  const category = pack.vertical ? (CATEGORY_LABEL[pack.vertical] ?? pack.vertical) : null;
  if (category) {
    const market = cityOf(pack.geography);
    return {
      priority: 'MARKET_CATEGORY',
      text: `${greeting}, ${identity}. ${framing} `
        + `${REASON_CONTEXTS.category(category, market)} and had one question. ${question}`,
      reason: 'No claim-safe advertising evidence, so the opener uses category and market only.',
      claims: [`${category} company in ${market}`],
      question,
    };
  }

  // Priority 4 — role-based process question.
  return {
    priority: 'ROLE_PROCESS',
    text: `${greeting}, ${identity}. ${framing} I had a question about how your team handles this. ${question}`,
    reason: 'Public business context is weak; the opener makes no claim beyond the question.',
    claims: [],
    question,
  };
}

function cityOf(geography: string): string {
  return (geography ?? '').split(',')[0]?.trim() ?? '';
}

/**
 * Pre-flight check before the first word is spoken (§10).
 * A failure degrades the opener rather than blocking the call.
 */
export interface OpenerCheck {
  ok: boolean;
  failures: string[];
  degradeTo: OpenerPriority | null;
}

export function checkOpener(opener: SelectedOpener, context: OpenerContext): OpenerCheck {
  const failures: string[] = [];
  const { pack } = context;

  if (!pack.companyName) failures.push('company identity is missing');
  if (opener.text.includes('Hey ') && pack.contactIsRoleOnly) {
    failures.push('a first name is used but the person is not verified');
  }
  if (opener.priority === 'PAID_DEMAND' && !context.freshAdvertising?.service) {
    failures.push('advertising context used without fresh claim-safe evidence');
  }
  // Exactly one question.
  const questionMarks = (opener.text.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) failures.push(`the opener asks ${questionMarks} questions, not one`);

  return {
    ok: failures.length === 0,
    failures,
    degradeTo: failures.length > 0 ? 'MARKET_CATEGORY' : null,
  };
}
