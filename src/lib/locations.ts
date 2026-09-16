// Location architecture — the registry and the schema builder.
//
// ---------------------------------------------------------------------
// WHAT THIS FILE IS, AND DELIBERATELY IS NOT
// ---------------------------------------------------------------------
//
// This file holds the things that genuinely ARE shared across location
// pages: the market registry (so the hub, the footer and the tests all
// read one list) and the JSON-LD builder (so no page hand-types an
// Organization or invents an address).
//
// It does NOT hold page copy, and it must not start to. Every location
// page writes its own body content by hand, because near-identical city
// pages differing only by a variable are the definition of a doorway
// page, and Google treats them as one. A `blurb` here feeds the hub
// card only — it is a one-line label, not the page.
//
// If a future sprint is tempted to add `problems: string[]` or
// `industries: string[]` to these entries so pages can map over them:
// that is the doorway-page refactor. Don't. See
// docs/05-seo/local-seo.md.
//
// ---------------------------------------------------------------------
// PHYSICAL PRESENCE — THE HARD RULE
// ---------------------------------------------------------------------
//
// Your AI Department has one verified business address, in Northeast
// Florida (src/lib/businessIdentity.ts). It is a mail-handling suite
// address published on the legal pages, not a staffed office, and there
// is no premises in Orlando, Winter Park, Miami or Fort Lauderdale.
//
// So: no location page claims an office, no location page repeats a
// street address, and no page emits LocalBusiness, PostalAddress or geo
// schema. `areaServed` is the correct and honest way to say "we serve
// businesses here" — it describes the service's coverage, not a place
// the company occupies. tests/sprint17LocalAuthority.test.ts enforces
// all of this against the built HTML.

import { SITE } from './site.ts';
import { organizationRef, absoluteUrl } from './schema.ts';

/**
 * Where the company actually is.
 *
 * Deliberately a region, not a city. The verified address in
 * businessIdentity.ts carries a Jacksonville mailing city on a St.
 * Johns County road (zip 32259), so "Northeast Florida" is the
 * statement that is true under either reading. Nothing in the
 * repository supports naming St. Augustine as the company's base, so
 * the site does not say it.
 */
export const HOME_REGION = 'Northeast Florida';

export interface Market {
  /** URL slug under /locations/. */
  slug: string;
  /** City or area name as a human reads it. */
  name: string;
  /** Grouping on the hub page. */
  region: 'Northeast Florida' | 'Central Florida' | 'South Florida';
  /** One line for the hub card. NOT page copy. */
  blurb: string;
  /** schema.org area type — a county is an AdministrativeArea, not a City. */
  areaType: 'City' | 'AdministrativeArea';
}

/**
 * First-wave markets. Seven, chosen intentionally.
 *
 * Adding to this list is a commercial decision, not a content-volume
 * decision — every entry needs a hand-written page behind it before it
 * ships. Candidate future markets are recorded in
 * docs/05-seo/local-seo.md and deliberately have no stub pages.
 */
export const MARKETS: Market[] = [
  {
    slug: 'st-augustine-fl',
    name: 'St. Augustine',
    region: 'Northeast Florida',
    blurb: 'Owner-operated businesses, hospitality and home services in a heritage-tourism economy.',
    areaType: 'City',
  },
  {
    slug: 'jacksonville-fl',
    name: 'Jacksonville',
    region: 'Northeast Florida',
    blurb: 'Logistics, financial services, healthcare and a deep base of mid-market operators.',
    areaType: 'City',
  },
  {
    slug: 'st-johns-county-fl',
    name: 'St. Johns County',
    region: 'Northeast Florida',
    blurb: 'Fast-growing contractors, trades and professional firms scaling with the county.',
    areaType: 'AdministrativeArea',
  },
  {
    slug: 'orlando-fl',
    name: 'Orlando',
    region: 'Central Florida',
    blurb: 'High-volume customer operations, hospitality, healthcare and simulation technology.',
    areaType: 'City',
  },
  {
    slug: 'winter-park-fl',
    name: 'Winter Park',
    region: 'Central Florida',
    blurb: 'Boutique professional firms where a single enquiry is worth a great deal.',
    areaType: 'City',
  },
  {
    slug: 'miami-fl',
    name: 'Miami',
    region: 'South Florida',
    blurb: 'International trade, real estate, legal and finance operating across time zones.',
    areaType: 'City',
  },
  {
    slug: 'fort-lauderdale-fl',
    name: 'Fort Lauderdale',
    region: 'South Florida',
    blurb: 'Marine industry, trades and multi-location Broward operators running on scheduling.',
    areaType: 'City',
  },
];

export const REGION_ORDER: Market['region'][] = [
  'Northeast Florida',
  'Central Florida',
  'South Florida',
];

export function marketsByRegion(): { region: Market['region']; markets: Market[] }[] {
  return REGION_ORDER.map((region) => ({
    region,
    markets: MARKETS.filter((m) => m.region === region),
  }));
}

export function locationPath(slug: string): string {
  return `/locations/${slug}/`;
}

/**
 * Footer market links. A short, flat row — not a keyword block.
 */
export const FOOTER_MARKETS = MARKETS.map((m) => ({
  label: m.name,
  href: locationPath(m.slug),
}));

interface ServiceSchemaInput {
  /** e.g. "Jacksonville" or "St. Johns County". */
  areaName: string;
  areaType: Market['areaType'];
  /** Site-root path of the page. */
  path: string;
  description: string;
}

/**
 * Service schema for a location page.
 *
 * `areaServed` says where the service is offered. `provider` is the
 * Organization reference built in schema.ts — brand name, legal name,
 * logo, no address. There is intentionally no LocalBusiness node, no
 * PostalAddress, no geo, no openingHours, no priceRange and no rating:
 * every one of those would assert something about a physical presence
 * or a result that this company has not published.
 */
export function locationServiceSchema(input: ServiceSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `AI Consulting & Automation — ${input.areaName}, Florida`,
    description: input.description,
    serviceType: 'AI consulting, implementation and workflow automation',
    provider: organizationRef(),
    areaServed: {
      '@type': input.areaType,
      name: input.areaName,
      containedInPlace: {
        '@type': 'State',
        name: 'Florida',
      },
    },
    url: absoluteUrl(input.path),
  };
}

/**
 * WebPage schema for the locations hub. The hub is a directory of
 * markets rather than a service offer, so it does not claim to be one.
 */
export function locationsHubSchema(description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'AI Consulting & Automation Across Florida',
    description,
    url: absoluteUrl('/locations/'),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE.name,
      url: SITE.domain,
    },
    publisher: organizationRef(),
  };
}
