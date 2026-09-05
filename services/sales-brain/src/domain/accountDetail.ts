import { query } from '../db/pool.js';
import type { Role } from './auth.js';

/**
 * Account detail read model.
 * Authority: rep-portal-api-contract.v1.md §7, rep-inventory-contract.v1.yaml account_detail,
 * SALES-TEAM-ACCESS-CURRENT.md §8.
 *
 * Two rules shape every field below:
 *   - confirmed fact and hypothesis are returned in separate places and never merged;
 *   - a missing endpoint or a missing person is returned as missing, never as a negative
 *     fact and never filled in with something weaker wearing a stronger label.
 */

export interface DetailContact {
  contact_id: string;
  full_name: string | null;
  raw_title: string | null;
  role_category: string;
  company_relationship: string;
  role_confidence: string;
  employer_match: string;
  currentness: string;
  role_match: string;
  is_role_placeholder: boolean;
  decision_maker_priority: number;
  source_provider: string | null;
  source_reference: string | null;
  last_verified_at: Date | null;
  endpoints: DetailEndpoint[];
}

export interface DetailEndpoint {
  endpoint_id: string;
  endpoint_type: 'PHONE' | 'EMAIL';
  display_value: string;
  normalized_value: string;
  extension: string | null;
  endpoint_role: string;
  quality_state: string;
  relationship_to_person: string;
  endpoint_source: string;
  source_reference: string | null;
  observed_at: Date | null;
  verified_at: Date | null;
  is_suppressed: boolean;
  is_active: boolean;
  contact_id: string | null;
  line_type: string;
  human_manual_call: string;
  autonomous_ai_voice: string;
  eligibility_reason_codes: string[];
  next_human_eligible_at: Date | null;
}

export interface DetailEvidence {
  evidence_id: string;
  category: string;
  claim_key: string;
  claim_text: string;
  normalized_value: string | null;
  confidence: string;
  can_state_as_fact: boolean;
  source_type: string;
  source_reference: string | null;
  observed_at: Date;
  expires_at: Date | null;
  is_expired: boolean;
}

/**
 * How we came to know this company exists.
 *
 * Every discovery has been written to `search_observations` since the miner was
 * built, and nothing has ever read it back: a rep could see that an Account was
 * "discovered" and never what the search was, where the company sat on the page or
 * what its ad actually said. That last one is the sentence a rep opens a call with,
 * and it was in the database the whole time.
 */
export interface DetailDiscovery {
  observation_id: string;
  provider: string;
  query: string | null;
  result_type: string | null;
  position: number | null;
  ad_headline: string | null;
  advertised_service: string | null;
  landing_url: string | null;
  observed_at: Date;
}

export interface TimelineEvent {
  activity_id: number;
  activity_type: string;
  channel: string | null;
  disposition: string | null;
  occurred_at: Date;
  notes: string | null;
  actor_name: string | null;
}

export interface AccountDetail {
  account: Record<string, any>;
  locations: Record<string, any>[];
  contacts: DetailContact[];
  accountEndpoints: DetailEndpoint[];
  hypotheses: Record<string, any>[];
  evidence: DetailEvidence[];
  discoveries: DetailDiscovery[];
  timeline: TimelineEvent[];
  followUps: Record<string, any>[];
  suppressions: Record<string, any>[];
  ownershipEvents: Record<string, any>[];
  prohibitedClaims: string[];
  suggestedFirstQuestion: string | null;
  canWork: boolean;
}

/**
 * Claims a rep must not make on a cold call. Two sources: the vertical profile's own
 * must_not_claim list, plus anything derivable from the fact that we have not observed it.
 */
async function prohibitedClaimsFor(
  accountId: string, verticalProfileId: string | null,
): Promise<string[]> {
  const claims = new Set<string>([
    'Do not state their ad spend — we observe that ads exist, not what they cost.',
    'Do not state a missed-call rate, close rate or revenue figure they have not given you.',
    'Do not assert which CRM or phone system they run unless they said so.',
    'Do not position this as replacing their staff.',
  ]);

  if (verticalProfileId) {
    const { rows } = await query<{ definition: any }>(
      'select definition from vertical_profiles where vertical_profile_id = $1', [verticalProfileId],
    );
    const profile = rows[0]?.definition?.profile;
    for (const hypothesis of profile?.opportunity_hypotheses ?? []) {
      for (const item of hypothesis?.must_not_claim ?? []) {
        claims.add(humanizeClaim(String(item)));
      }
    }
  }

  // If the only advertising evidence has expired, the rep must not speak in present tense.
  const { rows: staleAds } = await query<{ n: number }>(
    `select count(*)::int as n from evidence_records
      where account_id = $1 and claim_key in
            ('active_google_search_ad','active_local_service_ad','active_meta_ad')
        and contradicted_by_evidence_id is null
        and expires_at is not null and expires_at <= now()`,
    [accountId],
  );
  const { rows: freshAds } = await query<{ n: number }>(
    `select count(*)::int as n from evidence_records
      where account_id = $1 and claim_key in
            ('active_google_search_ad','active_local_service_ad','active_meta_ad')
        and contradicted_by_evidence_id is null
        and (expires_at is null or expires_at > now())`,
    [accountId],
  );
  if (staleAds[0]!.n > 0 && freshAds[0]!.n === 0) {
    claims.add('Advertising evidence has expired — do not say they are "currently running ads".');
  }

  return [...claims];
}

function humanizeClaim(token: string): string {
  return `Do not claim: ${token.replace(/_/g, ' ')}.`;
}

export async function getAccountDetail(
  accountId: string, viewer: { userId: string; role: Role },
): Promise<AccountDetail | null> {
  const { rows: accountRows } = await query('select * from prospect_inventory where account_id = $1', [
    accountId,
  ]);
  const account = accountRows[0];
  if (!account) return null;

  const [
    locations, contactRows, endpointRows, hypotheses, evidence, discoveries, timeline, followUps,
    suppressions, ownershipEvents,
  ] = await Promise.all([
    query('select * from locations where account_id = $1 order by is_headquarters desc, created_at', [accountId]),
    query<DetailContact>(
      `select contact_id, full_name, raw_title, role_category, company_relationship, role_confidence,
              employer_match, currentness, role_match, is_role_placeholder, decision_maker_priority,
              source_provider, source_reference, last_verified_at
         from contacts where account_id = $1 and status = 'ACTIVE'
        order by decision_maker_priority asc, created_at asc`,
      [accountId],
    ),
    query<DetailEndpoint>(
      `select endpoint_id, endpoint_type, display_value, normalized_value, extension, endpoint_role,
              quality_state, relationship_to_person, endpoint_source, source_reference,
              observed_at, verified_at, is_suppressed, is_active, contact_id,
              line_type, human_manual_call, autonomous_ai_voice, eligibility_reason_codes,
              next_human_eligible_at
         from contact_endpoints where account_id = $1
        order by
          case endpoint_role
            when 'DIRECT_BUSINESS_LINE' then 1 when 'EXTENSION' then 2
            when 'MOBILE_ASSERTED_BUSINESS' then 3 when 'MAIN_BUSINESS_LINE' then 4
            when 'DIRECT_PERSON_EMAIL' then 1 when 'ROLE_EMAIL' then 5
            else 6 end,
          created_at`,
      [accountId],
    ),
    query(
      `select * from opportunity_hypotheses where account_id = $1 and is_current
        order by priority asc, generated_at desc`,
      [accountId],
    ),
    query<DetailEvidence>(
      `select evidence_id, category, claim_key, claim_text, normalized_value, confidence,
              can_state_as_fact, source_type, source_reference, observed_at, expires_at,
              (expires_at is not null and expires_at <= now()) as is_expired
         from evidence_records
        -- Including anything merged into this Account: the two append-only ledgers
        -- keep pointing at the record they were written against, so history is
        -- followed rather than rewritten.
        where account_id = any(select account_id from merged_chain($1))
          and contradicted_by_evidence_id is null
        order by observed_at desc limit 60`,
      [accountId],
    ),
    query<DetailDiscovery>(
      `select observation_id, provider, query, result_type, position, ad_headline,
              advertised_service, landing_url, observed_at
         from search_observations
        where account_id = any(select account_id from merged_chain($1))
          and source_type = 'discovery'
        order by observed_at desc limit 12`,
      [accountId],
    ),
    query<TimelineEvent>(
      `select a.activity_id, a.activity_type, a.channel, a.disposition, a.occurred_at, a.notes,
              u.display_name as actor_name
         from activities a left join users u on u.user_id = a.actor_user_id
        where a.account_id = $1 order by a.occurred_at desc limit 60`,
      [accountId],
    ),
    query(
      `select f.*, u.display_name as owner_name from follow_ups f
         left join users u on u.user_id = f.owner_user_id
        where f.account_id = $1 and f.status = 'OPEN' order by f.due_at asc`,
      [accountId],
    ),
    query('select * from suppressions where account_id = $1 and is_active order by created_at desc', [accountId]),
    query(
      `select e.*, actor.display_name as actor_name, prev.display_name as previous_owner_name,
              next.display_name as new_owner_name
         from ownership_events e
         left join users actor on actor.user_id = e.actor_user_id
         left join users prev  on prev.user_id  = e.previous_owner_user_id
         left join users next  on next.user_id  = e.new_owner_user_id
        where e.account_id = any(select account_id from merged_chain($1))
        order by e.occurred_at desc limit 20`,
      [accountId],
    ),
  ]);

  const contacts: DetailContact[] = contactRows.rows.map((contact) => ({
    ...contact,
    endpoints: endpointRows.rows.filter((endpoint) => endpoint.contact_id === contact.contact_id),
  }));
  const accountEndpoints = endpointRows.rows.filter((endpoint) => endpoint.contact_id === null);

  const firstQuestion: string | null = hypotheses.rows[0]?.missing_fact_questions?.[0] ?? null;

  const canWork =
    account.current_owner_user_id === viewer.userId ||
    viewer.role === 'SALES_MANAGER' || viewer.role === 'ADMIN';

  return {
    account,
    locations: locations.rows,
    contacts,
    accountEndpoints,
    hypotheses: hypotheses.rows,
    evidence: evidence.rows,
    discoveries: discoveries.rows,
    timeline: timeline.rows,
    followUps: followUps.rows,
    suppressions: suppressions.rows,
    ownershipEvents: ownershipEvents.rows,
    prohibitedClaims: await prohibitedClaimsFor(accountId, account.primary_vertical_profile_id),
    suggestedFirstQuestion: firstQuestion,
    canWork,
  };
}

/**
 * Plain-language labels for endpoint semantics. The rep UI must never show a bare
 * green tick with no meaning (endpoint-quality-spec §21).
 */
export function endpointLabel(endpoint: DetailEndpoint): { label: string; tone: 'good' | 'neutral' | 'warn' | 'bad' } {
  if (endpoint.is_suppressed || endpoint.quality_state === 'SUPPRESSED') {
    return { label: 'Suppressed — do not use', tone: 'bad' };
  }
  switch (endpoint.quality_state) {
    case 'WRONG_NUMBER': return { label: 'Wrong number — do not use', tone: 'bad' };
    case 'DISCONNECTED': return { label: 'Disconnected', tone: 'bad' };
    case 'HARD_BOUNCE': return { label: 'Hard bounced — do not send', tone: 'bad' };
    case 'GUESSED_UNVERIFIED': return { label: 'Guessed pattern — not outreach ready', tone: 'warn' };
    case 'DIRECT_BUSINESS_CONFIRMED': return { label: 'Direct line — published by the business', tone: 'good' };
    case 'CURRENT_BUSINESS_CONFIRMED': return { label: 'Official business line — current', tone: 'good' };
    case 'PROVIDER_ASSERTED_CURRENT': return { label: 'Direct line — provider asserted', tone: 'neutral' };
    case 'PROVIDER_VERIFIED': return { label: 'Provider verified', tone: 'neutral' };
    case 'YAD_CONFIRMED_DELIVERABLE': return { label: 'Confirmed deliverable', tone: 'good' };
    case 'PUBLIC_OBSERVED_CURRENT': return { label: 'Published on the company site', tone: 'good' };
    case 'PUBLIC_OBSERVED_UNVERIFIED': return { label: 'Publicly listed — not verified by us', tone: 'neutral' };
    case 'DOMAIN_VALID_UNVERIFIED': return { label: 'Domain valid — address not verified', tone: 'neutral' };
    case 'STALE': return { label: 'Stale — refresh before relying on it', tone: 'warn' };
    default: return { label: 'Unverified', tone: 'neutral' };
  }
}

export function endpointRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    MAIN_BUSINESS_LINE: 'Main line',
    DIRECT_BUSINESS_LINE: 'Direct line',
    LOCATION_BUSINESS_LINE: 'Location line',
    EXTENSION: 'Extension',
    MOBILE_ASSERTED_BUSINESS: 'Mobile (business)',
    MOBILE_UNKNOWN_USE: 'Mobile (use unknown)',
    TOLL_FREE_BUSINESS: 'Toll-free',
    CALL_TRACKING_NUMBER: 'Tracking number',
    DIRECT_PERSON_EMAIL: 'Personal work email',
    ROLE_EMAIL: 'Role mailbox',
    GENERAL_BUSINESS_EMAIL: 'General mailbox',
    LOCATION_EMAIL: 'Location mailbox',
  };
  return labels[role] ?? 'Unknown';
}
