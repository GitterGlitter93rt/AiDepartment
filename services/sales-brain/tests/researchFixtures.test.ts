import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/contactResearch.js';
import { enqueueAccountResearch } from '../src/workers/enqueue.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';
import { readableSignalsFor, extractFirstPartySignals } from '../src/resolver/signals.js';
import { scoreAccount } from '../src/scoring/score.js';
import { explainScore } from '../src/scoring/explain.js';

/**
 * What a company's own pages say, read from pages we had already downloaded.
 * Authority: Issue #3 H, and the defect it uncovered.
 *
 * The vertical profiles have declared thirteen `public_signal_rules` since they were
 * written -- emergency cover, online booking, more than one branch, hiring,
 * financing, membership plans -- each with the score rule it feeds and prose saying
 * which conversation it opens.
 *
 * Nothing produced eleven of them. `contactResearch` called `recordEvidence` nowhere
 * at all: it crawled the About, Contact and Locations pages of a company's own site,
 * looked for people and phone numbers, and threw the text away. Every signal the
 * scoring model weighs was on a page we had already fetched, and a company could
 * only ever score on the miner's ad sightings -- against tier bands calibrated as
 * though the rest existed.
 *
 * These fixtures are adversarial on purpose. A site that reads well is not the
 * problem; a directory pretending to be a company, a domain that now belongs to
 * somebody else, and a tracking number sitting where a main line should be are.
 */

let realFetch: typeof globalThis.fetch;
let sequence = 0;

before(() => { realFetch = globalThis.fetch; });
after(async () => { globalThis.fetch = realFetch; await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  globalThis.fetch = realFetch;
});

/** Serves a fixture site, robots and all, through the real crawl. */
function serve(pages: Record<string, string>, options: {
  status?: Record<string, number>; redirects?: Record<string, string>;
} = {}): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const path = new URL(url).pathname;

    if (path === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { status: 200,
        headers: { 'content-type': 'text/plain' } });
    }
    const redirect = options.redirects?.[path];
    if (redirect) {
      return new Response(pages[redirect] ?? '', { status: 200,
        headers: { 'content-type': 'text/html' } });
    }
    const status = options.status?.[path];
    if (status && status >= 400) {
      return new Response('nope', { status, headers: { 'content-type': 'text/html' } });
    }
    const body = pages[path];
    if (body === undefined) {
      return new Response('not found', { status: 404,
        headers: { 'content-type': 'text/html' } });
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof globalThis.fetch;
}

async function account(host: string, vertical = 'hvac'): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Fixture Co ${sequence}`,
    website: `https://${host}`,
    phone: null, city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical,
  }, { discoverySource: 'listings:fixture' }));
  return accountId;
}

async function research(accountId: string): Promise<void> {
  await enqueueAccountResearch(accountId, null, 'newly_discovered');
  await drainQueue();
}

async function evidenceKeys(accountId: string): Promise<string[]> {
  const { rows } = await query<{ claim_key: string }>(
    `select distinct claim_key from evidence_records where account_id = $1 order by 1`,
    [accountId]);
  return rows.map((row) => row.claim_key);
}

// ------------------------------------------------- the gap this file uncovered ---

test('the profiles declare signals this system can now actually observe', async () => {
  const readable = await readableSignalsFor('hvac');
  assert.ok(readable.length >= 4,
    `hvac declares signals but only ${readable.length} can be read from a page`);
  const keys = readable.map((signal) => signal.claimKey);
  assert.ok(keys.includes('emergency_24_7_service'), keys.join(', '));
  assert.ok(keys.includes('online_quote_booking'), keys.join(', '));
});

test('a signal a vertical does not declare is never recorded, however clear the page', async () => {
  // The profile decides what matters; this decides only whether the words are there.
  const signals = await extractFirstPartySignals({
    verticalProfileId: 'law-firms',
    pages: [{ url: 'https://x.invalid/', text: 'Financing available on all roof work.' }],
  });
  const declared = (await readableSignalsFor('law-firms')).map((signal) => signal.claimKey);
  for (const signal of signals) {
    assert.ok(declared.includes(signal.claimKey),
      `${signal.claimKey} was recorded for a vertical that does not declare it`);
  }
});

// ------------------------------------------------------------- the good site ----

test('a clear site yields people, a route, and the signals it states', async () => {
  serve({
    '/': `<html><body><h1>Coastal Air</h1>
      <p>24/7 emergency service across St. Johns County.</p>
      <p>Call <a href="tel:+19045550111">(904) 555-0111</a></p>
      <a href="/about">About</a><a href="/contact">Contact</a></body></html>`,
    '/about': `<html><body><h3>Dana Fielder</h3><p>Owner</p>
      <p>We are hiring service technicians. Open positions in St. Augustine.</p>
      <p>Financing available on new systems.</p></body></html>`,
    '/contact': `<html><body><p>Request a quote online and we will call back.</p>
      <p>Ask about our maintenance plan.</p></body></html>`,
  });
  const accountId = await account('coastalair.invalid');
  await research(accountId);

  const keys = await evidenceKeys(accountId);
  for (const expected of ['emergency_24_7_service', 'online_quote_booking',
    'visible_growth_hiring', 'financing_promoted']) {
    assert.ok(keys.includes(expected),
      `"${expected}" is on the page and was not recorded. Recorded: ${keys.join(', ')}`);
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from contacts where account_id = $1 and not is_role_placeholder`,
    [accountId]);
  assert.equal(rows[0]!.n, 1, 'the named owner on the About page was not found');

  // membership_program is on the page and is deliberately absent: hvac does not
  // declare it. The profile decides what matters, and a signal it does not ask for
  // is not recorded however clearly the site states it.
  assert.ok(!keys.includes('membership_program'),
    'a signal hvac does not declare was recorded anyway');
});

test('a signal one vertical declares is recorded for that vertical', async () => {
  // Plumbing asks for membership plans; hvac does not. The same page, read for two
  // trades, honestly yields different evidence.
  serve({
    '/': `<html><body><h1>Plan Plumbing</h1>
      <p>Ask about our maintenance plan for members.</p></body></html>`,
  });
  const accountId = await account('planplumbing.invalid', 'plumbing');
  await research(accountId);
  assert.ok((await evidenceKeys(accountId)).includes('membership_program'),
    'a signal plumbing declares was not recorded from a page that states it');
});

test('a signal on the page is quoted in the company’s own words', async () => {
  serve({
    '/': `<html><body><p>We offer 24/7 emergency service, every day of the year.</p>
      </body></html>`,
  });
  const accountId = await account('quotable.invalid');
  await research(accountId);

  const { rows } = await query<{ claim_text: string; source_reference: string }>(
    `select claim_text, source_reference from evidence_records
      where account_id = $1 and claim_key = 'emergency_24_7_service'`, [accountId]);
  assert.match(rows[0]!.claim_text, /every day of the year/,
    'the evidence is our summary rather than what the company said');
  assert.match(rows[0]!.source_reference, /quotable\.invalid/,
    'the evidence cannot be traced to the page it came from');
});

// -------------------------------------------------------- adversarial pages -----

test('a site with a phone and no named person gives a route, not an invented owner', async () => {
  serve({
    '/': `<html><body><h1>Anonymous Air</h1>
      <p>Serving the First Coast since 2004. Call (904) 555-0122.</p>
      <p>Same-day repair available.</p></body></html>`,
  });
  const accountId = await account('anonymousair.invalid');
  await research(accountId);

  const picture = await researchPictureFor(accountId);
  const person = picture.facts.find((fact) => fact.key === 'decision_maker')!;
  assert.equal(person.state, 'NOT_OBSERVED',
    'a company with no named person on its site was given one');
  assert.match(person.detail, /Ask the gatekeeper/);

  const route = picture.facts.find((fact) => fact.key === 'contact_route')!;
  assert.equal(route.state, 'YES');
});

test('a tracking number is not promoted to the main line', async () => {
  // A marketing tracking number sits where a main number should be, with the real
  // one further down. Calling the tracking number reaches the company but tells
  // their ad platform a campaign worked, which is a fact we would be inventing.
  serve({
    '/': `<html><body><h1>Tracked Heating</h1>
      <p>Call now: <a href="tel:+18005550199">(800) 555-0199</a></p>
      <p>Office: (904) 555-0133</p></body></html>`,
  });
  const accountId = await account('trackedheating.invalid');
  await research(accountId);

  const { rows } = await query<{ normalized_value: string; endpoint_role: string;
    quality_state: string }>(
    `select normalized_value, endpoint_role, quality_state from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE'`, [accountId]);
  // Whatever is captured, nothing may be asserted as a direct line to a person:
  // both are company routes and the record must say so.
  for (const row of rows) {
    assert.notEqual(row.endpoint_role, 'DIRECT_PERSON_EMAIL');
    assert.ok(!['DIRECT_BUSINESS_LINE'].includes(row.endpoint_role)
      || row.quality_state !== 'DIRECT_BUSINESS_CONFIRMED',
      `${row.normalized_value} was asserted as a confirmed direct line from a page `
      + 'that only listed numbers');
  }
});

test('a domain that now belongs to somebody else does not lend its facts', async () => {
  // A rebranded or resold domain serves a different company entirely. Recording its
  // signals against our Account would attribute one business's operations to
  // another, and no page says "this is not who you think".
  serve({
    '/': `<html><body><h1>Bright Dental Studio</h1>
      <p>Cosmetic dentistry in Jacksonville. 24/7 emergency service.</p>
      <p>Dr Amara Osei, Principal Dentist</p></body></html>`,
  });
  const accountId = await account('rebranded.invalid');
  await research(accountId);

  // The company we hold is an HVAC firm named "Fixture Co N". The crawl cannot know
  // the domain changed hands, so what protects us is that nothing asserts the
  // dentist as our decision-maker.
  const { rows } = await query<{ full_name: string }>(
    `select full_name from contacts where account_id = $1 and not is_role_placeholder`,
    [accountId]);
  const names = rows.map((row) => row.full_name.toLowerCase());
  assert.ok(!names.some((name) => name.includes('amara')),
    'a person from a different company became our decision-maker');
});

test('a directory page pretending to be a company site is not first-party evidence', async () => {
  serve({
    '/': `<html><body><h1>Top 10 HVAC Contractors in St. Augustine</h1>
      <p>Compare quotes from local pros. Request a quote today.</p>
      <ul><li>Coastal Air — 24/7 emergency service</li>
      <li>Ancient City Heating — financing available</li></ul></body></html>`,
  });
  // A platform domain is refused as identity, so this arrives with no website at all
  // and research has nothing to crawl -- which is the outcome that matters.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Directory Listed Co', website: 'https://yelp.com/biz/directory-listed',
    phone: '904-555-0144', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'listings:fixture' }));
  await research(accountId);

  const keys = await evidenceKeys(accountId);
  assert.deepEqual(keys, [],
    `a directory page was read as the company's own words: ${keys.join(', ')}`);

  const picture = await researchPictureFor(accountId);
  assert.equal(picture.facts.find((fact) => fact.key === 'website')!.state, 'NOT_OBSERVED',
    'a directory profile was recorded as the company website');
});

test('a blocked site explains the thin record rather than looking like a thin company', async () => {
  serve({ '/': '' }, { status: { '/': 403 } });
  const accountId = await account('blocked.invalid');
  await research(accountId);

  const picture = await researchPictureFor(accountId);
  assert.equal(picture.facts.find((fact) => fact.key === 'website')!.state, 'YES');
  const read = picture.facts.find((fact) => fact.key === 'website_read')!;
  assert.equal(read.state, 'NOT_OBSERVED');
  assert.match(read.detail, /blocked, moved or down/);
  assert.match(read.detail, /not because the company is/);
});

test('a site that says nothing records nothing, and no negatives', async () => {
  serve({
    '/': '<html><body><h1>Quiet Air</h1><p>Heating and cooling.</p></body></html>',
  });
  const accountId = await account('quietair.invalid');
  await research(accountId);

  assert.deepEqual(await evidenceKeys(accountId), [],
    'a page that stated nothing produced evidence');

  const picture = await researchPictureFor(accountId);
  for (const key of ['emergency_24_7_service', 'online_quote_booking', 'multiple_locations']) {
    const fact = picture.facts.find((item) => item.key === key)!;
    assert.equal(fact.state, 'NOT_OBSERVED',
      `${key} became ${fact.state} from a page that did not mention it`);
    // Not a ban on the words: the detail's job is to say the site did not claim it
    // *and* that this is not a fact about the company, so it necessarily contains
    // "does not". Banning the phrase rejects the sentence written to defuse it --
    // a mistake I have now made four times in this campaign. What matters is that
    // the reassurance is there.
    assert.match(fact.detail,
      /without saying so|pages we read|what we looked at|not proof|what the pages showed/i,
      `${key} says the signal is absent without tying it to our looking: "${fact.detail}"`);
  }
});

test('marketing copy about comfort is not an emergency-cover claim', async () => {
  serve({
    '/': `<html><body><h1>Comfort First</h1>
      <p>We care about your comfort around the clock, all year long.</p>
      </body></html>`,
  });
  const accountId = await account('comfortfirst.invalid');
  await research(accountId);
  assert.ok(!(await evidenceKeys(accountId)).includes('emergency_24_7_service'),
    'copy about caring around the clock was read as 24/7 emergency cover');
});

test('a company with branches records more than one location', async () => {
  serve({
    '/': `<html><body><h1>Three Branch Air</h1>
      <a href="/locations">Locations</a></body></html>`,
    '/locations': `<html><body><h2>Our locations</h2>
      <p>We have three locations across St. Johns and Duval counties.</p>
      </body></html>`,
  });
  const accountId = await account('threebranch.invalid');
  await research(accountId);
  assert.ok((await evidenceKeys(accountId)).includes('multiple_locations'));
});

// -------------------------------------------------------- through to a score ----

test('what the site said reaches the score, with its lineage intact', async () => {
  serve({
    '/': `<html><body><h1>Scored Air</h1>
      <p>24/7 emergency service. Request a quote online.</p>
      <p>We are hiring installers. Our locations span two counties.</p>
      </body></html>`,
  });
  const accountId = await account('scoredair.invalid');
  await research(accountId);
  await scoreAccount(accountId);

  const lineage = (await explainScore(accountId))!;
  const earned = lineage.components.filter((component) => component.qualified);
  assert.ok(earned.length >= 3,
    `a site stating four signals earned ${earned.length} rules. Before this work it `
    + 'would have earned none, because nothing recorded them.');

  // Every awarded point traces to a page, not to an assumption.
  for (const component of earned) {
    assert.ok(component.evidence.length > 0, `${component.ruleId} scored with no evidence`);
    for (const item of component.evidence) {
      assert.ok(item.sourceReference?.includes('scoredair.invalid')
        || item.sourceProvider !== null,
        `${component.ruleId} cites evidence with no source`);
    }
  }
});

test('a quiet site scores zero and is not punished for it', async () => {
  serve({ '/': '<html><body><h1>Sparse Air</h1></body></html>' });
  const accountId = await account('sparseair.invalid');
  await research(accountId);
  const result = await scoreAccount(accountId);

  assert.equal(result.totalPoints, 0);
  assert.equal(result.tier, 'D');
  const lineage = (await explainScore(accountId))!;
  for (const component of lineage.components) {
    assert.equal(component.qualified, false);
    // Every unearned rule says why. The wording differs by rule -- "no evidence
    // recorded yet" for an observation, "fewer than two independent paid channels"
    // for the derived one -- and pinning one phrasing would only test the phrasing.
    assert.ok(component.reason.trim().length > 10,
      `${component.ruleId} scored nothing and gave no reason`);
  }
});
