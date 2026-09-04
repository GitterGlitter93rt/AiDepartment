import { pool, query } from '../db/pool.js';
import {
  allowlistInternalNumber, openAudioPilotBatch, stopAudioPilotBatch, listInternalNumbers,
  revokeInternalNumber,
} from '../voice/internalPilot.js';
import { setPilotSwitch, readPilotState, stopNewOutboundCalls } from '../domain/pilot.js';

/**
 * Operator commands for the internal audio pilot.
 *
 * Everything here is a deliberate act with a reason attached, and none of it dials.
 *
 *   allowlist  --phone <e164> --label <text> --why <text>
 *   revoke     --id <internal-test-number-id> --why <text>
 *   batch      --number <internal-test-number-id> --max <1-10> --why <text>
 *   arm        --why <text>          set INTERNAL_TEST and arm dial creation
 *   stop       --why <text>          STOP NEW OUTBOUND CALLS, everywhere
 *   stop-batch --batch <id> --why <text>
 *   status
 */

const command = process.argv[2];
const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const operator = arg('as') ?? (await query<{ user_id: string }>(
  `select user_id from users where role in ('SALES_MANAGER','ADMIN') and is_active
    order by created_at limit 1`)).rows[0]?.user_id;

if (!operator) {
  console.error('No manager or administrator account exists to attribute this to.');
  await pool.end();
  process.exit(2);
}

function require(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`--${name} is required.`);
    process.exit(2);
  }
  return value;
}

switch (command) {
  case 'allowlist': {
    const result = await allowlistInternalNumber({
      phone: require('phone'), label: require('label'),
      justification: require('why'), actorUserId: operator,
    });
    console.log(result.ok
      ? `Allowlisted. id ${result.internalTestNumberId}`
      : `Refused: ${result.message}`);
    process.exitCode = result.ok ? 0 : 1;
    break;
  }
  case 'revoke': {
    const result = await revokeInternalNumber({
      internalTestNumberId: require('id'), actorUserId: operator, reason: require('why') });
    console.log(result.ok ? 'Revoked.' : `Refused: ${result.message}`);
    process.exitCode = result.ok ? 0 : 1;
    break;
  }
  case 'batch': {
    const result = await openAudioPilotBatch({
      internalTestNumberId: require('number'), maxCalls: Number(require('max')),
      purpose: require('why'), actorUserId: operator,
    });
    console.log(result.ok ? `Batch open. id ${result.batchId}` : `Refused: ${result.message}`);
    process.exitCode = result.ok ? 0 : 1;
    break;
  }
  case 'arm': {
    const why = require('why');
    await setPilotSwitch({ field: 'outbound_mode', value: 'INTERNAL_TEST',
      actorUserId: operator, reason: why });
    await setPilotSwitch({ field: 'outbound_dial_enabled', value: 'true',
      actorUserId: operator, reason: why });
    const state = await readPilotState();
    console.log(`mode ${state.outboundMode}, dial creation `
      + `${state.outboundDialEnabled ? 'ARMED' : 'disarmed'}, concurrency ${state.maxConcurrency}`);
    break;
  }
  case 'stop': {
    const result = await stopNewOutboundCalls(operator, require('why'));
    const state = await readPilotState();
    console.log(`STOPPED. mode ${state.outboundMode}, dial creation `
      + `${state.outboundDialEnabled ? 'ARMED' : 'disarmed'}, `
      + `${result.unqueued} queued candidate(s) returned to review.`);
    break;
  }
  case 'stop-batch': {
    const result = await stopAudioPilotBatch({
      batchId: require('batch'), actorUserId: operator, reason: require('why') });
    console.log(result.ok ? 'Batch stopped.' : `Refused: ${result.message}`);
    process.exitCode = result.ok ? 0 : 1;
    break;
  }
  case 'status': {
    const state = await readPilotState();
    console.log(`outbound mode          ${state.outboundMode}`);
    console.log(`dial creation          ${state.outboundDialEnabled ? 'ARMED' : 'disarmed'}`);
    console.log(`max concurrency        ${state.maxConcurrency}`);
    console.log(`inbound receptionist   ${state.inboundReceptionist ? 'on' : 'off'}`);
    if (state.stopReason) console.log(`last stop              ${state.stopReason}`);

    console.log('\nallowlisted numbers');
    for (const number of await listInternalNumbers()) {
      console.log(`  ${number.internal_test_number_id}  ${number.display_value.padEnd(16)}`
        + `  ${number.label}${number.revoked_at ? '  (REVOKED)' : ''}`);
    }

    const batches = await query<any>(
      `select audio_pilot_batch_id, purpose, calls_started, max_calls, state
         from audio_pilot_batches order by created_at desc limit 10`);
    console.log('\nbatches');
    for (const row of batches.rows) {
      console.log(`  ${row.audio_pilot_batch_id}  ${row.state.padEnd(8)}  `
        + `${row.calls_started}/${row.max_calls}  ${row.purpose}`);
    }

    const active = await query<{ n: number }>(
      `select count(*)::int as n from audio_pilot_attempts
        where clearance = 'INTERNAL_TEST_ALLOW' and outcome is null`);
    console.log(`\nopen internal calls    ${active.rows[0]!.n}`);
    break;
  }
  default:
    console.error('Commands: allowlist, revoke, batch, arm, stop, stop-batch, status');
    process.exitCode = 2;
}

await pool.end();
