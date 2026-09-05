/**
 * Re-evaluates phone channel eligibility.
 *   npm run rescreen                    -- every account with a phone endpoint
 *   npm run rescreen -- --account <id>  -- one account
 *
 * Safe to run repeatedly: it writes decisions and contacts nobody.
 */
import { closePool, query } from '../db/pool.js';
import { evaluateAccount } from '../compliance/eligibility.js';

const index = process.argv.indexOf('--account');
const single = index === -1 ? null : (process.argv[index + 1] ?? null);

const accounts = single
  ? [{ account_id: single }]
  : (await query<{ account_id: string }>(
      `select distinct account_id from contact_endpoints where endpoint_type = 'PHONE'`,
    )).rows;

let endpoints = 0;
for (const row of accounts) endpoints += await evaluateAccount(row.account_id);
console.log(`[rescreen] evaluated ${endpoints} phone endpoints across ${accounts.length} accounts.`);
await closePool();
