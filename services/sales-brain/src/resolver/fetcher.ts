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
  /** Set when we declined to fetch rather than failing to. */
  blockedReason?: 'robots_disallow' | 'login_required' | 'anti_bot' | 'not_html' | 'too_large';
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

/** Signals that we have hit a wall we must not try to get around. */
function detectWall(status: number, body: string): FetchResult['blockedReason'] | undefined {
  if (status === 401 || status === 403) return 'login_required';
  if (status === 429) return 'anti_bot';
  const sample = body.slice(0, 4000).toLowerCase();
  if (/cf-browser-verification|checking your browser|captcha|are you a robot|__cf_chl/.test(sample)) {
    return 'anti_bot';
  }
  return undefined;
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
        ok: false, status: response.status, url, finalUrl: response.url, contentType, body: '',
        blockedReason: 'too_large',
      };
    }
    if (contentType && !/text\/html|application\/xhtml|text\/plain|application\/json|application\/ld\+json/.test(contentType)) {
      return {
        ok: false, status: response.status, url, finalUrl: response.url, contentType, body: '',
        blockedReason: 'not_html',
      };
    }

    const body = (await response.text()).slice(0, MAX_BYTES);
    const blockedReason = detectWall(response.status, body);
    if (blockedReason) {
      return { ok: false, status: response.status, url, finalUrl: response.url, contentType, body: '', blockedReason };
    }

    return {
      ok: response.ok, status: response.status, url,
      finalUrl: response.url, contentType, body,
    };
  } catch {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }
}

/** Clears per-host state. Tests use this; production leaves it alone. */
export function resetFetchState(): void {
  lastRequestAt.clear();
  robotsCache.clear();
}
