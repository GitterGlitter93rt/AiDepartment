import { extractJsonLd, stripTags } from '../resolver/adapters/firstParty.js';
import { politeFetch } from '../resolver/fetcher.js';

/**
 * What a site says it is.
 *
 * The one fact that separates a company record from a page on somebody else's site, and
 * the estate does not have it. "10 Best Roofers in St. Augustine, FL" is a record whose
 * own site calls itself "Today's Homeowner"; "Apartments for Rent in 33133 - Miami, FL"
 * sits on a site called "Apartments.com". Neither is a contractor, and neither can be
 * told apart from a badly-titled real company without asking the site.
 *
 * Three sources, in the order they deserve to be believed:
 *
 *   1. schema.org `Organization`/`LocalBusiness` `name` — written to be read by machines;
 *   2. `og:site_name` — written to be read by other sites;
 *   3. the trailing brand segment of `<title>` — written for people, and the weakest,
 *      so it is only accepted when it also matches the site's own domain.
 *
 * It is evidence about the site, never about the Account's trade, and it is recorded as
 * an observation rather than applied to anything on its own.
 */

export interface SiteIdentity {
  name: string;
  basis: 'SCHEMA_ORG_NAME' | 'OG_SITE_NAME' | 'TITLE_BRAND_SEGMENT';
  sourceReference: string;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const ORGANIZATION_TYPE =
  /(organization|localbusiness|business|contractor|store|service|company|corporation)/;

export function identityFromJsonLd(blocks: unknown[]): string | null {
  const visit = (node: any, depth = 0): string | null => {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    const types = asArray(node['@type']).map((t) => String(t).toLowerCase());
    if (types.some((t) => ORGANIZATION_TYPE.test(t)) && typeof node.name === 'string'
      && node.name.trim().length > 1) {
      return node.name.trim();
    }
    for (const key of ['@graph', 'mainEntity', 'about', 'publisher', 'isPartOf']) {
      for (const child of asArray(node[key])) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  for (const block of blocks) {
    const found = visit(block);
    if (found) return found;
  }
  return null;
}

export function identityFromMeta(html: string): string | null {
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,80})["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']{2,80})["'][^>]+property=["']og:site_name["']/i.exec(html);
  return og?.[1]?.trim() ?? null;
}

/**
 * The brand segment of a page title, accepted only when the domain agrees.
 *
 * A title is page copy by nature, so the only segment worth taking is one the site's own
 * address already says. "HVAC Services in St. Augustine, FL - Palatka - Southern Air" on
 * southernair.com yields Southern Air; the same title on a directory yields nothing.
 */
export function identityFromTitle(html: string, domain: string | null): string | null {
  if (!domain) return null;
  const title = /<title[^>]*>([\s\S]{2,200}?)<\/title>/i.exec(html)?.[1];
  if (!title) return null;
  const stem = domain.split('.')[0]!.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (stem.length < 5) return null;
  for (const segment of stripTags(title).split(/[|–—]|\s-\s|:/)) {
    const cleaned = segment.trim();
    const compact = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact.length >= 5 && (stem.includes(compact) || compact.includes(stem))) return cleaned;
  }
  return null;
}

/** One request to one homepage, through the ordinary polite fetcher. */
export async function readSiteIdentity(
  website: string, domain: string | null,
): Promise<{ identity: SiteIdentity | null; reason: string }> {
  let origin: string;
  try {
    origin = new URL(website.startsWith('http') ? website : `https://${website}`).origin;
  } catch {
    return { identity: null, reason: 'not a usable website URL' };
  }

  const response = await politeFetch(`${origin}/`);
  if (!response.ok) {
    return {
      identity: null,
      reason: response.blockedReason ?? response.failureReason ?? 'the site could not be read',
    };
  }

  const schema = identityFromJsonLd(extractJsonLd(response.body));
  if (schema) {
    return {
      identity: { name: schema, basis: 'SCHEMA_ORG_NAME', sourceReference: response.finalUrl },
      reason: 'schema.org organization name',
    };
  }
  const og = identityFromMeta(response.body);
  if (og) {
    return {
      identity: { name: og, basis: 'OG_SITE_NAME', sourceReference: response.finalUrl },
      reason: 'og:site_name',
    };
  }
  const title = identityFromTitle(response.body, domain);
  if (title) {
    return {
      identity: { name: title, basis: 'TITLE_BRAND_SEGMENT', sourceReference: response.finalUrl },
      reason: 'title segment matching the domain',
    };
  }
  return { identity: null, reason: 'the site names itself nowhere a machine can read' };
}
