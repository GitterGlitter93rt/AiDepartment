import { query, withTransaction } from '../db/pool.js';
import { isPlatformDomain } from './normalize.js';
import type { Role } from './auth.js';

/**
 * The near-misses identity resolution refuses to merge, put in front of a person.
 *
 * Resolution is deliberately conservative: two roofers on one answering-service
 * number are usually two companies, and merging them would put one rep's call
 * history on another rep's prospect. Its own comment has always said a weak match
 * "must create a review case, never an automatic merge" -- and nothing created one,
 * so the near-misses became two Accounts with nothing pointing them out.
 *
 * The operations page has counted accounts sharing a normalized name for months.
 * That number cannot be acted on and cannot go down, so it reads as a permanent
 * "7 possible duplicates" and teaches an operator to stop looking at the panel.
 *
 * What makes a queue finite is a decision that is remembered. "Not a duplicate" has
 * to mean the pair never comes back, or the queue is just the count again with more
 * clicks.
 */

export type CandidateRule =
  /** Same normalized name, and both are in the same city or state. */
  | 'same_name_same_place'
  /** One phone, names that resolution would not accept as the same company. */
  | 'shared_phone_different_names'
  /**
   * Kept in the vocabulary and deliberately never produced.
   *
   * `accounts.canonical_domain` carries a unique index, so two live Accounts cannot
   * share a domain at all -- a second one is either resolved onto the first by the
   * domain rule or refused by the database. The platform-domain wording below stays
   * as a guard in case a domain reaches this queue by some other route, because
   * presenting a shared Facebook page as evidence of one company is the mistake
   * worth being unable to make.
   */
  | 'shared_platform_page'
  /** Same street address, names resolution would not accept. */
  | 'same_address_different_names'
  /** One name is a word-subset of the other, in the same place. */
  | 'name_subset_same_place';

export interface DuplicateCandidate {
  duplicateReviewId: string;
  accountAId: string;
  accountBId: string;
  nameA: string;
  nameB: string;
  candidateRule: CandidateRule;
  evidenceFor: string[];
  evidenceAgainst: string[];
  status: 'OPEN' | 'MERGED' | 'NOT_DUPLICATE';
  firstSeenAt: Date;
}

interface PairRow {
  a_id: string; b_id: string; a_name: string; b_name: string;
  a_domain: string | null; b_domain: string | null;
  a_city: string | null; b_city: string | null;
  a_state: string | null; b_state: string | null;
  a_phone: string | null; b_phone: string | null;
  rule: CandidateRule;
}

/**
 * Pairs worth a person's attention, with the case for and against each.
 *
 * Bounded and ordered so this is a queue rather than a report: an operator works the
 * top of it, and the same pair is never presented twice.
 */
const CANDIDATE_SQL = `
with live as (
  select a.account_id, a.canonical_name, a.normalized_name, a.canonical_domain,
         (select l.city from locations l where l.account_id = a.account_id
           order by l.is_headquarters desc nulls last limit 1) as city,
         (select l.state_region from locations l where l.account_id = a.account_id
           order by l.is_headquarters desc nulls last limit 1) as state_region,
         (select e.normalized_value from contact_endpoints e
           where e.account_id = a.account_id and e.endpoint_type = 'PHONE'
             and e.is_active order by e.created_at limit 1) as phone
    from accounts a
   where a.merged_into_account_id is null and not a.is_suppressed
)
-- Same name in the same place. The pair the operations count has always meant, and
-- the most likely to be one company entered twice.
select x.account_id as a_id, y.account_id as b_id,
       x.canonical_name as a_name, y.canonical_name as b_name,
       x.canonical_domain as a_domain, y.canonical_domain as b_domain,
       x.city as a_city, y.city as b_city,
       x.state_region as a_state, y.state_region as b_state,
       x.phone as a_phone, y.phone as b_phone,
       'same_name_same_place' as rule
  from live x join live y on x.account_id < y.account_id
 where x.normalized_name = y.normalized_name
   and (x.city is not distinct from y.city or x.state_region is not distinct from y.state_region)
union all
-- One phone, two names resolution would not accept as the same company. Usually a
-- shared line; occasionally the same business entered twice under two trading names.
select x.account_id, y.account_id, x.canonical_name, y.canonical_name,
       x.canonical_domain, y.canonical_domain, x.city, y.city,
       x.state_region, y.state_region, x.phone, y.phone,
       'shared_phone_different_names'
  from live x join live y on x.account_id < y.account_id
 where x.phone is not null and x.phone = y.phone
   and x.normalized_name <> y.normalized_name
union all
-- One name is a word-subset of the other in the same place: "Roofing" beside
-- "Salazar Roofing and Repair". Resolution keeps these apart on purpose.
select x.account_id, y.account_id, x.canonical_name, y.canonical_name,
       x.canonical_domain, y.canonical_domain, x.city, y.city,
       x.state_region, y.state_region, x.phone, y.phone,
       'name_subset_same_place'
  from live x join live y on x.account_id < y.account_id
 where x.normalized_name <> y.normalized_name
   -- Both directions, all three positions. Five of the six clauses were written and
   -- the sixth was not, so "Roofing" beside "Salazar Roofing Repair" was only caught
   -- when the shorter name happened to sort first by uuid -- which is to say, half
   -- the time, unreproducibly.
   and (y.normalized_name like x.normalized_name || ' %'
     or y.normalized_name like '% ' || x.normalized_name
     or y.normalized_name like '% ' || x.normalized_name || ' %'
     or x.normalized_name like y.normalized_name || ' %'
     or x.normalized_name like '% ' || y.normalized_name
     or x.normalized_name like '% ' || y.normalized_name || ' %')
   and x.city is not distinct from y.city
   and x.city is not null
limit 500`;

function evidenceFor(row: PairRow): string[] {
  const reasons: string[] = [];
  if (row.a_name.toLowerCase() === row.b_name.toLowerCase()) {
    reasons.push('Identical company name.');
  } else if (row.rule === 'name_subset_same_place') {
    reasons.push(`"${row.a_name}" is contained in "${row.b_name}".`);
  }
  if (row.a_phone && row.a_phone === row.b_phone) {
    reasons.push(`Both list ${row.a_phone} as a phone number.`);
  }
  if (row.a_city && row.a_city === row.b_city) reasons.push(`Both in ${row.a_city}.`);
  if (row.a_domain && row.a_domain === row.b_domain) {
    reasons.push(isPlatformDomain(row.a_domain)
      // Said explicitly, because it is the weakest possible evidence and looks like
      // the strongest.
      ? `Both give ${row.a_domain} as a website, which is a platform page and not a `
        + 'company site — this is not evidence they are the same business.'
      : `Both use the domain ${row.a_domain}.`);
  }
  return reasons;
}

function evidenceAgainst(row: PairRow): string[] {
  const reasons: string[] = [];
  if (row.a_name.toLowerCase() !== row.b_name.toLowerCase()) {
    reasons.push(`Different names: "${row.a_name}" and "${row.b_name}".`);
  }
  if (row.a_city && row.b_city && row.a_city !== row.b_city) {
    reasons.push(`Different cities: ${row.a_city} and ${row.b_city}.`);
  }
  if (row.a_state && row.b_state && row.a_state !== row.b_state) {
    reasons.push(`Different states: ${row.a_state} and ${row.b_state}.`);
  }
  if (row.a_domain && row.b_domain && row.a_domain !== row.b_domain) {
    reasons.push(`Different websites: ${row.a_domain} and ${row.b_domain}.`);
  }
  if (row.rule === 'shared_phone_different_names') {
    reasons.push('A shared phone number is common in a strip mall, a shared office or '
      + 'an answering service, and is not on its own evidence of one business.');
  }
  return reasons;
}

/**
 * Finds candidates and queues the ones nobody has judged.
 *
 * A pair already decided is left alone, whichever rule proposes it again. That is
 * what stops "not a duplicate" from being a decision an operator makes weekly for
 * ever.
 */
export async function refreshDuplicateQueue(): Promise<{
  found: number; queued: number; alreadyDecided: number;
}> {
  const { rows } = await query<PairRow>(CANDIDATE_SQL);
  let queued = 0;
  let alreadyDecided = 0;

  for (const row of rows) {
    const { rows: existing } = await query<{ status: string }>(
      `select status from duplicate_reviews
        where account_a_id = $1 and account_b_id = $2`, [row.a_id, row.b_id]);
    if (existing[0]) {
      if (existing[0].status !== 'OPEN') { alreadyDecided += 1; continue; }
      await query(
        `update duplicate_reviews set last_seen_at = now()
          where account_a_id = $1 and account_b_id = $2`, [row.a_id, row.b_id]);
      continue;
    }

    await query(
      `insert into duplicate_reviews (account_a_id, account_b_id, candidate_rule,
                                       evidence_for, evidence_against)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)
       on conflict (account_a_id, account_b_id) do nothing`,
      [row.a_id, row.b_id, row.rule,
        JSON.stringify(evidenceFor(row)), JSON.stringify(evidenceAgainst(row))]);
    queued += 1;
  }

  return { found: rows.length, queued, alreadyDecided };
}

export async function openDuplicateCandidates(limit = 50): Promise<DuplicateCandidate[]> {
  const { rows } = await query<{
    duplicate_review_id: string; account_a_id: string; account_b_id: string;
    candidate_rule: CandidateRule; evidence_for: string[]; evidence_against: string[];
    status: 'OPEN'; first_seen_at: Date; a_name: string; b_name: string;
  }>(
    `select r.duplicate_review_id, r.account_a_id, r.account_b_id, r.candidate_rule,
            r.evidence_for, r.evidence_against, r.status, r.first_seen_at,
            a.canonical_name as a_name, b.canonical_name as b_name
       from duplicate_reviews r
       join accounts a on a.account_id = r.account_a_id
       join accounts b on b.account_id = r.account_b_id
      where r.status = 'OPEN'
        and a.merged_into_account_id is null
        and b.merged_into_account_id is null
      order by r.first_seen_at asc
      limit ${Math.max(1, Math.min(200, limit))}`);

  return rows.map((row) => ({
    duplicateReviewId: row.duplicate_review_id,
    accountAId: row.account_a_id, accountBId: row.account_b_id,
    nameA: row.a_name, nameB: row.b_name,
    candidateRule: row.candidate_rule,
    evidenceFor: row.evidence_for, evidenceAgainst: row.evidence_against,
    status: row.status, firstSeenAt: row.first_seen_at,
  }));
}

/**
 * Records that a person has judged a pair.
 *
 * NOT_DUPLICATE is the decision that matters most: it is remembered, so the pair is
 * never presented again however many rules would propose it. A queue that forgets is
 * a queue nobody finishes.
 */
export async function decideDuplicate(input: {
  duplicateReviewId: string;
  decision: 'MERGED' | 'NOT_DUPLICATE';
  decidedBy: string;
  /**
   * The decider's role. A merge moves another rep's call history into somebody
   * else's book, so `mergeAccounts` is manager-only -- and this queue goes through
   * that gate rather than around it. Deciding "not a duplicate" is a judgement
   * anybody working the list can make: it changes no record.
   */
  decidedByRole: Role;
  note?: string | null;
  /** Which of the pair survives. Required for a merge. */
  survivingAccountId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await query<{
    account_a_id: string; account_b_id: string; status: string;
  }>('select account_a_id, account_b_id, status from duplicate_reviews where duplicate_review_id = $1',
    [input.duplicateReviewId]);
  const review = rows[0];
  if (!review) return { ok: false, reason: 'No such review.' };
  if (review.status !== 'OPEN') {
    return { ok: false, reason: `That pair was already decided: ${review.status}.` };
  }

  if (input.decision === 'MERGED') {
    const surviving = input.survivingAccountId;
    if (!surviving || ![review.account_a_id, review.account_b_id].includes(surviving)) {
      return { ok: false,
        reason: 'A merge has to say which of the two survives, and it must be one of '
          + 'them.' };
    }
    const merged = surviving === review.account_a_id
      ? review.account_b_id : review.account_a_id;

    const { mergeAccounts } = await import('./merge.js');
    const result = await mergeAccounts(
      {
        survivingAccountId: surviving, mergedAccountId: merged,
        matchRule: 'manual_review',
        reason: input.note ?? 'Merged from the duplicate review queue.',
      },
      { userId: input.decidedBy, role: input.decidedByRole },
    );
    if (!result.ok) {
      return { ok: false, reason: result.message ?? result.reason ?? 'The merge was refused.' };
    }
  }

  await withTransaction(async (client) => {
    await client.query(
      `update duplicate_reviews
          set status = $2, decided_by = $3, decided_at = now(), decision_note = $4
        where duplicate_review_id = $1`,
      [input.duplicateReviewId, input.decision, input.decidedBy, input.note ?? null]);
    await client.query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'duplicate_review', $3, $4::jsonb)`,
      [input.decidedBy, `duplicate.${input.decision.toLowerCase()}`,
        input.duplicateReviewId,
        JSON.stringify({ note: input.note ?? null })]);
  });

  return { ok: true };
}

/** How much is waiting, and how much has been settled. */
export async function duplicateQueueCounts(): Promise<{
  open: number; merged: number; notDuplicate: number;
}> {
  const { rows } = await query<{ open: number; merged: number; not_duplicate: number }>(
    `select count(*) filter (where status = 'OPEN')::int as open,
            count(*) filter (where status = 'MERGED')::int as merged,
            count(*) filter (where status = 'NOT_DUPLICATE')::int as not_duplicate
       from duplicate_reviews`);
  return {
    open: rows[0]!.open, merged: rows[0]!.merged, notDuplicate: rows[0]!.not_duplicate,
  };
}
