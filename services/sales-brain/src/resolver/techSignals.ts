/**
 * What a company's own site runs, read from its own markup.
 *
 * This is the single most commercially useful thing on a prospect's website that a
 * rep cannot see by looking at it. "They spend on Google Ads, run call tracking, and
 * have no booking widget" is a sales conversation. It is also a claim, so every
 * detection here needs a specific artefact -- a script host, a documented global, a
 * vendor-owned URL -- and never a word in the page copy.
 *
 * The rule that keeps this honest: a detector fires on something the vendor put
 * there, not on something a copywriter typed. "We use HubSpot" in a paragraph of
 * marketing prose is not evidence of HubSpot; `js.hs-scripts.com` is.
 */

export type TechCategory =
  | 'cms' | 'ecommerce' | 'analytics' | 'advertising' | 'crm_marketing'
  | 'field_service' | 'scheduling' | 'reviews' | 'chat' | 'call_tracking' | 'payments';

export interface TechSignature {
  id: string;
  displayName: string;
  category: TechCategory;
  /**
   * Markers that count as evidence. Hosts and vendor paths only -- anything that
   * could appear in body copy is deliberately excluded.
   */
  patterns: RegExp[];
  /** What a rep can do with knowing this. */
  salesNote?: string;
}

export const TECH_SIGNATURES: TechSignature[] = [
  // --- content management ----------------------------------------------------
  { id: 'wordpress', displayName: 'WordPress', category: 'cms',
    patterns: [/\/wp-content\//i, /\/wp-includes\//i, /name=["']generator["'][^>]*WordPress/i] },
  { id: 'wix', displayName: 'Wix', category: 'cms',
    patterns: [/static\.parastorage\.com/i, /wix-?code/i, /_wixCssImports/] },
  { id: 'squarespace', displayName: 'Squarespace', category: 'cms',
    patterns: [/static1\.squarespace\.com/i, /squarespace-headers/i] },
  { id: 'webflow', displayName: 'Webflow', category: 'cms',
    patterns: [/assets(?:-global)?\.website-files\.com/i, /data-wf-(?:page|site)=/i] },
  { id: 'duda', displayName: 'Duda', category: 'cms',
    patterns: [/irp\.cdn-website\.com/i, /static\.cdn-website\.com/i] },
  { id: 'shopify', displayName: 'Shopify', category: 'ecommerce',
    patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/] },

  // --- measurement -----------------------------------------------------------
  { id: 'google_tag_manager', displayName: 'Google Tag Manager', category: 'analytics',
    patterns: [/googletagmanager\.com\/gtm\.js/i, /googletagmanager\.com\/ns\.html/i] },
  { id: 'ga4', displayName: 'Google Analytics 4', category: 'analytics',
    patterns: [/googletagmanager\.com\/gtag\/js\?id=G-/i, /gtag\('config',\s*['"]G-/i] },
  { id: 'meta_pixel', displayName: 'Meta Pixel', category: 'advertising',
    patterns: [/connect\.facebook\.net\/[^'"]*\/fbevents\.js/i, /fbq\('init'/] },
  { id: 'google_ads_tag', displayName: 'Google Ads conversion tag', category: 'advertising',
    patterns: [/googleadservices\.com\/pagead\/conversion/i, /gtag\('config',\s*['"]AW-/i,
      /googletagmanager\.com\/gtag\/js\?id=AW-/i],
    salesNote: 'Paying for clicks. What happens to those clicks is the conversation.' },
  { id: 'microsoft_uet', displayName: 'Microsoft Advertising UET', category: 'advertising',
    patterns: [/bat\.bing\.com\/bat\.js/i] },

  // --- CRM and marketing automation -------------------------------------------
  { id: 'hubspot', displayName: 'HubSpot', category: 'crm_marketing',
    patterns: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i, /track\.hubspot\.com/i] },
  { id: 'gohighlevel', displayName: 'HighLevel', category: 'crm_marketing',
    patterns: [/msgsndr\.com/i, /leadconnectorhq\.com/i, /gohighlevel\.com/i] },
  { id: 'mailchimp', displayName: 'Mailchimp', category: 'crm_marketing',
    patterns: [/chimpstatic\.com/i, /list-manage\.com\/subscribe/i] },

  // --- field service / trades software -----------------------------------------
  { id: 'servicetitan', displayName: 'ServiceTitan', category: 'field_service',
    patterns: [/servicetitan\.com/i, /st-scheduler/i],
    salesNote: 'Serious operational software. They invest in systems.' },
  { id: 'housecall_pro', displayName: 'Housecall Pro', category: 'field_service',
    patterns: [/housecallpro\.com/i, /hcp-booking/i] },
  { id: 'jobber', displayName: 'Jobber', category: 'field_service',
    patterns: [/getjobber\.com/i, /clienthub\.getjobber\.com/i] },

  // --- scheduling ---------------------------------------------------------------
  { id: 'calendly', displayName: 'Calendly', category: 'scheduling',
    patterns: [/assets\.calendly\.com/i, /calendly\.com\/[a-z0-9-]+/i] },
  { id: 'cal_com', displayName: 'Cal.com', category: 'scheduling',
    patterns: [/cal\.com\/embed/i, /app\.cal\.com/i] },
  { id: 'acuity', displayName: 'Acuity Scheduling', category: 'scheduling',
    patterns: [/acuityscheduling\.com/i, /squarespacescheduling\.com/i] },

  // --- reviews ------------------------------------------------------------------
  { id: 'podium', displayName: 'Podium', category: 'reviews',
    patterns: [/podium\.com\/widget/i, /connect\.podium\.com/i] },
  { id: 'birdeye', displayName: 'Birdeye', category: 'reviews',
    patterns: [/birdeye\.com/i, /bdimg\.com/i] },

  // --- chat ---------------------------------------------------------------------
  { id: 'intercom', displayName: 'Intercom', category: 'chat',
    patterns: [/widget\.intercom\.io/i, /js\.intercomcdn\.com/i] },
  { id: 'tawk', displayName: 'Tawk.to', category: 'chat',
    patterns: [/embed\.tawk\.to/i] },
  { id: 'drift', displayName: 'Drift', category: 'chat',
    patterns: [/js\.driftt\.com/i] },
  { id: 'tidio', displayName: 'Tidio', category: 'chat',
    patterns: [/code\.tidio\.co/i] },
  { id: 'livechat', displayName: 'LiveChat', category: 'chat',
    patterns: [/cdn\.livechatinc\.com/i] },

  // --- call tracking --------------------------------------------------------------
  { id: 'callrail', displayName: 'CallRail', category: 'call_tracking',
    patterns: [/cdn\.callrail\.com/i, /js\.callrail\.com/i],
    salesNote: 'Measuring inbound calls, which means calls are the lead they care about.' },
  { id: 'calltrackingmetrics', displayName: 'CallTrackingMetrics', category: 'call_tracking',
    patterns: [/tctm\.co/i, /calltrackingmetrics\.com/i] },
  { id: 'invoca', displayName: 'Invoca', category: 'call_tracking',
    patterns: [/solutions\.invocacdn\.com/i] },

  // --- payments --------------------------------------------------------------------
  { id: 'stripe', displayName: 'Stripe', category: 'payments',
    patterns: [/js\.stripe\.com/i] },
  { id: 'square', displayName: 'Square', category: 'payments',
    patterns: [/squareupsandbox\.com/i, /web\.squarecdn\.com/i] },
];

export interface TechObservation {
  id: string;
  displayName: string;
  category: TechCategory;
  /** The exact marker found, so the detection can be checked rather than believed. */
  evidence: string;
  sourceReference: string;
  salesNote?: string;
}

/**
 * Detects technologies in one page's raw HTML.
 *
 * Script and link URLs are considered rather than the whole document, so a blog post
 * discussing ServiceTitan cannot make a company a ServiceTitan customer. The one
 * exception is documented inline globals (`fbq('init'`, `gtag('config'`), which only
 * appear in a vendor's own snippet.
 */
export function detectTechnologies(html: string, sourceReference: string): TechObservation[] {
  // The parts of the document a vendor writes into: script/link/iframe URLs and
  // inline script bodies.
  const surfaces: string[] = [];
  const urlPattern = /<(?:script|link|iframe|img)\b[^>]*?(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(html)) !== null) surfaces.push(match[1]!);

  const inlinePattern = /<script\b[^>]*>([\s\S]{0,20000}?)<\/script>/gi;
  while ((match = inlinePattern.exec(html)) !== null) surfaces.push(match[1]!);

  // A generator meta tag is the CMS naming itself.
  const generatorPattern = /<meta\b[^>]*name=["']generator["'][^>]*>/gi;
  while ((match = generatorPattern.exec(html)) !== null) surfaces.push(match[0]!);

  const haystack = surfaces.join('\n');
  const found: TechObservation[] = [];
  const seen = new Set<string>();

  for (const signature of TECH_SIGNATURES) {
    for (const pattern of signature.patterns) {
      const hit = pattern.exec(haystack);
      if (!hit) continue;
      if (seen.has(signature.id)) break;
      seen.add(signature.id);
      found.push({
        id: signature.id,
        displayName: signature.displayName,
        category: signature.category,
        // Trimmed: the marker is the point, not the surrounding minified bundle.
        evidence: hit[0].slice(0, 120),
        sourceReference,
        ...(signature.salesNote ? { salesNote: signature.salesNote } : {}),
      });
      break;
    }
  }
  return found;
}
