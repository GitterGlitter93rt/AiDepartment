import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles, getVerticalProfile } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { buildCallPack } from '../src/callbrain/callPack.js';
import { composeSystemPrompt } from '../src/callbrain/prompt.js';
import { createCallContext, type AvailableTools } from '../src/callbrain/stateMachine.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';

/**
 * The prohibitions a vertical declares, reaching the mouth that speaks.
 *
 * Two readers looked up `profile.opportunity_hypotheses`, and no profile has a
 * section by that name -- they are `leak_hypotheses`. So both loops ran over an
 * empty array: not one vertical-specific prohibition reached the Call Pack, whose
 * whole purpose is to say what may and may not be said, or the page a rep reads
 * before dialling. And `safety_boundaries` was read by nothing at all.
 *
 * For roofing those are regulated rather than merely unwise. A profile that says
 * "unauthorized public adjusting" is describing a licensed activity, and the agent
 * had no instruction against it. Outbound dialling is disabled, so nothing was ever
 * said -- which is the only reason this is a defect and not an incident.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function accountIn(vertical: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Safety Fixture ${sequence}`,
    website: `https://safety${sequence}.invalid`,
    phone: `904-555-${String(7100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical,
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

// The real context and tool shapes, built the way the runtime builds them: a
// hand-made object stops testing the thing that reads it.
const TOOLS: AvailableTools = {
  booking: true, suppression: true, followUp: true, transfer: false, sms: false,
  email: true,
};

// ------------------------------------------------------- the regulated claims ---

test('a roofing call is told not to make insurance or adjusting claims', async () => {
  const pack = await buildCallPack(await accountIn('roofing'));
  assert.ok(pack, 'no call pack was built');
  const said = pack!.prohibitedClaims.join('\n').toLowerCase();

  for (const claim of ['insurance coverage decision', 'legal interpretation',
    'unauthorized public adjusting', 'guaranteed claim outcome']) {
    assert.ok(said.includes(claim),
      `the roofing profile prohibits "${claim}" and the agent was never told`);
  }

  // The profile's own escalation sentence, verbatim: rewriting a compliance
  // instruction into our own words is how its meaning drifts.
  const profile = await getVerticalProfile('roofing');
  const escalation = (profile.safety_boundaries as any[])
    .map((boundary) => boundary.escalation_guidance).filter(Boolean);
  assert.ok(escalation.length > 0, 'the fixture no longer tests escalation');
  for (const sentence of escalation) {
    assert.ok(pack!.prohibitedClaims.includes(String(sentence).trim()),
      `the escalation instruction was dropped or reworded: "${sentence}"`);
  }
});

test('the prohibition reaches the prompt the model is given', async () => {
  // The pack carrying it is not the point. The prompt is.
  const pack = await buildCallPack(await accountIn('roofing'));
  const context = createCallContext(TOOLS, 'after_hours');
  const prompt = composeSystemPrompt({
    pack: pack!, context, agentName: 'Alex', tools: TOOLS });

  assert.match(prompt, /## You must not say/);
  assert.match(prompt, /unauthorized public adjusting/i,
    'the prompt an AI voice agent speaks from has no instruction against it');
  assert.match(prompt, /Route claim-specific, coverage, legal and adjusting questions/,
    'the escalation sentence never reached the prompt');
});

test('each vertical gets its own boundaries and not another one', async () => {
  const collision = await buildCallPack(await accountIn('collision-repair'));
  const said = collision!.prohibitedClaims.join('\n').toLowerCase();
  for (const claim of ['vehicle safety clearance', 'structural repair judgment']) {
    assert.ok(said.includes(claim), `collision repair prohibits "${claim}"`);
  }
  assert.ok(!said.includes('public adjusting'),
    'a collision shop was given the roofing insurance boundary');

  const plumbing = await buildCallPack(await accountIn('plumbing'));
  const plumbingSaid = plumbing!.prohibitedClaims.join('\n').toLowerCase();
  assert.ok(plumbingSaid.includes('emergency hazard decision'),
    'plumbing prohibits deciding an emergency hazard without escalation');
});

test('the must-not-claim list a vertical declares arrives too', async () => {
  // The other half of the same wrong section name.
  const pack = await buildCallPack(await accountIn('roofing'));
  const profile = await getVerticalProfile('roofing');
  const declared = (profile.leak_hypotheses as any[])
    .flatMap((hypothesis) => hypothesis?.must_not_claim ?? []);
  assert.ok(declared.length > 0, 'the fixture no longer tests must_not_claim');

  const said = pack!.prohibitedClaims.join('\n').toLowerCase();
  for (const token of declared) {
    const words = String(token).replace(/_/g, ' ').toLowerCase();
    assert.ok(said.includes(words),
      `the roofing profile says do not claim "${words}" and nothing said so`);
  }
});

// --------------------------------------------------------------- and the rep ----

test('a rep reads the same prohibitions before dialling', async () => {
  const accountId = await accountIn('roofing');
  const manager = await makeUser(`Safety Manager ${Date.now()}`, 'SALES_MANAGER');
  const detail = await getAccountDetail(accountId,
    { userId: manager.userId, role: 'SALES_MANAGER' });

  const said = detail!.prohibitedClaims.join('\n').toLowerCase();
  assert.ok(said.includes('unauthorized public adjusting'),
    'the screen a rep reads before a roofing call omits a regulated boundary');
  assert.ok(said.includes('insurance coverage decision'));
});

// ------------------------------------------------------------ still universal ---

test('the universal prohibitions are not displaced by the vertical ones', async () => {
  const pack = await buildCallPack(await accountIn('roofing'));
  const said = pack!.prohibitedClaims.join('\n');
  assert.match(said, /Do not state or estimate their advertising spend/);
  assert.match(said, /Do not claim a referral/);
  assert.match(said, /Do not promise ROI/);
});

test('a company with no vertical still gets the universal set', async () => {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `No Vertical ${sequence}`, website: `https://nov${sequence}.invalid`,
    phone: '904-555-7999', city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: 'import' }));
  const pack = await buildCallPack(accountId);
  assert.ok(pack!.prohibitedClaims.length >= 8,
    'an account with no profile lost the universal prohibitions');
});

test('every vertical with a boundary section has it reach a pack', async () => {
  // The guard, rather than three examples: any profile that declares a boundary and
  // whose prohibitions do not arrive is the same defect again under another name.
  const ids = ['roofing', 'collision-repair', 'plumbing', 'hvac', 'electrical',
    'dental', 'law-firms', 'pdr-hail'];
  for (const id of ids) {
    const profile = await getVerticalProfile(id);
    if (!profile) continue;
    const declared: string[] = (profile.safety_boundaries ?? [])
      .flatMap((boundary: any) => boundary?.prohibited_agent_claims ?? [])
      .map((token: unknown) => String(token).replace(/_/g, ' ').toLowerCase());
    if (declared.length === 0) continue;

    const pack = await buildCallPack(await accountIn(id));
    const said = pack!.prohibitedClaims.join('\n').toLowerCase();
    for (const claim of declared) {
      assert.ok(said.includes(claim),
        `${id} declares the boundary "${claim}" and the call pack does not carry it`);
    }
  }
});

// ------------------------------------------------ when there is no sale here ----

test('the agent is told what counts as no sale in this trade', async () => {
  // Every profile declares `no_sale_conditions` and nothing read the section. The
  // call brain already knew how to stop -- the state machine records NOT_A_FIT and a
  // grader checks the exit was respectful -- but not what counts as one here, so
  // "they demand guaranteed sales" was a condition only a human would recognise.
  const pack = await buildCallPack(await accountIn('roofing'));
  assert.ok(pack!.noSaleConditions.length > 0,
    'the vertical declares no-sale conditions and the pack carries none');

  const profile = await getVerticalProfile('roofing');
  const declared = (profile.no_sale_conditions as string[])
    .map((condition) => condition.replace(/_/g, ' '));
  for (const condition of declared) {
    assert.ok(pack!.noSaleConditions.includes(condition),
      `the profile says there is no sale when "${condition}" and the pack omits it`);
  }

  const context = createCallContext(TOOLS, 'after_hours');
  const prompt = composeSystemPrompt({
    pack: pack!, context, agentName: 'Alex', tools: TOOLS });
  assert.match(prompt, /## When there is no sale here/);
  assert.match(prompt, /company demands guaranteed sales/,
    'the prompt does not tell the agent to stop when they demand guaranteed sales');
  assert.match(prompt, /end the call well/i);
});

test('a no-sale condition is separate from a prohibited claim', async () => {
  // Different instructions. One is a thing that must not be said; the other is a
  // reason to stop selling and leave well.
  const pack = await buildCallPack(await accountIn('roofing'));
  for (const condition of pack!.noSaleConditions) {
    assert.ok(!pack!.prohibitedClaims.includes(condition),
      'a reason to stop selling was filed as a claim that must not be made');
  }
  const context = createCallContext(TOOLS, 'after_hours');
  const prompt = composeSystemPrompt({
    pack: pack!, context, agentName: 'Alex', tools: TOOLS });
  assert.ok(prompt.indexOf('## You must not say') < prompt.indexOf('## When there is no sale'),
    'the two sections were merged or reordered into one instruction');
});

test('the conditions are snapshotted with the pack, not read at call time', async () => {
  // A pack is the record of what the agent was allowed to say. A profile edited
  // afterwards must not change what a past call is judged against.
  const accountId = await accountIn('roofing');
  const pack = await buildCallPack(accountId);
  const { persistCallPack } = await import('../src/callbrain/callPack.js');
  const callPackId = await persistCallPack(pack!, null);

  const { rows } = await query<{ no_sale_conditions: string[] }>(
    'select no_sale_conditions from call_packs where call_pack_id = $1', [callPackId]);
  assert.deepEqual(rows[0]!.no_sale_conditions, pack!.noSaleConditions,
    'the pack was stored without the conditions it was built with');
});
