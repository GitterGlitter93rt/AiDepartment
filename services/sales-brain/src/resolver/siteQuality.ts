/**
 * Whether the company's own digital presence suggests an opportunity.
 *
 * Deliberately not an SEO crawler. The question is narrow and commercial: would a rep
 * open a conversation differently knowing this? A site with no mobile viewport in
 * 2026 is a site somebody stopped maintaining; a page with no structured data is
 * invisible to the local results their competitors show up in; a copyright line three
 * years stale says nobody has touched it.
 *
 * Every check is deterministic and reads one page's markup. Nothing here scores a
 * site out of a hundred, because a number invites an argument and a fact invites a
 * question.
 */

export interface SiteQualitySignal {
  claimKey: string;
  claimText: string;
  /** 'yes' when present, 'no' when the page demonstrably lacks it. */
  normalizedValue: 'yes' | 'no';
  sourceReference: string;
  ttlDays: number;
}

/** True when the document declares a mobile viewport. */
export function hasMobileViewport(html: string): boolean {
  return /<meta\b[^>]*name=["']viewport["'][^>]*content=["'][^"']*width\s*=\s*device-width/i
    .test(html);
}

export function hasMetaDescription(html: string): boolean {
  const match = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html);
  return Boolean(match?.[1] && match[1].trim().length > 20);
}

export function hasTitle(html: string): boolean {
  const match = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html);
  return Boolean(match?.[1] && match[1].trim().length > 2);
}

/**
 * LocalBusiness structured data, which is what puts a company in local results.
 *
 * Matched on the schema type rather than on the presence of any JSON-LD: a site with
 * only BreadcrumbList markup has structured data and none of the kind that matters
 * for a local trade business.
 */
export function hasLocalBusinessSchema(html: string): boolean {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const localTypes = /"@type"\s*:\s*"?(?:\[[^\]]*")?(LocalBusiness|HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|GeneralContractor|AutoRepair|LegalService|Dentist|ProfessionalService)\b/i;
  return blocks.some((block) => localTypes.test(block));
}

/**
 * The newest four-digit year in a copyright line.
 *
 * Read cautiously and reported cautiously: plenty of perfectly maintained sites have
 * a stale footer, so this is worth a question and never a conclusion.
 */
export function copyrightYear(text: string): number | null {
  const years: number[] = [];
  const pattern = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) years.push(Number(match[1]));
  return years.length > 0 ? Math.max(...years) : null;
}

export function extractSiteQuality(input: {
  html: string;
  text: string;
  url: string;
  /** True when this is the site's front page, where these checks belong. */
  isHomepage: boolean;
}): SiteQualitySignal[] {
  if (!input.isHomepage) return [];
  const signals: SiteQualitySignal[] = [];
  const add = (
    claimKey: string, present: boolean, yes: string, no: string, ttlDays: number,
  ): void => {
    signals.push({
      claimKey, normalizedValue: present ? 'yes' : 'no',
      claimText: present ? yes : no, sourceReference: input.url, ttlDays,
    });
  };

  add('site_https', input.url.startsWith('https://'),
    'The site is served over HTTPS.',
    'The site is not served over HTTPS, which browsers now mark as not secure.', 90);
  add('site_mobile_viewport', hasMobileViewport(input.html),
    'The site declares a mobile viewport.',
    'The site declares no mobile viewport, so it is unlikely to render well on a phone '
    + '— where most local trade searches happen.', 90);
  add('site_meta_description', hasMetaDescription(input.html),
    'The home page has a meta description.',
    'The home page has no meta description, so search engines write their own snippet.', 90);
  add('site_title', hasTitle(input.html),
    'The home page has a title.', 'The home page has no usable title tag.', 90);
  add('site_local_business_schema', hasLocalBusinessSchema(input.html),
    'The site publishes LocalBusiness structured data.',
    'The site publishes no LocalBusiness structured data, which is what search engines '
    + 'read to place a company in local results.', 90);

  const year = copyrightYear(input.text);
  if (year !== null) {
    const thisYear = new Date().getFullYear();
    const stale = year < thisYear - 1;
    signals.push({
      claimKey: 'site_copyright_year',
      normalizedValue: stale ? 'no' : 'yes',
      claimText: stale
        ? `The footer copyright still reads ${year}. Worth asking who looks after the `
          + 'site — plenty of maintained sites have a stale footer, so this is a '
          + 'question rather than a conclusion.'
        : `The footer copyright reads ${year}.`,
      sourceReference: input.url,
      ttlDays: 180,
    });
  }
  return signals;
}
