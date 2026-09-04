import type { FastifyInstance } from 'fastify';
import { claimAccount, claimAccounts, releaseAccount, reassignAccount } from '../domain/ownership.js';
import { recordDisposition, addNote, type Disposition } from '../domain/activities.js';
import { getAccountDetail } from '../domain/accountDetail.js';
import { searchProspects } from '../domain/search.js';
import { permissionsFor } from '../domain/auth.js';
import { enqueueContactResearch, enqueueMarketResearch } from '../workers/enqueue.js';
import { requireApiUser, requirePermission } from './server.js';
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
      return claimAccounts(accountIds, user, request.body?.searchContextId ?? null);
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/accounts/:id/release', async (request, reply) => {
      const user = requireApiUser(request, reply);
      if (!user) return;
      return releaseAccount(request.params.id, user, request.body?.reason ?? null);
    },
  );

  app.post<{ Params: { id: string }; Body: { newOwnerUserId?: string; reason?: string } }>(
    '/api/accounts/:id/reassign', async (request, reply) => {
      const user = requirePermission(request, reply, 'reassign_accounts');
      if (!user) return;
      const newOwner = request.body?.newOwnerUserId;
      const reason = (request.body?.reason ?? '').trim();
      if (!newOwner || !reason) {
        return reply.code(400).send({ ok: false, message: 'A new owner and a reason are both required.' });
      }
      return reassignAccount(request.params.id, newOwner, user, reason);
    },
  );

  app.get<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    const user = requireApiUser(request, reply);
    if (!user) return;
    const detail = await getAccountDetail(request.params.id, user);
    if (!detail) return reply.code(404).send({ ok: false, message: 'Not found' });
    return detail;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/prospects/search', async (request, reply) => {
    const user = requirePermission(request, reply, 'search_inventory');
    if (!user) return;
    return searchProspects((request.body ?? {}) as never, user);
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

    const disposition = request.body?.disposition as Disposition | undefined;
    if (!disposition) return reply.code(400).send({ ok: false, message: 'A disposition is required.' });

    const result = await recordDisposition(
      {
        accountId: request.params.id,
        disposition,
        contactId: request.body?.contactId ?? null,
        endpointId: request.body?.endpointId ?? null,
        notes: request.body?.notes ?? null,
        callbackDueAt: request.body?.callbackDueAt ? new Date(request.body.callbackDueAt) : null,
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
      const note = (request.body?.note ?? '').trim();
      if (!note) return reply.code(400).send({ ok: false, message: 'Note text is required.' });
      return addNote(request.params.id, note, user);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/contact-research', async (request, reply) => {
      const user = requirePermission(request, reply, 'request_contact_research');
      if (!user) return;
      return enqueueContactResearch(request.params.id, user.userId);
    },
  );

  app.post<{
    Body: {
      verticalProfileId?: string | null;
      geography?: { type?: string; value?: string } | null;
      marketId?: string | null;
    };
  }>('/api/mining/jobs', async (request, reply) => {
    const user = requirePermission(request, reply, 'request_market_refresh');
    if (!user) return;
    return enqueueMarketResearch({
      verticalProfileId: request.body?.verticalProfileId ?? null,
      geographyType: request.body?.geography?.type ?? null,
      geographyValue: request.body?.geography?.value ?? null,
      marketId: request.body?.marketId ?? null,
      requestedBy: user.userId,
    });
  });
}
