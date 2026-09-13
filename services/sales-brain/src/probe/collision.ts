import { normalizePhone, normalizeHostname, registrableDomain } from '../domain/normalize.js';

/**
 * Which pool number a probe may use, and which it may not.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §11.
 *
 * The pool is shared on purpose: at a hundred audits a night, one number per
 * prospect is a number-purchasing programme rather than a measurement. Many probes
 * per number is normal, and the probe ledger -- not the number -- carries identity.
 *
 * What is not acceptable is round-robin. Round-robin will eventually put two
 * companies that share a phone system on the same number at the same time, and from
 * that moment every response from that system is permanently ambiguous. There is no
 * recovering the measurement afterwards, so the allocator has to refuse in advance.
 *
 * The refusal is the important part. When every active number collides, the probe
 * waits. A forced assignment buys one measurement and destroys its own attribution,
 * which is worse than not measuring: it produces a number somebody might say out
 * loud.
 */

export interface CollisionInput {
  /** Every phone number known for the Account, including alternates and toll-free. */
  phones: readonly (string | null | undefined)[];
  /** Call-centre, answering-service or franchise numbers, where known separately. */
  alternatePhones?: readonly (string | null | undefined)[];
  /** Franchise or brand identifier, where the Account carries one. */
  franchiseId?: string | null;
  /** Corporate parent / ownership group, from the merge and ownership model. */
  corporateParentId?: string | null;
  /** The Account's own domain. */
  domain?: string | null;
  /** Lead-portal or LSA account identifier, where known. */
  leadPortalAccountId?: string | null;
}

/**
 * The keys that make two probes indistinguishable to an inbound event.
 *
 * Namespaced (`phone:`, `brand:`) so two different kinds of identifier cannot
 * collide by coincidence -- a franchise whose id happens to be ten digits should not
 * intersect a phone number.
 */
export function collisionKeys(input: CollisionInput): string[] {
  const keys = new Set<string>();

  for (const raw of [...input.phones, ...(input.alternatePhones ?? [])]) {
    const normalized = normalizePhone(raw);
    if (normalized) keys.add(`phone:${normalized}`);
  }

  if (input.franchiseId) keys.add(`brand:${input.franchiseId.trim().toLowerCase()}`);
  if (input.corporateParentId) keys.add(`parent:${input.corporateParentId}`);
  if (input.leadPortalAccountId) keys.add(`portal:${input.leadPortalAccountId.trim().toLowerCase()}`);

  const host = normalizeHostname(input.domain);
  if (host) {
    // The registrable domain, not the hostname: two locations of one company on
    // `jax.example.com` and `staug.example.com` are one phone system to a caller.
    keys.add(`domain:${registrableDomain(host)}`);
  }

  return [...keys].sort();
}

export function collides(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((key) => set.has(key));
}

/** The keys two probes actually share, for the record rather than for the decision. */
export function sharedKeys(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(a);
  return b.filter((key) => set.has(key));
}

export interface PoolNumberState {
  poolNumberId: string;
  e164: string;
  status: 'ACTIVE' | 'QUARANTINED' | 'RELEASED';
  marketAffinity: string | null;
  maxConcurrentOpenProbes: number;
  quarantinedUntil: Date | null;
  /** Collision keys of every probe currently open on this number. */
  openProbes: readonly { probeId: string; collisionKeys: readonly string[] }[];
}

export type AllocationOutcome =
  | { allocated: true; poolNumberId: string; e164: string; reason: string }
  | { allocated: false; reason: AllocationRefusal; detail: string;
      collidingWith: readonly string[] };

export type AllocationRefusal =
  /** Every active number already holds a probe this one would be confused with. */
  | 'DEFERRED_COLLISION'
  /** Numbers exist and are all at their attribution-quality cap. */
  | 'DEFERRED_CAPACITY'
  /** No usable number in the pool at all. */
  | 'NO_POOL_NUMBER';

/**
 * Pick a number, or decline.
 *
 * Preference order among numbers that are *allowed* is deliberately secondary:
 * market affinity makes a callback look local, fewest-open protects the
 * identification rung, and least-recently-used spreads wear. None of them may
 * override a collision.
 */
export function allocatePoolNumber(input: {
  candidateKeys: readonly string[];
  pool: readonly PoolNumberState[];
  marketAffinity?: string | null;
  now: Date;
}): AllocationOutcome {
  const usable = input.pool.filter((number) => {
    if (number.status !== 'ACTIVE') return false;
    // A quarantined tail keeps a late response attributable to the probe that
    // earned it rather than to whoever inherited the number.
    if (number.quarantinedUntil && number.quarantinedUntil > input.now) return false;
    return true;
  });

  if (usable.length === 0) {
    return {
      allocated: false, reason: 'NO_POOL_NUMBER', collidingWith: [],
      detail: 'No active, un-quarantined pool number exists.',
    };
  }

  const collidingWith = new Set<string>();
  const collidingKeys = new Set<string>();
  const eligible: PoolNumberState[] = [];
  let blockedByCapacity = 0;

  for (const number of usable) {
    const clash = number.openProbes.filter(
      (open) => collides(input.candidateKeys, open.collisionKeys));
    if (clash.length > 0) {
      for (const open of clash) {
        collidingWith.add(open.probeId);
        // Which key, not just which probe. "Deferred" is not actionable; "deferred
        // because these five companies publish one toll-free line" tells an operator
        // whether to grow the pool or to accept that this market clusters.
        for (const key of sharedKeys(input.candidateKeys, open.collisionKeys)) {
          collidingKeys.add(key);
        }
      }
      continue;
    }
    if (number.openProbes.length >= number.maxConcurrentOpenProbes) {
      blockedByCapacity += 1;
      continue;
    }
    eligible.push(number);
  }

  if (eligible.length === 0) {
    // Which refusal it is matters operationally: collision means the market has
    // clusters and the pool may need to grow; capacity means the cap is the limit.
    if (collidingWith.size > 0) {
      return {
        allocated: false, reason: 'DEFERRED_COLLISION',
        collidingWith: [...collidingWith],
        detail: `Every active number already holds a probe sharing a collision key `
          + `(${collidingWith.size} open probe(s) conflict on `
          + `${[...collidingKeys].join(', ')}). Deferred rather than assigned: a `
          + 'forced assignment would make both unattributable.',
      };
    }
    return {
      allocated: false, reason: 'DEFERRED_CAPACITY', collidingWith: [],
      detail: `All ${blockedByCapacity} usable number(s) are at their concurrent-open `
        + 'cap, which guards identification-question attribution.',
    };
  }

  eligible.sort((a, b) => {
    const wantMarket = input.marketAffinity ?? null;
    if (wantMarket) {
      const aMatch = a.marketAffinity === wantMarket ? 0 : 1;
      const bMatch = b.marketAffinity === wantMarket ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    if (a.openProbes.length !== b.openProbes.length) {
      return a.openProbes.length - b.openProbes.length;
    }
    return a.e164.localeCompare(b.e164);
  });

  const chosen = eligible[0]!;
  return {
    allocated: true, poolNumberId: chosen.poolNumberId, e164: chosen.e164,
    reason: `No open probe on ${chosen.e164} shares a collision key; `
      + `${chosen.openProbes.length} of ${chosen.maxConcurrentOpenProbes} slots in use.`,
  };
}
