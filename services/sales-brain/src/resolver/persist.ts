import type pg from 'pg';
import { upsertEndpoint, recordEvidence } from '../domain/accounts.js';
import { splitPersonName } from '../domain/normalize.js';
import type { ContactPath, DecisionMakerIdentity, ResolutionResult, SourceClass } from './types.js';
import { SOURCE_PRIORITY } from './types.js';

/**
 * Writes a resolution into canonical state.
 *
 * Two rules govern everything here:
 *   - a prospect or gatekeeper correction outranks stale third-party data, so a
 *     person marked stale is retired rather than overwritten (registry rule
 *     `prospect_correction_precedence`);
 *   - nothing is upgraded on write. A COMPANY_ROUTE endpoint stays a company route
 *     regardless of which contact it sits beside.
 */

/** Evidence precedence rank from the data contract's §13 ladder. */
function precedenceFor(sourceClass: SourceClass): number {
  const map: Partial<Record<SourceClass, number>> = {
    PROSPECT_OR_GATEKEEPER_SUPPLIED: 1,
    COMPANY_FIRST_PARTY: 3,
    PUBLIC_COMPANY_REGISTRY: 4,
    PUBLIC_LICENSE_REGISTRY: 4,
    LICENSED_CONTACT_PROVIDER: 5,
    PUBLIC_BUSINESS_DIRECTORY: 6,
    PUBLIC_BUSINESS_NEWS: 7,
    SEARCH_RESULT_DISCOVERY: 8,
    DERIVED_PATTERN: 9,
  };
  return map[sourceClass] ?? 9;
}

function decisionMakerPriorityFor(identity: DecisionMakerIdentity, index: number): number {
  const base = { PRIMARY_PROCESS_OWNER: 10, STRONG_STAKEHOLDER: 30, VALID_FALLBACK: 60, WEAK: 90 }[
    identity.roleMatch
  ];
  return base + index;
}

export interface PersistResult {
  primaryContactId: string | null;
  contactsWritten: number;
  endpointsWritten: number;
  evidenceWritten: number;
  retiredContacts: number;
}

export async function persistResolution(
  client: pg.PoolClient,
  accountId: string,
  resolution: ResolutionResult,
  researchRunId: string | null,
): Promise<PersistResult> {
  const result: PersistResult = {
    primaryContactId: null, contactsWritten: 0, endpointsWritten: 0,
    evidenceWritten: 0, retiredContacts: 0,
  };

  // People reported as gone are retired, not deleted: the record stays so a later
  // crawl of a stale page cannot quietly reintroduce them as current.
  for (const staleEntry of resolution.stale) {
    const { rowCount } = await client.query(
      `update contacts set status = 'LEFT_COMPANY', currentness = 'STALE',
                           role_confidence = 'HISTORICAL_ROLE', employer_match = 'HISTORICAL'
        where account_id = $1 and lower(full_name) = lower($2) and status = 'ACTIVE'`,
      [accountId, staleEntry.personName],
    );
    if (rowCount) {
      result.retiredContacts += rowCount;
      await recordEvidence(client, {
        accountId,
        researchRunId,
        category: 'decision_maker',
        claimKey: 'contact_no_longer_current',
        claimText: `${staleEntry.personName}: ${staleEntry.reason}`,
        normalizedValue: 'yes',
        confidence: 'likely',
        canStateAsFact: false,
        sourceType: 'resolver',
        precedenceRank: 3,
      });
      result.evidenceWritten += 1;
    }
  }

  const identities = [resolution.primary, ...resolution.alternates].filter(
    (identity): identity is DecisionMakerIdentity => Boolean(identity),
  );

  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index]!;
    const contactId = await upsertIdentity(client, accountId, identity, index, researchRunId, result);
    if (index === 0) result.primaryContactId = contactId;
  }

  // Excluded parties are recorded as evidence so a reviewer can see the resolver
  // considered and rejected them, rather than wondering why a filing name vanished.
  for (const exclusion of resolution.excluded) {
    await recordEvidence(client, {
      accountId,
      researchRunId,
      category: 'decision_maker',
      claimKey: 'excluded_from_targeting',
      claimText: `${exclusion.personName} (${exclusion.relationship}): ${exclusion.reason}`,
      normalizedValue: exclusion.relationship,
      confidence: 'confirmed',
      canStateAsFact: false,
      sourceType: 'resolver',
      precedenceRank: 3,
    });
    result.evidenceWritten += 1;
  }

  for (const path of resolution.contactPaths) {
    const endpointId = await persistPath(client, accountId, path, result.primaryContactId, resolution);
    if (endpointId) result.endpointsWritten += 1;
  }

  await client.query(
    `insert into activities (account_id, activity_type, channel, source_system, payload)
     values ($1, 'CONTACT_ENRICHED', 'system', 'public_resolver', $2)`,
    [
      accountId,
      JSON.stringify({
        status: resolution.status,
        primary: resolution.primary?.personName ?? null,
        target_roles: resolution.targetRoles,
        contact_paths: resolution.contactPaths.length,
        excluded: resolution.excluded.length,
      }),
    ],
  );

  return result;
}

async function upsertIdentity(
  client: pg.PoolClient, accountId: string, identity: DecisionMakerIdentity,
  index: number, researchRunId: string | null, result: PersistResult,
): Promise<string | null> {
  if (identity.isRolePlaceholder) {
    // A role target is stored as a contact row so the portal can render
    // "ask for Operations" without inventing a person.
    const { rows } = await client.query<{ contact_id: string }>(
      `insert into contacts (account_id, full_name, raw_title, role_category, company_relationship,
                             employer_match, role_match, currentness, role_confidence,
                             decision_maker_priority, is_role_placeholder, source_provider, observed_at)
       values ($1, null, null, $2, 'unknown', 'UNCERTAIN', $3, 'UNKNOWN', 'ROLE_ONLY_TARGET',
               $4, true, 'public_resolver', now())
       returning contact_id`,
      [accountId, identity.roleCategory, identity.roleMatch, decisionMakerPriorityFor(identity, index)],
    );
    result.contactsWritten += 1;
    return rows[0]!.contact_id;
  }

  const fullName = identity.personName!;
  const { first, last } = splitPersonName(fullName);
  const bestSource = identity.supportingObservations
    .slice()
    .sort((a, b) => SOURCE_PRIORITY[a.sourceClass] - SOURCE_PRIORITY[b.sourceClass])[0];

  const { rows: existing } = await client.query<{ contact_id: string; status: string }>(
    `select contact_id, status from contacts
      where account_id = $1 and lower(full_name) = lower($2) limit 1`,
    [accountId, fullName],
  );

  let contactId: string;
  if (existing[0]) {
    // Never resurrect someone a gatekeeper said had left.
    if (existing[0].status === 'LEFT_COMPANY') return existing[0].contact_id;
    contactId = existing[0].contact_id;
    await client.query(
      `update contacts set raw_title = coalesce($2, raw_title), role_category = $3,
                           company_relationship = $4, employer_match = $5, role_match = $6,
                           currentness = $7, role_confidence = $8, decision_maker_priority = $9,
                           source_provider = $10, source_reference = $11, last_verified_at = now(),
                           refresh_due_at = now() + interval '30 days'
        where contact_id = $1`,
      [
        contactId, identity.rawTitle, identity.roleCategory,
        relationshipToCompanyRelationship(identity.relationship),
        identity.employerMatch, identity.roleMatch, identity.currentness,
        roleConfidenceFor(identity), decisionMakerPriorityFor(identity, index),
        bestSource?.sourceClass ?? 'public_resolver', bestSource?.sourceReference ?? null,
      ],
    );
  } else {
    const { rows } = await client.query<{ contact_id: string }>(
      `insert into contacts (account_id, first_name, last_name, full_name, raw_title, role_category,
                             company_relationship, scope, employer_match, role_match, currentness,
                             role_confidence, decision_maker_priority, source_provider,
                             source_reference, observed_at, last_verified_at, refresh_due_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now(), now() + interval '30 days')
       returning contact_id`,
      [
        accountId, first, last, fullName, identity.rawTitle, identity.roleCategory,
        relationshipToCompanyRelationship(identity.relationship), identity.scope,
        identity.employerMatch, identity.roleMatch, identity.currentness,
        roleConfidenceFor(identity), decisionMakerPriorityFor(identity, index),
        bestSource?.sourceClass ?? 'public_resolver', bestSource?.sourceReference ?? null,
      ],
    );
    contactId = rows[0]!.contact_id;
    result.contactsWritten += 1;
  }

  // One evidence record per supporting observation: the reason for the conclusion
  // stays inspectable rather than collapsing into a single score.
  for (const observation of identity.supportingObservations) {
    await recordEvidence(client, {
      accountId,
      contactId,
      researchRunId,
      category: 'decision_maker',
      claimKey: 'decision_maker_identity',
      claimText: `${fullName}${observation.rawTitle ? ` — ${observation.rawTitle}` : ''} (${observation.sourceClass})`,
      normalizedValue: identity.roleCategory,
      confidence: observation.sourceClass === 'COMPANY_FIRST_PARTY'
        || observation.sourceClass === 'PROSPECT_OR_GATEKEEPER_SUPPLIED' ? 'confirmed' : 'likely',
      // Only a current first-party or prospect-supplied source lets a rep state the
      // role out loud.
      canStateAsFact:
        (observation.sourceClass === 'COMPANY_FIRST_PARTY'
          || observation.sourceClass === 'PROSPECT_OR_GATEKEEPER_SUPPLIED')
        && observation.freshness === 'FRESH',
      sourceType: observation.sourceClass,
      sourceReference: observation.sourceReference,
      precedenceRank: precedenceFor(observation.sourceClass),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      notes: observation.notes ?? null,
    });
    result.evidenceWritten += 1;
  }

  return contactId;
}

async function persistPath(
  client: pg.PoolClient, accountId: string, path: ContactPath,
  primaryContactId: string | null, resolution: ResolutionResult,
): Promise<string | null> {
  // An endpoint attaches to the person only when the resolver decided it is theirs.
  const isPersonal = path.relationshipToPerson === 'DIRECT_CONFIRMED'
    || path.relationshipToPerson === 'DIRECT_PROVIDER_ASSERTED';

  const endpointId = await upsertEndpoint(client, {
    accountId,
    contactId: isPersonal ? primaryContactId : null,
    locationId: null,
    type: path.kind,
    rawValue: path.value,
    endpointRole: path.endpointRole,
    relationshipToPerson: path.relationshipToPerson,
    qualityState: path.qualityState,
    source: sourceClassToEndpointSource(path.sourceClass),
    sourceReference: path.sourceReference,
    verifiedAt: path.relationshipToPerson === 'DIRECT_CONFIRMED' ? new Date() : null,
  });

  if (endpointId) {
    await recordEvidence(client, {
      accountId,
      endpointId,
      category: 'contact_endpoint',
      claimKey: `endpoint_${path.kind.toLowerCase()}`,
      claimText: `${path.value} observed as ${path.endpointRole} (${path.relationshipToPerson})`
        + (path.askFor ? `; route by asking for ${path.askFor}` : ''),
      normalizedValue: path.value,
      confidence: path.sourceClass === 'COMPANY_FIRST_PARTY' ? 'confirmed' : 'likely',
      canStateAsFact: false,
      sourceType: path.sourceClass,
      sourceReference: path.sourceReference,
      precedenceRank: precedenceFor(path.sourceClass),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      notes: resolution.status,
    });
  }
  return endpointId;
}

function relationshipToCompanyRelationship(relationship: string): string {
  if (relationship === 'REGISTERED_AGENT') return 'registered_agent';
  if (relationship === 'QUALIFIER' || relationship === 'LICENSE_HOLDER') return 'license_qualifier';
  if (relationship === 'OWNER' || relationship === 'FOUNDER' || relationship === 'BROKER_OWNER') return 'owner';
  if (relationship === 'MEMBER') return 'member_manager';
  if (relationship === 'OFFICER') return 'officer';
  return 'employee';
}

function roleConfidenceFor(identity: DecisionMakerIdentity): string {
  if (identity.currentness === 'STALE' || identity.employerMatch === 'HISTORICAL') return 'HISTORICAL_ROLE';
  if (identity.employerMatch === 'CONFIRMED' && identity.currentness === 'FRESH') return 'CONFIRMED_CURRENT_ROLE';
  if (identity.employerMatch === 'LIKELY' || identity.employerMatch === 'CONFIRMED') return 'LIKELY_CURRENT_ROLE';
  return 'UNKNOWN_ROLE';
}

function sourceClassToEndpointSource(sourceClass: SourceClass): string {
  const map: Partial<Record<SourceClass, string>> = {
    COMPANY_FIRST_PARTY: 'COMPANY_WEBSITE',
    PUBLIC_COMPANY_REGISTRY: 'PUBLIC_REGISTRY',
    PUBLIC_LICENSE_REGISTRY: 'PUBLIC_LICENSE',
    PUBLIC_BUSINESS_DIRECTORY: 'PUBLIC_DIRECTORY',
    PUBLIC_BUSINESS_NEWS: 'SEARCH_INDEXED',
    SEARCH_RESULT_DISCOVERY: 'SEARCH_INDEXED',
    PROSPECT_OR_GATEKEEPER_SUPPLIED: 'GATEKEEPER_SUPPLIED',
    LICENSED_CONTACT_PROVIDER: 'PAID_PROVIDER',
    DERIVED_PATTERN: 'INFERRED_PATTERN',
  };
  return map[sourceClass] ?? 'UNKNOWN';
}
