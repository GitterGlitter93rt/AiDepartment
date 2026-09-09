import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { recognisedClaimKeys, profileTermClaimKeys } from '../src/resolver/signals.js';
import { promotedAdClaimKeys, EVIDENCE_TTL_HOURS } from '../src/workers/marketMiner.js';
import { allSignals, isCollectable } from '../src/domain/signalRegistry.js';

/**
 * Every signal a profile declares has something that can write it.
 *
 * This is the guard for the defect family that ran through this whole campaign, and
 * whose largest instance was found by opening a page rather than by reading code:
 * the canonical profiles declare `evidence_claim_key` plus a
 * `score_rule_reference`, the scorer looks that key up in `evidence_records`, and
 * for six of the thirteen declared keys nothing in the product ever wrote one. The
 * signal that distinguishes a vertical from every other vertical was the one signal
 * it could never earn.
 *
 * Both directions fail here. Declaring a signal with no writer fails, and so does
 * keeping an excuse for a key that now has one.
 */

/**
 * Declared, with no source, and why -- reviewed rather than assumed.
 *
 * Anything on this list is a real gap that a person decided to leave open. It is not
 * a suppression list: the point is that the gaps are named, counted and visible.
 */
const NO_SOURCE_YET: Record<string, string> = {
  active_meta_ad:
    'No Meta source exists. A SERP search cannot observe a Meta ad, so the +3 Meta '
    + 'rule cannot fire until an ad-library source is built. Not a defect in the '
    + 'writer -- there is nothing to write from.',
  storm_hail_market_signal:
    'Ambiguous source, deliberately not guessed. The key says market and the '
    + 'roofing profile says storm surges create lead-volume pressure, which could '
    + 'mean a weather/market source or the company advertising storm work. Those '
    + 'are different claims about different subjects and picking one here would be '
    + 'inventing the semantics. Needs a product decision.',
};

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });

/**
 * Keys anything in the product can write.
 *
 * Asked of the canonical registry, which is the one place that knows every producer.
 * This used to be assembled from two writer maps here, and it therefore could not
 * see a producer it had not been told about -- it called two profile-term signals
 * sourceless the moment they gained one.
 */
function writableClaimKeys(): Set<string> {
  return new Set(allSignals()
    .filter((signal) => isCollectable(signal.id))
    .map((signal) => signal.id));
}

async function declaredClaimKeys(): Promise<Map<string, string[]>> {
  const { rows } = await query<{ vertical_profile_id: string; definition: any }>(
    'select vertical_profile_id, definition from vertical_profiles where is_active');
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const profile = row.definition?.profile ?? row.definition ?? {};
    const signals = profile.public_signal_rules ?? [];
    for (const signal of signals) {
      const key = signal?.evidence_claim_key;
      if (typeof key !== 'string' || !key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), row.vertical_profile_id]);
    }
  }
  return byKey;
}

test('the profiles and the writers agree on what can be known', async () => {
  const declared = await declaredClaimKeys();
  assert.ok(declared.size >= 10,
    `only ${declared.size} claim keys were read from the profiles, so this test is `
    + 'asserting almost nothing');

  const writable = writableClaimKeys();
  const orphans = [...declared.keys()]
    .filter((key) => !writable.has(key) && !(key in NO_SOURCE_YET));

  assert.deepEqual(orphans, [],
    'these claim keys are declared by a vertical profile, with a score rule that '
    + 'reads them, and nothing in the product can write one: '
    + orphans.map((key) => `${key} (${declared.get(key)!.join(', ')})`).join('; ')
    + '. Either give it a writer or add it to NO_SOURCE_YET with the reason.');
});

test('an excuse outlives its reason and has to be removed', async () => {
  const writable = writableClaimKeys();
  for (const key of Object.keys(NO_SOURCE_YET)) {
    assert.ok(!writable.has(key),
      `${key} is on NO_SOURCE_YET and something writes it now. Delete the excuse.`);
  }
  const declared = await declaredClaimKeys();
  for (const key of Object.keys(NO_SOURCE_YET)) {
    assert.ok(declared.has(key),
      `${key} is excused and no profile declares it any more. Delete the excuse.`);
  }
});

test('the gaps that remain are named, not merely absent', () => {
  // The value of this file is that a gap is a sentence somebody wrote, not a
  // difference somebody would have to notice.
  for (const [key, reason] of Object.entries(NO_SOURCE_YET)) {
    assert.ok(reason.length > 80, `${key} has an excuse too short to be a reason`);
  }
});

test('every writable claim has a freshness window', () => {
  // A claim with no §14 entry falls back to a conservative default, which is fine --
  // but the ad claims are the ones a rep says "currently" about, and those must be
  // the matrix's own numbers rather than the default.
  for (const key of promotedAdClaimKeys()) {
    assert.equal(EVIDENCE_TTL_HOURS[key], 48,
      `${key} is what a rep calls current advertising, and its window is not 48h`);
  }
});

test('the four signals added for their verticals are readable there', async () => {
  const declared = await declaredClaimKeys();
  const added = ['hail_repair_service', 'high_value_plumbing_services',
    'open_house_listing_signal', 'field_sales_presence'];
  for (const key of added) {
    assert.ok(declared.has(key), `${key} is no longer declared by any profile`);
    assert.ok(recognisedClaimKeys().includes(key), `${key} lost its recogniser`);
  }
});
