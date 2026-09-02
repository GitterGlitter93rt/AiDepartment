// What the collision demo shop actually is, as configuration.
//
// A body shop takes two completely different kinds of call. One is a
// crash: people, location, tow, claim. The other is ordinary shop
// business — rates, custom paint, a restoration, "can you match my
// colour". The second kind was being answered with "is the car still
// drivable?", which is the sound of a receptionist who has not
// listened.
//
// These facts are stable, so they live here rather than in prose
// inside a specialist prompt. They reach the model only through
// knowledge entries that match what the caller asked, which is what
// keeps an ordinary turn small. A real client replaces this object;
// nothing else changes.

/** Hourly labour, in whole dollars. */
export interface LaborRates {
  body: number;
  paint: number;
  mechanical: number;
}

export interface ShopCapabilities {
  insuranceRepairs: boolean;
  customWork: boolean;
  fullRestoration: boolean;
  colorMatching: boolean;
  /** Mechanical work arising from a collision — suspension, alignment. */
  collisionMechanical: boolean;
  /** Unrelated engine/transmission work. Off unless a client says so. */
  generalMechanical: boolean;
}

export interface CollisionShopProfile {
  laborRates: LaborRates;
  capabilities: ShopCapabilities;
}

export const COLLISION_DEMO_SHOP: CollisionShopProfile = {
  laborRates: { body: 125, paint: 125, mechanical: 165 },
  capabilities: {
    insuranceRepairs: true,
    customWork: true,
    fullRestoration: true,
    colorMatching: true,
    collisionMechanical: true,
    // Deliberately false. The shop is a collision centre; implying it
    // will rebuild a gearbox is the kind of claim that produces an
    // angry caller and a wasted advisor callback.
    generalMechanical: false,
  },
};

/** Whole dollars, spoken. 125 -> "one hundred twenty-five dollars". */
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/**
 * A dollar amount as words.
 *
 * Same reasoning as phone numbers: handing "$125" to a TTS engine
 * leaves it to decide between "one twenty-five" and "one hundred and
 * twenty-five dollars", and on a price the shop is quoting that is not
 * a decision to delegate.
 */
export function speakDollars(amount: number): string {
  const n = Math.round(amount);
  // Outside the range this is built for, say nothing rather than
  // something wrong — a mangled price is worse than a digit.
  if (!Number.isFinite(n) || n < 0 || n > 99_999) return String(amount);
  const words: string[] = [];
  const thousands = Math.floor(n / 1000);
  if (thousands > 0) {
    words.push(`${under1000(thousands)} thousand`);
  }
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(`${ONES[hundreds]} hundred`);
  if (rest >= 20) {
    const t = TENS[Math.floor(rest / 10)];
    const o = ONES[rest % 10];
    words.push(o ? `${t}-${o}` : t);
  } else if (rest >= 10) {
    words.push(TEENS[rest - 10]);
  } else if (rest > 0) {
    words.push(ONES[rest]);
  }
  if (words.length === 0) words.push('zero');
  return `${words.join(' ')} dollars`;
}

/** The 1-999 part, without the "dollars". */
function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(`${ONES[h]} hundred`);
  if (rest >= 20) {
    const t = TENS[Math.floor(rest / 10)];
    const o = ONES[rest % 10];
    parts.push(o ? `${t}-${o}` : t);
  } else if (rest >= 10) {
    parts.push(TEENS[rest - 10]);
  } else if (rest > 0) {
    parts.push(ONES[rest]);
  }
  return parts.join(' ');
}

/**
 * The labour rates, said the way a service advisor says them.
 *
 * Body and paint are quoted together because they are the same number
 * and reading them separately sounds like a price list.
 */
export function speakLaborRates(rates: LaborRates = COLLISION_DEMO_SHOP.laborRates): string {
  const bodyPaint = rates.body === rates.paint
    ? `Our body and paint labor rates are ${speakDollars(rates.body)} an hour`
    : `Body labor is ${speakDollars(rates.body)} an hour, paint is ${speakDollars(rates.paint)} an hour`;
  return `${bodyPaint}, and mechanical labor is ${speakDollars(rates.mechanical)} an hour.`;
}
