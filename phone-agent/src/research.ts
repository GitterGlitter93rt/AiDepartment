import type { Evidence, Lead, ProspectDossier } from './types.js';

export interface ResearchAdapter {
  name: string;
  research(lead: Lead): Promise<Evidence[]>;
}

export class ResearchOrchestrator {
  constructor(private readonly adapters: ResearchAdapter[]) {}

  async buildDossier(lead: Lead): Promise<ProspectDossier> {
    const settled = await Promise.allSettled(this.adapters.map((adapter) => adapter.research(lead)));
    const rawFacts = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      return [{
        value: `Research adapter failed: ${this.adapters[index]?.name ?? 'unknown'}`,
        confidence: 'unknown' as const,
        source: this.adapters[index]?.name ?? 'unknown',
        observedAt: new Date().toISOString(),
        notes: String(result.reason ?? 'unknown error'),
      }];
    });

    const tags = stringsFor(rawFacts, ['gtm', 'ga4', 'google analytics', 'meta pixel', 'facebook pixel', 'callrail']);
    const crmSignals = stringsFor(rawFacts, ['hubspot', 'salesforce', 'servicetitan', 'jobber', 'housecall pro', 'podium', 'lawmatics', 'clio', 'gohighlevel', 'highlevel']);
    const leadCapture = stringsFor(rawFacts, ['form', 'chat', 'sms', 'text', 'book', 'schedule', 'call']);
    const afterHours = stringsFor(rawFacts, ['24/7', 'after hours', 'emergency', 'night', 'weekend']);
    const booking = stringsFor(rawFacts, ['cal.com', 'calendly', 'book', 'schedule', 'appointment']);

    return {
      leadId: lead.id,
      companyName: lead.companyName,
      website: lead.website,
      industry: lead.industry,
      summary: summarize(lead, rawFacts),
      ads: {
        google: booleanEvidence(rawFacts, ['google active ads', 'google ads', 'sponsored', 'ads transparency'], 'google-ads-research'),
        meta: booleanEvidence(rawFacts, ['meta active ads', 'meta ad', 'facebook ad', 'instagram ad', 'ad library'], 'meta-ads-research'),
      },
      tracking: evidenceList(tags, 'tracking-detector'),
      leadCapture: evidenceList(leadCapture, 'lead-capture-detector'),
      crmSignals: evidenceList(crmSignals, 'crm-detector'),
      afterHoursSignals: evidenceList(afterHours, 'website-research'),
      bookingSignals: evidenceList(booking, 'booking-detector'),
      risks: [],
      opportunities: deriveOpportunities(tags, crmSignals, leadCapture, afterHours),
      rawFacts,
    };
  }
}

function stringsFor(facts: Evidence[], needles: string[]): string[] {
  const joined = facts.map((fact) => String(fact.value)).join(' | ').toLowerCase();
  return needles.filter((needle) => joined.includes(needle));
}

function evidenceList(values: string[], source: string): Evidence<string[]> {
  return {
    value: values,
    confidence: values.length ? 'confirmed' : 'unknown',
    source,
    observedAt: new Date().toISOString(),
  };
}

function booleanEvidence(facts: Evidence[], needles: string[], source: string): Evidence<boolean> {
  const confirmed = facts.some((fact) => fact.confidence === 'confirmed' && needles.some((needle) => String(fact.value).toLowerCase().includes(needle)));
  const likely = !confirmed && facts.some((fact) => fact.confidence === 'likely' && needles.some((needle) => String(fact.value).toLowerCase().includes(needle)));
  return {
    value: confirmed || likely,
    confidence: confirmed ? 'confirmed' : likely ? 'likely' : 'unknown',
    source,
    observedAt: new Date().toISOString(),
  };
}

function summarize(lead: Lead, facts: Evidence[]): string {
  const confirmed = facts.filter((fact) => fact.confidence === 'confirmed').slice(0, 8).map((fact) => String(fact.value));
  return `${lead.companyName}: ${confirmed.length ? confirmed.join('; ') : 'No confirmed research signals yet.'}`;
}

function deriveOpportunities(tags: string[], crm: string[], capture: string[], afterHours: string[]): string[] {
  const opportunities: string[] = [];
  if (capture.length && !crm.length) opportunities.push('Lead capture exists but no confirmed CRM signal is visible; investigate response and routing workflow.');
  if (tags.length && capture.length) opportunities.push('Measured traffic plus lead capture creates an attribution/follow-up optimization angle.');
  if (afterHours.length) opportunities.push('After-hours or emergency demand creates a missed-call / immediate-response angle.');
  if (!capture.length) opportunities.push('Weak or unconfirmed website lead capture may be a conversion opportunity.');
  return opportunities;
}
