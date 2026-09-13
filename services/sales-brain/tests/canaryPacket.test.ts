import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { canaryPacket, renderCanaryPacket } from '../src/release/canaryPacket.js';

/**
 * The document somebody reads at the moment they are about to spend money.
 *
 * Which is why it is generated rather than written: a readiness document that has
 * drifted from the system is worse than none. Every number in it is read from the
 * build, the schema and the configuration when it runs, and the proposed queries
 * come from the real planner in dry mode, so the packet shows the searches that
 * would actually go out.
 *
 * These tests are mostly about what it must not do -- contact a provider, need a
 * credential, write a row, or carry a secret.
 */

const SECRETS = {
  DATAFORSEO_PASSWORD: 'packet-secret-password-value',
  DATAFORSEO_LOGIN: 'packet-login@example.invalid',
  ANTHROPIC_API_KEY: 'packet-secret-anthropic-key',
};

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  for (const key of Object.keys(SECRETS)) delete process.env[key];
  await pool.end();
});

test('the packet carries variable names and never their values', async () => {
  for (const [key, value] of Object.entries(SECRETS)) process.env[key] = value;
  try {
    const packet = await canaryPacket();
    const text = JSON.stringify(packet) + renderCanaryPacket(packet);

    for (const [key, value] of Object.entries(SECRETS)) {
      assert.ok(text.includes(key) || key === 'ANTHROPIC_API_KEY',
        `${key} is not named, so a reader cannot tell what to set`);
      assert.ok(!text.includes(value),
        `the packet carries the value of ${key}, and this document gets pasted into `
        + 'messages');
    }
    // Presence is reported, which is the useful half.
    const login = packet.configuration.requiredEnvNames
      .find((entry) => entry.name === 'DATAFORSEO_LOGIN');
    assert.equal(login?.present, true, 'a configured variable reads as unset');
  } finally {
    for (const key of Object.keys(SECRETS)) delete process.env[key];
  }
});

test('generating it writes nothing and needs no credential', async () => {
  const before = await query<{ n: number }>(
    `select (select count(*) from provider_usage) + (select count(*) from provider_tasks)
            + (select count(*) from jobs) + (select count(*) from accounts) as n`);
  const packet = await canaryPacket();
  const after = await query<{ n: number }>(
    `select (select count(*) from provider_usage) + (select count(*) from provider_tasks)
            + (select count(*) from jobs) + (select count(*) from accounts) as n`);
  assert.equal(Number(after.rows[0]!.n), Number(before.rows[0]!.n),
    'producing a readiness packet changed the system it describes');
  // And it produced a real plan without a provider, which is the point: the queries
  // are knowable before anybody pays for one.
  assert.ok(packet.proposal.plan, 'no plan was produced');
  assert.ok(packet.proposal.plan!.searches.length > 0);
});

test('the proposed queries are the ones that would go out', async () => {
  const packet = await canaryPacket({ vertical: 'roofing', location: '32095', count: 5 });
  const plan = packet.proposal.plan!;
  assert.equal(plan.searches.length, 5,
    'the packet promises five independent searches and plans a different number');
  const keywords = plan.searches.map((search) => search.keyword);
  assert.equal(new Set(keywords).size, keywords.length,
    'two of the planned searches are the same question bought twice');
  for (const search of plan.searches) {
    assert.match(search.locationName, /United States/,
      'a bare ZIP is not a place the provider resolves');
    assert.ok(search.keyword.includes('32095'),
      'the town is wider than the ZIP, so the query has to narrow it back');
  }
  // Cause terms nobody asked for stay out of a general run.
  assert.ok(plan.causesHeldBack.length > 0,
    'the packet does not show which event terms were held back');
});

test('the packet says what today would refuse', async () => {
  // With no provider configured, a live run would find nothing. Saying so is the
  // difference between a readiness document and a wish.
  const packet = await canaryPacket();
  const codes = packet.proposal.plan!.refusals.map((refusal) => refusal.code);
  assert.ok(codes.includes('NO_PROVIDER'),
    `nothing is configured and the packet does not say so: ${codes.join(', ')}`);
});

test('every stop condition is a condition, not an aspiration', async () => {
  const packet = await canaryPacket();
  for (const group of [packet.gates.success, packet.gates.abort, packet.gates.stop]) {
    assert.ok(group.length >= 4, 'a gate list too short to be a gate');
    for (const item of group) {
      assert.ok(item.length > 40, `"${item}" is too vague to check`);
      assert.doesNotMatch(item, /\bshould probably\b|\btry to\b/i,
        `"${item}" is a hope rather than a condition`);
    }
  }
  // The one that matters most: a discovery canary must not coincide with an armed
  // dialler, and the packet has to say so out loud.
  assert.ok(packet.gates.stop.some((item) => /OUTBOUND_DIAL_ENABLED/.test(item)),
    'the stop conditions do not mention the dialler');
});

test('the commands state the money twice, as the canary requires', async () => {
  const packet = await canaryPacket({ maxCostCents: 30 });
  const live = packet.procedure.commands.find((command) => command.includes('--live'));
  assert.ok(live, 'no live command is given');
  assert.match(live!, /--max-cost-cents 30/);
  assert.match(live!, /--confirm-spend-cents 30/,
    'the live command does not restate the ceiling, so a copied dry run could go live');
  // And a dry run comes first.
  const dryAt = packet.procedure.commands.findIndex((command) =>
    command.includes('miner:canary') && !command.includes('--live'));
  const liveAt = packet.procedure.commands.indexOf(live!);
  assert.ok(dryAt >= 0 && dryAt < liveAt, 'the packet does not read the plan first');
});

test('the rendered packet says it executed nothing', async () => {
  const rendered = renderCanaryPacket(await canaryPacket());
  assert.match(rendered, /executes nothing/i);
  assert.match(rendered, /contacts no provider/i);
  assert.match(rendered, /names only/i);
});
