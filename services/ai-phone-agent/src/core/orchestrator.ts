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
import { knowledgeFor } from '../knowledge/index.ts';
import { matchKnowledge, renderKnowledge } from '../knowledge/types.ts';
import { demoProfile, renderBusinessProfile, type BusinessProfile } from '../business/profile.ts';
import { extractFromUtterance, mergeContact } from './extract.ts';
import { renderSpeechGuidance, speakZip, speakPhone, speakAddress } from './speech.ts';
import { renderActionPolicies } from '../business/render-policies.ts';
import { DEFAULT_SERVICE_AREA, serviceLocalTime, partOfDay, type ServiceArea } from '../business/service-area.ts';
import { renderPricing, PLUMBING_DEMO_PRICING, PLUMBING_DEMO_ETA, type ServicePricing, type EtaPolicy } from '../business/pricing.ts';

/** Turns of history sent verbatim. A phone call's working memory. */
export const HISTORY_WINDOW = 20;

/**
 * Turn count past which a rolling summary is maintained.
 *
 * Below this the whole call still fits in the window, so a summary
 * would be a second copy of what the model can already see.
 */
export const SUMMARY_THRESHOLD = 14;

/** How often the summary is refreshed once it exists. */
export const SUMMARY_INTERVAL = 8;

const SUMMARY_SYSTEM = `You are compressing a phone call in progress so the agent handling it does not lose track.

Write at most six short lines covering ONLY things that would change how the rest of the call is handled: what the caller needs, anything they have said about urgency or timing, constraints they mentioned, decisions already made, questions already answered, and anything emotionally significant (a bereavement, a safety concern, frustration with a previous visit).

Do NOT include: contact details, pleasantries, the agent's own questions, or anything already obvious from the last few turns. Do not speculate. Do not add advice. Plain sentences, no bullets, no headings.`;

/**
 * What the transport should do with a reply.
 *
 * An explicit contract rather than string-matching the response: an
 * agent that says "goodbye for now, but first let me confirm the
 * address" must not hang up, and any keyword rule eventually does.
 */
export type TurnAction = 'SPEAK_AND_CONTINUE' | 'SPEAK_AND_END';

export interface TurnResult {
  /** The only thing the caller hears. */
  text: string;
  action: TurnAction;
  /** Why the call is ending, when it is. Logged, never spoken. */
  endReason?: string;
}

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
  /** Where the business works, and what time it is there. Never the server clock. */
  serviceArea?: ServiceArea;
  /** Published rates. Absent means the agent must not quote a fee. */
  pricing?: ServicePricing | null;
  etaPolicy?: EtaPolicy;
  /** Ceiling on tool round-trips inside one turn. A phone call cannot
   * absorb more than a couple before the silence is noticeable. */
  maxToolRounds?: number;
  /**
   * Resolves the business the agent is answering for.
   *
   * In DEMO mode this returns a generic profile per industry, which is
   * why the demo agent knows the trade but not the prices. In CLIENT
   * mode it returns that client's real profile and the industry never
   * changes. See docs/voice-agent-client-onboarding.md.
   */
  resolveProfile?: (industry: string | null) => BusinessProfile;
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

  /**
   * Backwards-compatible entry point.
   *
   * Everything that only needs the words still calls this; the
   * transport calls handleTurn() because it also needs to know whether
   * to close the line.
   */
  async handleCallerUtterance(callSid: string, utterance: string): Promise<string> {
    return (await this.handleTurn(callSid, utterance)).text;
  }

  async handleTurn(callSid: string, utterance: string): Promise<TurnResult> {
    const { sessions, claude, log } = this.deps;
    const session = sessions.ensure(callSid);
    sessions.addTurn(callSid, 'caller', utterance);

    // The number they are calling from is the obvious callback number,
    // and making someone read their own phone number back is the kind
    // of thing that makes an automated system feel automated. It is
    // recorded as provisional so the agent still confirms it once, and
    // any number they actually give replaces it.
    if (!session.contact.phone && /^\+?[1-9]\d{7,14}$/.test(session.from)) {
      session.contact.phone = session.from;
      session.qualification.phoneFromCallerId = true;
      log.log('field.captured', { callSid, fields: ['phone'], source: 'caller-id' });
    }

    // Catch the details a caller volunteers in passing, before anything
    // else. They rarely answer one question at a time, and a number
    // said out loud that never reaches the record is a lost lead.
    const found = extractFromUtterance(utterance);
    if (found.fields.length > 0) {
      const { changed, corrected } = mergeContact(session.contact, found.contact);
      // Values are personal data, so only the field NAMES are logged.
      if (changed.length) log.log('field.captured', { callSid, fields: changed });
      if (corrected.length) log.log('field.updated', { callSid, fields: corrected });
    }

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
        return { text: PERSISTENT_PROBE_REPLY, action: 'SPEAK_AND_CONTINUE' };
      }
    }

    // Already routed? Check whether the caller has moved on to a
    // different scenario. On a demo line this is common and expected —
    // a prospect wants to hear the plumbing agent after the divorce
    // one. The check is conservative so a passing mention of "the
    // house" during a divorce call does not derail the persona.
    //
    // In CLIENT mode it does not happen at all. A plumbing company's
    // real receptionist does not become a divorce intake because a
    // caller mentioned their ex-wife; it would be an alarming bug on a
    // real business line, and the industry is fixed by configuration
    // rather than inferred.
    if (session.routed && this.profileFor(session.route.industry).mode === 'demo') {
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
            return { text: opening, action: 'SPEAK_AND_CONTINUE' };
          }
        }
      }
    }

    if (!session.routed) {
      const reply = await this.routeTurn(session, utterance);
      if (reply) {
        sessions.addTurn(callSid, 'agent', reply);
        return { text: reply, action: 'SPEAK_AND_CONTINUE' };
      }
    }

    const reply = await this.specialistTurn(session, guard.reinforcement);
    sessions.addTurn(callSid, 'agent', reply);

    // Fire-and-forget: the caller is already hearing the reply, so this
    // costs them no silence. A failure here degrades the next turn's
    // context slightly and must never break the call.
    void this.maybeSummarise(session);

    // The agent asked to finish during this turn. The farewell it just
    // produced is spoken first; the transport closes the line after.
    if (session.pendingEnd) {
      log.log('call.ending', { callSid, reason: session.pendingEnd.reason });
      return { text: reply, action: 'SPEAK_AND_END', endReason: session.pendingEnd.reason };
    }

    return { text: reply, action: 'SPEAK_AND_CONTINUE' };
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

    // The business the agent is answering for. Everything it may state
    // as fact about prices, hours, coverage and credentials comes from
    // here — and the absent fields are stated just as explicitly as the
    // present ones, because that is what stops it inventing them.
    const profile = this.profileFor(session.route.industry);

    // Only the knowledge relevant to what the caller just said. Sending
    // an entire FAQ bank every turn costs tokens on every turn of every
    // call to carry answers to questions nobody asked, and buries the
    // instructions that do apply.
    const lastCaller = [...session.turns].reverse().find((t) => t.role === 'caller');
    const matched = matchKnowledge(lastCaller?.text ?? '', knowledgeFor(spec?.id ?? null, session.route.industry), profile);
    const knowledgeBlock = renderKnowledge(matched);
    if (matched.length > 0) {
      log.log('knowledge.matched', {
        callSid: session.callSid,
        entries: matched.map((m) => m.entry.id),
        unanswerable: matched.filter((m) => !m.answerable).map((m) => m.entry.id),
      });
    }

    // Pricing and dispatch timing, resolved for the SERVICE AREA's local
    // time. Rendered with the rate band already worked out so the model
    // quotes rather than calculates — asking it which band 11:27 PM
    // falls into is asking for arithmetic on a live call.
    const area = this.deps.serviceArea ?? DEFAULT_SERVICE_AREA;
    const pricing = this.pricingFor(session.route.industry);
    const pricingBlock = pricing
      ? renderPricing(pricing, this.deps.etaPolicy ?? PLUMBING_DEMO_ETA, area, session.route.urgency)
      : null;

    // What this business can actually DO — tow, paperwork, uploads,
    // referrals — with the honest mode of each, so a mocked action is
    // never described as done.
    const actionBlock = this.deps.tools
      ? renderActionPolicies(session.route.industry, {
          tow: this.deps.tools.modes.tow,
          esign: this.deps.tools.modes.esign,
          uploadLink: this.deps.tools.modes.uploadLink,
          referral: this.deps.tools.modes.referral,
        })
      : null;

    // How to pronounce what has already been captured.
    const speechBlock = renderSpeechGuidance(session.contact);

    const system = [
      CORE_AGENT_RULES,
      spec ? spec.systemPrompt : 'You are a general intake receptionist. Find out what the caller needs and take their contact details.',
      renderBusinessProfile(profile),
      ...(pricingBlock ? [pricingBlock] : []),
      ...(actionBlock ? [actionBlock] : []),
      ...(speechBlock ? [speechBlock] : []),
      // Earlier narrative, once the call has outgrown the history
      // window. Structured state below covers the fields; this covers
      // what was said that never became one.
      ...(session.summary
        ? [`EARLIER IN THIS CALL (internal — never read aloud):\n${session.summary.text}`]
        : []),
      this.stateBrief(session, spec?.qualificationSchema.map((f) => f.goal) ?? []),
      // The caller's actual question comes after the state brief so it
      // is not buried behind a list of fields still to collect.
      ...(knowledgeBlock ? [knowledgeBlock] : []),
      // Appended last so it is the most recent thing the model read.
      ...(reinforcement ? [reinforcement] : []),
    ].join('\n\n---\n\n');

    const messages = session.turns
      .slice(-HISTORY_WINDOW) // keeps latency and cost bounded on long calls
      .map((t) => ({ role: (t.role === 'caller' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }));

    try {
      const claudeRequestStartedAt = Date.now();
      log.log('llm.request', { callSid: session.callSid, turns: messages.length, systemChars: system.length });
      const reply = await this.runTurn(session, system, messages);
      // Timing only. Transcript content is governed separately by
      // LOG_TRANSCRIPTS and never appears here.
      log.log('llm.usage', {
        callSid: session.callSid,
        claudeDurationMs: Date.now() - claudeRequestStartedAt,
        stage: 'specialist',
      });
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

  /**
   * Refreshes the rolling summary when the call has grown past the
   * history window.
   *
   * Deliberately called AFTER the reply has been handed back, not
   * before: summarising on the critical path would add a model round
   * trip to a turn the caller is waiting on, which is the one thing a
   * phone call cannot absorb.
   */
  private async maybeSummarise(session: Session): Promise<void> {
    const { claude, log } = this.deps;
    if (!claude?.send) return;

    const turnCount = session.turns.length;
    if (turnCount < SUMMARY_THRESHOLD) return;
    if (session.summary && turnCount - session.summary.throughTurn < SUMMARY_INTERVAL) return;

    // Everything except the turns the model can still see for itself.
    const older = session.turns.slice(0, Math.max(0, turnCount - HISTORY_WINDOW + SUMMARY_INTERVAL));
    if (older.length === 0) return;

    const transcript = older
      .map((t) => `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.text}`)
      .join('\n');

    try {
      const res = await claude.send({
        system: SUMMARY_SYSTEM,
        messages: [{
          role: 'user',
          content: session.summary
            ? `Existing summary:\n${session.summary.text}\n\nNewer part of the call:\n${transcript}\n\nProduce an updated summary covering both.`
            : `Call so far:\n${transcript}`,
        }],
        model: this.models.summary.model,
        maxTokens: this.models.summary.maxTokens,
        temperature: this.models.summary.temperature,
      });
      this.recordUsage(session, res);
      if (res.text.trim()) {
        session.summary = { text: res.text.trim(), throughTurn: turnCount };
        log.log('call.summary', { callSid: session.callSid, rolling: true, throughTurn: turnCount });
      }
    } catch (err) {
      // The call continues on the recent window alone.
      log.log('llm.failed', { callSid: session.callSid, stage: 'summary', error: String(err).slice(0, 200) });
    }
  }

  /**
   * Published rates for this industry, or null when none are configured.
   *
   * Null is meaningful: it is what keeps every other industry refusing
   * to quote. Only a business that has actually given us its rates gets
   * to state one.
   */
  private pricingFor(industry: string | null): ServicePricing | null {
    if (this.deps.pricing !== undefined) return this.deps.pricing;
    return industry === 'plumbing' ? PLUMBING_DEMO_PRICING : null;
  }

  /**
   * The business profile for this call.
   *
   * DEMO returns a generic profile per industry — which is why the demo
   * agent knows the trade but not the prices. CLIENT returns that one
   * client's real profile, and the industry never changes for the life
   * of the call. See docs/voice-agent-client-onboarding.md.
   */
  private profileFor(industry: string | null): BusinessProfile {
    if (this.deps.resolveProfile) return this.deps.resolveProfile(industry);
    return demoProfile((industry ?? 'professional_services') as Parameters<typeof demoProfile>[0]);
  }

  /** True when this deployment answers for one specific business. */
  get clientMode(): boolean {
    return this.profileFor(null).mode === 'client';
  }

  /**
   * What is already known, what is still needed, and what to do about it.
   *
   * This is the record, not the transcript. A caller who asks "do you
   * have my ZIP code?" is asking about THIS list, and the answer has to
   * come from here — on the first production call the agent had no
   * reliable record and the caller had to ask whether it had been
   * captured at all.
   */
  private stateBrief(session: Session, goals: string[]): string {
    const contact = Object.entries(session.contact)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `- ${k}: ${String(v)}`);
    const answers = Object.entries(session.qualification)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `- ${k}: ${String(v)}`);

    return [
      'CALL STATE (internal — never read this out as a list):',
      contact.length ? `Contact details on file:\n${contact.join('\n')}` : 'Contact details on file: none yet.',
      answers.length ? `Answers already given:\n${answers.join('\n')}` : '',
      goals.length ? `Still needed, in roughly this order:\n${goals.map((g) => `- ${g}`).join('\n')}` : '',
      '',
      'RULES FOR THIS LIST',
      '- Never ask again for anything listed above. The caller already told you.',
      '- If they ask what you have — "do you have my ZIP?", "what address do you have?" — answer from this list, accurately. If it is not there, say so plainly and ask for it.',
      '- When they give you something new, or correct something, call capture_details straight away so it is recorded. Do not wait until the end of the call; callers hang up.',
      '- A correction replaces the old value silently. Do not make them repeat it twice.',
    ].filter(Boolean).join('\n');
  }
}
