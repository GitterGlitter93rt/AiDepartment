/**
 * Stage D — public search evidence about a named person. Planned, priced, disabled.
 *
 * The waterfall this sits in runs cheapest-first and stops as soon as it has an answer:
 *
 *   A  the company's own website          free, runs today
 *   B  public corporate registry          free, gated on a signed governance review
 *   C  public licence registry            free, gated on a signed governance review
 *   D  search-indexed public evidence     costs money, this file
 *   —  a contact-data vendor              only if D measurably fails, and not yet
 *
 * Everything here plans and prices. Nothing here buys: `plan()` returns queries and an
 * estimate, and the executor that would submit them does not exist. That is deliberate
 * rather than incidental -- the point of building the planner first is to be able to
 * read what a hundred Accounts would cost before anybody agrees to spend it.
 *
 * Two rules the planner exists to enforce:
 *
 * **A query is built only from facts already established.** A person's name comes from
 * first-party or official evidence; an address comes from what the company published;
 * the city comes from that address and never from the geography we searched. Searching
 * for a guess and reading the result as evidence is how a system launders its own
 * assumptions into facts.
 *
 * **A result is candidate evidence, never a verified fact.** A snippet saying "Owner at
 * Sunbright HVAC" is a sentence on a page. It is a reason to ask, not an answer, and
 * SB-V2-4's promotion rules apply to it unchanged: a title in a snippet does not make
 * anybody an owner.
 */

import { looksLikePageCopy } from '../remediation/classify.js';

/** What a planned query is trying to find out. */
export type StageDIntent =
  /** Who runs this company. */
  | 'DECISION_MAKER'
  /** How to reach a person we can already name. */
  | 'CONTACT_ROUTE';

export interface StageDQuery {
  intent: StageDIntent;
  /** The exact words that would be bought. */
  query: string;
  /** Why this query is worth its money, in a sentence an operator can weigh. */
  rationale: string;
  /** What is already known that makes this query answerable. */
  builtFrom: string[];
}

export interface StageDFacts {
  companyName: string;
  /** The company's own domain, when one is attributed. */
  domain: string | null;
  /** A person already established by first-party or official evidence. */
  knownPersonName: string | null;
  /** The role that person is already recorded as holding, if any. */
  knownPersonRole: string | null;
  /** A street address the company published. Never the searched geography. */
  publishedStreet: string | null;
  publishedCity: string | null;
  publishedRegion: string | null;
  /** The trade, when evidence supports it. */
  verticalProfileId: string | null;
  /** True when a named person's email is already held. */
  hasNamedEmail: boolean;
  /** True when a decision maker is already named. */
  hasDecisionMaker: boolean;
}

export interface StageDPlan {
  queries: StageDQuery[];
  /** Why the plan is the size it is, including why it is empty. */
  reason: string;
  estimatedCostUsd: number;
  /** The per-query price the estimate used, and where that number came from. */
  unitCostUsd: number;
  unitCostBasis: string;
}

/**
 * The ceiling, and what it is a ceiling on.
 *
 * Three questions about who runs the company and two about how to reach them. The
 * limit is per Account and absolute: a company that cannot be resolved in five public
 * searches is not resolved by a sixth, it is a company whose people are not on the
 * public web, and spending more only produces a longer bill.
 */
export const MAX_DECISION_MAKER_QUERIES = 3;
export const MAX_CONTACT_QUERIES = 2;
export const MAX_QUERIES_PER_ACCOUNT = MAX_DECISION_MAKER_QUERIES + MAX_CONTACT_QUERIES;

/** Quotes a phrase so a provider treats it as one thing. */
function phrase(value: string): string {
  return `"${value.replace(/"/g, '').trim()}"`;
}

/**
 * What to search, given what is already known.
 *
 * Ordered by what each query can settle, not by how likely it is to return something.
 * The first query that names a person makes the rest unnecessary, which is why the stop
 * rule is expressed as "plan fewer" rather than "run fewer": a plan an operator reads is
 * a plan they can refuse.
 */
export function planStageDQueries(facts: StageDFacts): StageDQuery[] {
  const queries: StageDQuery[] = [];
  const city = facts.publishedCity;
  const trade = facts.verticalProfileId;

  if (!facts.hasDecisionMaker) {
    // Nobody named yet. Ask who runs it, in the two shapes that answer it.
    queries.push({
      intent: 'DECISION_MAKER',
      query: `${phrase(facts.companyName)} owner OR president OR "general manager"`,
      rationale: 'Finds a page that names whoever runs the company.',
      builtFrom: ['canonical company name'],
    });
    if (city) {
      queries.push({
        intent: 'DECISION_MAKER',
        query: `${phrase(facts.companyName)} ${city} ${trade ?? ''}`.trim(),
        rationale: 'Separates this company from others of the same name in other places.',
        builtFrom: ['canonical company name', 'published city',
          ...(trade ? ['trade'] : [])],
      });
    }
    if (facts.domain) {
      queries.push({
        intent: 'DECISION_MAKER',
        query: `site:${facts.domain} owner OR founder OR "our team"`,
        rationale: 'Pages of the company\'s own site that the crawl did not reach.',
        builtFrom: ['attributed domain'],
      });
    }
  } else if (facts.knownPersonName) {
    // Somebody is named. The remaining question is whether this is the same person and
    // what the public record says about them -- not who else might exist.
    queries.push({
      intent: 'DECISION_MAKER',
      query: `${phrase(facts.knownPersonName)} ${phrase(facts.companyName)}`,
      rationale: 'Corroborates that this person and this company belong together.',
      builtFrom: ['established person name', 'canonical company name'],
    });
    if (facts.publishedStreet) {
      queries.push({
        intent: 'DECISION_MAKER',
        query: `${phrase(facts.knownPersonName)} ${phrase(facts.publishedStreet)}`,
        rationale: 'Tells two people of one name apart by the address on the record.',
        builtFrom: ['established person name', 'published street address'],
      });
    }
  }

  const decisionMakerQueries = queries.slice(0, MAX_DECISION_MAKER_QUERIES);
  const contact: StageDQuery[] = [];

  if (!facts.hasNamedEmail) {
    if (facts.knownPersonName && facts.domain) {
      contact.push({
        intent: 'CONTACT_ROUTE',
        query: `${phrase(facts.knownPersonName)} email ${facts.domain}`,
        rationale: 'Looks for a published mailbox attributed to this person.',
        builtFrom: ['established person name', 'attributed domain'],
      });
    } else if (facts.domain) {
      contact.push({
        intent: 'CONTACT_ROUTE',
        query: `${phrase(facts.companyName)} contact email ${facts.domain}`,
        rationale: 'Looks for a published mailbox for the company.',
        builtFrom: ['canonical company name', 'attributed domain'],
      });
    }
    if (facts.knownPersonName && facts.knownPersonRole) {
      contact.push({
        intent: 'CONTACT_ROUTE',
        query: `${phrase(facts.knownPersonName)} ${phrase(facts.knownPersonRole)} `
          + `${phrase(facts.companyName)} contact`,
        rationale: 'A role page often carries the route a general page does not.',
        builtFrom: ['established person name', 'established role', 'canonical company name'],
      });
    }
  }

  return [...decisionMakerQueries, ...contact.slice(0, MAX_CONTACT_QUERIES)];
}

/**
 * The plan and what it would cost.
 *
 * `unitCostUsd` is passed in by the caller, which reads it from the paid-task ledger
 * rather than from a constant: production's own 44 collected tasks are the best price
 * we have, and a constant in the code is a price nobody has checked since it was typed.
 */
export function planStageD(
  facts: StageDFacts,
  pricing: { unitCostUsd: number; basis: string },
): StageDPlan {
  /**
   * A name that is page copy buys nothing.
   *
   * Found by running the preview against production: the first plan it produced was
   * `"HVAC Tune-Up in Saint Petersburg, FL 33703 - AGNI" owner OR president`. Nobody
   * calls the company that -- it is a page title this system stored as a name -- and a
   * search for it returns whatever else quotes the title. Paying to search for our own
   * bad data is the one expense with no possible upside, and 189 of the 320 production
   * Accounts carry a name of this shape.
   */
  const pageCopy = looksLikePageCopy(facts.companyName);
  if (pageCopy.yes) {
    return {
      queries: [], estimatedCostUsd: 0,
      unitCostUsd: pricing.unitCostUsd, unitCostBasis: pricing.basis,
      reason: `The stored name ${pageCopy.reasons.join(', ')}, so it is page copy rather `
        + 'than a company name. Searching for it would buy results about the page. '
        + 'Fix the name first.',
    };
  }

  if (facts.hasDecisionMaker && facts.hasNamedEmail) {
    return {
      queries: [], estimatedCostUsd: 0,
      unitCostUsd: pricing.unitCostUsd, unitCostBasis: pricing.basis,
      reason: 'A named decision maker and a named email are already held. '
        + 'There is nothing left for a paid search to establish.',
    };
  }

  const queries = planStageDQueries(facts);
  if (queries.length === 0) {
    return {
      queries: [], estimatedCostUsd: 0,
      unitCostUsd: pricing.unitCostUsd, unitCostBasis: pricing.basis,
      reason: 'Nothing established about this company can build a query worth buying. '
        + 'A search for a guess returns evidence for the guess.',
    };
  }

  return {
    queries,
    estimatedCostUsd: Number((queries.length * pricing.unitCostUsd).toFixed(4)),
    unitCostUsd: pricing.unitCostUsd,
    unitCostBasis: pricing.basis,
    reason: `${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} planned, `
      + `at most ${MAX_QUERIES_PER_ACCOUNT} per Account. `
      + (facts.hasDecisionMaker
        ? 'A person is already named, so the plan corroborates rather than searches.'
        : 'Nobody is named yet, so the plan asks who runs the company first.'),
  };
}

/**
 * Whether Stage D may run at all.
 *
 * Two independent gates, both of which must be open, and the default of each is closed.
 * The flag is the operator's switch; the authorization is Michael's, and no code path
 * turns the second one on.
 */
export function stageDRunnable(env: NodeJS.ProcessEnv = process.env): {
  runnable: boolean; reason: string;
} {
  const flag = (env['STAGE_D_ENABLED'] ?? '').toLowerCase();
  const enabled = flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
  if (!enabled) {
    return {
      runnable: false,
      reason: 'Stage D is disabled. It is preview-only until the cost of a measured '
        + 'batch has been read and the spend authorised.',
    };
  }
  return {
    runnable: false,
    reason: 'STAGE_D_ENABLED is set, and Stage D still does not run: no executor exists. '
      + 'The planner and the estimator ship first, on purpose.',
  };
}
