/**
 * What every executable signal in a vertical profile means.
 *
 * The sweep that preceded this file found configuration that was syntactically fine
 * and semantically disconnected: triggers naming signals no profile declared, a
 * section read under a name no profile has, claim keys the scorer looked for and
 * nothing wrote. Each was a different symptom of one missing thing -- nowhere that
 * said, for a given signal id, what it means, whose fact it is, who can produce it,
 * and what its absence should be taken to mean.
 *
 * This is that place. A profile may only reference a signal declared here, and the
 * validator says which of two very different problems a bad reference is: a name
 * nobody has defined, or a defined name whose data source we do not have. Those need
 * opposite responses -- one is a typo, the other is a purchase -- and collapsing them
 * is how "fifty-seven unreachable triggers" hid twenty-seven document defects.
 *
 * The registry declares semantics, which code cannot infer. It does not restate
 * facts code already holds: the producer lists are asserted against the real writers
 * by `signalContract.test.ts`, so a producer that stops producing fails there rather
 * than quietly disagreeing with this file.
 */

/**
 * Whose fact this is.
 *
 * The distinction exists because one specific confusion was found in production
 * configuration: `storm_hail_market_signal` mixed "this geography has had hail" with
 * "this company advertises hail repair". They are different claims about different
 * subjects, and evidence for one is not evidence for the other. A company signal may
 * never be satisfied by market evidence, and a market signal may never become a
 * statement about a company.
 */
export type SignalSubject =
  | 'COMPANY'
  | 'CONTACT'
  | 'MARKET'
  | 'SEARCH_OBSERVATION'
  | 'RELATIONSHIP';

export type SignalValueType =
  /** Observed or not observed. Most first-party signals. */
  | 'OBSERVED'
  /** A number we hold, such as a review count. */
  | 'COUNT'
  /** One of a fixed set, such as a line type. */
  | 'CATEGORY'
  /** A person or company identity. */
  | 'IDENTITY';

/**
 * The states a signal may legitimately be in.
 *
 * `NO` is deliberately absent from most signals: we can prove a company advertises
 * and we cannot prove it does not. `SOURCE_UNAVAILABLE` is not a value of the world,
 * it is a statement about us -- and it must never render as NO.
 */
export type SignalState =
  | 'YES'
  | 'NO'
  | 'NOT_OBSERVED'
  | 'NOT_CHECKED'
  | 'UNKNOWN'
  | 'CONFLICT'
  | 'SOURCE_UNAVAILABLE';

/** Where a signal can come from. Named, so a test can check the writer still exists. */
export type ProducerId =
  /** `src/resolver/signals.ts` reading already-fetched first-party pages. */
  | 'FIRST_PARTY_RECOGNISER'
  /** Profile-declared term lists, read from the vertical's own `derived_signals`. */
  | 'PROFILE_DECLARED_TERMS'
  /** `src/workers/marketMiner.ts` promoting an observed paid placement. */
  | 'SERP_AD_PROMOTION'
  /** The person/contact resolver in `src/resolver/persist.ts`. */
  | 'CONTACT_RESOLVER'
  /** A CSV or list import. */
  | 'IMPORT'
  /** Something a prospect said, kept verbatim in `prospect_statements`. */
  | 'PROSPECT_STATEMENT'
  /** A listings/maps adapter. */
  | 'BUSINESS_LISTINGS'
  /**
   * `src/probe/evidence.ts` reading the Speed-to-Lead probe ledger.
   *
   * A producer rather than a missing capability, because code does write these: the
   * ledger, the attribution ladder and the latency arithmetic all exist. What the
   * ledger holds -- simulated probes today, live ones only after a separate
   * authorization -- is a property of the data, and the reader filters to live rows
   * so a dry-run row can never reach a rep as a measurement.
   */
  | 'PROBE_LEDGER';

/**
 * A capability we would have to have before a signal could ever be collected.
 *
 * Declared separately from the producer because "no code writes this" and "no data
 * exists to write it from" are different problems with different owners.
 */
export type SourceCapability =
  | 'META_AD_LIBRARY'
  | 'WEATHER_EVENT_FEED'
  | 'JOB_BOARD_FEED'
  | 'LEAD_PORTAL_ACCOUNT';

export interface CanonicalSignal {
  /** The claim key evidence is stored under, and the only name the runtime knows. */
  id: string;
  subject: SignalSubject;
  valueType: SignalValueType;
  /** What the signal asserts, in the words it would have to be defended in. */
  description: string;
  states: SignalState[];
  producers: ProducerId[];
  /**
   * Null when a producer exists. Set when the signal is understood and the data to
   * produce it is not something this system has -- which is a purchase or an
   * integration, not a defect.
   */
  requiredCapability: SourceCapability | null;
  /** Hours a fresh observation stays current, or null when it does not age. */
  freshnessHours: number | null;
  /**
   * Other names that provably denote the same fact. Approved individually, never by
   * resemblance: two signals with similar words are two signals.
   */
  aliases: string[];
  /** What reads it, so removing a producer shows its blast radius. */
  consumers: string[];
}

export const UNAVAILABLE_MEANS: SignalState = 'UNKNOWN';

const SIGNALS: CanonicalSignal[] = [
  // --- advertising, observed in a search result ---------------------------------
  {
    id: 'active_google_search_ad',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'A paid Google search result was observed for this company, for a '
      + 'named query on a named day. Not a claim that they advertise continuously, '
      + 'and never a claim about what the advertising costs.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['SERP_AD_PROMOTION'],
    requiredCapability: null,
    freshnessHours: 48,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/advertiserEvidence', 'domain/hypotheses'],
  },
  {
    id: 'active_local_service_ad',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'A Google Local Services ad was observed for this company.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['SERP_AD_PROMOTION'],
    requiredCapability: null,
    freshnessHours: 48,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/advertiserEvidence'],
  },
  {
    id: 'active_hail_search_ad',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'A paid search result for this company whose own ad headline names '
      + 'hail or storm work. Narrower than active_google_search_ad and evidenced by '
      + 'the headline we observed, not inferred from the trade.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['SERP_AD_PROMOTION'],
    requiredCapability: null,
    freshnessHours: 48,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'active_meta_ad',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'This company is currently advertising on Meta. Deliberately has no '
      + 'producer: a Google search result is not evidence of a Meta ad, nor is a '
      + 'Facebook link, a pixel on their site, or an observation of unknown age.',
    // No NOT_OBSERVED: we have never looked, so we cannot have failed to see it.
    states: ['UNKNOWN', 'SOURCE_UNAVAILABLE'],
    producers: [],
    requiredCapability: 'META_AD_LIBRARY',
    freshnessHours: 48,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/advertiserEvidence', 'domain/hypotheses'],
  },

  // --- the market, which is not a company --------------------------------------
  {
    id: 'storm_hail_market_signal',
    subject: 'MARKET',
    valueType: 'OBSERVED',
    description: 'A geography has had, or is having, a storm or hail event of the kind '
      + 'that drives roofing demand. A fact about a place. It is never evidence that '
      + 'any particular company advertises or performs storm work, and no company '
      + 'observation may satisfy it.',
    states: ['UNKNOWN', 'SOURCE_UNAVAILABLE'],
    producers: [],
    requiredCapability: 'WEATHER_EVENT_FEED',
    freshnessHours: 24 * 14,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },

  // --- what a company's own site says ------------------------------------------
  {
    id: 'emergency_24_7_service',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site claims emergency or around-the-clock service.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'CONFLICT'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'online_quote_booking',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site offers online booking, scheduling, or a quote or '
      + 'consultation request form.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'CONFLICT'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 14,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'multiple_locations',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site describes more than one location, office or branch.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'visible_growth_hiring',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site advertises open roles or expansion.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 14,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'financing_promoted',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site promotes financing or payment plans.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'membership_program',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site promotes a membership, maintenance plan or service '
      + 'agreement -- a recurring relationship rather than one job.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/researchFacts', 'domain/hypotheses'],
  },
  {
    id: 'hail_repair_service',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site says they do hail damage repair. A company fact, and '
      + 'not evidence that any hail has fallen anywhere.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/hypotheses'],
  },
  {
    id: 'storm_hail_service_promoted',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site promotes storm or hail damage work -- a storm page, a '
      + 'wind and hail offer, an insurance-claim service. The company half of what '
      + 'storm_hail_market_signal used to conflate, and evidenced only by their own '
      + 'words.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'high_value_plumbing_services',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site offers the larger plumbing jobs -- sewer, repipe, '
      + 'water line, trenchless.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/hypotheses'],
  },
  {
    id: 'open_house_listing_signal',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site shows listing or open-house activity.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 7,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/hypotheses'],
  },
  {
    id: 'field_sales_presence',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site says somebody comes to the customer -- mobile '
      + 'service, on-site estimates, a storm or catastrophe crew.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/hypotheses'],
  },
  {
    id: 'replacement_service_focus',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site leads with replacement or installation rather than '
      + 'repair. Recognised from the term list the vertical profile itself declares, '
      + 'so the words are the trade\'s and not ours.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['PROFILE_DECLARED_TERMS'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'crm_frontend_on_site',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'A named booking, CRM or field-service system appears on their own '
      + 'site. The claim is that we saw the name, not that the company runs it '
      + 'everywhere or exclusively. Names come from the vertical profile\'s own '
      + 'examples list.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['PROFILE_DECLARED_TERMS'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'call_tracking_vendor_on_site',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'A known call-tracking vendor appears on their own site. The claim is '
      + 'exactly that. It is not "they use call tracking on every line", and it is '
      + 'not derived from an endpoint role: CALL_TRACKING_NUMBER exists in the schema '
      + 'and nothing has ever set it, so endpoint evidence could not support this.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'customer_status_updates_promoted',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site promises to keep customers updated -- text updates, '
      + 'status notifications, a progress portal.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'ai_usage_promoted',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site says they use AI in their work or their intake.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'ai_hiring_mentioned',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own careers or hiring page mentions AI. Requires both the '
      + 'hiring context and the AI mention on the same page, so a marketing sentence '
      + 'about AI elsewhere on the site does not satisfy it.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 14,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },
  {
    id: 'home_valuation_cta',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'Their own site offers a home valuation -- "what is my home worth" '
      + 'and its variants -- which is a seller-side capture route.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['FIRST_PARTY_RECOGNISER'],
    requiredCapability: null,
    freshnessHours: 24 * 14,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },

  // --- what a prospect told us --------------------------------------------------
  {
    id: 'prospect_mentions_ai_use',
    subject: 'COMPANY',
    valueType: 'OBSERVED',
    description: 'The prospect said they use AI. Comes from a statement captured '
      + 'verbatim on a call, never from a page or an inference, and does not expire '
      + 'the way an observation does: they have not stopped having said it.',
    states: ['YES', 'NOT_CHECKED'],
    producers: ['PROSPECT_STATEMENT'],
    requiredCapability: null,
    freshnessHours: null,
    aliases: [],
    consumers: ['domain/hypotheses'],
  },

  // --- people and routes --------------------------------------------------------
  {
    id: 'decision_maker_identity',
    subject: 'CONTACT',
    valueType: 'IDENTITY',
    description: 'A named person with a role that matters for this hypothesis.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'CONFLICT'],
    producers: ['CONTACT_RESOLVER', 'IMPORT'],
    requiredCapability: null,
    freshnessHours: 24 * 30,
    aliases: [],
    consumers: ['scoring/recognize', 'domain/repReady', 'callbrain/callPack'],
  },
  {
    id: 'contact_no_longer_current',
    subject: 'CONTACT',
    valueType: 'OBSERVED',
    description: 'Someone told us this person has left, or the route bounced.',
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED'],
    producers: ['CONTACT_RESOLVER', 'PROSPECT_STATEMENT'],
    requiredCapability: null,
    freshnessHours: null,
    aliases: [],
    consumers: ['domain/contactConfidence'],
  },
  {
    id: 'imported_contact_title',
    subject: 'CONTACT',
    valueType: 'IDENTITY',
    description: 'A job title that arrived on an imported list, kept as the raw words '
      + 'the list used.',
    states: ['YES', 'NOT_CHECKED'],
    producers: ['IMPORT'],
    requiredCapability: null,
    freshnessHours: null,
    aliases: [],
    consumers: ['domain/roles'],
  },
  {
    id: 'excluded_from_targeting',
    subject: 'RELATIONSHIP',
    valueType: 'OBSERVED',
    description: 'This company is out of scope for the vertical that found it -- a '
      + 'supply house, a school, a directory.',
    states: ['YES', 'NOT_OBSERVED'],
    producers: ['IMPORT', 'BUSINESS_LISTINGS'],
    requiredCapability: null,
    freshnessHours: null,
    aliases: [],
    consumers: ['import/importer', 'workers/marketMiner'],
  },

  // --- what happened to one lead we submitted -----------------------------------
  //
  // Every signal here takes the RELATIONSHIP subject, and that is a load-bearing
  // decision rather than a filing choice. The subject of the fact is the interaction
  // we observed, not the company: a COMPANY-subject latency signal reads as "their
  // response time", which is exactly the claim the vertical profiles forbid with
  // `must_not_claim: [current_response_time_without_measurement]`. One probe is one
  // inquiry on one date and never becomes a rate, an average or a benchmark.
  //
  // None of them lists NO. A probe that failed, or a response that could not be
  // attributed, says nothing whatever about the company.
  {
    id: 'lead_response_probe_completed',
    subject: 'RELATIONSHIP',
    valueType: 'OBSERVED',
    description: 'A controlled lead-response audit was submitted to this company and '
      + 'reached a measured outcome with resolved attribution. A fact about one '
      + 'inquiry on one date, never a statement about how they handle leads generally.',
    // No NO and no NOT_OBSERVED: a probe that failed is NOT_CHECKED, because that
    // failure was ours or the form's.
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'lead_response_latency',
    subject: 'RELATIONSHIP',
    valueType: 'COUNT',
    description: 'Seconds between submitting one controlled inquiry and the first '
      + 'response attributable to it, of any actor type. Includes automated '
      + 'acknowledgements, so it is not a measure of human follow-up.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'human_response_latency',
    subject: 'RELATIONSHIP',
    valueType: 'COUNT',
    description: 'Seconds to the first contact from a person that engaged the '
      + 'inquiry, requiring HUMAN actor evidence and HIGH or MEDIUM attribution. An '
      + 'automated acknowledgement never satisfies this.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'after_hours_response_gap',
    subject: 'RELATIONSHIP',
    valueType: 'COUNT',
    description: 'Seconds a lead submitted outside a company business-hours window '
      + 'waited for a human. Produced only when those hours are actually known: '
      + 'without them, whether 10 PM was after hours is not a fact we hold.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'paid_lead_followup_gap',
    subject: 'RELATIONSHIP',
    valueType: 'COUNT',
    description: 'Human response latency for a probe selected because the company is '
      + 'currently paying for demand. The same measurement as human_response_latency, '
      + 'narrowed to the case where a slow answer is being paid for twice.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'no_human_followup_observed',
    subject: 'RELATIONSHIP',
    valueType: 'OBSERVED',
    description: 'A closed audit window in which no human contact attributable to the '
      + 'inquiry arrived on the channels we monitored. YES means that absence was '
      + 'observed inside the window; NOT_OBSERVED means a human did follow up. Never '
      + 'a claim that the company does not respond: they may have rung a number we '
      + 'did not monitor or mailed an address we did not watch.',
    // Deliberately no NO. "They never follow up" is not something one bounded
    // observation can establish, and NO is the state that would let it try.
    states: ['YES', 'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'response_channel',
    subject: 'RELATIONSHIP',
    valueType: 'CATEGORY',
    description: 'Which channel the first attributable response to a controlled '
      + 'inquiry arrived on: SMS, CALL, EMAIL or MULTIPLE. A fact about that one '
      + 'response, not about which channels the company generally uses.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'response_actor_type',
    subject: 'RELATIONSHIP',
    valueType: 'CATEGORY',
    description: 'Whether the first attributable response came from a person, a '
      + 'system, or something we could not tell apart: HUMAN, AUTOMATED or UNKNOWN. '
      + 'UNKNOWN is a real answer, and absence of automation evidence is not a human.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
  {
    id: 'response_attribution_confidence',
    subject: 'RELATIONSHIP',
    valueType: 'CATEGORY',
    description: 'How sure we are that a response belonged to our inquiry: HIGH, '
      + 'MEDIUM, LOW or NONE. It travels with every other probe signal, because a '
      + 'latency nobody can attribute is not a latency anybody may quote.',
    states: ['YES', 'NOT_CHECKED', 'UNKNOWN'],
    producers: ['PROBE_LEDGER'],
    requiredCapability: null,
    freshnessHours: 24 * 180,
    aliases: [],
    consumers: ['probe/evidence', 'domain/hypotheses'],
  },
];

const BY_ID = new Map(SIGNALS.map((signal) => [signal.id, signal]));
const BY_ALIAS = new Map<string, CanonicalSignal>();
for (const signal of SIGNALS) {
  for (const alias of signal.aliases) BY_ALIAS.set(alias, signal);
}

export function allSignals(): readonly CanonicalSignal[] { return SIGNALS; }

/** The signal a name denotes, following approved aliases. */
export function signalFor(id: string): CanonicalSignal | null {
  return BY_ID.get(id) ?? BY_ALIAS.get(id) ?? null;
}

export function isKnownSignal(id: string): boolean { return signalFor(id) !== null; }

/**
 * A signal we could collect today: something declares itself able to produce it and
 * it needs no capability we do not have.
 *
 * Distinct from "known". An unknown id is a typo somebody must fix; a known id with
 * no producer is a purchase somebody must make. The validator reports them
 * separately because they go to different people.
 */
export function isCollectable(id: string): boolean {
  const signal = signalFor(id);
  if (!signal) return false;
  return signal.producers.length > 0 && signal.requiredCapability === null;
}

export function signalsRequiringCapability(): CanonicalSignal[] {
  return SIGNALS.filter((signal) => signal.requiredCapability !== null);
}

/** Names close enough to be worth printing in an error. Never applied automatically. */
export function nearestSignalNames(id: string, limit = 3): string[] {
  const target = id.toLowerCase();
  const scored = SIGNALS.map((signal) => {
    const candidate = signal.id.toLowerCase();
    let shared = 0;
    for (const word of new Set(target.split('_'))) {
      if (word.length >= 3 && candidate.includes(word)) shared += 1;
    }
    return { id: signal.id, shared };
  }).filter((entry) => entry.shared > 0);
  scored.sort((left, right) => right.shared - left.shared || left.id.localeCompare(right.id));
  return scored.slice(0, limit).map((entry) => entry.id);
}
