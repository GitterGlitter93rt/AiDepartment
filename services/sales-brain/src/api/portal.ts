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
      navCountsFor(user.userId),
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
      navCountsFor(user.userId), listVerticals(), marketOptions(),
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
    const [counts, markets] = await Promise.all([navCountsFor(user.userId), marketCards()]);
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
      navCountsFor(user.userId),
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
    const [counts, followUps] = await Promise.all([navCountsFor(user.userId), followUpsFor(user.userId)]);
    return reply.type('text/html').send(renderFollowUpsPage({ user, counts, ...followUps }));
  });

  app.post<{ Params: { id: string } }>('/follow-ups/:id/complete', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await completeFollowUp(Number(request.params.id), user);
    return reply.redirect('/follow-ups');
  });

  // --------------------------------------------------------------- accounts --

  app.get<{ Params: { id: string }; Querystring: { flash?: string } }>(
    '/accounts/:id', async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const detail = await getAccountDetail(request.params.id, user);
      if (!detail) return reply.code(404).type('text/html').send('<p>Account not found.</p>');
      const counts = await navCountsFor(user.userId);
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
    const result = await enqueueContactResearch(request.params.id, user.userId);
    const flash = result.created
      ? 'Contact research queued. It runs in the background.'
      : 'Contact research is already queued for this account.';
    return reply.redirect(`/accounts/${request.params.id}?flash=${encodeURIComponent(flash)}`);
  });

  // ------------------------------------------------------------------- team --

  app.get('/team', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!isManager(user.role)) return reply.code(403).type('text/html').send('<p>Managers only.</p>');
    const [counts, team] = await Promise.all([navCountsFor(user.userId), teamRows()]);
    return reply.type('text/html').send(renderTeamPage({
      user, counts, team, staleThresholdDays: STALE_CLAIM_THRESHOLD_DAYS,
    }));
  });

  app.get<{ Params: { id: string } }>('/team/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!isManager(user.role)) return reply.code(403).type('text/html').send('<p>Managers only.</p>');

    const rep = await findUser(request.params.id);
    if (!rep) return reply.code(404).type('text/html').send('<p>Rep not found.</p>');

    const [counts, reps] = await Promise.all([navCountsFor(user.userId), activeReps()]);
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

  // Coverage lookup used by the Find page's background polling.
  app.get('/api/coverage', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ ok: false });
    const params = new URLSearchParams((request.raw.url ?? '').split('?')[1] ?? '');
    return reply.send(await coverageFor(parseSearchQuery(params)));
  });
}
