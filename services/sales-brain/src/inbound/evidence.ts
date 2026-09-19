/**
 * The evidence tiers and freshness windows an inbound callback match is built from.
 * Authority: YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md §4, §7.
 *
 * These are separated from the resolver so the rules can be read, cited and changed
 * without reading a query, and so a test can assert the ordering rather than infer
 * it from behaviour.
 *
 * The whole point of a freshness window is that an ancient missed call must not turn
 * a phone number into a callback for ever. A number we rang once, eight months ago,
 * that never answered, is not a relationship; treating it as one would have the
 * inbound agent greet a stranger as somebody we know.
 */

/** Ranked strongest first. The first signal that matches at its own freshness decides. */
export type EvidenceKind =
  | 'REQUESTED_CALLBACK'
  | 'ACTIVE_OPPORTUNITY'
  | 'CONFIRMED_UPCOMING_MEETING'
  | 'POSITIVE_REPLY'
  | 'RECENT_TWO_WAY_CONVERSATION'
  | 'RECENT_CONNECTED_OUTBOUND'
  | 'RECENT_OUTBOUND_ATTEMPT'
  | 'STALE_OUTBOUND_ATTEMPT'
  | 'FUZZY_COMPANY_ASSOCIATION';

export type EvidenceStrength = 'HIGHEST' | 'MEDIUM' | 'WEAK';

export interface EvidenceRule {
  kind: EvidenceKind;
  strength: EvidenceStrength;
  /**
   * How long this signal keeps a number in callback mode, in hours. Null means the
   * signal does not expire on its own -- an open opportunity is a relationship
   * whether it was opened yesterday or in March.
   */
  freshnessHours: number | null;
  /** Why this window and not another. Read by an operator, not by the code. */
  rationale: string;
}

/**
 * The ladder. Order is meaning: a stronger rule that matches ends the search, so a
 * confirmed meeting is never overridden by an older cold attempt underneath it.
 */
export const EVIDENCE_RULES: readonly EvidenceRule[] = [
  {
    kind: 'REQUESTED_CALLBACK', strength: 'HIGHEST', freshnessHours: 24 * 30,
    rationale: 'They asked us to call them back. Somebody returning that call is the '
      + 'clearest callback there is, and a month is generous because people are busy.',
  },
  {
    kind: 'ACTIVE_OPPORTUNITY', strength: 'HIGHEST', freshnessHours: null,
    rationale: 'An open opportunity is a live relationship. It does not go stale on a '
      + 'clock; it goes stale when somebody closes it.',
  },
  {
    kind: 'CONFIRMED_UPCOMING_MEETING', strength: 'HIGHEST', freshnessHours: null,
    rationale: 'A meeting in the diary is a relationship whatever else is true. The '
      + 'window is the meeting itself, checked separately.',
  },
  {
    kind: 'POSITIVE_REPLY', strength: 'HIGHEST', freshnessHours: 24 * 14,
    rationale: 'They wrote back with interest. Two weeks is long enough to cover a '
      + 'holiday and short enough that the thread is still in their head.',
  },
  {
    kind: 'RECENT_TWO_WAY_CONVERSATION', strength: 'HIGHEST', freshnessHours: 24 * 14,
    rationale: 'We actually spoke. A person who talked to us a fortnight ago and rings '
      + 'back is continuing that conversation.',
  },
  {
    kind: 'RECENT_CONNECTED_OUTBOUND', strength: 'MEDIUM', freshnessHours: 24 * 7,
    rationale: 'The call connected, even if it went nowhere. A week keeps it a '
      + 'callback; beyond that it is a cold number again.',
  },
  {
    kind: 'RECENT_OUTBOUND_ATTEMPT', strength: 'MEDIUM', freshnessHours: 48,
    rationale: 'We rang and nobody answered. Somebody calling the number back within '
      + 'two days is almost certainly returning a missed call; after that they are '
      + 'more likely calling about something else entirely.',
  },
  {
    kind: 'STALE_OUTBOUND_ATTEMPT', strength: 'WEAK', freshnessHours: null,
    rationale: 'Older than every window above. Recorded so the resolver can say why it '
      + 'chose general handling, and never strong enough to choose callback.',
  },
  {
    kind: 'FUZZY_COMPANY_ASSOCIATION', strength: 'WEAK', freshnessHours: null,
    rationale: 'The number is near this company in the graph but is not one of its '
      + 'endpoints. Never enough on its own.',
  },
];

const BY_KIND = new Map(EVIDENCE_RULES.map((rule) => [rule.kind, rule]));

export function evidenceRule(kind: EvidenceKind): EvidenceRule {
  const rule = BY_KIND.get(kind);
  if (!rule) throw new Error(`no evidence rule for ${kind}`);
  return rule;
}

/** Rank, lower is stronger. Used to order competing signals deterministically. */
export function evidenceRank(kind: EvidenceKind): number {
  const index = EVIDENCE_RULES.findIndex((rule) => rule.kind === kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Only HIGHEST and MEDIUM evidence can put a call into callback mode. */
export function canEstablishCallback(kind: EvidenceKind): boolean {
  return evidenceRule(kind).strength !== 'WEAK';
}

/** True when a signal observed at `at` is still inside its window. */
export function isFresh(kind: EvidenceKind, at: Date, now: Date): boolean {
  const rule = evidenceRule(kind);
  if (rule.freshnessHours === null) return true;
  return now.getTime() - at.getTime() <= rule.freshnessHours * 3_600_000;
}
