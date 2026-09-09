import { query } from '../db/pool.js';
import {
  isKnownSignal, isCollectable, nearestSignalNames, signalFor,
  type SignalSubject,
} from './signalRegistry.js';
import { resolvePrimaryHookOrder } from './hooks.js';
import { declaredRoles } from './roles.js';
import { isKnownOffer, nearestOfferNames, offerFor } from './offerCatalog.js';

/**
 * Whether a vertical profile says only things the runtime understands.
 *
 * The defect class this exists to end: configuration that is syntactically valid and
 * semantically disconnected. A trigger naming a signal nobody defined, a role the
 * runtime silently files as unknown, an offer id that matches no product, two fields
 * quietly competing to order the same list. All of it passed every check we had,
 * because every check we had was about shape.
 *
 * The distinction the validator exists to preserve: **an unknown reference is a typo
 * and a known reference with no source is a purchase.** Collapsing them is how
 * twenty-seven document defects hid behind two missing data feeds. They are reported
 * as different kinds and only one of them fails a build.
 *
 * Suggestions are printed as diagnostics and never applied. Fuzzy-matching
 * production configuration is how a signal about a market becomes a claim about a
 * company.
 */

export type ViolationKind =
  /** No one has defined this name. A typo, or an idea that was never implemented. */
  | 'UNKNOWN_SIGNAL'
  /** Defined, understood, and needs data this system does not have. Not a defect. */
  | 'SOURCE_UNAVAILABLE'
  /** Defined, needs no special capability, and nothing writes it. A gap in code. */
  | 'NO_PRODUCER'
  /** A company trigger pointed at a market fact, or the reverse. */
  | 'SUBJECT_MISMATCH'
  /** A declared decision-maker role with no canonical category to file it under. */
  | 'MISSING_ROLE_MAPPING'
  /** An offer id that is not in the global catalog. */
  | 'UNKNOWN_OFFER'
  /** Two fields claiming authority over the same ordering. */
  | 'COMPETING_HOOK_AUTHORITY'
  /** A hypothesis that can never surface, because nothing it needs is collectable. */
  | 'HYPOTHESIS_CANNOT_FIRE';

/** Kinds that fail a build. The rest are reported and expected to be read. */
export const BLOCKING: ReadonlySet<ViolationKind> = new Set<ViolationKind>([
  'UNKNOWN_SIGNAL', 'SUBJECT_MISMATCH', 'MISSING_ROLE_MAPPING', 'UNKNOWN_OFFER',
  'COMPETING_HOOK_AUTHORITY', 'NO_PRODUCER',
]);

export interface Violation {
  vertical: string;
  /** The profile section, as the author would name it. */
  section: string;
  /** Where exactly, in the shape the document has. */
  path: string;
  reference: string;
  kind: ViolationKind;
  detail: string;
  /** Diagnostic only. Never applied, never used to rewrite configuration. */
  suggestions: string[];
}

/** Trigger names satisfied by a captured prospect statement rather than by evidence. */
const PROSPECT_STATEMENT_PREFIXES = ['prospect_confirms_', 'prospect_mentions_'];

function isProspectStatementSignal(id: string): boolean {
  return PROSPECT_STATEMENT_PREFIXES.some((prefix) => id.startsWith(prefix));
}

interface ProfileRow { vertical_profile_id: string; definition: any }

async function activeProfiles(): Promise<ProfileRow[]> {
  const { rows } = await query<ProfileRow>(
    'select vertical_profile_id, definition from vertical_profiles where is_active order by 1');
  return rows;
}

function profileOf(row: ProfileRow): any {
  return row.definition?.profile ?? row.definition ?? {};
}

/** signal_id -> claim key, as this profile declares it. */
function declaredSignals(profile: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of profile.public_signal_rules ?? []) {
    if (typeof rule?.signal_id === 'string' && typeof rule?.evidence_claim_key === 'string') {
      map.set(rule.signal_id, rule.evidence_claim_key);
    }
  }
  return map;
}

/**
 * What a trigger name resolves to, and how.
 *
 * Three routes, in order: the profile's own declaration, a canonical signal named
 * directly, or a prospect statement captured under that name. Anything else is
 * unresolved, and the caller decides what kind of problem that is.
 */
export function resolveTrigger(
  triggerId: string, declared: Map<string, string>,
): { claimKey: string | null; via: 'PROFILE' | 'CANONICAL' | 'PROSPECT_STATEMENT' | null } {
  const mapped = declared.get(triggerId);
  if (mapped) return { claimKey: mapped, via: 'PROFILE' };
  if (isKnownSignal(triggerId)) return { claimKey: triggerId, via: 'CANONICAL' };
  if (isProspectStatementSignal(triggerId)) {
    return { claimKey: triggerId, via: 'PROSPECT_STATEMENT' };
  }
  return { claimKey: null, via: null };
}

function triggerViolation(
  vertical: string, hypothesisId: string, index: number, triggerId: string,
  declared: Map<string, string>,
): Violation | null {
  const path = `leak_hypotheses[${hypothesisId}].trigger_signals[${index}]`;
  const { claimKey, via } = resolveTrigger(triggerId, declared);

  if (claimKey === null) {
    return {
      vertical, section: 'leak_hypotheses', path, reference: triggerId,
      kind: 'UNKNOWN_SIGNAL',
      detail: 'No canonical signal has this name, this profile does not declare it in '
        + 'public_signal_rules, and it is not a prospect statement. Nothing can ever '
        + 'satisfy it, so the hypothesis cannot surface.',
      suggestions: nearestSignalNames(triggerId),
    };
  }

  // A statement somebody captured needs no registry entry beyond its own name.
  if (via === 'PROSPECT_STATEMENT' && !isKnownSignal(claimKey)) return null;

  const signal = signalFor(claimKey);
  if (!signal) {
    return {
      vertical, section: 'leak_hypotheses', path, reference: triggerId,
      kind: 'UNKNOWN_SIGNAL',
      detail: `This profile maps it to the claim key "${claimKey}", which no canonical `
        + 'signal defines. The declaration and the registry disagree.',
      suggestions: nearestSignalNames(claimKey),
    };
  }

  // A hypothesis is about the company being called. Market evidence is about a place.
  if (signal.subject !== 'COMPANY' && signal.subject !== 'CONTACT') {
    const allowed: SignalSubject[] = ['MARKET', 'SEARCH_OBSERVATION', 'RELATIONSHIP'];
    if (allowed.includes(signal.subject)) {
      return {
        vertical, section: 'leak_hypotheses', path, reference: triggerId,
        kind: 'SUBJECT_MISMATCH',
        detail: `"${claimKey}" is a ${signal.subject} fact and a hypothesis trigger is `
          + 'a statement about the company being called. ' + signal.description,
        suggestions: [],
      };
    }
  }

  if (signal.requiredCapability !== null) {
    return {
      vertical, section: 'leak_hypotheses', path, reference: triggerId,
      kind: 'SOURCE_UNAVAILABLE',
      detail: `"${claimKey}" is understood and cannot be collected: it needs `
        + `${signal.requiredCapability}, which this system does not have. Its state `
        + 'stays UNKNOWN, never false, and the hypothesis waits rather than misfires.',
      suggestions: [],
    };
  }

  if (!isCollectable(claimKey)) {
    return {
      vertical, section: 'leak_hypotheses', path, reference: triggerId,
      kind: 'NO_PRODUCER',
      detail: `"${claimKey}" needs no special data source and nothing writes it. `
        + 'A gap in the code rather than in the configuration.',
      suggestions: [],
    };
  }

  return null;
}

export async function validateProfiles(): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const row of await activeProfiles()) {
    const vertical = row.vertical_profile_id;
    const profile = profileOf(row);
    const declared = declaredSignals(profile);

    // --- one order for the primary hook ----------------------------------------
    //
    // The two fields agree in every vertical that declares both, once
    // `base_priority` is read the way its numbers mean. This fails if they ever stop
    // agreeing, which is the only way they could become competing authorities again.
    const hookOrder = resolvePrimaryHookOrder(vertical, profile);
    if (hookOrder.disagreement) {
      violations.push({
        vertical, section: 'call_pack_defaults',
        path: 'call_pack_defaults.preferred_primary_hook_order',
        reference: hookOrder.disagreement.preferred.join(' > '),
        kind: 'COMPETING_HOOK_AUTHORITY',
        detail: 'This profile states a primary hook order and its hook_priorities '
          + 'imply a different one: '
          + `${hookOrder.disagreement.derived.join(' > ')}. One decision, one place. `
          + 'preferred_primary_hook_order is the authority, so either correct the '
          + 'base_priority numbers to match it or remove the explicit list.',
        suggestions: [],
      });
    }

    // --- every declared decision-maker role files somewhere ---------------------
    //
    // A role with no canonical mapping classifies as `unknown`, which is
    // indistinguishable from a title nobody recognised. That is the accident this
    // fails on: `unknown` must mean the evidence was insufficient, never that two
    // vocabularies drifted apart.
    for (const role of declaredRoles(profile)) {
      if (role.canonical) continue;
      violations.push({
        vertical, section: 'decision_maker_roles',
        path: `decision_maker_roles[${role.profileRoleCategory}].canonical_role_category`,
        reference: role.profileRoleCategory, kind: 'MISSING_ROLE_MAPPING',
        detail: 'This role declares no canonical_role_category, so every contact it '
          + 'matches would be filed as unknown for a reason that is not about the '
          + 'evidence. Map it to one of the runtime categories, or say unknown '
          + 'deliberately.',
        suggestions: [],
      });
    }

    // --- every offer a profile names must be one we can actually sell -----------
    //
    // The catalog is authoritative for what an offer is and every product entry
    // traces to a document. A profile may position an offer for its trade; it may
    // not name one that does not exist, because a rep would then be told to
    // recommend something nobody sells.
    const offerSites: { path: string; ids: unknown[] }[] = [];
    for (const entry of profile.offer_mapping ?? []) {
      offerSites.push({
        path: `offer_mapping[${entry?.opportunity_category ?? '?'}].possible_offer_families`,
        ids: entry?.possible_offer_families ?? [],
      });
    }
    for (const hypothesis of profile.leak_hypotheses ?? []) {
      offerSites.push({
        path: `leak_hypotheses[${hypothesis?.hypothesis_id ?? '?'}].offer_families`,
        ids: hypothesis?.offer_families ?? [],
      });
    }
    for (const site of offerSites) {
      for (const raw of site.ids) {
        const id = String(raw);
        if (isKnownOffer(id)) continue;
        violations.push({
          vertical, section: 'offer_mapping', path: site.path, reference: id,
          kind: 'UNKNOWN_OFFER',
          detail: 'No catalog offer has this id. The catalog is the only authority '
            + 'for what we sell, and a profile naming something outside it would put '
            + 'a recommendation in a rep\'s mouth for a product that does not exist.',
          suggestions: nearestOfferNames(id),
        });
      }
    }

    // --- signals a profile declares must themselves be known --------------------
    for (const [signalId, claimKey] of declared) {
      if (isKnownSignal(claimKey)) continue;
      violations.push({
        vertical, section: 'public_signal_rules',
        path: `public_signal_rules[${signalId}].evidence_claim_key`,
        reference: claimKey, kind: 'UNKNOWN_SIGNAL',
        detail: 'A profile may only declare a claim key the registry defines. Without '
          + 'one, nothing knows whose fact it is, who could produce it, or what its '
          + 'absence means.',
        suggestions: nearestSignalNames(claimKey),
      });
    }

    // --- triggers ---------------------------------------------------------------
    for (const hypothesis of profile.leak_hypotheses ?? []) {
      const hypothesisId = String(hypothesis?.hypothesis_id ?? '(unnamed)');
      const triggers: unknown[] = hypothesis?.trigger_signals ?? [];
      let collectable = 0;

      triggers.forEach((trigger, index) => {
        const found = triggerViolation(
          vertical, hypothesisId, index, String(trigger), declared);
        if (found) violations.push(found);
        else collectable += 1;
      });

      // A market condition is a fact about the place, validated against the opposite
      // subject rule: a hypothesis may say "this matters more where it has hailed"
      // without ever treating that as something the company did.
      const conditions: unknown[] = hypothesis?.market_condition_signals ?? [];
      conditions.forEach((condition, index) => {
        const id = String(condition);
        const { claimKey } = resolveTrigger(id, declared);
        const path = `leak_hypotheses[${hypothesisId}].market_condition_signals[${index}]`;
        if (claimKey === null) {
          violations.push({
            vertical, section: 'leak_hypotheses', path, reference: id,
            kind: 'UNKNOWN_SIGNAL',
            detail: 'No canonical signal has this name and this profile does not '
              + 'declare it.',
            suggestions: nearestSignalNames(id),
          });
          return;
        }
        const signal = signalFor(claimKey);
        if (signal && signal.subject !== 'MARKET') {
          violations.push({
            vertical, section: 'leak_hypotheses', path, reference: id,
            kind: 'SUBJECT_MISMATCH',
            detail: `"${claimKey}" is a ${signal.subject} fact. A market condition `
              + 'field may only hold facts about a place, or the two get used as '
              + 'evidence for each other.',
            suggestions: [],
          });
          return;
        }
        if (signal?.requiredCapability) {
          violations.push({
            vertical, section: 'leak_hypotheses', path, reference: id,
            kind: 'SOURCE_UNAVAILABLE',
            detail: `"${claimKey}" needs ${signal.requiredCapability}. Until one `
              + 'exists this condition neither qualifies nor disqualifies any '
              + 'company, and discovery proceeds without it.',
            suggestions: [],
          });
        }
      });

      if (triggers.length > 0 && collectable === 0) {
        violations.push({
          vertical, section: 'leak_hypotheses',
          path: `leak_hypotheses[${hypothesisId}].trigger_signals`,
          reference: hypothesisId, kind: 'HYPOTHESIS_CANNOT_FIRE',
          detail: 'Every trigger this hypothesis has is unavailable, so it can never '
            + 'surface for any company. Reported rather than removed: the moment a '
            + 'source exists it becomes correct.',
          suggestions: [],
        });
      }
    }
  }

  return violations;
}

export function renderViolations(violations: Violation[]): string {
  if (violations.length === 0) {
    return '\nPROFILE CONTRACT\n\n  Every executable reference in every active '
      + 'profile resolves to a canonical signal the runtime understands.\n\n';
  }

  const lines = ['', 'PROFILE CONTRACT', ''];
  const blocking = violations.filter((violation) => BLOCKING.has(violation.kind));
  const reported = violations.filter((violation) => !BLOCKING.has(violation.kind));

  const show = (list: Violation[], heading: string): void => {
    if (list.length === 0) return;
    lines.push(`  ${heading}`, '');
    for (const violation of list) {
      lines.push(`  [${violation.kind}] ${violation.vertical}`);
      lines.push(`     ${violation.path}`);
      lines.push(`     reference: ${violation.reference}`);
      lines.push(`     ${violation.detail}`);
      if (violation.suggestions.length > 0) {
        lines.push(`     nearest known names (diagnostic only, never applied): `
          + violation.suggestions.join(', '));
      }
      lines.push('');
    }
  };

  show(blocking, `${blocking.length} must be fixed — the configuration says something `
    + 'the runtime cannot act on');
  show(reported, `${reported.length} reported — understood, and waiting on a source `
    + 'rather than on a correction');
  return lines.join('\n');
}
