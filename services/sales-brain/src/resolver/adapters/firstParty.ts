import { politeFetch } from '../fetcher.js';
import { relationshipFromTitle } from '../roles.js';
import { normalizeEmail, normalizePhone } from '../../domain/normalize.js';
import type { EndpointObservation, PersonObservation } from '../types.js';

/**
 * Stage A — company first-party research.
 * Authority: public-decision-maker-resolution-spec.md §5 Stage A and Stage E,
 * source registry class COMPANY_FIRST_PARTY.
 *
 * This is the only adapter that needs no credential and no source-governance
 * sign-off, because it reads a company's own public pages about itself. It is
 * therefore the one that carries the resolver under PUBLIC_ONLY.
 *
 * Everything it returns is an *observation*. The reconciler decides what any of
 * it means; nothing here promotes itself to a fact.
 */

export interface FirstPartyResult {
  people: PersonObservation[];
  endpoints: EndpointObservation[];
  pagesFetched: string[];
  pagesBlocked: { url: string; reason: string }[];
  notes: string[];
}

/** Page paths worth trying, best first. */
const CANDIDATE_PATHS = [
  '/about', '/about-us', '/our-team', '/team', '/leadership', '/meet-the-team',
  '/staff', '/our-story', '/company', '/contact', '/contact-us', '/locations',
];

const MAX_PAGES = 8;

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block boundaries become newlines so a team card's name and title stay
    // separable. Flattening them to spaces makes "<h3>Dana Fielder</h3><p>Owner</p>"
    // indistinguishable from a three-word name.
    .replace(/<\/?(?:h[1-6]|p|div|li|tr|td|th|section|article|header|footer|br|hr|ul|ol|dl|dt|dd|figcaption|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Extracts JSON-LD blocks. Malformed JSON is skipped, never guessed at. */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!.trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      /* a malformed block is ignored rather than partially parsed */
    }
  }
  return blocks;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Pulls people and endpoints out of schema.org markup. This is the highest-quality
 * first-party signal available because the business published it about itself in a
 * machine-readable form.
 */
export function peopleFromJsonLd(
  blocks: unknown[], sourceReference: string,
): { people: PersonObservation[]; endpoints: EndpointObservation[] } {
  const people: PersonObservation[] = [];
  const endpoints: EndpointObservation[] = [];
  const now = new Date();

  const visit = (node: any, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 6) return;

    const types = asArray(node['@type']).map((t) => String(t).toLowerCase());

    if (types.includes('person') && typeof node.name === 'string') {
      const title = typeof node.jobTitle === 'string' ? node.jobTitle
        : Array.isArray(node.jobTitle) ? String(node.jobTitle[0]) : null;
      people.push({
        personName: node.name.trim(),
        rawTitle: title,
        relationship: relationshipFromTitle(title),
        sourceClass: 'COMPANY_FIRST_PARTY',
        sourceReference,
        observedAt: now,
        freshness: 'FRESH',
        scope: 'ACCOUNT',
        notes: 'schema.org Person',
      });

      // An email or phone inside a Person node is explicitly that person's.
      if (typeof node.email === 'string') {
        endpoints.push({
          kind: 'EMAIL', value: node.email.replace(/^mailto:/i, ''),
          attributedToPersonName: node.name.trim(), explicitlyPersonal: true,
          isMainLine: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
          observedAt: now, freshness: 'FRESH',
        });
      }
      if (typeof node.telephone === 'string') {
        endpoints.push({
          kind: 'PHONE', value: node.telephone,
          attributedToPersonName: node.name.trim(), explicitlyPersonal: true,
          isMainLine: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
          observedAt: now, freshness: 'FRESH',
        });
      }
    }

    // Organization-level contact points are company routes, never personal lines.
    const isOrganization = types.some((t) =>
      t.includes('organization') || t.includes('localbusiness') || t === 'corporation');
    if (isOrganization) {
      for (const value of asArray(node.telephone)) {
        if (typeof value === 'string') {
          endpoints.push({
            kind: 'PHONE', value, isMainLine: true, explicitlyPersonal: false,
            sourceClass: 'COMPANY_FIRST_PARTY', sourceReference, observedAt: now, freshness: 'FRESH',
          });
        }
      }
      for (const value of asArray(node.email)) {
        if (typeof value === 'string') {
          endpoints.push({
            kind: 'EMAIL', value: value.replace(/^mailto:/i, ''), isMainLine: false,
            explicitlyPersonal: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
            observedAt: now, freshness: 'FRESH',
          });
        }
      }
      for (const point of asArray(node.contactPoint)) visit(point, depth + 1);
      for (const employee of asArray(node.employee)) visit(employee, depth + 1);
      for (const founder of asArray(node.founder)) visit(founder, depth + 1);
    }

    if (types.includes('contactpoint') && typeof node.telephone === 'string') {
      endpoints.push({
        kind: 'PHONE', value: node.telephone, isMainLine: true, explicitlyPersonal: false,
        sourceClass: 'COMPANY_FIRST_PARTY', sourceReference, observedAt: now, freshness: 'FRESH',
      });
    }

    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'about']) {
      for (const child of asArray(node[key])) visit(child, depth + 1);
    }
  };

  for (const block of blocks) visit(block);
  return { people, endpoints };
}

/**
 * Name + title pairs from visible page text.
 * Deliberately conservative: it only accepts a capitalized 2–3 word name adjacent to
 * a recognizable business title, because a loose matcher on a marketing page invents
 * people, and an invented person is a hard fail.
 */
const TITLE_WORDS =
  '(?:Owner|Co-?Owner|Founder|Co-?Founder|President|CEO|Chief Executive Officer|'
  + 'Chief Operating Officer|COO|Chief Marketing Officer|CMO|General Manager|GM|'
  + 'Operations Manager|Director of Operations|Operations Director|Service Manager|'
  + 'Office Manager|Sales Manager|Sales Director|Director of Sales|Marketing Director|'
  + 'Marketing Manager|Intake Director|Intake Manager|Managing Partner|Practice Administrator|'
  + 'Firm Administrator|Location Manager|Branch Manager|Vice President|Partner)';

// A name may not begin with a business title: once markup is flattened, "Owner Riley Marsh"
// otherwise parses as a three-word name.
const NAME = `(?!${TITLE_WORDS}\\b)(?:[A-Z][a-z'’-]{1,20})(?:[ \\t]+[A-Z]\\.?)?(?:[ \\t]+[A-Z][a-z'’-]{1,20}){1,2}`;

export function peopleFromText(
  text: string, sourceReference: string, companyName?: string | null,
): PersonObservation[] {
  const found = new Map<string, PersonObservation>();
  const now = new Date();

  // The company's own name is not a person. Without this, "Office Manager /
  // Marsh Point Air was founded by..." yields a contact called Marsh Point Air.
  const companyTokens = new Set(
    (companyName ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean),
  );
  const looksLikeCompany = (candidate: string): boolean => {
    if (companyTokens.size === 0) return false;
    const tokens = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const shared = tokens.filter((token) => companyTokens.has(token)).length;
    return shared / tokens.length >= 0.6;
  };

  const patterns = [
    // "Jane Smith, Owner" / "Jane Smith - General Manager"
    new RegExp(`(${NAME})[ \\t]*[,\\n–—|-][ \\t]*(${TITLE_WORDS})\\b`, 'g'),
    // "Owner: Jane Smith" / "General Manager — Jane Smith"
    new RegExp(`(${TITLE_WORDS})[ \\t]*[:,–—|-][ \\t]*(${NAME})`, 'g'),
    // "Jane Smith is the Owner" / "founded by Jane Smith"
    new RegExp(`(${NAME})\\s+is\\s+(?:the\\s+|our\\s+)?(${TITLE_WORDS})\\b`, 'g'),
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index]!;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [name, title] = index === 1
        ? [match[2]!, match[1]!]
        : [match[1]!, match[2]!];
      const key = name.toLowerCase();
      if (found.has(key) || looksLikeCompany(name)) continue;
      found.set(key, {
        personName: name.trim(),
        rawTitle: title.trim(),
        relationship: relationshipFromTitle(title),
        sourceClass: 'COMPANY_FIRST_PARTY',
        sourceReference,
        observedAt: now,
        freshness: 'FRESH',
        scope: 'ACCOUNT',
        notes: 'named on a company page',
      });
    }
  }

  // "Founded by Jane Smith" is a founder claim in its own right.
  const foundedBy = new RegExp(
    `[Ff]ounded[ \\t]+(?:in[ \\t]+\\d{4}[ \\t]+)?by[ \\t]+(${NAME})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = foundedBy.exec(text)) !== null) {
    const name = match[1]!.trim();
    const key = name.toLowerCase();
    if (found.has(key) || looksLikeCompany(name)) continue;
    found.set(key, {
      personName: name, rawTitle: 'Founder', relationship: 'FOUNDER',
      sourceClass: 'COMPANY_FIRST_PARTY', sourceReference, observedAt: now,
      freshness: 'FRESH', scope: 'ACCOUNT', notes: 'stated as founder on a company page',
    });
  }

  return [...found.values()];
}

/**
 * Endpoints from `tel:` / `mailto:` links and visible text.
 * A number is only marked personal when the surrounding text explicitly says so
 * ("call Jane directly at ..."), which is what the resolver requires before it will
 * ever call something a direct line.
 */
export function endpointsFromHtml(html: string, sourceReference: string): EndpointObservation[] {
  const endpoints: EndpointObservation[] = [];
  const now = new Date();
  const seen = new Set<string>();

  const push = (endpoint: EndpointObservation): void => {
    const normalized = endpoint.kind === 'PHONE'
      ? normalizePhone(endpoint.value) : normalizeEmail(endpoint.value);
    if (!normalized) return;
    const key = `${endpoint.kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push(endpoint);
  };

  for (const match of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    push({
      kind: 'PHONE', value: decodeURIComponent(match[1]!), isMainLine: true,
      explicitlyPersonal: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
      observedAt: now, freshness: 'FRESH',
    });
  }
  for (const match of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    push({
      kind: 'EMAIL', value: decodeURIComponent(match[1]!), isMainLine: false,
      explicitlyPersonal: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
      observedAt: now, freshness: 'FRESH',
    });
  }

  const text = stripTags(html);

  // An explicit personal-line statement is the one case where a company page can
  // establish a direct line (fixture `published_business_mobile_can_be_direct`).
  // Case-sensitive on purpose: the `i` flag would defeat the [A-Z] in NAME and let
  // "Jane Smith directly" parse as a three-word name.
  const directPattern = new RegExp(
    `(?:[Cc]all|[Rr]each|[Cc]ontact|[Tt]ext)[ \\t]+(${NAME})[ \\t]+` +
    `(?:directly[ \\t]+)?(?:at|on)[ \\t]*:?[ \\t]*` +
    `(\\+?1?[\\s.()-]*\\d{3}[\\s.()-]*\\d{3}[\\s.()-]*\\d{4})`,
    'g',
  );
  let directMatch: RegExpExecArray | null;
  while ((directMatch = directPattern.exec(text)) !== null) {
    const normalized = normalizePhone(directMatch[2]!);
    if (!normalized) continue;
    // Replace the generic observation of this number with the personal one.
    const existingIndex = endpoints.findIndex(
      (e) => e.kind === 'PHONE' && normalizePhone(e.value) === normalized,
    );
    const observation: EndpointObservation = {
      kind: 'PHONE', value: normalized,
      attributedToPersonName: directMatch[1]!.trim(), explicitlyPersonal: true,
      isMainLine: false, sourceClass: 'COMPANY_FIRST_PARTY', sourceReference,
      observedAt: now, freshness: 'FRESH',
      notes: 'page explicitly presents this as a personal business line',
    };
    if (existingIndex >= 0) endpoints[existingIndex] = observation;
    else { seen.add(`PHONE:${normalized}`); endpoints.push(observation); }
  }

  // Extensions published next to a name.
  const extensionPattern = new RegExp(
    `(${NAME})[^.\\n]{0,40}?[Ee]xt(?:ension)?\\.?[ \\t]*(\\d{1,6})`, 'g');
  let extensionMatch: RegExpExecArray | null;
  while ((extensionMatch = extensionPattern.exec(text)) !== null) {
    const mainLine = endpoints.find((e) => e.kind === 'PHONE' && e.isMainLine);
    if (!mainLine) continue;
    endpoints.push({
      ...mainLine,
      extension: extensionMatch[2]!,
      attributedToPersonName: extensionMatch[1]!.trim(),
      explicitlyPersonal: false,
      notes: 'extension published for this person',
    });
  }

  return endpoints;
}

/** Same-origin links whose text or href suggests a people or contact page. */
function discoverPaths(html: string, origin: string): string[] {
  const found = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1]!;
    const label = stripTags(match[2]!).toLowerCase();
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch { continue; }
    if (url.origin !== origin) continue;

    const path = url.pathname.toLowerCase();
    const interesting =
      /(about|team|leadership|staff|our-people|meet|management|contact|locations?)/.test(path)
      || /(about|our team|meet the team|leadership|staff|management|contact)/.test(label);
    if (interesting && path !== '/') found.add(url.origin + url.pathname);
  }
  return [...found];
}

export async function researchFirstParty(
  website: string, companyName?: string | null,
): Promise<FirstPartyResult> {
  const result: FirstPartyResult = {
    people: [], endpoints: [], pagesFetched: [], pagesBlocked: [], notes: [],
  };

  let origin: string;
  try {
    const parsed = new URL(website.startsWith('http') ? website : `https://${website}`);
    origin = parsed.origin;
  } catch {
    result.notes.push(`Not a usable website URL: ${website}`);
    return result;
  }

  const queue: string[] = [origin + '/'];
  const visited = new Set<string>();
  let discovered = false;

  while (queue.length > 0 && result.pagesFetched.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const response = await politeFetch(url);
    if (!response.ok) {
      if (response.blockedReason) {
        result.pagesBlocked.push({ url, reason: response.blockedReason });
        // A wall ends the crawl for this host. We do not work around it.
        if (response.blockedReason === 'login_required' || response.blockedReason === 'anti_bot') {
          result.notes.push(
            `Stopped crawling ${origin}: the site returned a ${response.blockedReason.replace('_', ' ')} response.`,
          );
          break;
        }
      }
      continue;
    }

    result.pagesFetched.push(response.finalUrl);
    const reference = response.finalUrl;

    const jsonLd = peopleFromJsonLd(extractJsonLd(response.body), reference);
    result.people.push(...jsonLd.people);
    result.endpoints.push(...jsonLd.endpoints);
    result.people.push(...peopleFromText(stripTags(response.body), reference, companyName));
    result.endpoints.push(...endpointsFromHtml(response.body, reference));

    if (!discovered) {
      discovered = true;
      const linked = discoverPaths(response.body, origin);
      // Prefer links the site actually exposes; fall back to conventional paths.
      for (const path of linked) queue.push(path);
      for (const path of CANDIDATE_PATHS) {
        const candidate = origin + path;
        if (!linked.includes(candidate)) queue.push(candidate);
      }
    }
  }

  if (result.pagesFetched.length === 0) {
    result.notes.push(`No public pages could be read for ${origin}.`);
  }
  return result;
}

export { stripTags };
