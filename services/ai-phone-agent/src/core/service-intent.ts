// What the caller is asking us to DO.
//
// Accident vocabulary is not an industry. "Rear-ended", "wreck",
// "crash" and "accident" appear in a body-shop call and an injury
// call in exactly the same words, and the thing that separates them
// is the service being asked for: a tow and a repair on one side, a
// lawyer and an injury on the other.
//
// This exists because a live call routed to a personal injury firm and
// then told a caller who wanted a tow that they had rung the wrong
// number. The industry score had won on "rear-ended" alone, the route
// locked, and a later "I need a tow" scored 0.78 — under the 0.85
// needed to switch — so the law firm persona defended itself.
//
// A stated service request is not a score. It is the caller telling
// us, in words, which business they want, and it outranks everything.

export type ServiceIntent = 'vehicle_repair' | 'legal_injury';

export interface ServiceSignal {
  intent: ServiceIntent;
  industry: 'collision_repair' | 'attorneys';
  /** The phrase that decided it, for logs and for tests. */
  matched: string;
}

/**
 * "Deal with my vehicle."
 *
 * Every one of these is a request for a physical service on a car.
 * None of them is ambiguous about which business is wanted.
 */
const VEHICLE_SERVICE: RegExp[] = [
  /\bneed(s|ed)? (a |the )?tow\w*/i,
  /\btow (truck|my|the|it)\b/i,
  /\bwrecker\b/i,
  /\bflat ?bed\b/i,
  /\bneed(s|ed)? .{0,20}\b(car|truck|vehicle|suv|van|bumper|fender|door|panel|hood)\b.{0,20}\b(fixed|repaired|towed)\b/i,
  /\b(fix|repair)\w*\b.{0,20}\bmy (car|truck|vehicle|bumper|fender|door|panel|hood)\b/i,
  /\bbody ?shop\b/i,
  /\bcollision (shop|cent(er|re)|repair)\b/i,
  /\bneed(s|ed)? (an? )?(damage )?estimate\b/i,
  /\b(car|truck|vehicle) (wo|will)n'?t (move|drive|start)\b/i,
  /\bstranded\b/i,
  /\bget (my|the) (car|truck|vehicle) (fixed|repaired|towed|in)\b/i,
  /\binsurance repair\b/i,
  // "Help with my insurance claim for the repair" is a body-shop call:
  // the claim is the funding, the repair is the service.
  /\bclaim\b.{0,25}\b(for|to)\b.{0,15}\b(the |my )?repairs?\b/i,
  /\brepairs?\b.{0,20}\b(claim|estimate)\b/i,
  /\bhelp with\b.{0,30}\brepairs?\b/i,
];

/**
 * "Deal with my injury, or represent me."
 *
 * Deliberately demanding. Being in an accident is not this; being hurt
 * by one, or wanting a lawyer about one, is.
 */
const LEGAL_INJURY_SERVICE: RegExp[] = [
  /\b(need|want|looking for|talk to|speak (to|with)|get) (a |an )?(lawyer|attorney|law firm|legal (help|advice|representation))\b/i,
  /\blegal representation\b/i,
  /\b(my|the) (neck|back|shoulder|knee|head|arm|leg|hip|wrist)\b.{0,25}\b(hurt\w*|sore|pain\w*|killing|injur\w*|stiff)\b/i,
  /\bi(?:'m| am)? ?(badly )?(hurt|injured)\b/i,
  /\b(went|going|taken) to (the )?(hospital|er\b|emergency room|urgent care)\b/i,
  /\bmedical bills?\b/i,
  /\binjury claim\b/i,
  /\bsettlement\b/i,
  /\bsue\b|\blawsuit\b/i,
  /\bpain and suffering\b/i,
  /\bwhiplash\b/i,
];

function firstMatch(res: RegExp[], said: string): string | null {
  for (const re of res) {
    const m = said.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Every service the caller has actually asked for, in the order the
 * phrases appear in what they said.
 *
 * Order matters for the mixed case: someone who leads with the vehicle
 * and mentions their neck second has told us which they came for.
 */
export function detectServiceIntents(said: string): ServiceSignal[] {
  const vehicle = firstMatch(VEHICLE_SERVICE, said);
  const legal = firstMatch(LEGAL_INJURY_SERVICE, said);

  const found: ServiceSignal[] = [];
  if (vehicle) found.push({ intent: 'vehicle_repair', industry: 'collision_repair', matched: vehicle });
  if (legal) found.push({ intent: 'legal_injury', industry: 'attorneys', matched: legal });

  // Sorted by where the caller said it, not by our preference.
  return found.sort((a, b) => said.toLowerCase().indexOf(a.matched.toLowerCase()) - said.toLowerCase().indexOf(b.matched.toLowerCase()));
}

/**
 * The single service being asked for, or null when it is genuinely
 * both or genuinely neither.
 *
 * Null is a real answer and means "ask them", not "guess".
 */
export function decisiveServiceIntent(said: string): ServiceSignal | null {
  const found = detectServiceIntents(said);
  return found.length === 1 ? found[0] : null;
}

/** Both a vehicle and an injury request in the same breath. */
export function isMixedServiceIntent(said: string): boolean {
  return detectServiceIntents(said).length > 1;
}

/**
 * Accident words with no service attached.
 *
 * "I was rear-ended" tells us something happened and nothing about
 * what they want. Guessing an industry from it is what started this.
 */
export function isBareAccidentMention(said: string): boolean {
  const accident = /\b(rear[- ]?ended|t[- ]?boned|accident|crash\w*|wreck\w*|collision|sideswiped|hit by)\b/i.test(said);
  return accident && detectServiceIntents(said).length === 0;
}

/** One short question that settles it, for a mixed or bare mention. */
export const SERVICE_CLARIFIER =
  'Absolutely — do you want help with the vehicle first, or the injury side first?';

export const BARE_ACCIDENT_CLARIFIER =
  "Sorry you're dealing with that. Are you looking to get the vehicle taken care of, or is this about an injury?";
