import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles, getVerticalProfile } from '../src/domain/verticals.js';
import { planSearchQueries, searchQueriesFor } from '../src/miner/searchTaxonomy.js';
import { signalRulesFor } from '../src/scoring/recognize.js';
import { normalizeGeography } from '../src/miner/geography.js';
import { providerTargetFor } from '../src/miner/providerLocation.js';
import { resetDatabase } from './helpers.js';

/**
 * Every vertical, not just the one we developed against.
 * Authority: Issue #3.
 *
 * HVAC working proves HVAC works. The miner reads five different parts of a vertical
 * profile -- the search taxonomy, the signal-to-score map, and three business-model
 * fields -- and a profile missing any of them fails quietly: no queries to run, or a
 * scoring rule that can never fire for that industry.
 *
 * This is the test that fails loudly when a fourteenth vertical is added without the
 * policy the runtime needs.
 */

let verticals: string[] = [];

before(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const { rows } = await query<{ vertical_profile_id: string }>(
    'select vertical_profile_id from vertical_profiles where is_active order by 1');
  verticals = rows.map((row) => row.vertical_profile_id);
});
after(async () => { await pool.end(); });

const STRONG_DEPENDENCE = ['high', 'very_high', 'medium_high', 'critical', 'medium', 'low'];

test('every vertical profile loads', async () => {
  assert.ok(verticals.length >= 13, `only ${verticals.length} verticals synced`);
  for (const vertical of verticals) {
    const definition = await getVerticalProfile(vertical);
    assert.ok(definition, `${vertical} does not load`);
  }
});

test('every vertical can plan a provider search', async () => {
  const broken: string[] = [];
  for (const vertical of verticals) {
    const queries = await searchQueriesFor(vertical);
    if (queries.length === 0) { broken.push(`${vertical}: no search taxonomy`); continue; }

    const planned = await planSearchQueries({
      verticalProfileId: vertical, strategy: 'ADVERTISER_FIRST', budget: 3 });
    if (planned.length === 0) { broken.push(`${vertical}: nothing planned`); continue; }

    // The words a customer would use, not our identifiers.
    for (const entry of planned) {
      if (entry.query.includes('_')) broken.push(`${vertical}: "${entry.query}" looks like an id`);
      if (entry.query === vertical) broken.push(`${vertical}: the query is the vertical id`);
      if (/advertiser_first|broad_local/.test(entry.query)) {
        broken.push(`${vertical}: the strategy leaked into the query`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('every vertical produces a usable provider payload', async () => {
  const geography = normalizeGeography('city', 'Jacksonville, FL');
  assert.ok(geography.ok);
  const target = await providerTargetFor(geography);

  const broken: string[] = [];
  for (const vertical of verticals) {
    const planned = await planSearchQueries({
      verticalProfileId: vertical, strategy: 'ADVERTISER_FIRST', budget: 1 });
    const keyword = [planned[0]?.query, target.keywordSuffix].filter(Boolean).join(' ');
    if (!keyword.trim()) broken.push(`${vertical}: empty keyword`);
    if (keyword.length > 120) broken.push(`${vertical}: keyword is ${keyword.length} chars`);
    if (!target.locationName.includes('United States')) {
      broken.push(`${vertical}: location "${target.locationName}"`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every vertical maps at least one signal to a score rule', async () => {
  const broken: string[] = [];
  for (const vertical of verticals) {
    const rules = await signalRulesFor(vertical);
    if (rules.length === 0) { broken.push(`${vertical}: no signal maps to a score rule`); continue; }
    // Google paid is the largest single rule; a vertical that cannot recognise it
    // loses four of eighteen points for every company in it.
    if (!rules.some((rule) => rule.ruleId === 'google_paid_search_confirmed')) {
      broken.push(`${vertical}: no google paid recognizer`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every vertical carries the business-model policy scoring reads', async () => {
  // These four fields drive the recognizers that had none until now. A vertical
  // added without them scores at most twelve of eighteen and nobody would notice.
  const broken: string[] = [];
  for (const vertical of verticals) {
    const definition = await getVerticalProfile(vertical) as Record<string, unknown>;
    const model = (definition?.['business_model'] ?? {}) as Record<string, unknown>;

    for (const field of ['phone_dependence', 'appointment_dependence',
      'estimate_proposal_dependence'] as const) {
      const value = String(model[field] ?? '');
      if (!value) { broken.push(`${vertical}: ${field} missing`); continue; }
      if (!STRONG_DEPENDENCE.includes(value)) {
        broken.push(`${vertical}: ${field} is "${value}", which the recognizer does not know`);
      }
    }

    const families = model['high_value_service_families'];
    if (!Array.isArray(families) || families.length === 0) {
      broken.push(`${vertical}: no high_value_service_families`);
    }
    const leadTypes = model['lead_types'];
    if (!Array.isArray(leadTypes) || leadTypes.length === 0) {
      broken.push(`${vertical}: no lead_types`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every vertical can reach a meaningful score, not just a token one', async () => {
  // A profile can be structurally valid and still leave most of the scale unreachable.
  // The rules a vertical can recognise decide the ceiling for every company in it.
  const thin: string[] = [];
  for (const vertical of verticals) {
    const rules = await signalRulesFor(vertical);
    const definition = await getVerticalProfile(vertical) as Record<string, unknown>;
    const model = (definition?.['business_model'] ?? {}) as Record<string, unknown>;

    const claimReachable = new Set(rules.map((rule) => rule.ruleId));
    // The profile-driven four are reachable when the business model asserts them.
    const strong = (value: unknown): boolean =>
      ['high', 'very_high', 'medium_high', 'critical'].includes(String(value ?? ''));
    if (strong(model['phone_dependence'])) claimReachable.add('strong_phone_dependence');
    if (strong(model['appointment_dependence']) || strong(model['estimate_proposal_dependence'])) {
      claimReachable.add('appointment_estimate_consultation_intake_heavy');
    }
    if (Array.isArray(model['high_value_service_families'])) {
      claimReachable.add('high_value_economics_signal');
    }
    if (Array.isArray(model['lead_types'])) {
      claimReachable.add('operationally_important_lead_volume_signal');
    }

    const POINTS: Record<string, number> = {
      google_paid_search_confirmed: 4, meta_active_ads_confirmed: 3,
      high_value_economics_signal: 2, operationally_important_lead_volume_signal: 2,
      emergency_after_hours: 1, appointment_estimate_consultation_intake_heavy: 1,
      multiple_locations_or_service_territories: 1, visible_growth_hiring: 1,
      strong_phone_dependence: 1, prominent_forms_booking_quote_consultation_cta: 1,
    };
    const ceiling = [...claimReachable]
      .reduce((total, ruleId) => total + (POINTS[ruleId] ?? 0), 0)
      // The multi-channel bonus is reachable only where both channels are.
      + (claimReachable.has('google_paid_search_confirmed')
        && claimReachable.has('meta_active_ads_confirmed') ? 1 : 0);

    // Tier A starts at 9. A vertical that cannot reach it has no best prospects.
    if (ceiling < 9) thin.push(`${vertical}: ceiling ${ceiling} of 18, cannot reach Tier A`);
  }
  assert.deepEqual(thin, []);
});
