// The Your AI Department sales layer that sits around the role-play.
//
// The demo line is itself a lead funnel: somebody impressed by the
// simulation should be able to become a booked discovery call without
// hanging up. But the simulation has to finish first — nobody wants a
// pitch in the middle of pretending their kitchen is flooding.
//
// The hard problem this module solves is telling two things apart that
// use identical vocabulary:
//
//   ROLE-PLAY   "My toilet is overflowing."
//   PROSPECT    "I own a plumbing company and I want this."
//
// Both mention plumbing. One is a customer to simulate, the other is a
// business owner to sell to, and routing the second into a plumbing
// simulation would be the single most embarrassing failure this line
// could have.
//
// None of this exists in CLIENT mode. A real collision shop's caller
// must never be offered a discovery call with us.

/** What the caller is doing right now. */
export type DemoPhase = 'role_play' | 'yad_sales';

export interface SalesIntent {
  detected: boolean;
  /** Why, for logging and for the prompt. */
  signals: string[];
  /** True when they never role-played at all — straight to business. */
  immediate: boolean;
}

/**
 * Unmistakable prospect language.
 *
 * Every one of these is about the SYSTEM or about the caller's own
 * business — never about a problem a customer would have.
 */
const SALES_SIGNALS: { pattern: RegExp; label: string }[] = [
  // Wanting it.
  { pattern: /\b(how (do|can) i get|how would i get|i want|i'?d like|we want|we need|interested in)\b[^.]{0,30}\b(this|that|it|one of these|something like this|your (ai|service|system))\b/i, label: 'wants_it' },
  { pattern: /\bcan you (build|make|set ?up|do)\b[^.]{0,25}\b(this|that|one|something)\b[^.]{0,20}\b(for me|for my|for us)\b/i, label: 'wants_build' },
  { pattern: /\bsomething like this for (my|our)\b/i, label: 'wants_it' },
  { pattern: /\bset (this|that|it) up\b/i, label: 'wants_setup' },

  // Owning a business — the key discriminator against role-play.
  { pattern: /\bi (own|run|have|manage)\b[^.]{0,25}\b(a|an|my|our|the)\b[^.]{0,35}\b(company|business|shop|firm|practice|agency|dealership|office|contractor)\b/i, label: 'business_owner' },
  { pattern: /\bmy (company|business|shop|firm|practice|agency|team|guys|office)\b/i, label: 'business_owner' },
  { pattern: /\bwe'?re a\b[^.]{0,30}\b(company|business|shop|firm|contractor)\b/i, label: 'business_owner' },

  // Commercial questions about us.
  { pattern: /\bhow much (does|would|is)\b[^.]{0,35}\b(this|that|it|something like this|your (service|system|ai))\b[^.]{0,20}\b(cost|run|be)\b/i, label: 'pricing_question' },
  { pattern: /\bwhat (does|would) (this|that|it) cost\b/i, label: 'pricing_question' },
  { pattern: /\b(who|how) do i (talk to|contact|reach)\b[^.]{0,30}\b(about|to)\b[^.]{0,25}\b(this|setting|getting)\b/i, label: 'wants_contact' },
  { pattern: /\bcan (someone|somebody) call me\b/i, label: 'wants_contact' },
  { pattern: /\b(learn|hear|find out) more\b[^.]{0,25}\b(about (this|your|the (ai|service|system)))\b/i, label: 'wants_info' },
  { pattern: /\b(work with|integrate with|connect to)\b[^.]{0,25}\bmy (company|business|crm|system|software)\b/i, label: 'integration_question' },
  { pattern: /\bwould (this|that|it) work (for|with) (my|our)\b/i, label: 'fit_question' },

  // Explicitly about us.
  { pattern: /\byour ai department\b/i, label: 'names_us' },
  { pattern: /\b(discovery call|talk to (your|the) team|speak to (someone|a person) about (this|the service))\b/i, label: 'wants_meeting' },
];

/**
 * Praise. Real, but weak on its own.
 *
 * "This is great" is a compliment, not a buying signal, and treating it
 * as one turns an enthusiastic tester into someone being sold at
 * mid-scenario. It counts only alongside something concrete.
 */
const PRAISE: RegExp[] = [
  /\b(this|that|it)(?:'s| is| was)\s+(really |pretty |very |so )?(good|great|impressive|amazing|cool|awesome|slick|wild|incredible|nice)\b/i,
  /\bi (like|love) (this|that|it)\b/i,
  /\b(wow|holy|damn|impressive)\b/i,
  /\bblown away\b/i,
];

/**
 * Things that look like prospect language but are the caller still
 * inside the simulation.
 *
 * "I own a rental property and the roof is leaking" is a customer, not
 * a prospect. The tell is that a problem follows the ownership.
 */
const STILL_ROLE_PLAYING: RegExp[] = [
  /\b(leak\w*|broke\w*|flood\w*|not work\w*|emergency|damage\w*|accident|crash|hurt|injur\w*|overflow\w*|clog\w*)\b/i,
  /\bneed (someone|somebody|a tech|a plumber|an electrician|help) (out|to come)\b/i,
  /\bcan you (come|send someone|get someone) out\b/i,
];

export function detectSalesIntent(utterance: string, hasRolePlayed: boolean): SalesIntent {
  const signals: string[] = [];
  for (const { pattern, label } of SALES_SIGNALS) {
    if (pattern.test(utterance) && !signals.includes(label)) signals.push(label);
  }

  const praised = PRAISE.some((re) => re.test(utterance));
  const problemFollows = STILL_ROLE_PLAYING.some((re) => re.test(utterance));

  // Owning a business AND describing a problem is a customer who
  // happens to own something. Ownership alone is not enough.
  const onlyOwnership = signals.length === 1 && signals[0] === 'business_owner';
  if (onlyOwnership && problemFollows) {
    return { detected: false, signals: [], immediate: false };
  }

  // Praise counts once something concrete is also present, or once the
  // caller has actually been through a scenario worth praising.
  if (praised && (signals.length > 0 || hasRolePlayed)) signals.push('praise');

  return {
    detected: signals.length > 0 && !(signals.length === 1 && signals[0] === 'praise' && !hasRolePlayed),
    signals,
    immediate: signals.length > 0 && !hasRolePlayed,
  };
}

/** Declining the offer, so it is never made twice. */
const DECLINE: RegExp[] = [
  /\b(no thanks|no thank you|not right now|not interested|maybe later|i'?m good|just (testing|looking|checking)|just wanted to (see|try|test))\b/i,
  /\bnot (today|at the moment)\b/i,
  /\bjust (playing|messing) (around|with it)\b/i,
];

export function isDecliningOffer(utterance: string): boolean {
  return DECLINE.some((re) => re.test(utterance));
}

/**
 * The demo-host section of the prompt.
 *
 * Appears only in demo mode. Its job is to make the agent good at ONE
 * transition — out of character, into a real conversation about the
 * caller's business — and to stop it selling before that moment.
 */
export interface DemoHostContext {
  hasRolePlayed: boolean;
  scenarioTested: string | null;
  ctaOffered: boolean;
  ctaDeclined: boolean;
  calendarMode: 'mock' | 'google';
}

export function renderDemoHost(phase: DemoPhase, opts: DemoHostContext): string {
  const { scenarioTested, calendarMode } = opts;
  if (phase === 'yad_sales') {
    return [
      'YOU ARE NOW SPEAKING AS YOUR AI DEPARTMENT — THE ROLE-PLAY IS OVER',
      'The caller has stopped testing and started asking about the product. Step out of character explicitly so they know the simulation has ended: "Let me step out of the demo for a second so I can get your actual details."',
      '',
      'THEIR REAL DETAILS ARE NOT THE ONES IN THE SIMULATION',
      'Anything they gave you while role-playing — a name, an address, a vehicle, an insurance carrier — was made up for the demo. Do NOT reuse it. Ask fresh for their real name and company.',
      'The exception is the number they are calling from, which is genuinely theirs. Confirm it rather than making them read it out: "Is the number you\'re calling from the best one for us?"',
      '',
      'WHAT TO CAPTURE — conversationally, not as a form',
      'Needed: their name, company name, email for the invite, and a callback number.',
      'Worth having if it comes up naturally: their industry, roughly how big the company is, what they actually want AI to fix, which part of the demo caught their attention, what CRM they run, whether they miss calls after hours, whether they run paid ads.',
      'Ask a couple at a time, not a list. "What\'s the company name?" then "And the best email for the calendar invite?" is the right rhythm.',
      'Record it with capture_prospect as you go. That tool is for the REAL business — capture_details is for the simulation and must not be used here.',
      '',
      'BOOKING',
      scenarioTested
        ? `They tested the ${scenarioTested.replace(/_/g, ' ')} scenario. Mention it naturally when you book — the team will have the notes, so they will not have to explain it twice.`
        : 'Ask what prompted the call, so the team has context.',
      'Use check_availability, offer the real slots that come back, then book_discovery_call. Never invent a time.',
      calendarMode === 'mock'
        ? 'The calendar is NOT connected. You may say the system books this automatically — you may NOT say they are booked, or name a time as confirmed.'
        : 'The calendar is live. Once book_discovery_call succeeds you may confirm the time and say the invite is on its way.',
      '',
      'TONE',
      'They have already been sold by the demo. You are handling logistics, not persuading. Do not pitch, do not list features, do not oversell. If they go quiet on it, let it go.',
    ].join('\n');
  }

  // Role-play phase.
  const lines = [
    'THIS IS THE YOUR AI DEPARTMENT DEMO LINE',
    'The caller is a business owner or a salesperson trying the system out. They are pretending to be a customer, and they know it. Play the scenario properly and completely — the demonstration IS the sales pitch, so the best thing you can do is handle their scenario well.',
    '',
    'DO NOT SELL DURING THE SCENARIO',
    'No mention of Your AI Department, no pitching, no asking about their business while they are testing. Someone role-playing a flooded kitchen does not want to be asked what CRM they use.',
  ];

  if (opts.hasRolePlayed && !opts.ctaOffered && !opts.ctaDeclined) {
    lines.push(
      '',
      'AT THE END OF THE SCENARIO — ONE OFFER, ONCE',
      'When the scenario reaches a natural finish, you may step out of it briefly and make a single soft offer: "That\'s the demo. If you\'d like, I can book you a discovery call with our team to look at what we\'d build for your business."',
      'Once. If they decline, say something gracious and close the call. Never ask a second time.',
    );
  }
  if (opts.ctaDeclined) {
    lines.push(
      '',
      'THEY HAVE ALREADY DECLINED',
      'Do not raise it again. Thank them for trying the demo and close warmly.',
    );
  }

  return lines.join('\n');
}
