import { normalizeHostname, registrableDomain } from '../domain/normalize.js';

/**
 * The company, as its own site describes it.
 *
 * Everything a rep reads in the first ten seconds: what they do, where, when, and how
 * to reach them. All of it comes from the company's own pages, which makes it the
 * strongest available evidence of what a business *claims* and the weakest of whether
 * the claim is true -- so it is recorded as an observation the rep can quote back,
 * never as an independently verified fact.
 */

export interface ProfileObservation {
  claimKey: string;
  claimText: string;
  normalizedValue: string | null;
  sourceReference: string;
  /** How long this stays believable before it should be re-read. */
  ttlDays: number;
}

export interface SocialProfile {
  network: string;
  url: string;
  sourceReference: string;
}

/**
 * Social networks, matched on the profile URL only.
 *
 * Attribution comes from the company linking to it from its own site. Searching a
 * platform for the business name and taking the first result is how you attach
 * somebody else's Facebook page to a prospect, so that is not done anywhere here.
 */
const SOCIAL_NETWORKS: { network: string; pattern: RegExp }[] = [
  { network: 'facebook', pattern: /^https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/[^/?#]+/i },
  { network: 'instagram', pattern: /^https?:\/\/(?:www\.)?instagram\.com\/[^/?#]+/i },
  { network: 'linkedin', pattern: /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[^/?#]+/i },
  { network: 'youtube', pattern: /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[^/?#]+/i },
  { network: 'x', pattern: /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/?#]+/i },
  { network: 'tiktok', pattern: /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/?#]+/i },
];

/** Paths that are the platform itself rather than a company profile. */
const SOCIAL_NON_PROFILES = /\/(?:sharer|share|intent|plugins|tr\?|login|privacy|policies)/i;

export function extractSocialProfiles(html: string, sourceReference: string): SocialProfile[] {
  const found = new Map<string, SocialProfile>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1]!.trim();
    if (SOCIAL_NON_PROFILES.test(url)) continue;
    for (const { network, pattern: networkPattern } of SOCIAL_NETWORKS) {
      if (!networkPattern.test(url)) continue;
      if (!found.has(network)) found.set(network, { network, url, sourceReference });
      break;
    }
  }
  return [...found.values()];
}

/**
 * Structured contact routes a rep can actually use.
 *
 * A booking URL and a quote form are different things to a rep -- one is an
 * appointment, the other is a lead form somebody has to answer -- so they are
 * recorded separately rather than as "has a form".
 */
export interface ContactRoute {
  kind: 'contact_form' | 'booking' | 'quote' | 'careers' | 'financing' | 'payment_portal'
    | 'customer_portal' | 'reviews';
  url: string;
  sourceReference: string;
}

const ROUTE_PATTERNS: { kind: ContactRoute['kind']; pattern: RegExp }[] = [
  { kind: 'booking', pattern: /\/(?:book|booking|schedule|appointments?|book-online|schedule-service)\b/i },
  { kind: 'quote', pattern: /\/(?:quote|estimate|request-(?:a-)?(?:quote|estimate)|free-estimate|get-a-quote)\b/i },
  { kind: 'contact_form', pattern: /\/(?:contact|contact-us|get-in-touch|request-service)\b/i },
  { kind: 'careers', pattern: /\/(?:careers?|jobs?|join-(?:our-)?team|employment|were-hiring)\b/i },
  { kind: 'financing', pattern: /\/(?:financing|finance|payment-plans?|apply-for-financing)\b/i },
  { kind: 'payment_portal', pattern: /\/(?:pay(?:-?online|-?bill|ments?)?)\b/i },
  { kind: 'customer_portal', pattern: /\/(?:my-?account|customer-portal|client-portal|portal)\b/i },
  { kind: 'reviews', pattern: /\/(?:reviews?|testimonials?)\b/i },
];

export function extractContactRoutes(
  html: string, origin: string, sourceReference: string,
): ContactRoute[] {
  const found = new Map<string, ContactRoute>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    let url: URL;
    try {
      url = new URL(match[1]!.trim(), origin);
    } catch { continue; }
    // Only the company's own pages. A link to a directory's "get a quote" page is
    // that directory's route, not this company's.
    const host = normalizeHostname(url.hostname);
    const originHost = normalizeHostname(new URL(origin).hostname);
    if (!host || !originHost || registrableDomain(host) !== registrableDomain(originHost)) {
      continue;
    }
    for (const { kind, pattern: routePattern } of ROUTE_PATTERNS) {
      if (!routePattern.test(url.pathname)) continue;
      if (!found.has(kind)) {
        found.set(kind, { kind, url: url.toString(), sourceReference });
      }
      break;
    }
  }
  return [...found.values()];
}

/**
 * Facts a company states about itself in words.
 *
 * Each of these needs a deliberate phrase, not an incidental word. "Family owned and
 * operated" is a claim a business chooses to make; the word "family" on a page about
 * family bathrooms is not.
 */
const PROFILE_CLAIMS: {
  claimKey: string; ttlDays: number; patterns: RegExp[]; describe: (match: string) => string;
}[] = [
  {
    claimKey: 'year_founded',
    ttlDays: 3650,
    patterns: [
      /\b(?:serving|proudly serving)[^.]{0,40}\bsince\s+((?:18|19|20)\d{2})\b/i,
      /\b(?:established|founded|in business)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i,
      /\bsince\s+((?:18|19|20)\d{2})\b/i,
    ],
    describe: (value) => `States it has been in business since ${value}.`,
  },
  {
    claimKey: 'years_in_business',
    ttlDays: 365,
    patterns: [
      /\b(?:over|more than)\s+(\d{1,3})\+?\s+years?\s+(?:of\s+)?(?:experience|in business|serving)/i,
      /\b(\d{1,3})\+?\s+years?\s+(?:of\s+)?(?:experience|in business)/i,
    ],
    describe: (value) => `States ${value}+ years in business.`,
  },
  {
    claimKey: 'family_owned',
    ttlDays: 3650,
    patterns: [/\bfamily[- ]owned(?:\s+and\s+operated)?\b/i, /\bfamily run\b/i],
    describe: () => 'Describes itself as family owned.',
  },
  {
    claimKey: 'locally_owned',
    ttlDays: 3650,
    patterns: [/\blocally[- ]owned(?:\s+and\s+operated)?\b/i, /\blocally operated\b/i],
    describe: () => 'Describes itself as locally owned.',
  },
  {
    claimKey: 'franchise_affiliation',
    ttlDays: 3650,
    patterns: [
      /\bindependently owned and operated franchise\b/i,
      /\beach franchise is independently\b/i, /\bfranchise opportunit/i,
    ],
    describe: () => 'Presents itself as a franchise location.',
  },
  {
    claimKey: 'licensed_and_insured_claim',
    ttlDays: 365,
    patterns: [/\blicensed\s*(?:,|and|&)\s*insured\b/i, /\blicensed\s*(?:,|&|and)\s*bonded\b/i],
    describe: () => 'States it is licensed and insured. A claim on its own site, not a '
      + 'verification — the licence registries are what verify it.',
  },
  {
    claimKey: 'spanish_language_service',
    ttlDays: 365,
    patterns: [
      // Both spellings, because sites write both: the tilde is dropped as often as
      // it is typed, and a detector that knows only one form misses half the market
      // it exists to find.
      /\bse habla espa(?:ñ|n)ol\b/i, /\bhablamos espa(?:ñ|n)ol\b/i,
      /\bspanish[- ]speaking (?:staff|technicians?|team)\b/i,
      /\bbiling(?:ual|üe) (?:staff|team|service)\b/i,
    ],
    describe: () => 'Advertises Spanish-language service.',
  },
  {
    claimKey: 'insurance_claim_assistance',
    ttlDays: 365,
    patterns: [
      /\bwe work with (?:all )?insurance\b/i, /\binsurance claims? (?:help|assistance|specialists?)\b/i,
      /\bwe(?:'ll| will) handle (?:your )?insurance claim\b/i,
    ],
    describe: () => 'Offers to help with insurance claims.',
  },
  {
    claimKey: 'membership_plan_offered',
    ttlDays: 365,
    patterns: [
      /\b(?:maintenance|service|membership|comfort|care) (?:plan|club|agreement)s?\b/i,
      /\bmonthly membership\b/i,
    ],
    describe: () => 'Sells a recurring maintenance or membership plan.',
  },
  {
    claimKey: 'promotions_offered',
    ttlDays: 90,
    patterns: [
      /\b(?:current\s+)?(?:specials?|promotions?|coupons?)\b/i,
      /\b\$\d{2,4}\s+off\b/i, /\b\d{1,2}%\s+off\b/i,
      /\blimited[- ]time offer\b/i,
    ],
    describe: () => 'Advertises coupons or promotional offers.',
  },
  {
    claimKey: 'referral_program',
    ttlDays: 365,
    patterns: [
      /\brefer(?:ral)?\s+(?:a\s+friend|program|bonus|reward)/i,
      /\brefer\s+(?:a|your)\s+(?:friend|neighbou?r)/i,
    ],
    describe: () => 'Runs a customer referral programme.',
  },
  {
    claimKey: 'license_number_displayed',
    ttlDays: 365,
    patterns: [
      /\b(?:license|lic\.?|licence)\s*(?:#|no\.?|number)\s*[:.]?\s*([A-Z]{0,6}[-\s]?\d{4,10})\b/i,
      /\b((?:CFC|CAC|CGC|CBC|EC|CMC|TACLA|TACLB)\s?\d{4,9})\b/,
    ],
    describe: (value) => `Displays licence number ${value.trim()} on its own site.`,
  },
];

export function extractProfileClaims(
  text: string, sourceReference: string,
): ProfileObservation[] {
  const observations: ProfileObservation[] = [];
  const seen = new Set<string>();

  for (const claim of PROFILE_CLAIMS) {
    for (const pattern of claim.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      if (seen.has(claim.claimKey)) break;
      seen.add(claim.claimKey);
      const captured = match[1] ?? match[0];
      observations.push({
        claimKey: claim.claimKey,
        claimText: claim.describe(captured),
        normalizedValue: match[1] ? match[1].trim() : 'yes',
        sourceReference,
        ttlDays: claim.ttlDays,
      });
      break;
    }
  }
  return observations;
}

/**
 * The service area, when the site states one.
 *
 * Kept deliberately separate from the physical address. A company that serves forty
 * ZIP codes is located in one of them, and conflating the two is how a read model
 * starts telling reps a business has an office in every town it drives to.
 */
export function extractServiceArea(
  text: string, sourceReference: string,
): ProfileObservation | null {
  const patterns = [
    /\b(?:proudly )?serving\s+([A-Z][A-Za-z .'-]{2,60}(?:,\s*[A-Z]{2})?(?:\s+and\s+(?:the\s+)?surrounding\s+areas?)?)/,
    /\bservice areas?\s*[:\-]\s*([A-Z][^.\n]{3,120})/i,
    /\bwe serve\s+([A-Z][A-Za-z .'-]{2,60})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const area = match[1].trim().replace(/\s+/g, ' ');
    return {
      claimKey: 'stated_service_area',
      claimText: `States it serves ${area}. A service area is where a company will `
        + 'travel, which is not the same as where it is located.',
      normalizedValue: area.slice(0, 200),
      sourceReference,
      ttlDays: 365,
    };
  }
  return null;
}

/** Opening hours, including the round-the-clock claim a rep can act on. */
export function extractHours(text: string, sourceReference: string): ProfileObservation | null {
  if (/\b(?:open )?24\s*(?:\/|-)\s*7\b/i.test(text) || /\b24 hours a day\b/i.test(text)) {
    return {
      claimKey: 'stated_hours',
      claimText: 'States round-the-clock availability.',
      normalizedValue: '24/7',
      sourceReference,
      ttlDays: 180,
    };
  }
  const match = /\b(mon(?:day)?)\s*(?:-|–|through|to)\s*(fri(?:day)?)\s*:?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i
    .exec(text);
  if (match) {
    const hours = `Mon-Fri ${match[3]}-${match[4]}`.replace(/\s+/g, ' ');
    return {
      claimKey: 'stated_hours',
      claimText: `States business hours of ${hours}.`,
      normalizedValue: hours,
      sourceReference,
      ttlDays: 180,
    };
  }
  return null;
}

/**
 * Phone routes that are worth telling a rep apart.
 *
 * A toll-free number and a local number are both "a phone number" to the data model
 * and different things on a call sheet: the toll-free line is usually the one that
 * reaches a call centre or an answering service, and the local one is usually the
 * office. A number a company explicitly invites you to text is different again, and
 * it is the strongest signal on a site that somebody is watching a messaging channel.
 */
export interface PhoneRoute {
  value: string;
  kind: 'toll_free' | 'sms_invited' | 'local';
  /** The sentence that made this a text line, when that is what it is. */
  evidence: string | null;
  sourceReference: string;
}

const TOLL_FREE_PREFIXES = new Set(['800', '888', '877', '866', '855', '844', '833']);

export function isTollFree(e164: string): boolean {
  const match = /^\+1(\d{3})/.exec(e164);
  return match ? TOLL_FREE_PREFIXES.has(match[1]!) : false;
}

/**
 * Numbers a company invites you to text.
 *
 * Requires the invitation, not the mere presence of a number near the word "text".
 * "Text us at 904-555-1212" is an invitation; "our text-only policy" beside a phone
 * number is not, and a rep told to text a landline looks careless.
 */
export function extractPhoneRoutes(
  text: string, normalizedPhones: string[], sourceReference: string,
): PhoneRoute[] {
  const routes: PhoneRoute[] = [];
  const invitations = [
    /\b(?:text|sms|message)\s+(?:us\s+)?(?:at\s+)?[:\-]?\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/gi,
    /\b(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\s*\((?:text|sms)\)/gi,
  ];

  const texted = new Set<string>();
  for (const pattern of invitations) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const digits = match[1]!.replace(/\D/g, '').replace(/^1/, '');
      if (digits.length === 10) texted.add(`+1${digits}`);
      if (texted.size > 0) {
        routes.push({
          value: `+1${digits}`, kind: 'sms_invited',
          evidence: match[0].trim().slice(0, 120), sourceReference,
        });
      }
    }
  }

  for (const phone of normalizedPhones) {
    if (texted.has(phone)) continue;
    routes.push({
      value: phone,
      kind: isTollFree(phone) ? 'toll_free' : 'local',
      evidence: null,
      sourceReference,
    });
  }
  return routes;
}

/**
 * Role-specific inboxes, so a rep writes to the right one.
 *
 * `sales@` and `service@` are both "an email address" and completely different
 * destinations: one reaches somebody whose job is to answer us, the other reaches a
 * dispatch queue that will treat us as a customer with a broken water heater.
 */
export function classifyRoleInbox(email: string): 'sales' | 'service' | 'billing'
  | 'careers' | 'general' | null {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (/^(sales|newbusiness|new\.business|estimates?|quotes?)$/.test(local)) return 'sales';
  if (/^(service|dispatch|support|schedule|scheduling|repairs?)$/.test(local)) return 'service';
  if (/^(billing|accounts?|ar|invoices?|accounting)$/.test(local)) return 'billing';
  if (/^(careers?|jobs?|hr|hiring|recruiting)$/.test(local)) return 'careers';
  if (/^(info|hello|contact|office|admin|mail)$/.test(local)) return 'general';
  return null;
}
