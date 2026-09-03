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
import { route, detectScenarioChange, classifyHeuristic } from './router.ts';
import {
  decisiveServiceIntent, isMixedServiceIntent, isBareAccidentMention,
  SERVICE_CLARIFIER, BARE_ACCIDENT_CLARIFIER,
} from './service-intent.ts';
import { selectSpecialist } from '../industries/index.ts';
import { CORE_AGENT_RULES } from '../prompts/core-agent.ts';
import {
  inspectCallerUtterance, inspectAgentReply,
  PERSISTENT_PROBE_REPLY, PROBE_LIMIT,
} from './guardrails.ts';
import { TOOL_SCHEMAS, toolsFor, executeToolRequest, preToolAcknowledgement, immediateResultSpeech } from './tool-protocol.ts';
import { resolveModels, type ModelConfig } from '../claude/models.ts';
import type { Toolbox } from '../tools/index.ts';
import type { CompleteResult, ClaudeMessage } from '../claude/client.ts';
import { knowledgeFor } from '../knowledge/index.ts';
import { matchKnowledge, renderKnowledge } from '../knowledge/types.ts';
import { demoProfile, renderBusinessProfile, type BusinessProfile } from '../business/profile.ts';
import { extractFromUtterance, mergeContact } from './extract.ts';
import { renderSpeechGuidance, speakZip, speakPhone, speakAddress } from './speech.ts';
import { isUsableNumber, renderPhoneGuidance } from './contact-routing.ts';
import { renderGoal, renderOfferMemory, renderToolBlocks } from './goals.ts';
import type { TimelineMark } from './telemetry.ts';
import { renderActionPolicies } from '../business/render-policies.ts';
import { detectSalesIntent, isDecliningOffer, renderDemoHost } from './demo-host.ts';
import { DEMO_GREETING } from '../business/greeting.ts';
import { DEFAULT_SERVICE_AREA, serviceLocalTime, partOfDay, type ServiceArea } from '../business/service-area.ts';
import { renderPricing, PLUMBING_DEMO_PRICING, PLUMBING_DEMO_ETA, type ServicePricing, type EtaPolicy } from '../business/pricing.ts';

/** Turns of history sent verbatim. A phone call's working memory. */
export const HISTORY_WINDOW = 20;

/**
 * The most a single spoken turn may run to.
 *
 * About 55 words — a generous receptionist answer. Most good turns are
 * a third of this; the limit exists to catch the paragraph, not to
 * shape the sentence. Enforced at a clause boundary so a capped turn
 * still ends on a finished thought.
 */
export const MAX_SPEECH_CHARS = 340;

/**
 * How many outstanding fields the model is shown at once.
 *
 * A short list reads as "what would help next"; the full schema reads
 * as a form to complete, and the agent completes it. Everything else
 * is still tracked — it is simply not put in front of the model until
 * the conversation is anywhere near it.
 */
export const MAX_GOALS_SHOWN = 6;

/**
 * The bar an industry must clear when the only evidence is vocabulary
 * two industries share.
 *
 * A crash is described identically by someone who wants a tow and
 * someone who wants a lawyer. Committing on a middling score is how a
 * caller ends up hearing "you have reached a law firm".
 */
export const SHARED_VOCABULARY_THRESHOLD = 0.85;

/**
 * Has the caller asked how long the repair will take?
 *
 * Monotonic, like the gated tools: once they have asked, the timeline
 * stays in the prompt for the rest of the call, so a follow-up
 * question does not find the explanation gone.
 */
function wantsRepairTimeline(session: Session): boolean {
  if (session.askedRepairTimeline) return true;
  // A vehicle now on a truck is a caller about to ask what happens
  // next. Waiting for them to say the words means the explanation is
  // missing at the one moment it is certain to be needed.
  const q = session.qualification as Record<string, unknown>;
  if (q.towStatus || q.dropOffScheduled) {
    session.askedRepairTimeline = true;
    return true;
  }
  const said = session.turns.filter((t) => t.role === 'caller').map((t) => t.text).join(' ');
  const asked = /\bhow long\b|\bhow many (days|weeks)\b|\bwhen will it be (done|ready)\b|\btimeline\b|\bhow soon\b|\bturnaround\b|\bget it back\b/i.test(said);
  if (asked) session.askedRepairTimeline = true;
  return asked;
}

/** One labelled section of the system prompt: [name, text]. */
export type PromptBlock = [name: string, text: string];

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
  /** True when the caller talked over us and this turn was abandoned. */
  interrupted?: boolean;
}

/**
 * How a turn reaches the caller.
 *
 * `onClause` is called with each speakable fragment as the model
 * produces it, so speech begins roughly a time-to-first-token after
 * the caller stops rather than after the whole reply exists. `signal`
 * aborts everything the moment they interrupt.
 */
export interface TurnDelivery {
  onClause?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * Records a timing mark.
   *
   * Passed down rather than logged here because the two marks that
   * matter most — the request going out and the first token coming
   * back — are only visible inside the streaming client.
   */
  mark?: (mark: TimelineMark) => void;
}

/**
 * The demo line's opening.
 *
 * Re-exported from business/greeting.ts so existing imports keep
 * working, but the two greetings live there together where the
 * demo/client separation is enforced.
 */
export const GREETING = DEMO_GREETING;

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

  async handleTurn(callSid: string, utterance: string, delivery: TurnDelivery = {}): Promise<TurnResult> {
    const { sessions, claude, log } = this.deps;
    delivery.mark?.('TURN_HANDLER_START');
    const session = sessions.ensure(callSid);
    sessions.addTurn(callSid, 'caller', utterance);

    // On the demo line, work out whether they are still pretending to
    // be a customer or have started asking about the product. Routing
    // "I own a plumbing company and I want this" into a plumbing
    // simulation would be the worst failure this line could have.
    if (this.profileFor(session.route.industry).mode === 'demo') {
      const hasRolePlayed = session.routed || session.turns.length > 2;

      if (session.demoPhase !== 'yad_sales') {
        const intent = detectSalesIntent(utterance, hasRolePlayed);
        if (intent.detected) {
          // Captured BEFORE the phase flips, because the industry is
          // read off the route the simulation established. "I own a
          // plumbing company and I want this" also matches plumbing
          // keywords, so waiting would record the sentence that ended
          // the demo rather than the scenario they actually tested.
          session.scenarioTested ??= session.route.industry;
          session.demoPhase = 'yad_sales';
          log.log('demo.sales_intent', { callSid, signals: intent.signals, immediate: intent.immediate });
        }
      }

      if (isDecliningOffer(utterance)) {
        session.ctaDeclined = true;
        log.log('demo.cta_declined', { callSid });
      }
    }

    // The number they are calling from is the obvious callback number,
    // and making someone read their own phone number back is the kind
    // of thing that makes an automated system feel automated. It is
    // recorded as provisional so the agent still confirms it once, and
    // any number they actually give replaces it.
    if (!session.contact.phone && isUsableNumber(session.from)) {
      session.contact.phone = session.from;
      session.contact.phoneSource = 'caller_id';
      // Provisional. Twilio told us; the caller has not. The agent
      // confirms it rather than asking for a number we already have.
      session.contact.phoneConfirmed = false;
      // Field names and provenance only — never the number itself.
      log.log('field.captured', { callSid, fields: ['phone'], source: 'caller_id', confirmed: false });
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
    // Once they are talking to us rather than testing, a scenario
    // switch is meaningless — there is no scenario any more.
    if (session.routed && session.demoPhase !== 'yad_sales'
        && this.profileFor(session.route.industry).mode === 'demo') {
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

    // Once they are asking about the product, there is no scenario to
    // route. Sending "I own a plumbing company and I want this" through
    // the classifier would start a plumbing simulation, which is the
    // single worst thing this line could do to a prospect.
    if (!session.routed && session.demoPhase !== 'yad_sales') {
      const reply = await this.routeTurn(session, utterance);
      if (reply) {
        sessions.addTurn(callSid, 'agent', reply);
        return { text: reply, action: 'SPEAK_AND_CONTINUE' };
      }
    }

    const reply = await this.specialistTurn(session, guard.reinforcement, delivery);

    // The caller talked over us. Whatever was generated is abandoned:
    // it does not go into the transcript, because they never heard it
    // and treating it as said would make the next turn reply to a
    // sentence that was cut off mid-word.
    if (delivery.signal?.aborted) {
      delivery.mark?.('CLAUDE_ABORTED');
      log.log('turn.interrupted', { callSid });
      return { text: '', action: 'SPEAK_AND_CONTINUE', interrupted: true };
    }

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
    // A stated service request settles the industry before anything is
    // scored. Accident words are shared vocabulary — "rear-ended"
    // belongs to a body shop and a law firm equally — and the thing
    // that separates them is what the caller is asking us to DO.
    const service = decisiveServiceIntent(utterance);

    // Naming both services is genuinely ambiguous however it scores —
    // they told us two things and we would be picking one at random.
    if (!service && isMixedServiceIntent(utterance) && session.clarifyAttempts < maxClarifyAttempts) {
      session.clarifyAttempts += 1;
      log.log('router.clarify', { callSid: session.callSid, attempt: session.clarifyAttempts, reason: 'mixed-service' });
      return SERVICE_CLARIFIER;
    }

    const decision = await route(context || utterance, { claude, threshold: confidenceThreshold });

    // Routing reads the last few caller turns together, which is right
    // for working out the industry and wrong for the intent: after a
    // clarifying question the older turns dilute what they just asked
    // for, and "the car first, I need a tow" came back as a general
    // estimate. When the current sentence alone agrees on the industry
    // and is more specific, it wins.
    if (context && context !== utterance) {
      const now = classifyHeuristic(utterance);
      if (now.industry === decision.industry && now.intent && now.intent !== decision.intent) {
        decision.intent = now.intent;
        decision.urgency = now.urgency;
      }
    }

    // The classifier may still have landed on the other industry — a
    // sentence full of crash words scores that way. The service the
    // caller named wins.
    if (service && decision.industry !== service.industry) {
      log.log('router.decision', {
        callSid: session.callSid, overridden: true,
        from: decision.industry, to: service.industry, matched: service.matched,
      });
      // The intent has to go with it. Leaving the old one behind gives
      // a collision route an attorneys intent — which is how a tow
      // request ended up answered with "is the car still drivable?".
      const asService = classifyHeuristic(utterance);
      decision.industry = service.industry;
      decision.specialty = null;
      decision.intent = asService.industry === service.industry ? asService.intent : null;
      decision.urgency = asService.industry === service.industry ? asService.urgency : 'normal';
      decision.confidence = Math.max(decision.confidence, 0.9);
    }

    log.log('router.decision', {
      callSid: session.callSid,
      industry: decision.industry,
      specialty: decision.specialty,
      intent: decision.intent,
      urgency: decision.urgency,
      confidence: Number(decision.confidence.toFixed(2)),
      source: decision.source,
    });

    // Accident words are shared vocabulary, so a merely-passable score
    // on them is not enough to commit an industry. "I was rear-ended"
    // scoring 0.78 for a law firm is precisely the case that put a tow
    // caller through to one.
    //
    // Only where the spec demands it: accident vocabulary alone is not
    // enough to commit to a LAW FIRM. Routing the same words to the
    // body shop needs no extra bar — a caller who wanted a lawyer can
    // say so and be moved, whereas the reverse is the failure this
    // exists to stop, and someone describing a scene on a bridge must
    // not be handed a menu.
    const bareAccident = !service && isBareAccidentMention(utterance);
    const unevidencedLegal = bareAccident && decision.industry === 'attorneys';
    const bar = unevidencedLegal ? Math.max(confidenceThreshold, SHARED_VOCABULARY_THRESHOLD) : confidenceThreshold;
    const confident = decision.industry !== null && decision.confidence >= bar;
    if (!confident && session.clarifyAttempts < maxClarifyAttempts) {
      session.clarifyAttempts += 1;
      // Crash words with no service attached and no confident route.
      // "I was rear-ended" says something happened and nothing about
      // what they want; picking an industry from it is what put a tow
      // caller through to a law firm. A confident route is left alone
      // — someone describing a scene on a bridge does not want a menu.
      const question = bareAccident
        ? BARE_ACCIDENT_CLARIFIER
        : decision.clarifyingQuestion ?? "Can you tell me a bit more about what you need help with?";
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


  /**
   * Assembles the system prompt, keeping each block labelled.
   *
   * The labels exist so tools/token-budget.mts can report exactly what
   * production sends rather than a reconstruction of it — a budget
   * measured from a copy is a budget that quietly drifts.
   */
  buildSystemPrompt(
    session: Session,
    spec: ReturnType<typeof selectSpecialist>,
    reinforcement: string | null = null,
  ): { system: string; cachedSystemPrefix: string; blocks: PromptBlock[] } {
    const { log } = this.deps;
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
        }, { repairTimeline: wantsRepairTimeline(session) })
      : null;

    // The demo-host layer. Demo mode only — a client's caller must
    // never hear any of this.
    const isDemo = profile.mode === 'demo';
    const demoBlock = isDemo
      ? renderDemoHost(session.demoPhase ?? 'role_play', {
          hasRolePlayed: session.routed || session.turns.length > 4,
          scenarioTested: session.scenarioTested ?? session.route.industry,
          ctaOffered: session.ctaOffered === true,
          ctaDeclined: session.ctaDeclined === true,
          calendarMode: this.deps.tools?.modes.calendar ?? 'mock',
        })
      : null;

    // What this call is actually for, with what is already known struck
    // off — so the model reasons toward an outcome instead of working
    // down a list of fields.
    const goalBlock = renderGoal(session, session.route.industry);
    const offerBlock = renderOfferMemory(session);
    // A refused tool, restated as the question that unblocks it.
    const blockedBlock = renderToolBlocks(session);

    // Confirm the number we already have rather than asking for one.
    const phoneBlock = renderPhoneGuidance(session, session.route.industry);

    // How to pronounce what has already been captured.
    const speechBlock = renderSpeechGuidance(session.contact);

    // ---- Static half. Identical on every turn of this call, so it is
    // the part worth caching: roughly 85% of the payload, none of it
    // turn-dependent. Anything whose text moves with the conversation
    // belongs below the breakpoint, or the cache misses every turn and
    // the whole exercise is pointless.
    const staticBlocks: PromptBlock[] = [
      ['core agent rules', CORE_AGENT_RULES],
      ['industry specialist', spec ? spec.systemPrompt : 'You are a general intake receptionist. Find out what the caller needs and take their contact details.'],
      ['business profile', renderBusinessProfile(profile)],
      ...(pricingBlock ? [['pricing', pricingBlock] as PromptBlock] : []),
      ...(actionBlock ? [['action policies', actionBlock] as PromptBlock] : []),
    ];

    // ---- Turn-dependent half.
    const dynamicBlocks: PromptBlock[] = [
      // The goal leads the dynamic half: it is what everything below
      // serves, and it carries what has already been established.
      ...(goalBlock ? [['industry goal', goalBlock] as PromptBlock] : []),
      ...(demoBlock ? [['demo host', demoBlock] as PromptBlock] : []),
      ...(speechBlock ? [['speech guidance', speechBlock] as PromptBlock] : []),
      ...(phoneBlock ? [['phone guidance', phoneBlock] as PromptBlock] : []),
      ...(offerBlock ? [['offer memory', offerBlock] as PromptBlock] : []),
      ...(blockedBlock ? [['blocked actions', blockedBlock] as PromptBlock] : []),
      // Earlier narrative, once the call has outgrown the history
      // window. Structured state below covers the fields; this covers
      // what was said that never became one.
      ...(session.summary
        ? [['summary', `EARLIER IN THIS CALL (internal — never read aloud):\n${session.summary.text}`] as PromptBlock]
        : []),
      ['structured state', this.stateBrief(
        session,
        // A specialist may narrow the list to what this kind of call
        // actually needs. Most do not, and get the whole schema.
        spec?.qualificationGoalsFor?.(session) ?? spec?.qualificationSchema.map((f) => f.goal) ?? [],
      )],
      // The caller's actual question comes after the state brief so it
      // is not buried behind a list of fields still to collect.
      ...(knowledgeBlock ? [['knowledge', knowledgeBlock] as PromptBlock] : []),
      // Appended last so it is the most recent thing the model read.
      ...(reinforcement ? [['reinforcement', reinforcement] as PromptBlock] : []),
    ];

    const SEP = '\n\n---\n\n';
    const staticText = staticBlocks.map(([, text]) => text).join(SEP);
    const dynamicText = dynamicBlocks.map(([, text]) => text).join(SEP);
    // The separator belongs to the prefix so the cached span ends on a
    // clean boundary and the suffix starts with real content.
    const cachedSystemPrefix = staticText + SEP;

    return {
      system: cachedSystemPrefix + dynamicText,
      cachedSystemPrefix,
      blocks: [...staticBlocks, ...dynamicBlocks],
    };
  }

  /** Stage 2. The specialist owns the conversation from here. */
  private async specialistTurn(
    session: Session,
    reinforcement: string | null = null,
    delivery: TurnDelivery = {},
  ): Promise<string> {
    const { claude, log } = this.deps;
    const spec = selectSpecialist(session);

    if (!claude) {
      // No API key: keep the call alive and honest rather than crashing.
      return spec
        ? "Thanks — I've got that. Let me take a few details so someone can follow up with you."
        : "Thanks for that. Let me take a few details so the right person can call you back.";
    }

    const { system, cachedSystemPrefix } = this.buildSystemPrompt(session, spec, reinforcement);

    const messages = session.turns
      .slice(-HISTORY_WINDOW) // keeps latency and cost bounded on long calls
      .map((t) => ({ role: (t.role === 'caller' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text }));

    try {
      const claudeRequestStartedAt = Date.now();
      log.log('llm.request', { callSid: session.callSid, turns: messages.length, systemChars: system.length });
      const reply = await this.runTurn(session, system, messages, delivery, cachedSystemPrefix);
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
  private async runTurn(
    session: Session,
    system: string,
    messages: ClaudeMessage[],
    delivery: TurnDelivery = {},
    cachedSystemPrefix?: string,
  ): Promise<string> {
    const { claude, log, tools, maxToolRounds = 2 } = this.deps;
    if (!claude) return '';

    // Without a tool-capable client or a toolbox, this is a plain
    // completion — which is what the tests and the no-credential
    // demo path use.
    if (!claude.send || !tools) {
      return claude.complete({
        system, messages, cachedSystemPrefix,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
      });
    }

    // Streaming path. Speech starts on the first clause rather than
    // after the whole reply, which is the difference between a
    // conversational pause and a robotic one.
    //
    // Only used when there is somewhere to stream TO and the model is
    // not expected to reach for a tool first — a tool round trip has
    // nothing speakable in it, so the second pass is where the words
    // come from.
    if (delivery.onClause && claude.stream) {
      // Whether the caller has heard anything yet this turn. The
      // pre-tool acknowledgement below depends on knowing, and the
      // model is not a reliable reporter of its own output.
      let spokenThisTurn = false;
      const speak = (text: string) => {
        spokenThisTurn = true;
        delivery.onClause?.(text);
      };

      const res = await claude.stream({
        system, messages, cachedSystemPrefix,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
        tools: toolsFor(session.route.industry, session.demoPhase, session),
        onClause: speak,
        signal: delivery.signal,
        onRequestStart: () => delivery.mark?.('CLAUDE_REQUEST_START'),
        onFirstStreamEvent: () => delivery.mark?.('CLAUDE_FIRST_STREAM_EVENT'),
        maxSpeechChars: MAX_SPEECH_CHARS,
      });
      this.recordUsage(session, res);

      if (res.toolUses.length === 0) return res.text;

      // A tool was requested. Run it, then stream the follow-up — the
      // caller has heard nothing yet, so this is where their answer
      // comes from.
      const convo: ClaudeMessage[] = [...messages];
      convo.push({ role: 'assistant', content: res.raw });
      const results = [];
      let immediate: string | null = null;

      for (const use of res.toolUses) {
        // Say something before a slow action, if the model has not.
        //
        // Measured: a four-second dispatch with no acknowledgement is
        // four seconds of a caller listening to silence. A prompt rule
        // asking the model to speak first works until it does not, and
        // this is the caller's experience either way — so the
        // transport guarantees it rather than hoping.
        //
        // Present continuous, always: "I'm setting that up" is true the
        // moment it is said. The tool may still fail.
        if (!spokenThisTurn && !delivery.signal?.aborted) {
          const ack = preToolAcknowledgement(use.name);
          if (ack) {
            delivery.mark?.('PRE_TOOL_ACK_SENT');
            speak(ack);
          }
        }

        const outcome = await executeToolRequest({ id: use.id, name: use.name, input: use.input }, { tools, log, session });
        results.push({ type: 'tool_result', tool_use_id: outcome.id, content: outcome.content, is_error: !outcome.ok });
        immediate ??= immediateResultSpeech(use.name, outcome);
      }
      convo.push({ role: 'user', content: results });

      // A confirmed dispatch already knows its own ETA. Going back to
      // the model to have it read that number aloud adds a full
      // generation of silence at the moment the caller most wants an
      // answer, so it is spoken directly and the turn ends there.
      if (immediate && !delivery.signal?.aborted) {
        delivery.mark?.('IMMEDIATE_RESULT_SENT');
        speak(immediate);
        return [res.text, immediate].filter(Boolean).join(' ').trim();
      }

      if (delivery.signal?.aborted) {
        delivery.mark?.('CLAUDE_ABORTED');
        return res.text;
      }

      // The tools are declared again, and forbidden.
      //
      // `convo` now contains tool_use blocks, so the definitions have
      // to be present for that history to mean anything — dropping
      // them leaves the conversation referring to tools the request
      // never declares. tool_choice 'none' keeps the original intent:
      // this pass is for speaking, not another round trip. Re-sending
      // them is free, because they are inside the cached prefix.
      const follow = await claude.stream({
        system, messages: convo, cachedSystemPrefix,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
        tools: toolsFor(session.route.industry, session.demoPhase, session),
        toolChoice: 'none',
        onClause: speak,
        signal: delivery.signal,
        onRequestStart: () => delivery.mark?.('CLAUDE_REQUEST_START'),
        onFirstStreamEvent: () => delivery.mark?.('CLAUDE_FIRST_STREAM_EVENT'),
        maxSpeechChars: MAX_SPEECH_CHARS,
      });
      this.recordUsage(session, follow);
      return follow.text || res.text;
    }

    const convo: ClaudeMessage[] = [...messages];
    let spoken = '';

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const res: CompleteResult = await claude.send({
        system,
        messages: convo,
        cachedSystemPrefix,
        model: this.models.specialist.model,
        maxTokens: this.models.specialist.maxTokens,
        temperature: this.models.specialist.temperature,
        // Always declared, because `convo` may already carry tool_use
        // blocks; the final round simply forbids their use rather than
        // leaving those blocks undefined.
        tools: toolsFor(session.route.industry, session.demoPhase, session),
        toolChoice: round < maxToolRounds ? 'auto' : 'none',
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

    // Only the next few. Handing over the entire schema — fifty-odd
    // lines under "still needed, in roughly this order" — is what
    // turned the agent into a form: given a numbered list, it works
    // down the list. The caller's actual goal decides what matters
    // next, and the rest of the schema will still be there when it
    // does.
    const nextUp = goals.slice(0, MAX_GOALS_SHOWN);
    const remaining = goals.length - nextUp.length;

    return [
      'CALL STATE (internal — never read this out as a list):',
      contact.length ? `Contact details on file:\n${contact.join('\n')}` : 'Contact details on file: none yet.',
      answers.length ? `Answers already given:\n${answers.join('\n')}` : '',
      nextUp.length
        ? `Useful to know next, if the conversation goes there naturally:\n${nextUp.map((g) => `- ${g}`).join('\n')}${
            remaining > 0 ? `\n(${remaining} more, not urgent — do not go looking for them.)` : ''
          }`
        : '',
      '',
      'RULES FOR THIS LIST',
      '- This is not a questionnaire and not an order of play. Answer what the caller actually asked, then take the one thing that moves their problem forward.',
      '- Never ask again for anything listed above. The caller already told you.',
      '- If they ask what you have — "do you have my ZIP?", "what address do you have?" — answer from this list, accurately. If it is not there, say so plainly and ask for it.',
      '- When they give you something new, or correct something, call capture_details straight away so it is recorded. Do not wait until the end of the call; callers hang up.',
      '- A correction replaces the old value silently. Do not make them repeat it twice.',
    ].filter(Boolean).join('\n');
  }
}
