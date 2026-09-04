import { randomUUID } from 'node:crypto';
import { pool, query, withTransaction } from '../db/pool.js';
import { upsertAccount, upsertEndpoint, recordEvidence } from '../domain/accounts.js';

/**
 * The demonstration fixture for the human-rep pilot.
 *
 * Small, hand-built and readable, unlike the scale generator: this is the dataset a
 * person walks through, so every row exists to make one thing in the flow visible.
 * It is labelled as loudly as the scale data -- every domain under `.invalid`, every
 * phone a 555 number, every provenance field DEMO_FIXTURE -- because a convincing
 * demo company that nobody can tell from a real prospect is how a rep ends up
 * calling one.
 */

export const DEMO_MARKER = 'DEMO_FIXTURE';

export interface DemoFixture {
  accountIds: string[];
  /** The company the hero flow is about. */
  targetAccountId: string;
  /** A company under DNC, so the rep sees what a refusal looks like. */
  suppressedAccountId: string;
  /** A company we know almost nothing about, so absence is visible. */
  thinAccountId: string;
  targetContactId: string;
  targetEndpointId: string;
  enrollmentId: string;
  campaignId: string;
}

interface DemoCompany {
  name: string;
  domain: string;
  phone: string;
  postalCode: string;
  city: string;
  tier: 'A' | 'B' | 'C' | 'D';
  score: number;
  advertises: boolean;
  vertical: string;
}

const COMPANIES: DemoCompany[] = [
  { name: 'Coastal Air & Heat', domain: 'coastalairheat.invalid', phone: '904-555-0101',
    postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 11, advertises: true,
    vertical: 'hvac' },
  { name: 'Northgate Heating & Cooling', domain: 'northgateheating.invalid',
    phone: '904-555-0102', postalCode: '32256', city: 'Jacksonville', tier: 'A', score: 14,
    advertises: true, vertical: 'hvac' },
  { name: 'Baymeadows Comfort Systems', domain: 'baymeadowscomfort.invalid',
    phone: '904-555-0103', postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 10,
    advertises: true, vertical: 'hvac' },
  { name: 'Southside Climate Control', domain: 'southsideclimate.invalid',
    phone: '904-555-0104', postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 12,
    advertises: false, vertical: 'hvac' },
  { name: 'Budget Handyman Services', domain: 'budgethandyman.invalid',
    phone: '904-555-0105', postalCode: '32256', city: 'Jacksonville', tier: 'C', score: 6,
    advertises: false, vertical: 'hvac' },
  { name: 'Mandarin Air Repair', domain: 'mandarinair.invalid', phone: '904-555-0106',
    postalCode: '32257', city: 'Jacksonville', tier: 'B', score: 11, advertises: true,
    vertical: 'hvac' },
  { name: 'Beaches Roofing Group', domain: 'beachesroofing.invalid', phone: '904-555-0107',
    postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 10, advertises: true,
    vertical: 'roofing' },
  { name: 'Riverside Plumbing Co', domain: 'riversideplumbing.invalid',
    phone: '904-555-0108', postalCode: '32256', city: 'Jacksonville', tier: 'C', score: 8,
    advertises: false, vertical: 'plumbing' },
  { name: 'Atlantic Air Solutions', domain: 'atlanticairsolutions.invalid',
    phone: '904-555-0109', postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 11,
    advertises: true, vertical: 'hvac' },
];

/** A company under DNC. The rep should see it and see that it is off limits. */
const SUPPRESSED: DemoCompany = {
  name: 'Sawgrass Air Conditioning', domain: 'sawgrassair.invalid', phone: '904-555-0110',
  postalCode: '32256', city: 'Jacksonville', tier: 'B', score: 11, advertises: true,
  vertical: 'hvac',
};

/** A company nobody has researched. Absence has to be visible, not filled in. */
const THIN: DemoCompany = {
  name: 'Unknown Trades LLC', domain: 'unknowntrades.invalid', phone: '904-555-0111',
  postalCode: '32256', city: 'Jacksonville', tier: 'C', score: 0, advertises: false,
  vertical: 'hvac',
};

export async function seedPilotDemo(options: {
  ownerUserId?: string | null; managerUserId?: string | null;
} = {}): Promise<DemoFixture> {
  const accountIds: string[] = [];
  let targetAccountId = '';
  let targetContactId = '';
  let targetEndpointId = '';

  for (const company of [...COMPANIES, SUPPRESSED, THIN]) {
    const thin = company.name === THIN.name;
    const { accountId } = await withTransaction(async (client) => {
      const result = await upsertAccount(client, {
        canonicalName: company.name,
        website: `https://${company.domain}`,
        phone: company.phone,
        city: company.city, state: 'FL', postalCode: company.postalCode,
        verticalProfileId: company.vertical,
      }, { discoverySource: DEMO_MARKER });

      await client.query(
        `insert into source_identities (account_id, provider, provider_entity_type,
                                        provider_native_id, retention_class,
                                        first_seen_at, last_seen_at)
         values ($1, $2, 'business', $3, 'identifier_only', now(), now())
         on conflict do nothing`,
        [result.accountId, DEMO_MARKER, company.domain]);

      if (!thin) {
        await client.query(
          `update accounts set manual_tier = $2, manual_score = $3,
                  advertiser_strength = $4, research_completeness = 'GOOD',
                  last_researched_at = now(),
                  research_fresh_until = now() + interval '30 days'
            where account_id = $1`,
          [result.accountId, company.tier, company.score,
           company.advertises ? 'MODERATE' : 'NONE']);
      }
      return result;
    });
    accountIds.push(accountId);

    if (thin) continue;

    // A named owner, reachable only through the front desk: the common case, and the
    // one the Account page has to explain rather than paper over.
    const contactId = randomUUID();
    await query(
      `insert into contacts (contact_id, account_id, first_name, last_name, full_name,
                             raw_title, role_category, company_relationship, employer_match,
                             role_match, currentness, role_confidence,
                             decision_maker_priority, source_provider, observed_at)
       values ($1, $2, $3, $4, $5, 'Owner', 'owner', 'owner', 'LIKELY',
               'PRIMARY_PROCESS_OWNER', 'FRESH', 'LIKELY_CURRENT_ROLE', 1, $6, now())`,
      [contactId, accountId,
       company.name === 'Coastal Air & Heat' ? 'Ray' : 'Dana',
       company.name === 'Coastal Air & Heat' ? 'Alvarez' : 'Whitfield',
       company.name === 'Coastal Air & Heat' ? 'Ray Alvarez' : 'Dana Whitfield',
       DEMO_MARKER]);

    if (company.advertises) {
      await withTransaction((client) => recordEvidence(client, {
        accountId, category: 'advertising', claimKey: 'active_google_search_ad',
        claimText: `A Google search ad for "emergency ac repair jacksonville" showed ${company.name}.`,
        normalizedValue: 'yes', confidence: 'confirmed', canStateAsFact: true,
        sourceType: 'serp_observation', sourceProvider: DEMO_MARKER,
        sourceReference: 'demo-run-1', precedenceRank: 2,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      }));
    }

    await query(
      `insert into opportunity_hypotheses (account_id, category, hypothesis_text,
                                           missing_fact_questions, confidence, priority,
                                           generated_by, is_current)
       values ($1, 'after_hours',
               'They may be losing after-hours calls they never hear about.',
               array['Who picks up after five?'], 'unknown', 1, 'deterministic', true)`,
      [accountId]);

    const { rows: endpoints } = await query<{ endpoint_id: string }>(
      `select endpoint_id from contact_endpoints
        where account_id = $1 and endpoint_type = 'PHONE' limit 1`, [accountId]);
    const endpointId = endpoints[0]!.endpoint_id;

    await withTransaction((client) => upsertEndpoint(client, {
      accountId, contactId, locationId: null, type: 'EMAIL',
      rawValue: `office@${company.domain}`, endpointRole: 'GENERAL_BUSINESS_EMAIL',
      relationshipToPerson: 'ROLE_INBOX', qualityState: 'PUBLIC_OBSERVED_CURRENT',
      source: 'COMPANY_WEBSITE', sourceReference: `https://${company.domain}/contact`,
      verifiedAt: new Date(),
    }));

    if (company.name === 'Coastal Air & Heat') {
      targetAccountId = accountId;
      targetContactId = contactId;
      targetEndpointId = endpointId;
    }
    if (company.name === SUPPRESSED.name) {
      await query(
        `insert into suppressions (scope, account_id, suppression_type, source, reason,
                                   created_by)
         values ('ACCOUNT', $1, 'DNC', 'prospect_request',
                 'Asked us not to call again.', $2)`,
        [accountId, options.managerUserId ?? null]);
    }
  }

  // An email sequence, so the reply half of the flow has something to reply to.
  const campaignId = randomUUID();
  await query(
    `insert into email_campaigns (email_campaign_id, name, provider, status, hook_family,
                                  created_by)
     values ($1, $2, 'smartlead', 'ACTIVE', 'missed_call', $3)`,
    [campaignId, `DEMO — ${DEMO_MARKER} after-hours sequence`, options.managerUserId ?? null]);

  const { rows: emailEndpoint } = await query<{ endpoint_id: string; normalized_value: string }>(
    `select endpoint_id, normalized_value from contact_endpoints
      where account_id = $1 and endpoint_type = 'EMAIL' limit 1`, [targetAccountId]);
  const enrollmentId = randomUUID();
  await query(
    `insert into email_enrollments (enrollment_id, email_campaign_id, account_id, contact_id,
                                    endpoint_id, normalized_email, provider_lead_id, status)
     values ($1, $2, $3, $4, $5, $6, 'demo-lead-1', 'SENT')`,
    [enrollmentId, campaignId, targetAccountId, targetContactId,
     emailEndpoint[0]!.endpoint_id, emailEndpoint[0]!.normalized_value]);

  const suppressedAccountId = (await query<{ account_id: string }>(
    'select account_id from accounts where canonical_name = $1', [SUPPRESSED.name])).rows[0]!.account_id;
  const thinAccountId = (await query<{ account_id: string }>(
    'select account_id from accounts where canonical_name = $1', [THIN.name])).rows[0]!.account_id;

  if (options.ownerUserId) {
    await query(
      `update accounts set ownership_state = 'CLAIMED', current_owner_user_id = $2,
              claimed_at = now(), ownership_updated_at = now()
        where account_id = $1`, [targetAccountId, options.ownerUserId]);
  }

  return {
    accountIds, targetAccountId, suppressedAccountId, thinAccountId,
    targetContactId, targetEndpointId, enrollmentId, campaignId,
  };
}

/** Removes everything the demo fixture created. Nothing else is touched. */
export async function clearPilotDemo(): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from accounts where account_id in (
       select account_id from source_identities where provider = $1)`, [DEMO_MARKER]);
  return rowCount ?? 0;
}
