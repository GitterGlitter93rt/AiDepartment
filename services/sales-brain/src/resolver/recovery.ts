import { politeFetch, type FetchResult } from './fetcher.js';
import { registrableDomain } from '../discovery/sourceClass.js';

/**
 * Trying again, on the finite set of hosts a company might actually be on.
 *
 * V2 established that a site we could not read is never evidence against a company. It
 * left the other half undone: research ran once, and 53 Accounts kept an unreadable
 * state for ever. A stored URL is one guess at a public host, and the ways it is wrong
 * are few and well known -- apex versus www, http versus https -- so they are worth
 * enumerating rather than concluding from.
 *
 * Nothing here defeats a refusal. A 403, a challenge page and a robots disallow are all
 * answers, and the answer to an answer is not to ask again wearing a different hat. A
 * later ordinary retry may succeed because the site changed; that is the only mechanism
 * this relies on.
 */

export type RecoveryVariant = 'STORED' | 'HTTPS_APEX' | 'HTTPS_WWW' | 'HTTP_APEX' | 'HTTP_WWW';

export interface VariantTarget { variant: RecoveryVariant; url: string }

/**
 * The candidate hosts for a stored URL, in the order worth trying.
 *
 * Deduplicated by normalised URL, because the stored value is usually already one of
 * the four and probing it twice is two requests at a company that is having a bad day.
 * HTTPS before HTTP so a working secure host is found first and an insecure one is
 * never preferred to it; apex before www only because one of them has to go first.
 */
export function urlVariants(storedUrl: string | null | undefined): VariantTarget[] {
  if (!storedUrl || !storedUrl.trim()) return [];
  let stored: URL;
  try {
    stored = new URL(/^https?:\/\//i.test(storedUrl) ? storedUrl : `https://${storedUrl}`);
  } catch {
    return [];
  }
  if (stored.protocol !== 'http:' && stored.protocol !== 'https:') return [];

  const host = stored.hostname.replace(/^www\./i, '');
  const targets: VariantTarget[] = [
    { variant: 'STORED', url: stored.toString() },
    { variant: 'HTTPS_APEX', url: `https://${host}${stored.pathname === '/' ? '/' : ''}` },
    { variant: 'HTTPS_WWW', url: `https://www.${host}/` },
    { variant: 'HTTP_APEX', url: `http://${host}/` },
    { variant: 'HTTP_WWW', url: `http://www.${host}/` },
  ];

  const seen = new Set<string>();
  const unique: VariantTarget[] = [];
  for (const target of targets) {
    const key = normalizeForDedupe(target.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

/** Two URLs are the same request if they differ only in a trailing slash or case. */
function normalizeForDedupe(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * What one probe of one host found.
 *
 * `sourceState` reuses the vocabulary the rest of the system already reads, so a
 * recovery attempt and an ordinary research run describe the same outcome the same way.
 */
export interface ProbeOutcome {
  variant: RecoveryVariant;
  requestedUrl: string;
  finalUrl: string | null;
  redirectChain: string[];
  httpStatus: number | null;
  sourceState: 'READ' | 'REFUSED' | 'UNREACHABLE' | 'HTTP_ERROR' | 'DISALLOWED';
  failureReason: string | null;
  dnsResult: string | null;
  tlsResult: string | null;
  contentType: string | null;
  bytesReceived: number | null;
  /** True when a 2xx returned a page with no readable content -- a JavaScript shell. */
  emptyShell: boolean;
}

/** A 2xx body that carries no prose at all. */
export function looksLikeEmptyShell(result: FetchResult): boolean {
  if (!result.ok || result.blockedReason) return false;
  const withoutCode = result.body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A real page has prose. A shell has a loading message at most.
  return withoutCode.length < 200 && /<div[^>]+id=["'](root|app|__next)["']/i.test(result.body);
}

export function probeOutcomeFrom(variant: RecoveryVariant, url: string,
                                 result: FetchResult): ProbeOutcome {
  const failure = result.failureReason ?? null;
  const blocked = result.blockedReason ?? null;

  let sourceState: ProbeOutcome['sourceState'];
  if (blocked === 'robots_disallow') sourceState = 'DISALLOWED';
  else if (blocked) sourceState = 'REFUSED';
  else if (result.ok) sourceState = 'READ';
  else if (failure === 'http_error') sourceState = 'HTTP_ERROR';
  else sourceState = 'UNREACHABLE';

  return {
    variant,
    requestedUrl: url,
    finalUrl: result.finalUrl || null,
    redirectChain: redirectChainOf(url, result),
    httpStatus: result.status || null,
    sourceState,
    failureReason: blocked ?? failure,
    // Reported separately because "the name does not resolve" and "the certificate is
    // not valid" are different facts about a company's hosting, and a rep told only
    // "unreachable" cannot tell which.
    dnsResult: failure === 'dns_error' ? 'NXDOMAIN_OR_SERVFAIL' : (result.status ? 'RESOLVED' : null),
    tlsResult: failure === 'tls_error' ? 'HANDSHAKE_FAILED'
      : (url.startsWith('https://') && result.status ? 'OK' : null),
    contentType: result.contentType || null,
    bytesReceived: result.body ? Buffer.byteLength(result.body) : null,
    emptyShell: looksLikeEmptyShell(result),
  };
}

function redirectChainOf(requested: string, result: FetchResult): string[] {
  if (!result.finalUrl || result.finalUrl === requested) return [];
  return [requested, result.finalUrl];
}

/** Probes one host. Nothing here retries on its own; the campaign owns the cadence. */
export async function probeVariant(target: VariantTarget): Promise<ProbeOutcome> {
  const result = await politeFetch(target.url);
  return probeOutcomeFrom(target.variant, target.url, result);
}

/**
 * Whether a successful read happened somewhere other than the domain we asked about.
 *
 * A company that moved is a real and common thing, and a redirect to another domain is
 * decent evidence of it -- but it is also what a parked domain, a holding page and an
 * acquisition all look like. So the destination is returned as a candidate and never
 * written to the Account, which is the rule for every other identity claim in here.
 */
export function crossDomainDestination(originalUrl: string | null,
                                       outcome: ProbeOutcome): string | null {
  if (outcome.sourceState !== 'READ' || !outcome.finalUrl) return null;
  const from = originalUrl ? registrableDomain(originalUrl) : null;
  const to = registrableDomain(outcome.finalUrl);
  if (!from || !to || from === to) return null;
  return to;
}

/**
 * A domain that is answering, definitively, that there is nothing here.
 *
 * Ten hours of asking a 404 the same question is ten hours of learning nothing. Two
 * separate attempts agreeing is what distinguishes a dead path from a deploy in
 * progress, and at that point the useful work is finding where the company went.
 */
export function isTerminalForDomain(outcomes: ProbeOutcome[]): boolean {
  if (outcomes.length === 0) return false;
  return outcomes.every((o) => o.httpStatus === 404 || o.httpStatus === 410);
}
