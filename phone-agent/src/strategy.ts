import type { ProspectDossier, SalesStrategy } from './types';

export interface ManualRetriever {
  retrieve(query: string, limit?: number): Promise<Array<{ id: string; text: string }>>;
}

export async function buildSalesStrategy(
  dossier: ProspectDossier,
  retriever: ManualRetriever,
): Promise<SalesStrategy> {
  const query = [
    dossier.industry ?? 'business',
    ...dossier.opportunities,
    'cold call opener discovery objections CRM ads missed calls follow-up',
  ].join(' | ');

  const manual = await retriever.retrieve(query, 6);
  const score = scoreDossier(dossier);
  const angle = chooseAngle(dossier);

  return {
    leadId: dossier.leadId,
    icpScore: score,
    primaryAngle: angle,
    opener: createOpener(dossier, angle),
    discoveryQuestions: buildDiscoveryQuestions(dossier),
    objectionPointers: manual.map((section) => section.text).slice(0, 4),
    proofBoundaries: [
      'Never claim an integration, ad campaign, CRM, lead volume, response time, spend level, or revenue impact unless it is confirmed in the dossier or stated by the prospect.',
      'Describe unverified technology findings as signals, not facts.',
      'Do not invent ROI or customer results.',
    ],
    callObjective: score >= 65 ? 'book_demo' : 'qualify',
    recommendedMode: score >= 75 ? 'autonomous_outbound' : score >= 45 ? 'human_assist' : 'research_only',
    retrievedManualSections: manual.map((section) => section.id),
  };
}

function scoreDossier(dossier: ProspectDossier): number {
  let score = 20;
  if (dossier.ads.google.value) score += 20;
  if (dossier.ads.meta.value) score += 15;
  if (dossier.tracking.value.length) score += 10;
  if (dossier.leadCapture.value.length) score += 10;
  if (dossier.afterHoursSignals.value.length) score += 15;
  if (dossier.crmSignals.value.length) score += 5;
  if (dossier.opportunities.length >= 2) score += 10;
  return Math.max(0, Math.min(score, 100));
}

function chooseAngle(dossier: ProspectDossier): string {
  if ((dossier.ads.google.value || dossier.ads.meta.value) && dossier.leadCapture.value.length) {
    return 'Protect paid lead spend by improving speed-to-lead, missed-call recovery, and follow-up.';
  }
  if (dossier.afterHoursSignals.value.length) {
    return 'Capture after-hours and emergency demand without requiring staff to answer every call.';
  }
  if (dossier.crmSignals.value.length) {
    return 'Extend the existing CRM with AI follow-up, reactivation, routing, and appointment-setting rather than replacing it.';
  }
  return 'Audit the current lead intake and follow-up workflow for preventable leakage.';
}

function createOpener(dossier: ProspectDossier, angle: string): string {
  const observed: string[] = [];
  if (dossier.ads.google.value) observed.push('your Google advertising');
  if (dossier.ads.meta.value) observed.push('your Meta advertising');
  if (dossier.afterHoursSignals.value.length) observed.push('the emergency/after-hours side of the business');
  const observation = observed[0] ?? 'your website and lead flow';
  return `Hey — I’m calling from Your AI Department. I was looking at ${observation}. Quick question: what happens today when a new lead calls or submits something and nobody can respond immediately?`;
}

function buildDiscoveryQuestions(dossier: ProspectDossier): string[] {
  const questions = [
    'What CRM or system are you using today to keep track of new leads and customers?',
    'When someone calls and nobody answers, does anything automatically text or call them back?',
    'When a web lead comes in after hours, how quickly does somebody normally respond?',
    'Do you know which campaigns or lead sources actually turn into booked jobs or clients?',
  ];
  if (dossier.crmSignals.value.length) {
    questions.unshift('I saw some signs you may already have a CRM or marketing platform in place — is that tied directly into your phone and web lead follow-up?');
  }
  return questions;
}
