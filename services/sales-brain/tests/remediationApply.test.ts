import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase } from './helpers.js';
import { applyForAccount, planRemediation, proposeTrimmedName } from '../src/remediation/apply.js';
import {
  identityFromJsonLd, identityFromMeta, identityFromTitle,
} from '../src/resolver/siteIdentity.js';
import { namesAgree, siteNamesTheTrade } from '../src/remediation/classify.js';

/**
 * SB-V2-1b — the apply half, authorised on 2026-09-17.
 *
 * What it may do is narrow and every instrument is reversible. These tests hold the
 * narrowness: that a name is only ever trimmed to one the evidence already holds, that a
 * non-company is suppressed rather than deleted, that raw evidence survives, that an
 * Account a person has worked is never touched automatically, and that every change
 * leaves an audit row carrying what it was before.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

// ------------------------------------------------------------- what a site says

test('a site names itself in the three places worth believing', () => {
  assert.equal(identityFromJsonLd([{
    '@type': 'LocalBusiness', name: 'Southern Air',
  }]), 'Southern Air');

  // Decoded, because a name is compared as a person reads it.
  assert.equal(
    identityFromMeta('<meta property="og:site_name" content="Today&#39;s Homeowner">'),
    "Today's Homeowner");

  // A title segment is the weakest, so it is only taken when the domain agrees.
  assert.equal(
    identityFromTitle('<title>HVAC Services in St. Augustine, FL - Southern Air</title>',
      'southernair.com'),
    'Southern Air');
  assert.equal(
    identityFromTitle('<title>10 Best Roofers in St. Augustine, FL</title>',
      'todayshomeowner.com'),
    null);
});

// --------------------------------------------------------------- what a name may become

test('a name is only ever trimmed to one the stored name already contains', () => {
  // The case Michael named: a brand segment the stored name already carries.
  const trimmed = proposeTrimmedName({
    canonicalName: 'AC Repair Safety Harbor - Burgess Heating & Air',
    canonicalDomain: 'burgessheatingandair.com',
    candidateNames: [],
    siteIdentity: { name: 'Burgess Heating & Air Inc', basis: 'basis=SCHEMA_ORG_NAME' },
    tradeTerms: ['HVAC contractor', 'heating and cooling'],
  });
  assert.equal(trimmed?.name, 'Burgess Heating & Air Inc');

  // Deliberately withheld, and the cost of the rule above it: southernair.net is a real
  // HVAC company, its site says "Southern Air", and that name sits in the publisher slot
  // of the stored title -- structurally identical to "... - Homeyou", which is a
  // directory. Nothing in the evidence separates the two, so neither is renamed
  // automatically and both go to a person. A rep reading a bad title is better off than
  // a rep reading a confident wrong name.
  assert.equal(proposeTrimmedName({
    canonicalName: 'HVAC Services in St. Augustine, FL - Palatka - Southern Air',
    canonicalDomain: 'southernair.net',
    candidateNames: [],
    siteIdentity: { name: 'Southern Air', basis: 'basis=SCHEMA_ORG_NAME' },
    tradeTerms: ['HVAC contractor', 'air conditioning'],
  }), null);

  // A site name the stored name does not contain is a different company or a rename,
  // and either needs a person.
  const different = proposeTrimmedName({
    canonicalName: '10 Best Roofers in St. Augustine, FL',
    canonicalDomain: 'todayshomeowner.com',
    candidateNames: [],
    siteIdentity: { name: "Today's Homeowner", basis: 'basis=OG_SITE_NAME' },
    recordLooksLikeAPage: true,
  });
  assert.equal(different, null);

  // And production's own trap: a resolver candidate naming another city is refused,
  // because the stored name does not contain it.
  const otherCity = proposeTrimmedName({
    canonicalName: 'Orlando HVAC Services',
    canonicalDomain: 'example.invalid',
    candidateNames: [{ name: 'HVAC Service Areas Near Tampa, FL', basis: 'own_site_title' }],
  });
  assert.equal(otherCity, null);
});

test('a name is compared as a person reads it, not as the markup spells it', () => {
  // Caught by the dry run against production before it changed anything:
  // solarpoolroof.com declares `Solar Pool &amp; Roof`, and the undecoded entity made
  // that look like a different name from the one already in the record -- which proposed
  // suppressing a real roofing company as a page on somebody else's site.
  assert.equal(identityFromJsonLd([{ '@type': 'LocalBusiness', name: 'Solar Pool &amp; Roof' }]),
    'Solar Pool & Roof');
  assert.equal(identityFromMeta('<meta property="og:site_name" content="Today&#39;s Homeowner">'),
    "Today's Homeowner");
});

test('a company that declares its own name on its own domain may be renamed from it', () => {
  // The common production shape, and the one containment refuses: the stored name is
  // pure page copy with no brand segment at all. hightideroofing.com's schema.org block
  // says "High Tide Roofing & Waterproofing, Inc" and the record says none of it.
  const renamed = proposeTrimmedName({
    canonicalName: 'Top St. Augustine Roofing Contractor | Free Roof Inspection',
    canonicalDomain: 'hightideroofing.com',
    candidateNames: [],
    siteIdentity: { name: 'High Tide Roofing & Waterproofing, Inc', basis: 'basis=SCHEMA_ORG_NAME' },
    tradeTerms: ['roofing contractor', 'roofer'],
  });
  assert.equal(renamed?.name, 'High Tide Roofing & Waterproofing, Inc');
  assert.match(renamed!.basis, /its own domain/);

  // The load-bearing guard: a name that does not match the domain it came from is a
  // site naming itself on somebody else's record, and is refused.
  const directory = proposeTrimmedName({
    canonicalName: '10 Best Roofers in St. Augustine, FL',
    canonicalDomain: 'todayshomeowner.com',
    candidateNames: [],
    siteIdentity: { name: "Today's Homeowner", basis: 'basis=OG_SITE_NAME' },
    recordLooksLikeAPage: true,
  });
  assert.equal(directory, null,
    "a directory's own name was written onto a record that merely sits on it");

  // And a title-segment match is not a declaration, so it does not get the wider rule.
  const weak = proposeTrimmedName({
    canonicalName: 'Some Page Title Entirely Unrelated',
    canonicalDomain: 'hightideroofing.com',
    candidateNames: [],
    siteIdentity: { name: 'High Tide Roofing', basis: 'basis=TITLE_BRAND_SEGMENT' },
  });
  assert.equal(weak, null);
});

// ------------------------------------------------------------------ what is applied

async function seed(name: string, options: {
  domain?: string | null; vertical?: string | null;
} = {}): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: options.domain === null ? null : `https://${options.domain ?? 'seed.invalid'}`,
    phone: `407-555-${String(1000 + Math.floor(Math.random() * 8999)).slice(-4)}`,
    verticalProfileId: options.vertical ?? null,
  }, { discoverySource: 'import' }));
  return accountId;
}

test('a non-company is suppressed, and its evidence is still there afterwards', async () => {
  const accountId = await seed('An 82-year-old Vietnam veteran in St. Augustine says he\'s ...',
    { domain: null });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery',$2,'organic','transient',$1,'roofing contractor 32095', now())`,
    [accountId, 'An 82-year-old Vietnam veteran in St. Augustine says he\'s ...']);

  const plan = await planRemediation();
  const change = plan.changes.find((entry) => entry.accountId === accountId
    && entry.action === 'SUPPRESS_NON_COMPANY');
  assert.ok(change, 'an article headline with no domain was not proposed for suppression');

  const result = await applyForAccount(accountId, [change!]);
  assert.equal(result.applied.length, 1);

  const { rows } = await query<{
    is_suppressed: boolean; entity_status: string; observations: number; audit: number;
  }>(
    `select a.is_suppressed, a.entity_status,
            (select count(*) from search_observations where account_id = a.account_id)::int as observations,
            (select count(*) from audit_log where subject_id = a.account_id::text)::int as audit
       from accounts a where a.account_id = $1`, [accountId]);
  assert.equal(rows[0]!.is_suppressed, true);
  assert.equal(rows[0]!.entity_status, 'rejected');
  assert.equal(rows[0]!.observations, 1, 'suppression deleted the evidence behind it');
  assert.equal(rows[0]!.audit, 1, 'a change was made with no audit row');

  // And it is reversible: deactivating the suppression puts the Account back.
  await query(`update suppressions set is_active = false where account_id = $1`, [accountId]);
  const { rows: after } = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(after[0]!.is_suppressed, false);
});

test('an Account a person has worked is never changed automatically', async () => {
  const accountId = await seed('10 Best Roofers in Somewhere, FL', { domain: 'directory.invalid' });
  const { rows: user } = await query<{ user_id: string }>(
    `insert into users (email, email_normalized, display_name, role, password_hash)
     values ('rep@apply.invalid','rep@apply.invalid','A Rep','SALES_REP','x')
     returning user_id`);
  await query(
    `insert into activities (account_id, activity_type, actor_user_id, notes, occurred_at)
     values ($1, 'NOTE', $2, 'called, asked for a callback', now())`,
    [accountId, user[0]!.user_id]);

  const plan = await planRemediation();
  assert.equal(plan.changes.some((entry) => entry.accountId === accountId), false,
    'a worked Account was planned for an automatic change');
  assert.ok(plan.protectedByHumanActivity.includes(accountId));

  // And even handed a change directly, the transaction re-checks and refuses.
  const forced = await applyForAccount(accountId, [{
    accountId, companyName: 'x', action: 'CLEAR_UNSUPPORTED_VERTICAL',
    code: 'VERTICAL_FROM_QUERY_ONLY', reason: 'forced',
    before: {}, after: {},
  }]);
  assert.equal(forced.applied.length, 0);
  assert.match(forced.skipped[0]!.why, /human sales activity/);
});

test('an unsupported trade is cleared, never replaced with a guess', async () => {
  const accountId = await seed('U-Haul Neighborhood Dealer', {
    domain: 'uhaul.invalid', vertical: 'hvac' });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery','U-Haul Neighborhood Dealer','organic','transient',$1,
             'HVAC contractor 33127', now())`, [accountId]);

  const plan = await planRemediation();
  const change = plan.changes.find((entry) => entry.accountId === accountId
    && entry.action === 'CLEAR_UNSUPPORTED_VERTICAL');
  assert.ok(change, 'a trade held up by nothing but the query was not proposed for clearing');
  await applyForAccount(accountId, [change!]);

  const { rows } = await query<{ vertical: string | null; suppressed: boolean }>(
    `select primary_vertical_profile_id as vertical, is_suppressed as suppressed
       from accounts where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.vertical, null, 'the unsupported trade survived');
  assert.equal(rows[0]!.suppressed, false,
    'a real company was suppressed when only its trade was unsupported');
});

test('every change carries what it was before', async () => {
  const accountId = await seed('Some Category Page in Miami, FL', { domain: 'listings.invalid',
    vertical: 'hvac' });
  await query(
    `insert into search_observations (provider, source_type, observed_name, result_type,
                                      retention_class, account_id, query, observed_at)
     values ('dataforseo','discovery','Some Category Page in Miami, FL','organic','transient',$1,
             'HVAC contractor 33133', now())`, [accountId]);

  const plan = await planRemediation();
  const changes = plan.changes.filter((entry) => entry.accountId === accountId);
  assert.ok(changes.length > 0);
  await applyForAccount(accountId, changes);

  const { rows } = await query<{ action: string; detail: Record<string, unknown> }>(
    `select action, detail from audit_log where subject_id = $1 order by audit_id`, [accountId]);
  assert.equal(rows.length, changes.length);
  for (const row of rows) {
    assert.match(row.action, /^v2_remediation\./);
    assert.ok('before' in row.detail, 'an audit row does not say what it changed from');
    assert.ok('after' in row.detail);
  }
});

test('a legacy record is promoted only when its own site names it', async () => {
  const named = await seed('Cooper Roofing', { domain: 'cooperroofing.invalid' });
  const other = await seed('Proof Roofing', { domain: 'someportal.invalid' });
  await query(`update accounts set entity_status = 'legacy_unverified'
                where account_id in ($1, $2)`, [named, other]);
  await query(
    `insert into evidence_records (account_id, category, claim_key, claim_text,
                                   normalized_value, confidence, can_state_as_fact,
                                   source_type, source_reference)
     values ($1, 'identity', 'first_party_site_name', 'The site calls itself "Cooper Roofing"',
             'cooper roofing', 'confirmed', true, 'first_party', 'https://cooperroofing.invalid/'),
            ($2, 'identity', 'first_party_site_name', 'The site calls itself "Some Portal"',
             'some portal', 'confirmed', true, 'first_party', 'https://someportal.invalid/')`,
    [named, other]);

  const plan = await planRemediation();
  const promotion = plan.changes.find((entry) => entry.accountId === named
    && entry.action === 'VERIFY_FROM_SITE_IDENTITY');
  assert.ok(promotion, 'a legacy record whose site names it was not promoted');

  assert.equal(
    plan.changes.some((entry) => entry.accountId === other
      && entry.action === 'VERIFY_FROM_SITE_IDENTITY'),
    false, 'a record was verified by a site that names a different company');
  assert.ok(plan.review.some((entry) => entry.accountId === other
    && entry.code === 'LEGACY_UNVERIFIED'));

  await applyForAccount(named, [promotion!]);
  const { rows } = await query<{ entity_status: string; basis: string | null }>(
    'select entity_status, entity_status_basis as basis from accounts where account_id = $1',
    [named]);
  assert.equal(rows[0]!.entity_status, 'verified');
  assert.match(rows[0]!.basis ?? '', /own site names it/);
});

// ------------------------------------------------- whose site is the name coming from

test('a name in the publisher slot of a title is not agreement', () => {
  // The last segment of an HTML title is where the site's own name goes. Reading a name
  // there as agreement let "Central Air Service - Winter Park HVAC Contractors -
  // Homeyou" agree with a site calling itself "Homeyou", and a directory listing was
  // about to be renamed to the directory and left workable.
  assert.equal(
    namesAgree('Central Air Service - Winter Park HVAC Contractors - Homeyou', 'Homeyou'),
    false);

  // A match anywhere earlier is real agreement: the company titled its own page its own
  // way, which is most of this inventory.
  assert.equal(
    namesAgree('Acree: Plumbing, HVAC & Electrical Services in Tampa, FL', 'Acree'), true);
  assert.equal(namesAgree('Fidus', 'Fidus Roofing & Construction LLC'), true);
});

test('a trade is recognised by stem, and a publisher is not a trade', () => {
  const roofing = ['roofing contractor', 'roofer', 'roof repair'];

  // "Solar Pool & Roof" is a roofer. A whole-word test against "roofing" does not find
  // "roof" inside it, and the company was proposed for suppression because of that.
  assert.equal(siteNamesTheTrade('Solar Pool & Roof', roofing), true);
  assert.equal(siteNamesTheTrade('High Tide Roofing & Waterproofing, Inc', roofing), true);
  assert.equal(siteNamesTheTrade('First Coast News', roofing), false);

  // The pinned regression: a directory whose name contains the trade word is still a
  // directory, and must not lend its name to a record and leave it a prospect.
  assert.equal(siteNamesTheTrade('National Roofing Directory', roofing), false);
  assert.equal(siteNamesTheTrade('Birdeye Profiles', roofing), false);
});

test('a record is never renamed to the publisher of the site it sits on', () => {
  // Michael's rule, stated as a test. Each of these was produced by a dry run against
  // production and each would have left a directory, a news outlet or a state licensing
  // site sitting in the rep inventory wearing its publisher's name.
  for (const [name, domain, site] of [
    ['Central Air Service - Winter Park HVAC Contractors - Homeyou', 'homeyou.com', 'Homeyou'],
    ['Jacksonville roofing company under investigation by State ...', 'firstcoastnews.com',
      'First Coast News'],
    ['Roofing Contractors in Saint Augustine, FL', 'nationalroofingdirectory.com',
      'National Roofing Directory'],
    ['St. Augustine Roofing - 29 Reviews - Birdeye', 'reviews.birdeye.com', 'Birdeye Profiles'],
  ] as const) {
    assert.equal(proposeTrimmedName({
      canonicalName: name, canonicalDomain: domain, candidateNames: [],
      siteIdentity: { name: site, basis: 'basis=SCHEMA_ORG_NAME' },
      tradeTerms: ['roofing contractor', 'roofer', 'HVAC contractor'],
    }), null, `${site} must not become the name of ${name}`);
  }
});

test('a hostname is not a name, and neither is shorter page copy', () => {
  // Trimming "Contact Us - Hvaccontractorsorlando.net" to its own domain replaces page
  // copy with a URL; a rep still has nothing to say on a call.
  assert.equal(proposeTrimmedName({
    canonicalName: 'Contact Us - Hvaccontractorsorlando.net',
    canonicalDomain: 'hvaccontractorsorlando.net',
    candidateNames: [{ name: 'Hvaccontractorsorlando.net', basis: 'own_site_title' }],
  }), null);

  // And a proposal that is itself a title is not a correction: the dry run offered to
  // rename "Home - St Augustine Roofing Contractor | Fidus" to the same string without
  // the word Home. That candidate is refused, and the record falls through to the brand
  // segment that matches its own domain.
  assert.equal(proposeTrimmedName({
    canonicalName: 'Home - St Augustine Roofing Contractor | Fidus',
    canonicalDomain: 'fidusroofing.com',
    candidateNames: [{ name: 'St Augustine Roofing Contractor | Fidus', basis: 'own_site_title' }],
  })?.name, 'Fidus');
});
