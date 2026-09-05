import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';

/**
 * Static file serving, after the @fastify/static upgrade.
 * Authority: Issue #2 P0-6.
 *
 * The advisories were path traversal, route-guard bypass via encoded separators, and
 * authorization bypass via non-canonical paths -- three ways of asking the same
 * question: can a URL reach a file outside the assets directory, or reach a route it
 * should not, by spelling itself differently?
 *
 * The package is upgraded. These prove the behaviour rather than the version number,
 * so a future downgrade or a re-introduction fails here rather than in front of
 * Cloudflare.
 */

let app: FastifyInstance;
const PASSWORD = 'static-security-password';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function signIn(email: string, role: 'SALES_REP' | 'ADMIN' = 'SALES_REP') {
  await createUser({ email, displayName: 'Static Tester', role, password: PASSWORD });
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session')!;
  return `yad_sales_session=${cookie.value}`;
}

test('the installed version is past every published advisory', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string> };
  const range = manifest.dependencies['@fastify/static']!;
  const major = Number(/(\d+)/.exec(range)![1]);
  // The last advisory covers <= 10.1.1. Anything below 10 is vulnerable to the
  // high-severity route-guard bypass.
  assert.ok(major >= 10, `@fastify/static is pinned at ${range}`);
});

test('the asset route serves the stylesheet it is supposed to serve', async () => {
  const response = await app.inject({ method: 'GET', url: '/assets/portal.css' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /text\/css/);
  assert.match(response.body, /\.coverage-note/);
});

test('a traversal cannot reach a file outside the assets directory', async () => {
  // Every spelling of "go up and read something else". None may return a file.
  const attempts = [
    '/assets/../package.json',
    '/assets/../../package.json',
    '/assets/../.env',
    '/assets/../../../etc/passwd',
    '/assets/..%2fpackage.json',
    '/assets/..%2F..%2Fpackage.json',
    '/assets/%2e%2e/package.json',
    '/assets/%2e%2e%2f%2e%2e%2fpackage.json',
    '/assets/....//package.json',
    '/assets/..%252fpackage.json',
    '/assets/.%2e/package.json',
    '/assets/%c0%ae%c0%ae/package.json',
    '/assets/..\\package.json',
    '/assets/./../../.env',
  ];
  const leaked: string[] = [];
  for (const url of attempts) {
    const response = await app.inject({ method: 'GET', url });
    if (response.statusCode === 200
        && /"name"|DATABASE_URL|root:/.test(response.body)) {
      leaked.push(`${url} -> ${response.statusCode}`);
    }
  }
  assert.deepEqual(leaked, [], 'a traversal returned a file outside /assets');
});

test('a directory listing is not offered', async () => {
  for (const url of ['/assets/', '/assets', '/assets/.']) {
    const response = await app.inject({ method: 'GET', url });
    // Whatever it answers, it must not enumerate the directory.
    assert.equal(/portal\.css[\s\S]*portal\.js/.test(response.body), false,
      `${url} listed the assets directory`);
  }
});

test('an encoded separator cannot reach a guarded route through the static prefix',
  async () => {
    // The route-guard bypass advisory: /assets/%2f.. resolving into a sibling route.
    const attempts = [
      '/assets/%2fsettings',
      '/assets/..%2fsettings',
      '/assets/%2e%2e%2fsettings',
      '/assets/../settings',
      '/assets//settings',
    ];
    for (const url of attempts) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(/Integrations|Feature mode|TWILIO_AUTH_TOKEN/.test(response.body), false,
        `${url} reached the settings page without a session`);
    }
  });

test('a non-canonical path does not bypass the session check', async () => {
  // The authorization-bypass advisory shape: a route that requires a session being
  // reached by a path that normalises to it only after the guard has run.
  const attempts = [
    '/settings', '/settings/', '//settings', '/./settings', '/foo/../settings',
    '/%73ettings', '/settings%2f', '/SETTINGS',
  ];
  const reached: string[] = [];
  for (const url of attempts) {
    const response = await app.inject({ method: 'GET', url });
    const served = response.statusCode === 200
      && /Integrations|Feature mode/.test(response.body);
    if (served) reached.push(url);
  }
  assert.deepEqual(reached, [],
    'an unauthenticated caller reached the settings page');
});

test('a rep still cannot reach a manager page however the path is spelled', async () => {
  const cookie = await signIn('static.rep@test.local', 'SALES_REP');
  for (const url of ['/settings', '/settings/', '//settings', '/./settings',
                     '/assets/../settings']) {
    const response = await app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(/Integrations|Feature mode/.test(response.body), false,
      `a rep reached settings via ${url}`);
  }
});

test('assets are public, and everything else still needs a session', async () => {
  // The assets prefix is deliberately unauthenticated: it is a stylesheet.
  const asset = await app.inject({ method: 'GET', url: '/assets/portal.css' });
  assert.equal(asset.statusCode, 200);

  for (const url of ['/', '/find', '/prospects', '/settings', '/mining']) {
    const response = await app.inject({ method: 'GET', url });
    const isRedirect = response.statusCode === 302
      && String(response.headers.location).startsWith('/login');
    assert.ok(isRedirect || response.statusCode === 401 || response.statusCode === 403,
      `${url} answered ${response.statusCode} with no session`);
  }
});

test('a request for a file that does not exist is a plain 404', async () => {
  const response = await app.inject({ method: 'GET', url: '/assets/not-a-real-file.css' });
  assert.equal(response.statusCode, 404);
  // And it does not disclose the filesystem path it looked in.
  assert.equal(/\/home\/|ENOENT|no such file/i.test(response.body), false,
    'a missing asset disclosed a filesystem path');
});

test('a null byte or a control character in a path is refused, not resolved', async () => {
  for (const url of ['/assets/portal.css%00.txt', '/assets/%00', '/assets/portal%0d%0a.css']) {
    const response = await app.inject({ method: 'GET', url });
    assert.notEqual(response.statusCode, 200, `${url} returned a file`);
  }
});

test('the static plugin serves only the assets directory', async () => {
  const server = readFileSync(resolve(packageRoot, 'src/api/server.ts'), 'utf8');
  // The registration, not the import line above it.
  const at = server.indexOf('register(fastifyStatic');
  assert.ok(at > 0, 'the static plugin is not registered');
  const block = server.slice(at, at + 400);
  assert.match(block, /prefix:\s*'\/assets\/'/, 'the static prefix is not /assets/');
  assert.match(block, /root:\s*assetsDir/);
  // Directory listing and dotfile serving must both stay off.
  assert.equal(/list:\s*true/.test(server), false, 'directory listing is enabled');
  assert.equal(/serveDotFiles:\s*true|dotfiles:\s*'allow'/.test(server), false,
    'dotfiles are served');
});
