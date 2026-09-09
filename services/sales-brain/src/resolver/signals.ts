import { getVerticalProfile } from '../domain/verticals.js';

/**
 * What a company's own pages say about how it operates.
 *
 * Every vertical profile declares a set of `public_signal_rules`: the signals that
 * make a company worth calling, each with a claim key, the confidence it needs and
 * the score rule it feeds. Thirteen of them across the profiles, with prose
 * explaining why each matters and which conversation it opens.
 *
 * Nothing produced eleven of them. `contactResearch` reads the About, Contact and
 * Locations pages of a company's own website and records people and endpoints, and
 * called `recordEvidence` nowhere at all -- so emergency cover, online booking,
 * multiple locations, hiring, financing and membership plans could never be
 * observed, and the scoring model built to weigh them was reading a map with no
 * territory. A company could only ever score on the miner's ad sightings, against
 * tier bands calibrated as though the rest existed.
 *
 * This reads the pages we already fetched for those signals. Two rules govern it:
 *
 *  - the profile decides which signals matter, and this decides only whether the
 *    words are on the page. A profile that does not declare a signal never gets one,
 *    however clearly the site states it.
 *  - a phrase that is absent records nothing. Never a negative. "We looked at four
 *    pages and did not see it" is what the absence of evidence already means, and
 *    writing it down as a fact would turn a quiet page into a claim about a company.
 */

export interface SignalObservation {
  claimKey: string;
  category: string;
  /** The sentence the page actually contained, trimmed to something quotable. */
  claimText: string;
  /** Which page it was on. */
  sourceReference: string;
  /** How long this kind of observation stays current. */
  ttlHours: number;
}

interface Recogniser {
  category: string;
  ttlHours: number;
  /**
   * Phrases that mean the signal, as whole words. Deliberately explicit rather than
   * clever: a company that says "24/7" means it, and one that says "we care about
   * your comfort around the clock" is writing copy.
   */
  patterns: RegExp[];
  /** Extra evidence required before the phrase counts. */
  requiresAll?: RegExp[];
}

/**
 * How to see each declared signal in a company's own words.
 *
 * Keyed by the profile's `evidence_claim_key`, so a signal the profiles do not
 * declare cannot be recorded by accident, and a signal they declare but this cannot
 * see stays honestly unobserved rather than being guessed at.
 */
/**
 * Claim keys this module can write. Derived from the recognisers themselves rather
 * than listed a second time, because a second list is a list that drifts -- which is
 * how six declared signals came to have no writer at all.
 */
export function recognisedClaimKeys(): string[] { return Object.keys(RECOGNISERS); }

/** Claim keys produced from term lists the profiles themselves declare. */
export function profileTermClaimKeys(): string[] {
  return PROFILE_TERM_SIGNALS.map((entry) => entry.claimKey);
}

const RECOGNISERS: Record<string, Recogniser> = {
  emergency_24_7_service: {
    category: 'urgency',
    ttlHours: 24 * 30,
    patterns: [
      /\b24\s*\/\s*7\b/i, /\b24-7\b/i, /\btwenty-four seven\b/i,
      /\b24 hours a day\b/i, /\bemergency service\b/i, /\bemergency repairs?\b/i,
      /\bsame-day (?:service|repair)\b/i, /\bafter-hours (?:service|calls?)\b/i,
    ],
  },
  online_quote_booking: {
    category: 'intake',
    ttlHours: 24 * 14,
    patterns: [
      /\bbook (?:online|now|an appointment)\b/i, /\bschedule (?:online|service|now)\b/i,
      /\brequest (?:a )?(?:quote|estimate|appointment)\b/i,
      /\bget (?:a )?(?:free )?(?:quote|estimate)\b/i, /\bfree estimate\b/i,
      /\bonline booking\b/i,
    ],
  },
  multiple_locations: {
    category: 'operations',
    ttlHours: 24 * 30,
    patterns: [
      /\bour (?:locations|offices|branches)\b/i, /\b(?:two|three|four|five|six|\d+) locations\b/i,
      /\blocations? (?:in|across|throughout)\b/i, /\bserving .{0,40}\band\b .{0,40}\bcounties\b/i,
    ],
  },
  visible_growth_hiring: {
    category: 'growth',
    ttlHours: 24 * 14,
    patterns: [
      /\bwe(?:'re| are) hiring\b/i, /\bnow hiring\b/i, /\bjoin our team\b/i,
      /\bcareers?\b.{0,40}\bapply\b/i, /\bopen positions?\b/i,
    ],
  },
  financing_promoted: {
    category: 'economics',
    ttlHours: 24 * 30,
    patterns: [
      /\bfinancing available\b/i, /\bmonthly payments?\b/i, /\b0% (?:apr|interest)\b/i,
      /\bpayment plans?\b/i, /\bfinance your\b/i,
    ],
  },
  // --- vertical-specific signals the profiles declared and nothing recognised ----
  //
  // Each of these is on a canonical profile's signal list with a
  // `score_rule_reference`, so the scorer looks the claim key up and awards points
  // for it. No recogniser existed, so the signal that distinguishes a vertical from
  // every other vertical was the one signal it could never earn: a collision shop
  // advertising hail repair scored the same as one that does not mention it.
  //
  // Patterns follow the same rule as the ones above -- whole phrases a company
  // writes deliberately, not words that appear in ordinary copy.
  hail_repair_service: {
    // collision-repair: `signal_id: hail_service`, category `surge`, confirmed.
    category: 'surge',
    ttlHours: 24 * 30,
    patterns: [
      /\bhail (?:damage )?repair\b/i, /\bhail damage\b/i, /\bhail dent\b/i,
      /\bpaintless dent repair\b/i, /\bPDR\b/, /\bstorm damage repair\b/i,
    ],
  },
  high_value_plumbing_services: {
    // plumbing: `signal_id: high_value_drain_sewer_repipe`, confirmed. The signal id
    // names the services, so the patterns are those services and nothing wider.
    category: 'high_value_service',
    ttlHours: 24 * 30,
    patterns: [
      /\bsewer (?:line )?(?:repair|replacement|repipe)\b/i, /\bsewer line\b/i,
      /\bdrain (?:cleaning|clearing|repair)\b/i, /\bhydro ?jetting\b/i,
      /\brepipe\b/i, /\brepiping\b/i, /\btrenchless\b/i,
      /\bwater (?:line|main) (?:repair|replacement)\b/i,
    ],
  },
  open_house_listing_signal: {
    // real-estate-brokerages: `signal_id: open_house_or_listing_activity`, and the
    // profile asks only for `likely` -- a listings page shows activity, it does not
    // prove a workflow.
    category: 'pipeline',
    ttlHours: 24 * 7,
    patterns: [
      /\bopen house(?:s)?\b/i, /\bnew listing(?:s)?\b/i, /\bfeatured listing(?:s)?\b/i,
      /\bjust listed\b/i, /\bour listings\b/i, /\bhomes for sale\b/i,
    ],
  },
  field_sales_presence: {
    // pdr-hail: `signal_id: field_sales_signal`, `likely`. Somebody goes to the
    // customer, which is what puts leads on a personal device.
    category: 'sales_operations',
    ttlHours: 24 * 30,
    patterns: [
      /\bwe come to you\b/i, /\bmobile (?:service|repair|estimates?)\b/i,
      /\bon-?site estimates?\b/i, /\bat your (?:home|location|property)\b/i,
      /\bfree (?:in-home|on-?site) (?:estimate|inspection)\b/i,
      /\bcatastrophe team\b/i, /\bstorm (?:team|crew)\b/i,
    ],
  },
  membership_program: {
    category: 'economics',
    ttlHours: 24 * 30,
    patterns: [
      /\bmaintenance (?:plan|agreement|program)\b/i, /\bmembership (?:plan|program)\b/i,
      /\bservice (?:plan|club)\b/i, /\bannual (?:plan|agreement)\b/i,
    ],
  },
  // --- signals the profiles referenced and nothing could produce ----------------
  //
  // Each of these was a trigger naming a signal its own profile never declared, and
  // each is a fact a company states about itself on its own pages. The claim is
  // always what was seen -- not what it implies about how they operate.
  storm_hail_service_promoted: {
    // roofing: `storm_landing_page` and `hail_wind_offer`. The company half of what
    // `storm_hail_market_signal` used to conflate. Their words about their service,
    // not evidence that hail has fallen anywhere.
    category: 'surge',
    ttlHours: 24 * 30,
    patterns: [
      /\bstorm damage\b/i, /\bhail damage\b/i, /\bwind (?:and|&) hail\b/i,
      /\bstorm restoration\b/i, /\binsurance claim (?:help|assistance|specialists?)\b/i,
      /\bfree storm inspection\b/i, /\bhail inspection\b/i,
    ],
  },
  call_tracking_vendor_on_site: {
    // Five verticals trigger on `call_tracking_signal`. `CALL_TRACKING_NUMBER` is an
    // endpoint role nothing has ever set, so endpoint evidence cannot support this.
    // A named vendor on their own site can, and the claim stays that narrow.
    category: 'systems',
    ttlHours: 24 * 30,
    patterns: [
      /\bcallrail\b/i, /\bcalltrackingmetrics\b/i, /\bwhatconverts\b/i,
      /\bcallfire\b/i, /\binvoca\b/i, /\bcall tracking\b/i,
    ],
  },
  customer_status_updates_promoted: {
    // collision-repair: `customer_status_language`. A shop that promises updates has
    // a process to keep; one that does not has a gap worth asking about.
    category: 'customer_communication',
    ttlHours: 24 * 30,
    patterns: [
      /\btext (?:updates?|notifications?)\b/i, /\bstatus updates?\b/i,
      /\bkeep you (?:updated|informed|posted)\b/i, /\brepair (?:status|tracker|updates?)\b/i,
      /\bcustomer portal\b/i, /\btrack your (?:repair|claim|vehicle)\b/i,
    ],
  },
  ai_usage_promoted: {
    // law-firms: `explicit_ai_usage_signal`. A firm that advertises using AI is a
    // different conversation from one that has never mentioned it.
    category: 'systems',
    ttlHours: 24 * 30,
    patterns: [
      /\bai-?powered\b/i, /\bpowered by ai\b/i, /\bai-?assisted\b/i,
      /\bartificial intelligence\b/i, /\bmachine learning\b/i,
      /\bwe use ai\b/i, /\bai (?:intake|chat|assistant)\b/i,
    ],
  },
  ai_hiring_mentioned: {
    // law-firms: `ai_job_posting_signal`. Both halves must be on the same page, so a
    // marketing sentence about AI somewhere else on the site does not satisfy it --
    // and no job board is consulted, only their own careers page.
    category: 'growth',
    ttlHours: 24 * 14,
    patterns: [
      /\bartificial intelligence\b/i, /\bai\b/, /\bmachine learning\b/i,
      /\bautomation\b/i,
    ],
    requiresAll: [
      /\b(?:careers?|join our team|we\'re hiring|were hiring|now hiring|open (?:roles?|positions?))\b/i,
    ],
  },
  home_valuation_cta: {
    // real-estate-brokerages: `home_value_CTA`. A seller-side capture route, which is
    // what the seller_follow_up hypothesis is about.
    category: 'pipeline',
    ttlHours: 24 * 14,
    patterns: [
      /\bwhat(?:'|\u2019)?s my home worth\b/i, /\bhome valuation\b/i,
      /\bhome value (?:estimate|report|tool)\b/i, /\bfree home (?:value|valuation)\b/i,
      /\bwhat is my (?:home|house) worth\b/i,
    ],
  },

};


/**
 * Signals whose words the vertical profile supplies, not this file.
 *
 * `derived_signals` in a profile holds term lists an author wrote for exactly this
 * purpose -- hvac's `replacement_service_focus_from_website_terms`, and the
 * `crm_frontend_signal_examples` several trades share -- and nothing read them. A
 * recogniser whose phrases live in the profile is the right shape for these: the
 * trade knows its own vocabulary better than this file does, and a new term is then
 * an authoring change rather than a code change.
 *
 * Matched as whole words so `installation` does not fire on `installations` being
 * absent, and so a product name is a name rather than a substring.
 */
const PROFILE_TERM_SIGNALS: {
  claimKey: string; category: string; ttlHours: number; section: string;
}[] = [
  {
    claimKey: 'replacement_service_focus',
    category: 'high_value_service',
    ttlHours: 24 * 30,
    section: 'replacement_service_focus_from_website_terms',
  },
  {
    claimKey: 'crm_frontend_on_site',
    category: 'systems',
    ttlHours: 24 * 30,
    section: 'crm_frontend_signal_examples',
  },
];

function profileTermsFor(
  definition: Record<string, unknown> | null, section: string,
): string[] {
  const derived = definition?.['derived_signals'] as Record<string, unknown> | undefined;
  const listed = derived?.[section];
  if (!Array.isArray(listed)) return [];
  return listed
    .map((term) => String(term).trim())
    .filter((term) => term.length >= 3);
}

/** A term the profile wrote, as a whole-word pattern. */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/** The signals this vertical says it cares about, and that we can read from a page. */
export async function readableSignalsFor(
  verticalProfileId: string | null,
): Promise<{ claimKey: string; category: string; ttlHours: number }[]> {
  if (!verticalProfileId) return [];
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  const rules = definition?.['public_signal_rules'];
  const declared = (Array.isArray(rules) ? rules : [])
    .map((rule) => (rule as Record<string, unknown>)['evidence_claim_key'])
    .filter((key): key is string => typeof key === 'string');

  const readable = declared
    .filter((key) => RECOGNISERS[key])
    .map((key) => ({
      claimKey: key,
      category: RECOGNISERS[key]!.category,
      ttlHours: RECOGNISERS[key]!.ttlHours,
    }));

  // And the ones whose words the profile supplies. Included only when the profile
  // actually declares terms: an empty list is a vertical that has not written any,
  // and reading nothing is better than reading somebody else's.
  for (const signal of PROFILE_TERM_SIGNALS) {
    if (!declared.includes(signal.claimKey)) continue;
    if (profileTermsFor(definition, signal.section).length === 0) continue;
    readable.push({
      claimKey: signal.claimKey, category: signal.category, ttlHours: signal.ttlHours,
    });
  }

  return readable;
}

/**
 * The signals a company's own pages state, in the company's own words.
 *
 * `pages` is the text already fetched by the crawl, keyed by URL. Nothing here
 * fetches anything: a signal read from a page we did not visit would have no
 * provenance to show a rep.
 */
export async function extractFirstPartySignals(input: {
  verticalProfileId: string | null;
  pages: { url: string; text: string }[];
}): Promise<SignalObservation[]> {
  const wanted = await readableSignalsFor(input.verticalProfileId);
  if (wanted.length === 0) return [];

  const definition = input.verticalProfileId
    ? await getVerticalProfile(input.verticalProfileId) as Record<string, unknown> | null
    : null;
  const found = new Map<string, SignalObservation>();

  for (const signal of wanted) {
    // A recogniser from this file, or one whose phrases the profile wrote. Built the
    // same way either way, so both produce the same evidence with the same
    // provenance -- the company's own sentence, and the page it was on.
    const profileTerms = PROFILE_TERM_SIGNALS
      .find((entry) => entry.claimKey === signal.claimKey);
    const recogniser: Recogniser = profileTerms
      ? {
        category: profileTerms.category,
        ttlHours: profileTerms.ttlHours,
        patterns: profileTermsFor(definition, profileTerms.section).map(termPattern),
      }
      : RECOGNISERS[signal.claimKey]!;
    for (const page of input.pages) {
      if (found.has(signal.claimKey)) break;
      for (const pattern of recogniser.patterns) {
        const match = pattern.exec(page.text);
        if (!match) continue;
        if (recogniser.requiresAll
          && !recogniser.requiresAll.every((extra) => extra.test(page.text))) continue;

        found.set(signal.claimKey, {
          claimKey: signal.claimKey,
          category: signal.category,
          // The sentence around the phrase, so a rep quotes the company rather than
          // our summary of it.
          claimText: quotableAround(page.text, match.index, match[0].length),
          sourceReference: page.url,
          ttlHours: signal.ttlHours,
        });
        break;
      }
    }
  }

  return [...found.values()];
}

/** The phrase in enough of its sentence to be worth reading, and no more. */
function quotableAround(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1);
  const lineEnd = text.indexOf('\n', index + length);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(start, end).trim().replace(/\s+/g, ' ');
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}
