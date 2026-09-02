// Industry knowledge: what any competent person in this trade knows.
//
// Deliberately NOT a list of canned answers. A canned answer read aloud
// sounds like a canned answer, and callers do not ask questions in the
// form you wrote them. What each entry carries instead is:
//
//   - how callers actually phrase the question (triggers)
//   - what KIND of question it is (source), which decides whether the
//     agent may answer at all
//   - guidance the agent reasons from, in its own words
//
// The `source` field is the important one. It is the mechanism that
// stops the agent inventing business facts: a question whose answer
// lives in the BusinessProfile cannot be answered from industry
// knowledge, no matter how confidently a language model could produce
// a plausible number.

import type { BusinessProfile } from '../business/profile.ts';

export type AnswerSource =
  /** Safe to answer from general knowledge of the trade. How a claim
   *  works, what a plumber will need to look at, what happens at a
   *  first consultation. True of every business in the industry. */
  | 'industry_general'
  /** The answer belongs to one specific business. Answer only if the
   *  profile has it; otherwise deflect honestly. */
  | 'business_config'
  /** Cannot be answered until the caller says more. */
  | 'needs_more_info'
  /** The real answer is an appointment. */
  | 'schedule'
  /** Belongs to a human. */
  | 'escalate'
  /** Must not be answered at all — legal advice, medical advice,
   *  talking someone through a repair that could hurt them. */
  | 'refuse';

export interface KnowledgeEntry {
  id: string;
  /** What the caller is really asking, in plain terms. */
  question: string;
  /** How people actually say it, including the ways they say it badly. */
  triggers: RegExp[];
  source: AnswerSource;
  /**
   * BusinessProfile fields that would answer this. Only meaningful when
   * source is 'business_config'. If every field is present the agent
   * answers from the profile; if any is missing it deflects.
   */
  requires?: string[];
  /** How to handle it. Reasoned from, not read out. */
  guidance: string;
}

export interface IndustryKnowledge {
  industry: string;
  entries: KnowledgeEntry[];
}

export interface MatchedKnowledge {
  entry: KnowledgeEntry;
  /** False when source is business_config and the profile lacks a field. */
  answerable: boolean;
}

/**
 * Finds the knowledge entries relevant to what the caller just said.
 *
 * Only matched entries are injected into the prompt. Sending an entire
 * FAQ bank every turn is the obvious implementation and the wrong one:
 * it costs tokens on every single turn of every call to carry
 * twenty-nine answers to questions nobody asked, and it dilutes the
 * instructions that do apply.
 */
export function matchKnowledge(
  utterance: string,
  knowledge: IndustryKnowledge | null,
  profile: BusinessProfile,
  limit = 3,
): MatchedKnowledge[] {
  if (!knowledge) return [];
  const text = utterance.toLowerCase();
  const hits: MatchedKnowledge[] = [];

  for (const entry of knowledge.entries) {
    if (!entry.triggers.some((t) => t.test(text))) continue;
    hits.push({ entry, answerable: isAnswerable(entry, profile) });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Fields that describe a POLICY about answering rather than an answer.
 *
 * `pricing.neverQuoteByPhone` is the clearest case and it caused a real
 * bug: a generic demo profile sets it, and a naive "does the pricing
 * object have anything in it" check then reported that pricing WAS
 * configured — so the agent was cleared to answer a pricing question it
 * had no price for. A policy saying "do not quote" is the opposite of
 * having a quote.
 */
const NON_ANSWER_KEYS: Record<string, string[]> = {
  pricing: ['neverQuoteByPhone'],
};

function hasAnswer(field: string, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    const ignore = NON_ANSWER_KEYS[field] ?? [];
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => !ignore.includes(k) && v !== undefined && v !== null && v !== '',
    );
  }
  return true;
}

function isAnswerable(entry: KnowledgeEntry, profile: BusinessProfile): boolean {
  if (entry.source !== 'business_config') return true;
  const fields = entry.requires ?? [];
  if (fields.length === 0) return false;
  const record = profile as unknown as Record<string, unknown>;
  return fields.every((f) => hasAnswer(f, record[f]));
}

/** Renders matched knowledge as the "this turn" section of the prompt. */
export function renderKnowledge(matches: MatchedKnowledge[]): string | null {
  if (matches.length === 0) return null;

  const lines = matches.map(({ entry, answerable }) => {
    const head = `- The caller is asking: ${entry.question}`;
    if (entry.source === 'refuse') {
      return `${head}\n  DO NOT ANSWER THIS. ${entry.guidance}`;
    }
    if (entry.source === 'business_config' && !answerable) {
      return `${head}\n  You have NOT been told this about this business. Do not estimate or give a typical figure. ${entry.guidance}`;
    }
    if (entry.source === 'escalate') {
      return `${head}\n  This belongs to a person. ${entry.guidance}`;
    }
    if (entry.source === 'schedule') {
      return `${head}\n  The real answer is an appointment. ${entry.guidance}`;
    }
    if (entry.source === 'needs_more_info') {
      return `${head}\n  You cannot answer yet. ${entry.guidance}`;
    }
    return `${head}\n  ${entry.guidance}`;
  });

  return [
    'WHAT THE CALLER JUST ASKED',
    'Answer it before continuing your intake — a caller who is ignored stops cooperating.',
    ...lines,
  ].join('\n');
}
