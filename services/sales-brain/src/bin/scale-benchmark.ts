import '../synthetic/scaleSetup.js';
import { pool, query } from '../db/pool.js';
import { runBenchmark, table, explain, type BenchmarkCase } from '../synthetic/benchmark.js';
import { searchProspects, coverageFor } from '../domain/search.js';
import { getAccountDetail } from '../domain/accountDetail.js';
import {
  navCountsFor, overviewKpis, dueFollowUpsFor, followUpsFor, marketCards, teamRows,
  recentlyClaimedFor, topMarketsFor,
} from '../api/queries.js';
import {
  listReplies, replyThread, listMeetings, getMeeting, getMarket, navCountsFull,
} from '../api/readModels.js';
import {
  listCampaigns, analyticsFunnel, analyticsBreakdown, analyticsFilterOptions,
  listVoiceCalls, voiceCallDetail, globalSearch, listAuditEvents, emptyFilters,
} from '../api/waveDQueries.js';
import { listOpportunities, getOpportunity } from '../domain/opportunities.js';
import { listCandidates } from '../domain/pilot.js';
import { compareHookVariants, promotionReadiness } from '../analytics/hookExperiments.js';

/**
 * Benchmarks the real read models against the synthetic scale dataset.
 *
 *   npx tsx src/bin/scale-benchmark.ts [--runs 5] [--explain] [--json]
 */

function argument(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const runs = Number(argument('runs', '5'));
const wantExplain = process.argv.includes('--explain');
const asJson = process.argv.includes('--json');

// --- the actors the pages would be rendered for -------------------------------
const { rows: users } = await query<{ user_id: string; role: string; display_name: string }>(
  `select user_id, role, display_name from users order by role, display_name`);
const rep = users.find((u) => u.role === 'SALES_REP')!;
const manager = users.find((u) => u.role === 'SALES_MANAGER')!;
const repViewer = { userId: rep.user_id, role: 'SALES_REP' as const };
const managerViewer = { userId: manager.user_id, role: 'SALES_MANAGER' as const };

// A claimed account owned by the benchmark rep, and one of everything else.
const { rows: samples } = await query<{
  owned_account: string; any_account: string; opportunity: string | null;
  booking: string | null; call: string | null; market: string | null;
  enrollment: string | null;
}>(
  `select
     (select account_id from accounts where current_owner_user_id = $1 limit 1) as owned_account,
     (select account_id from accounts limit 1) as any_account,
     (select opportunity_id from opportunities where owner_user_id = $1 limit 1) as opportunity,
     (select booking_id from meeting_bookings limit 1) as booking,
     (select voice_call_id from voice_calls limit 1) as call,
     (select market_id from saved_markets limit 1) as market,
     (select enrollment_id from email_enrollments limit 1) as enrollment`,
  [rep.user_id]);
const sample = samples[0]!;

/**
 * Budgets.
 *
 * A rep's main list has to feel instant, so 150 ms is the target and 400 ms the
 * outer limit. A manager report is read deliberately, so it gets 400/1200. A detail
 * page assembles many reads in parallel, so each read is held to the list budget.
 */
const REP_LIST = { good: 150, acceptable: 400 };
const REP_DETAIL = { good: 150, acceptable: 400 };
const MANAGER_REPORT = { good: 400, acceptable: 1200 };

const cases: BenchmarkCase[] = [
  // ---------------------------------------------------------------- Overview --
  { id: 'overview.kpis', page: 'Overview', budget: REP_LIST,
    run: async () => { await overviewKpis(rep.user_id); return { rows: 1 }; } },
  { id: 'overview.navCounts', page: 'Overview', budget: REP_LIST,
    run: async () => { await navCountsFor(rep.user_id); return { rows: 1 }; } },
  { id: 'overview.navCountsFull', page: 'Overview', budget: MANAGER_REPORT,
    run: async () => { await navCountsFull(manager.user_id, 'SALES_MANAGER'); return { rows: 1 }; } },
  { id: 'overview.dueFollowUps', page: 'Overview', budget: REP_LIST,
    run: async () => ({ rows: (await dueFollowUpsFor(rep.user_id)).length }) },
  { id: 'overview.recentlyClaimed', page: 'Overview', budget: REP_LIST,
    run: async () => ({ rows: (await recentlyClaimedFor(rep.user_id)).length }) },
  { id: 'overview.topMarkets', page: 'Overview', budget: REP_LIST,
    run: async () => ({ rows: (await topMarketsFor()).length }) },

  // ----------------------------------------------------------- Find Prospects --
  { id: 'find.unfiltered', page: 'Find Prospects', budget: REP_LIST,
    run: async () => {
      const result = await searchProspects({ page: 1, pageSize: 50 }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.vertical+zip+unclaimed', page: 'Find Prospects', budget: REP_LIST,
    note: 'the hero filter combination',
    run: async () => {
      const result = await searchProspects({
        verticalProfileId: 'hvac', geography: { type: 'zip_zcta', value: '32256' },
        ownership: 'UNCLAIMED', page: 1, pageSize: 50,
      }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.advertisersFirst+tierB', page: 'Find Prospects', budget: REP_LIST,
    run: async () => {
      const result = await searchProspects({
        verticalProfileId: 'hvac', geography: { type: 'zip_zcta', value: '32256' },
        advertising: ['google_paid'], minimumTier: 'B', ownership: 'UNCLAIMED',
        page: 1, pageSize: 50,
      }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.deepPage', page: 'Find Prospects', budget: REP_LIST,
    note: 'offset pagination at page 40',
    run: async () => {
      const result = await searchProspects({ page: 40, pageSize: 50 }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.ownerFiltered', page: 'My Prospects', budget: REP_LIST,
    run: async () => {
      const result = await searchProspects({ ownership: 'MINE', page: 1, pageSize: 50 }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.textQuery', page: 'Find Prospects', budget: REP_LIST,
    run: async () => {
      const result = await searchProspects({ text: 'coastal', page: 1, pageSize: 50 }, repViewer);
      return { rows: result.results.length };
    } },
  { id: 'find.coverage', page: 'Find Prospects', budget: REP_LIST,
    run: async () => {
      await coverageFor({ verticalProfileId: 'hvac', geography: { type: 'zip_zcta', value: '32256' } });
      return { rows: 1 };
    } },

  // ------------------------------------------------------------ Account Detail --
  { id: 'account.detail', page: 'Account Detail', budget: REP_DETAIL,
    run: async () => {
      const detail = await getAccountDetail(sample.owned_account, repViewer);
      return { rows: detail ? 1 : 0 };
    } },

  // ----------------------------------------------------------------- Follow-Ups --
  { id: 'followups.mine', page: 'Follow-Ups', budget: REP_LIST,
    run: async () => ({ rows: (await followUpsFor(rep.user_id)).upcoming.length }) },
  { id: 'followups.overdue', page: 'Follow-Ups', budget: REP_LIST,
    run: async () => ({ rows: (await followUpsFor(rep.user_id)).overdue.length }) },
  { id: 'followups.allTeam', page: 'Follow-Ups', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await followUpsFor(manager.user_id)).upcoming.length }) },

  // -------------------------------------------------------------------- Replies --
  { id: 'replies.inbox', page: 'Replies', budget: REP_LIST,
    run: async () => ({ rows: (await listReplies(repViewer, 'needs_response')).length }) },
  { id: 'replies.all', page: 'Replies', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listReplies(managerViewer, 'all')).length }) },

  // -------------------------------------------------------------- Opportunities --
  { id: 'opportunities.list', page: 'Opportunities', budget: REP_LIST,
    run: async () => ({ rows: (await listOpportunities(repViewer, {})).length }) },
  { id: 'opportunities.allOpen', page: 'Opportunities', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listOpportunities(managerViewer, {})).length }) },

  // ------------------------------------------------------------------- Meetings --
  { id: 'meetings.upcoming', page: 'Meetings', budget: REP_LIST,
    run: async () => ({ rows: (await listMeetings(repViewer, 'upcoming')).length }) },
  { id: 'meetings.needsAttention', page: 'Meetings', budget: REP_LIST,
    run: async () => ({ rows: (await listMeetings(managerViewer, 'needs_attention')).length }) },

  // -------------------------------------------------------------------- Markets --
  { id: 'markets.cards', page: 'Markets', budget: REP_LIST,
    run: async () => ({ rows: (await marketCards()).length }) },

  // ------------------------------------------------------------------- AI Pilot --
  { id: 'pilot.candidates', page: 'AI Pilot', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listCandidates()).length }) },

  // ---------------------------------------------------------------- Call Review --
  { id: 'calls.list', page: 'Call Review', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listVoiceCalls(50)).length }) },

  // ------------------------------------------------------------------ Analytics --
  { id: 'analytics.funnel', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => { await analyticsFunnel(emptyFilters()); return { rows: 1 }; } },
  { id: 'analytics.byVertical', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await analyticsBreakdown('vertical')).length }) },
  { id: 'analytics.byOwner', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await analyticsBreakdown('owner')).length }) },
  { id: 'analytics.byMarket', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await analyticsBreakdown('market')).length }) },
  { id: 'analytics.byHypothesis', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await analyticsBreakdown('hypothesis')).length }) },
  { id: 'analytics.filterOptions', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => { await analyticsFilterOptions(); return { rows: 1 }; } },
  { id: 'analytics.hookExperiment', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await compareHookVariants({})).variants.length }) },
  { id: 'analytics.promotionReadiness', page: 'Analytics', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await promotionReadiness({})).reasons.length }) },

  // -------------------------------------------------------------- Global Search --
  { id: 'search.companyPartial', page: 'Global Search', budget: REP_LIST,
    run: async () => ({ rows: (await globalSearch('coastal')).length }) },
  { id: 'search.phone', page: 'Global Search', budget: REP_LIST,
    run: async () => ({ rows: (await globalSearch('9045550')).length }) },
  { id: 'search.person', page: 'Global Search', budget: REP_LIST,
    run: async () => ({ rows: (await globalSearch('Alvarez')).length }) },
  { id: 'search.zip', page: 'Global Search', budget: REP_LIST,
    run: async () => ({ rows: (await globalSearch('32256')).length }) },

  // -------------------------------------------------------------------- Team ----
  { id: 'team.rows', page: 'Team', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await teamRows()).length }) },

  // -------------------------------------------------------------------- Audit ---
  { id: 'audit.recent', page: 'Audit', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listAuditEvents(
      { actorUserId: null, action: null, subjectType: null, subjectId: null,
        fromDate: null, toDate: null })).length }) },

  // ---------------------------------------------------------------- Campaigns ---
  { id: 'campaigns.list', page: 'Campaigns', budget: MANAGER_REPORT,
    run: async () => ({ rows: (await listCampaigns()).length }) },
];

// Detail cases that need an id present in the dataset.
if (sample.opportunity) {
  cases.push({ id: 'opportunity.detail', page: 'Opportunities', budget: REP_DETAIL,
    run: async () => {
      const found = await getOpportunity(sample.opportunity!, repViewer);
      return { rows: found ? 1 : 0 };
    } });
}
if (sample.booking) {
  cases.push({ id: 'meeting.detail', page: 'Meetings', budget: REP_DETAIL,
    run: async () => ({ rows: (await getMeeting(sample.booking!, managerViewer)) ? 1 : 0 }) });
}
if (sample.call) {
  cases.push({ id: 'call.detail', page: 'Call Review', budget: REP_DETAIL,
    run: async () => ({ rows: (await voiceCallDetail(sample.call!)) ? 1 : 0 }) });
}
if (sample.market) {
  cases.push({ id: 'market.detail', page: 'Markets', budget: REP_DETAIL,
    run: async () => ({ rows: (await getMarket(sample.market!)) ? 1 : 0 }) });
}
if (sample.enrollment) {
  cases.push({ id: 'reply.thread', page: 'Replies', budget: REP_DETAIL,
    run: async () => ({ rows: (await replyThread(sample.enrollment!)) ? 1 : 0 }) });
}

const report = await runBenchmark(cases, runs);

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(table(report));
}

if (wantExplain) {
  console.log('\n=== EXPLAIN ANALYZE for the slowest cases ===');
  const plans: [string, string, unknown[]][] = [
    ['find.count.zip', 'select count(*)::bigint as total from prospect_inventory where not is_suppressed and primary_vertical_profile_id = $1 and postal_code = $2', ['hvac', '32256']],
    ['find.rows.zip', 'select * from prospect_inventory where not is_suppressed and primary_vertical_profile_id = $1 and postal_code = $2 order by manual_score desc nulls last, account_id limit 50', ['hvac', '32256']],
    ['find.count.all', 'select count(*)::bigint as total from prospect_inventory', []],
  ];
  for (const [label, sql, values] of plans) {
    console.log(`\n--- ${label}\n${await explain(sql, values)}`);
  }
}

await pool.end();
