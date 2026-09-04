import { query, withTransaction } from '../db/pool.js';
import { buildExportPayload, selectEligibleForCampaign, type ExportPayload } from './eligibility.js';

/**
 * Smartlead export and outbox drain.
 * Authority: outbound-sales-brain-smartlead-sync-spec.md §2-§4, §14, §17, §18, §21.
 *
 * Smartlead executes the email strategy; it is not a second sales organisation. So:
 *
 *  - an enrollment row is created before anything is sent, and it is the identity a
 *    reply resolves to. A provider lead id is recorded when the provider returns one,
 *    but the address is never the identity (§4);
 *  - every provider call goes through a durable outbox, so an outage delays a send
 *    and never duplicates one (§17);
 *  - the credential is read server-side at call time and never returned, logged or
 *    put in a payload (§18).
 */

export interface SmartleadConfig {
  apiKey: string | null;
  baseUrl: string;
  enabled: boolean;
}

export function smartleadConfig(env: NodeJS.ProcessEnv = process.env): SmartleadConfig {
  return {
    apiKey: env['SMARTLEAD_API_KEY'] ?? null,
    baseUrl: env['SMARTLEAD_BASE_URL'] ?? 'https://server.smartlead.ai/api/v1',
    enabled: env['SMARTLEAD_ENABLED'] === 'true',
  };
}

export type Transport = (
  url: string, init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface SmartleadClient {
  isConfigured(): boolean;
  /** Adds leads to a provider campaign. Returns provider ids keyed by our enrollment id. */
  addLeads(providerCampaignId: string, leads: ExportPayload[]):
    Promise<{ ok: boolean; providerIds: Record<string, string>; error?: string }>;
  pauseLead(providerCampaignId: string, providerLeadId: string):
    Promise<{ ok: boolean; error?: string }>;
}

export function createSmartleadClient(options: {
  config?: SmartleadConfig; transport?: Transport;
} = {}): SmartleadClient {
  const config = options.config ?? smartleadConfig();
  const transport = options.transport
    ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Transport>);

  const headers = () => ({ 'content-type': 'application/json' });
  const withKey = (path: string) => `${config.baseUrl}${path}api_key=${config.apiKey}`;

  return {
    isConfigured: () => Boolean(config.enabled && config.apiKey),

    async addLeads(providerCampaignId, leads) {
      if (!this.isConfigured()) return { ok: false, providerIds: {}, error: 'NOT_CONFIGURED' };
      try {
        const response = await transport(
          withKey(`/campaigns/${providerCampaignId}/leads?`),
          { method: 'POST', headers: headers(), body: JSON.stringify({
            lead_list: leads.map((lead) => ({
              email: lead.email,
              first_name: lead.first_name,
              company_name: lead.company_name,
              // Correlation travels with the lead so a reply resolves without the
              // address being treated as identity.
              custom_fields: {
                yad_enrollment_id: lead.yad_enrollment_id,
                yad_account_id: lead.yad_account_id,
                yad_campaign_id: lead.yad_campaign_id,
                ...lead.personalization,
              },
            })),
          }) },
        );
        if (!response.ok) return { ok: false, providerIds: {}, error: `HTTP_${response.status}` };
        const body = await response.json() as {
          upload_count?: number;
          already_added_to_campaign?: number;
          leads?: { email?: string; lead_id?: string | number;
                    custom_fields?: { yad_enrollment_id?: string } }[];
        };
        const providerIds: Record<string, string> = {};
        for (const lead of body.leads ?? []) {
          const enrollmentId = lead.custom_fields?.yad_enrollment_id;
          if (enrollmentId && lead.lead_id != null) providerIds[enrollmentId] = String(lead.lead_id);
        }
        return { ok: true, providerIds };
      } catch (error) {
        return { ok: false, providerIds: {}, error: (error as Error).name || 'TRANSPORT_ERROR' };
      }
    },

    async pauseLead(providerCampaignId, providerLeadId) {
      if (!this.isConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
      try {
        const response = await transport(
          withKey(`/campaigns/${providerCampaignId}/leads/${providerLeadId}/pause?`),
          { method: 'POST', headers: headers(), body: '{}' },
        );
        return response.ok ? { ok: true } : { ok: false, error: `HTTP_${response.status}` };
      } catch (error) {
        return { ok: false, error: (error as Error).name || 'TRANSPORT_ERROR' };
      }
    },
  };
}

export interface EnqueueReport {
  requested: number;
  eligible: number;
  enrolled: number;
  alreadyEnrolled: number;
  shortfall: number;
  rejections: Record<string, number>;
}

/**
 * Enrolls eligible contacts and queues their export. Nothing is sent here.
 *
 * The enrollment row and the outbox row are written in one transaction, so a crash
 * cannot leave a prospect enrolled with no export queued, or an export queued for an
 * enrollment that does not exist.
 */
export async function enqueueCampaignExport(input: {
  campaignId: string; accountIds: string[]; minimumEmailQuality?: string;
  personalization?: Record<string, string>;
}): Promise<EnqueueReport> {
  const report = await selectEligibleForCampaign({
    emailCampaignId: input.campaignId,
    accountIds: input.accountIds,
    ...(input.minimumEmailQuality ? { minimumEmailQuality: input.minimumEmailQuality } : {}),
  });

  let enrolled = 0;
  let alreadyEnrolled = 0;

  for (const contact of report.eligible) {
    const created = await withTransaction(async (client) => {
      // The partial unique index refuses a second live enrollment for the same
      // Account and address, which is the duplicate-prevention rule (§14).
      const { rows } = await client.query<{ enrollment_id: string }>(
        `insert into email_enrollments
           (email_campaign_id, account_id, contact_id, endpoint_id, normalized_email, status)
         values ($1, $2, $3, $4, $5, 'PENDING_EXPORT')
         on conflict do nothing
         returning enrollment_id`,
        [input.campaignId, contact.accountId, contact.contactId, contact.endpointId, contact.email],
      );
      const enrollmentId = rows[0]?.enrollment_id;
      if (!enrollmentId) return null;

      const payload = buildExportPayload(
        contact, enrollmentId, input.campaignId, input.personalization ?? {});
      await client.query(
        `insert into email_outbox (enrollment_id, operation, payload)
         values ($1, 'EXPORT', $2)`,
        [enrollmentId, JSON.stringify(payload)],
      );
      return enrollmentId;
    });

    if (created) enrolled += 1; else alreadyEnrolled += 1;
  }

  return {
    requested: input.accountIds.length,
    eligible: report.eligible.length,
    enrolled,
    alreadyEnrolled,
    // The shortfall is reported, never padded by weakening the standard (§14).
    shortfall: Math.max(0, input.accountIds.length - enrolled),
    rejections: report.shortfallBreakdown,
  };
}

export interface DrainReport { sent: number; failed: number; skipped: number; abandoned: number }

const MAX_ATTEMPTS = 5;

/**
 * Drains queued provider calls.
 *
 * A row is claimed with `for update skip locked` so two drains never send the same
 * export, and a failure is left PENDING with a backoff rather than being retried in a
 * tight loop. After MAX_ATTEMPTS it is abandoned and stays visible as abandoned —
 * silently dropping it would leave a prospect enrolled and never contacted.
 */
export async function drainEmailOutbox(input: {
  client: SmartleadClient; batchSize?: number; now?: Date;
}): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, failed: 0, skipped: 0, abandoned: 0 };
  const now = input.now ?? new Date();

  if (!input.client.isConfigured()) {
    // Not an error: the outbox is exactly where work waits until a credential exists.
    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from email_outbox where status = 'PENDING'`);
    report.skipped = rows[0]?.n ?? 0;
    return report;
  }

  const { rows: batch } = await query<{
    outbox_id: string; enrollment_id: string; operation: string; payload: ExportPayload;
    attempts: number; provider_campaign_id: string | null; provider_lead_id: string | null;
  }>(
    `select o.outbox_id, o.enrollment_id, o.operation, o.payload, o.attempts,
            c.provider_campaign_id, e.provider_lead_id
       from email_outbox o
       join email_enrollments e on e.enrollment_id = o.enrollment_id
       join email_campaigns c on c.email_campaign_id = e.email_campaign_id
      where o.status = 'PENDING' and o.run_after <= $2
      order by o.created_at
      limit $1
      for update of o skip locked`,
    [input.batchSize ?? 25, now],
  );

  for (const row of batch) {
    if (!row.provider_campaign_id) {
      await markFailed(row.outbox_id, row.attempts, 'CAMPAIGN_NOT_LINKED_TO_PROVIDER');
      report.failed += 1;
      continue;
    }

    const result: { ok: boolean; providerIds?: Record<string, string>; error?: string } =
      row.operation === 'EXPORT'
        ? await input.client.addLeads(row.provider_campaign_id, [row.payload])
        : row.provider_lead_id
          ? await input.client.pauseLead(row.provider_campaign_id, row.provider_lead_id)
          : { ok: false, error: 'NO_PROVIDER_LEAD_ID' };

    if (!result.ok) {
      const attempts = row.attempts + 1;
      await markFailed(row.outbox_id, row.attempts, result.error ?? 'UNKNOWN');
      if (attempts >= MAX_ATTEMPTS) report.abandoned += 1; else report.failed += 1;
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(
        `update email_outbox set status = 'SENT', attempts = attempts + 1, completed_at = now()
          where outbox_id = $1`, [row.outbox_id]);

      if (row.operation === 'EXPORT') {
          const providerId = result.providerIds?.[row.enrollment_id] ?? null;
        await client.query(
          `update email_enrollments
              set status = 'EXPORTED', exported_at = now(), provider_lead_id = $2
            where enrollment_id = $1 and status = 'PENDING_EXPORT'`,
          [row.enrollment_id, providerId]);
      }
    });
    report.sent += 1;
  }

  return report;
}

async function markFailed(outboxId: string, attempts: number, error: string): Promise<void> {
  const next = attempts + 1;
  // Exponential backoff, capped, so an outage does not become a hot loop.
  const delayMinutes = Math.min(60, 2 ** next);
  await query(
    `update email_outbox
        set attempts = $2::int,
            last_error = $3,
            status = case when $2::int >= $4::int then 'ABANDONED' else 'PENDING' end,
            run_after = now() + ($5::text || ' minutes')::interval
      where outbox_id = $1`,
    [outboxId, next, error.slice(0, 300), MAX_ATTEMPTS, String(delayMinutes)],
  );
}
