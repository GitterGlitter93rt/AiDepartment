import { createHash } from 'node:crypto';
import { classifyReply } from '../email/inbound.js';

/**
 * Whether a person answered, or a system did.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §8.
 *
 * This is the distinction the whole subsystem exists to protect. An automated
 * "Thanks for contacting us, we'll be in touch" is the single most common response to
 * a web lead, and counting it as follow-up would turn every measurement into the
 * opposite of the finding: a company whose autoresponder fires in four seconds and
 * whose humans never call would look like the fastest responder in the market.
 *
 * The default is UNKNOWN and the asymmetry is deliberate. Evidence promotes to
 * AUTOMATED or to HUMAN; nothing demotes. In particular **absence of automation
 * evidence is not evidence of a human** -- that inference is available, cheap, and
 * wrong, and it would quietly manufacture human-response latencies out of anything
 * we failed to recognise.
 */

export type ActorType = 'HUMAN' | 'AUTOMATED' | 'UNKNOWN';

export interface ActorEvidence {
  code: string;
  detail: string;
  towards: 'AUTOMATED' | 'HUMAN';
}

export interface ActorClassification {
  actorType: ActorType;
  evidence: ActorEvidence[];
}

/** Seconds within which a reply is machine-fast. A person does not answer a web form in 60s. */
export const AUTOMATED_LATENCY_SECONDS = 60;

/**
 * A body reduced to what makes two messages the same template.
 *
 * Digits, URLs and a leading greeting name are removed, because an autoresponder
 * that interpolates a ticket number or "Hi Alex," is still one template -- and
 * greeting interpolation is common enough that without it the cross-probe signal
 * would miss precisely the systems worth detecting.
 *
 * **Stated limit:** a name interpolated anywhere other than the greeting still
 * defeats the match. Stripping every capitalised word would also strip the company
 * name, which is the part that makes two templates genuinely the same one.
 */
export function bodyFingerprint(body: string | null | undefined): string | null {
  if (!body) return null;
  const normalized = body
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    // A greeting and the name after it: "hi alex," / "dear jordan".
    .replace(/^\s*(?:hi|hey|hello|dear|good\s+(?:morning|afternoon|evening))\b[\s,]*[a-z']+[\s,!.]*/i, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length < 12) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

const AUTORESPONDER_PHRASES: readonly RegExp[] = [
  /thank(?:s| you) for (?:contacting|reaching out|your (?:inquiry|interest|request))/,
  /we (?:have )?received your (?:message|request|inquiry)/,
  /(?:someone|a (?:representative|team member)) will (?:be in touch|contact you|reach out)/,
  /this is an automated (?:message|reply|response)/,
  /do not reply to this (?:message|email)/,
  /your (?:request|ticket|case) (?:number|#|has been)/,
];

/** A sender that cannot be a person. */
function senderIsMachine(from: string | null | undefined): boolean {
  if (!from) return false;
  const value = from.trim();
  // Alphanumeric sender ids and short codes are not people.
  if (/^[A-Za-z][A-Za-z0-9]{2,10}$/.test(value)) return true;
  const digits = value.replace(/\D+/g, '');
  if (digits.length > 0 && digits.length <= 6) return true;
  if (/^no-?reply@|^donotreply@|^notifications?@|^automated@/i.test(value)) return true;
  return false;
}

export interface ClassifyActorInput {
  channel: 'CALL' | 'SMS' | 'EMAIL';
  /** Seconds between submission and this event. Negative or null when unknown. */
  secondsSinceSubmission: number | null;
  body?: string | null;
  from?: string | null;
  callDisposition?: string | null;
  /**
   * How many *other* probes have already seen this exact body fingerprint. One or
   * more means a template rather than a message written to us.
   */
  fingerprintSeenOnOtherProbes?: number;
  /** True when a person answered the identification question. */
  identificationAnswered?: boolean;
  /** True when the exchange had turns in both directions. */
  twoWay?: boolean;
  /** Set when the body contains something only this probe was given. */
  containsProbeSpecificDetail?: boolean;
}

export function classifyActor(input: ClassifyActorInput): ActorClassification {
  const evidence: ActorEvidence[] = [];
  const body = input.body ?? null;

  if (input.secondsSinceSubmission !== null
      && input.secondsSinceSubmission >= 0
      && input.secondsSinceSubmission <= AUTOMATED_LATENCY_SECONDS) {
    evidence.push({
      code: 'MACHINE_FAST', towards: 'AUTOMATED',
      detail: `Arrived ${input.secondsSinceSubmission}s after submission, inside the `
        + `${AUTOMATED_LATENCY_SECONDS}s automated window.`,
    });
  }

  if (senderIsMachine(input.from)) {
    evidence.push({
      code: 'MACHINE_SENDER', towards: 'AUTOMATED',
      detail: `Sender "${input.from}" is a short code, alphanumeric sender or `
        + 'no-reply address rather than a line a person speaks from.',
    });
  }

  if (body) {
    for (const phrase of AUTORESPONDER_PHRASES) {
      if (phrase.test(body.toLowerCase())) {
        evidence.push({
          code: 'AUTORESPONDER_PHRASING', towards: 'AUTOMATED',
          detail: 'The body matches known acknowledgement phrasing.',
        });
        break;
      }
    }
    if (classifyReply(body) === 'OUT_OF_OFFICE') {
      evidence.push({
        code: 'OUT_OF_OFFICE', towards: 'AUTOMATED',
        detail: 'Classified OUT_OF_OFFICE by the existing reply classifier.',
      });
    }
  }

  const seen = input.fingerprintSeenOnOtherProbes ?? 0;
  if (seen > 0) {
    // The cheapest strong signal the pool produces, and it only exists because many
    // probes share infrastructure: the same words sent to two different audits were
    // written once, by nobody, in advance.
    evidence.push({
      code: 'CROSS_PROBE_TEMPLATE', towards: 'AUTOMATED',
      detail: `The same normalized body has been seen on ${seen} other probe(s), so `
        + 'it is a template rather than a message written to this inquiry.',
    });
  }

  if (input.channel === 'CALL') {
    const disposition = (input.callDisposition ?? '').toUpperCase();
    if (/IVR|RINGLESS|VOICEMAIL_DROP|NO_SPEECH|MACHINE|DTMF_ONLY/.test(disposition)) {
      evidence.push({
        code: 'MACHINE_CALL_DISPOSITION', towards: 'AUTOMATED',
        detail: `Call disposition "${disposition}" indicates a machine, not a speaker.`,
      });
    }
  }

  if (input.identificationAnswered) {
    evidence.push({
      code: 'ANSWERED_IDENTIFICATION', towards: 'HUMAN',
      detail: 'A person answered the identification question.',
    });
  }
  if (input.twoWay) {
    evidence.push({
      code: 'TWO_WAY_EXCHANGE', towards: 'HUMAN',
      detail: 'The exchange had turns in both directions.',
    });
  }
  if (input.containsProbeSpecificDetail) {
    evidence.push({
      code: 'PROBE_SPECIFIC_DETAIL', towards: 'HUMAN',
      detail: 'The body references something only this probe was given, so it was '
        + 'composed in response to this inquiry.',
    });
  }

  const automated = evidence.filter((item) => item.towards === 'AUTOMATED');
  const human = evidence.filter((item) => item.towards === 'HUMAN');

  // Human evidence wins a tie, because the human signals are positive acts -- a
  // person spoke, a person answered -- while the automated ones are inferences from
  // shape. A templated SMS followed by a real call is two events, not one verdict.
  if (human.length > 0) return { actorType: 'HUMAN', evidence };
  if (automated.length > 0) return { actorType: 'AUTOMATED', evidence };

  return {
    actorType: 'UNKNOWN',
    evidence: [{
      code: 'NO_CLASSIFYING_EVIDENCE', towards: 'AUTOMATED',
      detail: 'Nothing identified this as either a person or a system. UNKNOWN is '
        + 'the answer: absence of automation evidence is not evidence of a human.',
    }],
  };
}

/**
 * Whether an event may set `first_meaningful_contact_at`.
 *
 * All three conditions, not two. A HUMAN classification on a LOW-confidence
 * attribution is a person who called somebody -- possibly not us, possibly about
 * something else -- and the whole point of the milestone is that a rep can say the
 * sentence out loud.
 */
export function isMeaningfulContact(input: {
  actorType: ActorType;
  attributionConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  engagesInquiry: boolean;
}): boolean {
  if (input.actorType !== 'HUMAN') return false;
  if (input.attributionConfidence !== 'HIGH' && input.attributionConfidence !== 'MEDIUM') return false;
  return input.engagesInquiry;
}
