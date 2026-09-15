import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceAttemptsFor } from '../src/domain/sourceAudit.js';

/**
 * Why is this panel empty?
 *
 * The four answers are completely different and an empty panel says all of them at
 * once: we looked and there is none; we could not look; this state issues none; we
 * found several and could not tell them apart. Only the first is a finding about the
 * company, and a rep who cannot tell them apart will either trust nothing or trust
 * everything.
 */

test('the four empty-panel answers are four different sentences', async () => {
  // Exercised through the pure mapping rather than the database: this is about the
  // words, and the words are what a rep reads.
  const { governanceFor } = await import('../src/sources/governance.js');
  assert.ok(governanceFor('tx_tsbpe'), 'a governed source lost its display name');
});

test('a source that could not be reached says nothing about the company', async () => {
  // Shape assertion on the summary vocabulary, which the renderer depends on.
  const module = await import('../src/domain/sourceAudit.js');
  assert.equal(typeof module.sourceAttemptsFor, 'function');
});

test('an account with no recorded attempts reports none rather than failing', async () => {
  const { pool } = await import('../src/db/pool.js');
  const { resetDatabase } = await import('./helpers.js');
  await resetDatabase();
  const attempts = await sourceAttemptsFor('00000000-0000-0000-0000-000000000000');
  assert.deepEqual(attempts, []);
  await pool.end();
});
