import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser, markEntityVerified } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { renderAccountPage } from '../src/web/pages/account.js';
import {
  researchPictureFor, factStateLabel, UNKNOWING, type FactState,
} from '../src/domain/researchFacts.js';

/**
 * Not knowing, told apart from knowing something is absent.
 * Authority: Issue #3 B / M-15.
 *
 * The live failure: Salazar Roofing, whose website we held, on a page reporting it
 * had none. That is one instance of a general defect -- every research fact was
 * answered as present or absent, and the gap between them swallowed the distinction
 * that decides what a rep does next. "We looked and there was no ad" and "nobody has
 * ever looked" are different facts about the world; rendered as the same "no", a rep
 * skips a company nobody researched, believing it was researched and found wanting.
 *
 * NO is the rarest state here and the most dangerous. We can prove a company
 * advertises. We cannot prove it does not.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(options: {
  website?: string | null; phone?: string | null;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Salazar Roofing ${sequence}`,
    website: options.website === undefined ? `https://salazar${sequence}.invalid` : options.website,
    phone: options.phone === undefined ? `904-555-${String(4000 + sequence).slice(-4)}` : options.phone,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  // Stands for a candidate the resolver promoted: the only way a machine
  // makes an Account now.
  await markEntityVerified(accountId);
  return accountId;
}

function fact(picture: Awaited<ReturnType<typeof researchPictureFor>>, key: string) {
  const found = picture.facts.find((item) => item.key === key);
  assert.ok(found, `no fact called ${key}`);
  return found!;
}

async function markResearched(accountId: string, pagesFetched: number): Promise<void> {
  await query(
    `insert into research_runs (account_id, trigger, started_at, completed_at, status,
                                adapter_results)
     values ($1, 'newly_discovered', now(), now(), 'completed', $2::jsonb)`,
    [accountId, JSON.stringify({ pages_fetched: pagesFetched, stages_run: ['A_company_first_party'] })]);
  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '10 days' where account_id = $1`,
    [accountId]);
}

// ------------------------------------------------------- the Salazar failure ----

test('a company whose website we hold is never reported as having none', async () => {
  const accountId = await account({ website: 'https://salazarroofing.invalid' });
  await markResearched(accountId, 0);

  const website = fact(await researchPictureFor(accountId), 'website');
  assert.equal(website.state, 'YES',
    'the website we hold was reported as absent, which is the live Salazar failure');
  assert.match(website.detail, /salazarroofing\.invalid/);
});

test('the website is known from either place the schema keeps it', async () => {
  // Two tables hold this and a page reading one while the other has the answer is
  // exactly how a known website becomes "no website".
  const accountId = await account({ website: null });
  await query(
    `insert into account_domains (account_id, hostname, canonical_url, domain_role,
                                  verification_status)
     values ($1, 'onlyindomains.invalid', 'https://onlyindomains.invalid', 'primary',
             'unverified')`, [accountId]);

  const { rows } = await query<{ canonical_domain: string | null }>(
    'select canonical_domain from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.canonical_domain, null, 'the fixture no longer tests the split');

  const website = fact(await researchPictureFor(accountId), 'website');
  assert.equal(website.state, 'YES',
    'a website held in account_domains but not on the account read as no website');
});

test('a website we hold but could not read explains the thin record', async () => {
  const accountId = await account({ website: 'https://blocked.invalid' });
  await markResearched(accountId, 0);

  const picture = await researchPictureFor(accountId);
  assert.equal(fact(picture, 'website').state, 'YES');
  const read = fact(picture, 'website_read');
  assert.equal(read.state, 'NOT_OBSERVED');
  assert.match(read.detail, /blocked, moved or down/);
  assert.match(read.detail, /not because the company is/,
    'the page blames the company for a site we could not fetch');
});

// ------------------------------------------------- never checked vs not found ---

test('nothing has looked is a different answer from we looked and did not find it', async () => {
  // No phone either: a discovered company that came with one genuinely has a
  // contact route before any research runs, which is a YES rather than an oversight.
  const untouched = await account({ website: null, phone: null });
  const researched = await account({ website: null, phone: null });
  await markResearched(researched, 3);

  const before = await researchPictureFor(untouched);
  const after = await researchPictureFor(researched);

  for (const key of ['website', 'contact_route', 'decision_maker']) {
    assert.equal(fact(before, key).state, 'NOT_CHECKED', key);
    assert.equal(fact(after, key).state, 'NOT_OBSERVED', key);
  }
  assert.match(fact(before, 'website').detail, /Nothing has researched/);
  assert.match(fact(after, 'website').detail, /not proof there is none/);
});

test('no fact is ever answered NO from an absence', async () => {
  // The one state we almost never earn. Every absence in this system is "we did not
  // see it", which is a fact about our looking rather than about the company.
  const researched = await account({ website: null, phone: null });
  await markResearched(researched, 2);
  const picture = await researchPictureFor(researched);

  const asserted = picture.facts.filter((item) => item.state === 'NO');
  assert.deepEqual(asserted, [],
    `${asserted.map((item) => item.key).join(', ')} claimed a confirmed absence from `
    + 'evidence that only shows we did not find something');
});

// ------------------------------------------------------------- advertising -----

test('missing ad evidence never becomes "does not advertise"', async () => {
  const accountId = await account();
  await markResearched(accountId, 4);

  const picture = await researchPictureFor(accountId);
  const channels = picture.facts.filter((item) => item.key.startsWith('advertising_'));
  assert.ok(channels.length >= 3, 'the ad channels are not in the picture');

  for (const channel of channels) {
    assert.ok(UNKNOWING.has(channel.state), `${channel.key} is ${channel.state}`);
    assert.equal(channel.canStateAsFact, false);
    assert.doesNotMatch(channel.detail, /does not advertise/,
      'the page states that a company does not advertise');
  }
});

test('a checked channel with no ad is about the search, not the company', async () => {
  const accountId = await account();
  await markResearched(accountId, 4);
  // Expired evidence: we saw an ad once and the observation aged out.
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, source_provider, expires_at, freshness)
     values ($1, 'paid_acquisition', 'active_google_search_ad', 'ad seen', 'yes',
             'confirmed', true, 'provider_serp', 'dataforseo',
             now() - interval '1 day', 'stale')`, [accountId]);

  const google = fact(await researchPictureFor(accountId), 'advertising_google_search');
  assert.equal(google.state, 'UNKNOWN',
    'an ad that aged out was reported as current or as absent');
  assert.equal(google.canStateAsFact, false);
});

// ------------------------------------------------------ what nothing collects ---

test('data no source has collected is never a zero', async () => {
  // `google_business_profile` became `business_listing` when the listings adapter
  // framework landed: the fact is that a listings source knows this company, and
  // naming it after one provider was wrong before a second existed. The property
  // being asserted is unchanged -- a fact nobody has collected is never a count.
  const accountId = await account();
  await markResearched(accountId, 5);
  const picture = await researchPictureFor(accountId);

  for (const key of ['business_listing', 'rating_and_reviews']) {
    const item = fact(picture, key);
    assert.equal(item.state, 'NOT_CHECKED',
      `${key} claimed to know something no source has looked up`);
    assert.match(item.detail, /never been looked (at|up)|has looked this company up/);
    assert.doesNotMatch(item.detail, /\b0\b/, 'a fact nothing collects was given a count');
  }
});

// ---------------------------------------------------------------- conflicts ----

test('sources that disagree are a conflict, not a quiet winner', async () => {
  const accountId = await account();
  await markResearched(accountId, 3);

  const { rows } = await query<{ evidence_id: string }>(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, expires_at, freshness)
     values ($1, 'intake', 'online_quote_booking', 'site offers online booking', 'yes',
             'confirmed', true, 'first_party', now() + interval '30 days', 'fresh')
     returning evidence_id`, [accountId]);
  await query(
    `update evidence_records set contradicted_by_evidence_id = evidence_id
      where evidence_id = $1`, [rows[0]!.evidence_id]);

  // A signal the roofing profile actually declares. The fact model reads the
  // vertical's declared signals now rather than a hard-coded three, so a key the
  // profile does not ask for has no fact at all -- and roofing does not declare
  // emergency cover, because storm work is its own signal there.
  const booking = fact(await researchPictureFor(accountId), 'online_quote_booking');
  assert.equal(booking.state, 'CONFLICT');
  assert.equal(booking.canStateAsFact, false);
  assert.match(booking.detail, /Ask on the call/);
});

// -------------------------------------------------------------- on the page ----

test('a rep sees which kind of not-knowing each one is', async () => {
  const accountId = await account({ website: 'https://salazarroofing.invalid' });
  const manager = await makeUser(`Epistemics Manager ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });
  const page = renderAccountPage(detail!, { ...manager, role: 'SALES_MANAGER' } as any,
    {} as any, undefined);

  assert.match(page, /What we know/);
  assert.match(page, /Never checked/);
  assert.match(page, /one search on one day, not a fact about the/,
    'the page does not explain what "looked, not found" means');
  assert.doesNotMatch(page, /does not advertise/);
});

test('every state has words a rep can read', () => {
  const states: FactState[] =
    ['YES', 'NO', 'NOT_OBSERVED', 'NOT_CHECKED', 'UNKNOWN', 'CONFLICT'];
  const labels = states.map(factStateLabel);
  assert.equal(new Set(labels).size, labels.length, 'two states share a label');
  for (const label of labels) {
    assert.doesNotMatch(label, /_/, `"${label}" is a schema word, not a rep's word`);
  }
});
