// Where an outbound message or callback actually goes.
//
// One place, because four tools need the answer and four
// implementations would drift. Each would eventually reach for
// `session.from` on its own, and the first one to do it while the
// caller had asked not to be texted would be a problem nobody noticed
// until it happened.
//
// Two rules run through all of it:
//
//   1. Having a number is not the same as being allowed to use it.
//      Twilio gives us a number before the caller has said a word; it
//      is provisional until they confirm it.
//   2. The model never chooses a recipient. It asks whether the number
//      is right, and the backend decides which number that is.

import type { Session, ContactRecord } from './types.ts';
import { speakPhone } from './speech.ts';

/** A callable NANP or international number. */
const CALLABLE = /^\+?[1-9]\d{7,14}$/;

/** Values Twilio sends when there is no usable caller ID. */
const NOT_A_NUMBER = /^(unknown|anonymous|private|restricted|blocked|unavailable|withheld)$/i;

/** Is this something we could actually ring or text? */
export function isUsableNumber(value: string | undefined | null): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v === '' || NOT_A_NUMBER.test(v)) return false;
  return CALLABLE.test(v.replace(/[\s()-]/g, ''));
}

export interface RecipientResolution {
  /** The number to use, or null when there is not a usable one. */
  phone: string | null;
  /** Whether the caller has agreed to this number being used. */
  confirmed: boolean;
  /** Why not, when phone is null or unconfirmed. */
  reason?: string;
  /** How the agent should say it, if it needs to ask. */
  spoken?: string;
}

/**
 * Who a text should go to.
 *
 * Preference order: a separate texting number the caller nominated,
 * then their confirmed number, then the provisional caller ID. The
 * last of those comes back unconfirmed on purpose — the caller should
 * be asked before the first message goes out, not after.
 */
export function resolveSmsRecipient(session: Session): RecipientResolution {
  const c: ContactRecord = session.contact;

  if (c.smsAllowed === false) {
    return { phone: null, confirmed: false, reason: 'The caller asked not to be texted. Offer to read it out or email it instead.' };
  }

  if (isUsableNumber(c.smsPhone)) {
    return { phone: c.smsPhone!, confirmed: true, spoken: speakPhone(c.smsPhone!) };
  }
  if (isUsableNumber(c.phone) && c.phoneConfirmed === true) {
    return { phone: c.phone!, confirmed: true, spoken: speakPhone(c.phone!) };
  }
  if (isUsableNumber(c.phone)) {
    return {
      phone: c.phone!, confirmed: false, spoken: speakPhone(c.phone!),
      reason: `Ask first: "Is ${speakPhone(c.phone!)} okay to text?" Then send it.`,
    };
  }
  if (isUsableNumber(session.from)) {
    return {
      phone: session.from, confirmed: false, spoken: speakPhone(session.from),
      reason: `Ask first: "Is ${speakPhone(session.from)} okay to text?" Then send it.`,
    };
  }
  return { phone: null, confirmed: false, reason: 'No usable mobile number. Ask for the best number to text.' };
}

/**
 * Who a callback should go to.
 *
 * Same shape, but a separate texting number does not apply — somebody
 * who asked for links on their mobile still wants the technician to
 * ring the number they called on.
 */
export function resolveCallbackRecipient(session: Session): RecipientResolution {
  const c = session.contact;
  if (isUsableNumber(c.phone) && c.phoneConfirmed === true) {
    return { phone: c.phone!, confirmed: true, spoken: speakPhone(c.phone!) };
  }
  if (isUsableNumber(c.phone)) {
    return {
      phone: c.phone!, confirmed: false, spoken: speakPhone(c.phone!),
      reason: `Confirm it first: "I have the number you're calling from as ${speakPhone(c.phone!)} — is that the best number?"`,
    };
  }
  if (isUsableNumber(session.from)) {
    return { phone: session.from, confirmed: false, spoken: speakPhone(session.from), reason: 'Confirm the number before relying on it.' };
  }
  return { phone: null, confirmed: false, reason: "Ask for the best number to reach them — Twilio did not give us a usable one." };
}

/**
 * The prompt section about the caller's number.
 *
 * Its whole job is to stop the agent asking "what's your phone number?"
 * when Twilio already told us. Asking someone stranded on a bridge to
 * recite a number we are literally receiving the call on is the kind of
 * thing that makes an automated system feel automated.
 */
export function renderPhoneGuidance(session: Session, industry: string | null): string | null {
  const c = session.contact;
  const has = isUsableNumber(c.phone) || isUsableNumber(session.from);
  if (!has) {
    return [
      'THEIR NUMBER',
      'Caller ID did not come through, so you genuinely do not have a number. Ask for the best one to reach them, and read it back once to check it.',
    ].join('\n');
  }

  const number = speakPhone((isUsableNumber(c.phone) ? c.phone : session.from) as string);

  if (c.phoneConfirmed === true) {
    const lines = [
      'THEIR NUMBER — ALREADY CONFIRMED',
      `They confirmed ${number}. Do not ask again.`,
      'For anything else you need to send, "I can text that to the same number" is enough — no second confirmation.',
    ];
    if (c.smsAllowed === false) lines.push('They asked NOT to be texted. Do not offer links by text; read it out or offer email.');
    if (isUsableNumber(c.smsPhone)) lines.push(`Texts go to ${speakPhone(c.smsPhone!)}, which they gave separately for that.`);
    return lines.join('\n');
  }

  // The contextual wording. Confirming beats asking, and asking why it
  // matters beats a bare "is this your number?".
  const ask: Record<string, string> = {
    collision_repair: `"I have the number you're calling from as ${number}. Is that the best number for the driver and the shop to reach you?"`,
    attorneys: `"Should the attorney call you back at ${number}?"`,
    plumbing: `"Is the number you're calling from the best one for the technician to reach you?"`,
    hvac: `"Is the number you're calling from the best one for the technician to reach you?"`,
    electrical: `"Is the number you're calling from the best one for the technician to reach you?"`,
    roofing: `"Is the number you're calling from the best one to reach you?"`,
  };

  return [
    'THEIR NUMBER — CONFIRM IT, DO NOT ASK FOR IT',
    `Twilio gave us ${number}. Never ask "what's your phone number?" when you already have one — confirm it instead:`,
    `  ${ask[industry ?? ''] ?? `"I have the number you're calling from as ${number}. Is that the best number to reach you?"`}`,
    'Say it the way it is printed. Never read out the stored "+1" form.',
    'If they say yes, record it with capture_details and phoneConfirmed true, and stop asking.',
    'If they give a different number, use theirs instead — and do not make them repeat the original one back.',
    'Before the first text you send, check the destination the same way: "Is that okay to text?"',
  ].join('\n');
}
