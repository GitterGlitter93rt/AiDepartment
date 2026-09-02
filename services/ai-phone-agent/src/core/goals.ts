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
    outcome: 'the vehicle is on its way to the shop, or booked in — with a payment path settled and enough detail that nobody has to ring them back for basics',
    path: [
      'where the vehicle is, precisely enough for a driver to find it',
      'what it is: year, make, model',
      'how it has to be moved — does it roll, does it steer, anything jammed or bent',
      'who is paying: insurance, or self-pay',
      'if insurance: the carrier, and either a claim number or a policy number',
      'name, callback number, and an email for the paperwork',
      'get it moving: tow, or a time to bring it in',
      'what happens next — the forms, the teardown, the estimate',
    ],
    avoid: [
      'asking whether they are safe, whether anyone is hurt, or whether they are out of traffic — they rang a body shop, not a hospital',
      'treating "I am stranded" as a distress signal. It means they want a truck: get on with arranging one',
      // The live failure, in one line: a caller asked whether we
      // really needed insurance and was told their safety mattered
      // more and the rest could come later. A truck went out unfunded.
      'saying the insurance, the claim number or the paperwork can be sorted out later — a truck does not go out without a way of paying for it',
      'sending them to a website or telling them to call back — they rang because they want it dealt with now',
      'offering the same link twice',
      'raising medical care unless they actually mention being hurt',
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
  // A body shop's shop-business calls get a different goal from its
  // crash calls. Same industry, different conversation.
  if (industry === 'collision_repair') {
    const intent = session.route.intent ?? '';
    if (COLLISION_PROJECT_INTENTS.has(intent)) return renderGoalBlock(session, COLLISION_SHOP_BUSINESS_GOAL);
    if (COLLISION_QUESTION_INTENTS.has(intent)) {
      // A question becomes a project the moment they describe work
      // they want doing — then, and only then, the handover applies.
      const q = session.qualification as Record<string, unknown>;
      const turnedIntoAJob = Boolean(q.projectDescription) || Boolean(q.advisorCallbackStatus);
      return renderGoalBlock(session, turnedIntoAJob ? COLLISION_SHOP_BUSINESS_GOAL : COLLISION_QUESTION_GOAL);
    }
  }

  const goal = GOALS[industry ?? ''];
  if (!goal) return null;
  return renderGoalBlock(session, goal);
}

/** One goal, with everything already known struck off. */
function renderGoalBlock(session: Session, goal: IndustryGoal): string {
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
/**
 * What an ordinary shop-business call is for.
 *
 * Not every body-shop call is a crash. A caller asking about custom
 * paint or a restoration wants an answer and then a way forward, and
 * the accident goal — tow, scene, claim — is the wrong shape for them
 * entirely.
 */
/**
 * Someone who rang to ask one question.
 *
 * Rates, whether the shop takes insurance, whether it does colour
 * matching — these have answers, and the answer may be all they
 * wanted. The project goal below ends in a repair advisor ringing them
 * back, which is exactly wrong for a caller who said "okay, thanks":
 * told that a handover "is what finishes this call", the agent goes
 * looking for a project that does not exist.
 */
const COLLISION_QUESTION_GOAL: IndustryGoal = {
  outcome: 'their question is answered properly, and they are helped further only if they want to be',
  path: [
    'answer what they actually asked, first, plainly, and completely',
    'ask whether there is something specific they are looking to get done',
    'if there IS a job — then take it: what they want done, the vehicle, photos if it needs eyes on it, and their details for an advisor',
    'if there is NOT, let them go warmly. A question answered is a call that went well',
  ],
  avoid: [
    'collecting their details when they only asked a question',
    'pushing a photo link or an advisor callback at someone who has not asked for work',
    'running the accident intake: nobody crashed, so do not ask about injuries, a scene, a claim or a tow',
    'quoting a price for a repair, a repaint, a custom job or a restoration — none of those have a phone number price',
  ],
};

const COLLISION_SHOP_BUSINESS_GOAL: IndustryGoal = {
  outcome: 'their question is answered, and if it needs a human look, an advisor has photos and a reason to call them back',
  path: [
    'answer what they actually asked, first, before anything else',
    'find out what they want done, in their own words',
    'the vehicle: year, make, model',
    'photos, if it cannot be judged without seeing it',
    'their name and a good number, and an email if the advisor needs to send anything',
    'hand it to a repair advisor with request_advisor_callback — that is what finishes this call',
    'tell them what happens next and who is calling',
  ],
  avoid: [
    'quoting a price for a repair, a repaint, a custom job or a restoration — none of those have a phone number price',
    'running the accident intake: nobody crashed, so do not ask about injuries, a scene, a claim or a tow',
    'making them answer questions before you answer theirs',
    'offering the photo link more than once',
    'saying an advisor will call before request_advisor_callback has come back successful',
  ],
};

/**
 * Shop business that is a PROJECT — it ends with an advisor ringing.
 */
const COLLISION_PROJECT_INTENTS = new Set([
  'custom_work', 'restoration', 'general_estimate',
]);

/**
 * Shop business that is a QUESTION. It ends when the question is
 * answered, unless the caller turns it into a project themselves.
 */
const COLLISION_QUESTION_INTENTS = new Set([
  'labor_rate_question', 'paint_color_match', 'insurance_repair',
  'service_question', 'mechanical_repair',
]);

export function renderOfferMemory(session: Session): string | null {
  const q = session.qualification as Record<string, unknown>;
  const done: string[] = [];
  if (q.locationLinkStatus) done.push('the location link has been dealt with');
  if (q.uploadLinkStatus) done.push('the upload link has been dealt with');
  if (q.advisorCallbackStatus) done.push('a repair advisor callback is already booked — do not offer it again, and do not re-collect their details');
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

/** Field names the model will not recognise, spelled as questions. */
const MISSING_FIELD_PROMPTS: Record<string, string> = {
  caller_name: 'their name',
  caller_first_name: 'their first name',
  caller_last_name: 'their last name',
  caller_email: 'an email address for the advisor to send the estimate to',
  project_description: 'what they actually want done, in their own words',
  project_type: 'what kind of project it is',
  vehicle_year_make_model: 'the year, make and model — ask for it as one question, not three',
  payment_path: 'whether we are billing insurance or setting the tow up as self-pay',
  insurance_carrier: 'which insurance company',
  claim_or_policy_number: 'the claim number, or the policy number if no claim is open yet — either is fine',
  payment_responsibility_acknowledged: 'their agreement that on self-pay the towing charge is theirs',
  tow_cost_disclosed: 'a plain word on how the towing charge is handled, before the truck goes',
  key_handoff_plan: 'where they will leave the key at the vehicle',
  callback_phone: 'a callback number',
  callback_phone_confirmed: 'confirmation that the number you have is the right one to call',
  incident_location: 'where it happened',
  pickup_location: 'where the vehicle is',
};

/**
 * Tools that were refused, rendered as the next thing to ask.
 *
 * A tool result saying "get their name first" is read once and then
 * competes with everything else in the context. Restating the block as
 * standing state is what stops the model reaching for the same closed
 * tool on the next turn — which is exactly what the tow flow did, four
 * times in one call.
 */
export function renderToolBlocks(session: Session): string | null {
  const blocks = session.toolBlocks?.filter((b) => b.missing.length > 0) ?? [];
  if (blocks.length === 0) return null;

  const lines = blocks.map((b) => {
    const needs = b.missing.map((m) => MISSING_FIELD_PROMPTS[m] ?? m.replace(/_/g, ' ')).join(' and ');
    const closed = b.attempts >= 2
      ? ` You have tried it ${b.attempts} times. Do NOT call it again until you have this.`
      : '';
    return `- ${b.tool} is BLOCKED. It needs ${needs}. Ask for that in your own words, then try again once.${closed}`;
  });

  return [
    'BLOCKED ACTIONS (internal — never read aloud):',
    ...lines,
    'Asking for what is missing IS the next step. Do not apologise for it and do not explain the system.',
  ].join('\n');
}
