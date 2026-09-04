import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { setCalendarAdapter, currentCalendarAdapter } from '../src/booking/service.js';
import { microsoftGraphAdapter } from '../src/booking/graphAdapter.js';
import type { CalendarAdapter } from '../src/booking/types.js';
import { resetDatabase } from './helpers.js';

/**
 * Empty, error and degraded states across every page.
 * Authority: yad-sales-crm-page-acceptance-matrix.v1.yaml common_acceptance
 * (`loading_state_verified`, `empty_state_verified`, `error_state_verified`),
 * yad-sales-crm-component-contract.v1.yaml EmptyState/ErrorState.
 *
 * A page with no data must say what would put data there. A page whose provider is
 * down must say so rather than rendering a confident blank.
 */

let app: FastifyInstance;
const PASSWORD = 'page-states-password';

/** Every page a signed-in user can open, with the least role that may open it. */
const PAGES: { path: string; role: 'rep' | 'manager' | 'admin' }[] = [
  { path: '/', role: 'rep' },
  { path: '/find', role: 'rep' },
  { path: '/prospects', role: 'rep' },
  { path: '/markets', role: 'rep' },
  { path: '/follow-ups', role: 'rep' },
  { path: '/replies', role: 'rep' },
  { path: '/opportunities', role: 'rep' },
  { path: '/meetings', role: 'rep' },
  { path: '/search', role: 'rep' },
  { path: '/team', role: 'manager' },
  { path: '/mining', role: 'manager' },
  { path: '/research-health', role: 'manager' },
  { path: '/imports', role: 'manager' },
  { path: '/ai/pilot', role: 'manager' },
  { path: '/calls', role: 'manager' },
  { path: '/campaigns', role: 'manager' },
  { path: '/analytics', role: 'manager' },
  { path: '/audit', role: 'manager' },
  { path: '/settings', role: 'admin' },
];

before(async () => { app = await buildServer(); });
after(async () => { setCalendarAdapter(microsoftGraphAdapter); await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

async function sessions() {
  await createUser({ email: 'r@t.local', displayName: 'Rep', role: 'SALES_REP', password: PASSWORD });
  await createUser({ email: 'm@t.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });
  await createUser({ email: 'a@t.local', displayName: 'Admin', role: 'ADMIN', password: PASSWORD });
  return {
    rep: await signIn('r@t.local'),
    manager: await signIn('m@t.local'),
    admin: await signIn('a@t.local'),
  };
}

test('every page renders on an empty database', async () => {
  const who = await sessions();
  const broken: string[] = [];

  for (const page of PAGES) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: who[page.role] } });
    if (response.statusCode !== 200) broken.push(`${page.path} -> ${response.statusCode}`);
    if (/undefined|\[object Object\]|NaN/.test(response.body)) {
      broken.push(`${page.path} rendered a placeholder value`);
    }
  }
  assert.deepEqual(broken, []);
});

test('a page with nothing to show explains what would put something there', async () => {
  const who = await sessions();
  // Settings always has its integration rows, so it has nothing to be empty about.
  const withData = new Set(['/settings']);
  const bare: string[] = [];

  for (const page of PAGES.filter((p) => !withData.has(p.path))) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: who[page.role] } });

    const hasEmptyState = /class="state-block"|class="empty"/.test(response.body);
    const hasBareTable = /<tbody>\s*<\/tbody>/.test(response.body);
    if (hasBareTable) bare.push(`${page.path} shows an empty table with no explanation`);
    if (!hasEmptyState && !/Nothing|No |none|empty|yet\b/i.test(response.body)) {
      bare.push(`${page.path} has neither an empty state nor an explanation`);
    }
  }
  assert.deepEqual(bare, []);
});

test('no page leaks a stack trace or a provider internal when something fails', async () => {
  const who = await sessions();
  const leaked: string[] = [];

  for (const page of PAGES) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: who[page.role] } });
    // Naming an environment variable is how an operator knows where to set it; a
    // *value* assigned to one is the leak.
    if (/at [A-Za-z]+ \(\/home\/|node_modules|ECONNREFUSED|password\s*[=:]\s*\S|api[_-]?key\s*[=:]\s*\S|Bearer\s+\S/i
      .test(response.body)) {
      leaked.push(page.path);
    }
  }
  assert.deepEqual(leaked, []);
});

test('a page asked for something that does not exist answers 404, not 500', async () => {
  const who = await sessions();
  const missing = '00000000-0000-0000-0000-000000000000';
  for (const path of [`/accounts/${missing}`, `/calls/${missing}`, `/campaigns/${missing}`,
                      `/opportunities/${missing}`, `/markets/${missing}`]) {
    const response = await app.inject({
      method: 'GET', url: path, headers: { cookie: who.manager } });
    assert.ok(response.statusCode === 404 || response.statusCode === 302,
      `${path} answered ${response.statusCode}`);
  }
});

test('a calendar that is down does not produce an offer of times', async () => {
  const who = await sessions();
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Degraded Provider Co', website: 'https://degraded.example.com',
      phone: '904-555-0188', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));

  const unreachable: CalendarAdapter = {
    name: 'unreachable',
    isConfigured: () => true,
    async getBusy() {
      return { ok: false, busy: [], error: 'calendar unreachable', errorCode: 'PROVIDER_ERROR' };
    },
    async createEvent() {
      return { ok: false, error: 'calendar unreachable', errorCode: 'PROVIDER_ERROR' };
    },
  };
  setCalendarAdapter(unreachable);

  const availability = await app.inject({
    method: 'GET', url: '/api/booking/availability', headers: { cookie: who.manager } });
  const offer = availability.json() as { ok: boolean; slots: unknown[]; message: string };
  assert.equal(offer.slots.length, 0, 'a provider that did not answer offers no times');
  assert.ok(offer.message.length > 0, 'and says something honest instead');
  assert.equal(/unreachable|PROVIDER_ERROR|stack/i.test(offer.message), false,
    'the provider error itself is not read out to a prospect-facing surface');

  const page = await app.inject({
    method: 'GET', url: `/accounts/${accountId}`, headers: { cookie: who.manager } });
  assert.equal(page.statusCode, 200, 'the account page still works with the calendar down');
});

test('an unconfigured integration reads as not configured, never as connected', async () => {
  const who = await sessions();
  const page = await app.inject({
    method: 'GET', url: '/settings', headers: { cookie: who.admin } });
  assert.match(page.body, /Credential not set|No credential needed/);
  assert.equal(/>Connected</.test(page.body), false,
    'nothing claims to be connected on a machine with no credentials');
});

test('the degraded calendar is reported by the settings connection test', async () => {
  const who = await sessions();
  setCalendarAdapter({
    name: 'unreachable', isConfigured: () => true,
    async getBusy() { return { ok: false, busy: [], error: 'x', errorCode: 'PROVIDER_ERROR' }; },
    async createEvent() { return { ok: false, error: 'x', errorCode: 'PROVIDER_ERROR' }; },
  });
  const response = await app.inject({
    method: 'POST', url: '/settings/test', headers: { cookie: who.admin },
    payload: { key: 'calcom' } });
  assert.match(decodeURIComponent(response.headers.location as string),
    /FAILED: The calendar is configured but did not answer/,
    'configured-but-broken is reported as failing, not as not-configured');
  assert.equal(currentCalendarAdapter().name, 'unreachable');
});

// --- responsive behaviour ----------------------------------------------------

test('every page is usable on a phone', async () => {
  const who = await sessions();
  const problems: string[] = [];

  for (const page of PAGES) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: who[page.role] } });
    const body = response.body;

    if (!/name="viewport"[^>]*width=device-width/.test(body)) {
      problems.push(`${page.path} has no responsive viewport`);
    }
    // A table wider than a phone must scroll inside its own container rather than
    // pushing the page sideways.
    const tables = [...body.matchAll(/<table[^>]*class="data"/g)].length;
    const wrapped = [...body.matchAll(/class="table-wrap"/g)].length;
    if (tables > wrapped) {
      problems.push(`${page.path} has ${tables} table(s) but ${wrapped} scroll container(s)`);
    }
    // A rep works from a phone, so the core nav has to be reachable there.
    if (page.role === 'rep' && !/class="mobile-nav"|class="bottom-nav"/.test(body)) {
      problems.push(`${page.path} has no mobile navigation`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the stylesheet collapses the wide layouts on a small screen', async () => {
  const response = await app.inject({ method: 'GET', url: '/assets/portal.css' });
  assert.equal(response.statusCode, 200);
  const css = response.body;

  for (const rule of ['.split-60-40', '.switch-row', '.grid-kpi', '.mapping-grid']) {
    assert.ok(css.includes(rule), `${rule} is defined`);
  }
  // Each wide layout has a single-column form under a breakpoint.
  const mobileBlocks = css.split('@media (max-width: 900px)').slice(1).join('\n');
  for (const rule of ['.split-60-40', '.switch-row']) {
    assert.ok(mobileBlocks.includes(rule), `${rule} has no small-screen rule`);
  }
  assert.match(css, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/,
    'wide tables scroll inside their container');
});
