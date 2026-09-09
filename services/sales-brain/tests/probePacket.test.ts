import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { simulateBatch, renderBatchReport } from '../src/probe/packet.js';

/**
 * The dry-run acceptance gate.
 *
 * One batch through the whole subsystem, asserting the properties that make it safe
 * to have built at all. It runs at 40 rather than 100 to keep the suite quick; the
 * shape is identical, and the operator packet runs the full hundred.
 */

test('a whole batch runs end to end and sends nothing', async () => {
  await resetDatabase();
  await syncVerticalProfiles();

  const report = await simulateBatch({ size: 40, poolSize: 10 });

  // The headline guarantee.
  assert.equal(report.submissionsActuallySent, 0);
  assert.ok(report.liveBlockedBy.length >= 5,
    'every reason a live submission is blocked should be listed, not just the first');
  assert.match(report.liveBlockedBy.join(' | '), /no live submission transport/,
    'the absence of a transport should be listed as a blocker');

  // Every category the operator asked to see actually occurs, so the packet is not
  // quietly reporting zeroes for paths that never ran.
  assert.ok((report.counts['eligible_planned'] ?? 0) > 0, 'eligible_planned');
  assert.ok((report.counts['simulated_submissions'] ?? 0) > 0, 'simulated_submissions');
  assert.ok((report.counts['collision_deferred'] ?? 0) > 0,
    'a franchise cluster larger than the pool must produce deferrals');
  assert.ok((report.counts['simulated_automated_acknowledgements'] ?? 0) > 0, 'auto acks');
  assert.ok((report.counts['simulated_human_callbacks'] ?? 0) > 0, 'human callbacks');
  assert.ok((report.counts['no_attributable_response'] ?? 0) > 0, 'no response');
  assert.ok((report.counts['ambiguous_callbacks'] ?? 0) > 0, 'genuine ambiguity');
  assert.equal(report.counts['ambiguity_demo_candidates'], 2,
    'both similarly named companies should remain plausible');
  assert.ok((report.counts['business_hours_known'] ?? 0) > 0, 'hours known');
  assert.ok((report.counts['business_hours_unknown'] ?? 0) > 0, 'hours unknown');
  assert.ok((report.counts['submit_failed_simulated'] ?? 0) > 0, 'simulated 500');
  assert.ok((report.counts['awaiting_manual_resolution'] ?? 0) > 0, 'simulated crash');

  // Every form-refusal reason is exercised.
  for (const reason of [
    'INELIGIBLE_CONSENT_GATE', 'INELIGIBLE_TERMS_GATE', 'INELIGIBLE_CAPTCHA',
    'INELIGIBLE_DISPATCH_ONLY', 'INELIGIBLE_REQUIRES_FABRICATED_FACT',
    'INELIGIBLE_NO_FORM', 'INELIGIBLE_ANTI_AUTOMATION_NOTICE', 'INELIGIBLE_VERTICAL',
  ]) {
    assert.ok((report.ineligibleByReason[reason] ?? 0) > 0, `${reason} never occurred`);
  }

  // Cooldown and audit suppression both refuse.
  assert.ok((report.refusalsByReason['IN_COOLDOWN'] ?? 0) > 0, 'cooldown refusal');
  assert.ok((report.refusalsByReason['PROBE_SUPPRESSED'] ?? 0) > 0, 'audit suppression');

  // The safety property: not one simulated measurement became evidence.
  assert.ok(report.publishAttempts.length > 0, 'publish was attempted');
  assert.ok(report.publishAttempts.every((attempt) => attempt.refusal === 'SIMULATED_PROBE'),
    'a dry-run probe must never publish evidence a rep could read');

  // A deferred probe rests in PLANNED rather than failing.
  assert.ok((report.statusCounts['PLANNED'] ?? 0) > 0, 'a deferred probe rests in PLANNED');

  const rendered = renderBatchReport(report);
  assert.match(rendered, /form submissions actually sent\s+0/);
  assert.match(rendered, /No bytes left this machine/);
});

test('every rendered measurement carries both latency figures and a disclaimer', async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const report = await simulateBatch({ size: 40, poolSize: 10 });

  const answered = report.prospects.filter((row) => row.evidence.length > 0);
  assert.ok(answered.length > 0, 'some probe was answered');

  for (const row of answered) {
    const text = row.evidence.join(' ');
    assert.match(text, /Lead submitted/);
    assert.match(text, /Attribution confidence/);
    if (/Elapsed human response time/.test(text)) {
      // Either an adjusted figure or an explicit statement that there is none.
      assert.ok(/Business-hours-adjusted \d/.test(text)
        || /Business-hours-adjusted figure not available/.test(text),
        `neither an adjusted figure nor its absence was stated for ${row.label}`);
    }
    // The prohibition the whole subsystem exists to respect.
    assert.ok(!/on average|typically|they always|never respond/i.test(text),
      `one inquiry became a generalisation for ${row.label}`);
  }
});

test('the report reconciles: every prospect in exactly one bucket', async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  const report = await simulateBatch({ size: 40, poolSize: 10 });
  const r = report.reconciliation;

  assert.equal(r.total, 40);
  assert.equal(r.unaccounted, 0,
    'a prospect the partition cannot classify means the report is hiding a row');
  assert.equal(r.balances, true);

  const sum = r.refusedBeforePlanning + r.formIneligible + r.deferredAwaitingNumber
    + r.preparationFailed + r.awaitingManualResolution + r.terminalAttributed
    + r.terminalNoResponse + r.terminalAmbiguous + r.cancelled;
  assert.equal(sum, 40, 'the buckets must add up to the batch, with nothing dropped');

  // Every prospect row exists, so the partition is over the whole batch rather than
  // over a filtered view of it.
  assert.equal(report.prospects.length, 40);

  // And the rendered report says so rather than leaving the reader to add up.
  const rendered = renderBatchReport(report);
  assert.match(rendered, /reconciles to total\s+YES/);
  assert.match(rendered, /these OVERLAP by lifecycle stage, and are not a partition/);

  // Ambiguous events outnumbering terminal-AMBIGUOUS probes is correct, and the
  // report must say why rather than leaving it to look like a discrepancy.
  assert.match(rendered, /why ambiguous callbacks do not appear as terminal AMBIGUOUS/);
  assert.match(rendered, /the ambiguous count is of inbound EVENTS, not of probes/);
  assert.match(rendered, /blocks it from later asserting silence/);
});
