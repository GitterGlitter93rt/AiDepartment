import { normalizePhone, normalizeCompanyName, normalizeHostname, registrableDomain } from '../domain/normalize.js';
import { tokenFromAddress } from './identity.js';

/**
 * Which probe an inbound event belongs to, if any.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §7.
 *
 * This is the ladder, kept as pure logic so every rung can be tested against a
 * fixture rather than inferred from behaviour -- the same reason
 * `src/inbound/evidence.ts` separates its tiers from its resolver.
 *
 * Two rules are structural rather than stylistic.
 *
 * **Sole occupancy is not on the ladder.** "Only one probe is open on this number,
 * so this must be it" is the shortcut everyone reaches for, and it is wrong: wrong
 * numbers, spam, and a previous probe's late response all arrive on that number too.
 * A number with one open probe contributes nothing on its own.
 *
 * **Ambiguity is an outcome, not a tie-break.** When two probes remain plausible the
 * answer is AMBIGUOUS with both candidates recorded, never the older one, never the
 * closer one. A response-time claim built on a coin toss has a company's name on it.
 */

export type AttributionTier =
  /** An email alias only one company was ever given. */
  | 'T0_EMAIL_TOKEN'
  /** Inbound number is a known main number for exactly one open probe. */
  | 'T1_KNOWN_ACCOUNT_NUMBER'
  /** Inbound number is a known alternate/call-centre number for exactly one. */
  | 'T2_KNOWN_ALTERNATE_NUMBER'
  /** The message says who it is from. */
  | 'T3_SELF_IDENTIFYING_SMS'
  /** A person answered the identification question. */
  | 'T4_IDENTIFICATION_ANSWER'
  /** Nothing decided it. */
  | 'T5_UNRESOLVED';

export type AttributionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type AttributionState = 'ATTRIBUTED' | 'AMBIGUOUS' | 'UNATTRIBUTED';

export interface OpenProbeCandidate {
  probeId: string;
  accountId: string;
  probeToken: string;
  accountName: string | null;
  accountDomain: string | null;
  phones: readonly string[];
  alternatePhones: readonly string[];
  /**
   * True when the alternate numbers are known to belong to this Account alone.
   * False for a franchise or call-centre number that could serve siblings, which
   * caps the rung at MEDIUM rather than letting it claim HIGH.
   */
  alternatesAreExclusive: boolean;
}

export interface AttributionInput {
  channel: 'CALL' | 'SMS' | 'EMAIL';
  fromNumber?: string | null;
  fromEmail?: string | null;
  /** The address the reply was sent to, which is where the alias token lives. */
  toEmail?: string | null;
  body?: string | null;
  /** Structured answer to "which company are you calling from?". */
  identificationAnswer?: string | null;
  /** Probes open on the pool number this event reached. */
  candidates: readonly OpenProbeCandidate[];
}

export interface AttributionResult {
  state: AttributionState;
  tier: AttributionTier;
  confidence: AttributionConfidence;
  probeId: string | null;
  /** Every probe that stayed plausible, so an AMBIGUOUS verdict is reviewable. */
  candidateProbeIds: string[];
  evidence: { code: string; detail: string }[];
}

function unresolved(
  candidates: readonly OpenProbeCandidate[],
  evidence: { code: string; detail: string }[],
): AttributionResult {
  // Two different failures, both producing no fact. "More than one plausible" is our
  // allocation letting two confusable probes share a number; "none matched" is an
  // event that may have nothing to do with any probe.
  const state: AttributionState = candidates.length > 1 ? 'AMBIGUOUS' : 'UNATTRIBUTED';
  return {
    state, tier: 'T5_UNRESOLVED', confidence: 'NONE', probeId: null,
    candidateProbeIds: candidates.map((probe) => probe.probeId),
    evidence,
  };
}

function digits10(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizePhone(value) ?? value;
  const raw = normalized.replace(/\D+/g, '');
  return raw.length >= 10 ? raw.slice(-10) : null;
}

function phoneSet(numbers: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const number of numbers) {
    const key = digits10(number);
    if (key) set.add(key);
  }
  return set;
}

export function attributeInboundEvent(input: AttributionInput): AttributionResult {
  const evidence: { code: string; detail: string }[] = [];
  const candidates = input.candidates;

  if (candidates.length === 0) {
    return unresolved(candidates, [{
      code: 'NO_OPEN_PROBES',
      detail: 'No probe was open on the number this event reached. Recorded, and not '
        + 'evidence about any company.',
    }]);
  }

  // --- T0: the alias token -------------------------------------------------------
  // Strongest available: only one company was ever given this address.
  const token = tokenFromAddress(input.toEmail);
  if (token) {
    const matches = candidates.filter((probe) => probe.probeToken === token);
    if (matches.length === 1) {
      return {
        state: 'ATTRIBUTED', tier: 'T0_EMAIL_TOKEN', confidence: 'HIGH',
        probeId: matches[0]!.probeId,
        candidateProbeIds: [matches[0]!.probeId],
        evidence: [{
          code: 'ALIAS_TOKEN_MATCH',
          detail: `The reply was sent to the alias issued to exactly one probe. `
            + 'No other company was given this address.',
        }],
      };
    }
    if (matches.length === 0) {
      evidence.push({
        code: 'ALIAS_TOKEN_UNKNOWN',
        detail: 'The address carried a token shape that matches no open probe.',
      });
    }
  }

  // --- T1: a known main number ---------------------------------------------------
  const fromKey = digits10(input.fromNumber);
  if (fromKey) {
    const matches = candidates.filter((probe) => phoneSet(probe.phones).has(fromKey));
    if (matches.length === 1) {
      return {
        state: 'ATTRIBUTED', tier: 'T1_KNOWN_ACCOUNT_NUMBER', confidence: 'HIGH',
        probeId: matches[0]!.probeId,
        candidateProbeIds: [matches[0]!.probeId],
        evidence: [{
          code: 'KNOWN_ACCOUNT_NUMBER',
          detail: 'The inbound number is a published number for exactly one open '
            + 'probe on this pool number.',
        }],
      };
    }
    if (matches.length > 1) {
      // The collision the allocator exists to prevent, arriving anyway. Recorded as
      // such, because it is a defect in allocation rather than in the world.
      return {
        state: 'AMBIGUOUS', tier: 'T1_KNOWN_ACCOUNT_NUMBER', confidence: 'NONE',
        probeId: null,
        candidateProbeIds: matches.map((probe) => probe.probeId),
        evidence: [{
          code: 'NUMBER_MATCHES_MULTIPLE_PROBES',
          detail: `This number is published by ${matches.length} companies with open `
            + 'probes on the same pool number. Allocation should have deferred one of '
            + 'them; no measurement may be taken from this event.',
        }],
      };
    }
  }

  // --- T2: a known alternate / call-centre number --------------------------------
  if (fromKey) {
    const matches = candidates.filter(
      (probe) => phoneSet(probe.alternatePhones).has(fromKey));
    if (matches.length === 1) {
      const probe = matches[0]!;
      return {
        state: 'ATTRIBUTED', tier: 'T2_KNOWN_ALTERNATE_NUMBER',
        confidence: probe.alternatesAreExclusive ? 'HIGH' : 'MEDIUM',
        probeId: probe.probeId,
        candidateProbeIds: [probe.probeId],
        evidence: [{
          code: 'KNOWN_ALTERNATE_NUMBER',
          detail: probe.alternatesAreExclusive
            ? 'The inbound number is an alternate number belonging to this Account alone.'
            : 'The inbound number is a call-centre or franchise alternate that could '
              + 'serve sibling locations, so this stays MEDIUM rather than promoting '
              + 'itself for being the only rung that matched.',
        }],
      };
    }
    if (matches.length > 1) {
      return {
        state: 'AMBIGUOUS', tier: 'T2_KNOWN_ALTERNATE_NUMBER', confidence: 'NONE',
        probeId: null,
        candidateProbeIds: matches.map((probe) => probe.probeId),
        evidence: [{
          code: 'ALTERNATE_MATCHES_MULTIPLE_PROBES',
          detail: `A shared call-centre number reaches ${matches.length} open probes.`,
        }],
      };
    }
  }

  // --- T3: the message says who it is -------------------------------------------
  if (input.channel === 'SMS' && input.body) {
    const matches = candidates.filter((probe) => bodyIdentifies(input.body!, probe));
    if (matches.length === 1) {
      return {
        state: 'ATTRIBUTED', tier: 'T3_SELF_IDENTIFYING_SMS', confidence: 'MEDIUM',
        probeId: matches[0]!.probeId,
        candidateProbeIds: [matches[0]!.probeId],
        evidence: [{
          code: 'BODY_IDENTIFIES_ACCOUNT',
          detail: 'The message body names the company, its domain, or the probe token '
            + 'for exactly one open probe.',
        }],
      };
    }
    if (matches.length > 1) {
      return {
        state: 'AMBIGUOUS', tier: 'T3_SELF_IDENTIFYING_SMS', confidence: 'NONE',
        probeId: null,
        candidateProbeIds: matches.map((probe) => probe.probeId),
        evidence: [{
          code: 'BODY_IDENTIFIES_MULTIPLE',
          detail: 'The body matches more than one open probe.',
        }],
      };
    }
    evidence.push({
      code: 'BODY_IDENTIFIES_NOTHING',
      detail: 'The body is generic and identifies no company. A "thanks for '
        + 'contacting us" names nobody.',
    });
  }

  // --- T4: the answered identification question ---------------------------------
  if (input.channel === 'CALL' && input.identificationAnswer) {
    const answer = normalizeCompanyName(input.identificationAnswer);
    if (answer.length > 0) {
      const exact = candidates.filter(
        (probe) => probe.accountName && normalizeCompanyName(probe.accountName) === answer);
      if (exact.length === 1) {
        return {
          state: 'ATTRIBUTED', tier: 'T4_IDENTIFICATION_ANSWER', confidence: 'HIGH',
          probeId: exact[0]!.probeId,
          candidateProbeIds: [exact[0]!.probeId],
          evidence: [{
            code: 'IDENTIFICATION_EXACT',
            detail: `The caller named a company matching exactly one open probe.`,
          }],
        };
      }
      const partial = candidates.filter((probe) => {
        if (!probe.accountName) return false;
        const name = normalizeCompanyName(probe.accountName);
        return name.length > 0 && (name.includes(answer) || answer.includes(name));
      });
      if (exact.length === 0 && partial.length === 1) {
        return {
          state: 'ATTRIBUTED', tier: 'T4_IDENTIFICATION_ANSWER', confidence: 'MEDIUM',
          probeId: partial[0]!.probeId,
          candidateProbeIds: [partial[0]!.probeId],
          evidence: [{
            code: 'IDENTIFICATION_PARTIAL_UNIQUE',
            detail: 'The caller named a company that partially but uniquely matches '
              + 'one open probe.',
          }],
        };
      }
      const ambiguous = exact.length > 1 ? exact : partial;
      if (ambiguous.length > 1) {
        return {
          state: 'AMBIGUOUS', tier: 'T4_IDENTIFICATION_ANSWER', confidence: 'NONE',
          probeId: null,
          candidateProbeIds: ambiguous.map((probe) => probe.probeId),
          evidence: [{
            code: 'IDENTIFICATION_MATCHES_MULTIPLE',
            detail: `The name given matches ${ambiguous.length} open probes.`,
          }],
        };
      }
      evidence.push({
        code: 'IDENTIFICATION_MATCHES_NOTHING',
        detail: 'The company named matches no open probe on this number.',
      });
    }
  }

  evidence.push({
    code: 'SOLE_OCCUPANCY_NOT_ATTRIBUTION',
    detail: `${candidates.length} probe(s) are open on this number, which is not `
      + 'itself evidence. No rung matched, so nothing is attributed.',
  });
  return unresolved(candidates, evidence);
}

function bodyIdentifies(body: string, probe: OpenProbeCandidate): boolean {
  const text = body.toLowerCase();
  if (probe.probeToken && text.includes(probe.probeToken.toLowerCase())) return true;

  const host = normalizeHostname(probe.accountDomain);
  if (host) {
    const root = registrableDomain(host);
    // Match the label rather than the whole hostname: an SMS says "marshpointair.com"
    // or "Marsh Point Air", not "www.marshpointair.com".
    const label = root.split('.')[0];
    if (root.length > 3 && text.includes(root)) return true;
    if (label && label.length > 4 && text.replace(/[^a-z0-9]/g, '').includes(label)) return true;
  }

  if (probe.accountName) {
    const name = normalizeCompanyName(probe.accountName);
    if (name.length > 4 && normalizeCompanyName(body).includes(name)) return true;
  }
  return false;
}
