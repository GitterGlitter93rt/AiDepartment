import { query } from '../db/pool.js';
import { registerHandler, type JobRecord, type JobResult } from './runner.js';
import {
  enqueueAccountResearch, enqueueAlternativeSourceResearch, enqueueDomainResolution,
  enqueueWebsiteRecovery,
} from './enqueue.js';
import { judgeDomain } from '../domain/domainValidity.js';
import { numeric } from '../config.js';
import {
  crossDomainDestination, isTerminalForDomain, probeVariant, urlVariants,
  type ProbeOutcome,
} from '../resolver/recovery.js';
import { registrableDomain } from '../discovery/sourceClass.js';

/**
 * The hourly retry of a website we could not read.
 *
 * V2 settled that a failed fetch is never evidence against a company, and then left 53
 * Accounts unreadable for ever because research ran once. This is the other half: try
 * again, a bounded number of times, from a row in the database rather than a timer in a
 * process that the next deployment will replace.
 *
 * Nothing here defeats a refusal. A 403, a challenge page and a robots disallow are
 * answers; the only mechanism relied on is that a site's own state may change between
 * one hour and the next.
 */

/**
 * Read at call time rather than captured at import, for the reason `dailyBudgetUsd`
 * gives: a value frozen at module load ignores anything set after the process started,
 * and no test can vary it.
 */
export function recoveryMaxAttempts(): number {
  return numeric('WEBSITE_RECOVERY_MAX_ATTEMPTS', 10, { min: 1, max: 24 });
}
export function recoveryIntervalMs(): number {
  return numeric('WEBSITE_RECOVERY_INTERVAL_MS', 60 * 60_000, { min: 1000 });
}

/** Source states worth trying again. Every one of them is about our access, not them. */
export const RECOVERABLE_STATES: ReadonlySet<string> = new Set([
  'REFUSED', 'UNREACHABLE', 'HTTP_ERROR', 'TLS_ERROR', 'DNS_ERROR', 'TIMEOUT',
  'ANTI_BOT', 'UNKNOWN_FETCH_FAILURE',
]);

export interface CampaignRow {
  campaign_id: string;
  account_id: string;
  original_url: string | null;
  state: string;
  attempts_made: number;
  max_attempts: number;
}

/**
 * Starts a campaign, or joins the one already running.
 *
 * The unique partial index on ACTIVE campaigns is what makes this safe to call from a
 * sweep, from a research handler and from a backfill at the same time: the second
 * caller conflicts, reads the existing row, and schedules nothing new.
 */
export async function openCampaign(input: {
  accountId: string; url: string | null; sourceState: string;
}): Promise<{ campaignId: string; created: boolean } | null> {
  // robots.txt is an instruction, not an obstacle. There is nothing to retry.
  if (input.sourceState === 'DISALLOWED') return null;
  if (!RECOVERABLE_STATES.has(input.sourceState)) return null;
  if (!input.url || !urlVariants(input.url).length) return null;

  /**
   * A reserved name is not a website, so there is nothing to recover.
   *
   * proofroof.invalid is on a live Account. Ten hours of hourly DNS lookups against a
   * name RFC 2606 guarantees will never resolve is the clearest possible waste, and the
   * Account's real problem -- it has no website at all -- is a different job.
   */
  const domain = judgeDomain(input.url);
  if (!domain.worthRecovering) {
    await enqueueDomainResolution({ accountId: input.accountId,
      reason: `the stored domain is not usable: ${domain.reason}` });
    return null;
  }

  const { rows } = await query<{ campaign_id: string }>(
    `insert into website_recovery_campaigns
       (account_id, original_url, state, max_attempts, next_attempt_at)
     values ($1, $2, 'ACTIVE', $3, now())
     on conflict (account_id) where state = 'ACTIVE' do nothing
     returning campaign_id`,
    [input.accountId, input.url, recoveryMaxAttempts()],
  );

  if (rows[0]) {
    await enqueueWebsiteRecovery({
      campaignId: rows[0].campaign_id, accountId: input.accountId, attemptNumber: 1 });
    return { campaignId: rows[0].campaign_id, created: true };
  }

  const existing = await query<{ campaign_id: string }>(
    `select campaign_id from website_recovery_campaigns
      where account_id = $1 and state = 'ACTIVE' limit 1`, [input.accountId]);
  return existing.rows[0] ? { campaignId: existing.rows[0].campaign_id, created: false } : null;
}

async function closeCampaign(campaignId: string, state: string, reason: string,
                             extra: Record<string, unknown> = {}): Promise<void> {
  await query(
    `update website_recovery_campaigns
        set state = $2, outcome_reason = $3, completed_at = now(), next_attempt_at = null,
            recovered_url = coalesce($4, recovered_url),
            recovered_on_attempt = coalesce($5, recovered_on_attempt),
            candidate_domain = coalesce($6, candidate_domain),
            candidate_basis = coalesce($7, candidate_basis),
            updated_at = now()
      where campaign_id = $1`,
    [campaignId, state, reason.slice(0, 600), extra.recoveredUrl ?? null,
     extra.recoveredOnAttempt ?? null, extra.candidateDomain ?? null,
     extra.candidateBasis ?? null],
  );
}

async function recordAttempt(campaign: CampaignRow, attemptNumber: number,
                             outcome: ProbeOutcome): Promise<void> {
  await query(
    `insert into website_recovery_attempts
       (campaign_id, account_id, attempt_number, variant, requested_url, final_url,
        redirect_chain, http_status, source_state, failure_reason, dns_result,
        tls_result, content_type, bytes_received)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
     on conflict (campaign_id, attempt_number, requested_url) do nothing`,
    [campaign.campaign_id, campaign.account_id, attemptNumber, outcome.variant,
     outcome.requestedUrl, outcome.finalUrl, JSON.stringify(outcome.redirectChain),
     outcome.httpStatus, outcome.sourceState, outcome.failureReason, outcome.dnsResult,
     outcome.tlsResult, outcome.contentType, outcome.bytesReceived],
  );
}

/**
 * One attempt: every candidate host, in order, stopping at the first that reads.
 *
 * Every probe is recorded even after one succeeds, because "apex failed and www worked"
 * is the fact a rep and an operator both need, and discarding the failures would leave
 * the recovery looking like the original URL had simply started working.
 */
export async function runAttempt(campaign: CampaignRow, attemptNumber: number): Promise<{
  outcomes: ProbeOutcome[]; read: ProbeOutcome | null;
}> {
  const outcomes: ProbeOutcome[] = [];
  let read: ProbeOutcome | null = null;

  for (const target of urlVariants(campaign.original_url)) {
    const outcome = await probeVariant(target);
    outcomes.push(outcome);
    await recordAttempt(campaign, attemptNumber, outcome);

    // robots.txt refusing one host refuses the site. Stop asking.
    if (outcome.sourceState === 'DISALLOWED') break;
    if (outcome.sourceState === 'READ') { read = outcome; break; }
  }
  return { outcomes, read };
}

/** Whether the last two attempts both said the domain has nothing at this path. */
async function domainLooksDead(campaignId: string, attemptNumber: number): Promise<boolean> {
  if (attemptNumber < 2) return false;
  const { rows } = await query<{ attempt_number: number; http_status: number | null }>(
    `select attempt_number, http_status from website_recovery_attempts
      where campaign_id = $1 and attempt_number >= $2`,
    [campaignId, attemptNumber - 1],
  );
  const byAttempt = new Map<number, (number | null)[]>();
  for (const row of rows) {
    const bucket = byAttempt.get(row.attempt_number) ?? [];
    bucket.push(row.http_status);
    byAttempt.set(row.attempt_number, bucket);
  }
  if (byAttempt.size < 2) return false;
  return [...byAttempt.values()].every((statuses) =>
    statuses.length > 0 && statuses.every((s) => s === 404 || s === 410));
}

registerHandler('website_recovery', async (job: JobRecord): Promise<JobResult> => {
  const campaignId = String(job.payload['campaign_id'] ?? '');
  const attemptNumber = Number(job.payload['attempt_number'] ?? 0);
  if (!campaignId) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'no campaign named' };

  const { rows } = await query<CampaignRow>(
    `select campaign_id, account_id, original_url, state, attempts_made, max_attempts
       from website_recovery_campaigns where campaign_id = $1`, [campaignId]);
  const campaign = rows[0];
  if (!campaign) {
    return { outcome: 'NOTHING_TO_DO', outcomeReason: 'the campaign no longer exists' };
  }
  if (campaign.state !== 'ACTIVE') {
    // A success on an earlier attempt closes the campaign; a job already queued for the
    // next hour then arrives and must do nothing rather than restart it.
    return { outcome: 'NOTHING_TO_DO',
      outcomeReason: `the campaign is ${campaign.state}, so this attempt was not made` };
  }

  const attempt = attemptNumber > 0 ? attemptNumber : campaign.attempts_made + 1;
  const { outcomes, read } = await runAttempt(campaign, attempt);

  await query(
    `update website_recovery_campaigns
        set attempts_made = greatest(attempts_made, $2),
            last_source_state = $3, last_failure_reason = $4, updated_at = now()
      where campaign_id = $1`,
    [campaignId, attempt, outcomes[outcomes.length - 1]?.sourceState ?? null,
     outcomes[outcomes.length - 1]?.failureReason ?? null],
  );

  if (read) {
    const moved = crossDomainDestination(campaign.original_url, read);
    await closeCampaign(campaignId, 'RECOVERED',
      `Read on attempt ${attempt} via ${read.variant} (${read.requestedUrl}).`,
      { recoveredUrl: read.finalUrl ?? read.requestedUrl, recoveredOnAttempt: attempt,
        candidateDomain: moved,
        candidateBasis: moved
          ? `a redirect from ${registrableDomain(campaign.original_url ?? '') ?? 'the stored domain'} `
            + 'landed here; it is a candidate and needs corroboration before it becomes '
            + "the Account's website"
          : null });

    // Now actually read the site. Recovery proves a host answers; research is what
    // turns that into identity, locations and contact routes.
    await enqueueAccountResearch(campaign.account_id, null, 'website_recovered');
    return { outcome: 'COMPLETED',
      outcomeReason: `Website recovered on attempt ${attempt} (${read.variant}).` };
  }

  if (outcomes.some((o) => o.sourceState === 'DISALLOWED')) {
    await closeCampaign(campaignId, 'DISALLOWED',
      'robots.txt asks us not to read this site. That is an instruction, not an '
      + 'obstacle, so the campaign stops here and the Account goes to alternative '
      + 'public sources. It is not evidence about the company.');
    await enqueueAlternativeSourceResearch({ accountId: campaign.account_id,
      reason: 'robots.txt disallows first-party research' });
    return { outcome: 'COMPLETED', outcomeReason: 'robots.txt disallows; campaign ended' };
  }

  if (isTerminalForDomain(outcomes) && await domainLooksDead(campaignId, attempt)) {
    await closeCampaign(campaignId, 'TERMINAL',
      'Every candidate host answered 404 or 410 on two separate attempts, so this '
      + 'domain has nothing at this address. Asking it again hourly would teach us '
      + 'nothing; finding where the company went might.');
    await enqueueDomainResolution({ accountId: campaign.account_id,
      reason: 'the stored domain answers 404/410 on every host' });
    return { outcome: 'COMPLETED',
      outcomeReason: 'the domain is dead; replacement-domain research queued' };
  }

  if (attempt >= campaign.max_attempts) {
    await closeCampaign(campaignId, 'EXHAUSTED',
      `We could not read this website in ${campaign.max_attempts} attempts over `
      + `${campaign.max_attempts} hours. That is a fact about our research, not about `
      + 'the company: the Account keeps its trade, its name and its place in inventory, '
      + 'and goes to alternative public sources and review.');
    await enqueueAlternativeSourceResearch({ accountId: campaign.account_id,
      reason: `the site refused ${campaign.max_attempts} ordinary attempts` });
    return { outcome: 'COMPLETED',
      outcomeReason: `campaign exhausted after ${campaign.max_attempts} attempts` };
  }

  const next = new Date(Date.now() + recoveryIntervalMs());
  await query(
    `update website_recovery_campaigns set next_attempt_at = $2, updated_at = now()
      where campaign_id = $1 and state = 'ACTIVE'`, [campaignId, next]);
  await enqueueWebsiteRecovery({ campaignId, accountId: campaign.account_id,
    attemptNumber: attempt + 1, runAfter: next });

  return { outcome: 'PARTIAL',
    outcomeReason: `Attempt ${attempt} of ${campaign.max_attempts} could not read the `
      + `site (${outcomes[outcomes.length - 1]?.sourceState ?? 'no result'}). Next `
      + `attempt at ${next.toISOString()}.` };
});

/**
 * Campaigns that should be running and are not.
 *
 * Two jobs: start one for every Account sitting in a recoverable state without a
 * campaign, and re-queue an active campaign whose next attempt came due while nothing
 * was serving it. The second is what a crash between "schedule the next attempt" and
 * "commit" leaves behind, and without it a campaign would stall silently at attempt
 * three for ever -- the exact shape of failure this feature exists to remove.
 */
export async function sweepWebsiteRecovery(limit = 200): Promise<{
  opened: number; requeued: number;
}> {
  const due = await query<{ campaign_id: string; account_id: string; attempts_made: number }>(
    `select c.campaign_id, c.account_id, c.attempts_made
       from website_recovery_campaigns c
      where c.state = 'ACTIVE' and c.next_attempt_at <= now()
        and not exists (
          select 1 from jobs j
           where j.job_type = 'website_recovery'
             and j.status in ('QUEUED','RUNNING')
             and j.payload->>'campaign_id' = c.campaign_id::text)
      limit $1`, [limit]);

  let requeued = 0;
  for (const row of due.rows) {
    const result = await enqueueWebsiteRecovery({ campaignId: row.campaign_id,
      accountId: row.account_id, attemptNumber: row.attempts_made + 1 });
    if (result.created) requeued += 1;
  }

  const candidates = await query<{ account_id: string; url: string | null; st: string }>(
    `with latest as (
       select distinct on (account_id) account_id,
              adapter_results->>'source_state' as st
         from research_runs where account_id is not null
        order by account_id, started_at desc)
     select a.account_id, a.canonical_domain as url, latest.st
       from latest
       join accounts a on a.account_id = latest.account_id
      where latest.st = any($1::text[])
        and a.canonical_domain is not null
        and not exists (select 1 from website_recovery_campaigns c
                         where c.account_id = a.account_id and c.state = 'ACTIVE')
        and not exists (select 1 from website_recovery_campaigns c
                         where c.account_id = a.account_id
                           and c.completed_at > now() - interval '7 days')
      limit $2`,
    [[...RECOVERABLE_STATES], limit]);

  let opened = 0;
  for (const row of candidates.rows) {
    const started = await openCampaign({
      accountId: row.account_id, url: row.url, sourceState: row.st });
    if (started?.created) opened += 1;
  }
  return { opened, requeued };
}
