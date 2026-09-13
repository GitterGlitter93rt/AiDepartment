import type { FastifyInstance } from 'fastify';
import { claimAccount, claimAccounts, releaseAccount, reassignAccount } from '../domain/ownership.js';
import { recordDisposition, addNote, type Disposition } from '../domain/activities.js';
import { getAccountDetail } from '../domain/accountDetail.js';
import { searchProspects } from '../domain/search.js';
import { permissionsFor } from '../domain/auth.js';
import { enqueueContactResearch, enqueueMarketResearch } from '../workers/enqueue.js';
import { requireApiUser, requirePermission } from './server.js';
import { preflightCall, evaluateAccount } from '../compliance/eligibility.js';
import { ingestBookingWebhook, verifySignature } from '../booking/webhooks.js';
import { handleSmartleadWebhook } from '../email/smartleadWebhook.js';
import { rescheduleStrategyCall, cancelStrategyCall } from '../booking/service.js';
import { buildPrepBrief } from '../booking/brief.js';
import { canViewBooking } from '../domain/bookingAccess.js';
import { isUuid, validUuid } from './ids.js';
import { parseOperatorDateTime } from '../domain/time.js';
import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { marketCards, navCountsFor } from './queries.js';

/**
 * JSON API.
 * Authority: rep-portal-api-contract.v1.md.
 * Every endpoint re-checks the session and the permission server-side. Ownership is
 * never trusted from the client, and a claim response always reports the real state.
 */

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', async (request, reply) => {
    const user = requireApiUser(request, reply);
    if (!user) return;
    const counts = await navCountsFor(user.userId);
    // Never return provider configuration or secrets (API contract §2).
    return {
      userId: user.userId,
      name: user.displayName,
      email: user.email,
      role: user.role,
      permissions: permissionsFor(user.role),
      activeClaimCount: counts.myProspects ?? 0,
      activeClaimTarget: user.activeClaimTarget,
    };
  });

  app.post<{ Params: { id: string }; Body: { searchContextId?: string | null } }>(
    '/api/accounts/:id/claim', async (request, reply) => {
      const user = requirePermission(request, reply, 'claim_accounts');
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      const outcome = await claimAccount(
        request.params.id, user, request.body?.searchContextId ?? null,
      );
      // A conflict is a normal outcome, not a server error: 200 with the real state.
      return { ...outcome, accountId: request.params.id };
    },
  );

  app.post<{ Body: { accountIds?: string[]; searchContextId?: string | null } }>(
    '/api/accounts/claim-batch', async (request, reply) => {
      const user = requirePermission(request, reply, 'claim_accounts');
      if (!user) return;

      const accountIds = Array.isArray(request.body?.accountIds) ? request.body.accountIds : [];
      if (accountIds.length === 0) {
        return reply.code(400).send({ ok: false, message: 'No accounts selected.' });
      }
      if (accountIds.length > 200) {
        return reply.code(400).send({ ok: false, message: 'Claim at most 200 accounts at a time.' });
      }
      if (!accountIds.every(isUuid)) {
        return reply.code(400).send({ ok: false, message: 'That selection contains something that is not an account.' });
      }
      return claimAccounts(accountIds, user, request.body?.searchContextId ?? null);
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/accounts/:id/release', async (request, reply) => {
      const user = requireApiUser(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      return releaseAccount(request.params.id, user, request.body?.reason ?? null);
    },
  );

  app.post<{ Params: { id: string }; Body: { newOwnerUserId?: string; reason?: string } }>(
    '/api/accounts/:id/reassign', async (request, reply) => {
      const user = requirePermission(request, reply, 'reassign_accounts');
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      const newOwner = request.body?.newOwnerUserId;
      const reason = (request.body?.reason ?? '').trim();
      if (!newOwner || !reason) {
        return reply.code(400).send({ ok: false, message: 'A new owner and a reason are both required.' });
      }
      if (!isUuid(newOwner)) {
        return reply.code(400).send({ ok: false, message: 'That is not a valid user.' });
      }
      return reassignAccount(request.params.id, newOwner, user, reason);
    },
  );

  app.get<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    const user = requireApiUser(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id, reply)) return;
    const detail = await getAccountDetail(request.params.id, user);
    if (!detail) return reply.code(404).send({ ok: false, message: 'Not found' });
    return detail;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/prospects/search', async (request, reply) => {
    const user = requirePermission(request, reply, 'search_inventory');
    if (!user) return;
    return searchProspects((request.body ?? {}) as never, user);
  });

  // --------------------------------------------------------- booking lifecycle --

  /**
   * Provider webhook. Unauthenticated by design — it is authenticated by signature,
   * not by session — and an unverified payload is rejected rather than trusted.
   */
  app.post('/api/webhooks/calcom', async (request, reply) => {
    const rawBody = (request as { rawBody?: string }).rawBody ?? '';
    const signature = request.headers['x-cal-signature-256'] as string | undefined;

    if (!config.booking.calcomWebhookSecret) {
      // Refusing is safer than accepting unverifiable booking state changes.
      request.log.warn('calcom webhook received but no signing secret is configured');
      return reply.code(503).send({ ok: false, message: 'Webhook verification is not configured.' });
    }
    if (!verifySignature(rawBody, signature)) {
      request.log.warn({ ip: request.ip }, 'calcom webhook signature verification failed');
      return reply.code(401).send({ ok: false, message: 'Invalid signature.' });
    }

    const result = await ingestBookingWebhook(request.body as never);
    return reply.send({
      ok: result.ok, duplicate: result.duplicate, eventType: result.eventType,
      applied: result.applied,
    });
  });

  /**
   * The email provider's webhook. Authenticated by signature over the raw bytes,
   * never by a session, and never by the fact that the caller knew the URL.
   */
  app.post('/api/webhooks/smartlead', async (request, reply) => {
    const rawBody = (request as { rawBody?: string }).rawBody ?? '';
    const handled = await handleSmartleadWebhook({
      rawBody, headers: request.headers as Record<string, string | string[] | undefined>,
    });
    if (!handled.body.ok && handled.status >= 400) {
      request.log.warn({ ip: request.ip, outcome: handled.body.outcome },
        'smartlead webhook rejected');
    }
    return reply.code(handled.status).send(handled.body);
  });

  app.post<{ Params: { id: string }; Body: { start?: string; end?: string; reason?: string } }>(
    '/api/bookings/:id/reschedule', async (request, reply) => {
      const user = requireApiUser(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      // The offered slots carry a Z. A hand-written wall clock means the business
      // timezone, so a reschedule cannot silently move a meeting by four hours.
      const start = parseOperatorDateTime(request.body?.start, config.booking.timezone);
      const end = parseOperatorDateTime(request.body?.end, config.booking.timezone);
      const reason = (request.body?.reason ?? '').trim();
      if (!start || !end || !reason) {
        return reply.code(400).send({ ok: false, message: 'A new time and a reason are both required.' });
      }
      const result = await rescheduleStrategyCall({
        bookingId: request.params.id, newStart: start, newEnd: end, reason,
        actorUserId: user.userId, actor: user,
      });
      if (!result.ok && result.reason === 'NOT_OWNER') return reply.code(403).send(result);
      return result;
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/bookings/:id/cancel', async (request, reply) => {
      const user = requireApiUser(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      const reason = (request.body?.reason ?? '').trim();
      if (!reason) return reply.code(400).send({ ok: false, message: 'A reason is required.' });
      const result = await cancelStrategyCall({
        bookingId: request.params.id, reason, actorUserId: user.userId, actor: user,
      });
      if (!result.ok && result.reason === 'NOT_OWNER') return reply.code(403).send(result);
      return result;
    },
  );

  app.get<{ Params: { id: string } }>('/api/bookings/:id/brief', async (request, reply) => {
    const user = requireApiUser(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id, reply)) return;
    // A prep brief carries what the prospect actually said. It is readable by the
    // people who can see the meeting, not by anyone holding the booking id.
    if (!(await canViewBooking(request.params.id, user))) {
      return reply.code(404).send({ ok: false, message: 'Booking not found.' });
    }
    const brief = await buildPrepBrief(request.params.id);
    if (!brief) return reply.code(404).send({ ok: false, message: 'Booking not found.' });
    return brief;
  });

  app.get('/api/markets', async (request, reply) => {
    const user = requirePermission(request, reply, 'browse_markets');
    if (!user) return;
    return marketCards();
  });

  app.post<{
    Params: { id: string };
    Body: {
      disposition?: string; notes?: string; contactId?: string; endpointId?: string;
      callbackDueAt?: string; prospectRequested?: boolean;
      prospectStatements?: { category: string; text: string }[];
    };
  }>('/api/accounts/:id/activities/disposition', async (request, reply) => {
    const user = requirePermission(request, reply, 'create_disposition');
    if (!user) return;
    if (!validUuid(request.params.id, reply)) return;

    const disposition = request.body?.disposition as Disposition | undefined;
    if (!disposition) return reply.code(400).send({ ok: false, message: 'A disposition is required.' });

    const result = await recordDisposition(
      {
        accountId: request.params.id,
        disposition,
        contactId: request.body?.contactId ?? null,
        endpointId: request.body?.endpointId ?? null,
        notes: request.body?.notes ?? null,
        // A JSON client may send an instant (with a Z or an offset) or a wall clock.
        // A wall clock means the business timezone, never the server's.
        callbackDueAt: parseOperatorDateTime(request.body?.callbackDueAt, config.booking.timezone),
        prospectRequested: request.body?.prospectRequested ?? false,
        prospectStatements: request.body?.prospectStatements ?? [],
      },
      user,
    );
    if (!result.ok) {
      const status = result.reason === 'NOT_OWNER' ? 403 : result.reason === 'NOT_FOUND' ? 404 : 400;
      return reply.code(status).send(result);
    }
    return result;
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/api/accounts/:id/notes', async (request, reply) => {
      const user = requireApiUser(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      const note = (request.body?.note ?? '').trim();
      if (!note) return reply.code(400).send({ ok: false, message: 'Note text is required.' });
      return addNote(request.params.id, note, user);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/contact-research', async (request, reply) => {
      const user = requirePermission(request, reply, 'request_contact_research');
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      return enqueueContactResearch(request.params.id, user.userId);
    },
  );

  /**
   * Server-side gate before a rep dials.
   * The tel: link in the UI is a convenience; this is the control. It recomputes
   * eligibility rather than trusting anything rendered earlier, and records the
   * attempt against the decision that authorized it
   * (global-phone-channel-eligibility-dnc-spec §11, §16).
   */
  app.post<{ Params: { id: string }; Body: { endpointId?: string; contactId?: string } }>(
    '/api/accounts/:id/start-call', async (request, reply) => {
      const user = requirePermission(request, reply, 'work_owned_accounts');
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;

      const endpointId = request.body?.endpointId;
      if (!endpointId) return reply.code(400).send({ ok: false, message: 'An endpoint is required.' });
      if (!isUuid(endpointId)) {
        return reply.code(404).send({ ok: false, message: 'That phone number is not on this account.' });
      }

      const preflight = await preflightCall(endpointId, 'HUMAN_MANUAL_CALL');
      if (!preflight.allowed) {
        // A rep may not self-override a block or a review.
        return reply.code(403).send({
          ok: false, decision: preflight.decision, message: preflight.message,
          nextEligibleAt: preflight.nextEligibleAt,
        });
      }

      const attemptId = await withTransaction(async (client) => {
        const { rows } = await client.query<{ attempt_id: number }>(
          `insert into contact_attempts (account_id, contact_id, endpoint_id, actor_user_id,
                                         channel, eligibility_decision_id)
           values ($1,$2,$3,$4,'HUMAN_MANUAL_CALL',$5) returning attempt_id`,
          [
            request.params.id, request.body?.contactId ?? null, endpointId,
            user.userId, preflight.decisionId,
          ],
        );
        await client.query(
          'update channel_eligibility_decisions set used_for_attempt_id = $2 where decision_id = $1',
          [preflight.decisionId, rows[0]!.attempt_id],
        );
        return rows[0]!.attempt_id;
      });

      const { rows: endpointRows } = await withTransaction((client) =>
        client.query<{ normalized_value: string; display_value: string }>(
          'select normalized_value, display_value from contact_endpoints where endpoint_id = $1',
          [endpointId]));

      return {
        ok: true, attemptId,
        decisionId: preflight.decisionId,
        dial: endpointRows[0]?.normalized_value,
        display: endpointRows[0]?.display_value,
      };
    },
  );

  /** Re-screens every phone endpoint on an Account. */
  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/rescreen', async (request, reply) => {
      // Re-screening writes channel eligibility decisions and spends screening quota,
      // so it is a compliance action rather than ordinary rep work.
      const user = requirePermission(request, reply, 'rescreen_channel_eligibility');
      if (!user) return;
      if (!validUuid(request.params.id, reply)) return;
      return { ok: true, evaluated: await evaluateAccount(request.params.id) };
    },
  );

  /**
   * The plan, before any money is spent. Builds nothing chargeable and calls nobody.
   */
  app.post<{
    Body: {
      verticalProfileId?: string | null;
      geography?: { type?: string; value?: string } | null;
      marketId?: string | null;
      miningMode?: string | null;
      queryBudget?: number | null;
      causes?: string[] | null;
    };
  }>('/api/mining/plan', async (request, reply) => {
    const user = requirePermission(request, reply, 'request_market_refresh');
    if (!user) return;
    const marketId = request.body?.marketId;
    if (marketId != null && marketId !== '' && !isUuid(marketId)) {
      return reply.code(400).send({ ok: false, message: 'That market does not exist.' });
    }
    const { buildPaidPlan, persistPaidPlan } = await import('../miner/planPreview.js');
    const planRequest = {
      verticalProfileId: request.body?.verticalProfileId ?? null,
      geographyType: request.body?.geography?.type ?? null,
      geographyValue: request.body?.geography?.value ?? null,
      marketId: marketId || null,
      miningMode: request.body?.miningMode ?? null,
      // A budget is a number of chargeable searches, so it is bounded here as well as
      // by the provider's own ceiling: a request for ten thousand is a typo or an
      // attack, and either way it must not become a plan somebody can confirm.
      queryBudget: Math.max(0, Math.min(25, Math.floor(Number(request.body?.queryBudget ?? 1)) || 1)),
      causes: Array.isArray(request.body?.causes)
        ? request.body.causes.filter((cause) => typeof cause === 'string').slice(0, 10)
        : null,
    };
    const plan = await buildPaidPlan(planRequest);
    const stored = await persistPaidPlan(plan, user.userId, planRequest);
    return {
      ok: true, planId: stored.planId, planHash: stored.planHash,
      expiresAt: stored.expiresAt, plan,
    };
  });

  /**
   * Submits a plan somebody has reviewed. Nothing else.
   *
   * The body carries a plan id and the hash of what was shown. It deliberately
   * carries no queries: a client that could name the searches could spend the budget
   * on anything, and the taxonomy would become a suggestion. Anything else in the
   * body is ignored rather than merged, so there is no field through which a query
   * could arrive.
   */
  app.post<{
    Body: { planId?: string | null; planHash?: string | null };
  }>('/api/mining/jobs', async (request, reply) => {
    const user = requirePermission(request, reply, 'request_market_refresh');
    if (!user) return;

    const planId = request.body?.planId;
    const submittedHash = request.body?.planHash;
    if (!planId || !isUuid(planId) || typeof submittedHash !== 'string' || !submittedHash) {
      return reply.code(400).send({
        ok: false,
        message: 'Review the research plan before submitting paid searches.',
      });
    }

    const { confirmPaidPlan } = await import('../miner/planPreview.js');
    const confirmation = await confirmPaidPlan({
      planId, planHash: submittedHash, userId: user.userId });
    if (!confirmation.ok) {
      // A plan that moved is a normal outcome, not a server error: 409 with the
      // current plan, so the page can show what changed.
      const conflict = confirmation.code === 'CHANGED'
        || confirmation.code === 'ACTIVE_RUN_DIFFERS';
      return reply.code(conflict ? 409 : 400).send({
        ok: false, code: confirmation.code, message: confirmation.message,
        ...(confirmation.plan ? { plan: confirmation.plan } : {}),
      });
    }

    // The job carries the plan, not the inputs that produced it. The worker executes
    // those exact searches; it does not re-derive them from a vertical and a ZIP.
    //
    // Claiming the plan, creating the job and binding the two happen together, so the
    // plan can never be marked used against a run that does not exist, and a run can
    // never become visible carrying a plan that is not bound to it.
    const { enqueueConfirmedMarketResearch } = await import('../workers/enqueue.js');
    const result = await enqueueConfirmedMarketResearch({
      verticalProfileId: confirmation.plan.verticalProfileId,
      geographyType: confirmation.plan.geographyType,
      geographyValue: confirmation.plan.geographyValue,
      marketId: confirmation.plan.marketId,
      requestedBy: user.userId,
      miningMode: confirmation.plan.miningMode,
      queryBudget: confirmation.plan.searches.length,
      causes: confirmation.plan.causes,
      confirmedPlan: { planId: confirmation.planId, planHash: submittedHash },
    });
    if (!result.ok) {
      return reply.code(400).send({
        ok: false, code: result.code, message: result.message });
    }
    return {
      jobId: result.jobId, created: result.created, planId: confirmation.planId };
  });
}
