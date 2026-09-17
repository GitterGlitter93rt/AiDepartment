import { registrableDomain } from './sourceClass.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * What role a source plays in relation to a company.
 *
 * `sourceClass` answered "what kind of page is this" and ended with a fallthrough: a
 * row that matched none of its shape rules was called OFFICIAL_SITE. That single line
 * is why production records homeyou.com, uhaul.com and myfloridalicense.com as a
 * contractor's own website -- a directory homepage, a moving company and a state
 * licensing portal are all URLs that look like nothing in particular.
 *
 * So ownership is now a conclusion rather than a default. COMPANY_OWNED_SITE must be
 * positively evidenced; everything that cannot be evidenced is UNKNOWN, and UNKNOWN is
 * better than wrong. Michael's rule, and the one this module exists to enforce: do not
 * assign COMPANY_OWNED_SITE because a URL happened to rank for the query.
 */

export type SourceRole =
  | 'COMPANY_OWNED_SITE'
  | 'COMPANY_LOCATION_PAGE'
  | 'COMPANY_SERVICE_PAGE'
  | 'COMPANY_BLOG_PAGE'
  | 'DIRECTORY'
  | 'LEAD_GEN_DIRECTORY'
  | 'NEWS_OR_PUBLISHER'
  | 'GOVERNMENT'
  | 'LICENSING_DATABASE'
  | 'SOCIAL_PROFILE'
  | 'MARKETPLACE'
  | 'AGGREGATOR'
  | 'MANUFACTURER_LOCATOR'
  | 'VIDEO'
  | 'FORUM'
  | 'UNKNOWN';

/** Roles that may carry a company's own first-party declaration about itself. */
const FIRST_PARTY: ReadonlySet<SourceRole> = new Set<SourceRole>([
  'COMPANY_OWNED_SITE', 'COMPANY_LOCATION_PAGE', 'COMPANY_SERVICE_PAGE', 'COMPANY_BLOG_PAGE',
]);

export function isFirstParty(role: SourceRole): boolean { return FIRST_PARTY.has(role); }

/** Roles a discovery row may ever become a workable Account from. */
const PROMOTABLE: ReadonlySet<SourceRole> = new Set<SourceRole>([
  'COMPANY_OWNED_SITE', 'COMPANY_LOCATION_PAGE', 'COMPANY_SERVICE_PAGE',
]);

export function mayPromoteRole(role: SourceRole): boolean { return PROMOTABLE.has(role); }

export interface SourceRoleEvidence {
  /** The URL this role is about. */
  url: string | null;
  /** The page title or the provider's name for the row. */
  title?: string | null;
  /** The company this source is being judged against, when there is one. */
  companyName?: string | null;
  /** A phone attributed to that company by an independent source. */
  companyPhone?: string | null;
  /** A postal address attributed to that company by an independent source. */
  companyAddress?: string | null;
  /** The organisation the site declares itself to be, from schema.org or og:site_name. */
  declaredOrganization?: string | null;
  /** A canonical URL the page declares for itself. */
  canonicalUrl?: string | null;
  /** Phones published on the page itself. */
  publishedPhones?: readonly string[];
  /** Postal addresses published on the page itself. */
  publishedAddresses?: readonly string[];
  /** Same-origin links the page carries, used to tell a site from a single page. */
  sameOriginPaths?: readonly string[];
  /** How many distinct business names have been observed across this whole domain. */
  distinctBusinessesOnDomain?: number;
  /** Visible page text, where it has been read. */
  bodyText?: string | null;
}

export interface SourceRoleVerdict {
  role: SourceRole;
  /** HIGH only where a strong, independent signal carried the decision. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

/* ------------------------------------------------------------------ third parties --- */

const GOVERNMENT_HOST = /(^|\.)(gov|mil)$|(^|\.)[a-z]{2}\.us$/;
const LICENSING_SIGNAL =
  /\b(license|licence|licensing|licensee|permit|registrar|dbpr|contractor\s+search|board\s+of|department\s+of\s+business)\b/i;
const LICENSING_PATH = /\/(licen[cs]e|licensing|permits?|lookup|verify|registry|search_?licen)/i;

/** A page that exists to hand a visitor's details to somebody else's business. */
const LEAD_GEN_TEXT =
  /\b(get\s+(free\s+)?quotes?|compare\s+quotes?|matched\s+with|get\s+matched|request\s+a\s+quote\s+from|find\s+local\s+pros|top\s+pros\s+near)\b/i;
const LEAD_GEN_PATH = /\/(quote|quotes|get-quotes|estimate|match|matching|leads?)\b/i;

const DIRECTORY_PATH =
  /\/(biz|profile|profiles|listing|listings|directory|companies|contractors?|pro|pros|vendor|vendors|find-a|find_a|reviews?)\//i;
const BLOG_PATH = /\/(blog|news|articles?|posts?|insights?|resources?)\//i;
const LOCATION_PATH = /\/(locations?|service-areas?|areas?-we-serve|branch(es)?|offices?)\b/i;
const SERVICE_PATH = /\/(services?|repair|installation|maintenance|ac-repair|hvac|heating|cooling)\b/i;

const KNOWN_SOCIAL = /^(facebook|instagram|twitter|x|linkedin|tiktok|pinterest|nextdoor)\./;
const KNOWN_VIDEO = /^(youtube|youtu|vimeo)\./;
const KNOWN_FORUM = /^(reddit|quora|answers|city-data)\./;

function hostOf(url: string | null): string {
  if (!url) return '';
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
function pathOf(url: string | null): string {
  if (!url) return '';
  try { return new URL(url).pathname.toLowerCase(); }
  catch { return ''; }
}

/** Compares names the way a person reads them, ignoring suffixes and punctuation. */
function nameKey(value: string): string {
  return value.toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|ltd|co|corp|corporation|company|the|and|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Whether a name and a domain plausibly belong to each other.
 *
 * Substring in either direction on the squashed forms, with a length floor so that a
 * three-letter fragment cannot marry two unrelated businesses. This is the single
 * strongest cheap signal of ownership: a company's domain is nearly always its name.
 */
export function nameMatchesDomain(companyName: string | null | undefined,
                                  domain: string | null): boolean {
  if (!companyName || !domain) return false;
  const stem = domain.split('.')[0]!.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const name = nameKey(companyName);
  if (stem.length < 5 || name.length < 5) return false;
  return stem.includes(name.slice(0, Math.min(name.length, 14)))
    || name.includes(stem.slice(0, Math.min(stem.length, 14)));
}

/**
 * Street abbreviations, expanded rather than deleted.
 *
 * Deleting them looked simpler and was wrong: "29851 Co Rd 49" and "29851 County Road
 * 49" are the same road written two ways, and stripping `rd` from one while leaving
 * `county` in the other left two strings that shared a house number and disagreed about
 * everything else. Expanding both to the same words is what makes them comparable.
 */
const ADDRESS_WORDS: Readonly<Record<string, string>> = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive',
  blvd: 'boulevard', blv: 'boulevard', hwy: 'highway', ln: 'lane', ct: 'court',
  pkwy: 'parkway', pky: 'parkway', cir: 'circle', pl: 'place', ter: 'terrace',
  co: 'county', cty: 'county', sr: 'state', fm: 'farm',
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  ste: 'suite', apt: 'apartment', bldg: 'building',
};

/**
 * Words that appear in everybody's address.
 *
 * Counting these as agreement is what made "120 Oak Avenue, Tampa FL" match "120 North
 * Main Street, Tampa FL": they share a house number, a city and a state, which is three
 * tokens of agreement and no evidence at all. What distinguishes one address from
 * another on the same street is the street's name, so that is what has to match.
 */
const GENERIC_ADDRESS_WORDS = new Set([
  'street', 'avenue', 'road', 'drive', 'boulevard', 'highway', 'lane', 'court',
  'parkway', 'circle', 'place', 'terrace', 'county', 'state', 'farm', 'route', 'trail',
  'way', 'loop', 'run', 'north', 'south', 'east', 'west', 'northeast', 'northwest',
  'southeast', 'southwest', 'suite', 'apartment', 'building', 'unit', 'floor', 'usa',
]);

const US_STATE = /^(a[klrz]|c[aot]|de|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])$/;

interface AddressParts { house: string | null; distinctive: Set<string>; all: Set<string> }

function addressTokens(value: string): AddressParts {
  const raw = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(Boolean);
  const house = raw.find((token) => /^\d+$/.test(token)) ?? null;
  const all = new Set<string>();
  const distinctive = new Set<string>();
  for (const token of raw) {
    const word = /^\d+$/.test(token) ? token : (ADDRESS_WORDS[token] ?? token);
    all.add(word);
    if (!/^\d+$/.test(word) && !GENERIC_ADDRESS_WORDS.has(word) && !US_STATE.test(word)) {
      distinctive.add(word);
    }
  }
  return { house, distinctive, all };
}

/**
 * Whether two written addresses are the same place.
 *
 * The house number has to agree -- it is the one part nobody abbreviates -- and every
 * distinctive word of the shorter address has to appear in the longer one. A ZIP on one
 * side only, a suite number, a spelled-out direction: all are ordinary differences
 * between two true records of one address, and none of them should make an ownership
 * signal disappear. A different street name is not an ordinary difference.
 */
export function addressesMatch(left: string, right: string): boolean {
  const a = addressTokens(left);
  const b = addressTokens(right);
  if (!a.house || !b.house || a.house !== b.house) return false;

  const [shorter, longer] = a.distinctive.size <= b.distinctive.size ? [a, b] : [b, a];
  if (shorter.distinctive.size === 0) return false;
  for (const word of shorter.distinctive) {
    if (!longer.distinctive.has(word)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------- the decision --- */

/**
 * The role this source plays, from whatever evidence is available.
 *
 * Third-party shapes are decided first, because a licensing database that happens to
 * carry a company's name and phone is still a licensing database. Only then is
 * ownership considered, and only on positive evidence.
 */
export function classifySourceRole(evidence: SourceRoleEvidence): SourceRoleVerdict {
  const host = hostOf(evidence.url);
  const domain = registrableDomain(evidence.url);
  const path = pathOf(evidence.url);
  const title = (evidence.title ?? '').trim();
  const text = evidence.bodyText ?? '';

  if (!domain) return { role: 'UNKNOWN', confidence: 'LOW', reasons: ['no domain to judge'] };

  if (GOVERNMENT_HOST.test(host)) {
    const licensing = LICENSING_SIGNAL.test(`${title} ${path}`) || LICENSING_PATH.test(path);
    return { role: licensing ? 'LICENSING_DATABASE' : 'GOVERNMENT', confidence: 'HIGH',
      reasons: [`a government host (${host})`] };
  }
  // A licensing portal on a .com is still a licensing portal. myfloridalicense.com is
  // the production example, and it was recorded as a contractor's own website.
  if (LICENSING_SIGNAL.test(title) || LICENSING_PATH.test(path)
      || /licen[cs]e/.test(domain)) {
    return { role: 'LICENSING_DATABASE', confidence: 'HIGH',
      reasons: ['a licensing or permit registry rather than a business'] };
  }
  if (KNOWN_SOCIAL.test(`${domain}.`)) {
    return { role: 'SOCIAL_PROFILE', confidence: 'HIGH', reasons: ['a social network'] };
  }
  if (KNOWN_VIDEO.test(`${domain}.`)) {
    return { role: 'VIDEO', confidence: 'HIGH', reasons: ['a video platform'] };
  }
  if (KNOWN_FORUM.test(`${domain}.`)) {
    return { role: 'FORUM', confidence: 'HIGH', reasons: ['a discussion forum'] };
  }

  /**
   * A domain carrying many different businesses is serving other people's businesses.
   *
   * The one rule that catches a directory nobody has heard of, and the reason
   * `theagentpages.com` and `nationalroofingdirectory.com` were found without anyone
   * naming them. Three is the floor: two can be a company and its acquisition.
   */
  const many = evidence.distinctBusinessesOnDomain ?? 0;
  if (many >= 3) {
    const leadGen = LEAD_GEN_TEXT.test(text) || LEAD_GEN_PATH.test(path);
    return { role: leadGen ? 'LEAD_GEN_DIRECTORY' : 'DIRECTORY', confidence: 'HIGH',
      reasons: [`${many} different businesses observed on ${domain}`] };
  }

  if (LEAD_GEN_TEXT.test(text) && !nameMatchesDomain(evidence.companyName, domain)) {
    return { role: 'LEAD_GEN_DIRECTORY', confidence: 'MEDIUM',
      reasons: ['the page offers to match a visitor with other businesses'] };
  }
  if (DIRECTORY_PATH.test(path) && !nameMatchesDomain(evidence.companyName, domain)) {
    return { role: 'DIRECTORY', confidence: 'MEDIUM',
      reasons: ['a URL shaped like a listing of other businesses'] };
  }

  /* ------------------------------------------------------------ is it theirs? --- */

  const strong: string[] = [];
  const supporting: string[] = [];

  if (nameMatchesDomain(evidence.companyName, domain)) {
    strong.push(`the company name and the domain ${domain} agree`);
  }
  if (evidence.declaredOrganization
      && nameMatchesDomain(evidence.declaredOrganization, domain)) {
    strong.push('the site declares an organisation that matches its own domain');
  }
  if (evidence.declaredOrganization && evidence.companyName
      && nameKey(evidence.declaredOrganization) === nameKey(evidence.companyName)) {
    strong.push('the site declares itself to be this company');
  }

  const wantedPhone = evidence.companyPhone ? normalizePhone(evidence.companyPhone) : null;
  if (wantedPhone && (evidence.publishedPhones ?? []).some(
    (p) => normalizePhone(p) === wantedPhone)) {
    strong.push("the company's known phone is published on this site");
  }
  if (evidence.companyAddress && (evidence.publishedAddresses ?? []).some(
    (published) => addressesMatch(evidence.companyAddress!, published))) {
    strong.push("the company's known address is published on this site");
  }

  if (evidence.canonicalUrl && registrableDomain(evidence.canonicalUrl) === domain) {
    supporting.push('the page declares a canonical URL on its own domain');
  }
  const paths = evidence.sameOriginPaths ?? [];
  if (paths.some((p) => /about|contact|team|our-(story|company)/i.test(p))) {
    supporting.push('the site navigates to its own about or contact pages');
  }
  if (many === 1) supporting.push(`one business observed across ${domain}`);

  const owned = strong.length > 0 || supporting.length >= 2;
  if (!owned) {
    // The line this module exists to delete. A URL that ranked and proved nothing is
    // not a company's website; it is a URL that ranked.
    return { role: 'UNKNOWN', confidence: 'LOW',
      reasons: ['nothing here attributes this site to this company',
        ...supporting] };
  }

  const reasons = [...strong, ...supporting];
  const confidence = strong.length > 0 ? 'HIGH' : 'MEDIUM';

  // Which page of theirs it is. A blog post on a contractor's own site is still their
  // site, but it is not the page that identifies the company, and a rep sent to it
  // would be reading an article.
  if (BLOG_PATH.test(path)) {
    return { role: 'COMPANY_BLOG_PAGE', confidence, reasons };
  }
  if (LOCATION_PATH.test(path)) {
    return { role: 'COMPANY_LOCATION_PAGE', confidence, reasons };
  }
  if (SERVICE_PATH.test(path) && path !== '/') {
    return { role: 'COMPANY_SERVICE_PAGE', confidence, reasons };
  }
  return { role: 'COMPANY_OWNED_SITE', confidence, reasons };
}

/**
 * How a fact reached us, which is not the same as which page it is on.
 *
 * A snippet is Google's summary of a page. Opening the page and reading it is a
 * different act with a different reliability, and a research record that cannot tell
 * them apart cannot answer whether paying to open pages was worth it.
 */
export type FactProvenance =
  | 'GOOGLE_SNIPPET_ONLY'
  | 'OPENED_SOURCE_PAGE'
  | 'OFFICIAL_COMPANY_SITE'
  | 'PUBLIC_PROFESSIONAL_PROFILE'
  | 'BUSINESS_DIRECTORY'
  | 'GOVERNMENT_OR_LICENSE_SOURCE'
  | 'NEWS_OR_PUBLISHER';

export function provenanceForRole(role: SourceRole, opened: boolean): FactProvenance {
  if (!opened) return 'GOOGLE_SNIPPET_ONLY';
  if (isFirstParty(role)) return 'OFFICIAL_COMPANY_SITE';
  switch (role) {
    case 'SOCIAL_PROFILE': return 'PUBLIC_PROFESSIONAL_PROFILE';
    case 'DIRECTORY': case 'LEAD_GEN_DIRECTORY': case 'MARKETPLACE': case 'AGGREGATOR':
      return 'BUSINESS_DIRECTORY';
    case 'GOVERNMENT': case 'LICENSING_DATABASE': return 'GOVERNMENT_OR_LICENSE_SOURCE';
    case 'NEWS_OR_PUBLISHER': return 'NEWS_OR_PUBLISHER';
    default: return 'OPENED_SOURCE_PAGE';
  }
}
