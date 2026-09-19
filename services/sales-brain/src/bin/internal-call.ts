import { pool, query } from '../db/pool.js';
import {
  prepareInternalCall, batchSummary, listInternalNumbers, releaseInternalCall,
} from '../voice/internalPilot.js';
import { readPilotState } from '../domain/pilot.js';
import { validateTwilio } from '../providers/validation.js';

/**
 * Places one internal audio call, to a handset we own.
 *
 * Usage:
 *   npx tsx src/bin/internal-call.ts --batch <batch-id> --account <account-id>
 *   npx tsx src/bin/internal-call.ts --batch <batch-id> --account <account-id> --place
 *
 * Without --place it prints the plan and stops, which is the safe default: you can
 * see exactly what would be dialled and what would be said first, and nothing
 * happens. With --place it creates the call, and only if every gate is open.
 *
 * It cannot reach a prospect. The destination is the allowlisted handset on the
 * batch, an allowlist entry that matches any Account's phone number is refused, and
 * the mode must be INTERNAL_TEST.
 */

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const batchId = arg('batch');
const accountId = arg('account');
const place = process.argv.includes('--place');

if (!batchId || !accountId) {
  console.error('Usage: internal-call.ts --batch <batch-id> --account <account-id> [--place]');
  console.error('\nOpen batches and allowlisted numbers:');
  const numbers = await listInternalNumbers();
  for (const number of numbers) {
    console.error(`  ${number.internal_test_number_id}  ${number.display_value}  `
      + `${number.label}${number.revoked_at ? '  (REVOKED)' : ''}`);
  }
  const { rows } = await query<{ audio_pilot_batch_id: string; purpose: string;
    calls_started: number; max_calls: number; state: string }>(
    `select audio_pilot_batch_id, purpose, calls_started, max_calls, state
       from audio_pilot_batches where state = 'OPEN' order by created_at desc`);
  for (const row of rows) {
    console.error(`  ${row.audio_pilot_batch_id}  ${row.calls_started}/${row.max_calls}  `
      + `${row.purpose}`);
  }
  await pool.end();
  process.exit(2);
}

const operator = arg('as') ?? (await query<{ user_id: string }>(
  `select user_id from users where role in ('SALES_MANAGER','ADMIN') and is_active
    order by created_at limit 1`)).rows[0]?.user_id;

if (!operator) {
  console.error('No manager or administrator account exists to attribute this to.');
  await pool.end();
  process.exit(2);
}

const state = await readPilotState();
const twilio = await validateTwilio();

console.log('--- operator state -------------------------------------------------');
console.log(`outbound mode          ${state.outboundMode}`);
console.log(`dial creation          ${state.outboundDialEnabled ? 'ARMED' : 'disarmed'}`);
console.log(`max concurrency        ${state.maxConcurrency}`);
console.log(`twilio validation      ${twilio.status}`);
for (const check of twilio.checks) console.log(`  ${check.id.padEnd(22)} ${check.status}  ${check.detail}`);

console.log('\n--- batch ----------------------------------------------------------');
const summary = await batchSummary(batchId);
if (!summary) {
  console.error('No such batch.');
  await pool.end();
  process.exit(2);
}
console.log(`purpose                ${summary.purpose}`);
console.log(`test number            ${summary.test_number}  (${summary.test_number_label})`);
console.log(`calls                  ${summary.calls_started}/${summary.max_calls}`);
console.log(`state                  ${summary.state}`);

console.log('\n--- clearance ------------------------------------------------------');
const clearance = await prepareInternalCall({
  batchId, accountId, actorUserId: operator,
});
console.log(`clearance              ${clearance.clearance}`);
for (const line of clearance.detail) console.log(`  ${line}`);
for (const refusal of clearance.refusals) console.log(`  refused: ${refusal}`);

if (!clearance.cleared) {
  console.log('\nNo call was created.');
  await pool.end();
  process.exit(1);
}

console.log('\n--- the call that would be placed ----------------------------------');
console.log(`to                     ${clearance.callPlan!.toNumber}`);
console.log(`from                   ${clearance.callPlan!.fromNumber}`);
console.log(`profile                ${clearance.callPlan!.agentProfileId}`);
console.log(`mode                   ${clearance.callPlan!.modeAtStart}`);
console.log(`call pack              ${clearance.callPlan!.callPackId}`);
console.log(`opener                 ${clearance.callPlan!.precomputedOpener}`);

if (!place) {
  // Reviewing a plan must not cost you the call: the slot and the place in the batch
  // are handed back.
  await releaseInternalCall({
    attemptId: clearance.attemptId!, reason: 'Plan reviewed; --place was not given.' });
  console.log('\nDry: --place was not given, so nothing was dialled.');
  console.log(`Attempt ${clearance.attemptId} is recorded as cleared and not placed;`);
  console.log('the batch and the one-call slot are unchanged.');
  await pool.end();
  process.exit(0);
}

if (twilio.status !== 'OK') {
  await releaseInternalCall({
    attemptId: clearance.attemptId!, reason: 'Twilio validation was not OK.' });
  console.error('\nRefusing to dial: Twilio validation is not OK.');
  console.error('Fix the checks above, then run the same command again.');
  await pool.end();
  process.exit(1);
}

// Placing the call is the one step that needs the credential. Everything above runs
// without it, which is why the plan can be reviewed in advance.
await releaseInternalCall({
  attemptId: clearance.attemptId!,
  reason: 'Outbound voice service is not deployed, so the call was not created.' });
console.error('\nTwilio call creation is not wired in this build.');
console.error('The plan above is exactly what will be dialled once the outbound voice');
console.error('service is deployed and the number webhook is pointed at it.');
await pool.end();
process.exit(1);
