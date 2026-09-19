import { getVerticalProfile } from './verticals.js';
import { roleCategoryFromTitle } from './accounts.js';

/**
 * Which canonical role a job title is, and how we decided.
 *
 * The runtime taxonomy is deliberately small: fifteen categories a machine can act
 * on. The profiles are deliberately specific: managing partner, managing broker,
 * canvassing manager, estimator, practice administrator -- sixty-five declared roles
 * across thirteen trades. Both are right, and the two vocabularies evolved without a
 * bridge, so "Managing Partner" classified as `unknown` and nothing recorded whether
 * that was a missing mapping, an unrecognisable title, or the truth.
 *
 * The bridge is `canonical_role_category`, declared per role in the profile itself.
 * That keeps it reviewable where the roles are authored rather than buried in string
 * heuristics here, and a role a profile forgot to map fails the contract validator
 * rather than silently becoming `unknown`.
 *
 * Four things are kept about every classification: the raw title exactly as the
 * source gave it, the profile's own wording when a profile recognised it, the
 * canonical category, and which of those routes decided. A rep sees the words the
 * company uses; the machine acts on the category; and the record says which is which.
 */

export type RoleClassifiedBy =
  | 'PROFILE_ROLE_TITLE'
  | 'PROFILE_ROLE_CATEGORY'
  | 'GENERIC_PATTERN'
  | 'INSUFFICIENT_EVIDENCE';

export interface RoleClassification {
  /** Exactly what the source said. Never rewritten. */
  rawTitle: string | null;
  /** The vertical's own wording, when a vertical recognised the title. */
  normalizedTitle: string | null;
  /** The profile's role name, which is more specific than the canonical category. */
  profileRoleCategory: string | null;
  /** What the runtime acts on. */
  canonicalRoleCategory: string;
  classifiedBy: RoleClassifiedBy;
  /** Why, in words a person can check. */
  reason: string;
}

interface DeclaredRole {
  profileRoleCategory: string;
  canonical: string;
  titles: string[];
  priority: number;
}

export function declaredRoles(profile: any): DeclaredRole[] {
  const roles: DeclaredRole[] = [];
  for (const entry of profile?.decision_maker_roles ?? []) {
    const profileRoleCategory = typeof entry?.role_category === 'string'
      ? entry.role_category : null;
    if (!profileRoleCategory) continue;
    roles.push({
      profileRoleCategory,
      canonical: typeof entry?.canonical_role_category === 'string'
        ? entry.canonical_role_category : '',
      titles: (entry?.titles ?? [])
        .map((title: unknown) => String(title).toLowerCase().trim())
        .filter((title: string) => title.length > 0),
      priority: Number(entry?.priority ?? 99),
    });
  }
  return roles;
}

function insufficient(rawTitle: string | null): RoleClassification {
  return {
    rawTitle,
    normalizedTitle: null,
    profileRoleCategory: null,
    canonicalRoleCategory: 'unknown',
    classifiedBy: 'INSUFFICIENT_EVIDENCE',
    reason: rawTitle
      ? `Nothing recognised "${rawTitle}": no vertical lists it and no generic `
        + 'pattern matches. Unknown is the honest answer rather than a guess.'
      : 'No title was given, so there is nothing to classify.',
  };
}

/**
 * Classifies a title against a vertical's declared roles, then the generic patterns.
 *
 * A profile match wins because the trade knows its own titles: "estimator" means a
 * salesperson at a collision shop and nothing in particular elsewhere.
 */
export async function classifyRole(input: {
  rawTitle: string | null | undefined;
  verticalProfileId?: string | null;
}): Promise<RoleClassification> {
  const rawTitle = input.rawTitle?.trim() ? input.rawTitle.trim() : null;
  if (!rawTitle) return insufficient(null);
  const lowered = rawTitle.toLowerCase();

  if (input.verticalProfileId) {
    const profile = await getVerticalProfile(input.verticalProfileId);
    const roles = declaredRoles(profile)
      .sort((left, right) => left.priority - right.priority);

    // Longest title first, so "managing broker" is not decided by "broker".
    const candidates = roles
      .flatMap((role) => role.titles.map((title) => ({ role, title })))
      .sort((left, right) => right.title.length - left.title.length);

    for (const candidate of candidates) {
      if (!lowered.includes(candidate.title)) continue;
      if (!candidate.role.canonical) {
        // A declared role with no canonical mapping. The contract validator fails on
        // this; here it degrades to unknown rather than picking one.
        return {
          rawTitle,
          normalizedTitle: candidate.title,
          profileRoleCategory: candidate.role.profileRoleCategory,
          canonicalRoleCategory: 'unknown',
          classifiedBy: 'INSUFFICIENT_EVIDENCE',
          reason: `${input.verticalProfileId} lists "${candidate.title}" under `
            + `${candidate.role.profileRoleCategory} and declares no `
            + 'canonical_role_category for it, so there is nothing to file it under.',
        };
      }
      return {
        rawTitle,
        normalizedTitle: candidate.title,
        profileRoleCategory: candidate.role.profileRoleCategory,
        canonicalRoleCategory: candidate.role.canonical,
        classifiedBy: 'PROFILE_ROLE_TITLE',
        reason: `${input.verticalProfileId} lists "${candidate.title}" as `
          + `${candidate.role.profileRoleCategory}, which files under `
          + `${candidate.role.canonical}.`,
      };
    }

    // The title names a profile role directly -- "operations" against a role called
    // operations -- without being one of its listed titles.
    for (const role of roles) {
      if (!role.canonical) continue;
      const spoken = role.profileRoleCategory.replace(/_/g, ' ');
      if (!lowered.includes(spoken)) continue;
      return {
        rawTitle,
        normalizedTitle: spoken,
        profileRoleCategory: role.profileRoleCategory,
        canonicalRoleCategory: role.canonical,
        classifiedBy: 'PROFILE_ROLE_CATEGORY',
        reason: `The title names ${input.verticalProfileId}'s `
          + `${role.profileRoleCategory} role, which files under ${role.canonical}.`,
      };
    }
  }

  const generic = roleCategoryFromTitle(rawTitle);
  if (generic !== 'unknown') {
    return {
      rawTitle,
      normalizedTitle: null,
      profileRoleCategory: null,
      canonicalRoleCategory: generic,
      classifiedBy: 'GENERIC_PATTERN',
      reason: `No vertical lists this title; the generic patterns read it as `
        + `${generic}.`,
    };
  }

  return insufficient(rawTitle);
}
