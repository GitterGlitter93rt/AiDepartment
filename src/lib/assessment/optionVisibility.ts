// Pure, testable logic for filtering which answer options are shown to
// the respondent for a given question, based on prior answers
// (QuestionDef.hideOptionIf — see src/data/assessment/types.ts). Kept
// separate from AssessmentApp's DOM-rendering code so this behavior is
// directly unit-testable without a DOM.
//
// IMPORTANT: this only ever affects what's *displayed*. Scoring
// (calculatePublicScore.ts, calculateCommercialScore.ts) always
// resolves an answer against the question's full, unfiltered
// `options` array — filtering here has zero effect on score indexing.

import type { AnswerMap, QuestionDef, QuestionOption } from '../../data/assessment/types';

/** Returns the subset of a question's options that should currently be
 * shown, given the respondent's answers so far. */
export function getVisibleOptions(question: QuestionDef, answers: AnswerMap): QuestionOption[] {
  return (question.options ?? []).filter((opt) => !question.hideOptionIf?.(answers, opt.label));
}

/** Returns true if the question's currently-selected single-select
 * answer is no longer among its visible options — meaning the
 * respondent went back and changed an earlier answer this option's
 * availability depended on, leaving a stale, now-contradictory answer
 * in place. The caller should clear the answer when this is true,
 * rather than silently letting a hidden, contradictory value survive
 * to submission. */
export function isSelectedOptionStale(question: QuestionDef, answers: AnswerMap): boolean {
  const selected = answers[question.id];
  if (typeof selected !== 'string' || selected.length === 0) return false;
  const visible = getVisibleOptions(question, answers);
  return !visible.some((opt) => opt.label === selected);
}
