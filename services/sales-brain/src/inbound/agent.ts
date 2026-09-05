import { buildInboundContext, type InboundContext } from './context.js';
import { resolveInboundMode, type InboundResolution } from './resolver.js';

/**
 * What the inbound agent is for, and what it may do about each thing a caller says.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md SS5, SS7.
 *
 * This is the inbound persona's decision table, kept as data rather than prose so a
 * test can assert every branch and an operator can read what the agent will do
 * without reading a prompt.
 *
 * The persona is not the outbound one and cannot become it. There is no opener here,
 * no hypothesis, no hook and no pitch: an inbound caller reached us, and the job is
 * to find out what they want and get them to the right place.
 */

/** Everything the inbound agent is allowed to do. Nothing else is an option. */
export type InboundIntent =
  | 'IDENTIFY_CALLER'
  | 'ANSWER_SERVICE_QUESTION'
  | 'RESUME_KNOWN_RELATIONSHIP'
  | 'CONFIRM_EXISTING_MEETING'
  | 'RESCHEDULE_REQUEST'
  | 'OFFER_BOOKING'
  | 'REQUEST_HUMAN'
  | 'ROUTE_TO_OWNER'
  | 'RECORD_DO_NOT_CALL'
  | 'RECORD_WRONG_NUMBER'
  | 'CAPTURE_CALLBACK_REQUEST'
  | 'DECLINE_VENDOR_PITCH'
  | 'ANSWER_HOW_WE_GOT_THE_NUMBER'
  | 'DISCLOSE_AI'
  | 'ESCALATE_UNKNOWN';

export interface IntentRule {
  intent: InboundIntent;
  /** What the caller said, in the shapes people actually say it. */
  triggers: RegExp[];
  /** What the agent does. One action, so there is no ambiguity at runtime. */
  action: string;
  /** What it must not do, written as the sentence it would otherwise say. */
  prohibition: string;
  /** True when the intent applies whatever the resolved mode is. */
  anyMode: boolean;
}

/**
 * Ordered. The first rule that matches wins, so the things that must never be
 * missed -- a do-not-call instruction, a wrong number -- are at the top, above
 * anything that could swallow them.
 */
export const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'RECORD_DO_NOT_CALL', anyMode: true,
    triggers: [
      /\b(?:stop|quit|cease) (?:calling|contacting|ringing)\b/i,
      /\b(?:do not|don'?t) (?:call|contact|ring|phone)\b/i,
      // "I told you not to call" is the same instruction said backwards, and it is
      // how somebody says it when they have said it before.
      /\bnot to (?:call|contact|ring|phone)\b/i,
      /\btake (?:me|us|this number) off\b/i,
      /\bremove (?:me|us|my number|this number)\b/i,
      /\bunsubscribe\b/i,
      /\bnot interested\b[^.]{0,30}\b(?:stop|again|ever)\b/i,
    ],
    action: 'Confirm it out loud, record the suppression, and end the call politely. '
      + 'Nothing is offered, asked or arranged after this.',
    prohibition: 'Do not ask why, do not offer an alternative, and do not say anybody '
      + 'will call to confirm.',
  },
  {
    intent: 'RECORD_WRONG_NUMBER', anyMode: true,
    triggers: [
      // "This is not ABC Roofing" -- a company name, not a keyword. Anything that is
      // plainly about the moment rather than the identity is excluded, because
      // "this is not a good time" is a callback request and must not be recorded as
      // a wrong number.
      /\b(?:this|that|it) is\s?n[o']?t\s+(?!a good time\b|convenient\b|the best time\b|really\b)/i,
      /\bwrong number\b/i,
      /\byou'?ve got the wrong\b/i,
      /\byou have the wrong\b/i,
      /\bno[-\s]?(?:one|body) (?:here|by that name|of that name)\b/i,
      /\bthere(?:'s| is) no\b[^.]{0,30}\bhere\b/i,
      /\bnever heard of\b/i,
    ],
    action: 'Apologise once, confirm the number reached the wrong person, mark the '
      + 'endpoint wrong, and end. The company record is not touched.',
    prohibition: 'Do not ask who they are, do not ask for a better number, and do not '
      + 'name the company we were trying to reach.',
  },
  {
    intent: 'DISCLOSE_AI', anyMode: true,
    triggers: [
      /\bare you (?:a )?(?:robot|bot|ai|a\.i\.|real|human|a person|recorded)\b/i,
      /\bis this (?:a )?(?:robot|bot|ai|recording|machine)\b/i,
      /\bam i (?:talking|speaking) to (?:a )?(?:robot|bot|machine|computer)\b/i,
    ],
    action: 'Say yes plainly, in one sentence, and carry on with what they asked.',
    prohibition: 'Do not deny it, do not deflect, and do not claim to be a named person.',
  },
  {
    intent: 'ANSWER_HOW_WE_GOT_THE_NUMBER', anyMode: true,
    triggers: [
      /\bhow did you get (?:my|this) (?:number|details|information)\b/i,
      /\bwhere did you get (?:my|this)\b/i,
      /\bwho gave you\b/i,
    ],
    action: 'Say it came from publicly listed business information, offer to remove '
      + 'them, and do nothing else until they answer.',
    prohibition: 'Do not name a data provider we do not use, do not say a person '
      + 'referred them, and do not guess.',
  },
  {
    intent: 'REQUEST_HUMAN', anyMode: true,
    triggers: [
      /\b(?:can|could|may) i (?:speak|talk) (?:to|with)\b/i,
      /\bput me through\b/i,
      /\b(?:get|give) me (?:a|an) (?:human|person|real person|manager)\b/i,
      /\bis (?:michael|mike)\b[^.]{0,20}\b(?:there|available|in)\b/i,
      // "I was returning Brent's call" and "someone from your company called me" are
      // both a person asking for whoever rang them. The apostrophe may be a typewriter
      // one or a typographic one, and a pattern that only knows the first is a pattern
      // that fails on every phone keyboard.
      /\b(?:i(?:'|\u2019)?m|i was|just) return(?:ing|ed)?\b[^.]{0,30}\bcall\b/i,
      /\b(?:some\s?one|somebody|a guy|a woman|a man|s?he|they)\b[^.]{0,40}\bcalled (?:me|us|here|this number)\b/i,
      /\breturning (?:a|the|your|his|her|their)?\s?call\b/i,
    ],
    action: 'Take their name, their company and what it is about, and record it for a '
      + 'human to return. Say when somebody will get back to them only if that is '
      + 'something the CRM can support.',
    prohibition: 'Do not transfer to a person who is not reachable, and do not promise '
      + 'a specific time unless one is recorded.',
  },
  {
    intent: 'CONFIRM_EXISTING_MEETING', anyMode: false,
    triggers: [
      /\b(?:i have|we have|about) (?:a|the|my|our) (?:meeting|call|appointment)\b/i,
      /\b(?:meeting|call|appointment) (?:tomorrow|today|on|at)\b/i,
    ],
    action: 'Confirm only what the CRM holds -- that a meeting exists and when -- and '
      + 'answer what they asked about it.',
    prohibition: 'Do not confirm a meeting that is not in the CRM, and do not invent '
      + 'who they are meeting.',
  },
  {
    intent: 'RESCHEDULE_REQUEST', anyMode: false,
    triggers: [
      /\b(?:move|change|reschedule|push|shift) (?:the|my|our) (?:meeting|call|appointment)\b/i,
      /\bcan'?t make\b.{0,30}\b(?:meeting|call|appointment)\b/i,
    ],
    action: 'Record that they want to move it, and what suits them, for the owner to '
      + 'action. Offer a new time only when the booking system can confirm one.',
    prohibition: 'Do not say the meeting has been moved until the provider confirms it.',
  },
  {
    intent: 'ANSWER_SERVICE_QUESTION', anyMode: true,
    triggers: [
      /\bwhat (?:do|does) (?:you|your company)\b/i,
      /\bwho (?:are|is) (?:you|this)\b/i,
      /\bwhat is (?:your ai department|this about)\b/i,
      /\bwhat (?:services|do you offer|do you sell)\b/i,
    ],
    action: 'Say what Your AI Department does in a sentence, then ask what they were '
      + 'calling about.',
    prohibition: 'Do not quote a price, do not name a customer, and do not claim a '
      + 'result. Those come from the company’s own commercial truth, not from here.',
  },
  {
    intent: 'DECLINE_VENDOR_PITCH', anyMode: true,
    triggers: [
      /\bi'?m calling (?:from|about|regarding)\b.{0,40}\b(?:offer|service|solution|partnership)\b/i,
      /\b(?:seo|web design|leads?|marketing) (?:services|agency|company)\b/i,
      /\bspecial (?:offer|promotion|deal)\b/i,
    ],
    action: 'Decline politely in one sentence and end. Record it as a vendor call so '
      + 'nobody chases it as a prospect.',
    prohibition: 'Do not take their details for a callback, and do not create a '
      + 'follow-up.',
  },
  {
    intent: 'OFFER_BOOKING', anyMode: false,
    triggers: [
      /\b(?:book|schedule|set up|arrange) (?:a|an|the) (?:call|meeting|time|chat)\b/i,
      /\bwhen (?:can|could) (?:we|i) (?:talk|speak|meet)\b/i,
    ],
    action: 'Offer only times the booking provider returned, and say it is booked only '
      + 'after the provider confirms.',
    prohibition: 'Do not offer a time from memory, and do not say "you are booked in" '
      + 'before a confirmation exists.',
  },
  {
    intent: 'CAPTURE_CALLBACK_REQUEST', anyMode: true,
    triggers: [
      /\b(?:call|ring|phone) me (?:back|later|tomorrow|after)\b/i,
      /\b(?:try|reach) me\b.{0,20}\b(?:later|after|tomorrow|morning|afternoon)\b/i,
      /\bnot a good time\b/i,
    ],
    action: 'Take the time they asked for, in their words, and record it as a '
      + 'prospect-requested callback for the owner.',
    prohibition: 'Do not promise who will call, and do not treat it as consent to '
      + 'call about anything else.',
  },
];

export interface IntentMatch {
  intent: InboundIntent;
  rule: IntentRule;
  matched: string;
}

/**
 * The first rule whose trigger the caller's words match.
 *
 * Deterministic, and ordered so that a do-not-call instruction buried in a longer
 * sentence is not swallowed by a softer rule further down. The model is given the
 * action; it does not choose it.
 */
export function classifyInboundIntent(
  utterance: string, mode: 'INBOUND_CALLBACK' | 'INBOUND_GENERAL',
): IntentMatch | null {
  const text = utterance.trim();
  if (!text) return null;
  for (const rule of INTENT_RULES) {
    if (!rule.anyMode && mode !== 'INBOUND_CALLBACK') continue;
    for (const trigger of rule.triggers) {
      const found = trigger.exec(text);
      if (found) return { intent: rule.intent, rule, matched: found[0] };
    }
  }
  return null;
}

export interface InboundPlan {
  resolution: InboundResolution;
  context: InboundContext;
}

/**
 * The whole inbound decision, in one call.
 *
 * The voice service asks for this and uses what comes back. Everything that decides
 * anything -- the mode, the facts, the opening line, the prohibitions -- happens
 * here, where it can be tested against a database rather than inside a prompt.
 */
export async function planInboundCall(input: {
  fromNumber: string; toNumber?: string; callSid?: string | null; now?: Date;
}): Promise<InboundPlan> {
  const resolution = await resolveInboundMode(input);
  return { resolution, context: buildInboundContext(resolution) };
}
