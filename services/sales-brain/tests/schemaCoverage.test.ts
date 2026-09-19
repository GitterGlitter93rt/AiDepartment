import './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';

/**
 * Columns the schema has and the product never names.
 *
 * The campaign's recurring defect was configuration written down and never read, and
 * the schema is the last place it hides: `last_researched_at`, written by nothing, is
 * why the live box read zero rep-ready; `saturation_state`, `target_inventory_depth`
 * and `retention_class` were each found the same way. A column nobody names is
 * either a decision somebody made or a promise somebody forgot.
 *
 * This pins the count so it can only fall, and reviews the ones that matter. It is
 * deliberately not a list of ninety-four apologies: surrogate keys the code never
 * mentions are normal, and the interesting cases are named below.
 *
 * The detector is name-based, which is its known limit: a column name that two tables
 * share cannot be told apart, so writing `jurisdiction` for eligibility decisions
 * also makes it look read on `media_capture_consent`. That is why the count is a
 * ceiling rather than a census -- it undercounts, never over -- and why the reviewed
 * entries below are the uniquely named ones.
 */

const PINNED_UNREAD = 92;

/**
 * Reviewed rather than assumed. Each of these was checked against the code that
 * would use it, and the reason is why it is empty rather than broken.
 */
const REVIEWED: Record<string, string> = {
  'media_capture_consent.consenting_party_identity_or_role':
    'Nothing writes consent, so nothing may record. `mediaCaptureAllowed` refuses '
    + 'when no row exists and names the Florida default, and a table constraint makes '
    + 'GRANTED impossible without this column. Empty because recording is off, and '
    + 'fail-closed by construction.',
  'media_capture_consent.consent_language_version':
    'Same row, same reason: the words somebody agreed to, required by constraint '
    + 'before a consent can be GRANTED. No consent-capture path exists yet.',
  'mining_jobs.required_signals':
    'The whole table is superseded by `jobs` with job_type market_mine, is written by '
    + 'nothing and holds no rows. Named here so nobody builds on it.',
  'evidence_records.supersedes_evidence_id':
    'Evidence supersession is expressed by `contradicted_by_evidence_id`, which is '
    + 'read. Two ways to say one thing, and the read one is the one in use.',
  'evidence_records.independently_verified':
    'Confidence and can_state_as_fact carry this today. A second flag nothing sets is '
    + 'better than a second flag half-set.',
  'integration_settings.secret_last4':
    'A settings screen could show "key set, ending 1234". It shows configured or not '
    + 'instead, which is enough to act on and stores less of a credential.',
};

before(async () => {
  // Reads the schema rather than product data, but reset anyway: several tests rename
  // a table and restore it in a finally, and a run that died mid-rename would leave a
  // `_hidden` table behind and skew the census. Starting from a known state, and the
  // assertion below refuses to count a schema that is missing a piece.
  await resetDatabase();
});
after(async () => { await pool.end(); });

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

let cached: string | null = null;
function allSource(): string {
  if (cached === null) {
    cached = sourceFiles('src').map((path) => readFileSync(path, 'utf8')).join('\n');
  }
  return cached;
}

/** A surrogate key the code never names is ordinary, not a dead promise. */
function isSurrogateKey(table: string, column: string): boolean {
  const singular = table.replace(/ies$/, 'y').replace(/s$/, '');
  return column === `${singular}_id` || column === `${table}_id`;
}

async function unreadColumns(): Promise<{ table: string; column: string }[]> {
  const { rows } = await query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`);
  const source = allSource();
  return rows
    .filter((row) => !/^(created_at|updated_at)$/.test(row.column_name))
    .filter((row) => !isSurrogateKey(row.table_name, row.column_name))
    .filter((row) => !source.includes(row.column_name))
    .map((row) => ({ table: row.table_name, column: row.column_name }));
}

test('the schema being counted is whole', async () => {
  // A leftover rename would make the census wrong in a way that looks like progress:
  // a hidden table's columns simply stop being counted.
  const { rows } = await query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name like '%\\_hidden'`);
  assert.deepEqual(rows.map((row) => row.table_name), [],
    'a test renamed a table and did not restore it, so this count is not a count');
});

test('the number of columns nothing reads does not grow', async () => {
  const unread = await unreadColumns();
  assert.ok(unread.length <= PINNED_UNREAD,
    `${unread.length} columns are never named in src, up from ${PINNED_UNREAD}. A new `
    + 'one is either a promise nothing keeps or a decision worth writing down: '
    + unread.slice(0, 12).map((c) => `${c.table}.${c.column}`).join(', '));
});

test('a reviewed column is still in the schema and still unread', async () => {
  const unread = new Set((await unreadColumns()).map((c) => `${c.table}.${c.column}`));
  const { rows } = await query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'`);
  const exists = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));

  for (const key of Object.keys(REVIEWED)) {
    assert.ok(exists.has(key), `${key} no longer exists; its review should go too`);
    assert.ok(unread.has(key),
      `${key} is now read by something, so the reason recorded for it is out of date`);
  }
});

test('the compliance columns that decide a call are written', async () => {
  // The find this file came from. `channel_eligibility_decisions` is append-only by
  // trigger and exists to prove afterwards that a call was inside permitted hours.
  // It had columns for the jurisdiction and the destination's local time, and the
  // insert wrote neither -- so the row said ALLOW with a UTC timestamp, and
  // answering "was that inside their local window" meant re-deriving the timezone
  // from whatever the data says today.
  const source = allSource();
  for (const column of ['jurisdiction', 'local_time_evaluated']) {
    assert.ok(source.includes(column), `${column} is not named in the source at all`);
  }
  assert.match(source, /jurisdiction, local_time_evaluated/,
    'the eligibility insert no longer records what the decision was made under');
});

test('every reason recorded here is a reason, not a shrug', () => {
  for (const [key, reason] of Object.entries(REVIEWED)) {
    assert.ok(reason.length > 90, `${key} has a review too short to be one`);
    assert.doesNotMatch(reason, /^(unused|not used|legacy)\.?$/i,
      `${key} is dismissed rather than explained`);
  }
});
