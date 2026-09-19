import type { DiscoveryStatus } from '../workers/marketMiner.js';

/**
 * Entity discovery, as distinct from search-result observation.
 *
 * A SERP tells us who ranked and who paid for a query on a day. It is evidence about
 * advertising and position, and its identity is weak: a row carries a domain or a
 * phone and nothing that stably names the business. That weakness already cost us
 * once -- the adapter fell back to the provider's *task* id and collapsed every
 * company in a search into one Account.
 *
 * A business listing is the opposite shape. It is an entity record: a name, an
 * address, a category and a listing id that means the same business tomorrow. It
 * says almost nothing about advertising and nearly everything about who exists.
 *
 * So the two are different sources with different jobs, and the listing id is a
 * legitimate provider identity in a way a search task id never was:
 *
 *   listings  -> the universe of businesses in a category and a place
 *   SERP      -> which of them rank, and which of them pay
 *   website   -> what they actually do and how to reach them
 *
 * All three converge on the same canonical Account. There is no second database, and
 * no source owns a company: whichever arrives first creates the record and the rest
 * fill it in.
 */

export interface BusinessListing {
  /** The provider's stable id for this business. Unlike a SERP task id, this names it. */
  providerListingId: string;
  name: string;
  domain: string | null;
  phone: string | null;
  /** Street address as the provider gave it, unparsed. */
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** The provider's own category string, e.g. "Roofing contractor". */
  category: string | null;
  /** Present on Maps-style sources, absent on many others. Null is not zero. */
  rating: number | null;
  reviewCount: number | null;
  /** When the provider says it saw this, not when we collected it. */
  observedAt: Date | null;
}

export interface ListingsResult {
  status: DiscoveryStatus;
  listings: BusinessListing[];
  /** Rows the provider returned, before anything was dropped. */
  providerRows: number;
  /** Rows that named no business we could resolve. */
  rejectedRows: number;
  /** Rows collapsed onto another row in the same response. */
  duplicateRows: number;
  costUsd?: number | null;
  reason?: string;
  providerTaskId?: string;
}

export interface ListingsQuery {
  verticalProfileId: string | null;
  /** The provider category or search term for the trade. */
  category: string;
  /** A place the provider can geocode. */
  locationName: string;
  geographyType: string | null;
  geographyValue: string | null;
  /** Identity of this one listings search. */
  fingerprint: string;
  /** How many results to ask for. */
  limit: number;
}

export interface ListingsAdapter {
  name: string;
  requiresCredential: boolean;
  /** Source governance, same gate as a SERP provider. Registering is not enabling. */
  governanceReviewed: boolean;
  isConfigured(): boolean;
  discoverListings(request: ListingsQuery): Promise<ListingsResult>;
  /** For providers that queue a task and answer later. */
  collectListings?(providerTaskId: string, request: ListingsQuery): Promise<ListingsResult>;
}

const listingsAdapters: ListingsAdapter[] = [];

/**
 * One adapter per provider name, replaced rather than appended.
 *
 * The same rule the SERP registry needed: registering twice used to mean searching
 * and being billed twice, because the orchestrator loops over the registry.
 */
export function registerListingsAdapter(adapter: ListingsAdapter): void {
  const existing = listingsAdapters.findIndex((held) => held.name === adapter.name);
  if (existing >= 0) listingsAdapters[existing] = adapter;
  else listingsAdapters.push(adapter);
}

export function clearListingsAdapters(): void { listingsAdapters.length = 0; }

export function availableListingsAdapters(): ListingsAdapter[] {
  return listingsAdapters.filter(
    (adapter) => adapter.governanceReviewed && adapter.isConfigured());
}

/** A result for a call that never reached the provider, or that it refused. */
export function refusedListings(status: DiscoveryStatus, reason: string): ListingsResult {
  return { status, listings: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0, reason };
}

/**
 * A listing has to name a business before it can become one.
 *
 * The same bar discovery already applies, plus the listing id: a Maps row with no
 * stable id is a row we cannot recognise again, which makes it a SERP observation
 * wearing a listing's clothes.
 */
export function isUsableListing(listing: BusinessListing): boolean {
  if (!listing.providerListingId.trim()) return false;
  if (!listing.name.trim()) return false;
  return Boolean(listing.domain || listing.phone || listing.address);
}

/**
 * One company per response.
 *
 * Collapsed on the provider's own listing id first, because that is what it is for.
 * Two rows with the same id are the same business listed twice; two rows with
 * different ids are two businesses even when their names look alike, and merging
 * those is entity resolution's job with more to go on than a category and a street.
 */
export function dedupeListings(listings: BusinessListing[]): BusinessListing[] {
  const byId = new Map<string, BusinessListing>();
  for (const listing of listings) {
    if (!isUsableListing(listing)) continue;
    const held = byId.get(listing.providerListingId);
    // The richer row wins: a listing with a domain and a rating tells us more than
    // the same listing without them.
    if (!held || fieldsKnown(listing) > fieldsKnown(held)) {
      byId.set(listing.providerListingId, listing);
    }
  }
  return [...byId.values()];
}

function fieldsKnown(listing: BusinessListing): number {
  return [listing.domain, listing.phone, listing.address, listing.category,
    listing.rating, listing.reviewCount].filter((value) => value !== null).length;
}
