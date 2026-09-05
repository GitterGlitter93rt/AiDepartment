import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { scoreAccount } from '../src/scoring/score.js';
import { recognizeSignals } from '../src/scoring/recognize.js';
import { SCORE_RULES, type ScoreRuleId } from '../src/scoring/model.js';
import { resetDatabase } from './helpers.js';

/**
 * The four rules that had no recognizer, and the seven that did.
 * Authority: Issue #3, the Module 4C score recognition policy.
 *
 * Six of eighteen points were unreachable, concentrated in exactly the rules that
 * separate a business that advertises from a business whose operations we can help.
 * An HVAC advertiser with emergency service, a quote form and two locations scored
 * 8 where the policy says 14.
 *
 * The policy fields were in all thirteen profiles the whole time. Nothing read them.
 *
 * The rule these tests hold everywhere: a vertical profile says what matters, and
 * evidence still has to prove this company satisfies it. "HVAC is phone-dependent"
 * never awards a point on its own.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(vertical = 'hvac'): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Recognizer Co ${sequence}`,
    website: `https://recog${sequence}.invalid`,
    phone: `904-555-${String(2000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical,
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

async function evidence(accountId: string, claimKey: string, options: {
  text?: string; value?: string; expiresInHours?: number; confirmed?: boolean;
  contradicted?: boolean;
} = {}): Promise<string> {
  const { rows } = await query<{ evidence_id: string }>(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, expires_at, freshness)
     values ($1, 'operations', $2, $3, $4, $5, $6, 'public_web',
             now() + ($7 || ' hours')::interval, 'fresh')
     returning evidence_id`,
    [
      accountId, claimKey, options.text ?? `${claimKey} observed`,
      options.value ?? 'yes',
      options.confirmed === false ? 'likely' : 'confirmed',
      options.confirmed !== false, String(options.expiresInHours ?? 48),
    ],
  );
  const id = rows[0]!.evidence_id;
  if (options.contradicted) {
    await query(
      `update evidence_records set contradicted_by_evidence_id = evidence_id
        where evidence_id = $1`, [id]);
  }
  return id;
}

function ruleOf(result: Awaited<ReturnType<typeof scoreAccount>>, ruleId: ScoreRuleId) {
  return result.components.find((component) => component.ruleId === ruleId)!;
}

// ------------------------------- the four that had no recognizer at all --------

test('phone dependence needs the vertical AND a call route on this company', async () => {
  const bare = await account('hvac');
  const withoutEvidence = await scoreAccount(bare);
  const rule = ruleOf(withoutEvidence, 'strong_phone_dependence');
  assert.equal(rule.qualified, false,
    'the point was awarded because HVAC is phone-dependent, without looking at the company');
  assert.match(rule.reason, /Having a phone number is not evidence that customers use it/);

  const withCta = await account('hvac');
  await evidence(withCta, 'website_cta', { text: 'Call now for emergency service' });
  const scored = await scoreAccount(withCta);
  assert.equal(ruleOf(scored, 'strong_phone_dependence').qualified, true);
});

test('a vertical that does not run on the phone does not award the point', async () => {
  // general-contractors-remodeling records phone_dependence: medium.
  const accountId = await account('general-contractors-remodeling');
  await evidence(accountId, 'website_cta', { text: 'Call us' });
  const scored = await scoreAccount(accountId);
  const rule = ruleOf(scored, 'strong_phone_dependence');
  assert.equal(rule.qualified, false);
  assert.match(rule.reason, /does not describe the phone as a primary customer path/);
});

test('appointment dependence needs a booking or quote path observed', async () => {
  const bare = await account('hvac');
  assert.equal(
    ruleOf(await scoreAccount(bare), 'appointment_estimate_consultation_intake_heavy').qualified,
    false);

  const withBooking = await account('hvac');
  await evidence(withBooking, 'online_quote_booking', { text: 'Request an estimate' });
  const scored = await scoreAccount(withBooking);
  assert.equal(
    ruleOf(scored, 'appointment_estimate_consultation_intake_heavy').qualified, true);
});

test('high-value economics needs this company to offer the family, not the vertical', async () => {
  const bare = await account('hvac');
  const rule = ruleOf(await scoreAccount(bare), 'high_value_economics_signal');
  assert.equal(rule.qualified, false,
    'every HVAC company was credited with high-value work because the vertical has some');
  assert.match(rule.reason, /Every business sells something; that is not the same thing/);

  const offering = await account('hvac');
  // hvac high_value_service_families includes system_replacement and installation.
  await evidence(offering, 'website_offer', {
    text: 'Full system replacement and heat pump installation, financing available' });
  const scored = await scoreAccount(offering);
  assert.equal(ruleOf(scored, 'high_value_economics_signal').qualified, true);
  assert.equal(ruleOf(scored, 'high_value_economics_signal').pointsAwarded, 2);
});

test('an offer that names nothing high-value does not award the points', async () => {
  const accountId = await account('hvac');
  await evidence(accountId, 'website_offer', { text: 'Free thermostat battery check' });
  assert.equal(
    ruleOf(await scoreAccount(accountId), 'high_value_economics_signal').qualified, false);
});

test('two paid channels are one scale signal, not two', async () => {
  // The distinction the multi-channel bonus exists for is not the same distinction
  // operational complexity asks about. Google paid and Meta paid are two channels
  // and one underlying fact: this company buys advertising.
  const accountId = await account('hvac');
  await evidence(accountId, 'active_google_search_ad');
  await evidence(accountId, 'active_meta_ad');

  const scored = await scoreAccount(accountId);
  assert.equal(ruleOf(scored, 'multiple_paid_channels_confirmed').qualified, true,
    'two channels is exactly what the channel bonus is for');
  assert.equal(ruleOf(scored, 'operationally_important_lead_volume_signal').qualified, false,
    'one underlying fact satisfied a rule that asks for two different kinds of evidence');
  assert.equal(scored.totalPoints, 4 + 3 + 1);
});

test('two different kinds of scale signal do award operational complexity', async () => {
  const accountId = await account('hvac');
  await evidence(accountId, 'active_google_search_ad');
  await evidence(accountId, 'multiple_locations');

  const scored = await scoreAccount(accountId);
  const rule = ruleOf(scored, 'operationally_important_lead_volume_signal');
  assert.equal(rule.qualified, true);
  assert.match(rule.reason, /paid acquisition and more than one location/);
});

// ---------------------------------------------- the business outcomes -----------

async function hvacStrongProspect(): Promise<string> {
  const accountId = await account('hvac');
  await evidence(accountId, 'active_google_search_ad');
  await evidence(accountId, 'active_meta_ad');
  await evidence(accountId, 'emergency_24_7_service');
  await evidence(accountId, 'online_quote_booking', { text: 'Request an estimate' });
  await evidence(accountId, 'multiple_locations');
  await evidence(accountId, 'visible_growth_hiring');
  await evidence(accountId, 'website_offer', {
    text: 'System replacement and installation, financing available' });
  await evidence(accountId, 'website_cta', { text: 'Call now, 24/7 emergency service' });
  return accountId;
}

test('the strong HVAC prospect earns every rule it should, exactly once', async () => {
  const scored = await scoreAccount(await hvacStrongProspect());

  for (const ruleId of [
    'google_paid_search_confirmed', 'meta_active_ads_confirmed',
    'multiple_paid_channels_confirmed', 'emergency_after_hours',
    'prominent_forms_booking_quote_consultation_cta',
    'multiple_locations_or_service_territories', 'visible_growth_hiring',
    'high_value_economics_signal', 'appointment_estimate_consultation_intake_heavy',
    'strong_phone_dependence', 'operationally_important_lead_volume_signal',
  ] as ScoreRuleId[]) {
    assert.equal(ruleOf(scored, ruleId).qualified, true, `${ruleId} did not fire`);
  }

  assert.equal(scored.totalPoints, 18, 'every rule fired and the total is not the maximum');
  assert.equal(scored.tier, 'A');

  // Exactly once: no rule may award more than it is worth.
  for (const component of scored.components) {
    const rule = SCORE_RULES.find((entry) => entry.id === component.ruleId)!;
    assert.equal(component.pointsAwarded, rule.points, component.ruleId);
  }
});

test('an advertiser with nothing behind it ranks below a real operator', async () => {
  const strong = await scoreAccount(await hvacStrongProspect());

  // Confirmed advertising and nothing else known.
  const shell = await account('hvac');
  await evidence(shell, 'active_google_search_ad');
  const shellScore = await scoreAccount(shell);

  assert.ok(shellScore.totalPoints < strong.totalPoints,
    'advertising alone made a shell the best prospect in the market');
  assert.equal(shellScore.totalPoints, 4);
  assert.equal(shellScore.tier, 'C');
});

test('a great company with no ad evidence is not called a non-advertiser', async () => {
  const accountId = await account('hvac');
  await evidence(accountId, 'emergency_24_7_service');
  await evidence(accountId, 'online_quote_booking', { text: 'Book a visit' });
  await evidence(accountId, 'multiple_locations');
  await evidence(accountId, 'visible_growth_hiring');
  await evidence(accountId, 'website_offer', { text: 'System replacement specialists' });
  await evidence(accountId, 'website_cta', { text: 'Call our team' });

  const scored = await scoreAccount(accountId);
  const google = ruleOf(scored, 'google_paid_search_confirmed');
  assert.equal(google.qualified, false);
  assert.match(google.reason, /No active google search ad evidence has been recorded yet/);
  assert.ok(!/does not advertise/i.test(google.reason));

  // Strong operations still rank well without any advertising evidence at all.
  assert.ok(scored.totalPoints >= 6, `scored only ${scored.totalPoints}`);
  assert.ok(['A', 'B'].includes(scored.tier), `tier ${scored.tier}`);
});

test('a stale advertiser is not a current advertiser', async () => {
  const accountId = await account('hvac');
  await evidence(accountId, 'active_google_search_ad', { expiresInHours: -1 });
  const scored = await scoreAccount(accountId);

  const google = ruleOf(scored, 'google_paid_search_confirmed');
  assert.equal(google.qualified, false);
  assert.match(google.reason, /aged out/);
  assert.equal(scored.totalPoints, 0);
});

test('the same placement observed many times scores once', async () => {
  const accountId = await account('hvac');
  for (let index = 0; index < 5; index += 1) {
    await evidence(accountId, 'active_google_search_ad');
  }
  const scored = await scoreAccount(accountId);
  assert.equal(scored.totalPoints, 4, 'five sightings of one ad scored more than once');
  assert.equal(ruleOf(scored, 'google_paid_search_confirmed').evidenceIds.length, 5,
    'and all five are still cited as the evidence behind the four points');
});

test('contradicted evidence stops scoring and says which', async () => {
  const accountId = await account('hvac');
  await evidence(accountId, 'emergency_24_7_service', { contradicted: true });
  const scored = await scoreAccount(accountId);
  const rule = ruleOf(scored, 'emergency_after_hours');
  assert.equal(rule.qualified, false);
  assert.match(rule.reason, /contradicted/);
});

// ------------------------------------------------ the matrix, as an assertion ---

test('every rule in the model has a recognizer that can fire', async () => {
  // The audit found four rules with no recognizer at all. This is the test that
  // would have caught that on the day it was written: build an Account with every
  // supporting fact, and assert nothing is structurally unreachable.
  const scored = await scoreAccount(await hvacStrongProspect());
  const unreachable = scored.components
    .filter((component) => !component.qualified)
    .map((component) => component.ruleId);
  assert.deepEqual(unreachable, [],
    'these rules cannot be earned by any evidence and are dead points');
});

test('every rule explains itself whether it fired or not', async () => {
  const scored = await scoreAccount(await account('hvac'));
  for (const component of scored.components) {
    assert.ok(component.reason.length > 15, `${component.ruleId}: "${component.reason}"`);
    // An absence of evidence is never stated as a fact about the company.
    assert.ok(!/\bdoes not advertise\b|\bis not an advertiser\b/i.test(component.reason),
      `${component.ruleId}: "${component.reason}"`);
  }
});
