import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles, getVerticalProfile } from '../src/domain/verticals.js';
import {
  validateProfiles, renderViolations, BLOCKING, resolveTrigger,
} from '../src/domain/profileContract.js';
import {
  allSignals, isKnownSignal, isCollectable, signalFor, signalsRequiringCapability,
  nearestSignalNames, UNAVAILABLE_MEANS,
} from '../src/domain/signalRegistry.js';
import { resolvePrimaryHookOrder, familiesByPriority } from '../src/domain/hooks.js';
import { declaredRoles, classifyRole } from '../src/domain/roles.js';
import { allOffers, offerFor, isKnownOffer, resolveOfferMapping } from '../src/domain/offerCatalog.js';
import { resolveObjections, verticalObjections, genericIntentFor } from '../src/callbrain/objections.js';

/**
 * The profiles and the runtime speaking one language.
 *
 * The sweep before this file found configuration that was syntactically valid and
 * semantically disconnected: triggers naming signals nobody defined, roles that fell
 * to `unknown` because two vocabularies drifted, a vertical's objection guidance read
 * by nothing, two fields ordering the same list, and four hypothesis categories
 * collapsing into `other`. Every one passed every check we had, because every check
 * we had was about shape.
 *
 * These are about meaning. The distinction they exist to protect: an unknown
 * reference is a typo and a known reference with no source is a purchase. Collapsing
 * those two is how twenty-seven document defects hid behind two missing data feeds.
 */

let profiles: { vertical_profile_id: string; definition: any }[] = [];

before(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const { rows } = await query<{ vertical_profile_id: string; definition: any }>(
    'select vertical_profile_id, definition from vertical_profiles where is_active order by 1');
  profiles = rows;
  assert.ok(profiles.length >= 13, `only ${profiles.length} active profiles`);
});
after(async () => { await pool.end(); });

const profileOf = (row: { definition: any }): any => row.definition?.profile ?? row.definition;

// ------------------------------------------------------------------ profiles ----

test('every active profile passes the contract', async () => {
  const violations = await validateProfiles();
  const blocking = violations.filter((violation) => BLOCKING.has(violation.kind));
  assert.deepEqual(blocking, [],
    'a profile says something the runtime cannot act on:\n' + renderViolations(blocking));
});

test('no dangling executable trigger remains, and one more would fail', async () => {
  // Pinned at zero, not at "no worse than before". Thirty-seven occurrences across
  // twenty-seven names were repaired; the next one is a failure, not a statistic.
  const violations = await validateProfiles();
  const dangling = violations.filter((violation) => violation.kind === 'UNKNOWN_SIGNAL');
  assert.equal(dangling.length, 0,
    'these triggers name signals nothing defines:\n'
    + dangling.map((v) => `  ${v.vertical} ${v.path} -> ${v.reference}`).join('\n'));
});

test('an invented trigger is caught, and its diagnosis is a typo not a purchase', () => {
  // The two kinds must stay distinguishable: one is fixed by editing a document, the
  // other by buying a data source.
  assert.equal(isKnownSignal('definitely_not_a_signal'), false);
  const declared = new Map<string, string>();
  assert.equal(resolveTrigger('definitely_not_a_signal', declared).claimKey, null);

  // A known signal with no source resolves; it is simply not collectable.
  assert.equal(resolveTrigger('active_meta_ad', declared).claimKey, 'active_meta_ad');
  assert.equal(isCollectable('active_meta_ad'), false);
  assert.equal(isKnownSignal('active_meta_ad'), true);
});

test('the suggestions are diagnostics, and never applied', () => {
  const near = nearestSignalNames('multi_location_signal');
  assert.ok(near.includes('multiple_locations'),
    'the nearest-name diagnostic is not useful enough to print');
  // And the resolver does not act on it: a name that resembles a signal is not one.
  assert.equal(resolveTrigger('multi_location_signal', new Map()).claimKey, null);
});

// ------------------------------------------------------------------- signals ----

test('every canonical signal declares whose fact it is and what it can be', () => {
  for (const signal of allSignals()) {
    assert.ok(signal.subject, `${signal.id} has no subject`);
    assert.ok(signal.valueType, `${signal.id} has no value type`);
    assert.ok(signal.states.length > 0, `${signal.id} declares no states`);
    assert.ok(signal.description.length > 40,
      `${signal.id} has a description too short to defend a claim with`);
    assert.ok(signal.consumers.length > 0,
      `${signal.id} has no consumers, so removing it would look free`);
  }
});

test('every signal has a producer or an honest reason it has none', () => {
  for (const signal of allSignals()) {
    const hasProducer = signal.producers.length > 0;
    const hasCapability = signal.requiredCapability !== null;
    assert.ok(hasProducer || hasCapability,
      `${signal.id} declares neither a producer nor a missing capability, so nothing `
      + 'explains why no evidence for it ever appears');
    assert.ok(!(hasProducer && hasCapability),
      `${signal.id} claims both a producer and a missing capability, which cannot `
      + 'both be true');
  }
});

test('a signal with no source is never allowed to be false', () => {
  // The rule the whole epistemic model rests on. We can prove a company advertises;
  // we cannot prove it does not, and least of all when we have never looked.
  assert.equal(UNAVAILABLE_MEANS, 'UNKNOWN');
  for (const signal of signalsRequiringCapability()) {
    assert.ok(!signal.states.includes('NO'),
      `${signal.id} cannot be collected and lists NO as a state, which would let `
      + '"we have no source" render as "they do not"');
    assert.ok(!signal.states.includes('NOT_OBSERVED'),
      `${signal.id} lists NOT_OBSERVED, which claims we looked and did not see it`);
    assert.ok(signal.states.includes('UNKNOWN'), `${signal.id} cannot say it is unknown`);
  }
});

test('a company trigger cannot consume market evidence', async () => {
  // The specific confusion this separation exists to prevent: hail falling in a ZIP
  // is not evidence that a particular roofer advertises hail work.
  const market = signalFor('storm_hail_market_signal')!;
  assert.equal(market.subject, 'MARKET');
  const company = signalFor('storm_hail_service_promoted')!;
  assert.equal(company.subject, 'COMPANY');

  const violations = await validateProfiles();
  const mismatches = violations.filter((violation) => violation.kind === 'SUBJECT_MISMATCH');
  assert.deepEqual(mismatches, [],
    'a hypothesis trigger points at a fact about a place, or a market condition at a '
    + 'fact about a company:\n' + renderViolations(mismatches));
});

test('the market signal is declared where a market condition belongs', async () => {
  // Not deleted: roofing genuinely means that storm surges matter. Moved to a field
  // whose subject rule is the opposite one, so it can never be read as a company fact.
  const roofing = await getVerticalProfile('roofing');
  const storm = (roofing.leak_hypotheses as any[])
    .find((entry) => entry.hypothesis_id === 'storm_surge_capacity');
  assert.ok(storm, 'the roofing storm hypothesis is gone');
  assert.deepEqual(storm.market_condition_signals, ['storm_market_signal']);
  assert.ok(!(storm.trigger_signals ?? []).includes('storm_market_signal'),
    'the market signal is still a company trigger');
  // And the company half is still triggered, so the hypothesis still works.
  assert.ok((storm.trigger_signals ?? []).includes('storm_landing_page'));
});

test('ordinary roofing discovery needs no storm evidence', async () => {
  // Storm activity must not become a prerequisite for finding or ranking a roofer.
  const roofing = await getVerticalProfile('roofing');
  const stormTriggered = (roofing.leak_hypotheses as any[])
    .filter((entry) => (entry.trigger_signals ?? [])
      .some((trigger: string) => /storm|hail/.test(trigger)));
  const all = (roofing.leak_hypotheses as any[]).length;
  assert.ok(stormTriggered.length < all,
    'every roofing hypothesis needs storm evidence, so a quiet season would empty '
    + 'the pipeline');
  const taxonomy = roofing.search_taxonomy;
  assert.ok(taxonomy, 'roofing has no search taxonomy to discover with');
});

// --------------------------------------------------------------------- roles ----

test('every declared decision-maker role files under a canonical category', () => {
  const canonical = new Set(['owner', 'founder', 'president', 'ceo', 'general_manager',
    'operations', 'service_manager', 'marketing', 'sales', 'office_manager', 'intake',
    'administrator', 'registered_agent', 'license_qualifier', 'unknown']);
  let checked = 0;
  for (const row of profiles) {
    for (const role of declaredRoles(profileOf(row))) {
      assert.ok(role.canonical,
        `${row.vertical_profile_id} declares ${role.profileRoleCategory} with no `
        + 'canonical_role_category, so every contact it matches becomes unknown for a '
        + 'reason that is not about the evidence');
      assert.ok(canonical.has(role.canonical),
        `${row.vertical_profile_id}/${role.profileRoleCategory} maps to `
        + `"${role.canonical}", which is not a runtime category`);
      checked += 1;
    }
  }
  assert.ok(checked >= 60, `only ${checked} roles checked`);
});

test('a vertical-specific title classifies instead of falling through', async () => {
  for (const [title, vertical, expected] of [
    ['Managing Partner', 'law-firms', 'owner'],
    ['Managing Broker', 'real-estate-brokerages', 'owner'],
    ['Canvassing Manager', 'pdr-hail', 'sales'],
    ['Practice Administrator', 'dental', 'administrator'],
  ] as const) {
    const role = await classifyRole({ rawTitle: title, verticalProfileId: vertical });
    assert.equal(role.canonicalRoleCategory, expected,
      `"${title}" in ${vertical} still falls through to ${role.canonicalRoleCategory}`);
    assert.equal(role.classifiedBy, 'PROFILE_ROLE_TITLE');
    // The words a rep reads are the words the source used.
    assert.equal(role.rawTitle, title, 'the raw title was rewritten');
    assert.ok(role.normalizedTitle, 'the profile’s own wording was not kept');
    assert.ok(role.reason.length > 30, 'the classification cannot be checked');
  }
});

test('unknown stays valid when the evidence really is insufficient', async () => {
  const role = await classifyRole({
    rawTitle: 'Chief Vibes Officer', verticalProfileId: 'roofing' });
  assert.equal(role.canonicalRoleCategory, 'unknown');
  assert.equal(role.classifiedBy, 'INSUFFICIENT_EVIDENCE');
  assert.equal(role.rawTitle, 'Chief Vibes Officer',
    'a title nobody recognised was still preserved exactly');

  const none = await classifyRole({ rawTitle: null, verticalProfileId: 'roofing' });
  assert.equal(none.canonicalRoleCategory, 'unknown');
  assert.equal(none.classifiedBy, 'INSUFFICIENT_EVIDENCE');
});

// --------------------------------------------------------------------- hooks ----

test('every vertical produces exactly one deterministic primary hook order', async () => {
  for (const row of profiles) {
    const profile = profileOf(row);
    const order = resolvePrimaryHookOrder(row.vertical_profile_id, profile);
    assert.equal(order.disagreement, null,
      `${row.vertical_profile_id} has two authorities for one order: `
      + JSON.stringify(order.disagreement));
    // Deterministic: the same input twice gives the same list.
    const again = resolvePrimaryHookOrder(row.vertical_profile_id, profile);
    assert.deepEqual(again.families, order.families);
    if (order.families.length > 0) {
      assert.notEqual(order.source, 'NONE');
      assert.equal(new Set(order.families).size, order.families.length,
        `${row.vertical_profile_id} lists a hook family twice`);
    }
  }
});

test('base_priority means higher-is-more-important, which is what the profiles say', async () => {
  // The direction matters: read the other way, the generator put the weakest reason
  // to call at the top of a rep's screen.
  const roofing = await getVerticalProfile('roofing');
  const families = familiesByPriority(roofing);
  assert.equal(families[0], 'unsold_proposal_follow_up',
    'the highest base_priority is no longer read as the most important hook');
  const order = resolvePrimaryHookOrder('roofing', roofing);
  assert.deepEqual(order.families, families,
    'the explicit order and the priority numbers disagree, which is the dual '
    + 'authority this is meant to have ended');
});

test('hook priorities no longer order hypotheses', async () => {
  // One field, one job. Hypothesis order is the author's sequence; hook order is
  // hooks. Asserted on the source so the two cannot quietly merge again.
  const { readFileSync } = await import('node:fs');
  const generator = readFileSync('src/domain/hypotheses.ts', 'utf8');
  assert.ok(!/hook_priorities/.test(generator.replace(/\/\/[^\n]*/g, '')),
    'the hypothesis generator reads hook_priorities again');
  const hooks = readFileSync('src/domain/hooks.ts', 'utf8');
  assert.match(hooks, /hook_priorities/, 'the hook resolver stopped reading them');
});

// ---------------------------------------------------------------- objections ----

test('generic guidance works on its own', async () => {
  const effective = await resolveObjections({
    verticalProfileId: 'hvac', genericKeys: ['chatgpt'], said: 'we already use chatgpt' });
  assert.equal(effective.length, 1);
  assert.equal(effective[0]!.origin, 'GENERIC_CORE');
  assert.match(effective[0]!.response, /not selling access to ChatGPT/);
});

test('a vertical answer to the same objection wins, and only one is presented', async () => {
  const effective = await resolveObjections({
    verticalProfileId: 'hvac', genericKeys: ['receptionist'],
    said: 'we have an answering service' });
  const receptionist = effective.filter((entry) => entry.intent === 'receptionist');
  assert.equal(receptionist.length, 1,
    'two answers to one objection were presented, so the agent argues with itself');
  assert.equal(receptionist[0]!.origin, 'VERTICAL_OVERRIDE');
  assert.match(receptionist[0]!.provenance, /replacing the generic answer/);
});

test('a vertical objection with no generic equivalent is added, not substituted', async () => {
  const effective = await resolveObjections({
    verticalProfileId: 'roofing', genericKeys: ['busy', 'chatgpt'],
    said: 'storm leads are different' });
  const intents = effective.map((entry) => entry.intent);
  assert.ok(intents.includes('storm_leads_are_different'));
  // Unrelated generic guidance survives.
  assert.ok(intents.includes('busy') && intents.includes('chatgpt'),
    'a vertical addition removed generic answers it had nothing to do with');
});

test('one effective answer per objection, always', async () => {
  const effective = await resolveObjections({
    verticalProfileId: 'plumbing',
    genericKeys: ['receptionist', 'crm', 'busy'],
    said: 'we have an answering service and existing field service software' });
  const intents = effective.map((entry) => entry.intent);
  assert.equal(new Set(intents).size, intents.length,
    `an objection was answered twice: ${intents.join(', ')}`);
  for (const entry of effective) {
    assert.ok(entry.response.length > 0, `${entry.intent} resolved to no answer`);
    assert.ok(entry.provenance.length > 0, `${entry.intent} has no provenance`);
  }
});

test('no vertical objection is silently ignored', () => {
  // Every declared objection must be reachable: it needs phrases to match on and an
  // answer to give, or it is configuration that can never fire.
  let checked = 0;
  for (const row of profiles) {
    for (const objection of verticalObjections(profileOf(row))) {
      assert.ok(objection.matchPhrases.length > 0,
        `${row.vertical_profile_id}/${objection.objectionId} declares no match `
        + 'phrases, so nothing a prospect says can ever raise it');
      assert.ok(objection.response.length > 0,
        `${row.vertical_profile_id}/${objection.objectionId} has no response`);
      checked += 1;
    }
  }
  assert.ok(checked >= 30, `only ${checked} vertical objections found`);
});

test('an override names a generic objection that exists', () => {
  for (const row of profiles) {
    for (const objection of verticalObjections(profileOf(row))) {
      if (!objection.overrides) continue;
      assert.ok(genericIntentFor(objection),
        `${row.vertical_profile_id}/${objection.objectionId} overrides `
        + `"${objection.overrides}", which the generic engine does not have`);
    }
  }
});

// -------------------------------------------------------------------- offers ----

test('every offer a profile names is one we can actually sell', async () => {
  const violations = await validateProfiles();
  const unknown = violations.filter((violation) => violation.kind === 'UNKNOWN_OFFER');
  assert.deepEqual(unknown, [],
    'a profile recommends something that is not in the catalog:\n'
    + renderViolations(unknown));
});

test('the catalog is authoritative for what an offer is, and says where it is documented', () => {
  for (const offer of allOffers()) {
    assert.ok(offer.description.length > 20, `${offer.id} is not described`);
    assert.ok(offer.documentedIn.length > 0,
      `${offer.id} traces to no document, so nothing checks that we sell it`);
    if (offer.kind === 'CAPABILITY') {
      assert.ok(offer.deliveredWithin.length > 0,
        `${offer.id} is a capability with no product that delivers it, which would `
        + 'make it look sellable on its own');
      for (const product of offer.deliveredWithin) {
        assert.equal(offerFor(product)?.kind, 'PRODUCT',
          `${offer.id} is delivered within ${product}, which is not a product`);
      }
    }
  }
});

test('a spelling variant resolves to the same offer, and a different name does not', () => {
  assert.equal(offerFor('AI_Implementation')?.id, 'ai_implementation');
  assert.equal(offerFor('ai_implementation')?.id, 'ai_implementation');
  // Similar words are not the same offer.
  assert.equal(isKnownOffer('ai_implementation_lite'), false);
  assert.equal(isKnownOffer('ai_department_implementation'), false);
});

test('one resolved offer mapping per vertical, with both layers visible', async () => {
  let checked = 0;
  for (const row of profiles) {
    const mappings = await resolveOfferMapping(row.vertical_profile_id);
    for (const mapping of mappings) {
      const ids = mapping.offers.map((offer) => offer.offerId);
      assert.equal(new Set(ids).size, ids.length,
        `${row.vertical_profile_id}/${mapping.opportunityCategory} lists an offer twice`);
      const priorities = mapping.offers.map((offer) => offer.priority);
      assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b),
        'the resolved priorities are not in order');
      for (const offer of mapping.offers) {
        assert.ok(offer.globalDescription.length > 0,
          `${offer.offerId} resolved without its catalog definition`);
        assert.ok(offer.provenance.global.length > 0, 'no global provenance');
        assert.ok(['GLOBAL_ONLY', 'VERTICAL_SPECIALISED'].includes(offer.provenance.resolved));
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 40, `only ${checked} resolved offers checked`);
});

test('a vertical specialises an offer without redefining it', async () => {
  // Positioning is the vertical's to write; what the offer *is* comes from the
  // catalog and travels alongside, so a consumer never has to pick a winner.
  const mappings = await resolveOfferMapping('roofing');
  const specialised = mappings.flatMap((mapping) => mapping.offers)
    .find((offer) => offer.provenance.resolved === 'VERTICAL_SPECIALISED');
  assert.ok(specialised, 'no roofing offer carries the vertical’s positioning');
  const catalog = offerFor(specialised!.offerId)!;
  assert.equal(specialised!.globalDescription, catalog.description,
    'the vertical layer overwrote what the offer is');
  assert.ok(specialised!.verticalPositioning);
  assert.notEqual(specialised!.verticalPositioning, specialised!.globalDescription);
});

test('the authoritative hook order reaches the pack, not just the resolver', async () => {
  // A resolver nothing reads is the defect this whole contract exists to end. The
  // pack is where a consumer looks, so the order has to arrive there.
  const { buildCallPack } = await import('../src/callbrain/callPack.js');
  const { withTransaction } = await import('../src/db/pool.js');
  const { upsertAccount } = await import('../src/domain/accounts.js');
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Hook Order Fixture', website: 'https://hookorder.invalid',
    phone: '904-555-3401', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));

  const pack = await buildCallPack(accountId);
  assert.ok(pack, 'no pack');
  assert.deepEqual(pack!.primaryHookOrder,
    ['unsold_proposal_follow_up', 'paid_lead_response', 'storm_surge', 'attribution',
      'employee_capacity'],
    'the pack does not carry the order roofing states');
  assert.equal(pack!.primaryHookSource, 'PREFERRED',
    'the pack does not say the trade stated its own order');
});
