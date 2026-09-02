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
 * The demo line's introduction.
 *
 * Written for speech, not for a page: short clauses, contractions, and
 * one idea per sentence. Around twenty seconds spoken, which is long
 * enough to set up the role-play and short enough that nobody taps
 * zero.
 *
 * "Hundreds of voice options" is deliberately vague — a specific count
 * would be a claim we would have to keep true.
 */
export const DEMO_GREETING =
  "Welcome to the Your AI Department demo line — you're talking to a live AI receptionist. " +
  "We build these for any industry, in your branding, with hundreds of voices. " +
  "So tell me what you need, like you'd call a real business, and I'll show you how it handles it. " +
  "If you like it, I can book you a discovery call before we finish.";

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
