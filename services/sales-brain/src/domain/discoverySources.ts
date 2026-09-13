/**
 * Which `source_system` values mean a machine found this company.
 *
 * This list has now been got wrong twice, in both directions, and both times the
 * symptom was a page telling an operator something false with a straight face.
 *
 * First an exact-match list of bare provider names matched none of the miner's real
 * output, because it writes `market_miner:<provider>`; the KPI meant to stop demo
 * rows counting as mining output counted none of the mining output either. Then the
 * stranded-research sweep matched `market_miner:%` alone, so a company found by
 * business listings could never be rescued by it -- and the mining KPIs counted the
 * same company as "created another way", which on that page reads as a person having
 * typed it in.
 *
 * One list, in one place, read by everything that asks the question. A new source is
 * added here and is immediately counted, swept and reported, rather than on the day
 * somebody remembers each separate predicate.
 */

/** Prefixes on `activities.source_system` written by automated discovery. */
export const AUTOMATED_DISCOVERY_PREFIXES = ['market_miner:', 'listings:'] as const;

/** Legacy and bare values that also mean a provider found it. */
export const AUTOMATED_DISCOVERY_EXACT = ['dataforseo', 'market_miner', 'serp'] as const;

/** An operator's own decision, never automated discovery. */
export const OPERATOR_SOURCES = ['import'] as const;

export const SYNTHETIC_SOURCES = ['SYNTHETIC_FIXTURE', 'DEMO_FIXTURE'] as const;

/**
 * A SQL predicate for "this activity came from automated discovery".
 *
 * Built rather than written out, so the two callers cannot drift apart. The column
 * name is a parameter because one caller aliases the table and the other does not.
 */
export function automatedDiscoveryPredicate(column: string): string {
  const prefixes = AUTOMATED_DISCOVERY_PREFIXES
    .map((prefix) => `${column} like '${prefix}%'`)
    .join(' or ');
  const exact = AUTOMATED_DISCOVERY_EXACT.map((value) => `'${value}'`).join(', ');
  return `(${prefixes} or ${column} in (${exact}))`;
}
