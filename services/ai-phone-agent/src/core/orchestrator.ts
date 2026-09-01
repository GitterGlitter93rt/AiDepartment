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
}

export class Orchestrator {
  // Explicit field, not a parameter property — see the note in
  // session.ts: parameter properties are unsupported under
  // --experimental-strip-types.
  private readonly deps: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  async handleCallerUtterance(callSid: string, utterance: string): Promise<string> {
    const { sessions, claude, log } = this.deps;
    const session = sessions.ensure(callSid);
    sessions.addTurn(callSid, 'caller', utterance);

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

    const reply = await this.specialistTurn(session);
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
  private async specialistTurn(session: Session): Promise<string> {
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
    ].join('\n\n---\n\n');

    const messages = session.turns
      .slice(-20) // a phone call's working memory; keeps latency down
      .map((t) => ({ role: (t.role === 'caller' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }));

    try {
      log.log('llm.request', { callSid: session.callSid, turns: messages.length });
      const reply = await claude.complete({ system, messages, maxTokens: 220, temperature: 0.7 });
      return reply || "Sorry — could you say that once more?";
    } catch (err) {
      log.log('llm.failed', { callSid: session.callSid, error: String(err).slice(0, 200) });
      return "Sorry, I didn't catch that — could you say it again?";
    }
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
