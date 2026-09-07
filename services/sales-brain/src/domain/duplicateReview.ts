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
/**
 * Pairs worth a person's attention, with the case for and against each.
 *
 * The shape matters at scale. The first version built a `live` view of every
 * unmerged Account -- three correlated subqueries each for city, state and phone --
 * and self-joined it: at a hundred thousand Accounts that was 1.8 seconds, and every
 * one of those subqueries ran for a row that could not possibly collide with
 * anything.
 *
 * The colliding keys are cheap to find first. A name that appears once cannot be a
 * duplicate of anything, and a phone on one Account cannot be shared. So the
 * expensive view is built only for Accounts that already share a key with somebody,
 * which on real inventory is a small fraction of it.
 *
 * The name-subset rule cannot be reduced to an equality key -- "roofing" inside
 * "salazar roofing repair" is a pattern match, not a lookup -- so it is bounded
 * instead: both Accounts must be in the same city, and the contained name must be
 * short enough to be a plausible fragment rather than a coincidence.
 */
const CANDIDATE_SQL = `
with eligible as (
  select account_id, canonical_name, normalized_name, canonical_domain
    from accounts
   where merged_into_account_id is null and not is_suppressed
),
colliding_names as (
  select normalized_name from eligible
   group by normalized_name having count(*) > 1
),
colliding_phones as (
  select e.normalized_value
    from contact_endpoints e
    join eligible a on a.account_id = e.account_id
   where e.endpoint_type = 'PHONE' and e.is_active
   group by e.normalized_value having count(distinct a.account_id) > 1
),
-- Only Accounts that already share a key with somebody. Everything below is built
-- for these rather than for the whole inventory.
narrowed as (
  select account_id from eligible
   where normalized_name in (select normalized_name from colliding_names)
  union
  select a.account_id
    from eligible a
    join contact_endpoints e on e.account_id = a.account_id
   where e.endpoint_type = 'PHONE' and e.is_active
     and e.normalized_value in (select normalized_value from colliding_phones)
  union
  -- The subset rule's short side only. The long side is reached through the city
  -- index in the arm itself, so it does not need the expensive view.
  --
  -- Measured rather than guessed: a three-token bound admitted 80,858 of 97,009
  -- Accounts, because company names average three words -- so the "prefilter" was
  -- the whole table plus overhead, and made the sweep slower than no filter at all.
  -- Two tokens admits 29,481, and is also the more honest rule: this exists to catch
  -- a heading like "Roofing" absorbing a real company, and a three-word name inside
  -- a longer one is far more often coincidence than duplication.
  select account_id from eligible
   where array_length(string_to_array(normalized_name, ' '), 1) <= 2
),
live as (
  select a.account_id, a.canonical_name, a.normalized_name, a.canonical_domain,
         (select l.city from locations l where l.account_id = a.account_id
           order by l.is_headquarters desc nulls last limit 1) as city,
         (select l.state_region from locations l where l.account_id = a.account_id
           order by l.is_headquarters desc nulls last limit 1) as state_region,
         (select e.normalized_value from contact_endpoints e
           where e.account_id = a.account_id and e.endpoint_type = 'PHONE'
             and e.is_active order by e.created_at limit 1) as phone
    from eligible a
   where a.account_id in (select account_id from narrowed)
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
--
-- Both directions, all three positions. Five of the six clauses were written and the
-- sixth was not, so this was only caught when the shorter name happened to sort
-- first by uuid -- which is to say, half the time, unreproducibly.
--
-- The short side comes from the narrowed view and the long side from the indexed
-- city lookup, rather than both from the view. Narrowing it to Accounts that share a
-- key broke this arm: only the short name qualified, so "Salazar Roofing Repair" was
-- not in the view at all and the pair could not form. The long side needs a name and
-- a city, which the locations city index already answers.
select x.account_id, y.account_id, x.canonical_name, y.canonical_name,
       x.canonical_domain, y.canonical_domain, x.city, ly.city,
       x.state_region, ly.state_region, x.phone, null::text,
       'name_subset_same_place'
  from live x
  join locations lx on lx.account_id = x.account_id and lx.city is not null
  join locations ly on lower(ly.city) = lower(lx.city) and ly.account_id <> x.account_id
  join eligible y on y.account_id = ly.account_id
 -- Not an a-before-b constraint: x is always the short side here, so demanding
 -- it also sort first means the pair only forms when the shorter name happens to
 -- have the lower uuid -- half the time, unreproducibly. That is the same asymmetry
 -- bug this rule already had once, in a new guise. The pair is ordered below instead.
 where x.account_id <> y.account_id
   and array_length(string_to_array(x.normalized_name, ' '), 1) <= 2
   and x.normalized_name <> y.normalized_name
   and (y.normalized_name like x.normalized_name || ' %'
     or y.normalized_name like '% ' || x.normalized_name
     or y.normalized_name like '% ' || x.normalized_name || ' %')
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
  const found = await query<PairRow>(CANDIDATE_SQL);
  if (found.rows.length === 0) return { found: 0, queued: 0, alreadyDecided: 0 };

  // One canonical ordering per pair, so (a,b) and (b,a) are the same review.
  //
  // The subset arm is deliberately asymmetric -- one side is the short name -- so it
  // cannot carry the ordering constraint itself. Done here, and deduplicated, because
  // two arms can propose the same pair.
  const seen = new Set<string>();
  const rows: PairRow[] = [];
  for (const row of found.rows) {
    const flip = row.b_id < row.a_id;
    const ordered: PairRow = flip
      ? {
        ...row,
        a_id: row.b_id, b_id: row.a_id,
        a_name: row.b_name, b_name: row.a_name,
        a_domain: row.b_domain, b_domain: row.a_domain,
        a_city: row.b_city, b_city: row.a_city,
        a_state: row.b_state, b_state: row.a_state,
        a_phone: row.b_phone, b_phone: row.a_phone,
      }
      : row;
    const key = `${ordered.a_id}:${ordered.b_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(ordered);
  }

  // One statement, not two per pair.
  //
  // This looped over the candidates asking about each and then inserting it: five
  // hundred pairs meant a thousand round trips, which at a hundred thousand Accounts
  // was 1.15 seconds of the sweep's 2.1 -- more than the query it was iterating.
  // `xmax = 0` distinguishes a row this statement inserted from one it found, so the
  // counts come back without a second pass.
  const { rows: written } = await query<{ inserted: boolean; status: string }>(
    `insert into duplicate_reviews (account_a_id, account_b_id, candidate_rule,
                                     evidence_for, evidence_against)
     select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::jsonb[], $5::jsonb[])
     on conflict (account_a_id, account_b_id)
       -- Touched, never resurrected: a pair somebody has judged keeps its status and
       -- simply records that the rules proposed it again.
       do update set last_seen_at = now()
     returning (xmax = 0) as inserted, duplicate_reviews.status`,
    [
      rows.map((row) => row.a_id),
      rows.map((row) => row.b_id),
      rows.map((row) => row.rule),
      rows.map((row) => JSON.stringify(evidenceFor(row))),
      rows.map((row) => JSON.stringify(evidenceAgainst(row))),
    ]);

  return {
    found: rows.length,
    queued: written.filter((row) => row.inserted).length,
    alreadyDecided: written.filter(
      (row) => !row.inserted && row.status !== 'OPEN').length,
  };
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
