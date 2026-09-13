import { query, withTransaction } from '../db/pool.js';
import { researchPictureFor, UNKNOWING } from './researchFacts.js';

/**
 * How much of what matters about a company we have actually looked at.
 *
 * `accounts.research_completeness` is a filter on Find Prospects offering COMPLETE,
 * GOOD, PARTIAL and STALE. The only writer sets THIN or STALE and nothing else: its
 * `case` leaves a researched, fresh Account unchanged, which for a new record means
 * null for ever. So three of the four filter options matched nothing at all, the one
 * real value in the data was not offered, and a rep filtering for well-researched
 * prospects saw "no researched prospects match those filters" and concluded the
 * inventory was thin.
 *
 * And the `research_completeness` table -- with a score, a label and a components
 * breakdown -- has never had a row written to it by anything but a fixture.
 *
 * Completeness is computed here from the same fact model the Account page reads, so
 * the label and the page cannot disagree. The useful part is not the label though:
 * it is the debt. Which of the things this vertical says matter has nobody looked
 * at, for this company, and what would it take.
 */

export type CompletenessLabel = 'COMPLETE' | 'GOOD' | 'PARTIAL' | 'THIN' | 'STALE';

export interface EvidenceDebt {
  /** Facts the vertical declares that nothing has ever looked at for this company. */
  neverLooked: { key: string; label: string }[];
  /** Facts looked at and not found. Not debt — an answer. */
  lookedAndAbsent: { key: string; label: string }[];
  /** Facts whose evidence has aged out and needs a re-check. */
  agedOut: { key: string; label: string }[];
  /** Facts our sources disagree about. */
  conflicting: { key: string; label: string }[];
}

export interface Completeness {
  label: CompletenessLabel;
  /** 0-100. Share of the facts that matter which we have an answer to. */
  score: number;
  observed: number;
  answered: number;
  total: number;
  debt: EvidenceDebt;
  /** One sentence saying what the label means and what to do next. */
  summary: string;
}

/**
 * Facts that describe our own machinery rather than the company.
 *
 * "Did we read the website" is a fact about us, and counting it as knowledge about
 * the prospect would let a completeness score rise because our crawler had a good
 * day.
 */
const NOT_ABOUT_THE_COMPANY = new Set(['website_read']);

export async function computeCompleteness(accountId: string): Promise<Completeness> {
  const picture = await researchPictureFor(accountId);
  const facts = picture.facts.filter((fact) => !NOT_ABOUT_THE_COMPANY.has(fact.key));

  const observed = facts.filter((fact) => fact.state === 'YES').length;
  // An answer includes "we looked and it is not there". That is knowledge, and
  // treating it as a gap would make a thoroughly researched company with few signals
  // look unresearched.
  const answered = facts.filter(
    (fact) => fact.state === 'YES' || fact.state === 'NOT_OBSERVED' || fact.state === 'NO',
  ).length;
  const total = facts.length;
  const score = total === 0 ? 0 : Math.round((answered / total) * 100);

  const debt: EvidenceDebt = {
    neverLooked: facts.filter((fact) => fact.state === 'NOT_CHECKED')
      .map((fact) => ({ key: fact.key, label: fact.label })),
    lookedAndAbsent: facts.filter((fact) => fact.state === 'NOT_OBSERVED')
      .map((fact) => ({ key: fact.key, label: fact.label })),
    agedOut: facts.filter((fact) => fact.state === 'UNKNOWN')
      .map((fact) => ({ key: fact.key, label: fact.label })),
    conflicting: facts.filter((fact) => fact.state === 'CONFLICT')
      .map((fact) => ({ key: fact.key, label: fact.label })),
  };

  const { rows } = await query<{ researched: boolean; stale: boolean }>(
    `select last_researched_at is not null as researched,
            (research_fresh_until is not null and research_fresh_until <= now()) as stale
       from accounts where account_id = $1`, [accountId]);
  const state = rows[0];

  // Stale wins over everything: research that has aged out is not research a rep can
  // rely on, whatever it once covered.
  const label: CompletenessLabel = state?.stale ? 'STALE'
    : !state?.researched ? 'THIN'
    : score >= 90 ? 'COMPLETE'
    : score >= 65 ? 'GOOD'
    : score >= 30 ? 'PARTIAL'
    : 'THIN';

  return {
    label, score, observed, answered, total, debt,
    summary: label === 'STALE'
      ? 'The research here has aged past its window. Nothing below is wrong, but none '
        + 'of it should be said in the present tense until it is re-checked.'
      : label === 'THIN'
        // Keyed on whether research has run, not on whether every fact is unlooked: a
        // discovered company arrives with a domain and a phone, so two facts are
        // answered before anybody researches anything.
        ? !state?.researched
          ? 'Nothing has researched this company yet, so there is nothing to be '
            + 'complete or incomplete about.'
          : `${debt.neverLooked.length} of ${total} things that matter for this trade `
            + 'have never been looked at.'
        : label === 'COMPLETE'
          ? `We have an answer to ${answered} of ${total} things that matter here, `
            + `and ${observed} of them are positive signals.`
          : `${answered} of ${total} answered. Still unlooked-at: `
            + `${debt.neverLooked.map((fact) => fact.label.toLowerCase()).join(', ')}.`,
  };
}

/**
 * Records completeness where the filter and the history both live.
 *
 * Two places, because they answer different questions. The column on `accounts` is
 * what Find Prospects filters on and has to be one word. The row in
 * `research_completeness` is the history, with the components, so "was this company
 * better researched in March" is answerable.
 *
 * The table's own check constraint is lower-case and the column's values are upper.
 * Written to match each, rather than changing an applied migration's constraint for
 * cosmetics.
 */
export async function storeCompleteness(
  accountId: string, completeness: Completeness, researchRunId: string | null = null,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'update accounts set research_completeness = $2 where account_id = $1',
      [accountId, completeness.label]);
    await client.query(
      `insert into research_completeness (account_id, research_run_id, numeric_score,
                                          label, components)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [accountId, researchRunId, completeness.score,
        completeness.label.toLowerCase(), JSON.stringify({
          observed: completeness.observed,
          answered: completeness.answered,
          total: completeness.total,
          never_looked: completeness.debt.neverLooked.map((fact) => fact.key),
          aged_out: completeness.debt.agedOut.map((fact) => fact.key),
          conflicting: completeness.debt.conflicting.map((fact) => fact.key),
        })]);
  });
}

/**
 * Where the evidence debt is across the inventory.
 *
 * The operator question this answers is not "how complete are we" but "what is the
 * one thing nobody has looked at for most companies", which is a job that can be
 * scheduled.
 */
export async function evidenceDebtSummary(limit = 200): Promise<{
  sampled: number;
  byFact: { key: string; label: string; neverLooked: number }[];
  byLabel: Record<string, number>;
}> {
  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts
      where merged_into_account_id is null and not is_suppressed
      order by updated_at desc limit ${Math.max(1, Math.min(1000, limit))}`);

  const byFact = new Map<string, { label: string; neverLooked: number }>();
  const byLabel: Record<string, number> = {};
  for (const row of rows) {
    const completeness = await computeCompleteness(row.account_id);
    byLabel[completeness.label] = (byLabel[completeness.label] ?? 0) + 1;
    for (const fact of completeness.debt.neverLooked) {
      const held = byFact.get(fact.key) ?? { label: fact.label, neverLooked: 0 };
      held.neverLooked += 1;
      byFact.set(fact.key, held);
    }
  }

  return {
    sampled: rows.length,
    byFact: [...byFact.entries()]
      .map(([key, value]) => ({ key, label: value.label, neverLooked: value.neverLooked }))
      .sort((a, b) => b.neverLooked - a.neverLooked),
    byLabel,
  };
}

export { UNKNOWING };
