import { config } from '../config.js';

/**
 * Polite HTTP fetching for first-party research.
 * Authority: market-miner-untrusted-content-security-spec.md,
 * CLAUDE-SALES-PORTAL-START-PROMPT.md §7 ("Do not bypass source login/CAPTCHA/
 * rate-limit/anti-bot controls").
 *
 * Rules this enforces:
 *   - robots.txt is honoured, and a disallow means we do not fetch;
 *   - one request at a time per host, with a delay between them;
 *   - a login wall, CAPTCHA or 403 ends the crawl for that host rather than
 *     triggering a retry or a workaround;
 *   - responses are size-capped and treated as untrusted text throughout.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const PER_HOST_DELAY_MS = 1_500;

const lastRequestAt = new Map<string, number>();
const robotsCache = new Map<string, RobotsRules>();

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  contentType: string;
  body: string;
  /**
   * Set when we were refused or declined, rather than when we failed to reach the site.
   *
   * None of these mean the website is broken. Every one of them means the server
   * answered and either we or it decided this crawler does not get the page.
   */
  blockedReason?: 'robots_disallow' | 'login_required' | 'access_denied' | 'anti_bot'
    | 'not_html' | 'too_large';
  /**
   * Set when we tried to fetch and could not. Deliberately separate from
   * `blockedReason`: "we chose not to read this" and "we could not read this" lead to
   * different things to tell a rep, and collapsing them is how a company whose TLS we
   * cannot negotiate became indistinguishable from a company with nothing on its site.
   *
   * The catch below used to discard the error entirely and return a bare `ok: false`
   * with no reason at all, so the caller had nothing to record and the failure left no
   * trace anywhere -- a research run that reached a site it could not fetch reported
   * zero pages fetched, zero blocked and no notes, which reads exactly like a no-op.
   */
  failureReason?: FetchFailureReason;
}

export type FetchFailureReason =
  | 'tls_error' | 'dns_error' | 'timeout' | 'connection_refused'
  | 'http_error' | 'fetch_error';

/**
 * What went wrong, from whatever the runtime threw.
 *
 * Node reports these as nested causes with `code` set, so the cause chain is walked
 * rather than only the outer error. An unrecognised failure stays `fetch_error`: a
 * wrong specific category would be worse than an honest general one.
 */
export function classifyFetchFailure(error: unknown): FetchFailureReason {
  const codes: string[] = [];
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const err = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof err.code === 'string') codes.push(err.code);
    if (typeof err.name === 'string') names.push(err.name);
    if (typeof err.message === 'string') names.push(err.message);
    current = err.cause;
  }
  const blob = `${codes.join(' ')} ${names.join(' ')}`.toUpperCase();

  if (/ERR_TLS|CERT_|SSL|EPROTO|HANDSHAKE|ERR_SSL/.test(blob)) return 'tls_error';
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(blob)) return 'dns_error';
  if (/ABORT|ETIMEDOUT|TIMEOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(blob)) return 'timeout';
  if (/ECONNREFUSED|ECONNRESET/.test(blob)) return 'connection_refused';
  return 'fetch_error';
}

interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number;
}

/** Minimal robots.txt parser for our own user-agent and `*`. */
function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: PER_HOST_DELAY_MS };
  let applies = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'user-agent') {
      applies = value === '*' || /youraidepartment/i.test(value);
      continue;
    }
    if (!applies) continue;
    if (key === 'disallow' && value) rules.disallow.push(value);
    if (key === 'allow' && value) rules.allow.push(value);
    if (key === 'crawl-delay') {
      const seconds = Number(value);
      // An explicit 0 means the site permits no delay. Treating it as "unset"
      // made every crawl wait the default between each candidate path.
      if (Number.isFinite(seconds) && seconds >= 0) {
        rules.crawlDelayMs = Math.min(Math.max(seconds * 1000, 0), 30_000);
      }
    }
  }
  return rules;
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  let rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: PER_HOST_DELAY_MS };
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': config.worker.userAgent, accept: 'text/plain' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (response.ok) {
      const text = (await response.text()).slice(0, 256 * 1024);
      rules = parseRobots(text);
    }
    // A missing or erroring robots.txt means no stated restriction, which is the
    // conventional reading. It does not mean "crawl harder".
  } catch {
    /* network failure reading robots: fall back to the conservative default */
  }
  robotsCache.set(origin, rules);
  return rules;
}

function pathAllowed(rules: RobotsRules, pathname: string): boolean {
  const matchLength = (patterns: string[]): number => {
    let longest = -1;
    for (const pattern of patterns) {
      // robots.txt prefix matching with `*` and `$`.
      const regex = new RegExp(
        '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'),
      );
      if (regex.test(pathname) && pattern.length > longest) longest = pattern.length;
    }
    return longest;
  };
  const disallowed = matchLength(rules.disallow);
  if (disallowed === -1) return true;
  // A more specific Allow wins, as the de facto standard specifies.
  return matchLength(rules.allow) >= disallowed;
}

/**
 * Walls we must not try to get around, told apart from each other.
 *
 * Three different sentences, and the product used to say one of them for all three and
 * then a fourth thing entirely -- "broken website" -- to the rep.
 *
 *   401  the site wants credentials. A login wall.
 *   403  the site refused this crawler. A WAF or a bot rule, not a login, and emphatically
 *        not a broken site: the server answered, and what it answered was no.
 *   429  we asked too often.
 *
 * The content test is deliberately narrow now. It used to fire on the bare word
 * "captcha" anywhere in the first four kilobytes, and energyair.com serves 634 KB of
 * HVAC content whose script manifest lists a module called "captcha" -- so a live
 * company site was discarded, the run recorded zero pages read, and Research Health
 * reported the company as a broken website. A challenge page announces itself in words
 * written for a human being; a manifest entry does not.
 */
function detectWall(status: number, body: string): FetchResult['blockedReason'] | undefined {
  if (status === 401) return 'login_required';
  if (status === 403) return 'access_denied';
  if (status === 429) return 'anti_bot';
  const sample = body.slice(0, 4000).toLowerCase();
  const challenge =
    /cf-browser-verification|__cf_chl|checking your browser before|attention required!\s*\|\s*cloudflare/
      .test(sample)
    || /(please )?verify (that )?you are (a )?human|complete the security check|enable javascript and cookies to continue|are you a robot\?/
      .test(sample);

  /**
   * A challenge that arrives as a redirect rather than as a page.
   *
   * airworthac.com answers `202 Accepted` with 167 bytes: a meta refresh to
   * `/.well-known/sgcaptcha/`. Status says yes, content-type says HTML, and there is no
   * site in it -- so without this the run records a successful read of nothing, which is
   * a third wrong answer after "login wall" and "broken website". Matched on the shape,
   * not on the vendor: any tiny document whose whole body is a refresh to a challenge
   * path is a challenge.
   */
  const interstitial = body.length < 4_000
    && /<meta[^>]+http-equiv=["']?refresh/i.test(sample)
    && /captcha|challenge|\/cdn-cgi\/|bot-?check|human-?verif/i.test(sample);

  // A challenge page is a page about the challenge. A quarter of a megabyte of a
  // company's own site is not one, whatever string appears in its bundler output.
  return (challenge && body.length < 120_000) || interstitial ? 'anti_bot' : undefined;
}

export async function politeFetch(url: string): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }

  const origin = target.origin;
  const rules = await robotsFor(origin);
  if (!pathAllowed(rules, target.pathname)) {
    return {
      ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
      blockedReason: 'robots_disallow',
    };
  }

  // One request at a time per host, spaced by the crawl delay.
  const since = Date.now() - (lastRequestAt.get(origin) ?? 0);
  if (since < rules.crawlDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, rules.crawlDelayMs - since));
  }
  lastRequestAt.set(origin, Date.now());

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'user-agent': config.worker.userAgent,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') ?? '';
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_BYTES) {
      return {
        ok: false, status: response.status, url, finalUrl: response.url || url, contentType, body: '',
        blockedReason: 'too_large',
      };
    }
    if (contentType && !/text\/html|application\/xhtml|text\/plain|application\/json|application\/ld\+json/.test(contentType)) {
      return {
        ok: false, status: response.status, url, finalUrl: response.url || url, contentType, body: '',
        blockedReason: 'not_html',
      };
    }

    const body = (await response.text()).slice(0, MAX_BYTES);
    const blockedReason = detectWall(response.status, body);
    if (blockedReason) {
      return { ok: false, status: response.status, url, finalUrl: response.url || url, contentType, body: '', blockedReason };
    }

    return {
      ok: response.ok, status: response.status, url,
      finalUrl: response.url || url, contentType, body,
      ...(response.ok ? {} : { failureReason: 'http_error' as const }),
    };
  } catch (error) {
    return {
      ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
      failureReason: classifyFetchFailure(error),
    };
  }
}

/** Clears per-host state. Tests use this; production leaves it alone. */
export function resetFetchState(): void {
  lastRequestAt.clear();
  robotsCache.clear();
}
