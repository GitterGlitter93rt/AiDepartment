import { listCampaigns, campaignRelationshipConflicts, analyticsFunnel, analyticsBreakdown, listVoiceCalls } from '../src/api/waveDQueries.js';
import { listIntegrations } from '../src/domain/settings.js';
import { readPilotState, listCandidates } from '../src/domain/pilot.js';
for (const [name, fn] of [
  ['listCampaigns', () => listCampaigns()],
  ['conflicts', () => campaignRelationshipConflicts()],
  ['funnel', () => analyticsFunnel({ fromDate: null, toDate: null, ownerUserId: null, verticalProfileId: null })],
  ['byVertical', () => analyticsBreakdown('vertical')],
  ['byOwner', () => analyticsBreakdown('owner')],
  ['byMarket', () => analyticsBreakdown('market')],
  ['byHypothesis', () => analyticsBreakdown('hypothesis')],
  ['voiceCalls', () => listVoiceCalls()],
  ['integrations', () => listIntegrations()],
  ['pilotState', () => readPilotState()],
  ['candidates', () => listCandidates()],
] as [string, () => Promise<unknown>][]) {
  try { const r = await fn(); console.log('OK  ', name, Array.isArray(r) ? `${r.length} rows` : 'row'); }
  catch (e) { console.log('FAIL', name, String(e).split('\n')[0]); }
}
process.exit(0);
