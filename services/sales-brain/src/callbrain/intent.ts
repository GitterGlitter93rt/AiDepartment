/**
 * Priority intent detection.
 * Authority: outbound-sales-brain-priority-intent-detector-spec.md,
 * conversation-state-machine.md §4.
 *
 * Deliberately deterministic and independent of the sales model. Some intents are
 * too important to leave to open-ended generation: if a person says "take me off
 * your list", nothing the model wants to say next may happen.
 *
 * The asymmetry here is intentional. A false positive costs one lost conversation.
 * A false negative means calling someone who told us to stop.
 */

export type PriorityIntentType =
  | 'DNC'
  | 'WRONG_NUMBER'
  | 'END_CALL'
  | 'HUMAN_REQUESTED'
  | 'IDENTITY_CORRECTION'
  | 'CALLBACK_TIMING'
  | 'HOSTILE';

export interface PriorityIntent {
  type: PriorityIntentType;
  confidence: 'high' | 'medium';
  matchedText: string;
  requiresImmediateAudioStop: boolean;
  /** What orchestration must do, regardless of what the model proposed. */
  deterministicAction: 'suppress_and_end' | 'record_and_end' | 'end_politely'
    | 'route_to_human' | 'capture_correction' | 'schedule_callback' | 'apologize_and_end';
  parameters?: Record<string, string>;
}

/** Unambiguous stop-contacting language. Nothing here is a timing objection. */
const DNC_PATTERNS: RegExp[] = [
  /\b(?:do ?n[o']?t|don't|do not|never)\s+(?:ever\s+)?(?:call|phone|contact|ring)\s+(?:me|us|here|this)?\s*(?:again|any ?more|no more)?\b/i,
  /\btake\s+(?:me|us|this|my|our)\b.{0,20}\b(?:off|out of)\b.{0,20}\b(?:list|database|system|records?)\b/i,
  /\bremove\s+(?:me|us|this|my|our)\b.{0,25}\b(?:list|database|system|records?|calls?)\b/i,
  /\bstop\s+calling\b/i,
  /\bstop\s+(?:contacting|phoning)\b/i,
  /\bunsubscribe\b/i,
  /\bput\s+(?:me|us)\s+on\s+(?:your\s+)?(?:the\s+)?do[- ]?not[- ]?call\b/i,
  /\bdo[- ]?not[- ]?call\s+(?:list|registry)\b/i,
  /\bwe'?re\s+not\s+interested.{0,15}(?:ever|at all).{0,15}\b(?:call|contact)/i,
];

/**
 * Timing objections that look like DNC but are not.
 * "Don't call me right now, call Friday" is a callback, not a suppression.
 * Getting this wrong in either direction is costly, so the timing check runs first.
 */
const TIMING_PATTERNS: RegExp[] = [
  /\b(?:do ?n[o']?t|don't|do not)\s+call\s+(?:me\s+)?(?:right\s+)?now\b/i,
  /\bcall\s+(?:me\s+)?(?:back\s+)?(?:on\s+|next\s+|this\s+)?(?:later|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|after|in the (?:morning|afternoon|evening))\b/i,
  /\bnot\s+(?:today|right now|a good time|this week)\b/i,
  /\btry\s+(?:me\s+)?(?:again\s+)?(?:later|tomorrow|next week)\b/i,
  /\bi'?m\s+(?:busy|in a meeting|with a customer|driving)\b/i,
];

const WRONG_NUMBER_PATTERNS: RegExp[] = [
  /\b(?:wrong|incorrect)\s+(?:number|person|company|department)\b/i,
  /\bthere'?s?\s+no\s*(?:one|body)\s+(?:here\s+)?by\s+that\s+name\b/i,
  /\bno\s*(?:one|body)\s+(?:here\s+)?(?:called|named|by the name|works here|with that name)\b/i,
  /\byou(?:'?ve|\s+have)?\s+(?:got\s+)?the\s+wrong\b/i,
  /\bthis\s+is\s+(?:a\s+)?(?:residence|residential|my\s+(?:cell|home|personal))\b/i,
  /\bwe'?re\s+not\s+(?:a|an)\s+\w+\s+(?:company|business|shop)\b/i,
  /\bthat'?s?\s+not\s+(?:us|our|this)\s+(?:company|business)\b/i,
];

const END_CALL_PATTERNS: RegExp[] = [
  /\b(?:i'?m\s+)?(?:going to\s+|gonna\s+)?hang(?:ing)?\s+up\b/i,
  /\b(?:goodbye|good ?bye|bye now)\b/i,
  /\bi'?m\s+done\s+(?:with\s+this|here|talking)\b/i,
  /\bend\s+(?:this|the)\s+call\b/i,
  // "Not interested" alone is an objection the not_interested card is entitled to
  // clarify once - bad timing and no need are different answers. Only an explicit
  // farewell alongside it ends the call outright.
  /\bnot\s+interested[.,!\s]+(?:goodbye|bye|thanks|thank you)\b/i,
  /\bnot\s+interested\s+in\s+talking\b/i,
];

const HUMAN_REQUESTED_PATTERNS: RegExp[] = [
  /\b(?:can|could|may)\s+i\s+(?:speak|talk)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:human|person|someone)\b/i,
  /\b(?:get|put)\s+me\s+(?:a|to a)\s+(?:real\s+)?(?:human|person)\b/i,
  /\bi\s+(?:want|need)\s+to\s+(?:speak|talk)\s+to\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b/i,
  /\btransfer\s+me\b/i,
];

const HOSTILE_PATTERNS: RegExp[] = [
  /\b(?:f[u*]ck|piss off|screw you|go to hell)\b/i,
  /\bi'?ll\s+(?:sue|report)\s+you\b/i,
  /\bthis\s+is\s+harassment\b/i,
];

/** "Actually you want Sarah, she runs operations." */
const CORRECTION_PATTERNS: RegExp[] = [
  /\b(?:you\s+)?(?:want|need)\s+to\s+(?:talk|speak)\s+to\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  /\b(?:that'?s?|it'?s?)\s+(?<name2>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:who|that)\s+(?:handles|runs|owns|manages)\b/,
  /\b(?<name3>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:handles|runs|manages|takes care of)\s+(?:that|our|the)\b/,
  /\b(?:he|she|they)\s+(?:no longer|doesn'?t|does not)\s+work(?:s)?\s+here\b/i,
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * Classifies one prospect utterance.
 * Returns null when nothing overrides normal sales flow.
 */
export function detectPriorityIntent(utterance: string): PriorityIntent | null {
  const text = utterance.trim();
  if (!text) return null;

  // Hostility outranks everything: end the call, do not sell through it.
  const hostile = firstMatch(text, HOSTILE_PATTERNS);
  if (hostile) {
    return {
      type: 'HOSTILE', confidence: 'high', matchedText: hostile,
      requiresImmediateAudioStop: true, deterministicAction: 'apologize_and_end',
    };
  }

  // A timing objection that is NOT also a stop request stays a timing objection.
  const timing = firstMatch(text, TIMING_PATTERNS);
  const dnc = firstMatch(text, DNC_PATTERNS);

  if (dnc && !timing) {
    return {
      type: 'DNC', confidence: 'high', matchedText: dnc,
      requiresImmediateAudioStop: true, deterministicAction: 'suppress_and_end',
    };
  }
  // "Don't call me again, ever" alongside timing words: the stop wins.
  if (dnc && timing && /\b(again|any ?more|ever|no more|off (?:your|the) list)\b/i.test(text)) {
    return {
      type: 'DNC', confidence: 'high', matchedText: dnc,
      requiresImmediateAudioStop: true, deterministicAction: 'suppress_and_end',
    };
  }

  const wrongNumber = firstMatch(text, WRONG_NUMBER_PATTERNS);
  if (wrongNumber) {
    return {
      type: 'WRONG_NUMBER', confidence: 'high', matchedText: wrongNumber,
      requiresImmediateAudioStop: false, deterministicAction: 'record_and_end',
    };
  }

  const human = firstMatch(text, HUMAN_REQUESTED_PATTERNS);
  if (human) {
    return {
      type: 'HUMAN_REQUESTED', confidence: 'high', matchedText: human,
      requiresImmediateAudioStop: false, deterministicAction: 'route_to_human',
    };
  }

  const end = firstMatch(text, END_CALL_PATTERNS);
  if (end) {
    return {
      type: 'END_CALL', confidence: 'high', matchedText: end,
      requiresImmediateAudioStop: false, deterministicAction: 'end_politely',
    };
  }

  if (timing) {
    return {
      type: 'CALLBACK_TIMING', confidence: 'medium', matchedText: timing,
      requiresImmediateAudioStop: false, deterministicAction: 'schedule_callback',
      parameters: { rawTiming: timing },
    };
  }

  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const name = match.groups?.['name'] ?? match.groups?.['name2'] ?? match.groups?.['name3'];
      return {
        type: 'IDENTITY_CORRECTION', confidence: 'medium', matchedText: match[0],
        requiresImmediateAudioStop: false, deterministicAction: 'capture_correction',
        parameters: name ? { correctedName: name } : {},
      };
    }
  }

  return null;
}

/** The short, non-salesy things the agent says when a priority intent fires. */
export const PRIORITY_RESPONSES: Record<PriorityIntentType, string> = {
  // No objection handling, no last pitch. Acknowledge and go.
  DNC: "Understood — I'll take this number off our list right now and you won't hear from us again. Sorry to have bothered you.",
  WRONG_NUMBER: "Sorry about that, I've clearly got the wrong number. I'll get it corrected. Have a good day.",
  END_CALL: 'No problem at all — thanks for your time.',
  HUMAN_REQUESTED: "Of course. Let me get one of our people to call you back directly.",
  IDENTITY_CORRECTION: "That's helpful, thank you.",
  CALLBACK_TIMING: "That's no problem.",
  HOSTILE: "Understood, I'll leave you alone. Sorry to have caught you at a bad time.",
};
