import * as cheerio from 'cheerio';
import type { Evidence, Lead } from './types.js';
import type { ResearchAdapter } from './research.js';

const SIGNALS: Array<[RegExp, string]> = [
  [/googletagmanager\.com|GTM-[A-Z0-9]+/i, 'Google Tag Manager'],
  [/google-analytics\.com|gtag\(|G-[A-Z0-9]+/i, 'Google Analytics / Google tag'],
  [/connect\.facebook\.net|fbq\(/i, 'Meta Pixel'],
  [/callrail/i, 'CallRail'],
  [/hubspot|hsforms|hbspt/i, 'HubSpot'],
  [/salesforce|pardot/i, 'Salesforce/Pardot'],
  [/servicetitan/i, 'ServiceTitan'],
  [/housecall\s?pro/i, 'Housecall Pro'],
  [/jobber/i, 'Jobber'],
  [/podium/i, 'Podium'],
  [/gohighlevel|highlevel/i, 'HighLevel'],
  [/lawmatics/i, 'Lawmatics'],
  [/clio/i, 'Clio'],
  [/calendly/i, 'Calendly'],
  [/cal\.com/i, 'Cal.com'],
];

export class WebsiteResearchAdapter implements ResearchAdapter {
  readonly name = 'website-research';

  async research(lead: Lead): Promise<Evidence[]> {
    if (!lead.website) return [];
    const url = normalizeUrl(lead.website);
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'YourAIDepartment-ResearchBot/0.1 (+https://youraidepartment.ai)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Website returned ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const searchable = `${html}\n${bodyText}`;
    const facts: Evidence[] = [];
    const observedAt = new Date().toISOString();

    for (const [pattern, label] of SIGNALS) {
      if (pattern.test(searchable)) facts.push(evidence(`${label} signal detected on public website`, url, observedAt));
    }

    if ($('form').length) facts.push(evidence(`Website contains ${$('form').length} form(s)`, url, observedAt));
    if ($('a[href^="tel:"]').length) facts.push(evidence('Website contains click-to-call links', url, observedAt));
    if ($('a[href^="sms:"]').length) facts.push(evidence('Website contains SMS links', url, observedAt));
    if (/24\s*\/\s*7|24 hours|after hours|emergency service/i.test(bodyText)) facts.push(evidence('Website promotes 24/7, after-hours, or emergency availability', url, observedAt));
    if (/book now|schedule|appointment|request.*(quote|estimate|consultation)/i.test(bodyText)) facts.push(evidence('Website contains booking or appointment-oriented calls to action', url, observedAt));

    const title = $('title').first().text().trim();
    if (title) facts.push(evidence(`Website title: ${title.slice(0, 180)}`, url, observedAt));
    return facts;
  }
}

function evidence(value: string, source: string, observedAt: string): Evidence {
  return { value, confidence: 'confirmed', source, observedAt };
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
