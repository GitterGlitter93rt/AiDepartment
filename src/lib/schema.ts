// Structured-data builders, in one place.
//
// ---------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
//
// A live crawl on 2026-09-09 reported the same two defects across the
// whole site:
//
//   Article missing required "image"          — every resource page
//   Organization missing "logo"               — homepage, and the
//                                               author/publisher objects
//                                               inside every Article
//
// Both were caused by the same thing: the Organization object was typed
// out by hand in two places (BaseLayout and the resource template) and
// neither copy had a logo. That is the identical failure mode that left
// nine industry pages without BreadcrumbList in Sprint 13 — a schema
// object living in whichever file happened to be open.
//
// So the objects are built here and imported. A future page that needs
// Organization or Article schema gets a complete one by construction.
//
// ---------------------------------------------------------------------
// RULES
// ---------------------------------------------------------------------
//
//   - Every URL emitted is absolute. Google resolves relative URLs
//     inconsistently in JSON-LD and a relative logo is the same as no
//     logo.
//   - Organization.name stays the consumer brand; legalName carries the
//     registered entity. Sprint 13 established that split so a Twilio
//     A2P reviewer can reconcile the site with the registered Brand
//     without the brand being renamed. Do not collapse it.
//   - Nothing here invents a person, a rating, a review, a price, or an
//     FAQ. Schema must describe what is actually on the page.

import { SITE } from './site.ts';
import { LEGAL_ENTITY } from './businessIdentity.ts';

/** Resolve a site-root path to an absolute URL. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE.domain).toString();
}

/**
 * The brand logo, as an ImageObject.
 *
 * `/icon-512.png` is the existing YAD mark already shipped for the
 * favicon/manifest set — a real brand asset, not a graphic invented for
 * schema. 512x512 clears Google's 112x112 minimum comfortably.
 */
export function logoImageObject() {
  return {
    '@type': 'ImageObject',
    url: absoluteUrl(SITE.logoImage),
    width: SITE.logoImageSize.width,
    height: SITE.logoImageSize.height,
  };
}

/**
 * The full Organization node, for the homepage.
 *
 * legalName is what lets a reviewer reconcile "Your AI Department" the
 * brand with the legally registered operator, without either name
 * having to displace the other.
 */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    legalName: LEGAL_ENTITY,
    url: SITE.domain,
    logo: logoImageObject(),
    image: absoluteUrl(SITE.defaultSocialImage),
    description: SITE.defaultDescription,
  };
}

/**
 * The Organization as it appears nested inside another node — an
 * Article's author or publisher.
 *
 * No `@context`: a nested node inherits it from its parent, and
 * repeating it is noise. It carries the logo because that is precisely
 * what the validator flagged as missing on the publisher object.
 */
export function organizationRef() {
  return {
    '@type': 'Organization',
    name: SITE.name,
    legalName: LEGAL_ENTITY,
    url: SITE.domain,
    logo: logoImageObject(),
  };
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.domain,
    publisher: organizationRef(),
  };
}

export interface ArticleSchemaInput {
  headline: string;
  description: string;
  /** Site-root path, e.g. `/resources/why-speed-to-lead-matters/`. */
  path: string;
  datePublished: string;
  dateModified: string;
  /**
   * Site-root path to an article image. The resource collection has no
   * per-article image field today, so callers pass nothing and the
   * site's 1200x630 social image is used. That is a real, correct image
   * of the right aspect ratio for this content — not a placeholder — and
   * when per-article art exists, this is the one argument to start
   * passing.
   */
  image?: string;
}

export function articleSchema(input: ArticleSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.headline,
    description: input.description,
    // The field the validator reported missing on every resource page.
    image: absoluteUrl(input.image ?? SITE.defaultSocialImage),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: organizationRef(),
    publisher: organizationRef(),
    mainEntityOfPage: absoluteUrl(input.path),
  };
}

export interface Crumb {
  name: string;
  item: string;
}

export function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  };
}
