/**
 * Who to ask for, said separately from what the record says they are.
 *
 * Two questions a rep conflates at their peril:
 *
 *   VERIFIED ROLE      what a source establishes. A filing says "Manager". A licence
 *                      says "Responsible Master Plumber". Never inferred, never
 *                      upgraded, never replaced with a friendlier word.
 *   LIKELY BEST CONTACT who is probably worth asking for first. A judgement, made from
 *                      the roles we hold, and labelled as a judgement.
 *
 * Keeping them in one field is how "qualifying agent" becomes "owner" in a CRM and
 * then becomes "can I speak to the owner?" on a phone call to somebody who has never
 * owned anything. They are separate fields here and separate labels in the UI.
 *
 * OWNER is only ever printed when a source actually said owner.
 */

export type ContactConfidence = 'NAMED_AND_VERIFIED' | 'NAMED_UNVERIFIED' | 'ROLE_ONLY';

export interface BestContact {
  personName: string | null;
  /** The role a source established, in that source's own words. */
  verifiedRole: string;
  /** Why this person is the suggested first ask. */
  reason: string;
  confidence: ContactConfidence;
  /** True only when a source explicitly established ownership. */
  isOwner: boolean;
  /** What to say when asking for them, given what we actually know. */
  askFor: string;
}

/**
 * Roles worth asking for first, best-first.
 *
 * Ordered by who tends to own the problems this product sells into, not by seniority
 * in the abstract: an operations manager is a better first call than a director who
 * has never seen the intake queue.
 */
const PREFERENCE: { relationship: string; label: string; rank: number }[] = [
  { relationship: 'OWNER', label: 'owner', rank: 0 },
  { relationship: 'FOUNDER', label: 'founder', rank: 1 },
  { relationship: 'PRESIDENT', label: 'president', rank: 2 },
  { relationship: 'CEO', label: 'chief executive', rank: 2 },
  { relationship: 'MANAGING_PARTNER', label: 'managing partner', rank: 3 },
  { relationship: 'BROKER_OWNER', label: 'broker-owner', rank: 3 },
  { relationship: 'GENERAL_MANAGER', label: 'general manager', rank: 4 },
  { relationship: 'OPERATIONS', label: 'operations manager', rank: 5 },
  { relationship: 'SERVICE_MANAGER', label: 'service manager', rank: 6 },
  { relationship: 'MARKETING', label: 'marketing manager', rank: 7 },
  { relationship: 'SALES_LEADERSHIP', label: 'sales manager', rank: 8 },
  { relationship: 'OFFICE_MANAGER', label: 'office manager', rank: 9 },
  { relationship: 'MANAGER', label: 'manager', rank: 10 },
];

/**
 * Roles that establish a person exists without saying they run anything.
 *
 * These can still be the best available name -- on a small company the qualifying
 * agent usually is the person to talk to -- but the suggestion has to say that it is
 * a guess built on a regulatory record rather than on evidence about the business.
 */
const EVIDENCE_ONLY = new Set([
  'QUALIFIER', 'LICENSE_HOLDER', 'OFFICER', 'MEMBER',
]);

/** Never a cold-call target on the strength of a filing. */
const NEVER_SUGGEST = new Set(['REGISTERED_AGENT']);

const ROLE_WORDS: Record<string, string> = {
  QUALIFIER: 'qualifying agent',
  LICENSE_HOLDER: 'licence holder',
  OFFICER: 'officer on a public filing',
  MEMBER: 'member on a public filing',
  REGISTERED_AGENT: 'registered agent',
};

export interface BestContactInput {
  personName: string | null;
  relationship: string;
  rawTitle: string | null;
  /** True when the company's own site named them, rather than a filing. */
  fromFirstParty: boolean;
}

/**
 * Picks who to ask for, and says how sure that is.
 *
 * Returns null rather than guessing when the only people we hold are ones a public
 * record names for reasons unrelated to running the business.
 */
export function chooseBestContact(people: BestContactInput[]): BestContact | null {
  const candidates = people.filter((person) =>
    person.personName && !NEVER_SUGGEST.has(person.relationship));
  if (candidates.length === 0) return null;

  const rankOf = (person: BestContactInput): number => {
    const preference = PREFERENCE.find((entry) => entry.relationship === person.relationship);
    if (preference) return preference.rank;
    // An evidence-only role is a real person but a weak reason, so it sorts below
    // every operational role and above nothing.
    return EVIDENCE_ONLY.has(person.relationship) ? 50 : 40;
  };

  const sorted = [...candidates].sort((left, right) => {
    const byRank = rankOf(left) - rankOf(right);
    if (byRank !== 0) return byRank;
    // The company naming someone beats a filing naming them: a website says who works
    // there now, a filing says who signed something once.
    return Number(right.fromFirstParty) - Number(left.fromFirstParty);
  });

  const chosen = sorted[0]!;
  const evidenceOnly = EVIDENCE_ONLY.has(chosen.relationship);
  const isOwner = chosen.relationship === 'OWNER';

  const role = chosen.rawTitle ?? ROLE_WORDS[chosen.relationship]
    ?? PREFERENCE.find((entry) => entry.relationship === chosen.relationship)?.label
    ?? chosen.relationship.replace(/_/g, ' ').toLowerCase();

  return {
    personName: chosen.personName,
    verifiedRole: role,
    isOwner,
    confidence: evidenceOnly ? 'NAMED_UNVERIFIED'
      : chosen.fromFirstParty ? 'NAMED_AND_VERIFIED' : 'NAMED_UNVERIFIED',
    reason: evidenceOnly
      ? `The only named person we hold. A public record names them as ${role}, which `
        + 'establishes they are connected to the company but not that they run it.'
      : chosen.fromFirstParty
        ? `The company's own site names them as ${role}.`
        : `A public record names them as ${role}.`,
    // What a rep should actually say. Asking for "the owner" when the record says
    // qualifying agent is how a call starts badly.
    askFor: evidenceOnly
      ? `Ask for ${chosen.personName} by name rather than by title — the title we `
        + 'hold is a regulatory one.'
      : `Ask for ${chosen.personName}, ${role}.`,
  };
}
