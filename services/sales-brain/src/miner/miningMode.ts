/**
 * How a market is searched, spelled one way.
 *
 * The mode is not a label. It goes into the search fingerprint, which is the identity
 * of a paid provider task, so two spellings of the same intent are two different
 * searches: one that was previewed and one that is bought. `planPreview.ts` defaulted
 * to `advertisers_first` while `enqueue.ts`, `marketMiner.ts` and `searchPlan.ts`
 * defaulted to `advertiser_first`, and the Find Prospects page sends no mode at all --
 * so the ordinary path through the product previewed under one identity and executed
 * under another. Both happen to order queries the same way today, which is exactly why
 * nobody noticed: the divergence was in the identity, not the behaviour.
 *
 * One vocabulary, and an unknown value is refused rather than quietly accepted. A mode
 * nobody recognises cannot be planned honestly, and guessing which near-spelling was
 * meant is how the two defaults drifted apart in the first place.
 */

export type MiningMode = 'advertiser_first' | 'broad_local';

/** Prefer the queries where advertisers bid: companies already spending money. */
export const DEFAULT_MINING_MODE: MiningMode = 'advertiser_first';

export const MINING_MODES: readonly MiningMode[] = ['advertiser_first', 'broad_local'];

/**
 * The canonical mode, or null when the caller said something this product does not
 * know.
 *
 * Absence is not a wrong answer: no mode means the default, because most callers have
 * no opinion and the Find Prospects page is one of them. A non-empty value that is not
 * in the vocabulary is a wrong answer, and it is returned as one.
 */
export function normalizeMiningMode(input: string | null | undefined): MiningMode | null {
  const value = (input ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_MINING_MODE;
  return (MINING_MODES as readonly string[]).includes(value) ? value as MiningMode : null;
}

/**
 * The canonical mode, or the default.
 *
 * For the paths that cannot refuse -- a scheduler reading a saved market written
 * before this vocabulary existed, a fingerprint being recomputed for an old job --
 * where falling back is safer than failing. Anything that is about to spend money uses
 * `normalizeMiningMode` and refuses instead.
 */
export function miningModeOrDefault(input: string | null | undefined): MiningMode {
  return normalizeMiningMode(input) ?? DEFAULT_MINING_MODE;
}
