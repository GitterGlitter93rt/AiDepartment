// What the caller is trying to get done, and what would move them
// closer to it.
//
// This exists because the agents were behaving like forms. Given a
// scripted list of fields, a model works down the list — so it asked a
// caller who had just said "I want to see your listing at 123 Main
// Street" whether they were looking to buy, sell or rent. The question
// was next on the list. It was also useless: they had already said.
//
// The fix is to give the model a GOAL and the facts it already has,
// and let it work out the next question itself. A flow here is a route
// to an outcome, not an order of operations — every step is skippable
// the moment the caller volunteers the answer.

import type { Session } from './types.ts';

export interface IndustryGoal {
  /** What finishing this call actually looks like. */
  outcome: string;
  /** Steps toward it, in rough order. Skipped freely. */
  path: string[];
  /** Things that would derail the call. */
  avoid: string[];
}

const GOALS: Record<string, IndustryGoal> = {
  collision_repair: {
    outcome: 'the vehicle is on its way to the shop, or booked in — with enough detail that nobody has to ring them back for basics',
    path: [
      'is everyone okay, and is the car somewhere safe',
      'can it be driven, or does it need a truck',
      'what the vehicle is',
      'where it is, precisely enough for a driver',
      'insurance and claim, as far as they know it',
      'get it moving: tow, or a time to bring it in',
      'confirm what happens next',
    ],
    avoid: [
      'sending them to a website or telling them to call back — they rang because they want it dealt with now',
      'offering the same link twice',
      'raising medical care unless they actually mention being hurt',
      'asking for a claim number before the car is safe',
    ],
  },
  attorneys: {
    outcome: 'the intake is taken and a consultation or callback is set, on THIS call',
    path: [
      'a brief word on medical care if they are hurt — once, not as a reason to hang up',
      'what happened, when, and where',
      'injuries and whether they are being treated',
      'police, insurers, the other driver',
      'whether anyone is already acting for them',
      'contact details and the next step with the firm',
    ],
    avoid: [
      'telling them to get treatment and call back — their lack of treatment is a fact to record, not a reason to end the call',
      'making them start again later',
      'anything that sounds like legal advice',
    ],
  },
  real_estate: {
    outcome: 'the showing is requested with a time and a name, or the enquiry reaches an agent with enough to act on',
    path: [
      'which property, if they have not already said',
      'answer what they asked about it',
      'when they want to see it',
      'name and a number',
      'get the showing requested and tell them who follows up',
    ],
    avoid: [
      'asking whether they want to buy, sell or rent when they have already told you what they want',
      'asking whether they have an agent before helping them — that comes later, if at all',
      'a financing or pre-approval interrogation before the showing is even requested',
    ],
  },
  plumbing: {
    outcome: 'the water is under control and a technician is booked',
    path: ['is it still running and can they shut it off', 'what and where', 'address and callback', 'book the visit'],
    avoid: ['a long questionnaire while water is running', 'sending them to a website'],
  },
};

/**
 * The goal block for this call.
 *
 * Rendered with what is already known struck off, so the model is
 * looking at what is left rather than at a full list it might work
 * through from the top.
 */
export function renderGoal(session: Session, industry: string | null): string | null {
  const goal = GOALS[industry ?? ''];
  if (!goal) return null;

  const known = { ...session.contact, ...session.qualification } as Record<string, unknown>;
  const facts = Object.entries(known)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k]) => k);

  return [
    'WHAT THIS CALL IS FOR',
    `Done means: ${goal.outcome}.`,
    '',
    'Roughly how it gets there — skip anything they have already told you:',
    ...goal.path.map((p) => `  - ${p}`),
    '',
    'Do not:',
    ...goal.avoid.map((a) => `  - ${a}`),
    '',
    facts.length
      ? `You already have: ${facts.join(', ')}. Do not ask for any of it again.`
      : 'You have nothing yet, so start with whatever matters most for what they said.',
  ].join('\n');
}

/**
 * Things already offered or done, so they are not offered again.
 *
 * The body-shop call kept mentioning a link because nothing recorded
 * that it already had. One sentence of memory removes an entire class
 * of irritation.
 */
export function renderOfferMemory(session: Session): string | null {
  const q = session.qualification as Record<string, unknown>;
  const done: string[] = [];
  if (q.locationLinkStatus) done.push('the location link has been dealt with');
  if (q.uploadLinkStatus) done.push('the upload link has been dealt with');
  if (q.esignStatus) done.push('the paperwork has been sent');
  if (q.towRequested) done.push('a tow has been arranged');
  if (q.referralOffered) done.push('the referral has been offered');
  if (session.contact.phoneConfirmed) done.push('their number is confirmed');
  if (session.ctaOffered || session.ctaDeclined) done.push('the discovery call has been raised');

  if (done.length === 0) return null;
  return [
    'ALREADY HANDLED — do not raise any of these again:',
    ...done.map((d) => `  - ${d}`),
    'Offering something a second time is the fastest way to sound like a machine. Move forward.',
  ].join('\n');
}
