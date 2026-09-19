import { getVerticalProfile } from './verticals.js';

/**
 * What we can sell, and how a trade should position it.
 *
 * Two declaration sites existed and nothing reconciled them. Hypotheses name
 * `offer_families`; `offer_mapping` names `possible_offer_families` per opportunity
 * category with positioning, discovery prerequisites and do-not-recommend rules.
 * Between them, four spellings of three offers -- `AI_Implementation` and
 * `ai_implementation` are the same product written two ways -- and three names that
 * are not products at all.
 *
 * The model is two layers with one authority each. The catalog below is
 * authoritative for **what an offer is**, and every product entry traces to a
 * document; nothing here is invented, because inventing an offer is the one thing
 * this repository forbids outright. A vertical profile is authoritative for
 * **relevance, positioning, priority and when not to recommend** -- it may
 * specialise an offer and may not redefine it.
 *
 * `ai_phone_agent`, `crm_system` and `workflow_automation` are capabilities rather
 * than products: things an engagement builds. They are recorded as capabilities
 * because the profiles name them, and every one of the twelve lists that names one
 * also names a canonical offer alongside it -- so "delivered within an offer" is
 * what the documents already say, not a claim added here.
 */

export type OfferKind =
  /** Something a customer buys, named in the canonical offer list. */
  | 'PRODUCT'
  /** Something an engagement builds. Sold as part of a product, never on its own. */
  | 'CAPABILITY';

export interface CatalogOffer {
  id: string;
  name: string;
  kind: OfferKind;
  /** What it is. The vertical layer may not contradict this. */
  description: string;
  /** Where the canonical definition lives, so the claim is checkable. */
  documentedIn: string;
  /** For a capability, the products that deliver it. */
  deliveredWithin: string[];
  /** Spellings that provably denote the same offer. Case and separator only. */
  aliases: string[];
}

const CATALOG: CatalogOffer[] = [
  {
    id: 'ai_department_assessment', name: 'AI Department Assessment', kind: 'PRODUCT',
    description: 'The scored diagnostic that opens the relationship and produces the '
      + 'recommendations everything else follows from.',
    documentedIn: 'docs/03-products/ai-readiness-assessment.md', deliveredWithin: [],
    aliases: [],
  },
  {
    id: 'executive_ai_strategy', name: 'Executive AI Strategy', kind: 'PRODUCT',
    description: 'Executive-level strategy work ahead of any build, aimed at the '
      + 'decision rather than the implementation.',
    documentedIn: 'CLAUDE.md canonical core offers', deliveredWithin: [],
    aliases: ['Executive_AI_Strategy'],
  },
  {
    id: 'ai_consulting', name: 'AI Consulting', kind: 'PRODUCT',
    description: 'Advisory engagement without a build commitment: deciding what to '
      + 'do before committing to doing it.',
    documentedIn: 'docs/03-products/ai-consulting.md', deliveredWithin: [],
    aliases: [],
  },
  {
    id: 'ai_implementation', name: 'AI Implementation', kind: 'PRODUCT',
    description: 'Building the systems a business runs on: intake, routing, '
      + 'follow-up and reporting, delivered and handed over.',
    documentedIn: 'docs/03-products/ai-implementation.md', deliveredWithin: [],
    aliases: ['AI_Implementation'],
  },
  {
    id: 'ai_growth_systems', name: 'AI Growth Systems', kind: 'PRODUCT',
    description: 'Running the growth engine after it is built: the campaigns, the '
      + 'measurement and the iteration.',
    documentedIn: 'CLAUDE.md canonical core offers', deliveredWithin: [],
    aliases: ['AI_Growth_Systems'],
  },
  {
    id: 'managed_ai_department', name: 'Managed AI Department', kind: 'PRODUCT',
    description: 'The ongoing retainer: we operate the systems rather than handing '
      + 'them over, and the team stays ours.',
    documentedIn: 'docs/03-products/ai-department-retainer.md', deliveredWithin: [],
    aliases: ['Managed_AI_Department'],
  },
  {
    id: 'ai_training', name: 'AI Training', kind: 'PRODUCT',
    description: 'Training a team to use what has been built, so the systems keep '
      + 'working after the engagement ends.',
    documentedIn: 'docs/03-products/ai-training.md', deliveredWithin: [],
    aliases: ['AI_Training'],
  },
  {
    id: 'ai_workshops', name: 'AI Workshops', kind: 'PRODUCT',
    description: 'Facilitated working sessions with a team, shorter and more '
      + 'hands-on than a training programme.',
    documentedIn: 'docs/03-products/ai-workshops.md', deliveredWithin: [], aliases: [],
  },
  {
    id: 'executive_ai_coaching', name: 'Executive AI Coaching', kind: 'PRODUCT',
    description: 'One-to-one coaching for an owner or executive, about their own use '
      + 'of these tools rather than the company\'s systems.',
    documentedIn: 'docs/03-products/executive-coaching.md', deliveredWithin: [],
    aliases: [],
  },
  {
    id: 'google_ads', name: 'Google Ads', kind: 'PRODUCT',
    description: 'Managing paid search: the campaigns, the budget and the landing '
      + 'destinations, as a service rather than as a build.',
    documentedIn: 'docs/03-products/google-ads.md', deliveredWithin: [], aliases: [],
  },
  {
    id: 'meta_ads', name: 'Meta Ads', kind: 'PRODUCT',
    description: 'Managing paid social: audiences, creative and budget on Meta '
      + 'platforms, as a service rather than as a build.',
    documentedIn: 'docs/03-products/facebook-ads.md', deliveredWithin: [], aliases: [],
  },
  {
    id: 'seo', name: 'SEO', kind: 'PRODUCT',
    description: 'Organic search: the content, the technical work and the local '
      + 'presence that earn traffic without paying per click.',
    documentedIn: 'docs/03-products/seo-services.md', deliveredWithin: [], aliases: [],
  },
  {
    id: 'enterprise_ai_transformation', name: 'Enterprise AI Transformation',
    kind: 'PRODUCT',
    description: 'The enterprise engagement, which does not run through the public '
      + 'assessment funnel.',
    documentedIn: 'CLAUDE.md enterprise section', deliveredWithin: [], aliases: [],
  },

  // --- capabilities the profiles name, each delivered inside a product ----------
  {
    id: 'ai_phone_agent', name: 'AI phone agent', kind: 'CAPABILITY',
    description: 'Answering, qualifying and routing calls. What the controlled pilot '
      + 'demonstrates, and part of an engagement rather than a thing sold alone.',
    documentedIn: 'named by hvac and plumbing profiles, always alongside a product',
    deliveredWithin: ['ai_implementation', 'ai_growth_systems'], aliases: [],
  },
  {
    id: 'crm_system', name: 'CRM system', kind: 'CAPABILITY',
    description: 'The CRM an engagement configures, connects or replaces so the rest '
      + 'of the workflow has somewhere to write to.',
    documentedIn: 'named by the plumbing profile, always alongside a product',
    deliveredWithin: ['ai_implementation', 'ai_growth_systems'], aliases: [],
  },
  {
    id: 'workflow_automation', name: 'Workflow automation', kind: 'CAPABILITY',
    description: 'The automations between the systems a business already runs.',
    documentedIn: 'named by hvac and plumbing profiles, always alongside a product',
    deliveredWithin: ['ai_implementation', 'ai_growth_systems'], aliases: [],
  },
];

const BY_ID = new Map(CATALOG.map((offer) => [offer.id, offer]));
const BY_ALIAS = new Map<string, CatalogOffer>();
for (const offer of CATALOG) {
  for (const alias of offer.aliases) BY_ALIAS.set(alias, offer);
}

export function allOffers(): readonly CatalogOffer[] { return CATALOG; }

/**
 * The offer an id names, following approved spellings.
 *
 * Case and separator variants only. `AI_Implementation` is the same product as
 * `ai_implementation`; two offers with similar words are still two offers.
 */
export function offerFor(id: string): CatalogOffer | null {
  return BY_ID.get(id) ?? BY_ALIAS.get(id) ?? null;
}

export function isKnownOffer(id: string): boolean { return offerFor(id) !== null; }

export function nearestOfferNames(id: string, limit = 3): string[] {
  const target = id.toLowerCase();
  return CATALOG
    .map((offer) => {
      let shared = 0;
      for (const word of new Set(target.split(/[_\s]+/))) {
        if (word.length >= 3 && offer.id.includes(word)) shared += 1;
      }
      return { id: offer.id, shared };
    })
    .filter((entry) => entry.shared > 0)
    .sort((left, right) => right.shared - left.shared || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}

export interface EffectiveOffer {
  offerId: string;
  name: string;
  kind: OfferKind;
  /** Position in the vertical's own list. 1 is what to lead with. */
  priority: number;
  /** The catalog's definition, which a vertical may not contradict. */
  globalDescription: string;
  /** The vertical's positioning, when it gave one. */
  verticalPositioning: string | null;
  /** What must be known before recommending it here. */
  requiredDiscovery: string[];
  /** Conditions under which this vertical says not to recommend it. */
  doNotRecommendIf: string[];
  provenance: {
    global: string;
    vertical: string | null;
    resolved: 'GLOBAL_ONLY' | 'VERTICAL_SPECIALISED';
  };
}

export interface EffectiveOfferMapping {
  verticalProfileId: string;
  /** The problem this mapping is about, in the profile's own category vocabulary. */
  opportunityCategory: string;
  offers: EffectiveOffer[];
}

/**
 * One resolved offer model per vertical, with both layers visible.
 *
 * Order is the order the profile lists them, which is its positioning judgement. The
 * catalog description travels alongside so a consumer never has to read the two
 * declaration sites and decide for itself which won.
 */
export async function resolveOfferMapping(
  verticalProfileId: string | null,
): Promise<EffectiveOfferMapping[]> {
  if (!verticalProfileId) return [];
  const profile = await getVerticalProfile(verticalProfileId);
  if (!profile) return [];

  const mappings: EffectiveOfferMapping[] = [];
  for (const entry of profile.offer_mapping ?? []) {
    const opportunityCategory = String(entry?.opportunity_category ?? '(unnamed)');
    const positioning = typeof entry?.positioning === 'string'
      ? entry.positioning.trim() : null;
    const requiredDiscovery = (entry?.required_discovery_before_recommending ?? [])
      .map((item: unknown) => String(item));
    const doNotRecommendIf = (entry?.do_not_recommend_if ?? [])
      .map((item: unknown) => String(item));

    const offers: EffectiveOffer[] = [];
    let priority = 0;
    for (const raw of entry?.possible_offer_families ?? []) {
      const offer = offerFor(String(raw));
      // An unknown id is a contract violation reported by the validator. Skipped
      // here rather than guessed at: a resolved model with an invented offer in it
      // would be worse than one that is short.
      if (!offer) continue;
      priority += 1;
      offers.push({
        offerId: offer.id,
        name: offer.name,
        kind: offer.kind,
        priority,
        globalDescription: offer.description,
        verticalPositioning: positioning,
        requiredDiscovery,
        doNotRecommendIf,
        provenance: {
          global: offer.documentedIn,
          vertical: positioning
            ? `${verticalProfileId} offer_mapping[${opportunityCategory}]` : null,
          resolved: positioning ? 'VERTICAL_SPECIALISED' : 'GLOBAL_ONLY',
        },
      });
    }
    mappings.push({ verticalProfileId, opportunityCategory, offers });
  }
  return mappings;
}

/**
 * What to offer for one hypothesis, from both declaration sites at once.
 *
 * A hypothesis names `offer_families`; `offer_mapping` names offers per opportunity
 * category with the positioning and the do-not-recommend rules. A consumer asking
 * "what do I offer for this leak" should never have to read both and decide which
 * won -- that is how two declaration sites become two behaviours.
 *
 * The hypothesis decides which offers and in what order, because it is the specific
 * statement. The mapping for its category supplies the positioning and the
 * conditions, because that is where they are written. Capabilities keep their kind,
 * so a consumer can avoid presenting one as a thing to buy on its own.
 */
export async function offersForHypothesis(input: {
  verticalProfileId: string | null;
  hypothesisId: string;
}): Promise<EffectiveOffer[]> {
  if (!input.verticalProfileId) return [];
  const profile = await getVerticalProfile(input.verticalProfileId);
  if (!profile) return [];

  const hypothesis = (profile.leak_hypotheses ?? [])
    .find((entry: any) => String(entry?.hypothesis_id) === input.hypothesisId);
  if (!hypothesis) return [];

  const category = String(hypothesis?.category ?? '');
  const mapping = (profile.offer_mapping ?? [])
    .find((entry: any) => String(entry?.opportunity_category ?? '') === category);
  const positioning = typeof mapping?.positioning === 'string'
    ? mapping.positioning.trim() : null;
  const requiredDiscovery = (mapping?.required_discovery_before_recommending ?? [])
    .map((item: unknown) => String(item));
  const doNotRecommendIf = (mapping?.do_not_recommend_if ?? [])
    .map((item: unknown) => String(item));

  const offers: EffectiveOffer[] = [];
  let priority = 0;
  for (const raw of hypothesis?.offer_families ?? []) {
    const offer = offerFor(String(raw));
    if (!offer) continue;
    priority += 1;
    offers.push({
      offerId: offer.id, name: offer.name, kind: offer.kind, priority,
      globalDescription: offer.description,
      verticalPositioning: positioning,
      requiredDiscovery, doNotRecommendIf,
      provenance: {
        global: offer.documentedIn,
        vertical: `${input.verticalProfileId} leak_hypotheses[${input.hypothesisId}]`
          + (mapping ? ` with offer_mapping[${category}] positioning` : ''),
        resolved: positioning ? 'VERTICAL_SPECIALISED' : 'GLOBAL_ONLY',
      },
    });
  }
  return offers;
}
