// Typed configuration contract for the cold-email outbound landing
// pages under /go/.
//
// WHY THIS IS SEPARATE FROM src/lib/funnels/
//
// The paid-social funnel system (src/lib/funnels/, /plumbing-ai/,
// /personal-injury-ai/, /divorce-law-ai/) is a nine-section VSL page
// built around a priced offer: the visitor has just watched a video ad,
// and the page's job is to carry them through problem -> mechanism ->
// scope -> price -> proof -> objections -> close. Its FunnelConfig
// REQUIRES an offer with price lines, and tests/paidSocialFunnels.test.ts
// enforces that contract on every member of the FUNNELS registry.
//
// A cold-email page has a different job. The reader was not shopping;
// they were working, and an unsolicited email interrupted them. They
// have already given us the only thing that matters — a click — and the
// page has one question to answer: is a 30-minute conversation worth
// it? Publishing a price to a stranger who has not described their
// operation answers a question nobody asked, and forcing this content
// into a config that demands price lines would mean either inventing a
// number or writing a hollow offer section.
//
// So these pages get their own lean contract and their own registry.
// What they DO reuse, deliberately and completely:
//   - FunnelCta / CtaLocation / CtaType / IconItem / FlowDiagram (below)
//   - FunnelCTA.astro, the single tracked CTA button
//   - FunnelStickyCta.astro, the mobile bar
//   - FunnelStyles.astro, the .fnl-* global stylesheet
//   - BaseLayout with chrome="minimal" — same head, same GTM container,
//     same AttributionCapture, same site-wide AnalyticsEvents
//
// Nothing here is a second tracking system, a second document shell, or
// a second CTA component.
//
// CONTENT RULES (enforced by tests/outboundLanding.test.ts):
//   - no testimonials, client names, logos, or case studies
//   - no fabricated statistics, ROI, revenue, or close-rate claims
//   - no price, because none has been approved for cold outbound
//   - no "replace your staff" framing, in any vertical
//   - the strategy call is PRIMARY; the free assessment is SECONDARY

import type { FunnelCta, IconItem } from '../funnels/types';

export type { FunnelCta, IconItem };

/** Audience identifier — a GA4 custom-dimension value. Non-PII. */
export type OutboundAudience = 'law_firms' | 'roofing';

/**
 * Campaign identifier. Deliberately identical to the recommended
 * Smartlead `utm_campaign` value, so a GA4 report grouped by
 * `campaign_id` and one grouped by `utm_campaign` line up instead of
 * needing to be reconciled by hand.
 */
export type OutboundCampaignId = 'law_firms_outbound' | 'roofing_outbound';

/** A left-to-right process diagram — the visible chain a lead travels. */
export interface OutboundFlow {
  eyebrow: string;
  heading: string;
  /** Two sentences at most. This is setup, not the argument. */
  intro?: string;
  steps: { label: string; icon: string }[];
  note?: string;
}

export interface OutboundHero {
  eyebrow: string;
  /** The single H1. */
  headline: string;
  /** Second line, rendered inside the same <h1>. */
  headlineLine2?: string;
  /** One or two sentences. The mechanism must be obvious without
   * scrolling — a cold reader will not scroll to find out what this is. */
  subhead: string;
  /** Three scannable qualifiers. Never more. */
  bullets?: string[];
  /** The strategy call. Always primary on a cold-email page. */
  cta: FunnelCta;
  /**
   * The free assessment, as a quiet secondary action.
   *
   * It stays on the page because some readers genuinely prefer to look
   * before they talk, and removing the option costs those visitors
   * entirely. It stays SECONDARY because asking a cold prospect to
   * complete a questionnaire before anyone has spoken to them is the
   * friction this whole route exists to remove.
   */
  secondaryCta: FunnelCta;
}

/** The operational areas this audience actually loses money in. */
export interface OutboundCapabilities {
  eyebrow: string;
  heading: string;
  intro?: string;
  /** SIX. Not ten, not three. */
  items: IconItem[];
}

/**
 * What the system deliberately does not do.
 *
 * A compliance requirement in the legal vertical and a credibility
 * mechanism in every vertical: the fastest way to lose an owner who has
 * been pitched AI six times this quarter is to imply it replaces their
 * people or their judgment.
 */
export interface OutboundBoundaries {
  eyebrow: string;
  heading: string;
  items: { title: string; body: string }[];
}

/** What actually happens on the call, plus the objections that stop a
 * cold reader from booking one. */
export interface OutboundCall {
  eyebrow: string;
  heading: string;
  intro?: string;
  /** THREE. What the 30 minutes actually contains. */
  items: { title: string; body: string; icon?: string }[];
  /** FOUR or FIVE. Not ten. */
  faqs: { question: string; answer: string }[];
  cta: FunnelCta;
}

export interface OutboundClose {
  eyebrow: string;
  heading: string;
  body: string;
  cta: FunnelCta;
  /** Three short lines on what happens after they click. */
  whatHappens?: string[];
}

export interface OutboundSeo {
  title: string;
  description: string;
  /**
   * Always "noindex, follow".
   *
   * These pages overlap /industries/law-firms/ and
   * /industries/roofing/ by design — same audience, same problems,
   * different job. Letting them into the index would put two of our own
   * pages in front of the same query and hand Google the choice. They
   * are campaign destinations, not doorway pages: out of the index, but
   * still passing link equity through their internal links.
   *
   * They are also excluded from public/sitemap.xml, and
   * tests/seoQuality.test.ts asserts both halves of that.
   */
  robots: string;
}

export interface OutboundConfig {
  /** Route slug without slashes, e.g. 'law-firms'. */
  slug: string;
  /** Full route path with trailing slash, e.g. '/go/law-firms/'. */
  path: string;
  audience: OutboundAudience;
  campaignId: OutboundCampaignId;
  /**
   * The recommended Smartlead `utm_content` prefix for this campaign,
   * e.g. 'law_e' produces law_e1_a, law_e1_b, law_e2_a. Recorded here
   * so docs/analytics/smartlead-campaign-links.md and the code cannot
   * drift apart — tests/outboundLanding.test.ts checks the doc against
   * these values.
   */
  contentPrefix: string;
  seo: OutboundSeo;

  hero: OutboundHero;
  flow: OutboundFlow;
  capabilities: OutboundCapabilities;
  boundaries: OutboundBoundaries;
  call: OutboundCall;
  close: OutboundClose;
}
