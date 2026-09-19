import {
  applyToolResult, applyTransition, createCallContext, step,
  type AvailableTools, type CallContext, type CallEvent, type Transition,
} from './stateMachine.js';
import type { CallPack } from './callPack.js';
import { composeGatekeeperLine, composeOpener, composeSystemPrompt } from './prompt.js';

/**
 * Text roleplay harness.
 * Authority: conversation-state-machine.md §36 — "State machine should be testable
 * without Twilio. Run simulated text events through transitions first."
 *
 * This is how the conversation logic is exercised before any real number is dialled.
 * It runs the same orchestration the live call will, with the model's turn replaced
 * by scripted prospect lines.
 */

export interface SimulatedTurn {
  prospectSays?: string;
  event?: CallEvent;
}

export interface SimulationStep {
  turn: number;
  state: string;
  prospectSaid: string | null;
  transitionReason: string;
  agentMustSay: string | null;
  actions: string[];
  overrides: string[];
}

export interface SimulationResult {
  steps: SimulationStep[];
  finalState: string;
  terminalReason: string | null;
  disposition: string | null;
  problemConfirmed: boolean;
  economicInputs: { label: string; value: string }[];
  systemsNamed: string[];
  contradicted: string[];
  overrides: string[];
  /** Every orchestration action taken, for assertion in tests. */
  actionsTaken: string[];
}

export function simulateCall(input: {
  pack: CallPack;
  tools: AvailableTools;
  turns: SimulatedTurn[];
  agentName?: string;
}): SimulationResult {
  const context = createCallContext(input.tools, input.pack.primaryHypothesis);
  const steps: SimulationStep[] = [];
  const actionsTaken: string[] = [];

  const record = (transition: Transition, prospectSaid: string | null): void => {
    for (const action of transition.actions) actionsTaken.push(action.kind);
    steps.push({
      turn: context.turnCount,
      state: transition.to,
      prospectSaid,
      transitionReason: transition.reason,
      agentMustSay: transition.requiredUtterance ?? null,
      actions: transition.actions.map((action) => action.kind),
      overrides: [...context.overrides],
    });
    applyTransition(context, transition);
  };

  // The call opens the way Module 4A says it does.
  record(step(context, { type: 'answered', answerType: 'human' }), null);
  context.transcript.push({
    speaker: 'agent',
    text: composeOpener(input.pack, input.agentName ?? 'Alex'),
    state: context.state,
  });

  for (const turn of input.turns) {
    if (context.state === 'terminal') break;

    if (turn.event?.type === 'tool_result') {
      record(applyToolResult(context, turn.event), null);
      continue;
    }
    const event: CallEvent = turn.event ?? { type: 'prospect_said', text: turn.prospectSays ?? '' };
    record(step(context, event), turn.prospectSays ?? null);
  }

  return {
    steps,
    finalState: context.state,
    terminalReason: context.terminalReason,
    disposition: context.disposition,
    problemConfirmed: context.findings.problemConfirmed,
    economicInputs: context.findings.economicInputs,
    systemsNamed: context.findings.systemsNamed,
    contradicted: context.findings.contradicted,
    overrides: context.overrides,
    actionsTaken,
  };
}

/** Renders a simulation as a readable transcript for review. */
export function renderSimulation(result: SimulationResult, pack: CallPack): string {
  const lines: string[] = [];
  lines.push(`Roleplay — ${pack.companyName} (${pack.geography})`);
  lines.push(`Hypothesis: ${pack.primaryHypothesis ?? '(none)'}`);
  lines.push('');
  for (const entry of result.steps) {
    if (entry.prospectSaid) lines.push(`  PROSPECT  ${entry.prospectSaid}`);
    lines.push(`  -> ${entry.state.padEnd(20)} ${entry.transitionReason}`);
    if (entry.agentMustSay) lines.push(`     AGENT MUST SAY: ${entry.agentMustSay}`);
    if (entry.actions.length > 0) lines.push(`     ACTIONS: ${entry.actions.join(', ')}`);
  }
  lines.push('');
  lines.push(`  final:       ${result.finalState} (${result.terminalReason ?? 'not terminal'})`);
  lines.push(`  disposition: ${result.disposition ?? 'none'}`);
  lines.push(`  problem:     ${result.problemConfirmed ? 'confirmed' : 'not established'}`);
  if (result.economicInputs.length > 0) {
    lines.push(`  numbers:     ${result.economicInputs.map((i) => `${i.label}=${i.value}`).join(', ')}`);
  }
  if (result.systemsNamed.length > 0) lines.push(`  systems:     ${result.systemsNamed.join(', ')}`);
  if (result.overrides.length > 0) {
    lines.push('  orchestration overrode the model:');
    for (const override of result.overrides) lines.push(`     - ${override}`);
  }
  return lines.join('\n');
}

export { composeSystemPrompt, composeGatekeeperLine, composeOpener };
