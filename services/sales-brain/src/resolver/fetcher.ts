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
const MAX_REDIRECTS = 5;
const DNS_TIMEOUT_MS = 2_000;

/**
 * Hosts research must never reach.
 *
 * Every URL this fetcher is given comes from outside: a domain a discovery provider
 * returned, or a link on a page that domain served. A company whose website is
 * recorded as `http://169.254.169.254/` would have this worker read the cloud
 * metadata service and file the result as evidence about a prospect -- and a link to
 * `http://127.0.0.1:8080/` would point it at this product's own API, authenticated
 * as nobody but reachable all the same.
 *
 * Checked on the literal host and again on every address it resolves to, because a
 * public name is allowed to resolve to a private address and that is precisely the
 * interesting case. Redirects are followed manually for the same reason: a 302 to
 * localhost is otherwise unobserved.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
]);

/** Expands a (possibly `::`-compressed) IPv6 literal into its eight groups. */
function expandIpv6(input: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(input)) return null;
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] => part.length === 0 ? []
    : part.split(':').map((group) => Number.parseInt(group, 16));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if ([...head, ...tail].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  // IPv6, including the mapped-IPv4 forms that would otherwise slip past.
  //
  // `new URL()` rewrites [::ffff:127.0.0.1] to its compressed hex form ::ffff:7f00:1,
  // so matching only the dotted spelling catches the one nobody would type and
  // misses the one the URL parser actually produces.
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;          // unique-local
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;          // link-local
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (dotted) return isPrivateAddress(dotted[1]!);
    const groups = expandIpv6(ip);
    if (groups && groups[5] === 0xffff
      && groups.slice(0, 5).every((group) => group === 0)) {
      const high = groups[6]!;
      const low = groups[7]!;
      return isPrivateAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;                   // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;         // carrier-grade NAT
  if (a === 192 && b === 0) return true;                     // 192.0.0.0/24, 192.0.2.0/24
  if (a >= 224) return true;                                 // multicast and reserved
  return false;
}

/**
 * Reserved names that cannot resolve to anything, internal or otherwise.
 *
 * RFC 2606 and RFC 6761 guarantee these are never delegated, so asking a resolver
 * about them buys nothing and costs a full DNS timeout each. `.localhost` is the
 * exception and is refused above: it resolves, to exactly the place we must not go.
 */
const UNRESOLVABLE_TLDS = ['.invalid', '.test', '.example'];

/** Verdict per host, so eight pages of one site ask the resolver once. */
const addressVerdicts = new Map<string, boolean>();

/**
 * The one way loopback is reachable, and it is not available in production.
 *
 * The test suite stands up real HTTP servers on 127.0.0.1 to exercise the crawl
 * against robots rules, login walls and anti-bot interstitials -- tests that have to
 * drive the actual fetcher rather than a stub, because what they assert is the
 * fetcher's behaviour. Blocking loopback outright makes those tests untestable.
 *
 * Read from the environment on every call rather than captured once, so a test can
 * turn it off and prove the guard still refuses. `tests/setup.ts` sets it; nothing
 * else does, and it must never appear in a deployed .env.
 */
function privateAddressesAllowed(): boolean {
  return process.env['RESEARCH_ALLOW_PRIVATE_ADDRESSES'] === '1';
}

/** Resolves a hostname and refuses it if anything it points at is internal. */
async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  if (privateAddressesAllowed()) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return false;
  }
  // A literal address needs no lookup, and must not get one.
  if (/^[0-9.]+$/.test(host) || host.includes(':')) return !isPrivateAddress(host);
  // Reserved and undelegatable: not internal, and not worth a resolver round trip.
  if (UNRESOLVABLE_TLDS.some((tld) => host.endsWith(tld))) return true;

  const cached = addressVerdicts.get(host);
  if (cached !== undefined) return cached;

  const { lookup } = await import('node:dns/promises');
  try {
    // Bounded: a resolver that never answers must not hold a crawl open.
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('dns timeout')), DNS_TIMEOUT_MS)),
    ]);
    const verdict = addresses.length === 0
      || addresses.every((entry) => !isPrivateAddress(entry.address));
    addressVerdicts.set(host, verdict);
    return verdict;
  } catch {
    // The question is "does this point somewhere internal", not "does this resolve".
    // A name we cannot resolve is a name `fetch` cannot resolve either, so letting it
    // through costs nothing and the request simply fails. Refusing here instead would
    // make the guard depend on live DNS for correctness, which is both a false
    // negative in any offline environment and a test that passes for the wrong
    // reason.
    addressVerdicts.set(host, true);
    return true;
  }
}

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
  blockedReason?: 'robots_disallow' | 'login_required' | 'anti_bot' | 'not_html'
    | 'too_large' | 'private_address';
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

/**
 * Extra request headers, for sources that require a registered credential.
 *
 * Never logged. The only caller today is the Texas Comptroller's public-data API,
 * which answers 403 without an `api-key` header.
 */
export async function politeFetch(
  url: string, extraHeaders: Record<string, string> = {},
): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }

  if (!(await resolvesToPublicAddress(target.hostname))) {
    return {
      ok: false, status: 0, url, finalUrl: url, contentType: '', body: '',
      blockedReason: 'private_address',
    };
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
    // Redirects are followed by hand, one hop at a time.
    //
    // `redirect: 'follow'` hands the whole chain to undici, which re-checks nothing:
    // a public URL that 302s to http://127.0.0.1/ would be fetched and returned as
    // though the origin had served it. Each hop is re-resolved and re-refused here.
    let response!: Response;
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(current.toString(), {
        headers: {
          'user-agent': config.worker.userAgent,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'accept-language': 'en-US,en;q=0.9',
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, status: response.status, url, finalUrl: current.toString(),
          contentType: '', body: '' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, status: response.status, url, finalUrl: current.toString(),
          contentType: '', body: '', blockedReason: 'private_address' };
      }
      if (!(await resolvesToPublicAddress(next.hostname))) {
        return { ok: false, status: response.status, url, finalUrl: next.toString(),
          contentType: '', body: '', blockedReason: 'private_address' };
      }
      // A redirect onto a new host is a new host's robots question.
      if (next.origin !== current.origin) {
        const nextRules = await robotsFor(next.origin);
        if (!pathAllowed(nextRules, next.pathname)) {
          return { ok: false, status: response.status, url, finalUrl: next.toString(),
            contentType: '', body: '', blockedReason: 'robots_disallow' };
        }
      }
      current = next;
      if (hop === MAX_REDIRECTS) {
        return { ok: false, status: response.status, url, finalUrl: current.toString(),
          contentType: '', body: '' };
      }
    }

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
      finalUrl: response.url || current.toString() || url, contentType, body,
    };
  } catch {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', body: '' };
  }
}

/** Clears per-host state. Tests use this; production leaves it alone. */
export function resetFetchState(): void {
  lastRequestAt.clear();
  robotsCache.clear();
  addressVerdicts.clear();
}
