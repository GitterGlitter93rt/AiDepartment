import { judgePersonIdentity } from '../../resolver/personIdentity.js';
import { nameMatchesDomain } from '../../discovery/sourceRole.js';
import type { ApolloPersonCandidate } from './types.js';

/**
 * Choosing who to pay for.
 *
 * People Search costs nothing and returns titles, employer and — decisively —
 * `has_email`. So the expensive decision can be made on free information: rank the
 * candidates, take the one worth having, and only then buy an address, and only if Apollo
 * says there is one to buy.
 *
 * Titles are ranked for the trade rather than for a corporate hierarchy. At a
 * twelve-person HVAC company the owner is the decision maker and the "VP" is a job title
 * somebody gave themselves; at a national chain the reverse may hold. Since this inventory
 * is small local contractors, Owner and Founder outrank CEO, and a generic VP outranks
 * nothing.
 */

/** Titles worth searching for, in the order they matter to this business. */
export const DECISION_MAKER_TITLES: readonly string[] = [
  'Owner', 'Co-Owner', 'Founder', 'Co-Founder', 'President', 'Principal',
  'Managing Partner', 'Managing Member', 'Partner', 'CEO', 'Chief Executive Officer',
  'General Manager', 'Operations Manager', 'Vice President',
];

interface TitleRank { score: number; label: string }

/**
 * What a title is worth here.
 *
 * Deliberately not a corporate ladder. The brief's caution, and the right one: do not
 * assume VP outranks Owner, or CEO outranks Founder, without context. In this inventory
 * the context is that these are owner-operated contractors.
 */
export function rankTitle(title: string | null | undefined): TitleRank {
  const value = (title ?? '').toLowerCase();
  if (!value) return { score: 0, label: 'no title given' };
  if (/\b(co-?)?owner\b/.test(value)) return { score: 100, label: 'owner' };
  if (/\b(co-?)?founder\b/.test(value)) return { score: 95, label: 'founder' };
  if (/\bpresident\b/.test(value) && !/vice/.test(value)) return { score: 90, label: 'president' };
  if (/\bprincipal\b/.test(value)) return { score: 88, label: 'principal' };
  if (/\bmanaging (member|partner|director)\b/.test(value)) return { score: 85, label: 'managing member' };
  if (/\b(ceo|chief executive)\b/.test(value)) return { score: 80, label: 'chief executive' };
  if (/\bgeneral manager\b/.test(value)) return { score: 70, label: 'general manager' };
  if (/\boperations manager\b/.test(value)) return { score: 60, label: 'operations manager' };
  if (/\bpartner\b/.test(value)) return { score: 55, label: 'partner' };
  if (/\bvice president\b|\bvp\b/.test(value)) return { score: 45, label: 'vice president' };
  if (/\b(office|service|sales) manager\b/.test(value)) return { score: 35, label: 'a manager' };
  if (/\b(technician|installer|apprentice|dispatcher|receptionist)\b/.test(value)) {
    return { score: 5, label: 'not a decision-making role' };
  }
  return { score: 20, label: 'an unranked title' };
}

export interface ScoredCandidate {
  candidate: ApolloPersonCandidate;
  score: number;
  reasons: string[];
  /** False when the candidate must never become a decision maker. */
  admissible: boolean;
  rejection?: string;
}

export interface ScoringInput {
  companyName: string;
  canonicalDomain: string | null;
  /** The Apollo organization id we resolved for this Account, where we have one. */
  expectedOrganizationId?: string | null;
  city?: string | null;
  state?: string | null;
  /** A person the company's own site already names, which is the strongest corroboration. */
  firstPartyPersonNames?: readonly string[];
}

/**
 * Scores one candidate.
 *
 * Deterministic, and it records why. "Do not merely take result #1" is the instruction,
 * and the way to honour it is to be able to say what made this one better than that one
 * months later, when somebody asks why a rep is calling this person.
 */
export function scoreCandidate(candidate: ApolloPersonCandidate,
                               input: ScoringInput): ScoredCandidate {
  const reasons: string[] = [];

  /**
   * An Apollo person still has to be a person.
   *
   * The same gate the first-party path uses. A people graph is much less likely than a
   * website footer to hand back "wpadmin", but an organisation record filed as a person
   * is a shape both produce, and having one rule means the two cannot disagree.
   */
  const personhood = judgePersonIdentity({
    name: candidate.fullName ?? '',
    companyName: input.companyName,
    rawTitle: candidate.title,
  });
  if (!personhood.mayHoldDecisionMakerAuthority) {
    return { candidate, score: 0, reasons: personhood.reasons, admissible: false,
      rejection: `not a person: ${personhood.validity}` };
  }

  /**
   * The employer has to be this employer.
   *
   * Apollo returns people by their current company, and a stale record is a person who
   * left. Where we hold an organization id, that is the check; otherwise the company name
   * or the domain has to agree. Nothing else is allowed to substitute.
   */
  const orgIdAgrees = Boolean(input.expectedOrganizationId
    && candidate.apolloOrganizationId === input.expectedOrganizationId);
  const nameAgrees = Boolean(candidate.organizationName
    && normalize(candidate.organizationName).includes(normalize(input.companyName).slice(0, 10)));
  const domainAgrees = Boolean(candidate.organizationName
    && nameMatchesDomain(candidate.organizationName, input.canonicalDomain));

  if (!orgIdAgrees && !nameAgrees && !domainAgrees) {
    return { candidate, score: 0, reasons: [
      `Apollo lists this person at "${candidate.organizationName ?? 'no employer'}", which `
      + `does not agree with ${input.companyName}`], admissible: false,
      rejection: 'employer mismatch' };
  }

  let score = 0;
  if (orgIdAgrees) { score += 40; reasons.push('the Apollo organization id matches the one we resolved'); }
  else if (domainAgrees) { score += 30; reasons.push('the employer name agrees with our domain'); }
  else { score += 20; reasons.push('the employer name agrees with ours'); }

  const title = rankTitle(candidate.title);
  score += title.score;
  reasons.push(`title reads as ${title.label}`);

  // The company's own site naming the same person is the strongest thing there is, and it
  // is free.
  const firstParty = (input.firstPartyPersonNames ?? [])
    .some((n) => normalize(n) === normalize(candidate.fullName ?? ''));
  if (firstParty) { score += 50; reasons.push("the company's own site names this person too"); }

  if (input.state && candidate.state
      && candidate.state.toLowerCase() === input.state.toLowerCase()) {
    score += 5; reasons.push('located in the same state as the company');
  }

  /**
   * An address that exists is worth more than one that might.
   *
   * Free information that decides a paid decision: Apollo says up front whether it holds
   * an email, so a candidate with one is worth enriching and a candidate without one is
   * worth nothing at all.
   */
  if (candidate.hasEmail) { score += 15; reasons.push('Apollo holds an email for them'); }
  else reasons.push('Apollo holds no email for them, so enriching would buy nothing');

  return { candidate, score, reasons, admissible: true };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\b(inc|llc|ltd|co|corp|company|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface CandidateSelection {
  chosen: ScoredCandidate | null;
  ranked: ScoredCandidate[];
  /** True when two admissible candidates are too close to separate. */
  ambiguous: boolean;
  reason: string;
}

/**
 * Picks one, or declines to.
 *
 * Two plausible owners is not a reason to guess. An ambiguous answer is recorded as
 * ambiguous and goes to review, because a rep ringing up and asking for the wrong owner
 * costs more than the credit saved.
 */
export function selectDecisionMaker(candidates: readonly ApolloPersonCandidate[],
                                    input: ScoringInput): CandidateSelection {
  const ranked = candidates.map((c) => scoreCandidate(c, input))
    .sort((a, b) => b.score - a.score);
  const admissible = ranked.filter((c) => c.admissible && c.score > 0);

  if (admissible.length === 0) {
    return { chosen: null, ranked, ambiguous: false,
      reason: candidates.length === 0
        ? 'Apollo returned nobody at this company'
        : 'every candidate was refused: not a person, or not employed here' };
  }

  const [best, second] = admissible;
  // Close enough to be a coin toss, and both plausibly senior.
  if (second && best!.score - second.score < 10
      && rankTitle(second.candidate.title).score >= 80) {
    return { chosen: null, ranked, ambiguous: true,
      reason: `${admissible.length} candidates are too close to separate `
        + `(${best!.candidate.fullName} and ${second.candidate.fullName})` };
  }
  return { chosen: best!, ranked, ambiguous: false,
    reason: `${best!.candidate.fullName}: ${best!.reasons.join('; ')}` };
}
