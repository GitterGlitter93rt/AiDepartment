import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles, getVerticalProfile } from '../src/domain/verticals.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import {
  deriveHypotheses, storeHypotheses, storedCategory, UNMAPPED_CATEGORIES,
} from '../src/domain/hypotheses.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';

/**
 * Why to call this company, which nothing produced.
 *
 * The only writers of `opportunity_hypotheses` were the seed script, a demo CLI and
 * a synthetic fixture. Every consumer existed -- the Account page's "Why reach out",
 * its suggested first question, the Call Pack the agent speaks from, and a
 * `generated_by` column defaulting to 'deterministic' -- so a real prospect showed
 * an empty panel while a seeded demo company looked finished. The single question
 * this product exists to answer had no answer for anyone real.
 *
 * Everything asserted below traces to the vertical profile. The sentence is its
 * `description`, the questions are its `questions_to_verify`, applicability is its
 * `trigger_signals` against evidence we hold, and the order is its `hook_priorities`.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(vertical: string | null = 'roofing'): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Hypothesis Fixture ${sequence}`,
    website: `https://hypo${sequence}.invalid`,
    phone: `904-555-${String(9100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    ...(vertical ? { verticalProfileId: vertical } : {}),
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

/** Evidence for one declared claim key, current unless told otherwise. */
async function evidence(accountId: string, claimKey: string, options: {
  expired?: boolean; category?: string;
} = {}): Promise<void> {
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: options.category ?? 'paid_acquisition', claimKey,
    claimText: `${claimKey} was observed.`, normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'provider_serp',
    expiresAt: new Date(Date.now() + (options.expired ? -3600_000 : 48 * 3600_000)),
  }));
}

/** The claim key a profile maps a declared signal to. */
async function claimKeyFor(vertical: string, signalId: string): Promise<string> {
  const profile = await getVerticalProfile(vertical);
  const rule = (profile.public_signal_rules as any[])
    .find((entry) => entry.signal_id === signalId);
  assert.ok(rule?.evidence_claim_key, `${vertical} does not declare ${signalId}`);
  return rule.evidence_claim_key;
}

// ------------------------------------------------------- derived, not invented ---

test('an observed advertiser gets the hypotheses its own profile declares', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));

  const derived = await deriveHypotheses(accountId);
  assert.ok(derived.length > 0, 'a company we can see advertising has no reason to call');

  const profile = await getVerticalProfile('roofing');
  const declared = new Map((profile.leak_hypotheses as any[])
    .map((item) => [item.hypothesis_id, item]));

  for (const item of derived) {
    const source = declared.get(item.hypothesisId);
    assert.ok(source, `${item.hypothesisId} is not in the profile at all`);
    // The sentence a rep reads is the profile's, word for word.
    assert.equal(item.text, String(source.description).trim(),
      'the hypothesis text was rewritten rather than quoted');
    assert.deepEqual(item.questions,
      (source.questions_to_verify ?? []).map((q: unknown) => String(q).trim()),
      'the questions were not the profile’s own');
    assert.ok(item.matchedSignals.includes('active_google_search_ads'));
    assert.ok(item.supportingEvidenceIds.length > 0,
      'a hypothesis with no evidence behind it cannot be traced');
  }
});

test('no observed trigger, no hypothesis', async () => {
  // A guess about every company in a vertical is not a reason to call this one.
  const derived = await deriveHypotheses(await account('roofing'));
  assert.deepEqual(derived, []);
});

test('expired evidence stops triggering', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'),
    { expired: true });
  assert.deepEqual(await deriveHypotheses(accountId), [],
    'an ad we saw once and cannot see now still produced a reason to call');
});

test('a company with no vertical produces nothing rather than something generic', async () => {
  const accountId = await account(null);
  await evidence(accountId, 'active_google_search_ad');
  assert.deepEqual(await deriveHypotheses(accountId), []);
});

// ------------------------------------------------------------------ the order ---

test('the profile decides which hypothesis a rep sees first', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));

  const derived = await deriveHypotheses(accountId);
  assert.ok(derived.length >= 2, 'the fixture no longer tests ordering');
  for (let i = 1; i < derived.length; i += 1) {
    assert.ok(derived[i - 1]!.priority <= derived[i]!.priority,
      'derived hypotheses are not in the order every reader assumes');
  }

  // Every reader orders by priority ascending, so a boost has to lower the number.
  const profile = await getVerticalProfile('roofing');
  const hook = (profile.hook_priorities as any[])
    .find((entry) => entry.hook_family === derived[0]!.hypothesisId);
  if (hook?.boost_if_signals?.length) {
    assert.ok(derived[0]!.priority <= Number(hook.base_priority),
      'a boosted hook sorted further down, so the best reason to call is buried');
  }
});

// -------------------------------------------------------------- disqualifiers ---

test('a prospect who answered the question is not asked it again', async () => {
  // The disqualifiers were unreachable: thirty-five declared across the profiles and
  // not one of them appears in any `public_signal_rules` list, because they are not
  // website signals. Every one is named `prospect_confirms_*` -- things a prospect
  // says -- and `prospect_statements` is where those are kept, verbatim, under a
  // free-text category. So the bridge is the category, and without it a company that
  // told us their response process is measured would be asked about it again.
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));

  const before = await deriveHypotheses(accountId);
  assert.ok(before.some((item) => item.hypothesisId === 'paid_lead_response'),
    'the fixture no longer produces the hypothesis being disqualified');

  const rep = await makeUser(`Disqualifier Rep ${Date.now()}`, 'SALES_REP');
  await query(
    `insert into prospect_statements
       (account_id, category, statement_text, source_class, captured_by)
     values ($1, 'prospect_confirms_strong_measured_response_process',
             'We time every lead and the owner sees the report on Monday.',
             'prospect_verified', $2)`,
    [accountId, rep.userId]);

  const after = await deriveHypotheses(accountId);
  assert.ok(!after.some((item) => item.hypothesisId === 'paid_lead_response'),
    'a prospect told us this does not apply and we would have raised it again');
  // And only that one goes.
  assert.ok(after.length > 0 && after.length < before.length,
    'disqualifying one hypothesis removed all of them, or none');
});

test('a superseded statement stops disqualifying', async () => {
  // A statement someone corrected is no longer what the prospect says. The pointer
  // is on the newer row, so the row to ignore is the one pointed at -- reading it
  // the other way keeps the stale claim and discards the correction.
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));
  const rep = await makeUser(`Superseded Rep ${Date.now()}`, 'SALES_REP');

  const { rows } = await query<{ prospect_statement_id: string }>(
    `insert into prospect_statements
       (account_id, category, statement_text, source_class, captured_by)
     values ($1, 'prospect_confirms_strong_measured_response_process', 'Earlier claim.',
             'prospect_verified', $2)
     returning prospect_statement_id`,
    [accountId, rep.userId]);
  // The correction files the fact somewhere else: what they actually said is that
  // nobody tracks it, which is not a confirmation of anything.
  await query(
    `insert into prospect_statements
       (account_id, category, statement_text, source_class, captured_by,
        supersedes_statement_id)
     values ($1, 'response_process', 'Actually nobody tracks it.',
             'prospect_verified', $2, $3)`,
    [accountId, rep.userId, rows[0]!.prospect_statement_id]);

  const derived = await deriveHypotheses(accountId);
  assert.ok(derived.some((item) => item.hypothesisId === 'paid_lead_response'),
    'a correction was ignored and the hypothesis stayed disqualified');
});

// ------------------------------------------------------------- the vocabulary ---

test('a category the schema has no word for is filed as other, with its own name kept', () => {
  assert.equal(storedCategory('sales_follow_up'), 'follow_up',
    'a spelling of an existing category should map, not become other');
  assert.equal(storedCategory('no_show_recovery'), 'appointment_no_show');
  assert.equal(storedCategory('missed_call_recovery'), 'missed_call');
  assert.equal(storedCategory('customer_status_communication'), 'customer_communication');
  assert.equal(storedCategory('speed_to_lead'), 'speed_to_lead');

  for (const concept of UNMAPPED_CATEGORIES) {
    assert.equal(storedCategory(concept), 'other',
      `${concept} was given a home in the schema's vocabulary that nobody chose`);
  }
});

test('every category every profile uses can be stored without throwing', async () => {
  // Eight categories the canonical profiles use are absent from the table's check
  // constraint. A generator that inserted them raw would throw on eight of thirteen
  // verticals, and only on the verticals nobody demoed.
  const { rows } = await query<{ definition: any }>(
    'select definition from vertical_profiles where is_active');
  const categories = new Set<string>();
  for (const row of rows) {
    for (const item of row.definition?.profile?.leak_hypotheses ?? []) {
      if (typeof item?.category === 'string') categories.add(item.category);
    }
  }
  assert.ok(categories.size >= 12, `only ${categories.size} categories found`);

  const accountId = await account('roofing');
  for (const category of categories) {
    await query(
      `insert into opportunity_hypotheses
         (account_id, category, hypothesis_text, source_category, generated_by)
       values ($1, $2, 'probe', $3, 'deterministic')`,
      [accountId, storedCategory(category), category]);
  }
  const { rows: stored } = await query<{ n: number }>(
    'select count(*)::int as n from opportunity_hypotheses where account_id = $1',
    [accountId]);
  assert.equal(stored[0]!.n, categories.size);
});

// ---------------------------------------------------------------- persistence ---

test('re-deriving replaces our own rows and leaves a human’s alone', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));

  // Something a person recorded. Re-running research must not retire it.
  await query(
    `insert into opportunity_hypotheses
       (account_id, category, hypothesis_text, generated_by, priority)
     values ($1, 'other', 'The owner told us their intake is a shared inbox.',
             'sales_manager', 5)`,
    [accountId]);

  const first = await storeHypotheses(accountId, await deriveHypotheses(accountId));
  assert.ok(first.written > 0);
  const second = await storeHypotheses(accountId, await deriveHypotheses(accountId));
  assert.equal(second.retired, first.written,
    'a second run either duplicated its own rows or retired none of them');

  const { rows } = await query<{ generated_by: string; n: number }>(
    `select generated_by, count(*)::int as n from opportunity_hypotheses
      where account_id = $1 and is_current group by 1`, [accountId]);
  const byWriter = new Map(rows.map((row) => [row.generated_by, row.n]));
  assert.equal(byWriter.get('sales_manager'), 1,
    'a hypothesis a person recorded was retired by a research run');
  assert.equal(byWriter.get('deterministic'), second.written);
});

// --------------------------------------------------------------- on the page ----

test('the page a rep opens now answers why this company', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));
  await storeHypotheses(accountId, await deriveHypotheses(accountId));

  const manager = await makeUser(`Hypo Manager ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });

  assert.ok(detail!.hypotheses.length > 0, 'the Why reach out panel is still empty');
  assert.ok(detail!.suggestedFirstQuestion,
    'there is a hypothesis and still no question to open with');

  // And it is the profile's question, not one we composed.
  const profile = await getVerticalProfile('roofing');
  const everyQuestion = (profile.leak_hypotheses as any[])
    .flatMap((item) => (item.questions_to_verify ?? []).map((q: unknown) => String(q).trim()));
  assert.ok(everyQuestion.includes(detail!.suggestedFirstQuestion!),
    'the suggested question is not one the profile declares');
});

test('a hypothesis is never presented as a fact', async () => {
  const accountId = await account('roofing');
  await evidence(accountId, await claimKeyFor('roofing', 'active_google_search_ads'));
  await storeHypotheses(accountId, await deriveHypotheses(accountId));

  const { rows } = await query<{ confidence: string }>(
    `select distinct confidence from opportunity_hypotheses
      where account_id = $1 and is_current and generated_by = 'deterministic'`,
    [accountId]);
  assert.deepEqual(rows.map((row) => row.confidence), ['unknown'],
    'nothing observable about a website or an ad tells us what happens inside their '
    + 'office, so a derived hypothesis must not claim confidence');
});
