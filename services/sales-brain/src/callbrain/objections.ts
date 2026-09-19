import { getVerticalProfile } from '../domain/verticals.js';
import { OBJECTION_RESPONSES } from './prompt.js';

/**
 * One answer per objection, and a record of where it came from.
 *
 * Two layers existed and only one was read. The generic engine handles the
 * objections every trade raises -- we already use ChatGPT, we have a receptionist,
 * our IT company does that -- and every vertical profile also declares its own
 * `objection_guidance`, with match phrases, a principle, a response, follow-up
 * questions and things not to say. Nothing read the second one.
 *
 * The decision is that a vertical supplements the generic engine rather than
 * replacing it: generic is the base layer, a vertical answer to the same objection
 * wins, and generic answers the vertical says nothing about stay available. What is
 * never done is concatenation. Two scripts for one objection is worse than either,
 * because the agent then argues with itself in front of a prospect.
 *
 * Same-intent detection is explicit, never inferred from resemblance. A vertical
 * objection shares an intent with a generic one when its id *is* the generic key --
 * `marketing_agency` is declared in both places -- or when it says so with
 * `overrides_generic_objection`. Anything else is a new objection, additive.
 */

export type ObjectionOrigin =
  /** The generic engine, which every trade gets. */
  | 'GENERIC_CORE'
  /** A vertical answer to an objection the generic engine also handles. */
  | 'VERTICAL_OVERRIDE'
  /** A vertical objection the generic engine has no answer for. */
  | 'VERTICAL_ADDITION';

export interface EffectiveObjection {
  /** The normalized intent: a generic key, or the vertical's own objection id. */
  intent: string;
  origin: ObjectionOrigin;
  /** The one answer the agent uses. */
  response: string;
  /** The vertical's stance behind the answer, when it gave one. */
  principle: string | null;
  followUpQuestions: string[];
  /** Things this objection specifically must not be answered with. */
  mustNotSay: string[];
  /** Where the answer came from, in words, for the record and for review. */
  provenance: string;
}

interface VerticalObjection {
  objectionId: string;
  matchPhrases: string[];
  principle: string | null;
  response: string;
  followUpQuestions: string[];
  mustNotSay: string[];
  overrides: string | null;
}

export function verticalObjections(profile: any): VerticalObjection[] {
  const out: VerticalObjection[] = [];
  for (const entry of profile?.objection_guidance ?? []) {
    const objectionId = typeof entry?.objection_id === 'string' ? entry.objection_id : null;
    const response = typeof entry?.response_guidance === 'string'
      ? entry.response_guidance.trim() : '';
    if (!objectionId || !response) continue;
    out.push({
      objectionId,
      matchPhrases: (entry?.match_phrases ?? [])
        .map((phrase: unknown) => String(phrase).toLowerCase().trim())
        .filter((phrase: string) => phrase.length > 0),
      principle: typeof entry?.principle === 'string' ? entry.principle.trim() : null,
      response,
      followUpQuestions: (entry?.follow_up_questions ?? [])
        .map((question: unknown) => String(question).trim()).filter(Boolean),
      mustNotSay: (entry?.must_not_say ?? [])
        .map((claim: unknown) => String(claim).trim()).filter(Boolean),
      overrides: typeof entry?.overrides_generic_objection === 'string'
        ? entry.overrides_generic_objection : null,
    });
  }
  return out;
}

/**
 * The generic intent a vertical objection speaks to, if any.
 *
 * Two routes, both explicit: the same id, or a declared override. Resemblance is not
 * a route -- `dont_need_ai` and `chatgpt` are different objections however similar
 * they sound, and answering one with the other loses the conversation.
 */
export function genericIntentFor(objection: VerticalObjection): string | null {
  if (objection.overrides && OBJECTION_RESPONSES[objection.overrides]) {
    return objection.overrides;
  }
  if (OBJECTION_RESPONSES[objection.objectionId]) return objection.objectionId;
  return null;
}

/**
 * Which vertical objections the prospect's words raise.
 *
 * Matched on the profile's own `match_phrases`, so the trade decides what its
 * objection sounds like.
 */
export function verticalObjectionsRaised(
  objections: VerticalObjection[], said: string,
): VerticalObjection[] {
  const lowered = said.toLowerCase();
  return objections.filter((objection) =>
    objection.matchPhrases.some((phrase) => lowered.includes(phrase)));
}

export async function resolveObjections(input: {
  verticalProfileId: string | null;
  /** Generic intents the engine already matched. */
  genericKeys: string[];
  /** What the prospect actually said, for the vertical's own phrase matching. */
  said?: string;
}): Promise<EffectiveObjection[]> {
  const profile = input.verticalProfileId
    ? await getVerticalProfile(input.verticalProfileId) : null;
  const declared = verticalObjections(profile);
  const raised = input.said ? verticalObjectionsRaised(declared, input.said) : [];

  const byIntent = new Map<string, EffectiveObjection>();

  // Base layer: every generic intent the engine matched.
  for (const key of input.genericKeys) {
    const response = OBJECTION_RESPONSES[key];
    if (!response) continue;
    byIntent.set(key, {
      intent: key, origin: 'GENERIC_CORE', response, principle: null,
      followUpQuestions: [], mustNotSay: [],
      provenance: 'Generic objection engine.',
    });
  }

  // The vertical's turn. An answer to the same intent replaces the generic one
  // outright; a new objection is added. Never both for one intent.
  for (const objection of raised) {
    const generic = genericIntentFor(objection);
    const intent = generic ?? objection.objectionId;
    const replaced = generic !== null && byIntent.get(intent)?.origin === 'GENERIC_CORE';
    byIntent.set(intent, {
      intent,
      origin: generic === null ? 'VERTICAL_ADDITION' : 'VERTICAL_OVERRIDE',
      response: objection.response,
      principle: objection.principle,
      followUpQuestions: objection.followUpQuestions,
      mustNotSay: objection.mustNotSay,
      provenance: generic === null
        ? `${input.verticalProfileId} declares "${objection.objectionId}", which the `
          + 'generic engine has no answer for.'
        : `${input.verticalProfileId} answers "${intent}" itself`
          + `${replaced ? ', replacing the generic answer' : ''}.`,
    });
  }

  // Stable order: overrides and additions first, because they are the specific ones,
  // then whatever generic answers survived.
  return [...byIntent.values()].sort((left, right) => {
    const rank = (origin: ObjectionOrigin): number =>
      origin === 'GENERIC_CORE' ? 1 : 0;
    return rank(left.origin) - rank(right.origin)
      || left.intent.localeCompare(right.intent);
  });
}
