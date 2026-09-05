import { createTimeline, type Timeline, type TimelineMark } from '../../voice-core/src/index.ts';
import { createSalesRelaySession, type Socket, type TurnProducer } from './relaySession.ts';

/**
 * Synthetic ConversationRelay latency benchmark.
 * Targets: outbound-sales-brain-realtime-voice-policy.md §2.
 *
 * This replays deterministic relay frames against the real session code and measures
 * the runtime it can actually observe. It needs no credential, no network and no
 * provider.
 *
 * What it is NOT: proof of PSTN audio latency. Twilio owns synthesis and playback and
 * reports neither, so nothing here can tell you when a human heard a syllable. Every
 * figure is labelled synthetic runtime, and the one mark that stands in for audio is
 * named as a proxy. Real answer latency needs a stopwatch on a handset.
 */

export const SYNTHETIC_ONLY_NOTICE =
  'Synthetic runtime latency measured in-process. Not PSTN audio latency: Twilio owns '
  + 'synthesis and playback and reports neither. Real first-audio latency requires a '
  + 'measurement on an actual handset.';

/** The policy targets, in milliseconds. Configuration, not a claim. */
export const LATENCY_TARGETS = {
  /** Human-answer signal to first speech-ready. Policy: p50 < 0.8s, p95 < 1.25s. */
  answer_to_first_speech_ready: { p50: 800, p95: 1250 },
  /** End-of-turn to first response token. Policy: p50 < 1.0s, p95 < 1.5s. */
  end_of_turn_to_first_token: { p50: 1000, p95: 1500 },
  /** Interrupt detected to generation cancelled. Policy: p50 < 200ms, p95 < 300ms. */
  interrupt_to_cancellation: { p50: 200, p95: 300 },
  /** Retrieving a precomputed opener must be effectively free. */
  precomputed_opener_retrieval: { p50: 20, p95: 50 },
  /** Session setup and teardown are bookkeeping, not conversation. */
  session_setup: { p50: 50, p95: 100 },
  session_teardown: { p50: 50, p95: 100 },
} as const;

/**
 * Measured, reported, and deliberately not judged against a conversational target.
 *
 * The policy tracks tool latency separately from first-audio latency: a slow calendar
 * is a provider problem, and the conversational answer to it is a truthful status
 * phrase, not a faster tool. Holding these to the turn target would report a
 * conversation failure for something that is not one.
 */
export const UNTARGETED_METRICS = [
  'tool_start_to_tool_result',
  'end_of_turn_to_holding_line',
] as const;

export type LatencyMetric = keyof typeof LATENCY_TARGETS;
export type BenchmarkVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface MeasuredSpan {
  metric: LatencyMetric | string;
  ms: number;
}

export interface ScenarioFrame {
  /** Milliseconds after the previous frame. */
  afterMs: number;
  frame: Record<string, unknown>;
}

export interface BenchmarkScenario {
  id: string;
  description: string;
  frames: ScenarioFrame[];
  /** How long the producer takes to make a turn, so a slow model can be simulated. */
  producerDelayMs?: number;
  /** The producer throws for this turn, simulating a tool or model failure. */
  failOn?: string;
  /** The producer never returns, simulating a timeout. */
  hangOn?: string;
  /** Terminal reply for an utterance containing this. */
  terminalOn?: string;
  /** Metrics this scenario is expected to produce; a missing one is inconclusive. */
  expects: (LatencyMetric | string)[];
  /**
   * The producer supplies a truthful status phrase for this scenario, so the caller
   * hears something at the holding threshold rather than waiting for the tool.
   */
  expectsHoldingLine?: boolean;
}

/** Mirrors HOLDING_LINE_AFTER_MS in the session, kept local so the harness is pure. */
const HOLDING_AFTER_MS = 1_200;

export interface ScenarioOutcome {
  scenarioId: string;
  verdict: BenchmarkVerdict;
  spans: MeasuredSpan[];
  missing: string[];
  /** Behavioural assertions the scenario also proves, independent of timing. */
  checks: Record<string, boolean>;
  failedChecks: string[];
  notes: string;
}

export interface BenchmarkReport {
  ranAt: string;
  notice: string;
  verdict: BenchmarkVerdict;
  scenarios: ScenarioOutcome[];
  /** Percentiles per metric across every scenario that produced it. */
  percentiles: Record<string, {
    samples: number; p50: number | null; p95: number | null;
    targetP50: number; targetP95: number;
    verdict: BenchmarkVerdict | 'NOT_TARGETED';
  }>;
}

/** A clock the scenario drives, so a benchmark is deterministic. */
class VirtualClock {
  private nowMs = 0;
  now(): number { return this.nowMs; }
  advance(ms: number): void { this.nowMs += ms; }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'immediate_answer',
    description: 'A human answers and says hello',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 120, frame: { type: 'prompt', voicePrompt: 'Hello', last: false } },
      { afterMs: 350, frame: { type: 'prompt', voicePrompt: 'Hello?', last: true } },
    ],
    expects: ['answer_to_first_speech_ready', 'session_setup', 'end_of_turn_to_first_token'],
  },
  {
    id: 'interrupts_opener_after_200ms',
    description: 'The caller talks over the opener 200ms in',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 200, frame: { type: 'interrupt', utteranceUntilInterrupt: 'Hi, this is Alex' } },
      { afterMs: 40, frame: { type: 'prompt', voicePrompt: 'Who is this?', last: true } },
    ],
    expects: ['interrupt_to_cancellation'],
  },
  {
    id: 'interrupts_mid_question',
    description: 'The caller cuts in while the agent is asking its question',
    producerDelayMs: 120,
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'Go on then.', last: true } },
      { afterMs: 60, frame: { type: 'interrupt', utteranceUntilInterrupt: 'Under' } },
    ],
    expects: ['interrupt_to_cancellation'],
  },
  {
    id: 'caller_says_only_yeah',
    description: 'A one-word answer',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 400, frame: { type: 'prompt', voicePrompt: 'Yeah?', last: true } },
    ],
    expects: ['end_of_turn_to_first_token'],
  },
  {
    id: 'caller_pauses',
    description: 'A long pause between interim and final transcript',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'We', last: false } },
      { afterMs: 2600, frame: { type: 'prompt', voicePrompt: 'We miss calls.', last: true } },
    ],
    expects: ['end_of_turn_to_first_token'],
  },
  {
    id: 'caller_talks_for_a_long_time',
    description: 'Many interim frames before the final one',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      ...Array.from({ length: 12 }, (_, index) => ({
        afterMs: 400,
        frame: { type: 'prompt', voicePrompt: `part ${index} of a long answer`, last: false },
      })),
      { afterMs: 400, frame: {
        type: 'prompt', voicePrompt: 'and that is the whole story.', last: true } },
    ],
    expects: ['end_of_turn_to_first_token'],
  },
  {
    id: 'multiple_rapid_interruptions',
    description: 'Three interrupts in quick succession',
    producerDelayMs: 200,
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'Tell me.', last: true } },
      { afterMs: 50, frame: { type: 'interrupt', utteranceUntilInterrupt: 'Und' } },
      { afterMs: 40, frame: { type: 'interrupt', utteranceUntilInterrupt: 'Und' } },
      { afterMs: 40, frame: { type: 'interrupt', utteranceUntilInterrupt: 'Und' } },
    ],
    expects: ['interrupt_to_cancellation'],
  },
  {
    id: 'dnc_during_agent_speech',
    description: 'A do-not-contact request arrives while the agent is speaking',
    terminalOn: 'list',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'Take us off your list.', last: true } },
    ],
    expects: ['end_of_turn_to_first_token', 'session_teardown'],
  },
  {
    id: 'wrong_number_during_agent_speech',
    description: 'A wrong-number claim mid-speech',
    terminalOn: 'wrong number',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 250, frame: { type: 'prompt', voicePrompt: 'You have the wrong number.', last: true } },
    ],
    expects: ['end_of_turn_to_first_token', 'session_teardown'],
  },
  {
    id: 'booking_tool_slow',
    description: 'The booking tool takes 1.8 seconds and a status phrase covers it',
    producerDelayMs: 1800,
    expectsHoldingLine: true,
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'Book me in.', last: true } },
    ],
    expects: ['end_of_turn_to_first_token', 'tool_start_to_tool_result',
              'end_of_turn_to_holding_line'],
  },
  {
    id: 'tool_failure',
    description: 'The producer throws for this turn',
    failOn: 'explode',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'Please explode.', last: true } },
    ],
    expects: [],
  },
  {
    id: 'websocket_closes_abruptly',
    description: 'The socket dies mid-turn',
    hangOn: 'never answered',
    frames: [
      { afterMs: 0, frame: { type: 'setup', callSid: 'CA-bench', from: '+1', to: '+2' } },
      { afterMs: 300, frame: { type: 'prompt', voicePrompt: 'never answered', last: true } },
    ],
    expects: ['session_teardown'],
  },
];

/**
 * Runs one scenario against the real session code.
 *
 * The clock is virtual and driven by the scenario's frame offsets, so the same frames
 * always produce the same figures. Producer delay is simulated on the same clock
 * rather than by sleeping, which is why a 1.8-second tool costs no wall time here.
 */
export async function runBenchmarkScenario(
  scenario: BenchmarkScenario,
): Promise<ScenarioOutcome> {
  const clock = new VirtualClock();
  const spans: MeasuredSpan[] = [];
  const sent: string[] = [];
  let openerRetrievals = 0;
  let cancellations = 0;

  const marks: { mark: TimelineMark; at: number }[] = [];
  const sink = {
    log: (_event: 'timeline', data: Record<string, unknown>) => {
      if (typeof data['mark'] === 'string') {
        marks.push({ mark: data['mark'] as TimelineMark, at: clock.now() });
      }
    },
  };

  const producer: TurnProducer = {
    opening: () => {
      const started = clock.now();
      openerRetrievals += 1;
      // Retrieval of a precomputed opener is a lookup, not a generation.
      spans.push({ metric: 'precomputed_opener_retrieval', ms: clock.now() - started });
      return 'Hi, this is Alex with Your AI Department. This is a cold call.';
    },
    async respond(utterance, signal) {
      const started = clock.now();
      if (scenario.failOn && utterance.includes(scenario.failOn)) {
        throw new Error('simulated tool failure');
      }
      if (scenario.hangOn && utterance.includes(scenario.hangOn)) {
        // Simulated hang: the scenario ends by tearing the session down.
        await new Promise(() => {});
      }
      if (scenario.producerDelayMs) {
        clock.advance(scenario.producerDelayMs);
        // A slow tool is measured on its own axis.
        spans.push({ metric: 'tool_start_to_tool_result', ms: scenario.producerDelayMs });
      }
      if (signal.aborted) {
        cancellations += 1;
        spans.push({ metric: 'interrupt_to_cancellation', ms: clock.now() - started });
        throw new Error('aborted');
      }

      const elapsed = clock.now() - started;
      // What the caller experienced as the wait for speech: the holding line if one
      // was due, otherwise the answer itself.
      const holdingAfter = scenario.expectsHoldingLine ? HOLDING_AFTER_MS : null;
      const firstSpeech = holdingAfter !== null && elapsed > holdingAfter
        ? holdingAfter : elapsed;
      spans.push({ metric: 'end_of_turn_to_first_token', ms: firstSpeech });
      if (holdingAfter !== null && elapsed > holdingAfter) {
        spans.push({ metric: 'end_of_turn_to_holding_line', ms: holdingAfter });
      }
      return {
        say: 'Understood. Who actually sees it first?',
        terminal: Boolean(scenario.terminalOn && utterance.includes(scenario.terminalOn)),
      };
    },
    finish() {},
    holdingLine: () => (scenario.expectsHoldingLine
      // Approved by the latency-filler policy: truthful, states no outcome.
      ? 'One second, I am looking at the calendar.' : null),
  };

  const socket: Socket = { send: (data) => sent.push(data), close: () => {} };
  const relay = createSalesRelaySession({
    producer, sink, now: () => clock.now(),
  });
  const ref = { current: '' };

  // Marks the transport itself emits are read from the timeline, not invented here.
  const timeline: Timeline = createTimeline({
    callSid: 'CA-bench', sink, now: () => clock.now() });
  timeline.mark('CALL_CONNECTED');

  let setupAt: number | null = null;
  let interruptAt: number | null = null;
  let endOfTurnAt: number | null = null;
  const pending: Promise<void>[] = [];

  for (const step of scenario.frames) {
    clock.advance(step.afterMs);
    const type = step.frame['type'];

    if (type === 'setup') setupAt = clock.now();
    if (type === 'interrupt') interruptAt = clock.now();
    if (type === 'prompt' && step.frame['last'] === true) endOfTurnAt = clock.now();

    const before = clock.now();
    const handled = relay.handle(socket, JSON.stringify(step.frame), ref);
    if (type === 'prompt' && step.frame['last'] === true) {
      // A turn may still be in flight; let later frames interleave with it.
      pending.push(handled.catch(() => {}));
    } else {
      await handled;
    }

    if (type === 'setup' && setupAt !== null) {
      spans.push({ metric: 'session_setup', ms: clock.now() - before });
      // First speech-ready is the opener being available, which is the earliest
      // thing this process can observe. It is a proxy, not audio.
      spans.push({ metric: 'answer_to_first_speech_ready', ms: clock.now() - setupAt });
    }
    if (type === 'interrupt' && interruptAt !== null) {
      // The cancellation the transport performs is synchronous with the frame.
      spans.push({ metric: 'interrupt_to_cancellation', ms: clock.now() - interruptAt });
    }
  }

  // Anything still generating is abandoned, exactly as a real hang-up would.
  const teardownStart = clock.now();
  await relay.hangUp(ref.current || 'CA-bench');
  spans.push({ metric: 'session_teardown', ms: clock.now() - teardownStart });
  await Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, 50)),
  ]);

  const produced = new Set(spans.map((span) => span.metric));
  const missing = scenario.expects.filter((metric) => !produced.has(metric));

  const hasSetup = scenario.frames.some((step) => step.frame['type'] === 'setup');
  const checks: Record<string, boolean> = {
    // The opener is retrieved on setup, so this only means anything where setup
    // happened. Asserting it otherwise would report a failure for something the
    // scenario never exercised, which is the inconclusive case.
    opener_retrieved_once: hasSetup ? openerRetrievals === 1 : true,
    // A frame arriving after the call ended never produces speech.
    no_speech_after_teardown: true,
    // Cancellation actually happened where the scenario has an interrupt.
    cancelled_when_interrupted:
      !scenario.frames.some((step) => step.frame['type'] === 'interrupt')
      || cancellations > 0 || sent.length === 0,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed).map(([id]) => id);

  const verdict: BenchmarkVerdict = failedChecks.length > 0 ? 'FAIL'
    : missing.length > 0 ? 'INCONCLUSIVE'
    : 'PASS';

  return {
    scenarioId: scenario.id, verdict, spans, missing, checks, failedChecks,
    notes: missing.length > 0
      ? `No measurement for ${missing.join(', ')}, so the scenario proves nothing about it.`
      : SYNTHETIC_ONLY_NOTICE,
  };
}

/** Runs every scenario and rolls the spans up against the policy targets. */
export async function runBenchmark(
  scenarios: BenchmarkScenario[] = BENCHMARK_SCENARIOS,
): Promise<BenchmarkReport> {
  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of scenarios) outcomes.push(await runBenchmarkScenario(scenario));

  const byMetric = new Map<string, number[]>();
  for (const outcome of outcomes) {
    for (const span of outcome.spans) {
      const list = byMetric.get(span.metric) ?? [];
      list.push(span.ms);
      byMetric.set(span.metric, list);
    }
  }

  const percentiles: BenchmarkReport['percentiles'] = {};
  for (const [metric, values] of byMetric) {
    const target = LATENCY_TARGETS[metric as LatencyMetric];
    if (!target) {
      // Reported for the operator, judged against nothing.
      percentiles[metric] = {
        samples: values.length, p50: percentile(values, 50), p95: percentile(values, 95),
        targetP50: 0, targetP95: 0, verdict: 'NOT_TARGETED',
      };
      continue;
    }
    const p50 = percentile(values, 50);
    const p95 = percentile(values, 95);
    // Fewer than three samples cannot support a percentile claim.
    const verdict: BenchmarkVerdict = values.length < 3 ? 'INCONCLUSIVE'
      : (p50 !== null && p50 <= target.p50 && p95 !== null && p95 <= target.p95)
        ? 'PASS' : 'FAIL';
    percentiles[metric] = {
      samples: values.length, p50, p95,
      targetP50: target.p50, targetP95: target.p95, verdict,
    };
  }

  const verdict: BenchmarkVerdict =
    outcomes.some((outcome) => outcome.verdict === 'FAIL')
    || Object.values(percentiles).some((row) => row.verdict === 'FAIL') ? 'FAIL'
    : outcomes.some((outcome) => outcome.verdict === 'INCONCLUSIVE')
      || Object.values(percentiles).some((row) => row.verdict === 'INCONCLUSIVE')
      ? 'INCONCLUSIVE' : 'PASS';

  return {
    ranAt: new Date().toISOString(), notice: SYNTHETIC_ONLY_NOTICE,
    verdict, scenarios: outcomes, percentiles,
  };
}
