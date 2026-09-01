// Turn-by-turn conversation control.
//
// Responsibilities, in order:
//   1. Route the opening turns (stage 1) until confident.
//   2. Hand the conversation to a specialist (stage 2) and keep it there.
//   3. Build the specialist's prompt from core rules + industry brain +
//      what has already been captured, so the agent never re-asks.
//
// The transport (Twilio) calls handleCallerUtterance() and speaks
// whatever comes back. It knows nothing about routing or industries.

import type { ClaudeClient } from '../claude/client.ts';
import type { Logger } from '../logger.ts';
import type { Session } from './types.ts';
import type { SessionStore } from './session.ts';
import { route, detectScenarioChange } from './router.ts';
import { selectSpecialist } from '../industries/index.ts';
import { CORE_AGENT_RULES } from '../prompts/core-agent.ts';
import {
  inspectCallerUtterance, inspectAgentReply,
  PERSISTENT_PROBE_REPLY, PROBE_LIMIT,
} from './guardrails.ts';
import { TOOL_SCHEMAS, executeToolRequest } from './tool-protocol.ts';
import { resolveModels, type ModelConfig } from '../claude/models.ts';
import type { Toolbox } from '../tools/index.ts';
import type { CompleteResult, ClaudeMessage } from '../claude/client.ts';

export const GREETING =
  "Thanks for calling. Tell me a bit about what's going on and I'll get you to the right place.";

export interface OrchestratorDeps {
  sessions: SessionStore;
  claude: ClaudeClient | null;
  log: Logger;
  confidenceThreshold?: number;
  /** Max clarifying questions before we route on best guess rather
   * than interrogating a caller who is already frustrated. */
  maxClarifyAttempts?: number;
  /** Tools the agent may request. Omitted means text-only. */
  tools?: Toolbox;
  /** Per-role model settings. Defaults come from the environment. */
  models?: ModelConfig;
  /** Ceiling on tool round-trips inside one turn. A phone call cannot
   * absorb more than a couple before the silence is noticeable. */
  maxToolRounds?: number;
}

/** Rolling token accounting for one process. Never spoken, only logged. */
export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export class Orchestrator {
  // Explicit field, not a parameter property — see the note in
  // session.ts: parameter properties are unsupported under
  // --experimental-strip-types.
  private readonly deps: OrchestratorDeps;
  private readonly models: ModelConfig;

  /** Cumulative usage across every call this process has handled. */
  readonly usage: UsageTotals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    this.models = deps.models ?? resolveModels();
  }

  async handleCallerUtterance(callSid: string, utterance: string): Promise<string> {
    const { sessions, claude, log } = this.deps;
    const session = sessions.ensure(callSid);
    sessions.addTurn(callSid, 'caller', utterance);

    // Guardrails run before anything else. A caller probing the system
    // is not describing a need, so there is nothing to route and
    // nothing to qualify.
    const guard = inspectCallerUtterance(utterance);
    if (guard.flagged) {
      session.probeCount += 1;
      log.log('guard.flagged', {
        callSid, kinds: guard.kinds, count: session.probeCount,
      });

      // Past the limit we stop calling the model entirely. That removes
      // the attack surface rather than relying on the model to hold the
      // line, and stops a caller burning tokens by repeating himself.
      if (session.probeCount > PROBE_LIMIT) {
        log.log('guard.blocked', { callSid, count: session.probeCount });
        sessions.addTurn(callSid, 'agent', PERSISTENT_PROBE_REPLY);
        return PERSISTENT_PROBE_REPLY;
      }
    }

    // Already routed? Check whether the caller has moved on to a
    // different scenario. On a demo line this is common and expected —
    // a prospect wants to hear the plumbing agent after the divorce
    // one. The check is conservative so a passing mention of "the
    // house" during a divorce call does not derail the persona.
    if (session.routed) {
      const change = detectScenarioChange(utterance, session.route.industry);
      if (change.changed) {
        log.log('router.decision', {
          callSid, reroute: true, reason: change.reason,
          from: session.route.industry,
          to: change.decision?.industry ?? null,
        });
        session.routed = false;
        session.clarifyAttempts = 0;
        session.scenarioSwitches += 1;
        // A new scenario means a clean slate for qualification — the
        // previous industry's answers do not apply to this one.
        session.qualification = {};
        if (change.decision) {
          sessions.setRoute(callSid, change.decision);
          const spec = selectSpecialist(session);
          log.log('specialist.selected', {
            callSid, industry: change.decision.industry, specialty: spec?.specialty ?? null, reroute: true,
          });
          const opening = spec ? spec.openingLine(session) : null;
          if (opening) {
            sessions.addTurn(callSid, 'agent', opening);
            return opening;
          }
        }
      }
    }

    if (!session.routed) {
      const reply = await this.routeTurn(session, utterance);
      if (reply) {
        sessions.addTurn(callSid, 'agent', reply);
        return reply;
      }
    }

    const reply = await this.specialistTurn(session, guard.reinforcement);
    sessions.addTurn(callSid, 'agent', reply);
    return reply;
  }

  /** Stage 1. Returns a clarifying question, or null once routed. */
  private async routeTurn(session: Session, utterance: string): Promise<string | null> {
    const { sessions, claude, log, confidenceThreshold = 0.6, maxClarifyAttempts = 2 } = this.deps;

    // Route on everything the caller has said so far, not just the last
    // fragment — "my house" then "the roof is leaking" only makes sense
    // together.
    // Only the turns since routing was (re)opened — after a scenario
    // change, the earlier divorce sentences must not pull the
    // classification back to attorneys.
    const since = session.turns.filter((t) => t.role === 'caller').slice(-(session.clarifyAttempts + 1));
    const context = since.map((t) => t.text).join(' ');
    const decision = await route(context || utterance, { claude, threshold: confidenceThreshold });

    log.log('router.decision', {
      callSid: session.callSid,
      industry: decision.industry,
      specialty: decision.specialty,
      intent: decision.intent,
      urgency: decision.urgency,
      confidence: Number(decision.confidence.toFixed(2)),
      source: decision.source,
    });

    const confident = decision.industry !== null && decision.confidence >= confidenceThreshold;
    if (!confident && session.clarifyAttempts < maxClarifyAttempts) {
      session.clarifyAttempts += 1;
      const question = decision.clarifyingQuestion ??
        "Can you tell me a bit more about what you need help with?";
      log.log('router.clarify', { callSid: session.callSid, attempt: session.clarifyAttempts });
      return question;
    }

    // Out of clarification attempts with nothing usable — stay generic
    // and helpful rather than guessing an industry at random.
    if (!decision.industry) {
      sessions.setRoute(session.callSid, { ...decision, industry: null });
      return "I want to make sure I get you to the right person — are you calling about a property, a legal matter, or a service you need done?";
    }

    sessions.setRoute(session.callSid, decision);
    const spec = selectSpecialist(session);
    log.log('specialist.selected', {
      callSid: session.callSid,
      industry: decision.industry,
      specialty: spec?.specialty ?? null,
    });

    // The handoff the caller experiences: the very next thing said is
    // simply the specialist's opening line. No "transferring you now".
    return spec ? spec.openingLine(session) : null;
  }

  /** Stage 2. The specialist owns the conversation from here. */
  private async specialistTurn(session: Session, reinforcement: string | null = null): Promise<string> {
    const { claude, log } = this.deps;
    const spec = selectSpecialist(session);

    if (!claude) {
      // No API key: keep the call alive and honest rather than crashing.
      return spec
        ? "Thanks — I've got that. Let me take a few details so someone can follow up with you."
        : "Thanks for that. Let me take a few details so the right person can call you back.";
    }

    const system = [
      CORE_AGENT_RULES,
      spec ? spec.systemPrompt : 'You are a general intake receptionist. Find out what the caller needs and take their contact details.',
      this.stateBrief(session, spec?.qualificationSchema.map((f) => f.goal) ?? []),
      // Appended last so it is the most recent thing the model read.
      ...(reinforcement ? [reinforcement] : []),
    ].join('\n\n---\n\n');

    const messages = session.turns
      .slice(-20) // a phone call's working memory; keeps latency down
      .map((t) => ({ role: (t.role === 'caller' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }));

    try {
      log.log('llm.request', { callSid: session.callSid, turns: messages.length });
      const reply = await this.runTurn(session, system, messages);
      if (!reply) return "Sorry — could you say that once more?";

      // Last check before this reaches text-to-speech.
      const checked = inspectAgentReply(reply);
      if (!checked.safe) {
        log.log('guard.output_blocked', { callSid: session.callSid, reason: checked.reason });
      }
      return checked.text;
    } catch (err) {
      log.log('llm.failed', { callSid: session.callSid, error: String(err).slice(0, 200) });
      return "Sorry, I didn't catch that — could you say it again?";
    }
  }

  /**
   * One turn, including any tool round-trips.
   *
   * The loop is the whole tool-call contract: Claude REQUESTS, this
   * code VALIDATES and EXECUTES, the result goes back as a normal
   * tool_result message, and Claude speaks. The model never reaches
   * the calendar or the phone network itself.
   *
   * Bounded by maxToolRounds because every round is another second of
   * silence on a live call. When the budget runs out we take whatever
   * text we have rather than looping.
   */
  private async runTurn(session: Session, system: string, messages: ClaudeMessage[]): Promise<string> {
    const { claude, log, tools, maxToolRounds = 2 } = this.deps;
    if (!claude) return '';

    // Without a tool-capable client or a toolbox, this is a plain
    // completion — which is what the tests and the no-credential
    // demo path use.
    if (!claude.send || !tools) {
      return claude.complete({
        system, messages,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
      });
    }

    const convo: ClaudeMessage[] = [...messages];
    let spoken = '';

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const res: CompleteResult = await claude.send({
        system,
        messages: convo,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
        tools: round < maxToolRounds ? TOOL_SCHEMAS : undefined,
      });
      this.recordUsage(session, res);
      spoken = res.text || spoken;

      if (res.toolUses.length === 0) return spoken;

      // Claude asked for tools. Run them, then hand the results back.
      convo.push({ role: 'assistant', content: res.raw });
      const results = [];
      for (const use of res.toolUses) {
        const outcome = await executeToolRequest(
          { id: use.id, name: use.name, input: use.input },
          { tools, log, session },
        );
        results.push({
          type: 'tool_result',
          tool_use_id: outcome.id,
          content: outcome.content,
          is_error: !outcome.ok,
        });
      }
      convo.push({ role: 'user', content: results });
    }

    // Out of rounds. Say whatever was produced rather than looping —
    // a caller listening to silence has already hung up.
    log.log('tool.failed', { callSid: session.callSid, reason: 'tool_round_budget_exhausted' });
    return spoken || "Let me get that sorted and someone will confirm with you shortly.";
  }

  private recordUsage(session: Session, res: CompleteResult): void {
    this.usage.requests += 1;
    this.usage.inputTokens += res.usage.inputTokens;
    this.usage.outputTokens += res.usage.outputTokens;
    this.usage.cacheReadTokens += res.usage.cacheReadTokens ?? 0;
    this.deps.log.log('llm.usage', {
      callSid: session.callSid,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cacheReadTokens ?? 0,
      stopReason: res.stopReason,
    });
  }

  /** Tells the model what is already known, so it never re-asks. */
  private stateBrief(session: Session, goals: string[]): string {
    const known = Object.entries({ ...session.contact, ...session.qualification })
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `- ${k}: ${String(v)}`);

    return [
      'CALL STATE (internal — never read aloud):',
      known.length ? `Already known:\n${known.join('\n')}` : 'Already known: nothing yet.',
      goals.length ? `Still to find out, in roughly this order:\n${goals.map((g) => `- ${g}`).join('\n')}` : '',
      'Do not ask again for anything listed as already known.',
    ].filter(Boolean).join('\n');
  }
}
