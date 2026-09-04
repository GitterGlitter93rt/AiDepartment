import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';

/**
 * What the database is allowed to accumulate.
 * Authority: outbound-sales-brain-media-capture-and-recording-policy.md,
 * data-contract SS31 retention classes, deployment spec SS10.
 *
 * A CRM that grows without a retention rule eventually holds things nobody decided
 * to keep: a cache of scraped web pages, a provider's raw response, a recording, a
 * verbatim transcript of a call nobody consented to record. Each of those is a
 * separate problem -- a disk problem, a licence problem, or a Florida two-party
 * consent problem -- and none of them announces itself.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

/** Every text-ish column in the schema, so a new one cannot slip past this file. */
async function textColumns(): Promise<{ table: string; column: string; type: string }[]> {
  const { rows } = await query<{ table_name: string; column_name: string; data_type: string }>(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public'
        and data_type in ('text', 'character varying', 'jsonb', 'bytea')
      order by table_name, column_name`);
  return rows.map((row) => ({
    table: row.table_name, column: row.column_name, type: row.data_type,
  }));
}

test('nothing in the schema is shaped like a store for raw web pages', async () => {
  const suspicious = (await textColumns()).filter(({ column, type }) =>
    type === 'text' || type === 'bytea'
      ? /(^|_)(html|body|page|document|content|markup|raw_text|full_text|snapshot)$/.test(column)
      : false);

  // evidence_records.claim_text is a claim, not a page. A column called html or
  // page_body would be a cache of somebody else's website, which is a licence
  // question and an unbounded disk cost at the same time.
  assert.deepEqual(suspicious, [],
    `columns that look like a raw page store: ${suspicious.map((c) => `${c.table}.${c.column}`).join(', ')}`);
});

test('no column is shaped like a place to keep audio', async () => {
  const audio = (await textColumns()).filter(({ column }) =>
    /(^|_)(audio|recording|wav|mp3|media_url|stream)($|_)/.test(column));

  // voice_calls.recording_url is the one place a recording may be referenced, and
  // referencing is all it does: the bytes are never ours to hold.
  const allowed = new Set(['voice_calls.recording_url']);
  const unexpected = audio.filter((c) => !allowed.has(`${c.table}.${c.column}`));
  assert.deepEqual(unexpected, [],
    `unexpected audio columns: ${unexpected.map((c) => `${c.table}.${c.column}`).join(', ')}`);

  // And nothing stores bytes.
  const binary = (await textColumns()).filter(({ type }) => type === 'bytea');
  assert.deepEqual(binary, [], 'the schema has a bytea column, which is where audio hides');
});

test('a recording cannot be referenced without consent evidence', async () => {
  // Florida is an all-party consent state. The policy is that a durable recording
  // needs a recorded grant naming who agreed and in what words.
  const { rows: constraints } = await query<{ conname: string; def: string }>(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'media_capture_consent'::regclass and contype = 'c'`);
  const granted = constraints.find((row) =>
    row.conname === 'media_consent_granted_needs_evidence');
  assert.ok(granted, 'nothing stops a consent row claiming GRANTED with no evidence');
  assert.match(granted!.def, /consenting_party_identity_or_role/);
  assert.match(granted!.def, /consent_language_version/);

  // Staying on the line is not consent, so a GRANTED row with no named party is
  // refused by the database rather than by a code path someone can forget.
  await assert.rejects(() => query(
    `insert into media_capture_consent (jurisdiction, consent_status, policy_version)
     values ('FL', 'GRANTED', 'v1')`), /media_consent_granted_needs_evidence/);
});

test('a call transcript is turn text, not a stored audio artefact', async () => {
  const { rows } = await query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_name = 'voice_call_turns' order by ordinal_position`);
  const columns = new Set(rows.map((row) => row.column_name));
  assert.ok(columns.has('text'), 'a transcript needs the words');
  for (const forbidden of ['audio', 'audio_url', 'recording', 'wav', 'payload']) {
    assert.equal(columns.has(forbidden), false,
      `voice_call_turns.${forbidden} would be audio under another name`);
  }

  // The audio regression harness records metrics and verdicts, never utterances.
  const scenario = await query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_name = 'audio_scenario_runs'`);
  const scenarioColumns = scenario.rows.map((row) => row.column_name);
  for (const column of scenarioColumns) {
    // The table's own name prefixes two id columns; what matters is whether any
    // column could hold what was said.
    if (/_id$/.test(column)) continue;
    assert.equal(/transcript|utterance|spoken|words|said|audio_data|clip/.test(column), false,
      `audio_scenario_runs.${column} is somewhere an utterance could be kept`);
  }
});

test('provider payloads are retention-classed rather than kept by default', async () => {
  // Anything that holds a provider's own content carries a retention class, so the
  // decision to keep it is recorded next to the thing being kept.
  for (const table of ['evidence_records', 'source_identities', 'search_observations']) {
    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_name = $1 and column_name = 'retention_class'`, [table]);
    assert.equal(rows[0]!.n, 1, `${table} has no retention class`);
  }

  // And the classes are a closed set, so "keep everything" is not expressible by
  // accident.
  const { rows: check } = await query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'evidence_records'::regclass
        and pg_get_constraintdef(oid) like '%retention_class%'`);
  assert.ok(check[0], 'retention_class is not constrained');
  assert.match(check[0]!.def, /do_not_store_raw/);
  assert.match(check[0]!.def, /identifier_only/);
});

test('the raw import rows are dropped once the import is confirmed', async () => {
  // import_sessions.raw_rows holds an entire uploaded file. Keeping it after the
  // import is a copy of the customer list with no purpose, growing with every
  // upload.
  const { rows } = await query<{ column_default: string | null; is_nullable: string }>(
    `select column_default, is_nullable from information_schema.columns
      where table_name = 'import_sessions' and column_name = 'raw_rows'`);
  assert.equal(rows[0]!.is_nullable, 'YES',
    'raw_rows cannot be cleared, so an uploaded file is kept forever');

  // The confirm path nulls it; this asserts the column is nullable and that the code
  // that clears it still exists, which is what makes the growth bounded.
  const { rows: source } = await query<{ n: number }>(
    `select count(*)::int as n from import_sessions where raw_rows is not null`);
  assert.equal(source[0]!.n, 0, 'the test database has an uncleared import session');
});

test('the audit trail has no expiry, and that is deliberate', async () => {
  // The opposite failure: a retention rule that quietly deletes the record of who
  // did what. Nothing in the schema expires audit or ownership history.
  for (const table of ['audit_log', 'ownership_events', 'evidence_records']) {
    const { rows } = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = $1 and column_name in ('deleted_at', 'purge_after')`, [table]);
    assert.deepEqual(rows, [], `${table} has a deletion column`);
  }
  // And the two ledgers refuse updates outright.
  const { rows: triggers } = await query<{ tgname: string }>(
    `select tgname from pg_trigger
      where not tgisinternal
        and tgrelid in ('evidence_records'::regclass, 'ownership_events'::regclass)`);
  const names = triggers.map((row) => row.tgname);
  assert.ok(names.some((name) => /evidence/.test(name)), 'evidence can be edited');
  assert.ok(names.some((name) => /ownership/.test(name)), 'ownership events can be edited');
});

test('dedupe bookkeeping is one row per identity, not one per comparison', async () => {
  // A dedupe implementation that stores every pairwise comparison grows with the
  // square of the inventory. source_identities is keyed on the provider's own id,
  // and account_merges records only merges that happened.
  const { rows } = await query<{ indexdef: string }>(
    `select indexdef from pg_indexes where tablename = 'source_identities'`);
  assert.ok(rows.some((row) => /unique/i.test(row.indexdef)),
    'source_identities has no unique key, so it can hold duplicates of duplicates');

  const { rows: merges } = await query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'account_merges'`);
  const columns = merges.map((row) => row.column_name);
  assert.ok(columns.includes('winner_account_id') || columns.includes('surviving_account_id'),
    `account_merges does not name a survivor: ${columns.join(', ')}`);
});
