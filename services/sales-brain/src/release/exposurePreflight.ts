import { query } from '../db/pool.js';

/**
 * What must be true before this portal is reachable from the internet.
 *
 * Today it binds to 127.0.0.1 on the EdgeXpert and the only way in is the console.
 * Every setting below is safe under that assumption and several of them stop being
 * safe the moment a tunnel or a reverse proxy is put in front -- which is a change
 * made in Cloudflare's dashboard, not in this repository, by somebody who will have
 * no reason to think about the session cookie flag.
 *
 * So this is the list that has to be walked first, and it is deliberately the kind
 * of check that fails rather than warns: a CRM holding real prospect data, real
 * call recordings and a dialler is not something to expose on a maybe.
 *
 * It reports what it cannot check as unchecked. A preflight that quietly counts an
 * unknown as a pass is worse than no preflight, because somebody reads the green and
 * opens the firewall.
 */

export type PreflightState = 'PASS' | 'FAIL' | 'UNCHECKED';

export interface PreflightCheck {
  id: string;
  question: string;
  state: PreflightState;
  finding: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
}

export interface PreflightReport {
  /** True only when nothing failed and nothing is unchecked. */
  safeToExpose: boolean;
  checks: PreflightCheck[];
  summary: string;
}

/** Secrets that ship in examples, defaults and test harnesses. */
const KNOWN_WEAK_SECRETS = new Set([
  'test-session-secret-value-only', 'change-me', 'changeme', 'secret', 'development',
  'dev', 'password', 'session-secret',
]);

function looksLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.local') || host.startsWith('192.168.') || host.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export async function exposurePreflight(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const add = (check: PreflightCheck): void => { checks.push(check); };

  // --- the session cookie -------------------------------------------------------
  const cookieSecure = env['SESSION_COOKIE_SECURE'] === 'true';
  add({
    id: 'session_cookie_secure',
    question: 'Will the session cookie refuse to travel over plain HTTP?',
    state: cookieSecure ? 'PASS' : 'FAIL',
    finding: cookieSecure
      ? 'SESSION_COOKIE_SECURE is on, so the cookie is only sent over HTTPS.'
      : 'SESSION_COOKIE_SECURE is off. On a public host the session cookie would be '
        + 'sent over plain HTTP, and anyone on the path could take a signed-in session.',
    ...(cookieSecure ? {} : { remedy: 'Set SESSION_COOKIE_SECURE=true before exposing.' }),
  });

  // --- the session secret -------------------------------------------------------
  const secret = env['SESSION_SECRET'] ?? '';
  const weak = KNOWN_WEAK_SECRETS.has(secret.toLowerCase()) || secret.length < 32;
  add({
    id: 'session_secret_strength',
    question: 'Is the session secret unguessable?',
    state: secret.length === 0 ? 'FAIL' : weak ? 'FAIL' : 'PASS',
    finding: secret.length === 0
      ? 'SESSION_SECRET is not set.'
      : weak
        ? `SESSION_SECRET is ${secret.length} characters or a known default. Sessions are `
          + 'signed with it, so a guessable one is a way to mint a session for any user.'
        : 'SESSION_SECRET is long and not a known default.',
    ...(secret.length > 0 && !weak ? {} : {
      remedy: 'Generate one: openssl rand -base64 48, then restart both processes.' }),
  });

  // --- the bind address ---------------------------------------------------------
  //
  // Binding to a loopback address and putting a proxy in front is the safe shape.
  // Binding to 0.0.0.0 puts the portal on every interface the box has, which on this
  // machine includes the LAN, regardless of what Cloudflare is doing.
  const bind = env['SALES_PORTAL_BIND'] ?? '127.0.0.1';
  const boundEverywhere = bind === '0.0.0.0' || bind === '::';
  add({
    id: 'bind_address',
    question: 'Is the portal reachable only through the proxy?',
    state: boundEverywhere ? 'FAIL' : 'PASS',
    finding: boundEverywhere
      ? `The portal binds to ${bind}, so it answers on every interface this machine `
        + 'has, including the local network, whatever the proxy in front is configured '
        + 'to allow.'
      : `The portal binds to ${bind}, so only a proxy on this machine can reach it.`,
    ...(boundEverywhere ? {
      remedy: 'Set SALES_PORTAL_BIND=127.0.0.1 and let the reverse proxy be the only door.',
    } : {}),
  });

  // --- the database -------------------------------------------------------------
  const databaseUrl = env['DATABASE_URL'] ?? '';
  let databaseHost = '';
  try { databaseHost = new URL(databaseUrl).hostname; } catch { databaseHost = ''; }
  add({
    id: 'database_not_public',
    question: 'Is PostgreSQL somewhere only this machine can reach?',
    state: databaseHost === '' ? 'UNCHECKED' : looksLocal(databaseHost) ? 'PASS' : 'UNCHECKED',
    finding: databaseHost === ''
      ? 'DATABASE_URL could not be read, so where the database lives is unknown.'
      : looksLocal(databaseHost)
        ? `The database is at ${databaseHost}, which is not routable from outside.`
        : `The database is at ${databaseHost}. Whether that host is reachable from the `
          + 'internet cannot be answered from inside this process.',
    ...(databaseHost !== '' && looksLocal(databaseHost) ? {} : {
      remedy: 'Confirm by hand that the database port is not open to the internet.' }),
  });

  // --- the dialler --------------------------------------------------------------
  //
  // Exposure and outbound calling are separate decisions, and this is the moment
  // they are most likely to be confused for one.
  const dialEnabled = env['OUTBOUND_DIAL_ENABLED'] === 'true';
  add({
    id: 'outbound_dialling',
    question: 'Is outbound dialling still off?',
    state: dialEnabled ? 'FAIL' : 'PASS',
    finding: dialEnabled
      ? 'OUTBOUND_DIAL_ENABLED is true. Making the portal public and arming the dialler '
        + 'are two decisions, and doing both at once means the first mistake in the '
        + 'first is also a phone call to a real person.'
      : 'OUTBOUND_DIAL_ENABLED is false, so exposure cannot cause a call.',
    ...(dialEnabled ? { remedy: 'Expose first, watch it, arm the dialler separately.' } : {}),
  });

  // --- who can sign in ----------------------------------------------------------
  const { rows: userRows } = await query<{ total: number; admins: number; disabled: number }>(
    `select count(*)::int as total,
            count(*) filter (where role = 'ADMIN')::int as admins,
            count(*) filter (where not is_active)::int as disabled
       from users`);
  const users = userRows[0]!;
  add({
    id: 'accounts_exist',
    question: 'Is there an administrator, and no more accounts than there should be?',
    state: users.admins === 0 ? 'FAIL' : 'PASS',
    finding: users.admins === 0
      ? 'No active administrator exists, so nobody could lock the portal down after '
        + 'it is exposed.'
      : `${users.total} account(s), ${users.admins} administrator(s), `
        + `${users.disabled} disabled.`,
  });

  // Demo and seed accounts are made with known passwords. On a private box that is
  // convenience; on a public host it is a published credential.
  const { rows: demoRows } = await query<{ email: string }>(
    `select email from users
      where is_active
        and (email like '%@demo.%' or email like '%@example.%' or email like '%.invalid'
             or email like '%test%')
      order by email`);
  add({
    id: 'no_demo_logins',
    question: 'Are the demo and test sign-ins gone?',
    state: demoRows.length === 0 ? 'PASS' : 'FAIL',
    finding: demoRows.length === 0
      ? 'No demo, example or test accounts can sign in.'
      : `${demoRows.length} demo or test account(s) can still sign in: `
        + `${demoRows.map((row) => row.email).join(', ')}. These are created with known `
        + 'passwords.',
    ...(demoRows.length === 0 ? {} : {
      remedy: 'Disable them: update users set is_active = false where email = ...' }),
  });

  // --- what we cannot see from here ---------------------------------------------
  //
  // Named rather than omitted. The point of the report is the whole list, and a
  // reader who is told these four are unchecked will go and check them; a reader
  // shown six green ticks will not.
  for (const [id, question, finding] of [
    ['tls_termination', 'Is HTTPS actually terminated in front of this process?',
      'The portal speaks HTTP and trusts X-Forwarded-* headers. Whether anything '
      + 'terminates TLS, and whether it strips those headers from the outside world, '
      + 'is a fact about the proxy and cannot be read from here.'],
    ['proxy_auth', 'Does anything in front require authentication of its own?',
      'A second factor in front of the portal -- Cloudflare Access, a client '
      + 'certificate, an IP allowlist -- is configured outside this repository.'],
    ['firewall', 'Is any other port on this machine exposed by the same change?',
      'Opening a tunnel to this box can expose more than the portal. PostgreSQL, the '
      + 'SSH daemon and anything else listening are outside what this process sees.'],
    ['backups_restorable', 'Has a backup been restored since the last schema change?',
      'A public CRM is one somebody can damage. Whether the most recent backup '
      + 'actually restores is answered by running the restore drill, not by this.'],
  ] as const) {
    add({ id, question, state: 'UNCHECKED', finding,
      remedy: 'Check by hand and record the answer before exposing.' });
  }

  const failed = checks.filter((check) => check.state === 'FAIL');
  const unchecked = checks.filter((check) => check.state === 'UNCHECKED');
  const safeToExpose = failed.length === 0 && unchecked.length === 0;

  return {
    safeToExpose,
    checks,
    summary: safeToExpose
      ? 'Every check passed. Nothing here says the proxy in front is right, only that '
        + 'this process is ready for one.'
      : `${failed.length} failing, ${unchecked.length} unchecked. `
        + (failed.length > 0
          ? `Fix first: ${failed.map((check) => check.id).join(', ')}.`
          : 'Nothing is failing; the unchecked items are facts about the machine and '
            + 'the proxy that have to be established by hand.'),
  };
}

/** The report as text, for a terminal. */
export function renderPreflight(report: PreflightReport): string {
  const lines: string[] = ['', 'PUBLIC EXPOSURE PREFLIGHT', ''];
  for (const check of report.checks) {
    const mark = check.state === 'PASS' ? ' ok ' : check.state === 'FAIL' ? 'FAIL' : ' ?? ';
    lines.push(`[${mark}] ${check.question}`);
    lines.push(`       ${check.finding}`);
    if (check.remedy) lines.push(`       -> ${check.remedy}`);
    lines.push('');
  }
  lines.push(report.summary, '');
  return lines.join('\n');
}
