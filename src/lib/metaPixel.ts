// Meta Pixel integration point — configuration only, NO credentials.
//
// STATUS: NOT INSTALLED. No Meta Pixel existed anywhere in this repo
// before this module, and none is active now. This file exists so the
// pixel has exactly one place to be switched on when a real Pixel ID is
// supplied, instead of being pasted into a layout later.
//
// TO ACTIVATE (see docs/analytics/meta-pixel-and-capi.md):
//   1. Get the Pixel ID from Meta Events Manager (a 15-16 digit number).
//   2. Set PUBLIC_META_PIXEL_ID in the build environment — e.g. a .env
//      file locally, or the CI/build environment for the SiteGround
//      deploy. It is a PUBLIC_ variable because the base pixel is a
//      client-side script; a Pixel ID is not a secret. An ACCESS TOKEN
//      is a secret and must NEVER appear in this repo or in any
//      client-side bundle.
//   3. Rebuild. MetaPixel.astro renders nothing until the ID is present,
//      so today's build ships zero Meta code.
//
// A fake/placeholder ID is deliberately NOT provided: an invalid ID
// produces silent data loss that looks like working tracking.

/** Reads the Pixel ID from the build environment. Returns null when
 * unset, which is the current state. Never hardcode an ID here. */
export function getMetaPixelId(): string | null {
  // import.meta.env exists under Vite/Astro but not under a plain Node
  // import, so this is read defensively — that keeps the module (and
  // therefore META_CAPI_STATUS and META_EVENT_MAP) importable by the
  // Node test runner without a Vite shim.
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const raw = env?.PUBLIC_META_PIXEL_ID;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Meta Pixel IDs are numeric. Reject anything else rather than
  // shipping a broken snippet that fails silently in production.
  if (!/^\d{10,20}$/.test(trimmed)) return null;
  return trimmed;
}

export const META_PIXEL_CONFIGURED = getMetaPixelId() !== null;

/**
 * Planned mapping from this site's first-party dataLayer events to Meta
 * standard events. This is DESIGN ONLY — nothing fires until a Pixel ID
 * exists. Implement these as GTM tags triggered by the same dataLayer
 * custom events the site already pushes, so there is one event source
 * of truth rather than two parallel tracking systems.
 *
 * The distinction that matters most:
 *   booking_click_* is INTENT (a click toward Cal.com) -> InitiateCheckout
 *   booking_confirmed is the REAL conversion -> Schedule
 * Never map a booking click to Schedule; it would train Meta's delivery
 * on a signal that is not a booked call.
 */
export interface MetaEventMapping {
  /** The first-party dataLayer event that triggers it. */
  dataLayerEvent: string;
  /** Meta standard event name (or custom event when no standard fits). */
  metaEvent: string;
  standard: boolean;
  /** micro = intent signal; conversion = real business outcome. */
  tier: 'micro' | 'conversion';
  purpose: string;
}

export const META_EVENT_MAP: MetaEventMapping[] = [
  {
    dataLayerEvent: 'funnel_view',
    metaEvent: 'ViewContent',
    standard: true,
    tier: 'micro',
    purpose: 'Retargeting + exclusion audiences, segmented by vertical, funnel_id and utm_content.',
  },
  {
    dataLayerEvent: 'vsl_play',
    metaEvent: 'VSLPlay',
    standard: false,
    tier: 'micro',
    purpose: 'Separates a scroller from someone who actually started the video.',
  },
  {
    dataLayerEvent: 'vsl_progress',
    metaEvent: 'VSLProgress',
    standard: false,
    tier: 'micro',
    purpose: 'High-intent audiences at >=25% / >=50% watched. Self-hosted video only.',
  },
  {
    dataLayerEvent: 'funnel_cta_click',
    metaEvent: 'AddToCart',
    standard: true,
    tier: 'micro',
    purpose: 'Intent signal partway down the funnel. NOT a lead and NOT a booking.',
  },
  {
    dataLayerEvent: 'booking_click_plumbing_ai | booking_click_pi_ai | booking_click_divorce_ai',
    metaEvent: 'InitiateCheckout',
    standard: true,
    tier: 'micro',
    purpose: 'Clicked through to the Cal.com booking page. Intent only — the visitor may never book.',
  },
  {
    dataLayerEvent: 'ai_assessment_lead_submit',
    metaEvent: 'Lead',
    standard: true,
    tier: 'conversion',
    purpose: 'A real submitted lead. Valid optimization event.',
  },
  {
    dataLayerEvent: 'booking_confirmed',
    metaEvent: 'Schedule',
    standard: true,
    tier: 'conversion',
    purpose: 'A genuinely booked call, confirmed by a Cal.com booking UID. The primary optimization target.',
  },
];

/**
 * Meta Conversions API status: NOT IMPLEMENTED, and deliberately so.
 *
 * CAPI requires a server-side request signed with a Meta access token.
 * This site is a static Astro build (output: 'static', no adapter, no
 * Node runtime at deploy time — see astro.config.mjs), so there is
 * nowhere to hold that token. Faking CAPI from the browser would expose
 * the token to anyone viewing source.
 *
 * What a real implementation would require is documented in
 * docs/analytics/meta-pixel-and-capi.md.
 */
export const META_CAPI_STATUS = {
  implemented: false,
  reason: 'No server-side runtime exists in this static build; a Meta access token must never be exposed client-side.',
  documentation: 'docs/analytics/meta-pixel-and-capi.md',
} as const;
