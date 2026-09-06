import { query } from '../db/pool.js';
import { advertiserEvidenceFor, type AdvertiserState } from './advertiserEvidence.js';

/**
 * What we know about a company, and how we know it.
 *
 * Every fact here used to be answered somewhere as a yes or a no, and the gap
 * between the two swallowed the only distinction that matters commercially. "We
 * looked and there was no ad" and "nobody has ever looked" are different facts about
 * the world; rendered as the same "no", a rep skips a company nobody has researched
 * believing it was researched and found wanting.
 *
 * The live failure that named this: a company whose website we hold, on a page
 * saying it had none. A record can be missing a fact for six different reasons and
 * the rep needs to know which one, because each implies a different next action --
 * go and look, look again, ask on the call, or trust it.
 *
 *   YES           observed, current, and safe to say out loud
 *   NO            observed to be absent, where absence is itself a finding
 *   NOT_OBSERVED  we looked, in one place, on one day, and did not see it
 *   NOT_CHECKED   nothing has ever looked
 *   UNKNOWN       we looked and the answer is genuinely indeterminate
 *   CONFLICT      two sources disagree and neither wins
 *
 * NO is the rarest and the most dangerous. Most absences are NOT_OBSERVED: one
 * search, one page, one day. We can prove a company advertises. We cannot prove it
 * does not.
 */

export type FactState =
  | 'YES' | 'NO' | 'NOT_OBSERVED' | 'NOT_CHECKED' | 'UNKNOWN' | 'CONFLICT';

export interface ResearchFact {
  key: string;
  /** What a rep would call it. */
  label: string;
  state: FactState;
  /** A sentence that is true of the evidence, never of the company beyond it. */
  detail: string;
  /** When the underlying observation was made, when there is one. */
  observedAt: Date | null;
  /** True when a rep may state this on a call. */
  canStateAsFact: boolean;
}

export interface ResearchPicture {
  facts: ResearchFact[];
  /** Facts nothing has ever looked at. */
  notChecked: number;
  /** Facts where our sources disagree. */
  conflicts: number;
}

/** States that mean "we do not know", however we got there. */
export const UNKNOWING: ReadonlySet<FactState> = new Set<FactState>([
  'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN', 'CONFLICT',
]);

const ADVERTISER_STATE: Record<AdvertiserState, FactState> = {
  CONFIRMED: 'YES',
  // Never NO. One search that did not show an ad is one search.
  NOT_OBSERVED: 'NOT_OBSERVED',
  STALE: 'UNKNOWN',
  UNKNOWN: 'NOT_CHECKED',
};

interface EvidenceSummary {
  claim_key: string;
  observed_at: Date;
  expired: boolean;
  contradicted: boolean;
  can_state_as_fact: boolean;
  claim_text: string;
}

/**
 * One evidence-backed fact, in the six states.
 *
 * Absence of evidence is NOT_CHECKED when nothing has ever researched this Account,
 * and NOT_OBSERVED when something has: those are different claims and the research
 * run is what tells them apart.
 */
function factFromEvidence(
  key: string, label: string, rows: EvidenceSummary[], everResearched: boolean,
  absentDetail: string,
): ResearchFact {
  const matching = rows.filter((row) => row.claim_key === key);
  const contradicted = matching.filter((row) => row.contradicted);
  const current = matching.filter((row) => !row.expired && !row.contradicted);
  const expired = matching.filter((row) => row.expired && !row.contradicted);

  if (contradicted.length > 0 && current.length === 0) {
    return {
      key, label, state: 'CONFLICT', canStateAsFact: false,
      observedAt: contradicted[0]!.observed_at,
      detail: 'Two sources disagree about this and neither wins, so it is not something '
        + 'to state. Ask on the call.',
    };
  }
  if (current.length > 0) {
    const best = current[0]!;
    return {
      key, label, state: 'YES', observedAt: best.observed_at,
      canStateAsFact: best.can_state_as_fact, detail: best.claim_text,
    };
  }
  if (expired.length > 0) {
    return {
      key, label, state: 'UNKNOWN', observedAt: expired[0]!.observed_at, canStateAsFact: false,
      detail: 'This was true when we last looked and that observation has aged out. '
        + 'Do not say "currently" until it is re-checked.',
    };
  }
  return {
    key, label,
    state: everResearched ? 'NOT_OBSERVED' : 'NOT_CHECKED',
    observedAt: null, canStateAsFact: false,
    detail: everResearched
      ? absentDetail
      : 'Nothing has researched this company yet, so this has never been looked at.',
  };
}

export async function researchPictureFor(accountId: string): Promise<ResearchPicture> {
  const [accountRows, domainRows, evidenceRows, runRows, endpointRows, contactRows] =
    await Promise.all([
      query<{ canonical_domain: string | null; last_researched_at: Date | null }>(
        'select canonical_domain, last_researched_at from accounts where account_id = $1',
        [accountId]),
      query<{ hostname: string; canonical_url: string | null }>(
        `select hostname, canonical_url from account_domains
          where account_id = $1 and domain_role = 'primary' limit 1`, [accountId]),
      query<EvidenceSummary>(
        `select claim_key, observed_at, claim_text, can_state_as_fact,
                (expires_at is not null and expires_at <= now()) as expired,
                (contradicted_by_evidence_id is not null) as contradicted
           from evidence_records
          where account_id = any(select account_id from merged_chain($1))
          order by observed_at desc`, [accountId]),
      // pages_fetched lives inside adapter_results rather than in a column of its
      // own, which is where the run writes it.
      query<{ n: number; pages_fetched: number }>(
        `select count(*)::int as n,
                coalesce(sum(coalesce((adapter_results->>'pages_fetched')::int, 0)), 0)::int
                  as pages_fetched
           from research_runs where account_id = $1`, [accountId]),
      query<{ usable: number }>(
        `select count(*)::int as usable from contact_endpoints
          where account_id = $1 and is_active and not is_suppressed`, [accountId]),
      query<{ named: number }>(
        `select count(*)::int as named from contacts
          where account_id = $1 and status = 'ACTIVE' and not is_role_placeholder`,
        [accountId]),
    ]);

  const account = accountRows.rows[0];
  const everResearched = Boolean(account?.last_researched_at) || (runRows.rows[0]?.n ?? 0) > 0;
  const evidence = evidenceRows.rows;
  const facts: ResearchFact[] = [];

  // --- the website -------------------------------------------------------------
  //
  // Two places hold this -- `accounts.canonical_domain` and `account_domains` -- and
  // the fact is YES if either does. A record whose website we hold can never be
  // reported as having none, whichever half of the schema a page happens to read.
  const knownDomain = account?.canonical_domain ?? domainRows.rows[0]?.hostname ?? null;
  facts.push(knownDomain
    ? {
      key: 'website', label: 'Website', state: 'YES', observedAt: null,
      canStateAsFact: true, detail: knownDomain,
    }
    : {
      key: 'website', label: 'Website',
      // Not NO. We cannot prove a company has no website; we can only say we have
      // not found one.
      state: everResearched ? 'NOT_OBSERVED' : 'NOT_CHECKED',
      observedAt: null, canStateAsFact: false,
      detail: everResearched
        ? 'Research ran and no website was found for this company. That is what we '
          + 'looked at, not proof there is none.'
        : 'Nothing has researched this company yet.',
    });

  // Whether we actually read it. A site we hold and could not fetch is a different
  // state from one we read: a blocked or dead site is why the rest of the picture
  // is thin, and the rep should see the reason rather than the emptiness.
  const pagesFetched = runRows.rows[0]?.pages_fetched ?? 0;
  facts.push({
    key: 'website_read', label: 'Website read',
    state: !knownDomain ? 'NOT_CHECKED'
      : pagesFetched > 0 ? 'YES'
      : everResearched ? 'NOT_OBSERVED' : 'NOT_CHECKED',
    observedAt: null, canStateAsFact: false,
    detail: !knownDomain
      ? 'There is no site on record to read.'
      : pagesFetched > 0
        ? `${pagesFetched} page(s) of the company's own site were read.`
        : everResearched
          ? 'We hold a website for this company and research could not read it — '
            + 'blocked, moved or down. Everything below is thin because of that, not '
            + 'because the company is.'
          : 'The site has not been read yet.',
  });

  // --- how to reach them -------------------------------------------------------
  const usableEndpoints = endpointRows.rows[0]?.usable ?? 0;
  facts.push({
    key: 'contact_route', label: 'A way to reach them',
    state: usableEndpoints > 0 ? 'YES' : everResearched ? 'NOT_OBSERVED' : 'NOT_CHECKED',
    observedAt: null, canStateAsFact: usableEndpoints > 0,
    detail: usableEndpoints > 0
      ? `${usableEndpoints} usable contact route(s).`
      : everResearched
        ? 'Research found no usable phone or email. Contact research is what fixes '
          + 'this, not a different prospect.'
        : 'Nobody has looked for a way to reach this company.',
  });

  facts.push({
    key: 'decision_maker', label: 'Who to ask for',
    state: (contactRows.rows[0]?.named ?? 0) > 0
      ? 'YES' : everResearched ? 'NOT_OBSERVED' : 'NOT_CHECKED',
    observedAt: null, canStateAsFact: (contactRows.rows[0]?.named ?? 0) > 0,
    detail: (contactRows.rows[0]?.named ?? 0) > 0
      ? 'A named person is on file.'
      : everResearched
        ? 'No named decision-maker was found in public sources. Ask the gatekeeper.'
        : 'Nobody has looked for a named person.',
  });

  // --- what they do ------------------------------------------------------------
  for (const [key, label, absent] of [
    ['emergency_24_7_service', 'Emergency / 24-7 service',
      'Their site does not claim it. Plenty of companies offer it without saying so.'],
    ['online_quote_booking', 'Online booking or quote form',
      'None was found on the pages we read.'],
    ['multiple_locations', 'More than one location',
      'Only one location was found, which is what the pages showed.'],
  ] as const) {
    facts.push(factFromEvidence(key, label, evidence, everResearched, absent));
  }

  // --- advertising -------------------------------------------------------------
  const advertising = await advertiserEvidenceFor(accountId);
  for (const channel of advertising.channels) {
    facts.push({
      key: `advertising_${channel.channel}`,
      label: channel.label,
      state: ADVERTISER_STATE[channel.state],
      observedAt: channel.observedAt,
      canStateAsFact: channel.state === 'CONFIRMED',
      detail: channel.summary,
    });
  }

  // --- what a listings source knows --------------------------------------------
  //
  // These were "nothing collects this" until a business-listings adapter existed.
  // The state still distinguishes the three cases that matter: a listings source has
  // run and gave us a number, one has run and gave us none, or none has ever run.
  // A rating that is absent from a provider's answer is not a company with no
  // reviews, and a zero here would be worse than either.
  const { latestListingFacts } = await import('../miner/listingsIngest.js');
  const listing = await latestListingFacts(accountId);

  facts.push({
    key: 'business_listing', label: 'Business listing',
    state: listing ? 'YES' : 'NOT_CHECKED',
    observedAt: listing?.observedAt ?? null,
    canStateAsFact: Boolean(listing),
    detail: listing
      ? `Listed as "${listing.category ?? 'an uncategorised business'}" by `
        + `${listing.provider}.`
      : 'No business-listings source has looked this company up.',
  });

  facts.push({
    key: 'rating_and_reviews', label: 'Rating and review count',
    state: !listing ? 'NOT_CHECKED'
      : listing.rating === null && listing.reviewCount === null ? 'NOT_OBSERVED' : 'YES',
    observedAt: listing?.observedAt ?? null,
    canStateAsFact: Boolean(listing && listing.rating !== null),
    detail: !listing
      ? 'Nothing has looked this company up in a business-listings source. It is not '
        + 'zero and it is not missing — it has never been looked at.'
      : listing.rating === null && listing.reviewCount === null
        ? `${listing.provider} returned this listing without a rating. That is a gap in `
          + 'their record, not a company with no reviews.'
        : `${listing.rating ?? 'no'} stars from ${listing.reviewCount ?? 'an unstated '
          + 'number of'} review(s), per ${listing.provider}.`,
  });

  return {
    facts,
    notChecked: facts.filter((fact) => fact.state === 'NOT_CHECKED').length,
    conflicts: facts.filter((fact) => fact.state === 'CONFLICT').length,
  };
}

/**
 * Plain words for a state, for a rep rather than a schema.
 *
 * Deliberately not "Confirmed". The Account page already uses that word for a
 * meeting the provider has confirmed, and a page where one word carries two
 * meanings is ambiguous to a reader before it is ambiguous to a test. "Observed" is
 * also the more accurate word for what YES means here: we saw it.
 */
export function factStateLabel(state: FactState): string {
  switch (state) {
    case 'YES': return 'Observed';
    case 'NO': return 'Absent';
    case 'NOT_OBSERVED': return 'Looked, not found';
    case 'NOT_CHECKED': return 'Never checked';
    case 'UNKNOWN': return 'Aged out';
    case 'CONFLICT': return 'Sources disagree';
  }
}
