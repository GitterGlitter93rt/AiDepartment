import { automatedDiscoveryPredicate } from './discoverySources.js';

/**
 * Whether this record has been established to be a company.
 *
 * A separate question from whether it has been researched, whether it is reachable,
 * whether it is compliant and whether it is worth calling. Those were all one idea
 * called "ready", and a freshly researched directory page satisfied every one of
 * them: the research ran, the phone number resolved, the compliance check passed,
 * and the thing at the end of it was Yelp.
 */
export type AccountEntityStatus =
  | 'legacy_unverified' | 'verified' | 'needs_review' | 'quarantined' | 'rejected';

/** Statuses that say outright this is not something to hand a person. */
const REFUSED: ReadonlySet<string> = new Set(['rejected', 'quarantined', 'needs_review']);

export interface EntityGate {
  /** True when a person may claim, call or pilot this record. */
  workable: boolean;
  /** Operator-readable, and safe to show a rep. Empty when workable. */
  reason: string;
}

/**
 * The gate, in one place, for claiming and for the pilot.
 *
 * `legacy_unverified` is deliberately not a single answer. Everything in the table
 * predates the promotion rules, so the status alone cannot separate the 65 SERP rows
 * the canary created from the companies somebody imported or typed in. How it was
 * found can: a machine reading a search page is exactly the provenance that produced
 * the junk, and an import or a person is exactly the provenance that did not. So an
 * unverified mined record fails closed and an unverified imported one keeps working,
 * which is what "additive, nothing existing is deleted or broken" has to mean in
 * practice.
 */
export function entityGate(input: {
  entityStatus: string | null; foundByMachine: boolean;
}): EntityGate {
  const status = input.entityStatus ?? 'legacy_unverified';
  if (status === 'verified') return { workable: true, reason: '' };
  if (REFUSED.has(status)) {
    return {
      workable: false,
      reason: status === 'rejected'
        ? 'This record was found in a search result and has been established not to be '
          + 'a company. It cannot be worked.'
        : status === 'quarantined'
        ? 'This record is quarantined: something about it did not hold up, and it is '
          + 'held out of the working list until somebody looks.'
        : 'Nothing has yet confirmed this is a company rather than a page about one. '
          + 'It needs verifying before it can be worked.',
    };
  }
  if (input.foundByMachine) {
    return {
      workable: false,
      reason: 'This record was created by a discovery run that predates entity '
        + 'verification, so nothing has confirmed it names a company. Reprocess the '
        + 'run that found it, or verify it, before working it.',
    };
  }
  // Imported or entered by a person. Its provenance was never a search result.
  return { workable: true, reason: '' };
}

/**
 * The same rule as SQL, for read models that must not list what cannot be worked.
 *
 * Written from the same constants as `entityGate` rather than beside it: the two
 * drifting apart would mean a rep sees a company in a list and is refused when they
 * click it, which is worse than either answer on its own.
 */
export function workableEntitySql(accountAlias: string): string {
  return `(${accountAlias}.entity_status = 'verified'
    or (${accountAlias}.entity_status = 'legacy_unverified' and not exists (
          select 1 from activities act
           where act.account_id = ${accountAlias}.account_id
             and act.activity_type = 'DISCOVERED'
             and ${automatedDiscoveryPredicate('act.source_system')})))`;
}
