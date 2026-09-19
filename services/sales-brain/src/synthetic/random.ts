/**
 * Deterministic pseudo-randomness for synthetic fixtures.
 *
 * Every value in a generated dataset derives from one seed string, so a scale test
 * that fails at 25,000 accounts fails the same way on the next run and the offending
 * account can be regenerated on its own. Nothing here is cryptographic and nothing
 * here should ever be used for a token, an id or a secret.
 */

/** FNV-1a, to turn a seed string plus an index into a 32-bit state. */
export function seedFrom(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2f;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A finalising mix, so two seeds one apart do not produce correlated early output.
 *
 * Without this, mulberry32 seeded straight from an FNV hash of (seed, index) shows a
 * measurable artefact: for some seeds the eighth draw across the first two hundred
 * consecutive indices never once fell below 0.03, although the long-run rate was
 * 2.8%. A fixture is always read in slices -- the first N accounts, one market, one
 * vertical -- so a skewed slice is not a curiosity, it is a wrong fixture.
 */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Draws discarded after seeding, to move off the seed-correlated head of the stream. */
const WARMUP_DRAWS = 6;

export class Rng {
  private state: number;

  constructor(...seedParts: (string | number)[]) {
    // A zero state would make mulberry32 degenerate.
    this.state = mix32(seedFrom(...seedParts)) || 0x9e3779b9;
    for (let i = 0; i < WARMUP_DRAWS; i += 1) this.next();
  }

  /** mulberry32: small, fast, and good enough for fixture shape. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks by weight. Weights need not sum to one. */
  weighted<T>(entries: readonly [T, number][]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let target = this.next() * total;
    for (const [value, weight] of entries) {
      target -= weight;
      if (target <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  // There is deliberately no uuid() here. A 32-bit state cannot promise unique ids
  // across tens of thousands of seeds, and a fixture that fails on a primary-key
  // collision teaches nothing. Identity comes from randomUUID; this class decides
  // shape.

  /** Shuffles a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /** A date offset from a fixed origin, so a run is not time-dependent. */
  daysAgo(min: number, max: number, origin: Date): Date {
    const days = this.int(min, max);
    return new Date(origin.getTime() - days * 86_400_000);
  }
}
