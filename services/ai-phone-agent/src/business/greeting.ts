// What the caller hears before they have said anything.
//
// Two completely different things share this seam, and keeping them
// apart matters more than any wording in either.
//
// The DEMO line is Your AI Department's own sales asset. It should say
// so, invite the caller to role-play, and offer a discovery call.
//
// A CLIENT line is that client's receptionist. It must never mention
// Your AI Department, never say the word demo, never allude to other
// industries, and never offer anyone a discovery call with us. A real
// customer ringing a collision shop about their wrecked car hearing a
// pitch for our services would be indefensible — so the client
// greeting is not a variation on the demo greeting, it is a separate
// value that cannot accidentally inherit from it.

/**
 * The first thing a demo caller hears.
 *
 * Five words, and that is the whole point: this string goes in the
 * TwiML `welcomeGreeting`, which ConversationRelay synthesises in full
 * before it plays a syllable. Every word here is silence at the front
 * of the call. The positioning that used to live in this attribute —
 * and cost three to five seconds of dead air — is in
 * DEMO_INTRO.positioning, spoken over the socket instead.
 *
 * Do not lengthen this. Lengthen the positioning.
 */
export const DEMO_GREETING = 'Welcome to Your AI Department.';

/**
 * The rest of the pitch, said on the FIRST agent turn rather than in
 * the greeting.
 *
 * Twilio synthesises `welcomeGreeting` before it plays any of it, so
 * every word there is silence the caller sits through before hearing
 * anything. The old 63-word introduction was roughly 25 seconds of
 * speech and several seconds of synthesis — measured as a 3-5 second
 * dead opening on real calls. The greeting now gets them talking
 * immediately, and the positioning arrives once the conversation is
 * already moving.
 */
export const DEMO_INTRO_CONTEXT =
  'This is the Your AI Department demo line. If it comes up naturally — but NOT as an opening speech — you can mention that agents like this are built for any industry, in the client\'s own branding, with hundreds of voices, and that you can book a discovery call before the end. Weave it in; do not recite it.';

/** Roughly how long a piece of speech takes, for the length guard. */
export function spokenSeconds(text: string, wordsPerMinute = 150): number {
  return (text.trim().split(/\s+/).length / wordsPerMinute) * 60;
}

/**
 * Fallback for a client deployment that has not configured its own.
 *
 * Deliberately bland and business-agnostic. If a client has not
 * supplied a greeting, the right failure is a plain receptionist
 * opening — never the demo script.
 */
export const DEFAULT_CLIENT_GREETING =
  "Thanks for calling. Tell me a bit about what's going on and I'll get you to the right place.";

export interface GreetingOptions {
  mode: 'demo' | 'client';
  /** A client's own greeting. Ignored entirely in demo mode. */
  clientGreeting?: string;
  businessName?: string;
}

/**
 * The greeting for this deployment.
 *
 * Note the shape: demo mode returns the demo script and cannot be
 * overridden by a client greeting, and client mode has no path to the
 * demo script at all. Neither can leak into the other by
 * misconfiguration.
 */
export function greetingFor(opts: GreetingOptions): string {
  if (opts.mode === 'demo') return DEMO_GREETING;
  if (opts.clientGreeting && opts.clientGreeting.trim() !== '') return opts.clientGreeting.trim();
  if (opts.businessName) return `Thanks for calling ${opts.businessName}. How can I help?`;
  return DEFAULT_CLIENT_GREETING;
}

/**
 * Anything that would give away that a client's line is ours.
 *
 * Used by tests against every string a client-mode caller could hear.
 * Listed here rather than in a test file so the rule is part of the
 * product, not part of the test suite.
 */
export const YAD_BRANDING_MARKERS: RegExp[] = [
  /\byour ai department\b/i,
  /\bYAD\b/,
  /\bdemo (line|mode|call|scenario)\b/i,
  /\bdiscovery call\b/i,
  /\bour team\b/i,
  /\bbuild (agents|systems) like this\b/i,
  /\bvoice options\b/i,
  /\bfor your business\b/i,
];

/**
 * The demo line's opening, split in two.
 *
 * ConversationRelay synthesises the whole `welcomeGreeting` before it
 * plays any of it, so every word in that attribute is dead air at the
 * front of the call — which is what made the original 63-word intro
 * take about 25 seconds to get started. The fix is not a shorter
 * pitch: it is putting only the first line in the attribute and
 * speaking the rest over the open socket, where synthesis has already
 * begun by the time the caller has heard "Welcome to".
 *
 * `positioning` is sent as ONE preemptible text message the moment the
 * relay connects. Preemptible matters: if the caller starts talking,
 * the reply we generate is a subsequent text message, and Twilio drops
 * whatever is left of the pitch rather than finishing it first. Caller
 * speech also stops playback outright (`welcomeGreetingInterruptible`
 * and `interruptible` both default to `any`), so barge-in during the
 * intro needs nothing extra.
 *
 * `positioning` is deliberately null: the mechanism is in place, the
 * wording is not chosen yet. Setting it here is the only change needed
 * to turn the split intro on.
 */
export interface DemoIntro {
  /** Goes in the TwiML attribute. Every word delays first audio. */
  greeting: string;
  /** Spoken over the socket once connected, or null for greeting only. */
  positioning: string | null;
}

export const DEMO_INTRO: DemoIntro = {
  greeting: DEMO_GREETING,
  positioning:
    "You're talking to one of our live AI receptionists. We build agents like this for "
    + 'virtually any industry, customized to your business, with hundreds of available voices. '
    + 'Just talk to me like you would the actual company. '
    + 'If you like it, I can book you a discovery call before we finish.',
};
