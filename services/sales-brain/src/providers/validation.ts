import { query } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * Provider credential and entity validation.
 * Authority: CLAUDE-EXTERNAL-BLOCKERS-CURRENT.md §8 — "external credentials should
 * gate only the final provider connection, not architecture".
 *
 * Adding a credential later should be configuration, not a code change. So each
 * validator here answers two separate questions, because they fail differently:
 *
 *   1. does the credential authenticate?
 *   2. does the thing it refers to actually exist?
 *
 * A Cal.com key with no event type is authenticated and useless. A Smartlead key
 * pointing at a campaign that was deleted will accept leads into nothing. Reporting
 * either as simply "connected" is how a pilot discovers the problem on a live call.
 *
 * Every validator takes an injectable transport, so all of this is exercised now,
 * against fixtures, with no credential present.
 */

export type ValidationStatus = 'OK' | 'MISSING_CONFIG' | 'AUTH_FAILED' | 'ENTITY_NOT_FOUND'
  | 'UNREACHABLE' | 'NOT_APPLICABLE';

export interface ValidationCheck {
  id: string;
  status: ValidationStatus;
  /** Operator-facing. Never a provider response body. */
  detail: string;
  /** Config values this check needs and did not find. */
  missing: string[];
}

export interface ProviderValidation {
  provider: string;
  status: ValidationStatus;
  checks: ValidationCheck[];
  missing: string[];
}

export type Transport = (url: string, init: {
  method: string; headers: Record<string, string>; body?: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const liveTransport: Transport = (url, init) =>
  fetch(url, init) as unknown as ReturnType<Transport>;

function absent(name: string, env: NodeJS.ProcessEnv): boolean {
  return (env[name] ?? '').trim().length === 0;
}

function rollUp(provider: string, checks: ValidationCheck[]): ProviderValidation {
  const missing = [...new Set(checks.flatMap((check) => check.missing))];
  // One failing check is not offset by another passing, and the headline is whatever
  // the operator has to fix first: a wrong credential, then something unset, then
  // something set that points at nothing.
  const order: ValidationStatus[] = ['AUTH_FAILED', 'MISSING_CONFIG', 'ENTITY_NOT_FOUND',
    'UNREACHABLE', 'NOT_APPLICABLE', 'OK'];
  const status = order.find((candidate) => checks.some((check) => check.status === candidate))
    ?? 'OK';
  return { provider, status, checks, missing };
}

// ------------------------------------------------------------------- Cal.com --

export async function validateCalcom(options: {
  env?: NodeJS.ProcessEnv; transport?: Transport;
} = {}): Promise<ProviderValidation> {
  const env = options.env ?? process.env;
  const transport = options.transport ?? liveTransport;
  const checks: ValidationCheck[] = [];

  const missing = ['CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'BOOKING_CALENDAR_UPN']
    .filter((name) => absent(name, env));
  if (missing.length > 0) {
    checks.push({ id: 'configuration', status: 'MISSING_CONFIG', missing,
      detail: `Set ${missing.join(', ')} before Cal.com can be validated.` });
    return rollUp('calcom', checks);
  }

  const base = env['CALCOM_BASE_URL'] ?? 'https://api.cal.com/v2';
  const headers = { authorization: `Bearer ${env['CALCOM_API_KEY']}`,
                    'content-type': 'application/json' };

  // 1. does the credential authenticate?
  try {
    const me = await transport(`${base}/me`, { method: 'GET', headers });
    checks.push(me.ok
      ? { id: 'credential', status: 'OK', missing: [],
          detail: 'The API key authenticated.' }
      : { id: 'credential',
          status: me.status === 401 || me.status === 403 ? 'AUTH_FAILED' : 'UNREACHABLE',
          missing: [],
          detail: me.status === 401 || me.status === 403
            ? 'Cal.com rejected the API key.'
            : 'Cal.com did not answer.' });
  } catch {
    checks.push({ id: 'credential', status: 'UNREACHABLE', missing: [],
      detail: 'Cal.com could not be reached.' });
    return rollUp('calcom', checks);
  }
  if (checks.some((check) => check.status !== 'OK')) return rollUp('calcom', checks);

  // 2. does the event type exist, and is it the one bookings are meant to land on?
  const eventTypeId = env['CALCOM_EVENT_TYPE_ID']!;
  try {
    const response = await transport(`${base}/event-types/${encodeURIComponent(eventTypeId)}`,
      { method: 'GET', headers });
    if (!response.ok) {
      checks.push({ id: 'event_type', status: 'ENTITY_NOT_FOUND', missing: [],
        detail: `Cal.com has no event type ${eventTypeId}. An authenticated key pointing at `
          + 'a missing event type books nothing.' });
      return rollUp('calcom', checks);
    }
    const body = await response.json() as {
      data?: { lengthInMinutes?: number; length?: number; title?: string; slug?: string;
               locations?: { type?: string }[] };
    };
    const detail = body.data ?? {};
    const minutes = detail.lengthInMinutes ?? detail.length ?? null;
    checks.push({ id: 'event_type', status: 'OK', missing: [],
      detail: `Event type ${eventTypeId}${detail.title ? ` — ${detail.title}` : ''}`
        + `${minutes ? `, ${minutes} minutes` : ''}.` });

    // The strategy call is fifteen minutes; a different length is a configuration
    // mistake worth naming rather than discovering on a prospect's calendar.
    if (minutes !== null && minutes !== 15) {
      checks.push({ id: 'event_length', status: 'ENTITY_NOT_FOUND', missing: [],
        detail: `The event type is ${minutes} minutes; the strategy call is 15.` });
    }
    const hasVideo = (detail.locations ?? []).some(
      (location) => /cal|video|daily/i.test(location.type ?? ''));
    checks.push(hasVideo
      ? { id: 'meeting_location', status: 'OK', missing: [], detail: 'A video location is set.' }
      : { id: 'meeting_location', status: 'MISSING_CONFIG', missing: ['Cal Video location'],
          detail: 'The event type has no video location, so a booking has nowhere to meet.' });
  } catch {
    checks.push({ id: 'event_type', status: 'UNREACHABLE', missing: [],
      detail: 'The event type could not be read.' });
  }

  return rollUp('calcom', checks);
}

// ---------------------------------------------------------------- DataForSEO --

export async function validateDataForSeo(options: {
  env?: NodeJS.ProcessEnv; transport?: Transport;
} = {}): Promise<ProviderValidation> {
  const env = options.env ?? process.env;
  const transport = options.transport ?? liveTransport;
  const checks: ValidationCheck[] = [];

  const missing = ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'].filter((name) => absent(name, env));
  if (missing.length > 0) {
    checks.push({ id: 'configuration', status: 'MISSING_CONFIG', missing,
      detail: `Set ${missing.join(' and ')} before DataForSEO can be validated.` });
  }

  // The governance review gates discovery independently of the credential, so it is
  // reported as its own check rather than folded into "not configured".
  checks.push(env['DATAFORSEO_GOVERNANCE_REVIEWED'] === 'true'
    ? { id: 'governance_review', status: 'OK', missing: [],
        detail: 'The source governance review is recorded.' }
    : { id: 'governance_review', status: 'MISSING_CONFIG',
        missing: ['DATAFORSEO_GOVERNANCE_REVIEWED'],
        detail: 'The source governance review is not recorded, so discovery may not run even '
          + 'with a working credential.' });

  if (missing.length > 0) return rollUp('dataforseo', checks);

  const base = env['DATAFORSEO_BASE_URL'] ?? 'https://api.dataforseo.com/v3';
  const auth = Buffer.from(`${env['DATAFORSEO_LOGIN']}:${env['DATAFORSEO_PASSWORD']}`)
    .toString('base64');
  try {
    // The balance endpoint is the cheapest way to prove a credential works, and it
    // also tells the operator whether there is money behind it.
    const response = await transport(`${base}/appendix/user_data`,
      { method: 'GET', headers: { authorization: `Basic ${auth}` } });
    if (!response.ok) {
      checks.push({ id: 'credential',
        status: response.status === 401 ? 'AUTH_FAILED' : 'UNREACHABLE', missing: [],
        detail: response.status === 401 ? 'DataForSEO rejected the login.'
          : 'DataForSEO did not answer.' });
      return rollUp('dataforseo', checks);
    }
    const body = await response.json() as { tasks?: { result?: { money?: { balance?: number } }[] }[] };
    const balance = body.tasks?.[0]?.result?.[0]?.money?.balance;
    checks.push({ id: 'credential', status: 'OK', missing: [],
      detail: balance === undefined ? 'The login authenticated.'
        : `The login authenticated; the account balance is ${balance}.` });
    if (typeof balance === 'number' && balance <= 0) {
      checks.push({ id: 'balance', status: 'MISSING_CONFIG', missing: ['provider balance'],
        detail: 'The account has no balance, so no task will run.' });
    }
  } catch {
    checks.push({ id: 'credential', status: 'UNREACHABLE', missing: [],
      detail: 'DataForSEO could not be reached.' });
  }
  return rollUp('dataforseo', checks);
}

// ----------------------------------------------------------------- Smartlead --

export async function validateSmartlead(options: {
  env?: NodeJS.ProcessEnv; transport?: Transport; campaignIds?: string[];
} = {}): Promise<ProviderValidation> {
  const env = options.env ?? process.env;
  const transport = options.transport ?? liveTransport;
  const checks: ValidationCheck[] = [];

  if (absent('SMARTLEAD_API_KEY', env)) {
    checks.push({ id: 'configuration', status: 'MISSING_CONFIG', missing: ['SMARTLEAD_API_KEY'],
      detail: 'Set SMARTLEAD_API_KEY before Smartlead can be validated.' });
    return rollUp('smartlead', checks);
  }

  const base = env['SMARTLEAD_BASE_URL'] ?? 'https://server.smartlead.ai/api/v1';
  const key = env['SMARTLEAD_API_KEY']!;
  let campaigns: { id?: number | string; name?: string }[] = [];
  try {
    const response = await transport(`${base}/campaigns?api_key=${key}`,
      { method: 'GET', headers: { 'content-type': 'application/json' } });
    if (!response.ok) {
      checks.push({ id: 'credential',
        status: response.status === 401 ? 'AUTH_FAILED' : 'UNREACHABLE', missing: [],
        detail: response.status === 401 ? 'Smartlead rejected the API key.'
          : 'Smartlead did not answer.' });
      return rollUp('smartlead', checks);
    }
    const body = await response.json();
    campaigns = Array.isArray(body) ? body : (body as { data?: unknown[] }).data as never ?? [];
    checks.push({ id: 'credential', status: 'OK', missing: [],
      detail: `The API key authenticated; ${campaigns.length} campaign(s) visible.` });
  } catch {
    checks.push({ id: 'credential', status: 'UNREACHABLE', missing: [],
      detail: 'Smartlead could not be reached.' });
    return rollUp('smartlead', checks);
  }

  // Every campaign we hold a provider id for must still exist there. A lead exported
  // into a deleted campaign is a send that never happens and never errors.
  const configured = options.campaignIds ?? await linkedCampaignIds();
  if (configured.length === 0) {
    checks.push({ id: 'campaign_links', status: 'NOT_APPLICABLE', missing: [],
      detail: 'No campaign is linked to a Smartlead campaign yet, so nothing can be sent.' });
    return rollUp('smartlead', checks);
  }
  const known = new Set(campaigns.map((campaign) => String(campaign.id)));
  const orphans = configured.filter((id) => !known.has(String(id)));
  checks.push(orphans.length === 0
    ? { id: 'campaign_links', status: 'OK', missing: [],
        detail: `${configured.length} linked campaign(s) all exist at the provider.` }
    : { id: 'campaign_links', status: 'ENTITY_NOT_FOUND', missing: [],
        detail: `Linked to campaign(s) ${orphans.join(', ')} which do not exist at Smartlead. `
          + 'A lead exported into a deleted campaign is a send that never happens.' });
  return rollUp('smartlead', checks);
}

async function linkedCampaignIds(): Promise<string[]> {
  const { rows } = await query<{ provider_campaign_id: string }>(
    `select distinct provider_campaign_id from email_campaigns
      where provider_campaign_id is not null`);
  return rows.map((row) => row.provider_campaign_id);
}

// -------------------------------------------------------------------- Twilio --

export async function validateTwilio(options: {
  env?: NodeJS.ProcessEnv; transport?: Transport;
} = {}): Promise<ProviderValidation> {
  const env = options.env ?? process.env;
  const transport = options.transport ?? liveTransport;
  const checks: ValidationCheck[] = [];

  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter((name) => absent(name, env));
  if (missing.length > 0) {
    checks.push({ id: 'configuration', status: 'MISSING_CONFIG', missing,
      detail: `Set ${missing.join(' and ')} before Twilio can be validated.` });
  }

  // The approved caller ID is validated whether or not the credential exists, because
  // it is our own configuration and a malformed one is worth catching early.
  checks.push(...validateApprovedCallerIds(env));

  if (missing.length > 0) return rollUp('twilio_voice', checks);

  const sid = env['TWILIO_ACCOUNT_SID']!;
  const auth = Buffer.from(`${sid}:${env['TWILIO_AUTH_TOKEN']}`).toString('base64');
  const base = env['TWILIO_API_BASE_URL'] ?? 'https://api.twilio.com/2010-04-01';
  try {
    const response = await transport(`${base}/Accounts/${encodeURIComponent(sid)}.json`,
      { method: 'GET', headers: { authorization: `Basic ${auth}` } });
    if (!response.ok) {
      checks.push({ id: 'credential',
        status: response.status === 401 ? 'AUTH_FAILED' : 'UNREACHABLE', missing: [],
        detail: response.status === 401 ? 'Twilio rejected the account SID and token.'
          : 'Twilio did not answer.' });
      return rollUp('twilio_voice', checks);
    }
    const body = await response.json() as { status?: string; friendly_name?: string };
    checks.push({ id: 'credential', status: 'OK', missing: [],
      detail: `Authenticated as ${body.friendly_name ?? sid}, account status `
        + `${body.status ?? 'unknown'}.` });
    if (body.status && body.status !== 'active') {
      checks.push({ id: 'account_status', status: 'AUTH_FAILED', missing: [],
        detail: `The Twilio account is ${body.status}, so no call can be placed.` });
    }

    // The caller ID must actually belong to the account, not merely look approved in
    // our own configuration.
    const owned = await transport(
      `${base}/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json`,
      { method: 'GET', headers: { authorization: `Basic ${auth}` } });
    if (owned.ok) {
      const numbersBody = await owned.json() as {
        incoming_phone_numbers?: { phone_number?: string }[];
      };
      const held = new Set((numbersBody.incoming_phone_numbers ?? [])
        .map((row) => (row.phone_number ?? '').replace(/\D+/g, '')));
      const approved = (env['OUTBOUND_APPROVED_CALLER_IDS'] ?? '')
        .split(',').map((value) => value.trim()).filter(Boolean);
      const notHeld = approved.filter((value) => !held.has(value.replace(/\D+/g, '')));
      checks.push(notHeld.length === 0 && approved.length > 0
        ? { id: 'caller_id_ownership', status: 'OK', missing: [],
            detail: 'Every approved caller ID belongs to this Twilio account.' }
        : approved.length === 0
          ? { id: 'caller_id_ownership', status: 'MISSING_CONFIG',
              missing: ['OUTBOUND_APPROVED_CALLER_IDS'],
              detail: 'No approved caller ID is configured to check.' }
          : { id: 'caller_id_ownership', status: 'ENTITY_NOT_FOUND', missing: [],
              detail: `${notHeld.join(', ')} is not a number on this Twilio account.` });
    }
  } catch {
    checks.push({ id: 'credential', status: 'UNREACHABLE', missing: [],
      detail: 'Twilio could not be reached.' });
  }
  return rollUp('twilio_voice', checks);
}

/**
 * Approved caller IDs, checked as configuration.
 *
 * Only a YAD-controlled number may be presented, and no local number may be rotated
 * to fake proximity. That rule is enforced in the dial controller; this catches the
 * configuration mistakes that would make it unenforceable.
 */
export function validateApprovedCallerIds(env: NodeJS.ProcessEnv = process.env): ValidationCheck[] {
  const raw = (env['OUTBOUND_APPROVED_CALLER_IDS'] ?? '').trim();
  if (!raw) {
    return [{ id: 'approved_caller_ids', status: 'MISSING_CONFIG',
      missing: ['OUTBOUND_APPROVED_CALLER_IDS'],
      detail: 'No approved caller ID is configured, so no outbound call can be created.' }];
  }
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const malformed = values.filter((value) => !normalizePhone(value));
  if (malformed.length > 0) {
    return [{ id: 'approved_caller_ids', status: 'MISSING_CONFIG', missing: [],
      detail: `Not a dialable number: ${malformed.join(', ')}.` }];
  }
  if (values.length > 3) {
    // A long list of caller IDs is what number rotation looks like.
    return [{ id: 'approved_caller_ids', status: 'MISSING_CONFIG', missing: [],
      detail: `${values.length} approved caller IDs are configured. Rotating numbers to `
        + 'simulate proximity is not permitted; keep the list to the numbers YAD really uses.' }];
  }
  return [{ id: 'approved_caller_ids', status: 'OK', missing: [],
    detail: `${values.length} approved caller ID(s): ${values.join(', ')}.` }];
}

// ----------------------------------------------------------------------- DNC --

export async function validateDncProvider(options: {
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ProviderValidation> {
  const env = options.env ?? process.env;
  const checks: ValidationCheck[] = [];

  const provider = (env['DNC_PROVIDER'] ?? '').trim();
  if (!provider) {
    checks.push({ id: 'configuration', status: 'MISSING_CONFIG', missing: ['DNC_PROVIDER'],
      detail: 'No DNC screening provider is selected, so no number can be cleared for AI voice.' });
    return rollUp('dnc', checks);
  }
  const credentialVar = (env['DNC_SUBSCRIPTION_CREDENTIAL_ENV'] ?? '').trim();
  checks.push(credentialVar && !absent(credentialVar, env)
    ? { id: 'credential', status: 'OK', missing: [],
        detail: `A subscription credential is present in ${credentialVar}.` }
    : { id: 'credential', status: 'MISSING_CONFIG',
        missing: credentialVar ? [credentialVar] : ['DNC_SUBSCRIPTION_CREDENTIAL_ENV'],
        detail: 'No subscription credential is available to download the registry.' });

  const { rows } = await query<{ state: string; downloaded_at: Date }>(
    `select state, downloaded_at from dnc_snapshots where state = 'CURRENT'`);
  checks.push(rows[0]
    ? { id: 'snapshot', status: 'OK', missing: [],
        detail: `A current snapshot downloaded ${rows[0].downloaded_at.toISOString()}.` }
    : { id: 'snapshot', status: 'ENTITY_NOT_FOUND', missing: [],
        detail: 'No registry snapshot has been ingested, so a required screen fails closed.' });

  const subscriptions = await query<{ n: number }>(
    `select count(*)::int as n from dnc_subscriptions where status = 'ACTIVE'`);
  checks.push((subscriptions.rows[0]?.n ?? 0) > 0
    ? { id: 'subscription', status: 'OK', missing: [], detail: 'An active subscription is on file.' }
    : { id: 'subscription', status: 'MISSING_CONFIG', missing: ['DNC subscription record'],
        detail: 'No active subscription record, so no area code is in scope.' });

  return rollUp('dnc', checks);
}

/** Every provider, for the settings page and the release report. */
export async function validateAllProviders(options: {
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ProviderValidation[]> {
  const env = options.env ?? process.env;
  return [
    await validateCalcom({ env }),
    await validateDataForSeo({ env }),
    await validateSmartlead({ env }),
    await validateTwilio({ env }),
    await validateDncProvider({ env }),
  ];
}
