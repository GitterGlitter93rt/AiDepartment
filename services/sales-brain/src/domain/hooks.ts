import { getVerticalProfile } from './verticals.js';

/**
 * One authoritative order for the primary sales hook.
 *
 * Two fields looked like competing authorities: `call_pack_defaults
 * .preferred_primary_hook_order` and `hook_priorities[].base_priority`. Read the
 * right way round they are the same order written twice -- roofing's most important
 * hook carries `base_priority: 10` and its least carries 6, so a higher number is a
 * more important hook, and sorted that way the two fields agree in every vertical
 * that declares both.
 *
 * The apparent conflict was a reading error, and it had a live consequence: the
 * hypothesis generator sorted that number ascending, which is the order of least
 * importance first. Where it matched a hypothesis at all -- three of five roofing
 * families are named differently from the hypotheses they belong to, so most fell to
 * a default -- it put the weakest reason to call at the top.
 *
 * So: this is the only place a primary-hook order is decided, `preferred_primary_hook_order`
 * is the authority when a profile states one, and `hook_priorities` is read here and
 * nowhere else.
 */

export type HookOrderSource =
  /** The profile states the order explicitly. */
  | 'PREFERRED'
  /** Only `hook_priorities` exists, read descending, which is what its numbers mean. */
  | 'DERIVED_FROM_PRIORITIES'
  /** The profile says nothing about hook order. */
  | 'NONE';

export interface PrimaryHookOrder {
  verticalProfileId: string;
  /** Hook families, most important first. */
  families: string[];
  source: HookOrderSource;
  /**
   * Set when a profile declares both and they disagree. Never resolved silently: two
   * orders for one decision is the defect this function exists to prevent, and the
   * contract validator fails on it.
   */
  disagreement: { preferred: string[]; derived: string[] } | null;
}

/** Families in the order `hook_priorities` means, which is highest number first. */
export function familiesByPriority(profile: any): string[] {
  const entries = (profile?.hook_priorities ?? [])
    .map((hook: any) => ({
      family: String(hook?.hook_family ?? ''),
      base: Number(hook?.base_priority ?? 0),
    }))
    .filter((entry: { family: string }) => entry.family.length > 0);
  // Descending, and ties keep declaration order so the result is stable.
  return entries
    .map((entry: any, index: number) => ({ ...entry, index }))
    .sort((left: any, right: any) => right.base - left.base || left.index - right.index)
    .map((entry: any) => entry.family);
}

export function resolvePrimaryHookOrder(
  verticalProfileId: string, profile: any,
): PrimaryHookOrder {
  const preferred: string[] = (profile?.call_pack_defaults?.preferred_primary_hook_order ?? [])
    .map((family: unknown) => String(family));
  const derived = familiesByPriority(profile);

  if (preferred.length === 0) {
    return {
      verticalProfileId,
      families: derived,
      source: derived.length > 0 ? 'DERIVED_FROM_PRIORITIES' : 'NONE',
      disagreement: null,
    };
  }

  const disagrees = derived.length > 0
    && JSON.stringify(preferred) !== JSON.stringify(derived);

  return {
    verticalProfileId,
    // The explicit statement wins. A profile that says the order out loud is not
    // overruled by numbers on another field.
    families: preferred,
    source: 'PREFERRED',
    disagreement: disagrees ? { preferred, derived } : null,
  };
}

export async function primaryHookOrderFor(
  verticalProfileId: string | null,
): Promise<PrimaryHookOrder | null> {
  if (!verticalProfileId) return null;
  const profile = await getVerticalProfile(verticalProfileId);
  if (!profile) return null;
  return resolvePrimaryHookOrder(verticalProfileId, profile);
}

/**
 * Where a hook family sits in the order, or null when the profile does not rank it.
 *
 * Null rather than a large number: "not ranked" and "ranked last" are different, and
 * a caller that wants to treat them the same should say so.
 */
export function hookRank(order: PrimaryHookOrder | null, family: string): number | null {
  if (!order) return null;
  const at = order.families.indexOf(family);
  return at === -1 ? null : at;
}
