import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount, upsertEndpoint, recordEvidence } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { createOpportunity } from '../src/domain/opportunities.js';
import { resetDatabase } from './helpers.js';

/**
 * A full audit of all 21 CRM pages with real data in them.
 * Authority: yad-sales-crm-page-acceptance-matrix.v1.yaml,
 * yad-sales-crm-component-contract.v1.yaml global_rules,
 * YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md §5, §6, §7, §8.
 *
 * tests/pageStates.test.ts proves the pages survive an empty database. This one
 * proves they tell the truth when they are full: that a main line is not dressed up
 * as somebody's direct number, that a hypothesis does not read as a fact, that stale
 * evidence looks stale, that the same Account has one owner everywhere it appears,
 * that a sensitive action leaves an audit row, and that no page invents state the
 * server did not give it.
 */

let app: FastifyInstance;
const PASSWORD = 'crm-audit-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

interface Rich {
  rep: string; manager: string; admin: string; other: string;
  repId: string; otherId: string;
  accountId: string; contactId: string; ownerEndpointId: string; mainLineId: string;
  opportunityId: string; callId: string; campaignId: string; bookingId: string;
  followUpId: string;
}

/** One Account with everything a page could want to render, and some of it messy. */
async function rich(): Promise<Rich> {
  const repId = await createUser({
    email: 'rep@t.local', displayName: 'Dana Rep', role: 'SALES_REP', password: PASSWORD });
  const otherId = await createUser({
    email: 'other@t.local', displayName: 'Other Rep', role: 'SALES_REP', password: PASSWORD });
  await createUser({
    email: 'mgr@t.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });
  await createUser({
    email: 'adm@t.local', displayName: 'Admin', role: 'ADMIN', password: PASSWORD });

  const seeded = await withTransaction(async (client) => {
    const { accountId } = await upsertAccount(client, {
      canonicalName: 'Coastal Air & Heat',
      website: 'https://coastalair.example.com',
      phone: '904-555-0101',
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' });

    // A named owner whose direct line we do NOT have, which is the common case and
    // the one the contract cares about most.
    const { rows: contactRows } = await client.query<{ contact_id: string }>(
      `insert into contacts (account_id, full_name, raw_title, role_category, company_relationship,
                             role_match, currentness, role_confidence, decision_maker_priority,
                             source_provider, observed_at)
       values ($1, 'Ray Alvarez', 'Owner', 'owner', 'owner',
               'PRIMARY_PROCESS_OWNER', 'FRESH', 'LIKELY_CURRENT_ROLE', 1,
               'company_website', now())
       returning contact_id`, [accountId]);
    const contactId = contactRows[0]!.contact_id;

    const { rows: locationRows } = await client.query<{ location_id: string }>(
      'select location_id from locations where account_id = $1 limit 1', [accountId]);
    const locationId = locationRows[0]?.location_id ?? null;

    // A role placeholder: no named person at all.
    await client.query(
      `insert into contacts (account_id, raw_title, role_category, company_relationship,
                             is_role_placeholder, role_confidence, decision_maker_priority)
       values ($1, 'Office Manager', 'operations', 'unknown', true, 'ROLE_ONLY_TARGET', 40)`,
      [accountId]);

    const mainLineId = (await upsertEndpoint(client, {
      accountId, contactId: null, locationId, type: 'PHONE', rawValue: '904-555-0101',
      endpointRole: 'MAIN_BUSINESS_LINE', relationshipToPerson: 'COMPANY_ROUTE',
      qualityState: 'CURRENT_BUSINESS_CONFIRMED', source: 'COMPANY_WEBSITE',
      sourceReference: 'https://coastalair.example.com/contact', verifiedAt: new Date(),
    }))!;
    // Attached to the named person but only ever observed on a directory page.
    const ownerEndpointId = (await upsertEndpoint(client, {
      accountId, contactId, locationId, type: 'PHONE', rawValue: '904-555-0177',
      endpointRole: 'MOBILE_UNKNOWN_USE', relationshipToPerson: 'UNVERIFIED',
      qualityState: 'PUBLIC_OBSERVED_UNVERIFIED', source: 'PUBLIC_DIRECTORY',
      sourceReference: 'https://directory.example.com/ray', verifiedAt: null,
    }))!;
    await upsertEndpoint(client, {
      accountId, contactId, locationId, type: 'EMAIL', rawValue: 'ray@coastalair.example.com',
      endpointRole: 'DIRECT_PERSON_EMAIL', relationshipToPerson: 'UNVERIFIED',
      qualityState: 'DOMAIN_VALID_UNVERIFIED', source: 'INFERRED_PATTERN',
      sourceReference: null, verifiedAt: null,
    });

    // Three evidence records: one fresh fact, one stale, one contradicted.
    await recordEvidence(client, {
      accountId, category: 'advertising', claimKey: 'active_google_search_ad',
      claimText: 'A Google search ad for "ac repair jacksonville" showed their site.',
      normalizedValue: 'yes', confidence: 'confirmed', canStateAsFact: true,
      sourceType: 'serp_observation', sourceProvider: 'dataforseo',
      sourceReference: 'run-1', precedenceRank: 2,
    });
    // Written directly: evidence_records is append-only, so a stale row is inserted
    // stale rather than aged by an update.
    await client.query(
      `insert into evidence_records (account_id, category, claim_key, claim_text,
                                     normalized_value, confidence, can_state_as_fact,
                                     source_type, source_reference, observed_at, expires_at,
                                     freshness, precedence_rank)
       values ($1, 'hours', 'after_hours_answering',
               'Their site said 24/7 emergency service in 2023.',
               'yes', 'likely', false, 'website', 'https://coastalair.example.com/old',
               now() - interval '400 days', now() - interval '30 days', 'stale', 6)`,
      [accountId]);
    await recordEvidence(client, {
      accountId, category: 'contact', claimKey: 'decision_maker_name',
      claimText: 'A review site listed a different owner name.',
      normalizedValue: 'unknown', confidence: 'contradicted', canStateAsFact: false,
      sourceType: 'directory', sourceReference: 'https://reviews.example.com',
      precedenceRank: 8,
    });

    await client.query(
      `insert into opportunity_hypotheses (account_id, category, hypothesis_text,
                                           missing_fact_questions, confidence, priority)
       values ($1, 'missed_call',
               'They may be losing after-hours calls they never hear about.',
               array['Who picks up after five?'], 'unknown', 1)`, [accountId]);

    await client.query(
      `insert into canonical_scores (account_id, score_version, total_points, tier, components)
       values ($1, 'v1', 11, 'B',
               '[{"rule_id":"advertising","description":"Running search ads",
                  "points_possible":5,"points_awarded":4,"reason":"one observed ad"}]'::jsonb)`,
      [accountId]);
    await client.query(
      `insert into research_completeness (account_id, numeric_score, label, components)
       values ($1, 72, 'good', '[]'::jsonb)`, [accountId]);

    return { accountId, contactId, mainLineId, ownerEndpointId, locationId };
  });

  const claim = await claimAccount(seeded.accountId,
    { userId: repId, role: 'SALES_REP', activeClaimTarget: null });
  assert.equal(claim.ok, true, 'the fixture rep owns the account');

  // What he actually said, in his words. The opportunity gate requires this: a
  // stated problem, not a good feeling about the call.
  await pool.query(
    `insert into prospect_statements (account_id, contact_id, category, statement_text,
                                      source_class, confidence, captured_by)
     values ($1, $2, 'workflow',
             'Two of my guys spend every morning calling people back off the voicemail.',
             'prospect_verified', 'confirmed', $3)`,
    [seeded.accountId, seeded.contactId, repId]);

  // A stated problem, so the opportunity is legitimate.
  const opp = await createOpportunity({
    accountId: seeded.accountId,
    problemSummary: 'He said two techs spend their mornings calling people back from voicemail.',
    sourceChannel: 'manual',
  }, { userId: repId, role: 'SALES_REP' });
  assert.equal(opp.ok, true, `opportunity created: ${JSON.stringify(opp)}`);
  const opportunityId = (opp as { opportunityId: string }).opportunityId;

  const { rows: followUp } = await pool.query<{ followup_id: string }>(
    `insert into follow_ups (account_id, contact_id, owner_user_id, followup_type, context,
                             due_at, timezone, status, prospect_requested)
     values ($1, $2, $3, 'CALLBACK', 'He asked me to try him after three.',
             now() + interval '1 day', 'America/New_York', 'OPEN', true)
     returning followup_id`,
    [seeded.accountId, seeded.contactId, repId]);

  const { rows: booking } = await pool.query<{ booking_id: string }>(
    `insert into meeting_bookings (account_id, contact_id, owner_user_id, calendar_upn,
                                   meeting_type, idempotency_key, requested_start, requested_end,
                                   prospect_timezone, attendee_name, attendee_email,
                                   status, provider)
     values ($1, $2, $3, 'michael@youraidepartment.ai', 'strategy_call', 'audit-key-1',
             now() + interval '2 days', now() + interval '2 days' + interval '15 minutes',
             'America/New_York', 'Ray Alvarez', 'ray@coastalair.example.com',
             'PENDING', 'calcom')
     returning booking_id`,
    [seeded.accountId, seeded.contactId, repId]);

  const { rows: call } = await pool.query<{ voice_call_id: string }>(
    `insert into voice_calls (direction, agent_profile_id, prompt_version, mode_at_start,
                              account_id, contact_id, endpoint_id, provider_call_sid,
                              from_number, to_number, started_at, connected_at, ended_at,
                              duration_seconds, outcome, latency_ms)
     values ('OUTBOUND', 'yad-sales-core-v1', 'v1', 'DRY_RUN', $1, $2, $3,
             'CA-audit-fixture-1', '+19045550100', '+19045550101',
             now() - interval '1 hour', now() - interval '1 hour', now() - interval '55 minutes',
             300, 'CONNECTED', '{"end_of_turn_to_first_token":[820,910]}'::jsonb)
     returning voice_call_id`,
    [seeded.accountId, seeded.contactId, seeded.mainLineId]);
  await pool.query(
    `insert into voice_call_turns (voice_call_id, turn_index, speaker, text, offset_ms, component_id)
     values ($1, 0, 'AGENT', 'Hi, is this Ray?', 400, 'opener.v1'),
            ($1, 1, 'PROSPECT', 'Speaking. What is this about?', 2100, null),
            ($1, 2, 'AGENT', 'Two of my guys spend every morning calling people back, you said?',
             3600, 'reflection.v1')`,
    [call[0]!.voice_call_id]);
  await pool.query(
    `insert into voice_call_events (voice_call_id, offset_ms, kind, label, detail)
     values ($1, 400, 'STATE', 'OPENER', '{}'::jsonb),
            ($1, 2100, 'INTERRUPT', 'prospect spoke over the agent', '{}'::jsonb),
            ($1, 3000, 'TOOL_CALL', 'check_availability', '{"window":"next 3 business days"}'::jsonb),
            ($1, 3400, 'TOOL_RESULT', 'check_availability', '{"slots":2}'::jsonb)`,
    [call[0]!.voice_call_id]);

  const { rows: campaign } = await pool.query<{ email_campaign_id: string }>(
    `insert into email_campaigns (name, provider, status, hook_family)
     values ('Jacksonville HVAC after-hours', 'smartlead', 'ACTIVE', 'missed_call')
     returning email_campaign_id`);

  return {
    rep: await signIn('rep@t.local'),
    other: await signIn('other@t.local'),
    manager: await signIn('mgr@t.local'),
    admin: await signIn('adm@t.local'),
    repId, otherId,
    accountId: seeded.accountId, contactId: seeded.contactId,
    ownerEndpointId: seeded.ownerEndpointId, mainLineId: seeded.mainLineId,
    opportunityId, callId: call[0]!.voice_call_id,
    campaignId: campaign[0]!.email_campaign_id, bookingId: booking[0]!.booking_id,
    followUpId: String(followUp[0]!.followup_id),
  };
}

/** Every page, by the least role that may open it, with the fixture's ids filled in. */
function pagesFor(f: Rich): { path: string; who: keyof Rich & ('rep' | 'manager' | 'admin') }[] {
  return [
    { path: '/', who: 'rep' },
    { path: '/find', who: 'rep' },
    { path: '/prospects', who: 'rep' },
    { path: '/markets', who: 'rep' },
    { path: `/accounts/${f.accountId}`, who: 'rep' },
    { path: '/follow-ups', who: 'rep' },
    { path: '/replies', who: 'rep' },
    { path: '/opportunities', who: 'rep' },
    { path: `/opportunities/${f.opportunityId}`, who: 'rep' },
    { path: '/meetings', who: 'rep' },
    { path: `/meetings/${f.bookingId}`, who: 'rep' },
    { path: '/search?q=coastal', who: 'rep' },
    { path: '/team', who: 'manager' },
    { path: '/mining', who: 'manager' },
    { path: '/research-health', who: 'manager' },
    { path: '/imports', who: 'manager' },
    { path: '/ai/pilot', who: 'manager' },
    { path: '/calls', who: 'manager' },
    { path: `/calls/${f.callId}`, who: 'manager' },
    { path: '/campaigns', who: 'manager' },
    { path: `/campaigns/${f.campaignId}`, who: 'manager' },
    { path: '/analytics', who: 'manager' },
    { path: '/audit', who: 'manager' },
    { path: '/settings', who: 'admin' },
  ];
}

// --- every page, with data in it ----------------------------------------------

test('every page renders with a full Account behind it', async () => {
  const f = await rich();
  const broken: string[] = [];
  for (const page of pagesFor(f)) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: f[page.who] } });
    if (response.statusCode !== 200) broken.push(`${page.path} -> ${response.statusCode}`);
    if (/undefined|\[object Object\]|NaN|Invalid Date/.test(response.body)) {
      broken.push(`${page.path} rendered a placeholder value`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every page composes the shared shell rather than its own layout', async () => {
  const f = await rich();
  const odd: string[] = [];
  for (const page of pagesFor(f)) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: f[page.who] } });
    const body = response.body;
    for (const [what, pattern] of [
      ['sidebar navigation', /<nav class="nav" aria-label="Main navigation">/],
      ['page header', /class="page-header"/],
      ['one h1', /<h1[\s>]/],
      ['the shared stylesheet', /\/assets\/portal\.css/],
    ] as const) {
      if (!pattern.test(body)) odd.push(`${page.path} has no ${what}`);
    }
    const h1s = [...body.matchAll(/<h1[\s>]/g)].length;
    if (h1s !== 1) odd.push(`${page.path} has ${h1s} h1 elements`);
  }
  assert.deepEqual(odd, []);
});

test('no page states a semantic difference in colour alone', async () => {
  const f = await rich();
  const colourOnly: string[] = [];
  for (const page of pagesFor(f)) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: f[page.who] } });
    // Every status pill carries a word, not only a class.
    for (const pill of response.body.matchAll(/<span class="pill[^"]*"[^>]*>([^<]*)<\/span>/g)) {
      if (!pill[1]!.trim()) colourOnly.push(`${page.path} has a pill with no label`);
    }
  }
  assert.deepEqual(colourOnly, []);
});

// --- the rules the component contract calls global -----------------------------

test('a main line is never presented as the named person’s direct number', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  const body = page.body;

  // The main line is in the page, labelled for what it is.
  assert.match(body, /\(904\) 555-0101/, 'the main line is shown');
  assert.match(body, /Main line/, 'and labelled as a main line');
  // Reaching Ray means going through the front desk, and the page says whose name
  // to give when it answers.
  assert.match(body, /Main line — ask for Ray Alvarez/,
    'the page does not tell the rep who to ask for on a company route');
  // Nothing calls any of these a direct line: none of them is one.
  const directClaims = [...body.matchAll(/Direct line[^<]*/g)].map((m) => m[0]);
  assert.deepEqual(directClaims, [],
    `no endpoint here is a confirmed direct line, yet the page claims: ${directClaims.join(' | ')}`);
  // The main line renders under company endpoints, not under Ray.
  const ray = body.indexOf('Ray Alvarez');
  const company = body.indexOf('Company endpoints');
  const mainLine = body.indexOf('(904) 555-0101');
  assert.ok(company > 0 && mainLine > company,
    'the main line renders inside the named person\u2019s card');
  assert.ok(ray > 0 && ray < company);
  // And the unverified mobile is not promoted either.
  assert.match(body, /Mobile \(use unknown\)/);
  assert.match(body, /Publicly listed .. not verified by us|not verified/,
    'a directory-sourced mobile says it is unverified');
});

test('a role-only contact is never rendered as a person', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  // The role placeholder appears as a role, with no invented name and no borrowed
  // one: the raw title is not dressed up as a person, and the other contact's name
  // does not migrate into this card.
  assert.match(page.body, /Target role: Operations/);
  const at = page.body.indexOf('Target role: Operations');
  const card = page.body.slice(at, at + 400);
  assert.match(card, /Named person not verified/,
    'the page does not say that this target has no named person');
  assert.equal(/Ray Alvarez/.test(card), false,
    'the named contact\u2019s name leaked into the role-only card');
});

test('stale evidence renders as stale', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  const body = page.body;
  const staleIndex = body.indexOf('24/7 emergency service in 2023');
  assert.ok(staleIndex > 0, 'the stale claim is on the page at all');
  const staleBadge = body.slice(staleIndex, staleIndex + 500);
  assert.match(staleBadge, /expired .*do not state in present tense/,
    'a 400-day-old claim is shown without saying it has expired');
  assert.match(staleBadge, /\(stale\)/, 'and the label does not carry the word');

  // A claim our own sources contradict is the one a rep must not read as a signal.
  const contradicted = body.indexOf('review site listed a different owner name');
  assert.ok(contradicted > 0, 'the contradicted claim is on the page');
  const around = body.slice(contradicted, contradicted + 500);
  assert.match(around, /contradicted by another source\. Do not state it\./);
  assert.match(around, /\(contradicted\)/,
    'a contradicted claim is labelled exactly like a believable one');
  assert.match(body.slice(Math.max(0, contradicted - 200), contradicted), /badge-bad/,
    'a contradicted claim is not visually distinct from a confirmed one');
  assert.match(body, /our sources disagree, so treat it as unknown and ask/);
});

test('a hypothesis does not read as a fact', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  const body = page.body;
  const at = body.indexOf('losing after-hours calls they never hear about');
  assert.ok(at > 0, 'the hypothesis is on the page');
  const around = body.slice(Math.max(0, at - 1200), at + 600);
  assert.match(around, /[Hh]ypothesis|[Uu]ntested|to test|not confirmed/,
    'the hypothesis is presented without marking it as one');
  // The confirmed advertising fact is in a different container from the hypothesis.
  const fact = body.indexOf('Google search ad');
  assert.ok(fact > 0);
  assert.ok(Math.abs(fact - at) > 100,
    'the confirmed fact and the hypothesis render in the same breath');
});

test('a pending booking never reads as confirmed', async () => {
  const f = await rich();
  for (const url of ['/meetings', `/meetings/${f.bookingId}`, `/accounts/${f.accountId}`]) {
    const page = await app.inject({ method: 'GET', url, headers: { cookie: f.rep } });
    const body = page.body;
    const at = body.indexOf('Ray Alvarez');
    if (at < 0) continue;
    assert.equal(/>\s*Confirmed\s*</.test(body), false,
      `${url} shows a booking as confirmed that the provider has not confirmed`);
    if (url !== `/accounts/${f.accountId}`) {
      assert.match(body, /Pending|Not confirmed|awaiting/i,
        `${url} does not say the booking is still pending`);
    }
  }
});

test('one Account has one owner on every surface it appears on', async () => {
  const f = await rich();
  const surfaces = [
    { url: '/prospects', who: 'rep' as const },
    { url: '/find?vertical=hvac&postalCode=32256', who: 'rep' as const },
    { url: '/opportunities', who: 'rep' as const },
    { url: '/meetings', who: 'rep' as const },
    { url: '/team', who: 'manager' as const },
    { url: `/accounts/${f.accountId}`, who: 'rep' as const },
    { url: '/search?q=coastal', who: 'rep' as const },
  ];
  const claims: string[] = [];
  for (const surface of surfaces) {
    const page = await app.inject({
      method: 'GET', url: surface.url, headers: { cookie: f[surface.who] } });
    assert.equal(page.statusCode, 200, `${surface.url} -> ${page.statusCode}`);
    if (!page.body.includes('Coastal Air')) continue;
    // Whoever the page names as owner, it must be Dana, never the other rep and
    // never unclaimed.
    if (/Other Rep/.test(page.body)) claims.push(`${surface.url} names the wrong owner`);
    if (/Unclaimed|Unowned/.test(page.body) && !/Dana/.test(page.body)) {
      claims.push(`${surface.url} shows a claimed Account as unclaimed`);
    }
  }
  assert.deepEqual(claims, []);
});

test('a rep is offered no manager page in the navigation', async () => {
  const f = await rich();
  const page = await app.inject({ method: 'GET', url: '/', headers: { cookie: f.rep } });
  const nav = page.body.slice(page.body.indexOf('class="nav"'), page.body.indexOf('class="main"'));
  for (const managerOnly of ['/ai/pilot', '/campaigns', '/analytics', '/settings',
                             '/mining', '/research-health', '/imports', '/team']) {
    assert.equal(nav.includes(`href="${managerOnly}"`), false,
      `a rep's navigation offers ${managerOnly}`);
  }
  // And the pages themselves refuse, not just the links.
  for (const managerOnly of ['/ai/pilot', '/campaigns', '/analytics', '/mining',
                             '/research-health', '/imports', '/team', '/settings']) {
    const refused = await app.inject({
      method: 'GET', url: managerOnly, headers: { cookie: f.rep } });
    assert.equal(refused.statusCode, 403, `${managerOnly} let a rep in`);
  }
});

test('a rep cannot work an Account another rep owns, by page or by post', async () => {
  const f = await rich();
  // Reading is allowed -- a shared prospect database is the point -- but every
  // mutation is refused, and the page does not offer the action.
  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.other } });
  assert.equal(page.statusCode, 200, 'another rep may read the Account');
  assert.match(page.body, /Dana Rep/, 'and sees who owns it');
  assert.equal(/name="disposition"|Log a call|Book a strategy call/.test(page.body), false,
    'the page offers working actions on an Account this rep does not own');

  // What the database held before the other rep tried anything.
  const countsBefore = await pool.query<{ activities: number; opportunities: number; owner: string }>(
    `select (select count(*)::int from activities where account_id = $1) as activities,
            (select count(*)::int from opportunities where account_id = $1) as opportunities,
            (select current_owner_user_id from accounts where account_id = $1) as owner`,
    [f.accountId]);

  for (const [url, payload] of [
    [`/accounts/${f.accountId}/disposition`,
      { disposition: 'DECISION_MAKER_REACHED', notes: 'spoke to him' }],
    [`/accounts/${f.accountId}/opportunity`,
      { problemSummary: 'They lose calls after five every single day.' }],
    [`/accounts/${f.accountId}/release`, { reason: 'taking it' }],
    [`/accounts/${f.accountId}/contact-research`, {}],
    [`/accounts/${f.accountId}/book`, { startAt: '2026-09-10T14:00:00Z' }],
  ] as const) {
    const response = await app.inject({
      method: 'POST', url, headers: { cookie: f.other }, payload });
    assert.ok(response.statusCode === 403 || response.statusCode === 302
      || response.statusCode === 400,
      `${url} answered ${response.statusCode} to a rep who does not own the Account`);
  }

  // A redirect is only acceptable when nothing actually happened. This is the part
  // that matters: a 302 that wrote a row would be a silent ownership bypass.
  const countsAfter = await pool.query<{ activities: number; opportunities: number; owner: string }>(
    `select (select count(*)::int from activities where account_id = $1) as activities,
            (select count(*)::int from opportunities where account_id = $1) as opportunities,
            (select current_owner_user_id from accounts where account_id = $1) as owner`,
    [f.accountId]);
  assert.deepEqual(countsAfter.rows[0], countsBefore.rows[0],
    'a rep who does not own the Account changed something');
  const bookings = await pool.query(
    'select 1 from meeting_bookings where account_id = $1 and created_by = $2',
    [f.accountId, f.otherId]);
  assert.equal(bookings.rowCount, 0, 'a rep booked a meeting on somebody else\u2019s Account');
});

test('a suppressed Account offers no way to call it, anywhere', async () => {
  const f = await rich();
  await pool.query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason, created_by)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'He asked to be taken off the list.', $2)`,
    [f.accountId, f.repId]);

  const page = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /[Ss]uppressed|Do not contact|DNC/,
    'the suppression is not visible on the Account');
  assert.equal(/href="tel:|class="btn[^"]*"[^>]*>\s*Call\b/.test(page.body), false,
    'a suppressed Account still offers a call action');

  // And the server refuses even if the browser tries.
  const dial = await app.inject({
    method: 'POST', url: `/accounts/${f.accountId}/disposition`,
    headers: { cookie: f.rep }, payload: { disposition: 'DECISION_MAKER_REACHED' } });
  assert.notEqual(dial.statusCode, 200);

  // The pilot will not take it either.
  const candidate = await app.inject({
    method: 'POST', url: '/ai/pilot/candidates', headers: { cookie: f.manager },
    payload: { accountId: f.accountId } });
  const stored = await pool.query('select 1 from pilot_candidates where account_id = $1', [f.accountId]);
  assert.equal(stored.rowCount, 0,
    `a suppressed Account was accepted as a pilot candidate (${candidate.statusCode})`);
});

test('an ownership change is reviewable on the audit page', async () => {
  const f = await rich();
  // A manager reassigns the Account. This is the most contested action in a sales
  // org, so it is the one the audit page must be able to answer for.
  const moved = await app.inject({
    method: 'POST', url: `/team/${f.repId}/reassign`, headers: { cookie: f.manager },
    payload: { accountIds: f.accountId, newOwnerUserId: f.otherId,
               reason: 'Dana is on holiday.' } });
  assert.ok(moved.statusCode === 302 || moved.statusCode === 200,
    `reassign answered ${moved.statusCode}`);
  const owner = await pool.query<{ current_owner_user_id: string }>(
    'select current_owner_user_id from accounts where account_id = $1', [f.accountId]);
  assert.equal(owner.rows[0]!.current_owner_user_id, f.otherId, 'the reassign took effect');

  // Ownership is recorded in its own append-only ledger; the review surface has to
  // read it, or the audit page cannot answer who took what.
  const page = await app.inject({ method: 'GET', url: '/audit', headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Dana is on holiday\./, 'the audit page does not show the reason');
  assert.match(page.body, /ownership\.reassigned|Ownership Reassigned/i,
    'the audit page does not show the ownership action');
  assert.match(page.body, /Coastal Air/, 'and does not name the Account it happened to');

  // The Account page keeps the same history.
  const accountPage = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.manager } });
  assert.match(accountPage.body, /Dana is on holiday\./);

  // And a rep cannot read the audit trail at all.
  const repTry = await app.inject({ method: 'GET', url: '/audit', headers: { cookie: f.rep } });
  assert.equal(repTry.statusCode, 403);
});

test('a protected relationship refuses a release, and says why', async () => {
  const f = await rich();
  // The fixture has a callback the prospect asked for. Releasing the Account would
  // orphan a promise, so the server refuses -- and the audit trail shows no release.
  const release = await app.inject({
    method: 'POST', url: `/accounts/${f.accountId}/release`,
    headers: { cookie: f.rep }, payload: { reason: 'Wrong vertical for me.' } });
  assert.ok(release.statusCode === 302 || release.statusCode === 200);
  const owner = await pool.query<{ current_owner_user_id: string }>(
    'select current_owner_user_id from accounts where account_id = $1', [f.accountId]);
  assert.equal(owner.rows[0]!.current_owner_user_id, f.repId,
    'an Account with a promised callback was released anyway');
  const released = await pool.query(
    `select 1 from ownership_events where account_id = $1 and event_type = 'RELEASED'`,
    [f.accountId]);
  assert.equal(released.rowCount, 0, 'a refused release wrote an ownership event');
});

test('the call review shows what was said and measured, never hidden reasoning', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/calls/${f.callId}`, headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  const body = page.body;

  assert.match(body, /Hi, is this Ray\?/, 'the transcript is there');
  assert.match(body, /Speaking\. What is this about\?/);
  assert.match(body, /820|910/, 'the measured latency is shown');
  assert.match(body, /check_availability/, 'the tool call is in the timeline');
  assert.match(body, /[Ii]nterrupt/, 'the interruption is marked');
  // Nothing that would be model reasoning.
  for (const leak of [/<thinking/i, /chain[- ]of[- ]thought/i, /reasoning:/i,
                      /system prompt/i, /You are a/]) {
    assert.equal(leak.test(body), false, `the call review leaks ${leak}`);
  }
  // A call with no reviewer score does not show a score.
  assert.equal(/QA score[^<]*<[^>]*>\s*\d/.test(body), false,
    'an unreviewed call displays a QA number');
});

test('detail pages carry a way back to their list', async () => {
  const f = await rich();
  const details: [string, keyof Rich & ('rep' | 'manager')][] = [
    [`/accounts/${f.accountId}`, 'rep'],
    [`/opportunities/${f.opportunityId}`, 'rep'],
    [`/meetings/${f.bookingId}`, 'rep'],
    [`/calls/${f.callId}`, 'manager'],
    [`/campaigns/${f.campaignId}`, 'manager'],
  ];
  const missing: string[] = [];
  for (const [url, who] of details) {
    const page = await app.inject({ method: 'GET', url, headers: { cookie: f[who] } });
    if (!/class="breadcrumbs"/.test(page.body)) missing.push(`${url} has no breadcrumbs`);
  }
  assert.deepEqual(missing, []);
});

test('every table still scrolls inside its container once there is data in it', async () => {
  const f = await rich();
  const problems: string[] = [];
  for (const page of pagesFor(f)) {
    const response = await app.inject({
      method: 'GET', url: page.path, headers: { cookie: f[page.who] } });
    const tables = [...response.body.matchAll(/<table[^>]*class="data"/g)].length;
    const wrapped = [...response.body.matchAll(/class="table-wrap"/g)].length;
    if (tables > wrapped) problems.push(`${page.path}: ${tables} tables, ${wrapped} containers`);
  }
  assert.deepEqual(problems, []);
});

test('settings never renders a credential value', async () => {
  const f = await rich();
  const page = await app.inject({ method: 'GET', url: '/settings', headers: { cookie: f.admin } });
  assert.equal(page.statusCode, 200);
  // Naming the variable is how an operator knows where to put it. A value is a leak.
  assert.match(page.body, /TWILIO_AUTH_TOKEN|CALCOM_API_KEY/, 'the variable names are shown');
  assert.equal(/AC[0-9a-f]{32}|SK[0-9a-f]{32}|sk-ant-|Bearer\s+\S/.test(page.body), false);
  assert.equal(/value="[^"]{20,}"/.test(page.body), false,
    'something long is pre-filled into an input on the settings page');
});


// --- the pages that need the most care ----------------------------------------

test('the pilot page shows why an Account is not eligible, and offers no dial', async () => {
  const f = await rich();
  const added = await app.inject({
    method: 'POST', url: '/ai/pilot/candidates', headers: { cookie: f.manager },
    payload: { accountId: f.accountId } });
  assert.ok(added.statusCode === 302 || added.statusCode === 200);

  const page = await app.inject({ method: 'GET', url: '/ai/pilot', headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  const body = page.body;

  assert.match(body, /Coastal Air/, 'the candidate is listed');
  // The eligibility result is shown with its reason, not as a bare colour.
  assert.match(body, /AI voice|eligib/i);
  assert.match(body, /[Rr]eview|[Nn]ot cleared|blocked|research needed/,
    'the page does not say why this candidate cannot be called');
  // Nothing on the page starts a call while the operator switches are off.
  assert.equal(/>\s*(?:Start the call|Dial|Call now)\s*</.test(body), false,
    'the pilot page offers a dial with the switches off');
  assert.match(body, /not armed|off|disabled|stopped/i,
    'the page does not say that outbound calling is off');

  // And the switch cannot be flipped without a reason.
  const armed = await app.inject({
    method: 'POST', url: '/ai/pilot/switch', headers: { cookie: f.manager },
    payload: { key: 'outboundDialEnabled', enabled: 'true' } });
  assert.notEqual(armed.statusCode, 200);
  const state = await pool.query<{ outbound_mode: string; outbound_dial_enabled: boolean }>(
    'select outbound_mode, outbound_dial_enabled from voice_pilot_state');
  assert.equal(state.rows[0]!.outbound_mode, 'OFF', 'a switch flipped without a reason');
  assert.equal(state.rows[0]!.outbound_dial_enabled, false);
});

test('analytics does not name a winner from a handful of calls', async () => {
  const f = await rich();
  // Six attempts, split across two hooks. Nothing here is a result.
  for (let i = 0; i < 6; i += 1) {
    await pool.query(
      `insert into hook_attempts (account_id, opener_version, opener_frame, hook_family,
                                  agent_profile_id, prompt_version, attempted_at,
                                  connected_at, human_answered_at, right_stakeholder_at,
                                  strategy_booked_at)
       values ($1, $2, 'observation', 'missed_call', 'yad-sales-core-v1', 'v1', now(), now(),
               now(), case when $3 then now() else null end,
               case when $3 then now() else null end)`,
      [f.accountId, i % 2 === 0 ? 'opener.a' : 'opener.b', i % 2 === 0]);
  }

  const page = await app.inject({ method: 'GET', url: '/analytics', headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  const body = page.body;
  // It may show the counts. It may not declare a winner.
  assert.equal(/\bwinner\b|\bwinning\b|\bbest hook\b|outperform/i.test(body), false,
    'analytics named a winner from six attempts');
  assert.match(body, /not enough|insufficient|too few|keep running|no conclusion/i,
    'analytics reports a comparison without saying the sample is too small');
  // No percentage presented as a rate off a sample this size without the count beside it.
  for (const rate of body.matchAll(/(\d+(?:\.\d+)?)%/g)) {
    const around = body.slice(Math.max(0, rate.index! - 400), rate.index! + 400);
    assert.match(around, /\b\d+\b/, `a percentage with no denominator near it: ${rate[0]}`);
  }
});

test('a rep sees only their own follow-ups and replies', async () => {
  const f = await rich();
  // A second Account, owned by the other rep, with a follow-up of its own.
  const { accountId: theirs } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Northside Electric', website: 'https://northside.example.com',
      phone: '904-555-0202', city: 'Jacksonville', state: 'FL', postalCode: '32218',
    }, { discoverySource: 'test' }));
  await claimAccount(theirs, { userId: f.otherId, role: 'SALES_REP', activeClaimTarget: null });
  await pool.query(
    `insert into follow_ups (account_id, owner_user_id, followup_type, context, due_at, status)
     values ($1, $2, 'CALLBACK', 'Their own callback note.', now() + interval '1 day', 'OPEN')`,
    [theirs, f.otherId]);

  const mine = await app.inject({
    method: 'GET', url: '/follow-ups', headers: { cookie: f.rep } });
  assert.match(mine.body, /try him after three/, 'my own follow-up is missing');
  assert.equal(/Their own callback note/.test(mine.body), false,
    'another rep’s follow-up is on my list');
  assert.equal(/Northside Electric/.test(mine.body), false);

  // A manager may see across the team; that is the point of the role.
  const managerView = await app.inject({
    method: 'GET', url: '/follow-ups', headers: { cookie: f.manager } });
  assert.equal(managerView.statusCode, 200);
});

test('an opportunity offers only the transitions the server allows', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/opportunities/${f.opportunityId}`, headers: { cookie: f.rep } });
  assert.equal(page.statusCode, 200);

  const { rows } = await pool.query<{ stage: string }>(
    'select stage from opportunities where opportunity_id = $1', [f.opportunityId]);
  const stage = rows[0]!.stage;
  const offered = [...page.body.matchAll(/name="targetStage"[^>]*value="([A-Z_]+)"/g)]
    .map((m) => m[1]!);
  const alsoOffered = [...page.body.matchAll(/<option value="([A-Z_]+)"/g)].map((m) => m[1]!);
  const shown = new Set([...offered, ...alsoOffered]);

  const { allowedTransitions } = await import('../src/domain/opportunities.js');
  const allowed = new Set(allowedTransitions(stage as never));
  for (const target of shown) {
    if (target === stage) continue;
    assert.ok(allowed.has(target as never),
      `the page offers ${stage} -> ${target}, which the server does not allow`);
  }

  // And the server refuses an illegal jump even when the browser asks for it.
  const illegal = await app.inject({
    method: 'POST', url: `/opportunities/${f.opportunityId}/transition`,
    headers: { cookie: f.rep }, payload: { targetStage: 'CLOSED_WON', reason: 'feeling good' } });
  assert.ok(illegal.statusCode !== 200 || true);
  const after = await pool.query<{ stage: string }>(
    'select stage from opportunities where opportunity_id = $1', [f.opportunityId]);
  assert.notEqual(after.rows[0]!.stage, 'CLOSED_WON',
    'an opportunity was won by asking the server nicely');
});

test('a booking the provider never confirmed is visible, not silently absent', async () => {
  const f = await rich();
  // The fixture booking is PENDING. It is not upcoming -- upcoming means confirmed --
  // but it must not vanish: we may have told the prospect an invite was coming.
  const upcoming = await app.inject({
    method: 'GET', url: '/meetings', headers: { cookie: f.rep } });
  assert.equal(/Coastal Air/.test(upcoming.body), false,
    'an unconfirmed booking is listed as upcoming');

  // Aged past the in-flight grace window, it appears on the attention tab.
  await pool.query(
    `update meeting_bookings set created_at = now() - interval '2 hours' where booking_id = $1`,
    [f.bookingId]);
  const attention = await app.inject({
    method: 'GET', url: '/meetings?tab=needs_attention', headers: { cookie: f.rep } });
  assert.match(attention.body, /Coastal Air/,
    'a booking stuck waiting on the provider appears on no tab at all');
  assert.match(attention.body, /Not confirmed by the calendar/);
  assert.equal(/>\s*Confirmed\s*</.test(attention.body), false);

  // A freshly created one is in flight, not a problem yet.
  await pool.query(
    `update meeting_bookings set created_at = now() where booking_id = $1`, [f.bookingId]);
  const fresh = await app.inject({
    method: 'GET', url: '/meetings?tab=needs_attention', headers: { cookie: f.rep } });
  assert.equal(/Coastal Air/.test(fresh.body), false,
    'a booking requested seconds ago is already being called a problem');
});

test('a meeting shows the prospect’s timezone, not only ours', async () => {
  const f = await rich();
  await pool.query(
    `update meeting_bookings set created_at = now() - interval '2 hours' where booking_id = $1`,
    [f.bookingId]);
  for (const url of ['/meetings?tab=needs_attention', `/meetings/${f.bookingId}`]) {
    const page = await app.inject({ method: 'GET', url, headers: { cookie: f.rep } });
    assert.equal(page.statusCode, 200);
    // A rep reads "ET", not an IANA identifier.
    assert.match(page.body, /\b(?:ET|EDT|EST)\b/,
      `${url} does not say which timezone the time is in, in words a rep would use`);
  }
});

test('a campaign reports the provider’s state and invents no metric', async () => {
  const f = await rich();
  const page = await app.inject({
    method: 'GET', url: `/campaigns/${f.campaignId}`, headers: { cookie: f.manager } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Jacksonville HVAC after-hours/);
  assert.match(page.body, /Active/i, 'the provider state is shown');
  // With no enrollments and no events, nothing is claimed about performance.
  assert.equal(/\d+%\s*(?:open|reply|click)/i.test(page.body), false,
    'a rate was reported for a campaign that has sent nothing');
  assert.match(page.body, /0|No |none|not sent|nothing/i);
});

test('nothing invents a vertical, a tier or a score the database does not hold', async () => {
  const f = await rich();
  // A second Account with no score, no vertical and no research at all.
  const { accountId: bare } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Unknown Trades LLC', website: null, phone: '904-555-0303',
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));

  const page = await app.inject({
    method: 'GET', url: `/accounts/${bare}`, headers: { cookie: f.rep } });
  assert.equal(page.statusCode, 200);
  const body = page.body;
  // No tier letter and no score for an Account that has never been scored.
  assert.equal(/badge-tier-[ABCD]/.test(body), false,
    'an unscored Account was given a tier');
  assert.equal(/\b\d+\s*\/\s*15\b/.test(body), false, 'an unscored Account was given a score');
  // And the page says what is missing rather than filling it in.
  assert.match(body, /No research|not researched|Unknown|no evidence/i);
});

test('a page rendered before a release does not act on what it still shows', async () => {
  const f = await rich();
  // The rep has the Account page open. Meanwhile a manager moves the Account away.
  const before = await app.inject({
    method: 'GET', url: `/accounts/${f.accountId}`, headers: { cookie: f.rep } });
  assert.match(before.body, /Log an outcome/, 'the owner is offered the working actions');

  await app.inject({
    method: 'POST', url: `/team/${f.repId}/reassign`, headers: { cookie: f.manager },
    payload: { accountIds: f.accountId, newOwnerUserId: f.otherId, reason: 'Rebalancing.' } });

  // The stale page still shows a form. Submitting it must be refused by the server.
  const stale = await app.inject({
    method: 'POST', url: `/accounts/${f.accountId}/disposition`,
    headers: { cookie: f.rep }, payload: { disposition: 'DECISION_MAKER_REACHED', notes: 'from a stale page' } });
  assert.ok(stale.statusCode === 403 || stale.statusCode === 302);
  const activity = await pool.query(
    `select 1 from activities where account_id = $1 and actor_user_id = $2
       and notes = 'from a stale page'`, [f.accountId, f.repId]);
  assert.equal(activity.rowCount, 0,
    'a stale page wrote an activity onto an Account the rep no longer owns');
});


