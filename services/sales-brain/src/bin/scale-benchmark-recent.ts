/**
 * Timing the queries added since the last scale benchmark.
 *
 *   SCALE_DATABASE_URL=postgres://.../yad_sales_scale npm run scale:bench:recent
 *
 * Everything here was written against a database with fifty-five rows in it. Run at
 * a hundred thousand Accounts the first time, the duplicate-candidate sweep took 2.1
 * seconds -- 1.15 of it round trips, two queries per candidate pair -- and a
 * three-token "prefilter" I added on the way admitted 80,858 of 97,009 Accounts,
 * making it slower than no filter at all. Both are why this file exists: the numbers
 * were nothing like the guesses.
 */
process.env['DATABASE_URL'] = process.env['SCALE_DATABASE_URL']!;
const { query, closePool } = await import('../db/pool.js');

async function time(label: string, work: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  try {
    await work();
    console.log(`${String(Date.now() - started).padStart(7)}ms  ${label}`);
  } catch (error) {
    console.log(`   FAIL  ${label}: ${(error as Error).message.slice(0, 90)}`);
  }
}

const { rows: sample } = await query<{ account_id: string }>(
  'select account_id from accounts limit 5');
const accountId = sample[0]!.account_id;

const { researchPictureFor } = await import('../domain/researchFacts.js');
const { readinessFor } = await import('../domain/repReady.js');
const { computeCompleteness } = await import('../domain/researchCompleteness.js');
const { primaryContactStanding, overdueContactCount } = await import('../domain/contactConfidence.js');
const { latestListingFacts } = await import('../miner/listingsIngest.js');
const { refreshDuplicateQueue, duplicateQueueCounts } = await import('../domain/duplicateReview.js');
const { marketCoverage } = await import('../miner/coveragePlan.js');
const { captureDiagnostics } = await import('../release/doctor.js');
const { planRetention } = await import('../retention/plan.js');
const { getAccountDetail } = await import('../domain/accountDetail.js');

const { rows: users } = await query<{ user_id: string; role: string }>(
  "select user_id, role from users where role in ('ADMIN','SALES_MANAGER') limit 1");
const viewer = users[0]
  ? { userId: users[0].user_id, role: users[0].role as any }
  : { userId: '00000000-0000-0000-0000-000000000000', role: 'ADMIN' as any };

console.log('\n--- per-Account (a page view) ---');
await time('researchPictureFor', () => researchPictureFor(accountId));
await time('readinessFor', () => readinessFor(accountId));
await time('computeCompleteness', () => computeCompleteness(accountId));
await time('primaryContactStanding', () => primaryContactStanding(accountId));
await time('latestListingFacts', () => latestListingFacts(accountId));
await time('getAccountDetail (whole page)', () => getAccountDetail(accountId, viewer));

console.log('\n--- inventory-wide ---');
await time('overdueContactCount', () => overdueContactCount());
await time('duplicateQueueCounts', () => duplicateQueueCounts());
await time('marketCoverage', () => marketCoverage({ vertical: 'hvac', location: '32095' }));
await time('planRetention (inventory)', () => planRetention());
await time('captureDiagnostics (doctor)', () => captureDiagnostics());

console.log('\n--- the one I expect to hurt ---');
await time('refreshDuplicateQueue', () => refreshDuplicateQueue());

await closePool();
