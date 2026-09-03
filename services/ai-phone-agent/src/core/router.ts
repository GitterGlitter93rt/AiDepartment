// STAGE 1 — the router.
//
// Two layers, deliberately:
//
//   1. A deterministic weighted classifier. Most real callers open with
//      an unmistakable sentence ("water is pouring under my sink"), and
//      answering those without a network round-trip removes ~1s of
//      dead air from the start of every call. It is also fully
//      unit-testable with no API key, which is what lets CI verify
//      routing behaviour at all.
//
//   2. Claude, consulted only when the heuristic is uncertain. Natural
//      language is endlessly varied and a keyword table will never
//      cover it; the LLM is the general case, the table is the fast
//      path.
//
// If confidence is still low after both, we ask ONE natural
// clarifying question. The caller never hears a menu, never hears the
// word "industry", and never hears anything about classification.

import { decisiveServiceIntent } from './service-intent.ts';
import type { Industry, RouteDecision, Urgency } from './types.ts';
import type { ClaudeClient } from '../claude/client.ts';
import { RULES, EMERGENCY_MARKERS } from './router-rules.ts';
import { ROUTER_SYSTEM_PROMPT } from '../prompts/router.ts';


/**
 * Situations where the words genuinely do not settle the trade, and a
 * confident answer is a guess wearing a suit.
 *
 * The first real production call opened with water coming through a
 * ceiling. The router said roofing at high confidence, the caller
 * explained further, and it had to reroute to plumbing mid-call. It
 * was never a roofing call — the router simply had no way to know, and
 * said so with more certainty than the evidence supported.
 *
 * Water travels. A ceiling stain comes from a roof, a supply line, a
 * bathroom above, or an air handler's condensate, and the only thing
 * that separates them is a question. Each entry here caps confidence
 * and supplies the one question that actually discriminates.
 */
interface Ambiguity {
  id: string;
  /** The situation, with no discriminating context. */
  pattern: RegExp;
  /** Any of these settle it, so the ambiguity does not apply. */
  resolvedBy: RegExp[];
  question: string;
}

/** Ceiling for anything matching a known ambiguity. Below every threshold. */
export const AMBIGUOUS_CONFIDENCE_CAP = 0.5;

export const AMBIGUITIES: Ambiguity[] = [
  {
    id: 'ceiling_water',
    // Both word orders. "My ceiling is leaking" and "water is coming
    // through my ceiling" are the same call.
    pattern: /\b(ceiling|upstairs floor)\b[^.]{0,45}\b(leak\w*|water|drip\w*|wet|stain|spot|coming through|pouring)\b|\b(leak\w*|water|drip\w*|pouring|coming (through|down))\b[^.]{0,35}\b(ceiling|upstairs floor)\b/i,
    resolvedBy: [
      // Roof side.
      /\b(roof|shingle|storm|rain|raining|rained|hail|wind|attic|gutter|flashing|skylight|tarp|hurricane)\b/i,
      // Plumbing side.
      /\b(pipe|plumb\w*|bathroom|shower|tub|toilet|sink|washing machine|water heater|supply line|upstairs bath|dishwasher)\b/i,
      // HVAC side.
      /\b(a\/?c|air ?condition\w*|air handler|condensate|hvac|furnace)\b/i,
    ],
    question:
      "Let's work out where it's coming from — did this start during rain, or is there a bathroom or air conditioner above that spot?",
  },
];

/** The ambiguity this utterance falls into, if any. */
export function detectAmbiguity(utterance: string): Ambiguity | null {
  for (const a of AMBIGUITIES) {
    if (!a.pattern.test(utterance)) continue;
    if (a.resolvedBy.some((re) => re.test(utterance))) continue;
    return a;
  }
  return null;
}

export interface HeuristicResult extends RouteDecision {
  /** Score of the runner-up industry, for margin diagnostics. */
  runnerUp: number;
  topScore: number;
}

/**
 * Deterministic pass. Scores every rule, then converts the winning
 * score and its margin over the best rule from a DIFFERENT industry
 * into a confidence value.
 *
 * The margin matters more than the raw score: "my roof is leaking"
 * matches both roofing and plumbing leak rules, and what makes it
 * confidently roofing is that the roofing rule scores materially
 * higher — not that it scored at all.
 */
export function classifyHeuristic(utterance: string): HeuristicResult {
  const text = utterance.toLowerCase();
  const scored = RULES.map((rule) => {
    // Disqualifying context wins outright — see Rule.veto.
    for (const re of rule.veto ?? []) if (re.test(text)) return { rule, score: 0, anchorHits: 0 };

    let anchorHits = 0;
    let score = 0;
    for (const re of rule.anchors) if (re.test(text)) { anchorHits += 1; score += 10; }
    for (const re of rule.support ?? []) if (re.test(text)) score += 2;
    return { rule, score, anchorHits };
  })
    // A rule with no anchor hit has matched only corroborating words —
    // "house", "water", "insurance" — which appear in half the calls we
    // take. Support terms exist to strengthen an anchor, never to
    // classify on their own, so a support-only match is discarded
    // rather than being allowed to name an industry at low confidence.
    .filter((s) => s.anchorHits > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      industry: null, specialty: null, intent: null, urgency: 'normal',
      confidence: 0, source: 'none', topScore: 0, runnerUp: 0,
    };
  }

  const best = scored[0];
  const rival = scored.find((s) => s.rule.industry !== best.rule.industry);
  const runnerUp = rival?.score ?? 0;
  const margin = best.score - runnerUp;

  // Confidence model.
  //
  // Margin alone must NOT manufacture certainty: a single weak anchor
  // with no competing industry has a large margin purely because
  // nothing else matched, which is absence of evidence rather than
  // evidence. "The roof of the marital home" mentions a roof but is
  // not a roofing call, and it should not score like one.
  //
  // So the tiers are driven by how much evidence the winning rule
  // itself gathered, with margin only sharpening an already-strong
  // match. One anchor = a plausible guess; anchor plus corroboration =
  // confident; two anchors = near-certain.
  let confidence = 0;
  if (best.score >= 10) confidence = 0.62;
  if (best.score >= 10 && runnerUp === 0) confidence = 0.78; // plausible, uncontested
  if (best.score >= 12) confidence = Math.max(confidence, 0.80);
  if (best.score >= 12 && margin >= 4) confidence = Math.max(confidence, 0.86);
  if (best.score >= 20) confidence = Math.max(confidence, 0.93);
  if (best.score >= 20 && margin >= 10) confidence = Math.max(confidence, 0.95);
  confidence = Math.min(confidence, 0.97);

  // A known ambiguity caps confidence however well the keywords scored.
  // Applied here rather than only in route() so that anything reading
  // the heuristic — including the safety-contract tests — sees the same
  // honest number the caller's routing acts on.
  if (detectAmbiguity(utterance)) confidence = Math.min(confidence, AMBIGUOUS_CONFIDENCE_CAP);

  let urgency: Urgency = best.rule.urgency ?? 'normal';
  if (EMERGENCY_MARKERS.some((re) => re.test(text)) && urgency !== 'emergency') {
    urgency = urgency === 'normal' ? 'high' : urgency;
  }

  return {
    industry: best.rule.industry,
    specialty: best.rule.specialty,
    intent: best.rule.intent,
    urgency,
    confidence,
    source: 'heuristic',
    topScore: best.score,
    runnerUp,
  };
}

// Phrases where the caller is explicitly asking to try something else.
// A demo line gets this constantly — a prospect wants to hear the
// plumbing agent after the divorce one.
const EXPLICIT_SWITCH = [
  /\b(try|test|hear|show me|do)\b[^.]{0,30}\b(another|different|other)\b/i,
  /\bwhat about\b/i,
  /\b(can|could) (you|we|i) (try|test|hear|do)\b/i,
  /\blet'?s (try|test|do)\b/i,
  /\banother (one|scenario|example|industry|business)\b/i,
  /\bstart over\b/i,
  /\bdifferent (scenario|example|business|industry)\b/i,
];

export interface ScenarioChange {
  changed: boolean;
  reason: 'explicit' | 'new-scenario' | 'service-request' | null;
  decision: RouteDecision | null;
}

/**
 * Decide whether an already-routed call should switch specialists.
 *
 * Deliberately conservative. A divorce caller mentioning "the roof of
 * the marital home" must NOT become a roofing call, so a bare topic
 * mention is not enough — the new utterance has to either ask
 * explicitly to try something else, or stand on its own as a clear,
 * high-confidence scenario in a different industry.
 */
/**
 * A stated service request beats any score.
 *
 * The live failure: a call routed to a personal injury firm, the
 * caller said "I need a tow", that scored 0.78 against a switch
 * threshold of 0.85, so nothing moved and the law firm persona told
 * them they had rung the wrong number. A caller naming the service
 * they want is not a scoring signal to be weighed — it is the answer.
 */
function serviceOverride(utterance: string, currentIndustry: Industry | null): ScenarioChange | null {
  const signal = decisiveServiceIntent(utterance);
  if (!signal || signal.industry === currentIndustry) return null;

  const fresh = classifyHeuristic(utterance);
  // Prefer the full classification when it agrees, so the intent and
  // urgency come with it; otherwise switch on the service alone.
  const decision = fresh.industry === signal.industry
    ? stripInternals(fresh)
    : { industry: signal.industry, specialty: null, intent: null, urgency: 'normal' as const, confidence: 0.9, source: 'heuristic' as const };
  return { changed: true, reason: 'service-request', decision };
}

export function detectScenarioChange(
  utterance: string,
  currentIndustry: Industry | null,
  switchThreshold = 0.85,
): ScenarioChange {
  // Checked before anything else: it is the caller telling us which
  // business they want, in words.
  const override = serviceOverride(utterance, currentIndustry);
  if (override) return override;

  const explicit = EXPLICIT_SWITCH.some((re) => re.test(utterance));
  const fresh = classifyHeuristic(utterance);
  const differentIndustry = fresh.industry !== null && fresh.industry !== currentIndustry;

  if (explicit && differentIndustry) {
    return { changed: true, reason: 'explicit', decision: stripInternals(fresh) };
  }
  // Explicit ask with no industry named yet — re-open routing so the
  // next thing they say is classified fresh.
  if (explicit && !fresh.industry) {
    return { changed: true, reason: 'explicit', decision: null };
  }
  if (differentIndustry && fresh.confidence >= switchThreshold) {
    return { changed: true, reason: 'new-scenario', decision: stripInternals(fresh) };
  }
  return { changed: false, reason: null, decision: null };
}

/** One natural clarifying question. Never mentions industries, menus,
 * routing or classification — it reads as a receptionist asking what
 * the call is about. */
export function clarifyingQuestionFor(utterance: string): string {
  const ambiguity = detectAmbiguity(utterance);
  if (ambiguity) return ambiguity.question;

  if (/\bhouse\b|\bhome\b|\bproperty\b/i.test(utterance)) {
    return "Happy to help — is this about a repair, a legal matter, buying or selling, or something else?";
  }
  return "Of course — can you tell me a little more about what's going on so I can point you the right way?";
}

export interface RouteOptions {
  claude?: ClaudeClient | null;
  threshold?: number;
}

/**
 * Full two-stage routing. Heuristic first; Claude only when the
 * heuristic is not confident enough, and only if a client is available.
 */
export async function route(utterance: string, opts: RouteOptions = {}): Promise<RouteDecision> {
  const threshold = opts.threshold ?? 0.6;
  const heuristic = classifyHeuristic(utterance);

  // A known ambiguity caps confidence no matter how well the keywords
  // scored. Routing "water is coming through my ceiling" to roofing at
  // 0.86 is not a near miss — it is stating something the words do not
  // support, and it cost a reroute on the first production call.
  const ambiguity = detectAmbiguity(utterance);
  if (ambiguity) {
    return {
      ...stripInternals(heuristic),
      confidence: Math.min(heuristic.confidence, 0.5),
      clarifyingQuestion: ambiguity.question,
    };
  }

  if (heuristic.confidence >= 0.8) {
    return stripInternals(heuristic);
  }

  if (opts.claude) {
    try {
      const llm = await classifyWithClaude(utterance, opts.claude);
      if (llm && llm.confidence >= threshold && llm.industry) {
        return llm;
      }
      // Claude answered but was itself unsure — prefer whichever is
      // more confident rather than discarding a usable heuristic.
      if (llm && heuristic.industry && heuristic.confidence >= llm.confidence) {
        return stripInternals(heuristic);
      }
      if (llm && llm.industry) return llm;
    } catch {
      // Network/API failure must never end the call. Fall through to
      // the heuristic, then to a clarifying question.
      if (heuristic.industry && heuristic.confidence >= threshold) {
        return { ...stripInternals(heuristic), source: 'llm-fallback' };
      }
    }
  }

  if (heuristic.industry && heuristic.confidence >= threshold) {
    return stripInternals(heuristic);
  }

  return {
    industry: heuristic.industry,
    specialty: heuristic.specialty,
    intent: heuristic.intent,
    urgency: heuristic.urgency,
    confidence: heuristic.confidence,
    source: heuristic.source,
    clarifyingQuestion: clarifyingQuestionFor(utterance),
  };
}

function stripInternals(h: HeuristicResult): RouteDecision {
  const { topScore: _t, runnerUp: _r, ...rest } = h;
  return rest;
}

const VALID_INDUSTRIES: Industry[] = ['attorneys', 'plumbing', 'roofing', 'real_estate', 'pressure_washing'];

/** Ask Claude for a strict JSON classification. Anything malformed or
 * out-of-vocabulary is rejected rather than trusted. */
export async function classifyWithClaude(utterance: string, claude: ClaudeClient): Promise<RouteDecision | null> {
  const raw = await claude.complete({
    system: ROUTER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: utterance }],
    maxTokens: 200,
    temperature: 0,
  });
  return parseRouterJson(raw);
}

/** Exported for testing: tolerant of code fences and surrounding prose,
 * strict about the values it accepts. */
export function parseRouterJson(raw: string): RouteDecision | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const industry = String(parsed.industry ?? '').trim() as Industry;
  if (!VALID_INDUSTRIES.includes(industry)) return null;
  const confidence = Number(parsed.confidence);
  const urgency = String(parsed.urgency ?? 'normal') as Urgency;
  return {
    industry,
    specialty: parsed.specialty ? String(parsed.specialty) : null,
    intent: parsed.intent ? String(parsed.intent) : null,
    urgency: (['emergency', 'high', 'normal', 'low'] as Urgency[]).includes(urgency) ? urgency : 'normal',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    source: 'llm',
  };
}
