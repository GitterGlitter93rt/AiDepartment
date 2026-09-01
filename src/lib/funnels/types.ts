// Typed configuration contract for paid-social VSL funnels.
//
// A funnel is DATA, not markup: every route under src/pages/ is a thin
// file that hands one of these objects to FunnelPage.astro. Adding a
// vertical means adding one data file and one three-line route — never
// copying a page template.
//
// SECTION BUDGET (enforced by tests/paidSocialFunnels.test.ts).
// These pages are read on a phone, immediately after a short video ad.
// They are not proposals and not education. The budget is deliberate:
//
//   plumbing            6-8 major sections
//   attorney verticals  7-9 major sections
//
// Before adding a section or a card, the question is: does this
// materially increase the chance a cold paid-social visitor books the
// next step? If not, it belongs in the sales call, not on the page.
//
// Content rules:
//   - no testimonials, reviews, client names, logos, or case studies
//   - no fabricated statistics, ROI, revenue, or conversion-rate claims
//   - illustrative material must be explicitly labeled (IllustrativeWorkflow)
//   - no countdown timers, fake scarcity, or fake rating markup
//   - cards run ~15-45 words; paragraphs run 1-3 sentences

/** Vertical identifier — a GA4 custom-dimension value. Non-PII. */
export type FunnelVertical = 'plumbing' | 'personal_injury' | 'divorce_law';

/** Funnel identifier — a GA4 custom-dimension value, and the suffix of
 * the funnel-scoped booking-click event name. Non-PII. */
export type FunnelId = 'plumbing_ai' | 'personal_injury_ai' | 'divorce_law_ai';

/** Which CTA a click represents. */
export type CtaType = 'demo' | 'strategy_call';

/**
 * Where on the page a CTA was clicked.
 *
 * Four placements, plus the mobile sticky bar — not a strip after every
 * section. `sticky` is the persistent mobile bar, tracked separately so
 * its contribution can be measured (and the bar removed if it turns out
 * to earn nothing).
 */
export type CtaLocation = 'hero' | 'offer' | 'faq' | 'final' | 'sticky';

export interface FunnelCta {
  /** Button label. MUST differ per vertical — message match matters
   * more than component reuse. */
  label: string;
  /** Optional shorter label used ONLY by the mobile sticky bar, where a
   * long CTA wraps badly. Falls back to `label` when unset, so a funnel
   * that does not set it keeps its existing sticky-bar wording. */
  compactLabel?: string;
  /** Centralized Cal.com event from src/lib/scheduling.ts — never a
   * hardcoded Cal URL. */
  href: string;
  type: CtaType;
  /** One short reassurance line. No scarcity, no timers. */
  microcopy?: string;
}

/**
 * VSL configuration. The analytics contract differs by mode:
 *   'file'  — self-hosted MP4/WebM from /public. Full event support:
 *             vsl_play + vsl_progress (25/50/75/100) from real <video>
 *             events.
 *   'embed' — third-party iframe. Playback cannot be observed
 *             cross-origin without that vendor's SDK, so NO engagement
 *             events are emitted. A fabricated signal is worse than a
 *             missing one.
 *
 * When `vsl` is undefined the hero renders as a wide, copy-led layout —
 * never an empty player well or a "coming soon" placeholder.
 */
export type FunnelVsl =
  | {
      kind: 'file';
      /** Absolute site path, e.g. '/video/plumbing-ugc-vsl-01.mp4'. */
      src: string;
      /** Poster frame. Strongly recommended — without it the player is
       * a black box and LCP suffers. */
      poster?: string;
      /** Caption track (VTT). */
      captions?: string;
      /** Muted autoplay. Off by default; audio never autoplays. */
      autoplayMuted?: boolean;
      /** CSS aspect ratio. Vertical UGC is usually '9 / 16'. */
      aspectRatio?: string;
      label: string;
    }
  | {
      kind: 'embed';
      embedUrl: string;
      aspectRatio?: string;
      label: string;
    };

export interface IconItem {
  icon: string;
  title: string;
  body: string;
}

/** A left-to-right process diagram. Used for the plumbing call flow and
 * for the attorney acquisition chain — one renderer, placed wherever a
 * funnel's argument needs it. */
export interface FlowDiagram {
  steps: { label: string; icon: string }[];
  note?: string;
}

// ---------------------------------------------------------------------
// SECTION 1 — HERO
// ---------------------------------------------------------------------

export interface FunnelHero {
  eyebrow: string;
  /** The single H1. */
  headline: string;
  /** Second line, rendered inside the same <h1>. */
  headlineLine2?: string;
  /** One or two sentences. Must make the mechanism obvious — the
   * visitor should not have to scroll to learn what this is. */
  subhead: string;
  /** Three scannable qualifiers. Never more. */
  bullets?: string[];
  /** Price anchored in the hero. Plumbing does; the attorney funnels
   * deliberately do NOT lead with price. */
  priceAnchor?: { label: string; value: string }[];
  cta: FunnelCta;
}

// ---------------------------------------------------------------------
// SECTION 2 — THE LEAK
// ---------------------------------------------------------------------

/**
 * Where opportunities are lost. Replaces what used to be three separate
 * sections (problem cards, a cost-of-the-broken-process essay, and a
 * standalone chain diagram) with one.
 */
export interface FunnelLeak {
  eyebrow: string;
  heading: string;
  /** Two sentences at most — this is setup, not the argument. */
  intro?: string;
  /** THREE, or four for the attorney funnels. Not seven. */
  items: IconItem[];
  /** The acquisition chain, when a funnel makes its leak argument
   * against a visible chain (personal injury). */
  flow?: FlowDiagram;
}

// ---------------------------------------------------------------------
// SECTION 3 — THE SYSTEM / MECHANISM
// ---------------------------------------------------------------------

/** A named layer of the engagement, rendered as one of four large
 * blocks rather than a wall of small cards. */
export interface SystemPillar {
  icon: string;
  /** One word: ACQUIRE / ANSWER / CONVERT / MEASURE. */
  title: string;
  subtitle: string;
  body: string;
}

export interface FunnelSystem {
  eyebrow: string;
  heading: string;
  /** The named mechanism, e.g. "Your AI Front Desk". */
  name?: string;
  /** One or two short paragraphs. */
  paragraphs: string[];
  /** The process diagram for this funnel's mechanism. */
  flow?: FlowDiagram;
  /** Four big blocks (attorney funnels). */
  pillars?: SystemPillar[];
  /** Up to SIX capabilities (plumbing). Not ten. */
  capabilities?: IconItem[];
  /**
   * What the system deliberately does NOT do. Kept because it is a
   * compliance requirement for the legal verticals and a credibility
   * mechanism everywhere — but rendered as a compact strip, and each
   * entry is one short sentence.
   */
  boundaries: { title: string; body: string }[];
}

// ---------------------------------------------------------------------
// SECTION 4 — WHAT WE BUILD & MANAGE (attorney funnels only)
// ---------------------------------------------------------------------

/** A flat 8-10 item checklist. Deliberately not cards: this is a scope
 * list, and a scope list scans better as a list. */
export interface FunnelDeliverables {
  eyebrow: string;
  heading: string;
  intro?: string;
  items: string[];
}

// ---------------------------------------------------------------------
// SECTION 5 — OFFER / INVESTMENT
// ---------------------------------------------------------------------

export interface FunnelOffer {
  eyebrow: string;
  heading: string;
  name: string;
  /** One or two sentences. */
  summary: string;
  /** The price, rendered large. Ranges for the attorney funnels. */
  priceLines: { label: string; value: string; note?: string }[];
  includesTitle: string;
  /** SIX to EIGHT bullets. Not a proposal appendix. */
  includes: string[];
  /** One or two short lines. Necessary qualification only. */
  footnotes: string[];
  cta: FunnelCta;
}

// ---------------------------------------------------------------------
// SECTION 6 — HOW IT WORKS
// ---------------------------------------------------------------------

export interface ProcessStep {
  title: string;
  /** One sentence. */
  body: string;
}

export interface FunnelProcess {
  eyebrow: string;
  heading: string;
  /** THREE or FOUR steps. Not six. */
  steps: ProcessStep[];
  note?: string;
}

// ---------------------------------------------------------------------
// SECTION 7 — PROOF
// ---------------------------------------------------------------------

/**
 * A clearly-labeled hypothetical — the ONLY sanctioned way to show a
 * concrete sequence on these pages. The label renders as a visible
 * badge, never as a footnote, and the disclaimer is mandatory.
 */
export interface IllustrativeWorkflow {
  /** Rendered visibly, e.g. "Illustrative example — not a client result". */
  label: string;
  heading: string;
  steps: { marker: string; text: string }[];
  disclaimer: string;
}

export interface FunnelProof {
  eyebrow: string;
  heading: string;
  intro?: string;
  /** One labeled illustrative sequence. */
  workflow?: IllustrativeWorkflow;
  /**
   * What the prospect actually gets on the call. Three or four.
   *
   * NOTE: the field name is historical. This is NOT a promise of a
   * product demonstration — a funnel must only describe here what it
   * can genuinely deliver on the next call. The plumbing funnel, for
   * example, has no generic AI voice demo to play, so its entries
   * describe the discovery work done on the strategy call instead.
   *
   * `icon` defaults to 'play'; override it when the entry is not a
   * playback of something.
   */
  demoSlots: { title: string; body: string; icon?: string }[];
  /**
   * Optional closing line for the proof section, and the insertion
   * point for a real, permissioned client result when one exists.
   *
   * It must NOT be used to announce the absence of results. Not
   * fabricating client outcomes does not require advertising that we
   * have none — a paragraph saying so reads as an apology and costs
   * more credibility than it buys. Credibility on these pages comes
   * from specificity, process, scope, and transparent pricing.
   */
  note?: string;
  /** Process steps, when a funnel merges "how it works" into proof
   * rather than running a separate section (family law). Use this OR a
   * standalone `process` — never both. */
  steps?: ProcessStep[];
}

// ---------------------------------------------------------------------
// SECTION 8 — FIT + OBJECTIONS (merged)
// ---------------------------------------------------------------------

/**
 * Qualification and objection handling in ONE section. These used to be
 * three (who it's for, an alternatives comparison, and a ten-item FAQ);
 * the comparison argument now lives inside the offer and FAQ copy where
 * it is actually read.
 */
export interface FunnelFit {
  eyebrow: string;
  heading: string;
  fitHeading: string;
  /** FOUR or FIVE. */
  fitItems: string[];
  notFitHeading: string;
  /** TWO or THREE. */
  notFitItems: string[];
  /** FIVE or SIX. Not ten. */
  faqs: { question: string; answer: string }[];
  cta: FunnelCta;
}

// ---------------------------------------------------------------------
// SECTION 9 — CLOSE
// ---------------------------------------------------------------------

export interface FunnelClose {
  eyebrow: string;
  heading: string;
  body: string;
  cta: FunnelCta;
  /** Three short lines on what actually happens on the call. */
  whatHappens?: string[];
}

// ---------------------------------------------------------------------

export interface FunnelSeo {
  title: string;
  description: string;
  /**
   * These overlap the existing organic industry pages
   * (/industries/plumbing/, /industries/law-firms/), so the default is
   * "noindex, follow": out of search, but link equity still flows.
   * Documented in docs/funnels/paid-social-funnel-system.md.
   */
  robots: string;
}

export interface FunnelConfig {
  /** Route slug without slashes, e.g. 'plumbing-ai'. */
  slug: string;
  /** Full route path with trailing slash. */
  path: string;
  vertical: FunnelVertical;
  funnelId: FunnelId;
  /** Recommended utm_content prefix for this funnel's creatives. */
  creativePrefix: string;
  /** Recommended Meta campaign name. */
  campaignName: string;
  seo: FunnelSeo;
  vsl?: FunnelVsl;

  hero: FunnelHero;
  leak: FunnelLeak;
  system: FunnelSystem;
  /** Attorney funnels only — plumbing's scope is covered by the
   * system capabilities and the offer bullets. */
  deliverables?: FunnelDeliverables;
  offer: FunnelOffer;
  /** Omit when the funnel merges its steps into `proof.steps`. */
  process?: FunnelProcess;
  proof: FunnelProof;
  fit: FunnelFit;
  close: FunnelClose;
}
