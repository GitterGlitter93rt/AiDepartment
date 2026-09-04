import { query } from '../db/pool.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isManager } from '../domain/auth.js';
import { getAccountDetail } from '../domain/accountDetail.js';
import { recordDisposition, completeFollowUp, type Disposition } from '../domain/activities.js';
import { releaseAccount, reassignAccount } from '../domain/ownership.js';
import { listVerticals } from '../domain/verticals.js';
import {
  coverageFor, recordSearchContext, searchProspects,
  type AdvertisingFilter, type ContactFilter, type MyProspectsFilter, type SearchRequest, type SortKey,
} from '../domain/search.js';
import { enqueueContactResearch } from '../workers/enqueue.js';
import { bookStrategyCall, getAvailability } from '../booking/service.js';
import { renderOverviewPage } from '../web/pages/overview.js';
import { renderFindPage } from '../web/pages/find.js';
import { renderAccountPage, renderAccountPanel } from '../web/pages/account.js';
import {
  renderFollowUpsPage, renderMarketsPage, renderMyProspectsPage, renderRepBookPage, renderTeamPage,
} from '../web/pages/lists.js';
import {
  activeReps, dueFollowUpsFor, findUser, followUpsFor, marketCards, marketOptions, navCountsFor,
  overviewKpis, recentlyClaimedFor, teamRows, topMarketsFor, STALE_CLAIM_THRESHOLD_DAYS,
} from './queries.js';
import {
  getMarket, getMeeting, listMeetings, listReplies, marketResearchActivity, navCountsFull,
} from './readModels.js';
import {
  createOpportunity, getOpportunity, listOpportunities, transitionOpportunity, type Stage,
} from '../domain/opportunities.js';
import { buildPrepBrief } from '../booking/brief.js';
import {
  renderMarketDetailPage, renderMeetingDetailPage, renderMeetingsPage,
  renderOpportunitiesPage, renderOpportunityDetailPage, renderRepliesPage,
} from '../web/pages/waveB.js';
import {
  renderImportsPage, renderImportWizardPage, renderMiningPage, renderResearchHealthPage,
} from '../web/pages/waveC.js';
import { miningJobs, miningKpis, researchExceptions, researchHealthMetrics } from './waveCQueries.js';
import {
  buildPreview, confirmSession, createSession, getSession, listImportHistory, setColumnMap,
} from '../import/session.js';
import {
  renderAnalyticsPage, renderAuditPage, renderCallListPage, renderCallReviewPage,
  renderCampaignDetailPage, renderCampaignsPage, renderPilotPage, renderSearchPage,
  renderSettingsPage,
} from '../web/pages/waveD.js';
import {
  analyticsBreakdown, analyticsFilterOptions, analyticsFunnel, auditFilterOptions,
  campaignDetail, campaignRelationshipConflicts, globalSearch, listAuditEvents, listCampaigns,
  listVoiceCalls, parseAnalyticsFilters, parseAuditFilters, voiceCallDetail,
} from './waveDQueries.js';
import {
  addCandidate, callPackPreview, listCandidates, readPilotState, removeCandidate,
  runPreflight, setPilotSwitch, stopNewOutboundCalls,
} from '../domain/pilot.js';
import { listIntegrations, setIntegrationEnabled, testIntegration } from '../domain/settings.js';
import { compareHookVariants, promotionReadiness } from '../analytics/hookExperiments.js';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A record id that is not a uuid cannot name a record.
 *
 * Without this the database rejects the cast and the request becomes a 500, so a
 * stale bookmark or a crawler produces server errors and a genuine fault becomes
 * hard to see among them. Answering 404 is both correct and quieter.
 */
function validId(id: string, reply: FastifyReply): boolean {
  if (UUID_SHAPE.test(id)) return true;
  reply.code(404).type('text/html').send('<p>Not found.</p>');
  return false;
}

/** Server-rendered portal routes. Every one of them re-checks the session. */

function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    reply.redirect('/login');
    return null;
  }
  return request.user;
}

const CONTACT_FILTERS = new Set<ContactFilter>([
  'phone_available', 'verified_business_phone', 'email_available', 'phone_and_email',
  'decision_maker_known', 'direct_phone', 'contact_research_needed',
]);
const AD_FILTERS = new Set<AdvertisingFilter>(['google_paid', 'google_lsa', 'meta_paid', 'multichannel']);

/** Parses the query string into a SearchRequest. Unknown values are dropped, not passed through. */
export function parseSearchQuery(params: URLSearchParams): SearchRequest {
  const where = (params.get('where') ?? '').trim();
  let geography: SearchRequest['geography'] = null;
  if (where) {
    if (/^\d{5}$/.test(where)) geography = { type: 'zip_zcta', value: where };
    else if (/^[A-Za-z]{2}$/.test(where)) geography = { type: 'state', value: where.toUpperCase() };
    else geography = { type: 'city', value: where };
  }

  const tier = params.get('tier');
  const ownership = params.get('ownership');

  return {
    verticalProfileId: params.get('vertical') || null,
    geography,
    marketId: params.get('market') || null,
    minimumTier: tier === 'A' || tier === 'B' || tier === 'C' || tier === 'D' ? tier : null,
    ownership:
      ownership === 'MINE' || ownership === 'CLAIMED_BY_OTHER' || ownership === 'ANY_VISIBLE'
        ? ownership : 'UNCLAIMED',
    contactability: params.getAll('contact').filter((v): v is ContactFilter => CONTACT_FILTERS.has(v as ContactFilter)),
    advertising: params.getAll('ad').filter((v): v is AdvertisingFilter => AD_FILTERS.has(v as AdvertisingFilter)),
    page: Math.max(1, Number(params.get('page') ?? 1) || 1),
    pageSize: 50,
    sort: (params.get('sort') as SortKey) || 'recommended_priority',
  };
}

export async function registerPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const [counts, kpis, recentlyClaimed, dueFollowUps, markets] = await Promise.all([
      navCountsFull(user.userId, user.role),
      overviewKpis(user.userId),
      recentlyClaimedFor(user.userId),
      dueFollowUpsFor(user.userId),
      topMarketsFor(),
    ]);

    return reply.type('text/html').send(renderOverviewPage({
      user, counts,
      kpis: {
        activeProspects: kpis.active_prospects,
        newThisWeek: kpis.new_this_week,
        followUpsDue: kpis.follow_ups_due,
        followUpsOverdue: kpis.follow_ups_overdue,
        meetingsBooked: kpis.meetings_booked,
        notContacted: kpis.not_contacted,
      },
      recentlyClaimed, dueFollowUps, markets,
    }));
  });

  app.get('/find', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const searchRequest = parseSearchQuery(params);
    const hasQuery = Boolean(searchRequest.geography?.value || searchRequest.marketId || searchRequest.verticalProfileId);

    const [counts, verticals, markets] = await Promise.all([
      navCountsFull(user.userId, user.role), listVerticals(), marketOptions(),
    ]);

    const response = hasQuery ? await searchProspects(searchRequest, user) : null;
    if (response) await recordSearchContext(user.userId, searchRequest, response.total);

    return reply.type('text/html').send(renderFindPage({
      user, counts, verticals, request: searchRequest, response, queryString: params, markets,
    }));
  });

  app.get('/markets', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const [counts, markets] = await Promise.all([navCountsFull(user.userId, user.role), marketCards()]);
    return reply.type('text/html').send(renderMarketsPage({
      user, counts, markets, canManage: isManager(user.role) || user.role === 'RESEARCH_OPS',
    }));
  });

  // The page manifest routes this at /prospects; /my-prospects is kept as a
  // permanent redirect so existing links and bookmarks keep working.
  app.get('/my-prospects', async (request, reply) => reply.redirect('/prospects', 301));

  app.get('/prospects', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const filter = (params.get('filter') ?? '') as MyProspectsFilter | '';
    const sort = (params.get('sort') as SortKey) || 'recommended_priority';

    const [counts, response] = await Promise.all([
      navCountsFull(user.userId, user.role),
      searchProspects(
        { myProspectsFilter: (filter || null) as MyProspectsFilter | null, ownership: 'MINE', sort, pageSize: 100 },
        user,
      ),
    ]);
    return reply.type('text/html').send(renderMyProspectsPage({
      user, counts, response, activeFilter: filter, sort,
    }));
  });

  app.get('/follow-ups', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const [counts, followUps] = await Promise.all([navCountsFull(user.userId, user.role), followUpsFor(user.userId)]);
    return reply.type('text/html').send(renderFollowUpsPage({ user, counts, ...followUps }));
  });

  app.post<{ Params: { id: string } }>('/follow-ups/:id/complete', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    await completeFollowUp(Number(request.params.id), user);
    return reply.redirect('/follow-ups');
  });

  // --------------------------------------------------------------- accounts --

  app.get<{ Params: { id: string }; Querystring: { flash?: string } }>(
    '/accounts/:id', async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      if (!validId(request.params.id, reply)) return;
      const detail = await getAccountDetail(request.params.id, user);
      if (!detail) return reply.code(404).type('text/html').send('<p>Account not found.</p>');
      const counts = await navCountsFull(user.userId, user.role);
      return reply.type('text/html').send(
        renderAccountPage(detail, user, counts, request.query.flash),
      );
    },
  );

  /** Drawer body. HTML fragment, same authorization as the full page. */
  app.get<{ Params: { id: string } }>('/accounts/:id/panel', async (request, reply) => {
    if (!request.user) return reply.code(401).send('');
    const detail = await getAccountDetail(request.params.id, request.user);
    if (!detail) return reply.code(404).send('<p class="muted">Account not found.</p>');
    return reply.type('text/html').send(renderAccountPanel(detail, request.user));
  });

  app.post<{
    Params: { id: string };
    Body: { disposition?: string; notes?: string; callbackDueAt?: string; endpointId?: string };
  }>('/accounts/:id/disposition', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;

    const disposition = request.body?.disposition as Disposition | undefined;
    if (!disposition) return reply.redirect(`/accounts/${request.params.id}?flash=No+outcome+selected`);

    const callbackRaw = request.body?.callbackDueAt;
    const result = await recordDisposition(
      {
        accountId: request.params.id,
        disposition,
        notes: request.body?.notes?.trim() || null,
        endpointId: request.body?.endpointId || null,
        callbackDueAt: callbackRaw ? new Date(callbackRaw) : null,
        prospectRequested: disposition === 'CALLBACK_REQUESTED',
        channel: 'phone',
      },
      user,
    );

    const flash = result.ok
      ? (result.suppressionCreated
          ? 'Do Not Contact recorded. This company is suppressed across every channel.'
          : 'Outcome saved.')
      : result.reason === 'CALLBACK_TIME_REQUIRED'
        ? 'Pick a callback time before saving.'
        : result.reason === 'NOT_OWNER'
          ? 'You do not own this account.'
          : 'Could not save that outcome.';

    return reply.redirect(`/accounts/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/release', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const result = await releaseAccount(request.params.id, user, 'Released from account page');
    const flash = result.ok
      ? 'Released back to shared inventory.'
      : result.reason === 'PROTECTED_RELATIONSHIP'
        ? `Cannot release: this account has a protected relationship (${result.protectedBy}).`
        : 'Could not release this account.';
    return reply.redirect(`/accounts/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/contact-research', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const result = await enqueueContactResearch(request.params.id, user.userId);
    const flash = result.created
      ? 'Contact research queued. It runs in the background.'
      : 'Contact research is already queued for this account.';
    return reply.redirect(`/accounts/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  // ------------------------------------------------------- wave C operations --

  /** Manager/research-ops gate used by the operations pages. */
  const requireOps = (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request, reply);
    if (!user) return null;
    if (!isManager(user.role) && user.role !== 'RESEARCH_OPS') {
      reply.code(403).type('text/html').send('<p>Managers and research operations only.</p>');
      return null;
    }
    return user;
  };

  app.get('/mining', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    const [counts, kpis, jobs] = await Promise.all([
      navCountsFull(user.userId, user.role), miningKpis(), miningJobs(),
    ]);
    return reply.type('text/html').send(renderMiningPage({ user, counts, kpis, jobs }));
  });

  app.get('/research-health', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    const [counts, metrics, exceptions] = await Promise.all([
      navCountsFull(user.userId, user.role), researchHealthMetrics(), researchExceptions(),
    ]);
    return reply.type('text/html').send(renderResearchHealthPage({ user, counts, metrics, exceptions }));
  });

  app.get<{ Querystring: { flash?: string; error?: string } }>('/imports', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    const [counts, history] = await Promise.all([
      navCountsFull(user.userId, user.role), listImportHistory(),
    ]);
    return reply.type('text/html').send(renderImportsPage({
      user, counts, history, flash: request.query.flash ?? null, error: request.query.error ?? null,
    }));
  });

  /** Browser upload, so a prospect list no longer needs an SSH session. */
  app.post('/imports/upload', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;

    try {
      const parts = request.parts();
      let content = '';
      let fileName = '';
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === 'file') {
          fileName = part.filename ?? 'upload.csv';
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          if (part.file.truncated) throw new Error('That file is larger than the 20 MB upload limit.');
          content = Buffer.concat(chunks).toString('utf8');
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }

      if (!content.trim()) throw new Error('That file appears to be empty.');

      const session = await createSession({
        content, fileName,
        sourceName: fields['sourceName']?.trim() || fileName,
        sourceKind: fields['sourceKind'] || 'csv',
        createdBy: user.userId,
      });
      return reply.redirect(`/imports/${session.importSessionId}`);
    } catch (error) {
      return reply.redirect(`/imports?error=${encodeURIComponent((error as Error).message)}`);
    }
  });

  app.get<{ Params: { id: string } }>('/imports/:id', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const loaded = await getSession(request.params.id, user.userId);
    if (!loaded) return reply.code(404).type('text/html').send('<p>Import session not found.</p>');
    const [counts, verticals] = await Promise.all([
      navCountsFull(user.userId, user.role), listVerticals(),
    ]);
    return reply.type('text/html').send(renderImportWizardPage({
      user, counts, session: loaded.summary, preview: loaded.summary.preview, verticals,
    }));
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    '/imports/:id/map', async (request, reply) => {
      const user = requireOps(request, reply);
      if (!user) return;
      if (!validId(request.params.id, reply)) return;

      const columnMap: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.body ?? {})) {
        if (key.startsWith('map_') && value) columnMap[key.slice(4)] = value;
      }
      await setColumnMap(
        request.params.id, user.userId, columnMap as never,
        request.body?.['defaultVertical'] || null,
      );
      await buildPreview(request.params.id, user.userId);
      return reply.redirect(`/imports/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string } }>('/imports/:id/confirm', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const result = await confirmSession(request.params.id, user.userId);
    if (!result.ok) {
      return reply.redirect(`/imports?error=${encodeURIComponent(result.message ?? 'Import failed.')}`);
    }
    const report = result.report!;
    const flash = `${report.created} accounts created, ${report.matched} merged, `
      + `${report.rejected} skipped, ${report.suppressed} suppressed. No outreach was scheduled.`;
    return reply.redirect(`/imports?flash=${encodeURIComponent(flash)}`);
  });

  app.post<{ Params: { id: string } }>('/imports/:id/cancel', async (request, reply) => {
    const user = requireOps(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    await import('../db/pool.js').then((m) => m.query(
      `update import_sessions set status = 'CANCELLED', raw_rows = null
        where import_session_id = $1 and created_by = $2`,
      [request.params.id, user.userId]));
    return reply.redirect('/imports?flash=Upload+discarded.');
  });

  // ------------------------------------------------------------------- team --

  app.get('/team', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!isManager(user.role)) return reply.code(403).type('text/html').send('<p>Managers only.</p>');
    const [counts, team] = await Promise.all([navCountsFull(user.userId, user.role), teamRows()]);
    return reply.type('text/html').send(renderTeamPage({
      user, counts, team, staleThresholdDays: STALE_CLAIM_THRESHOLD_DAYS,
    }));
  });

  app.get<{ Params: { id: string } }>('/team/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    if (!isManager(user.role)) return reply.code(403).type('text/html').send('<p>Managers only.</p>');

    const rep = await findUser(request.params.id);
    if (!rep) return reply.code(404).type('text/html').send('<p>Rep not found.</p>');

    const [counts, reps] = await Promise.all([navCountsFull(user.userId, user.role), activeReps()]);
    // A manager viewing a rep's book searches as that rep.
    const response = await searchProspects(
      { ownership: 'MINE', pageSize: 200 },
      { userId: rep.user_id, role: user.role },
    );
    return reply.type('text/html').send(renderRepBookPage({ user, counts, rep, response, reps }));
  });

  app.post<{ Params: { id: string }; Body: { accountIds?: string; newOwnerUserId?: string; reason?: string } }>(
    '/team/:id/reassign', async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      if (!validId(request.params.id, reply)) return;
      if (!isManager(user.role)) return reply.code(403).send('Managers only.');

      const accountIds = (request.body?.accountIds ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      const newOwner = request.body?.newOwnerUserId;
      const reason = (request.body?.reason ?? '').trim();
      if (!newOwner || !reason || accountIds.length === 0) {
        return reply.redirect(`/team/${request.params.id}`);
      }
      for (const accountId of accountIds) {
        await reassignAccount(accountId, newOwner, user, reason);
      }
      return reply.redirect(`/team/${request.params.id}`);
    },
  );

  // ------------------------------------------------------------- wave B pages --

  app.get<{ Params: { id: string } }>('/markets/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const market = await getMarket(request.params.id);
    if (!market) return reply.code(404).type('text/html').send('<p>Market not found.</p>');

    const [counts, jobs, results] = await Promise.all([
      navCountsFull(user.userId, user.role),
      marketResearchActivity(request.params.id),
      searchProspects({ marketId: request.params.id, ownership: 'ANY_VISIBLE', pageSize: 50 }, user),
    ]);
    return reply.type('text/html').send(renderMarketDetailPage({
      user, counts, market, rows: results.results, jobs,
      canManage: isManager(user.role) || user.role === 'RESEARCH_OPS',
    }));
  });

  app.get('/replies', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const tab = params.get('tab') ?? 'needs_response';
    const [counts, replies] = await Promise.all([
      navCountsFull(user.userId, user.role),
      listReplies(user, tab as never),
    ]);
    return reply.type('text/html').send(renderRepliesPage({
      user, counts, replies, activeTab: tab,
    }));
  });

  app.get('/opportunities', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const view = params.get('view') === 'table' ? 'table' : 'pipeline';
    const stage = params.get('stage') as Stage | null;
    const [counts, opportunities] = await Promise.all([
      navCountsFull(user.userId, user.role),
      listOpportunities(user, { stage }),
    ]);
    return reply.type('text/html').send(renderOpportunitiesPage({
      user, counts, opportunities, view, stageFilter: stage,
    }));
  });

  app.get<{ Params: { id: string } }>('/opportunities/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const detail = await getOpportunity(request.params.id, user);
    if (!detail) return reply.code(404).type('text/html').send('<p>Opportunity not found.</p>');
    const counts = await navCountsFull(user.userId, user.role);
    return reply.type('text/html').send(renderOpportunityDetailPage({ user, counts, ...detail }));
  });

  app.post<{
    Params: { id: string };
    Body: { targetStage?: string; reason?: string; closeReason?: string };
  }>('/opportunities/:id/transition', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const result = await transitionOpportunity({
      opportunityId: request.params.id,
      targetStage: (request.body?.targetStage ?? '') as Stage,
      reason: request.body?.reason ?? '',
      closeReason: request.body?.closeReason ?? null,
    }, user);
    const flash = result.ok ? 'Stage updated.' : (result.message ?? 'Could not change the stage.');
    return reply.redirect(`/opportunities/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  /** Opening an opportunity from an Account. */
  app.post<{ Params: { id: string }; Body: { problemSummary?: string; desiredOutcome?: string } }>(
    '/accounts/:id/opportunity', async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      if (!validId(request.params.id, reply)) return;
      const result = await createOpportunity({
        accountId: request.params.id,
        problemSummary: request.body?.problemSummary ?? '',
        desiredOutcome: request.body?.desiredOutcome ?? null,
        sourceChannel: 'portal',
      }, user);
      if (result.ok) return reply.redirect(`/opportunities/${result.opportunityId}`);
      return reply.redirect(
        `/accounts/${request.params.id}?flash=${encodeURIComponent(result.message ?? 'Could not open an opportunity.')}`);
    },
  );

  app.get('/meetings', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const tab = params.get('tab') ?? 'upcoming';
    const [counts, meetings] = await Promise.all([
      navCountsFull(user.userId, user.role),
      listMeetings(user, tab as never),
    ]);
    return reply.type('text/html').send(renderMeetingsPage({
      user, counts, meetings, activeTab: tab,
    }));
  });

  app.get<{ Params: { id: string } }>('/meetings/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const meeting = await getMeeting(request.params.id);
    if (!meeting) return reply.code(404).type('text/html').send('<p>Meeting not found.</p>');
    const [counts, brief] = await Promise.all([
      navCountsFull(user.userId, user.role),
      meeting.prep_brief ? Promise.resolve(meeting.prep_brief) : buildPrepBrief(request.params.id),
    ]);
    return reply.type('text/html').send(renderMeetingDetailPage({ user, counts, meeting, brief }));
  });

  // ---------------------------------------------------------------- booking --

  /** Real availability only. An unreadable calendar returns zero slots and a reason. */
  app.get('/api/booking/availability', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const offer = await getAvailability();
    return reply.send({
      ok: offer.ok,
      sameDay: offer.sameDay,
      calendarUpn: offer.calendarUpn,
      timezone: offer.timezone,
      reason: offer.reason ?? null,
      message: offer.message,
      slots: offer.slots.map((slot) => ({
        token: slot.token, spoken: slot.spoken,
        start: slot.start.toISOString(), end: slot.end.toISOString(),
      })),
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      start?: string; end?: string; slotToken?: string; prospectAgreed?: string | boolean;
      attendeeName?: string; attendeeEmail?: string; attendeePhone?: string;
      prospectTimezone?: string; agendaNote?: string;
    };
  }>('/accounts/:id/book', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;

    const body = request.body ?? {};
    const agreed = body.prospectAgreed === true || body.prospectAgreed === 'on'
      || body.prospectAgreed === 'true';
    const start = body.start ? new Date(body.start) : null;
    const end = body.end ? new Date(body.end) : null;

    if (!start || !end || Number.isNaN(start.getTime())) {
      return reply.redirect(
        `/accounts/${request.params.id}?flash=${encodeURIComponent('Pick one of the offered times first.')}`,
      );
    }

    const { rows: ownerRows } = await import('../db/pool.js').then((m) =>
      m.query<{ current_owner_user_id: string | null }>(
        'select current_owner_user_id from accounts where account_id = $1', [request.params.id]));

    const result = await bookStrategyCall({
      accountId: request.params.id,
      ownerUserId: ownerRows[0]?.current_owner_user_id ?? user.userId,
      start, end,
      slotToken: body.slotToken,
      prospectAgreed: agreed,
      attendeeName: body.attendeeName?.trim() || null,
      attendeeEmail: body.attendeeEmail?.trim() || null,
      attendeePhone: body.attendeePhone?.trim() || null,
      prospectTimezone: body.prospectTimezone?.trim() || null,
      agendaNote: body.agendaNote?.trim() || null,
      createdBy: user.userId,
    });

    // The flash message is the same wording the caller may say out loud: never
    // "booked" unless the provider actually confirmed it.
    const flash = result.ok
      ? result.spokenConfirmation
      : result.reason === 'NOT_AGREED'
        ? 'Tick the box confirming the prospect agreed to this time before booking.'
        : result.spokenConfirmation || 'That booking could not be completed.';

    return reply.redirect(`/accounts/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  app.post<{ Body: { key?: string } }>('/settings/test', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;
    const result = await testIntegration({
      key: request.body.key ?? '', actorUserId: user.userId });
    return reply.redirect(
      `/settings?flash=${encodeURIComponent(`${result.status}: ${result.detail}`)}`);
  });

  // Global search. Every hit resolves to a canonical Account, so a phone number or a
  // person found here opens the record the rest of the product already uses.
  app.get<{ Querystring: { q?: string } }>('/search', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const term = (request.query.q ?? '').slice(0, 120);
    const [counts, hits] = await Promise.all([
      navCountsFull(user.userId, user.role),
      term.trim().length >= 2 ? globalSearch(term, 25, user) : Promise.resolve([]),
    ]);
    return reply.type('text/html').send(renderSearchPage({ user, counts, term, hits }));
  });

  // -------------------------------------------------- wave C/D: pilot & review --

  /** Manager/admin only. Reps never see the outbound control plane. */
  const requireManager = (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request, reply);
    if (!user) return null;
    if (!isManager(user.role)) {
      reply.code(403).type('text/html').send('<p>Managers and administrators only.</p>');
      return null;
    }
    return user;
  };

  const requireAdmin = (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(request, reply);
    if (!user) return null;
    if (user.role !== 'ADMIN') {
      reply.code(403).type('text/html').send('<p>Administrators only.</p>');
      return null;
    }
    return user;
  };

  app.get<{ Querystring: { flash?: string; error?: string; preview?: string } }>(
    '/ai/pilot', async (request, reply) => {
      const user = requireManager(request, reply);
      if (!user) return;
      const [counts, state, candidates, preview] = await Promise.all([
        navCountsFull(user.userId, user.role), readPilotState(), listCandidates(),
        request.query.preview ? callPackPreview(request.query.preview) : Promise.resolve(null),
      ]);
      return reply.type('text/html').send(renderPilotPage({
        user, counts, state, candidates, preview,
        flash: request.query.flash ?? null, error: request.query.error ?? null,
      }));
    });

  app.post<{ Body: { field?: string; value?: string; reason?: string } }>(
    '/ai/pilot/switch', async (request, reply) => {
      const user = requireManager(request, reply);
      if (!user) return;
      const result = await setPilotSwitch({
        field: request.body.field ?? '', value: request.body.value ?? '',
        actorUserId: user.userId, reason: request.body.reason ?? '',
      });
      return reply.redirect(result.ok
        ? '/ai/pilot?flash=Setting+updated.+New+calls+only.'
        : `/ai/pilot?error=${encodeURIComponent(result.message ?? 'Could not change that setting.')}`);
    });

  app.post<{ Body: { reason?: string } }>('/ai/pilot/stop', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const reason = (request.body.reason ?? '').trim();
    if (!reason) return reply.redirect('/ai/pilot?error=A+reason+is+required.');
    const result = await stopNewOutboundCalls(user.userId, reason);
    return reply.redirect(`/ai/pilot?flash=${encodeURIComponent(
      `Outbound stopped. ${result.unqueued} queued candidate(s) returned to review. `
      + 'A call already in progress is unaffected.')}`);
  });

  app.post<{ Body: { accountId?: string; returnTo?: string } }>(
    '/ai/pilot/candidates', async (request, reply) => {
      const user = requireManager(request, reply);
      if (!user) return;
      const result = await addCandidate({
        accountId: request.body.accountId ?? '', actorUserId: user.userId,
      });
      return reply.redirect(result.ok
        ? '/ai/pilot?flash=Added+to+the+pilot+list.+Nothing+was+dialled.'
        : `/ai/pilot?error=${encodeURIComponent(result.message ?? 'Could not add that account.')}`);
    });

  app.post<{ Body: { pilotCandidateId?: string } }>('/ai/pilot/remove', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    await removeCandidate(request.body.pilotCandidateId ?? '', user.userId);
    return reply.redirect('/ai/pilot?flash=Removed+from+the+pilot+list.');
  });

  app.post<{ Body: { pilotCandidateId?: string } }>('/ai/pilot/preflight', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const result = await runPreflight(request.body.pilotCandidateId ?? '', user.userId);
    const detail = `${result.decision}${result.reasons.length ? `: ${result.reasons.join(', ')}` : ''}`;
    return reply.redirect(result.ok
      ? `/ai/pilot?flash=${encodeURIComponent(`Preflight passed (${detail}). Still not dialled.`)}`
      : `/ai/pilot?error=${encodeURIComponent(
          `Preflight failed (${detail}).${result.message ? ` ${result.message}` : ''}`)}`);
  });

  app.get('/calls', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const [counts, calls] = await Promise.all([
      navCountsFull(user.userId, user.role), listVoiceCalls(),
    ]);
    return reply.type('text/html').send(renderCallListPage({ user, counts, calls }));
  });

  app.get<{ Params: { id: string } }>('/calls/:id', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const detail = await voiceCallDetail(request.params.id);
    if (!detail) return reply.code(404).type('text/html').send('<p>Call not found.</p>');
    const counts = await navCountsFull(user.userId, user.role);
    return reply.type('text/html').send(renderCallReviewPage({
      user, counts, call: detail.call, turns: detail.turns, events: detail.events,
    }));
  });

  app.post<{
    Params: { id: string };
    Body: { qaScore?: string; rootCause?: string; reviewAction?: string;
            hardFailure?: string; reviewerNotes?: string };
  }>('/calls/:id/review', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const score = request.body.qaScore ? Number(request.body.qaScore) : null;
    await query(
      `update voice_calls
          set qa_score = $2, root_cause = nullif($3, ''), review_action = nullif($4, ''),
              qa_hard_failure = $5, reviewer_notes = nullif($6, ''),
              reviewed_by = $7, reviewed_at = now()
        where voice_call_id = $1`,
      [request.params.id, Number.isFinite(score) ? score : null,
       request.body.rootCause ?? '', request.body.reviewAction ?? '',
       request.body.hardFailure === 'true', request.body.reviewerNotes ?? '', user.userId],
    );
    await query(
      `insert into audit_log (actor_user_id, action, subject_type, subject_id, detail)
       values ($1, 'call.review', 'voice_call', $2, $3::jsonb)`,
      [user.userId, request.params.id,
       JSON.stringify({ score, action: request.body.reviewAction ?? null })],
    );
    return reply.redirect(`/calls/${request.params.id}`);
  });

  // ------------------------------------------------ wave D: campaigns, reports --

  app.get('/campaigns', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const [counts, campaigns, conflicts] = await Promise.all([
      navCountsFull(user.userId, user.role), listCampaigns(), campaignRelationshipConflicts(),
    ]);
    return reply.type('text/html').send(renderCampaignsPage({ user, counts, campaigns, conflicts }));
  });

  app.get('/audit', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const filters = parseAuditFilters(params);
    const [counts, events, options] = await Promise.all([
      navCountsFull(user.userId, user.role), listAuditEvents(filters), auditFilterOptions(),
    ]);
    return reply.type('text/html').send(renderAuditPage({ user, counts, events, filters, options }));
  });

  app.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    if (!validId(request.params.id, reply)) return;
    const detail = await campaignDetail(request.params.id);
    if (!detail) return reply.code(404).type('text/html').send('<p>Campaign not found.</p>');
    const counts = await navCountsFull(user.userId, user.role);
    return reply.type('text/html').send(renderCampaignDetailPage({ user, counts, detail }));
  });

  app.get('/analytics', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    const filters = parseAnalyticsFilters(params);

    // The opener comparison uses the same scope the rest of the page is showing, so
    // a filtered funnel and a filtered experiment cannot disagree.
    const cohort = {
      verticalProfileId: filters.verticalProfileId, marketId: filters.marketId,
      fromDate: filters.fromDate, toDate: filters.toDate,
    };
    const [counts, options, funnel, byVertical, byOwner, byMarket, byHypothesis,
           hooks, promotion] = await Promise.all([
      navCountsFull(user.userId, user.role),
      analyticsFilterOptions(),
      analyticsFunnel(filters),
      analyticsBreakdown('vertical'), analyticsBreakdown('owner'),
      analyticsBreakdown('market'), analyticsBreakdown('hypothesis'),
      compareHookVariants(cohort), promotionReadiness(cohort),
    ]);
    return reply.type('text/html').send(renderAnalyticsPage({
      user, counts, funnel, filters, options, hooks, promotion,
      breakdowns: { vertical: byVertical, rep: byOwner, market: byMarket, hypothesis: byHypothesis },
    }));
  });

  // Managers may see integration health; only an administrator may change it.
  app.get<{ Querystring: { flash?: string; error?: string } }>('/settings', async (request, reply) => {
    const user = requireManager(request, reply);
    if (!user) return;
    const [counts, integrations, pilot] = await Promise.all([
      navCountsFull(user.userId, user.role), listIntegrations(), readPilotState(),
    ]);
    return reply.type('text/html').send(renderSettingsPage({
      user, counts, integrations, pilot, canEdit: user.role === 'ADMIN',
      flash: request.query.flash ?? null, error: request.query.error ?? null,
    }));
  });

  app.post<{ Body: { key?: string; enabled?: string; reason?: string } }>(
    '/settings/integration', async (request, reply) => {
      const user = requireAdmin(request, reply);
      if (!user) return;
      const result = await setIntegrationEnabled({
        key: request.body.key ?? '', enabled: request.body.enabled === 'true',
        actorUserId: user.userId, reason: request.body.reason ?? '',
      });
      return reply.redirect(result.ok
        ? '/settings?flash=Integration+updated.'
        : `/settings?error=${encodeURIComponent(result.message ?? 'Could not update that integration.')}`);
    });

  // Coverage lookup used by the Find page's background polling.
  app.get('/api/coverage', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ ok: false });
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    return reply.send(await coverageFor(parseSearchQuery(params)));
  });
}
