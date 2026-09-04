/**
 * One-shot demonstration of the PUBLIC_ONLY resolver against a website.
 *   npm run demo:research -- --url http://127.0.0.1:8099/ --name "Marsh Point Air"
 * Intended for verifying the pipeline against a controlled fixture, not for bulk work.
 */
import { withTransaction, query, closePool } from '../db/pool.js';
import { upsertAccount } from '../domain/accounts.js';
import { enqueueContactResearch } from '../workers/enqueue.js';
import { drainQueue } from '../workers/runner.js';
import '../workers/contactResearch.js';

function arg(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const url = arg('url');
const name = arg('name', 'Demo Company');
if (!url) { console.error('Usage: --url <website> [--name <company>] [--vertical <id>] [--hypothesis <category>]'); process.exit(1); }

const { accountId } = await withTransaction((client) => upsertAccount(client, {
  canonicalName: name,
  website: url,
  city: arg('city', 'Jacksonville'), state: arg('state', 'FL'), postalCode: arg('zip', '32256'),
  verticalProfileId: arg('vertical', 'hvac'),
}, { discoverySource: 'demo_research' }));

await query(
  `update accounts set manual_tier = 'A', manual_score = 13, advertiser_strength = 'STRONG',
          last_researched_at = now(), research_fresh_until = now() + interval '3 days'
    where account_id = $1`, [accountId]);

const hypothesis = arg('hypothesis', 'after_hours');
await query(
  `insert into opportunity_hypotheses (account_id, category, hypothesis_text,
     missing_fact_questions, confidence, priority)
   select $1, $2, $3, $4, 'unknown', 10
    where not exists (select 1 from opportunity_hypotheses where account_id = $1 and is_current)`,
  [
    accountId, hypothesis,
    'Advertised 24/7 emergency demand may arrive outside staffed hours.',
    ['When an emergency call comes in after hours and everyone is already on a job, what happens to it?'],
  ],
);

const queued = await enqueueContactResearch(accountId, null as never);
const processed = await drainQueue();
console.log(`ACCOUNT_ID=${accountId}`);
console.log(`queued=${queued.created} processed=${processed}`);
await closePool();
