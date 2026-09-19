import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runBenchmark, runBenchmarkScenario, BENCHMARK_SCENARIOS, LATENCY_TARGETS,
  UNTARGETED_METRICS, SYNTHETIC_ONLY_NOTICE,
} from '../src/benchmark.ts';
import { HOLDING_LINE_AFTER_MS, createSalesRelaySession, type Socket, type TurnProducer }
  from '../src/relaySession.ts';

/**
 * The synthetic latency benchmark.
 * Targets: outbound-sales-brain-realtime-voice-policy.md §2, §10.
 *
 * The harness must be honest about two things: it is not audio latency, and a metric
 * with too few samples supports no percentile claim.
 */

test('the report says plainly that it is not PSTN audio latency', async () => {
  const report = await runBenchmark(BENCHMARK_SCENARIOS.slice(0, 2));
  assert.match(report.notice, /Not PSTN audio latency/);
  assert.match(report.notice, /actual handset/);
  assert.equal(SYNTHETIC_ONLY_NOTICE, report.notice);
});

test('every named fixture from the release plan is present', () => {
  assert.deepEqual(BENCHMARK_SCENARIOS.map((scenario) => scenario.id), [
    'immediate_answer', 'interrupts_opener_after_200ms', 'interrupts_mid_question',
    'caller_says_only_yeah', 'caller_pauses', 'caller_talks_for_a_long_time',
    'multiple_rapid_interruptions', 'dnc_during_agent_speech',
    'wrong_number_during_agent_speech', 'booking_tool_slow', 'tool_failure',
    'websocket_closes_abruptly',
  ]);
});

test('the targets are the ones the policy states', () => {
  assert.deepEqual(LATENCY_TARGETS.answer_to_first_speech_ready, { p50: 800, p95: 1250 });
  assert.deepEqual(LATENCY_TARGETS.end_of_turn_to_first_token, { p50: 1000, p95: 1500 });
  assert.deepEqual(LATENCY_TARGETS.interrupt_to_cancellation, { p50: 200, p95: 300 });
});

test('the whole benchmark passes, deterministically', async () => {
  const first = await runBenchmark();
  const second = await runBenchmark();
  assert.equal(first.verdict, 'PASS', JSON.stringify(first.scenarios.filter(
    (scenario) => scenario.verdict !== 'PASS'), null, 2));
  assert.deepEqual(first.percentiles, second.percentiles,
    'the same frames must always produce the same figures');
});

test('a metric with fewer than three samples is inconclusive, not a pass', async () => {
  const report = await runBenchmark([BENCHMARK_SCENARIOS[0]!]);
  const sparse = Object.entries(report.percentiles)
    .filter(([, row]) => row.samples < 3 && row.verdict !== 'NOT_TARGETED');
  for (const [metric, row] of sparse) {
    assert.equal(row.verdict, 'INCONCLUSIVE', `${metric} claimed ${row.verdict} on ${row.samples}`);
  }
});

test('tool latency is reported and never judged against the conversation target', async () => {
  const report = await runBenchmark();
  for (const metric of UNTARGETED_METRICS) {
    const row = report.percentiles[metric];
    if (!row) continue;
    assert.equal(row.verdict, 'NOT_TARGETED',
      'a slow calendar is a provider problem, not a conversation failure');
  }
  const tool = report.percentiles['tool_start_to_tool_result']!;
  assert.ok(tool.p95! >= 1800, 'the slow tool is still measured and visible');
});

test('a slow tool is covered by a status phrase, not by silence', async () => {
  const scenario = BENCHMARK_SCENARIOS.find((row) => row.id === 'booking_tool_slow')!;
  const outcome = await runBenchmarkScenario(scenario);
  assert.equal(outcome.verdict, 'PASS');

  const firstSpeech = outcome.spans.find((span) => span.metric === 'end_of_turn_to_first_token')!;
  const holding = outcome.spans.find((span) => span.metric === 'end_of_turn_to_holding_line')!;
  assert.equal(holding.ms, HOLDING_LINE_AFTER_MS);
  assert.equal(firstSpeech.ms, HOLDING_LINE_AFTER_MS,
    'the caller heard something at the threshold rather than waiting for the tool');
  assert.ok(firstSpeech.ms <= LATENCY_TARGETS.end_of_turn_to_first_token.p95);
});

test('a scenario that produces no measurement is inconclusive rather than passing', async () => {
  const outcome = await runBenchmarkScenario({
    id: 'nothing_measured', description: 'no frames at all', frames: [],
    expects: ['end_of_turn_to_first_token'],
  });
  assert.equal(outcome.verdict, 'INCONCLUSIVE');
  assert.deepEqual(outcome.missing, ['end_of_turn_to_first_token']);
  assert.match(outcome.notes, /proves nothing about it/);
});

// --- the holding line itself ---------------------------------------------------

test('the holding line is the producer words, and the transport writes none', async () => {
  const sent: string[] = [];
  const socket: Socket = { send: (data) => sent.push(data), close: () => {} };
  let releaseTurn: (() => void) | undefined;

  const producer: TurnProducer = {
    opening: () => 'Opening.',
    async respond() {
      await new Promise<void>((resolve) => { releaseTurn = resolve; });
      return { say: 'I have today at 4:15 PM. Would that work?', terminal: false };
    },
    finish() {},
    holdingLine: () => 'One second, I am looking at the calendar.',
  };

  const relay = createSalesRelaySession({ producer, sink: { log: () => {} }, holdingLineAfterMs: 20 });
  const ref = { current: '' };
  await relay.handle(socket, JSON.stringify({ type: 'setup', callSid: 'CA-hold' }), ref);
  const pending = relay.handle(socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Book me in.', last: true }), ref);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sent.length, 1, 'the status phrase was spoken while the tool ran');
  const holding = JSON.parse(sent[0]!);
  assert.equal(holding.token, 'One second, I am looking at the calendar.');
  assert.equal(holding.last, false, 'the turn stays open for the real answer');
  assert.equal(holding.preemptible, true, 'the caller can talk over it');
  // It states no outcome.
  assert.equal(/booked|confirmed|all set/i.test(holding.token), false);

  releaseTurn?.();
  await pending;
  assert.equal(sent.length, 2);
  assert.match(JSON.parse(sent[1]!).token, /4:15 PM/);
});

test('no holding line is spoken on an ordinary fast turn', async () => {
  const sent: string[] = [];
  const socket: Socket = { send: (data) => sent.push(data), close: () => {} };
  const producer: TurnProducer = {
    opening: () => 'Opening.',
    async respond() { return { say: 'Understood.', terminal: false }; },
    finish() {},
    holdingLine: () => 'One second.',
  };
  const relay = createSalesRelaySession({
    producer, sink: { log: () => {} }, holdingLineAfterMs: 500 });
  const ref = { current: '' };
  await relay.handle(socket, JSON.stringify({ type: 'setup', callSid: 'CA-fast' }), ref);
  await relay.handle(socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Hello?', last: true }), ref);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(sent.length, 1, 'filler on every turn would be covering for the architecture');
  assert.match(JSON.parse(sent[0]!).token, /Understood/);
});

test('a holding line is not spoken after the caller interrupts', async () => {
  const sent: string[] = [];
  const socket: Socket = { send: (data) => sent.push(data), close: () => {} };
  let release: (() => void) | undefined;
  const producer: TurnProducer = {
    opening: () => 'Opening.',
    async respond(_u, signal) {
      await new Promise<void>((resolve) => { release = resolve; });
      if (signal.aborted) throw new Error('aborted');
      return { say: 'Late.', terminal: false };
    },
    finish() {},
    holdingLine: () => 'One second.',
  };
  const relay = createSalesRelaySession({
    producer, sink: { log: () => {} }, holdingLineAfterMs: 30 });
  const ref = { current: '' };
  await relay.handle(socket, JSON.stringify({ type: 'setup', callSid: 'CA-int' }), ref);
  const pending = relay.handle(socket, JSON.stringify({
    type: 'prompt', voicePrompt: 'Go on.', last: true }), ref);
  await relay.handle(socket, JSON.stringify({
    type: 'interrupt', utteranceUntilInterrupt: '' }), ref);
  await new Promise((resolve) => setTimeout(resolve, 80));
  release?.();
  await pending;

  assert.deepEqual(sent, [],
    'the caller is talking; a status phrase would be the agent talking over them');
});
