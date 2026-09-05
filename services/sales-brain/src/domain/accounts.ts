import type pg from 'pg';
import { query, withTransaction, type Queryable } from '../db/pool.js';
import {
  classifyEmail, extractExtension, formatPhoneDisplay, normalizeCity, normalizeCompanyName,
  normalizeEmail, normalizeHostname, normalizePhone, normalizePostalCode, normalizeState,
  splitPersonName,
} from './normalize.js';

/**
 * Account identity resolution and upsert.
 * Authority: outbound-sales-brain-data-contract.md §35 (match order),
 * rep-ownership-data-model.md §20 (duplicate discovery must yield ONE Account).
 *
 * Discovery from a new source must never create a second record for a company that
 * already exists, and must never reset ownership or suppression on the one that does.
 */

export interface AccountInput {
  canonicalName: string;
  legalName?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  timezone?: string | null;
  verticalProfileId?: string | null;
  industryCode?: string | null;
  accountType?: string | null;
  /** Provider-native identity, when the source exposes a stable one. */
  sourceIdentity?: { provider: string; entityType: string; nativeId: string; retentionClass?: string } | null;
  contactName?: string | null;
  contactTitle?: string | null;
}

export type MatchRule =
  | 'source_identity'
  | 'domain'
  | 'phone_and_name'
  | 'address_and_name'
  | 'normalized_name_and_geography'
  | 'created';

export interface ResolveResult {
  accountId: string;
  created: boolean;
  matchRule: MatchRule;
}

/**
 * Finds the existing Account for this input, in the precedence order the data
 * contract specifies. Returns null when nothing matches confidently enough —
 * a weak match must create a review case, never an automatic merge.
 */
export async function resolveAccountIdentity(
  client: Queryable,
  input: AccountInput,
): Promise<{ accountId: string; matchRule: MatchRule } | null> {
  // 1. Exact provider-native identity mapping.
  if (input.sourceIdentity) {
    const { rows } = await client.query<{ account_id: string }>(
      `select account_id from source_identities
        where provider = $1 and provider_entity_type = $2 and provider_native_id = $3`,
      [input.sourceIdentity.provider, input.sourceIdentity.entityType, input.sourceIdentity.nativeId],
    );
    if (rows[0]) return { accountId: rows[0].account_id, matchRule: 'source_identity' };
  }

  // 2. Exact normalized domain.
  const hostname = normalizeHostname(input.website);
  if (hostname) {
    const { rows } = await client.query<{ account_id: string }>(
      `select account_id from accounts where canonical_domain = $1
       union
       select account_id from account_domains where hostname = $1 and domain_role = 'primary'
       limit 1`,
      [hostname],
    );
    if (rows[0]) return { accountId: rows[0].account_id, matchRule: 'domain' };
  }

  const normalizedName = normalizeCompanyName(input.canonicalName);

  // 3. Exact normalized business phone + compatible name.
  const phone = normalizePhone(input.phone);
  if (phone && normalizedName) {
    const { rows } = await client.query<{ account_id: string; normalized_name: string }>(
      `select distinct a.account_id, a.normalized_name
         from contact_endpoints e
         join accounts a on a.account_id = e.account_id
        where e.endpoint_type = 'PHONE' and e.normalized_value = $1`,
      [phone],
    );
    for (const row of rows) {
      // A shared main line is common in strip malls and answering services, so the
      // name must also be compatible before the phone is allowed to merge identities.
      if (namesAreCompatible(row.normalized_name, normalizedName)) {
        return { accountId: row.account_id, matchRule: 'phone_and_name' };
      }
    }
  }

  // 4. Exact address + strong name similarity.
  const postal = normalizePostalCode(input.postalCode);
  if (input.addressLine1 && postal && normalizedName) {
    const { rows } = await client.query<{ account_id: string; normalized_name: string }>(
      `select a.account_id, a.normalized_name
         from locations l join accounts a on a.account_id = l.account_id
        where l.postal_code = $1 and lower(l.address_line_1) = lower($2)`,
      [postal, input.addressLine1],
    );
    for (const row of rows) {
      if (namesAreCompatible(row.normalized_name, normalizedName)) {
        return { accountId: row.account_id, matchRule: 'address_and_name' };
      }
    }
  }

  // 5. Exact normalized name within the same city/state. Two independent HVAC firms
  //    can share a name across states, so geography is required here.
  const city = normalizeCity(input.city);
  const state = normalizeState(input.state);
  if (normalizedName && state) {
    const { rows } = await client.query<{ account_id: string }>(
      `select a.account_id
         from accounts a join locations l on l.account_id = a.account_id
        where a.normalized_name = $1
          and l.state_region = $2
          and ($3::text is null or lower(l.city) = lower($3))
        limit 1`,
      [normalizedName, state, city],
    );
    if (rows[0]) return { accountId: rows[0].account_id, matchRule: 'normalized_name_and_geography' };
  }

  return null;
}

/** Compatible = identical, or one is a clean prefix-token subset of the other. */
function namesAreCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const shared = [...tokensA].filter((token) => tokensB.has(token)).length;
  const smaller = Math.min(tokensA.size, tokensB.size);
  return smaller > 0 && shared / smaller >= 0.75;
}

export interface UpsertOptions {
  /** Where this record came from, for the timeline and for evidence provenance. */
  discoverySource: string;
  importBatchId?: string | null;
  marketId?: string | null;
  researchRunId?: string | null;
  actorUserId?: string | null;
}

/**
 * Upserts an Account and its location/domain/contact/endpoints.
 * Never touches ownership, relationship state or suppression on an existing Account.
 */
export async function upsertAccount(
  client: pg.PoolClient,
  input: AccountInput,
  options: UpsertOptions,
): Promise<ResolveResult> {
  const existing = await resolveAccountIdentity(client, input);
  const hostname = normalizeHostname(input.website);
  const normalizedName = normalizeCompanyName(input.canonicalName) || input.canonicalName.toLowerCase();

  let accountId: string;
  let created = false;
  let matchRule: MatchRule;

  if (existing) {
    accountId = existing.accountId;
    matchRule = existing.matchRule;
    // Fill gaps only. An existing canonical name is not overwritten by a
    // lower-quality source, and the vertical is only set if it was unknown.
    await client.query(
      `update accounts set
         legal_name = coalesce(legal_name, $2),
         canonical_domain = coalesce(canonical_domain, $3),
         primary_vertical_profile_id = coalesce(primary_vertical_profile_id, $4),
         industry_code = coalesce(industry_code, $5)
       where account_id = $1`,
      [accountId, input.legalName ?? null, hostname, input.verticalProfileId ?? null, input.industryCode ?? null],
    );

    // A company can be found twice by different means, and both facts are worth
    // keeping. Bought in a list and then seen advertising by a provider is a
    // stronger prospect than either alone, and an operator asking where a company
    // came from deserves both answers rather than only the first one.
    //
    // Once per source per day: re-running a list or re-searching a market must not
    // write a thousand rows saying the same thing.
    await client.query(
      `insert into activities (account_id, activity_type, channel, source_system, payload)
       select $1, 'SOURCE_OBSERVED', 'system', $2, $3
        where not exists (
          select 1 from activities a
           where a.account_id = $1
             and a.source_system = $2
             and a.activity_type in ('SOURCE_OBSERVED','DISCOVERED')
             and a.occurred_at > now() - interval '1 day')`,
      [accountId, options.discoverySource, JSON.stringify({ match_rule: matchRule })],
    );
  } else {
    const { rows } = await client.query<{ account_id: string }>(
      `insert into accounts (canonical_name, normalized_name, legal_name, canonical_domain,
                             primary_vertical_profile_id, industry_code, account_type)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, 'unknown'))
       returning account_id`,
      [
        input.canonicalName.trim(), normalizedName, input.legalName ?? null, hostname,
        input.verticalProfileId ?? null, input.industryCode ?? null, input.accountType ?? null,
      ],
    );
    accountId = rows[0]!.account_id;
    created = true;
    matchRule = 'created';

    await client.query(
      `insert into activities (account_id, activity_type, channel, source_system, payload, actor_user_id)
       values ($1, 'DISCOVERED', 'system', $2, $3, $4)`,
      [accountId, options.discoverySource, JSON.stringify({ match_rule: matchRule }), options.actorUserId ?? null],
    );
  }

  if (input.sourceIdentity) {
    await client.query(
      `insert into source_identities (provider, provider_entity_type, provider_native_id, account_id, retention_class)
       values ($1, $2, $3, $4, coalesce($5, 'durable'))
       on conflict (provider, provider_entity_type, provider_native_id)
       do update set last_seen_at = now()`,
      [
        input.sourceIdentity.provider, input.sourceIdentity.entityType, input.sourceIdentity.nativeId,
        accountId, input.sourceIdentity.retentionClass ?? null,
      ],
    );
  }

  if (hostname) {
    await client.query(
      `insert into account_domains (account_id, hostname, canonical_url, domain_role, verification_status)
       values ($1, $2, $3, 'primary', 'unverified')
       on conflict (account_id, hostname) do update set last_verified_at = account_domains.last_verified_at`,
      [accountId, hostname, input.website ?? null],
    );
  }

  const locationId = await upsertLocation(client, accountId, input);
  const contactId = await upsertNamedContact(client, accountId, locationId, input, options);

  if (input.phone) {
    await upsertEndpoint(client, {
      accountId, contactId: null, locationId,
      type: 'PHONE', rawValue: input.phone,
      // An imported or discovered company number is the main line until evidence
      // says otherwise. It is never promoted to a person's direct line here.
      endpointRole: 'MAIN_BUSINESS_LINE',
      relationshipToPerson: 'COMPANY_ROUTE',
      qualityState: 'PUBLIC_OBSERVED_UNVERIFIED',
      source: options.discoverySource === 'import' ? 'IMPORT' : 'UNKNOWN',
      sourceReference: null,
    });
  }

  if (input.email) {
    const normalized = normalizeEmail(input.email);
    if (normalized) {
      const emailRole = classifyEmail(normalized);
      await upsertEndpoint(client, {
        accountId,
        // Only attach a personal-looking address to a named contact; a role or general
        // mailbox stays at Account level so `info@` is never shown as the owner's email.
        contactId: emailRole === 'DIRECT_PERSON_EMAIL' ? contactId : null,
        locationId,
        type: 'EMAIL', rawValue: normalized,
        endpointRole: emailRole,
        relationshipToPerson: emailRole === 'DIRECT_PERSON_EMAIL' ? 'UNVERIFIED' : 'ROLE_INBOX',
        qualityState: 'DOMAIN_VALID_UNVERIFIED',
        source: options.discoverySource === 'import' ? 'IMPORT' : 'UNKNOWN',
        sourceReference: null,
      });
    }
  }

  return { accountId, created, matchRule };
}

async function upsertLocation(
  client: Queryable, accountId: string, input: AccountInput,
): Promise<string | null> {
  const city = normalizeCity(input.city);
  const state = normalizeState(input.state);
  const postal = normalizePostalCode(input.postalCode);
  if (!city && !state && !postal && !input.addressLine1) return null;

  const { rows: existing } = await client.query<{ location_id: string }>(
    `select location_id from locations
      where account_id = $1
        and coalesce(lower(address_line_1), '') = coalesce(lower($2), '')
        and coalesce(postal_code, '') = coalesce($3, '')
        and coalesce(lower(city), '') = coalesce(lower($4), '')
      limit 1`,
    [accountId, input.addressLine1 ?? null, postal, city],
  );
  if (existing[0]) {
    await client.query(
      `update locations set
         state_region = coalesce(state_region, $2),
         timezone = coalesce(timezone, $3)
       where location_id = $1`,
      [existing[0].location_id, state, input.timezone ?? null],
    );
    return existing[0].location_id;
  }

  const { rows } = await client.query<{ location_id: string }>(
    `insert into locations (account_id, address_line_1, city, state_region, postal_code,
                            timezone, location_type, is_headquarters)
     values ($1, $2, $3, $4, $5, $6, $7,
             not exists (select 1 from locations where account_id = $1))
     returning location_id`,
    [
      accountId, input.addressLine1 ?? null, city, state, postal, input.timezone ?? null,
      input.addressLine1 ? 'physical' : 'service_area',
    ],
  );
  return rows[0]!.location_id;
}

async function upsertNamedContact(
  client: Queryable, accountId: string, locationId: string | null,
  input: AccountInput, options: UpsertOptions,
): Promise<string | null> {
  if (!input.contactName?.trim()) return null;
  const fullName = input.contactName.trim();
  const { first, last } = splitPersonName(fullName);

  const { rows: existing } = await client.query<{ contact_id: string }>(
    `select contact_id from contacts
      where account_id = $1 and lower(full_name) = lower($2) and status = 'ACTIVE' limit 1`,
    [accountId, fullName],
  );
  if (existing[0]) return existing[0].contact_id;

  const { rows } = await client.query<{ contact_id: string }>(
    `insert into contacts (account_id, location_id, first_name, last_name, full_name, raw_title,
                           role_category, company_relationship, employer_match, role_match,
                           currentness, role_confidence, decision_maker_priority,
                           source_provider, observed_at)
     values ($1, $2, $3, $4, $5, $6,
             $7, 'unknown', 'UNCERTAIN', 'VALID_FALLBACK', 'UNKNOWN', 'UNKNOWN_ROLE', 50, $8, now())
     returning contact_id`,
    [
      accountId, locationId, first, last, fullName, input.contactTitle ?? null,
      roleCategoryFromTitle(input.contactTitle), options.discoverySource,
    ],
  );
  return rows[0]!.contact_id;
}

/** Conservative title mapping. An unrecognized title stays `unknown` rather than guessing. */
export function roleCategoryFromTitle(title: string | null | undefined): string {
  if (!title) return 'unknown';
  const t = title.toLowerCase();
  if (/registered agent/.test(t)) return 'registered_agent';
  if (/qualifier|license holder|qualifying agent/.test(t)) return 'license_qualifier';
  if (/\bowner\b|proprietor/.test(t)) return 'owner';
  if (/founder|co-?founder/.test(t)) return 'founder';
  if (/\bpresident\b/.test(t)) return 'president';
  if (/\bceo\b|chief executive/.test(t)) return 'ceo';
  if (/general manager|\bgm\b/.test(t)) return 'general_manager';
  if (/service manager/.test(t)) return 'service_manager';
  if (/operations|\bcoo\b|\bops\b/.test(t)) return 'operations';
  if (/marketing|\bcmo\b/.test(t)) return 'marketing';
  if (/sales/.test(t)) return 'sales';
  if (/office manager/.test(t)) return 'office_manager';
  if (/intake/.test(t)) return 'intake';
  if (/administrator|admin/.test(t)) return 'administrator';
  return 'unknown';
}

export interface EndpointInput {
  accountId: string;
  contactId: string | null;
  locationId: string | null;
  type: 'PHONE' | 'EMAIL';
  rawValue: string;
  endpointRole: string;
  relationshipToPerson: string;
  qualityState: string;
  source: string;
  sourceReference: string | null;
  verifiedAt?: Date | null;
}

/**
 * Upserts one endpoint. Rediscovery updates provenance but never resurrects an
 * endpoint a rep marked wrong, and never overwrites a stronger quality state with
 * a weaker one (contact-endpoint-quality-spec §7).
 */
export async function upsertEndpoint(
  client: Queryable, input: EndpointInput,
): Promise<string | null> {
  const normalized = input.type === 'PHONE' ? normalizePhone(input.rawValue) : normalizeEmail(input.rawValue);
  if (!normalized) return null;

  const display = input.type === 'PHONE' ? formatPhoneDisplay(normalized) : normalized;
  const extension = input.type === 'PHONE' ? extractExtension(input.rawValue) : null;

  const { rows } = await client.query<{ endpoint_id: string }>(
    `insert into contact_endpoints (account_id, contact_id, location_id, endpoint_type,
                                    normalized_value, display_value, extension, endpoint_role,
                                    relationship_to_person, quality_state, endpoint_source,
                                    source_reference, observed_at, verified_at, freshness)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, 'fresh')
     on conflict (account_id, endpoint_type, normalized_value) do update set
       -- A wrong/bounced endpoint stays dead until new verified evidence supersedes it.
       quality_state = case
         when contact_endpoints.quality_state in
              ('WRONG_NUMBER','DISCONNECTED','HARD_BOUNCE','SUPPRESSED')
           then contact_endpoints.quality_state
         else excluded.quality_state end,
       endpoint_role = case
         when contact_endpoints.endpoint_role in ('UNKNOWN_PHONE_TYPE','UNKNOWN_EMAIL_TYPE')
           then excluded.endpoint_role
         else contact_endpoints.endpoint_role end,
       contact_id = coalesce(contact_endpoints.contact_id, excluded.contact_id),
       extension = coalesce(contact_endpoints.extension, excluded.extension),
       observed_at = now(),
       verified_at = coalesce(excluded.verified_at, contact_endpoints.verified_at),
       freshness = 'fresh'
     returning endpoint_id`,
    [
      input.accountId, input.contactId, input.locationId, input.type, normalized, display, extension,
      input.endpointRole, input.relationshipToPerson, input.qualityState, input.source,
      input.sourceReference, input.verifiedAt ?? null,
    ],
  );
  const endpointId = rows[0]!.endpoint_id;

  // A previously suppressed value must stay suppressed even when a brand-new source
  // rediscovers it (rep-ownership-data-model §12).
  await client.query(
    `update contact_endpoints set is_suppressed = true, quality_state = 'SUPPRESSED'
      where endpoint_id = $1
        and exists (select 1 from suppressions s
                     where s.is_active and s.normalized_value = $2
                       and (s.expires_at is null or s.expires_at > now()))`,
    [endpointId, normalized],
  );

  return endpointId;
}

export async function recordEvidence(
  client: Queryable,
  input: {
    accountId: string; contactId?: string | null; endpointId?: string | null;
    researchRunId?: string | null; category: string; claimKey: string; claimText: string;
    normalizedValue?: string | null; confidence: 'confirmed' | 'likely' | 'unknown' | 'contradicted';
    canStateAsFact: boolean; sourceType: string; sourceProvider?: string | null;
    sourceReference?: string | null; expiresAt?: Date | null; precedenceRank?: number;
    notes?: string | null;
  },
): Promise<string> {
  const { rows } = await client.query<{ evidence_id: string }>(
    `insert into evidence_records (account_id, contact_id, endpoint_id, research_run_id, category,
                                   claim_key, claim_text, normalized_value, confidence,
                                   can_state_as_fact, source_type, source_provider, source_reference,
                                   expires_at, freshness, precedence_rank, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'fresh',coalesce($15,9),$16)
     returning evidence_id`,
    [
      input.accountId, input.contactId ?? null, input.endpointId ?? null, input.researchRunId ?? null,
      input.category, input.claimKey, input.claimText, input.normalizedValue ?? null, input.confidence,
      input.canStateAsFact, input.sourceType, input.sourceProvider ?? null, input.sourceReference ?? null,
      input.expiresAt ?? null, input.precedenceRank ?? null, input.notes ?? null,
    ],
  );
  return rows[0]!.evidence_id;
}

export async function getAccountSummary(accountId: string) {
  const { rows } = await query('select * from prospect_inventory where account_id = $1', [accountId]);
  return rows[0] ?? null;
}

export { withTransaction };
