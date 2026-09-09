import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles, getVerticalProfile } from '../src/domain/verticals.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { deriveHypotheses, storeHypotheses } from '../src/domain/hypotheses.js';
import { scoreAccount } from '../src/scoring/score.js';
import { buildCallPack } from '../src/callbrain/callPack.js';
import { composeSystemPrompt } from '../src/callbrain/prompt.js';
import { createCallContext, type AvailableTools } from '../src/callbrain/stateMachine.js';
import { resolveObjections } from '../src/callbrain/objections.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';
import { readinessFor } from '../src/domain/repReady.js';

/**
 * Five companies walked from the profile to the words a rep reads.
 *
 * Validators went green before this file existed, and green validators were exactly
 * what the previous sweep had when the account page showed an empty "why reach out"
 * for every real prospect. So this walks the whole chain per vertical -- profile,
 * research facts, signal resolution, hypotheses, score, readiness, call pack, prompt
 * -- and looks at the final object a person would see.
 *
 * What it is looking for is the list of things that had gone wrong before: a hook
 * with no evidence behind it, contradictory hypotheses, generic guidance covering
 * useful vertical guidance, duplicate offers, a raw title lost, UNKNOWN presented as
 * a negative, a market fact presented as a company fact, a category collapsed into
 * other, and labels that read like a schema instead of a sentence.
 */

const TOOLS: AvailableTools = {
  booking: true, suppression: true, followUp: true, transfer: false, sms: false,
  email: true,
};

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

interface Walked {
  accountId: string;
  vertical: string;
  hypotheses: Awaited<ReturnType<typeof deriveHypotheses>>;
  pack: Awaited<ReturnType<typeof buildCallPack>>;
  prompt: string;
  detail: Awaited<ReturnType<typeof getAccountDetail>>;
  picture: Awaited<ReturnType<typeof researchPictureFor>>;
  readiness: Awaited<ReturnType<typeof readinessFor>>;
}

/** One company, taken the whole way through, with the evidence a real crawl leaves. */
async function walk(vertical: string, signalIds: string[]): Promise<Walked> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Walk Fixture ${sequence}`,
    website: `https://walk${sequence}.invalid`,
    phone: `904-555-${String(3100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical,
    contactTitle: vertical === 'law-firms' ? 'Managing Partner' : 'Owner',
    contactName: 'Dana Fielder',
  }, { discoverySource: 'market_miner:dataforseo' }));

  const profile = await getVerticalProfile(vertical);
  const claimFor = new Map<string, string>();
  for (const rule of profile.public_signal_rules ?? []) {
    if (rule?.signal_id && rule?.evidence_claim_key) {
      claimFor.set(rule.signal_id, rule.evidence_claim_key);
    }
  }

  for (const signalId of signalIds) {
    const claimKey = claimFor.get(signalId);
    assert.ok(claimKey, `${vertical} does not declare ${signalId}`);
    await withTransaction((client) => recordEvidence(client, {
      accountId, category: 'walk', claimKey: claimKey!,
      claimText: `Their site says so, observed for the walk of ${vertical}.`,
      normalizedValue: 'yes', confidence: 'confirmed', canStateAsFact: true,
      sourceType: 'first_party',
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    }));
  }

  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '30 days'
      where account_id = $1`, [accountId]);

  const hypotheses = await deriveHypotheses(accountId);
  await storeHypotheses(accountId, hypotheses);
  await scoreAccount(accountId);

  const pack = await buildCallPack(accountId);
  const context = createCallContext(TOOLS, 'after_hours');
  const objections = await resolveObjections({
    verticalProfileId: vertical, genericKeys: ['busy'], said: 'we are busy right now' });
  const prompt = composeSystemPrompt({
    pack: pack!, context, agentName: 'Alex', tools: TOOLS, objections });

  const manager = await makeUser(`Walk Manager ${sequence}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });

  return {
    accountId, vertical, hypotheses, pack, prompt, detail,
    picture: await researchPictureFor(accountId),
    readiness: await readinessFor(accountId),
  };
}

/** The five the assignment names, each with signals its own profile declares. */
const WALKS: { vertical: string; signals: string[] }[] = [
  { vertical: 'roofing', signals: ['active_google_search_ads', 'storm_landing_page'] },
  { vertical: 'hvac', signals: ['active_google_search_ads', 'emergency_24_7'] },
  { vertical: 'law-firms', signals: ['active_google_search_ads', 'explicit_ai_usage_signal'] },
  { vertical: 'collision-repair', signals: ['active_google_search_ads', 'customer_status_language'] },
  // A non-home-service vertical, as required.
  { vertical: 'real-estate-brokerages', signals: ['active_google_search_ads', 'home_value_CTA'] },
];

test('each vertical reaches a rep with a reason to call and something to ask', async () => {
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    assert.ok(walked.hypotheses.length > 0,
      `${entry.vertical}: evidence its own profile declares produced no hypothesis`);
    assert.ok(walked.pack, `${entry.vertical}: no call pack`);
    assert.ok(walked.pack!.primaryHypothesis,
      `${entry.vertical}: the pack has no reason to call`);
    assert.ok(walked.pack!.firstQuestion,
      `${entry.vertical}: a reason to call and nothing to open with`);
    assert.ok(walked.detail!.hypotheses.length > 0,
      `${entry.vertical}: the account page shows no Why reach out`);
  }
});

test('every hypothesis a rep sees has evidence behind it', async () => {
  // The defect this looks for: a hook presented as a reason with nothing observed
  // under it, which is how a rep ends up asserting something on a call.
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    for (const hypothesis of walked.hypotheses) {
      assert.ok(hypothesis.supportingEvidenceIds.length > 0,
        `${entry.vertical}/${hypothesis.hypothesisId} has no evidence behind it`);
      assert.ok(hypothesis.matchedSignals.length > 0,
        `${entry.vertical}/${hypothesis.hypothesisId} matched no declared signal`);
      const { rows } = await query<{ n: number }>(
        `select count(*)::int as n from evidence_records
          where evidence_id = any($1::uuid[]) and account_id = $2`,
        [hypothesis.supportingEvidenceIds, walked.accountId]);
      assert.equal(rows[0]!.n, hypothesis.supportingEvidenceIds.length,
        'a hypothesis cites evidence belonging to a different company');
    }
  }
});

test('no category collapses into other on the way to a rep', async () => {
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    const { rows } = await query<{ category: string; source_category: string }>(
      `select category, source_category from opportunity_hypotheses
        where account_id = $1 and is_current and generated_by = 'deterministic'`,
      [walked.accountId]);
    for (const row of rows) {
      assert.notEqual(row.category, 'other',
        `${entry.vertical}: a ${row.source_category} problem was stored as other`);
    }
  }
});

test('a raw job title is never lost, whatever it was classified as', async () => {
  const walked = await walk('law-firms', ['active_google_search_ads']);
  const { rows } = await query<{
    raw_title: string | null; role_category: string;
    normalized_title: string | null; role_classified_by: string | null;
  }>(
    `select raw_title, role_category, normalized_title, role_classified_by
       from contacts where account_id = $1`, [walked.accountId]);
  assert.ok(rows.length > 0, 'no contact was written');
  const partner = rows.find((row) => row.raw_title === 'Managing Partner');
  assert.ok(partner, 'the raw title a source gave was rewritten or dropped');
  assert.equal(partner!.role_category, 'owner',
    'a managing partner still falls through to unknown');
  assert.equal(partner!.role_classified_by, 'PROFILE_ROLE_TITLE');
  assert.ok(partner!.normalized_title, 'the profile’s own wording was not kept');
});

test('unknown is never shown to a rep as a negative', async () => {
  // Meta advertising has no source. It must read as not known, never as "they do not
  // advertise on Meta", on any surface.
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    const surfaces = [
      JSON.stringify(walked.picture), JSON.stringify(walked.detail), walked.prompt,
    ].join('\n');
    assert.doesNotMatch(surfaces, /does not advertise/i,
      `${entry.vertical}: a surface states that a company does not advertise`);
    assert.doesNotMatch(surfaces, /no meta ads?\b/i,
      `${entry.vertical}: absence of a Meta source was rendered as absence of ads`);
    for (const fact of walked.picture.facts) {
      if (!fact.key.startsWith('advertising_')) continue;
      if (fact.state === 'YES') continue;
      assert.notEqual(fact.state, 'NO',
        `${entry.vertical}/${fact.key} asserts a confirmed absence`);
    }
  }
});

test('a market fact is never presented as a company fact', async () => {
  // Roofing declares a storm market condition. It is about the place, and the walk
  // gives the company only its own storm page.
  const walked = await walk('roofing', ['storm_landing_page']);
  const surfaces = [walked.prompt, JSON.stringify(walked.detail)].join('\n');
  assert.doesNotMatch(surfaces, /storm_hail_market_signal|storm_market_signal/,
    'a market signal id leaked onto a rep-facing surface');
  // The company-level claim is allowed, because their own site says it.
  const stormFact = walked.hypotheses
    .some((hypothesis) => hypothesis.matchedSignals.includes('storm_landing_page'));
  assert.ok(stormFact, 'the company’s own storm page did not trigger anything');
});

test('vertical objection guidance is not covered by the generic engine', async () => {
  const walked = await walk('roofing', ['active_google_search_ads']);
  const objections = await resolveObjections({
    verticalProfileId: 'roofing', genericKeys: ['marketing_agency'],
    said: 'we have an agency' });
  const marketing = objections.filter((entry) => entry.intent === 'marketing_agency');
  assert.equal(marketing.length, 1, 'two answers for one objection reached the agent');
  assert.equal(marketing[0]!.origin, 'VERTICAL_OVERRIDE');

  const prompt = composeSystemPrompt({
    pack: walked.pack!, context: createCallContext(TOOLS, 'after_hours'),
    agentName: 'Alex', tools: TOOLS, objections });
  assert.match(prompt, /## If they push back/);
  assert.match(prompt, /roofing guidance/,
    'the prompt does not say which layer the answer came from');
});

test('no offer is presented twice', async () => {
  const { offersForHypothesis } = await import('../src/domain/offerCatalog.js');
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    for (const hypothesis of walked.hypotheses) {
      const offers = await offersForHypothesis({
        verticalProfileId: entry.vertical, hypothesisId: hypothesis.hypothesisId });
      const ids = offers.map((offer) => offer.offerId);
      assert.equal(new Set(ids).size, ids.length,
        `${entry.vertical}/${hypothesis.hypothesisId} offers ${ids.join(', ')}`);
    }
  }
});

test('the words on a rep-facing surface are words, not schema', async () => {
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    // A claim key or a signal id appearing in prose is an engineer's label reaching a
    // rep. Titles and ids inside data attributes are fine; sentences are not.
    for (const fact of walked.picture.facts) {
      assert.doesNotMatch(fact.detail, /_[a-z]+_/,
        `${entry.vertical}: "${fact.detail.slice(0, 60)}" reads like a column name`);
    }
    for (const hypothesis of walked.hypotheses) {
      assert.doesNotMatch(hypothesis.text, /_[a-z]+_/,
        `${entry.vertical}: a hypothesis sentence carries a schema word`);
    }
  }
});

test('readiness and score survive the whole walk', async () => {
  for (const entry of WALKS) {
    const walked = await walk(entry.vertical, entry.signals);
    assert.ok(walked.readiness, `${entry.vertical}: readiness could not be computed`);
    assert.ok(['REP_READY', 'RESEARCH_NEEDED', 'NOT_WORKABLE'].includes(
      walked.readiness!.state), `${entry.vertical}: readiness is not a known state`);
    const { rows } = await query<{ tier: string | null; version: string | null }>(
      `select manual_tier as tier, score_version as version from accounts
        where account_id = $1`, [walked.accountId]);
    assert.ok(rows[0]!.tier, `${entry.vertical}: the walk produced no tier`);
    assert.ok(rows[0]!.version, `${entry.vertical}: a score with no policy version`);
  }
});
