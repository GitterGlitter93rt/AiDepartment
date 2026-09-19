import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import {
  contactStanding, primaryContactStanding, overdueContactCount, GRACE_DAYS,
} from '../src/domain/contactConfidence.js';
import { buildCallPack } from '../src/callbrain/callPack.js';
import { operationalSnapshot } from '../src/api/operations.js';

/**
 * Whether the name we hand a rep is still the person to ask for.
 * Authority: Issue #3 L.
 *
 * The resolver derives role confidence honestly and then sets
 * `refresh_due_at = now() + 30 days` on every contact -- and nothing has ever read
 * that column. So confidence never decayed. A person resolved eighteen months ago
 * still read as current, the call pack handed the rep a bare name, and the rep asked
 * the receptionist confidently for somebody who left a year ago. That is the one
 * cold-call mistake you cannot recover from in the same call: the gatekeeper now
 * knows the list is old.
 *
 * What this adds is a distinction between two things that had been one. "Nobody has
 * checked in eight months" is not "they left", and a rep does something different
 * with each: the first is asked as a question, the second is not asked at all.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function accountWithContact(input: {
  name?: string; roleConfidence?: string; currentness?: string; status?: string;
  verifiedDaysAgo?: number | null; refreshDueDaysAgo?: number | null;
  rolePlaceholder?: boolean;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Standing Co ${sequence}`,
    website: `https://standing${sequence}.invalid`,
    phone: `904-555-${String(7000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));

  await query(
    `insert into contacts (account_id, full_name, raw_title, role_category,
                           is_role_placeholder, role_confidence, currentness, status,
                           decision_maker_priority, last_verified_at, refresh_due_at)
     values ($1, $2, 'Owner', 'owner', $3, $4, $5, $6, 1,
             case when $7::int is null then null
                  else now() - ($7 || ' days')::interval end,
             case when $8::int is null then null
                  else now() - ($8 || ' days')::interval end)`,
    [accountId,
      input.rolePlaceholder ? null : (input.name ?? 'Dana Fielder'),
      input.rolePlaceholder ?? false,
      input.roleConfidence ?? 'LIKELY_CURRENT_ROLE',
      input.currentness ?? 'FRESH',
      input.status ?? 'ACTIVE',
      input.verifiedDaysAgo === undefined ? 10 : input.verifiedDaysAgo,
      input.refreshDueDaysAgo === undefined ? null : input.refreshDueDaysAgo]);
  return accountId;
}

// --------------------------------------------------- aged is not historical -----

test('nobody having checked is not the same as somebody having left', async () => {
  const aged = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'LIKELY_CURRENT_ROLE', currentness: 'FRESH', status: 'ACTIVE',
    lastVerifiedAt: new Date(Date.now() - 400 * 86_400_000),
    refreshDueAt: new Date(Date.now() - 370 * 86_400_000),
  });
  const gone = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'HISTORICAL_ROLE', currentness: 'STALE', status: 'LEFT_COMPANY',
    lastVerifiedAt: new Date(), refreshDueAt: new Date(Date.now() + 86_400_000),
  });

  assert.equal(aged.confidence, 'AGED');
  assert.equal(gone.confidence, 'HISTORICAL');
  assert.notEqual(aged.guidance, gone.guidance);

  // The aged name is still worth using; the historical one is not.
  assert.match(aged.guidance, /Ask for them by name, and confirm/);
  assert.match(gone.guidance, /Do not ask for them by name/);
});

test('an aged name says how long it has been, so a rep can judge it', async () => {
  const standing = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'LIKELY_CURRENT_ROLE', currentness: 'FRESH', status: 'ACTIVE',
    lastVerifiedAt: new Date(Date.now() - 250 * 86_400_000),
    refreshDueAt: new Date(Date.now() - 220 * 86_400_000),
  });
  assert.equal(standing.ageDays, 250);
  assert.match(standing.guidance, /250 days/);
});

test('a name inside its window needs no hedge', async () => {
  const standing = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'CONFIRMED_CURRENT_ROLE', currentness: 'FRESH', status: 'ACTIVE',
    lastVerifiedAt: new Date(Date.now() - 5 * 86_400_000),
    refreshDueAt: new Date(Date.now() + 25 * 86_400_000),
  });
  assert.equal(standing.confidence, 'CONFIRMED_CURRENT');
  assert.equal(standing.safeToAskByName, true);
});

test('the grace period stops every name being hedged the day after it is due', async () => {
  // A warning that fires too easily is a warning a rep learns to ignore, and then
  // the real one is ignored too.
  const justDue = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'LIKELY_CURRENT_ROLE', currentness: 'FRESH', status: 'ACTIVE',
    lastVerifiedAt: new Date(Date.now() - 31 * 86_400_000),
    refreshDueAt: new Date(Date.now() - 1 * 86_400_000),
  });
  assert.equal(justDue.confidence, 'LIKELY_CURRENT',
    'a name one day past its re-check date was hedged');

  const wellPast = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false,
    roleConfidence: 'LIKELY_CURRENT_ROLE', currentness: 'FRESH', status: 'ACTIVE',
    lastVerifiedAt: new Date(Date.now() - (GRACE_DAYS + 40) * 86_400_000),
    refreshDueAt: new Date(Date.now() - (GRACE_DAYS + 10) * 86_400_000),
  });
  assert.equal(wellPast.confidence, 'AGED');
});

test('a role with no name is never dressed up as a person', async () => {
  const standing = contactStanding({
    fullName: null, isRolePlaceholder: true, roleConfidence: 'ROLE_ONLY_TARGET',
    currentness: 'UNKNOWN', status: 'ACTIVE', lastVerifiedAt: new Date(),
    refreshDueAt: null,
  });
  assert.equal(standing.confidence, 'ROLE_ONLY');
  assert.equal(standing.safeToAskByName, false);
  assert.match(standing.guidance, /rather than inventing a person/);
});

test('a name with nothing confirming the role says so', async () => {
  const standing = contactStanding({
    fullName: 'Dana Fielder', isRolePlaceholder: false, roleConfidence: 'UNKNOWN_ROLE',
    currentness: 'UNKNOWN', status: 'ACTIVE', lastVerifiedAt: new Date(),
    refreshDueAt: new Date(Date.now() + 86_400_000),
  });
  assert.equal(standing.confidence, 'UNKNOWN');
  assert.equal(standing.safeToAskByName, false);
  assert.match(standing.guidance, /let the gatekeeper correct you/);
});

// ------------------------------------------------------- read from the record ---

test('the standing of the person a rep would be told to ask for', async () => {
  const accountId = await accountWithContact({
    verifiedDaysAgo: 300, refreshDueDaysAgo: 270 });
  const standing = (await primaryContactStanding(accountId))!;
  assert.equal(standing.fullName, 'Dana Fielder');
  assert.equal(standing.standing.confidence, 'AGED');
  assert.equal(standing.standing.overdue, true);
});

test('a contact somebody reported gone is never the one we ask for', async () => {
  const accountId = await accountWithContact({
    status: 'LEFT_COMPANY', roleConfidence: 'HISTORICAL_ROLE' });
  const standing = await primaryContactStanding(accountId);
  // Only ACTIVE contacts are considered at all, so a departed person is not offered.
  assert.equal(standing, null,
    'a person a gatekeeper said had left was still the primary contact');
});

// -------------------------------------------------------------- the call pack ---

test('the call pack carries the name and how sure we are of it', async () => {
  const accountId = await accountWithContact({
    verifiedDaysAgo: 400, refreshDueDaysAgo: 370 });
  const pack = await buildCallPack(accountId);

  assert.equal(pack!.contactName, 'Dana Fielder',
    'an aged name was withheld entirely, which throws away real information');
  assert.equal(pack!.contactConfidence, 'AGED');
  assert.equal(pack!.contactSafeToAskByName, false);
  assert.match(pack!.contactGuidance, /confirm they still hold the role/);

  // And a fallback route, so "ask for Dana, and if she has moved on, whoever handles
  // it now" is available as an opening rather than either half alone.
  assert.ok(pack!.askForRoute, 'an aged name was given with no fallback route');
});

test('a current name comes with no hedge and no fallback', async () => {
  const accountId = await accountWithContact({
    roleConfidence: 'CONFIRMED_CURRENT_ROLE', verifiedDaysAgo: 3,
    refreshDueDaysAgo: null });
  const pack = await buildCallPack(accountId);

  assert.equal(pack!.contactConfidence, 'CONFIRMED_CURRENT');
  assert.equal(pack!.contactSafeToAskByName, true);
  assert.equal(pack!.askForRoute, null,
    'a confirmed name was given a fallback route, which hedges a fact we are sure of');
});

test('an account with no contact at all tells the rep what to do', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'No Contact Co', website: 'https://nocontact.invalid',
    phone: '904-555-7900', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  const pack = await buildCallPack(accountId);

  assert.equal(pack!.contactSafeToAskByName, false);
  assert.match(pack!.contactGuidance, /Ask for whoever handles it/);
});

// ---------------------------------------------------------------- the panel -----

test('the operations page reports the list quietly ageing', async () => {
  await accountWithContact({ verifiedDaysAgo: 400, refreshDueDaysAgo: 370 });
  await accountWithContact({ verifiedDaysAgo: 5, refreshDueDaysAgo: null });

  const counts = await overdueContactCount();
  assert.equal(counts.overdue, 1);
  assert.equal(counts.named, 2);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'contact_freshness')!;
  assert.match(check.value, /1 of 2 overdue/);
  assert.match(check.detail!, /not the same as them having left/,
    'the panel conflates nobody-having-looked with somebody-having-left');
});

test('with every name re-checked the panel says so', async () => {
  await accountWithContact({ verifiedDaysAgo: 3, refreshDueDaysAgo: null });
  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'contact_freshness')!;
  assert.equal(check.state, 'OK');
  assert.match(check.value, /all re-checked/);
});
