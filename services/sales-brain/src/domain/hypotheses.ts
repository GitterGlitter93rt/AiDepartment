import { query, withTransaction, type Queryable } from '../db/pool.js';
import { getVerticalProfile } from './verticals.js';

/**
 * Why to call this company, derived from what we actually observed.
 *
 * Nothing in the product ever wrote a hypothesis. The only writers of
 * `opportunity_hypotheses` were the seed script, a demo CLI and a synthetic fixture,
 * so every company the miner discovered and the worker researched had an empty "Why
 * reach out" panel -- the single thing the product exists to answer -- while seeded
 * demo companies looked complete.
 *
 * Every consumer was already built: the Account page reads the panel and takes its
 * suggested first question from `missing_fact_questions[0]`, the Call Pack reads the
 * top two, and the table's `generated_by` column defaults to 'deterministic'. Only
 * the producer was missing.
 *
 * Nothing here is invented. The sentence a rep reads is the profile's own
 * `description`. The questions are its `questions_to_verify`. Which hypotheses apply
 * is decided by `trigger_signals` against evidence we hold, and the order comes from
 * the profile's `hook_priorities`. If a profile says nothing, this produces nothing.
 */

/** Categories `opportunity_hypotheses` accepts, from migration 006. */
const SCHEMA_CATEGORIES = new Set([
  'missed_call', 'after_hours', 'speed_to_lead', 'follow_up', 'unsold_estimate',
  'crm_workflow', 'attribution', 'website_conversion', 'paid_acquisition',
  'reactivation', 'employee_capacity', 'reporting', 'integration',
  'appointment_no_show', 'customer_communication', 'other',
]);

/**
 * Categories that are one concept spelled two ways.
 *
 * Only spellings. A concept the schema has no word for is filed as 'other' with its
 * own name kept in `source_category`, because inventing a home for it would relabel
 * a hypothesis into a category its author did not choose -- and adding both spellings
 * to the constraint would leave the data with two words for one thing, which is the
 * mistake that produced `emergency_service_claim` and `emergency_24_7_service`.
 */
const CATEGORY_SYNONYMS: Record<string, string> = {
  no_show_recovery: 'appointment_no_show',
  sales_follow_up: 'follow_up',
  missed_call_recovery: 'missed_call',
  customer_status_communication: 'customer_communication',
};

/**
 * Concepts the profiles introduce that the schema has no category for. Named here so
 * the gap is a list somebody can act on rather than a silent 'other'.
 */
export const UNMAPPED_CATEGORIES = ['intake', 'capacity', 'governance', 'repetitive_admin'];

export function storedCategory(profileCategory: string): string {
  const mapped = CATEGORY_SYNONYMS[profileCategory] ?? profileCategory;
  return SCHEMA_CATEGORIES.has(mapped) ? mapped : 'other';
}

export interface DerivedHypothesis {
  hypothesisId: string;
  /** The profile's own category, kept whatever the schema can store. */
  sourceCategory: string;
  storedCategory: string;
  /** The profile's own sentence. Not ours. */
  text: string;
  questions: string[];
  supportingEvidenceIds: string[];
  /** Lower is more important, as every reader orders by priority ascending. */
  priority: number;
  /** Which declared signals matched, for the record. */
  matchedSignals: string[];
}

interface EvidenceHeld {
  byClaimKey: Map<string, string[]>;
  /**
   * Categories a prospect has confirmed something under.
   *
   * Every disqualifying signal in every profile is named `prospect_confirms_*`, and
   * none of them appears in any `public_signal_rules` list -- because they are not
   * website signals. They are things a prospect says, and `prospect_statements`
   * stores exactly that, verbatim, under a free-text category. So a disqualifier is
   * satisfied when somebody recorded the prospect saying it.
   *
   * Without this the disqualifiers were unreachable: thirty-five declared across the
   * profiles, none observable, so a prospect who told us their follow-up is measured
   * would have been asked about it again on the next call.
   */
  confirmedCategories: Set<string>;
}

async function currentEvidence(accountId: string): Promise<EvidenceHeld> {
  const { rows } = await query<{ claim_key: string; evidence_id: string }>(
    `select claim_key, evidence_id
       from evidence_records
      where account_id = $1
        and contradicted_by_evidence_id is null
        and (expires_at is null or expires_at > now())`,
    [accountId],
  );
  const byClaimKey = new Map<string, string[]>();
  for (const row of rows) {
    byClaimKey.set(row.claim_key, [...(byClaimKey.get(row.claim_key) ?? []), row.evidence_id]);
  }

  // What a prospect said does not expire the way an ad does: a company that told us
  // their follow-up is measured has not stopped having told us.
  // `supersedes_statement_id` is carried by the *newer* row and points at the one it
  // replaces, so the row to ignore is the one something else points at. Filtering on
  // `supersedes_statement_id is null` reads the wrong way round: it keeps the stale
  // claim and throws away the correction.
  const { rows: statements } = await query<{ category: string }>(
    `select distinct category from prospect_statements s
      where s.account_id = $1
        and not exists (
          select 1 from prospect_statements newer
           where newer.supersedes_statement_id = s.prospect_statement_id)`,
    [accountId],
  );

  return {
    byClaimKey,
    confirmedCategories: new Set(statements.map((row) => row.category)),
  };
}

/**
 * A hypothesis is triggered by `signal_id`s, and evidence is keyed by claim key.
 * `public_signal_rules` is the only thing that maps one to the other, so a trigger
 * naming a signal the profile does not declare matches nothing rather than being
 * guessed at.
 */
function claimKeyBySignalId(profile: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of profile?.public_signal_rules ?? []) {
    const signalId = rule?.signal_id;
    const claimKey = rule?.evidence_claim_key;
    if (typeof signalId === 'string' && typeof claimKey === 'string') {
      map.set(signalId, claimKey);
    }
  }
  return map;
}

export async function deriveHypotheses(accountId: string): Promise<DerivedHypothesis[]> {
  const { rows: accountRows } = await query<{ vertical: string | null }>(
    `select primary_vertical_profile_id as vertical from accounts where account_id = $1`,
    [accountId],
  );
  const verticalProfileId = accountRows[0]?.vertical ?? null;
  if (!verticalProfileId) return [];

  const profile = await getVerticalProfile(verticalProfileId);
  if (!profile) return [];

  const held = await currentEvidence(accountId);
  const claimKeyFor = claimKeyBySignalId(profile);

  /** Evidence ids for a declared signal, empty when we hold none. */
  const evidenceForSignal = (signalId: unknown): string[] => {
    const claimKey = claimKeyFor.get(String(signalId));
    if (!claimKey) return [];
    return held.byClaimKey.get(claimKey) ?? [];
  };

  /**
   * Whether a signal has been observed at all, from either place one can be.
   *
   * A public signal is evidence keyed by the claim key the profile maps it to. A
   * `prospect_confirms_*` signal is a statement somebody captured under that name,
   * which is the only place such a thing can come from.
   */
  const signalObserved = (signalId: unknown): boolean =>
    evidenceForSignal(signalId).length > 0
    || held.confirmedCategories.has(String(signalId));

  const priorities = new Map<string, any>();
  for (const hook of profile.hook_priorities ?? []) {
    if (typeof hook?.hook_family === 'string') priorities.set(hook.hook_family, hook);
  }

  const derived: DerivedHypothesis[] = [];

  for (const hypothesis of profile.leak_hypotheses ?? []) {
    const hypothesisId = String(hypothesis?.hypothesis_id ?? '');
    if (!hypothesisId) continue;

    // Disqualified outright. A prospect who told us their follow-up is measured has
    // answered the question this hypothesis exists to ask.
    const disqualified = (hypothesis?.disqualifying_signals ?? [])
      .some((signal: unknown) => signalObserved(signal));
    if (disqualified) continue;

    const matchedSignals: string[] = [];
    const supporting: string[] = [];
    for (const signal of hypothesis?.trigger_signals ?? []) {
      const ids = evidenceForSignal(signal);
      if (ids.length === 0) continue;
      matchedSignals.push(String(signal));
      supporting.push(...ids);
    }
    // No observed trigger, no hypothesis. A guess about every company in a vertical
    // is not a reason to call this one.
    if (matchedSignals.length === 0) continue;

    const hook = priorities.get(hypothesisId);
    // `avoid_if` is the hook model's own veto, separate from the hypothesis's
    // disqualifying signals.
    const avoided = (hook?.avoid_if ?? []).some((signal: unknown) => signalObserved(signal));
    if (avoided) continue;

    // Readers order by priority ascending, so a boost lowers the number.
    let priority = Number(hook?.base_priority ?? 50);
    if (!Number.isFinite(priority)) priority = 50;
    for (const signal of hook?.boost_if_signals ?? []) {
      if (signalObserved(signal)) priority -= 1;
    }
    for (const signal of hook?.demote_if_signals ?? []) {
      if (signalObserved(signal)) priority += 1;
    }

    const sourceCategory = String(hypothesis?.category ?? 'other');
    const text = String(hypothesis?.description ?? hypothesis?.title ?? '').trim();
    if (!text) continue;

    derived.push({
      hypothesisId,
      sourceCategory,
      storedCategory: storedCategory(sourceCategory),
      text,
      questions: (hypothesis?.questions_to_verify ?? [])
        .map((question: unknown) => String(question).trim()).filter(Boolean),
      supportingEvidenceIds: [...new Set(supporting)],
      priority: Math.max(1, priority),
      matchedSignals,
    });
  }

  // Stable order for equal priorities: the profile's own declaration order, which is
  // the order a person put them in.
  return derived.sort((left, right) => left.priority - right.priority);
}

/**
 * Replaces this account's derived hypotheses.
 *
 * Only rows this generator produced are superseded. A hypothesis a person recorded
 * is theirs, and re-running research must not quietly retire it.
 */
export async function storeHypotheses(
  accountId: string, derived: DerivedHypothesis[],
): Promise<{ written: number; retired: number }> {
  return withTransaction(async (client: Queryable) => {
    const retired = await client.query(
      `update opportunity_hypotheses set is_current = false
        where account_id = $1 and is_current and generated_by = 'deterministic'`,
      [accountId],
    );

    let written = 0;
    for (const item of derived) {
      await client.query(
        `insert into opportunity_hypotheses
           (account_id, category, hypothesis_text, supporting_evidence_ids,
            missing_fact_questions, confidence, priority, generated_by, is_current,
            source_hypothesis_id, source_category)
         values ($1, $2, $3, $4::uuid[], $5::text[], 'unknown', $6, 'deterministic',
                 true, $7, $8)`,
        [
          accountId, item.storedCategory, item.text, item.supportingEvidenceIds,
          item.questions, item.priority, item.hypothesisId, item.sourceCategory,
        ],
      );
      written += 1;
    }
    return { written, retired: retired.rowCount ?? 0 };
  });
}

/**
 * Confidence is always 'unknown', and that is not an oversight.
 *
 * Nothing observable about a website or an ad tells us what happens inside their
 * office. Evidence can say a company advertises; it cannot say their follow-up is
 * inconsistent. The trigger is a reason to ask, and the page says so in as many
 * words: a hypothesis to test on the call, not a fact about their business.
 */
export const HYPOTHESIS_CONFIDENCE = 'unknown';
