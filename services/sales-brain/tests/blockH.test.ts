import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import {
  buildCallPack, prohibitionSentence, UNIVERSAL_PROHIBITIONS,
} from '../src/callbrain/callPack.js';
import { resetDatabase } from './helpers.js';

/**
 * Block H: the words a rep actually says.
 *
 * Everything upstream of here is recoverable. A wrong tier costs a wasted hour; a
 * wrong sentence on a call is said to a person, about their own business, and cannot
 * be taken back. So the question for the call pack is narrower than "is it good": can
 * a rep read anything in it as a fact that is not one, and can they tell how old the
 * facts are?
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Block H Co ${sequence}`,
    website: `https://blockh-${sequence}.invalid`,
    phone: `904-555-${String(6100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac', contactName: 'Dana Fielder', contactTitle: 'Owner',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

// =============================================================================
// H1 · a fact in the pack is dated when it was observed
// =============================================================================

/**
 * `observedAt` is how a rep judges whether a fact is still true -- it renders as
 * "seen 3 minutes ago" -- and prospect statements were stamped with the moment the
 * pack was built rather than the moment the prospect spoke. The single strongest item
 * in the pack, the one thing the rep is told not to make them repeat, claimed to be
 * current however old it was.
 *
 * A rep opening "They previously said: we are switching CRMs in Q1" reads a
 * two-year-old sentence as this morning's news and says it back to somebody who has
 * since switched. The Account page already rendered these from `captured_at`, so two
 * readers of one row disagreed and the wrong one was the one used on a call.
 */
test('H1 a two-year-old statement is not presented as something they just said',
  async () => {
  const accountId = await account();
  const spokenAt = new Date(Date.now() - 730 * 24 * 3_600_000);
  await query(
    `insert into prospect_statements
       (account_id, statement_text, category, source_class, captured_at, captured_by)
     values ($1, 'We are switching CRMs in Q1', 'systems', 'prospect_verified', $2, null)`,
    [accountId, spokenAt.toISOString()]);

  const pack = await buildCallPack(accountId);
  assert.ok(pack, 'no call pack was built');
  const quoted = pack!.confirmedFacts.find((fact) =>
    fact.source === 'prospect_statement');
  assert.ok(quoted, 'the statement did not reach the pack at all');

  const ageDays = (Date.now() - quoted!.observedAt.getTime()) / 86_400_000;
  assert.ok(ageDays > 700,
    `the statement is dated ${ageDays.toFixed(0)} days old; it was said 730 days ago, `
    + 'so the pack is telling a rep it is current');
});

test('H1 a statement made today is still dated today', async () => {
  // The other half, so the fix cannot be "always look old".
  const accountId = await account();
  await query(
    `insert into prospect_statements
       (account_id, statement_text, category, source_class, captured_at, captured_by)
     values ($1, 'Call me back on Thursday', 'logistics', 'prospect_verified', now(), null)`,
    [accountId]);

  const pack = await buildCallPack(accountId);
  const quoted = pack!.confirmedFacts.find((f) => f.source === 'prospect_statement');
  const ageMinutes = (Date.now() - quoted!.observedAt.getTime()) / 60_000;
  assert.ok(ageMinutes < 5, `a statement made now is dated ${ageMinutes} minutes ago`);
});

// =============================================================================
// H2 · nothing reaches the rep as a fact that is not statable
// =============================================================================

test('H2 evidence that cannot be stated becomes an unknown, not a fact', async () => {
  const accountId = await account();
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, confidence, can_state_as_fact,
        source_type, source_reference, observed_at)
     values
       ($1, 'advertising', 'active_google_search_ad',
        'Runs Google search ads for AC repair', 'confirmed', true,
        'SERP_OBSERVATION', 'https://blockh.invalid/serp', now()),
       ($1, 'operations', 'crm_provider',
        'Possibly uses a well-known CRM', 'likely', false,
        'THIRD_PARTY_INFERENCE', 'https://blockh.invalid/guess', now())`,
    [accountId]);

  const pack = await buildCallPack(accountId);

  // Every fact offered as statable really is.
  for (const fact of pack!.confirmedFacts) {
    assert.equal(fact.canStateAsFact, true,
      `"${fact.claim}" is in the facts a rep may say out loud and is not statable`);
  }
  assert.ok(pack!.confirmedFacts.some((f) => /Google search ads/.test(f.claim)));
  assert.ok(!pack!.confirmedFacts.some((f) => /Possibly uses/.test(f.claim)),
    'an inference reached the rep as a fact');

  // And the topic is not hidden: it becomes something to ask about.
  assert.ok(pack!.importantUnknowns.some((unknown) => /crm provider/i.test(unknown)),
    'a suspected-but-unconfirmed fact vanished instead of becoming a question');
  assert.ok(pack!.importantUnknowns.some((u) => /ask rather than assert/i.test(u)));
});

test('H2 expired and contradicted evidence never reaches the pack', async () => {
  const accountId = await account();
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, confidence, can_state_as_fact,
        source_type, source_reference, observed_at, expires_at)
     values ($1, 'advertising', 'active_google_search_ad',
             'Ran Google ads a year ago', 'confirmed', true,
             'SERP_OBSERVATION', 'https://blockh.invalid/old',
             now() - interval '400 days', now() - interval '300 days')`,
    [accountId]);

  const pack = await buildCallPack(accountId);
  assert.ok(!pack!.confirmedFacts.some((f) => /a year ago/.test(f.claim)),
    'expired evidence is being stated as current fact on a call');
  assert.ok(!pack!.importantUnknowns.some((u) => /google/i.test(u)),
    'expired evidence became an unknown, which implies we looked and could not tell');
});

// =============================================================================
// H3 · the boundaries a rep is given
// =============================================================================

test('H3 every pack carries the universal prohibitions, whatever research found',
  async () => {
  // These do not depend on the vertical, the evidence, or the hypothesis. A pack
  // assembled from nothing at all still has to carry them.
  const bare = await account();
  const pack = await buildCallPack(bare);

  for (const expected of [
    /advertising spend/i, /missed-call rate/i, /CRM, phone system/i,
    /referral, a prior conversation/i, /promise ROI/i,
    /replacing or reducing their staff/i, /quote a price/i,
    /every missed call/i,
  ]) {
    assert.ok(pack!.prohibitedClaims.some((claim) => expected.test(claim)),
      `no prohibition matching ${expected}`);
  }
  // Every prohibition is an instruction rather than a topic label, so a token like
  // `unauthorized_public_adjusting` has to become something a model will not do.
  // Asserted on the transform rather than on the whole list, because the list also
  // carries a profile's `escalation_guidance` verbatim -- and rewriting a compliance
  // sentence into our own words is how its meaning drifts, which the pack says in
  // those terms. A test that demanded every line start with "Do not" would be asking
  // for exactly the drift that comment forbids.
  assert.equal(prohibitionSentence('unauthorized_public_adjusting'),
    'Do not claim or decide: unauthorized public adjusting.');
  for (const claim of UNIVERSAL_PROHIBITIONS) {
    assert.match(claim, /^Do not /);
    assert.match(claim, /\.$/);
    assert.ok(pack!.prohibitedClaims.includes(claim),
      `"${claim}" is declared universal and is not on the pack`);
  }
  // And every line is a sentence somebody could act on, however it is phrased.
  for (const claim of pack!.prohibitedClaims) {
    assert.ok(claim.trim().length > 20, `"${claim}" is a label, not an instruction`);
    assert.match(claim, /\.$/, `"${claim}" is not a sentence`);
  }
});

test('H3 a suppressed company produces no pack at all', async () => {
  // Not a pack with a warning on it. The pack is the thing a rep works from, and the
  // safest version of a company we must not contact is nothing to work from.
  const accountId = await account();
  await query(
    `update accounts set is_suppressed = true where account_id = $1`, [accountId]);
  assert.equal(await buildCallPack(accountId), null,
    'a suppressed company still produced a call pack');
});

test('H3 a stale contact name is not offered for a rep to use confidently', async () => {
  // The one cold-call mistake that cannot be recovered from in the same call: asking
  // the receptionist confidently for somebody who left a year ago.
  const accountId = await account();
  await query(
    `update contacts set currentness = 'STALE', role_confidence = 'HISTORICAL_ROLE',
            observed_at = now() - interval '500 days'
      where account_id = $1`, [accountId]);

  const pack = await buildCallPack(accountId);
  if (pack!.contactName) {
    assert.equal(pack!.contactSafeToAskByName, false,
      'a contact last seen 500 days ago is offered as safe to ask for by name');
    assert.ok(pack!.contactGuidance.length > 0,
      'the rep is given a name they must not trust and no instruction about it');
  }
});
