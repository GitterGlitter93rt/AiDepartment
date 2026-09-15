/**
 * Which trades a state licenses, and which it does not.
 * Authority: overnight enrichment brief, "Texas E — licensing is vertical-specific".
 *
 * Without this table the product commits a specific, damaging error: it searches a
 * state licence registry for a trade the state does not license, finds nothing, and
 * reports "no licence found" about a company that needs no licence. A rep reads that
 * as a red flag on a perfectly legitimate business.
 *
 * "We looked and found nothing" and "there is nothing to look for" are different
 * sentences, and only the first one is a finding.
 */

export type LicensingScope =
  /** The state issues a statewide licence for this trade. */
  | 'STATEWIDE'
  /** Regulated, but by cities or counties -- there is no statewide register to search. */
  | 'LOCAL_ONLY'
  /** The state issues no licence for this trade at all. */
  | 'NONE'
  /** We have not established what this state does. Never reported as a finding. */
  | 'UNKNOWN';

export interface LicensingRequirement {
  scope: LicensingScope;
  /** The agency that issues it, when one does. */
  authority: string | null;
  /** The adapter that can answer, when one exists. */
  sourceId: string | null;
  /** A sentence a rep can read, used verbatim in the UI. */
  note: string;
}

/**
 * Deliberately conservative and deliberately incomplete.
 *
 * An entry is only added where the answer is well established. Everything else
 * stays UNKNOWN, which reports nothing rather than guessing -- an incorrect NONE
 * would suppress a real licensing gap, and an incorrect STATEWIDE would invent one.
 */
const REQUIREMENTS: Record<string, Record<string, LicensingRequirement>> = {
  FL: {
    plumbing: {
      scope: 'STATEWIDE', authority: 'Florida DBPR — Construction Industry Licensing Board',
      sourceId: 'fl_dbpr',
      note: 'Florida licenses plumbing contractors statewide.',
    },
    hvac: {
      scope: 'STATEWIDE', authority: 'Florida DBPR — Construction Industry Licensing Board',
      sourceId: 'fl_dbpr',
      note: 'Florida licenses air-conditioning contractors statewide.',
    },
    electrical: {
      scope: 'STATEWIDE', authority: 'Florida DBPR — Electrical Contractors Licensing Board',
      sourceId: 'fl_dbpr',
      note: 'Florida licenses electrical contractors statewide.',
    },
    roofing: {
      scope: 'STATEWIDE', authority: 'Florida DBPR — Construction Industry Licensing Board',
      sourceId: 'fl_dbpr',
      note: 'Florida licenses roofing contractors statewide.',
    },
    'general-contractors-remodeling': {
      scope: 'STATEWIDE', authority: 'Florida DBPR — Construction Industry Licensing Board',
      sourceId: 'fl_dbpr',
      note: 'Florida licenses general and building contractors statewide.',
    },
  },
  TX: {
    plumbing: {
      scope: 'STATEWIDE', authority: 'Texas State Board of Plumbing Examiners',
      sourceId: 'tx_tsbpe',
      note: 'Texas licenses plumbers statewide through the TSBPE, including the '
        + 'Responsible Master Plumber a plumbing company must designate.',
    },
    hvac: {
      scope: 'STATEWIDE', authority: 'Texas Department of Licensing and Regulation',
      sourceId: 'tx_tdlr',
      note: 'Texas licenses air-conditioning and refrigeration contractors through TDLR.',
    },
    electrical: {
      scope: 'STATEWIDE', authority: 'Texas Department of Licensing and Regulation',
      sourceId: 'tx_tdlr',
      note: 'Texas licenses electricians and electrical contractors through TDLR.',
    },
    /**
     * The entry this table was written for.
     *
     * Texas has no statewide roofing contractor licence. Searching TDLR for one and
     * reporting "no licence found" would put a red flag on every roofer in the
     * state, all of them correctly unlicensed because there is nothing to hold.
     */
    roofing: {
      scope: 'NONE', authority: null, sourceId: null,
      note: 'Texas does not license roofing contractors statewide, so there is no '
        + 'state licence to verify. This is not a gap in the company’s credentials.',
    },
    'general-contractors-remodeling': {
      scope: 'NONE', authority: null, sourceId: null,
      note: 'Texas does not license general contractors statewide; requirements are '
        + 'set locally where they exist at all.',
    },
  },
};

const UNKNOWN: LicensingRequirement = {
  scope: 'UNKNOWN', authority: null, sourceId: null,
  note: 'It has not been established whether this state licenses this trade, so no '
    + 'licence conclusion is drawn either way.',
};

export function licensingRequirement(
  stateRegion: string | null | undefined, verticalProfileId: string | null | undefined,
): LicensingRequirement {
  const state = (stateRegion ?? '').trim().toUpperCase();
  const vertical = (verticalProfileId ?? '').trim().toLowerCase();
  if (!state || !vertical) return UNKNOWN;
  return REQUIREMENTS[state]?.[vertical] ?? UNKNOWN;
}

/**
 * Whether a missing licence should count against the company.
 *
 * Only a STATEWIDE requirement can produce a real gap. Everything else -- no state
 * licence, local licensing, or an unestablished answer -- must leave completeness
 * and scoring exactly where they were.
 */
export function licenceGapIsMeaningful(
  stateRegion: string | null | undefined, verticalProfileId: string | null | undefined,
): boolean {
  return licensingRequirement(stateRegion, verticalProfileId).scope === 'STATEWIDE';
}
