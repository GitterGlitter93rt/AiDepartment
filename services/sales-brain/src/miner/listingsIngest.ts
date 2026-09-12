import { query, withTransaction } from '../db/pool.js';
import { upsertAccount } from '../domain/accounts.js';
import { enqueueAccountResearch } from '../workers/enqueue.js';
import { negativeTermsFor, matchesNegativeTerm } from './searchTaxonomy.js';
import { isUsableListing, type BusinessListing } from './listings.js';

/**
 * Listings converging on the same canonical Accounts as everything else.
 *
 * The point of the source split is that it does not produce a second inventory. A
 * company found in Maps, seen in a SERP a week later and bought in an Apollo list
 * the month before is one Account with three provenance trails -- and whichever
 * source arrives first must not own it, because arrival order is an accident of
 * scheduling and a rep's ownership, call history and DNC state are not.
 */

export interface ListingsIngestionCounts {
  candidates: number;
  rejected: number;
  excludedByVertical: number;
  matchedExisting: number;
  created: number;
  researchQueued: number;
  exclusionReasons: string[];
}

export async function ingestListings(input: {
  listings: BusinessListing[];
  provider: string;
  verticalProfileId: string | null;
  marketId?: string | null;
  jobId?: string | null;
  requestedBy?: string | null;
  /** The geography the listings search was scoped to. */
  searchedGeographyType?: string | null;
  searchedGeographyValue?: string | null;
}): Promise<ListingsIngestionCounts> {
  const counts: ListingsIngestionCounts = {
    candidates: input.listings.length, rejected: 0, excludedByVertical: 0,
    matchedExisting: 0, created: 0, researchQueued: 0, exclusionReasons: [],
  };
  const createdAccountIds: string[] = [];

  const negativeTerms = input.verticalProfileId
    ? await negativeTermsFor(input.verticalProfileId) : [];

  for (const listing of input.listings) {
    if (!isUsableListing(listing)) { counts.rejected += 1; continue; }

    const excluded = negativeTerms.length > 0
      ? matchesNegativeTerm(listing.name, listing.domain, negativeTerms) : null;
    if (excluded) {
      counts.rejected += 1;
      counts.excludedByVertical += 1;
      counts.exclusionReasons.push(`${listing.name}: "${excluded}"`);
      continue;
    }

    await withTransaction(async (client) => {
      const result = await upsertAccount(
        client,
        {
          canonicalName: listing.name,
          website: listing.domain ? `https://${listing.domain}` : null,
          phone: listing.phone,
          // A listing carries a real address, which a SERP row almost never does.
          // A listing carries a real address when it has one, and nothing when it
          // does not. The searched geography is not a substitute: see marketMiner,
          // where the same fallback manufactured a location for every Account the
          // first canary created.
          city: listing.city ?? null,
          state: listing.state ?? null,
          postalCode: listing.postalCode ?? null,
          verticalProfileId: input.verticalProfileId,
          // The listing id names the business and keeps naming it. This is the
          // identity a SERP task id was never entitled to be.
          sourceIdentity: {
            provider: input.provider, entityType: 'business',
            nativeId: listing.providerListingId, retentionClass: 'identifier_only',
          },
        },
        {
          discoverySource: `listings:${input.provider}`,
          marketId: input.marketId ?? null,
        },
      );
      if (result.created) { counts.created += 1; createdAccountIds.push(result.accountId); }
      else counts.matchedExisting += 1;

      // A listings provider resolved the entity itself: the row is a business record
      // with a provider listing id, a name, a category and usually an address, not a
      // page that mentions a company. That is the strongest identity this product
      // gets, and it is the same basis `BUSINESS_LISTING` promotes on in the SERP
      // resolver -- so a listing that did not say so would leave real companies
      // unverified and unclaimable, which is the failure the entity gate would cause
      // rather than prevent.
      if (result.created) {
        await client.query(
          `update accounts set entity_status = 'verified',
                  entity_status_basis = $2, entity_status_at = now()
            where account_id = $1 and entity_status = 'legacy_unverified'`,
          [result.accountId, `a ${input.provider} business listing`]);
      }

      await client.query(
        `insert into search_observations (mining_job_id, provider, source_type, observed_name,
                                          observed_domain, observed_phone, observed_location,
                                          result_type, retention_class, account_id, job_id,
                                          provider_native_id, category, rating, review_count,
                                          observed_at)
         values (null, $1, 'listings', $2, $3, $4, $5, 'local_result', 'transient', $6, $7,
                 $8, $9, $10, $11, coalesce($12::timestamptz, now()))`,
        [
          input.provider, listing.name, listing.domain, listing.phone,
          listing.address ?? ([listing.city, listing.state].filter(Boolean).join(', ') || null),
          result.accountId, input.jobId ?? null, listing.providerListingId,
          listing.category, listing.rating, listing.reviewCount, listing.observedAt,
        ],
      );

      if (input.marketId) {
        await client.query(
          `insert into account_market_membership (account_id, market_id, discovery_source)
           values ($1, $2, $3)
           on conflict (account_id, market_id) do update set last_seen_at = now()`,
          [result.accountId, input.marketId, `listings:${input.provider}`]);
      }
    });
  }

  // Enqueued after the transactions, so a research job never exists for an Account
  // that rolled back.
  for (const accountId of createdAccountIds) {
    const queued = await enqueueAccountResearch(
      accountId, input.requestedBy ?? null, 'newly_discovered');
    if (queued.created) counts.researchQueued += 1;
  }

  return counts;
}

/**
 * The rating and review count a listings source gave us, most recent first.
 *
 * Read back rather than copied onto the Account: a rating is a fact about a moment,
 * and a column would quietly become "the last number we saw" with no date on it.
 */
export async function latestListingFacts(accountId: string): Promise<{
  category: string | null; rating: number | null; reviewCount: number | null;
  provider: string; observedAt: Date;
} | null> {
  const { rows } = await query<{
    category: string | null; rating: string | null; review_count: number | null;
    provider: string; observed_at: Date;
  }>(
    `select category, rating::text, review_count, provider, observed_at
       from search_observations
      where account_id = any(select account_id from merged_chain($1))
        and source_type = 'listings'
      order by observed_at desc limit 1`, [accountId]);
  const row = rows[0];
  if (!row) return null;
  return {
    category: row.category,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: row.review_count,
    provider: row.provider,
    observedAt: row.observed_at,
  };
}
