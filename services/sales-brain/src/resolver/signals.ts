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
};

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

  return declared
    .filter((key) => RECOGNISERS[key])
    .map((key) => ({
      claimKey: key,
      category: RECOGNISERS[key]!.category,
      ttlHours: RECOGNISERS[key]!.ttlHours,
    }));
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

  const found = new Map<string, SignalObservation>();

  for (const signal of wanted) {
    const recogniser = RECOGNISERS[signal.claimKey]!;
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
