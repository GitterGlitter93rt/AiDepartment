import { query } from '../db/pool.js';

/**
 * Who may enter a cold email sequence.
 * Authority: outbound-sales-brain-smartlead-sync-spec.md §2, §14, §20.
 *
 * The rule that matters: if a filter materially reduces supply, return the shortfall
 * rather than quietly weakening the standard. A campaign asking for 100 verified
 * addresses and getting 41 gets 41 and an explanation.
 */

export type ExportRejectReason =
  | 'SUPPRESSED' | 'CLIENT' | 'ACTIVE_OPPORTUNITY' | 'MEETING_SCHEDULED'
  | 'NO_ELIGIBLE_EMAIL' | 'EMAIL_QUALITY_BELOW_MINIMUM' | 'GUESSED_EMAIL'
  | 'ALREADY_ENROLLED' | 'RESEARCH_STALE' | 'UNOWNED_POSITIVE_REPLY';

export interface EligibleContact {
  accountId: string;
  contactId: string | null;
  endpointId: string;
  email: string;
  companyName: string;
  firstName: string | null;
  qualityState: string;
}

export interface EligibilityReport {
  requested: number;
  eligible: EligibleContact[];
  rejected: { accountId: string; companyName: string; reason: ExportRejectReason }[];
  /** Honest shortfall reporting rather than padding (endpoint-quality-spec §22). */
  shortfall: number;
  shortfallBreakdown: Record<string, number>;
}

/** Email quality states ordered weakest to strongest. */
const QUALITY_ORDER = [
  'GUESSED_UNVERIFIED', 'UNKNOWN', 'STALE', 'DOMAIN_VALID_UNVERIFIED',
  'PUBLIC_OBSERVED_CURRENT', 'PROVIDER_VERIFIED', 'YAD_CONFIRMED_DELIVERABLE',
];

function meetsQuality(actual: string, minimum: string): boolean {
  const actualRank = QUALITY_ORDER.indexOf(actual);
  const minimumRank = QUALITY_ORDER.indexOf(minimum);
  if (actualRank === -1) return false;
  return actualRank >= Math.max(minimumRank, 0);
}

export async function selectEligibleForCampaign(input: {
  emailCampaignId: string;
  accountIds: string[];
  minimumEmailQuality?: string;
  requireNamedContact?: boolean;
}): Promise<EligibilityReport> {
  const minimum = input.minimumEmailQuality ?? 'PUBLIC_OBSERVED_CURRENT';

  const { rows } = await query<{
    account_id: string; canonical_name: string; is_suppressed: boolean; relationship_state: string;
    contact_id: string | null; first_name: string | null; endpoint_id: string | null;
    normalized_value: string | null; quality_state: string | null; endpoint_role: string | null;
    research_fresh_until: Date | null; already_enrolled: number;
  }>(
    `select a.account_id, a.canonical_name, a.is_suppressed, a.relationship_state,
            a.research_fresh_until,
            c.contact_id, c.first_name,
            e.endpoint_id, e.normalized_value, e.quality_state, e.endpoint_role,
            (select count(*)::int from email_enrollments en
              where en.account_id = a.account_id
                and en.status not in ('STOPPED','FAILED','UNSUBSCRIBED')) as already_enrolled
       from accounts a
       left join lateral (
         select * from contact_endpoints ce
          where ce.account_id = a.account_id and ce.endpoint_type = 'EMAIL'
            and ce.is_active and not ce.is_suppressed
          order by case ce.endpoint_role
                     when 'DIRECT_PERSON_EMAIL' then 1 when 'ROLE_EMAIL' then 2
                     when 'GENERAL_BUSINESS_EMAIL' then 3 else 4 end,
                   case ce.quality_state
                     when 'YAD_CONFIRMED_DELIVERABLE' then 1 when 'PROVIDER_VERIFIED' then 2
                     when 'PUBLIC_OBSERVED_CURRENT' then 3 else 4 end
          limit 1
       ) e on true
       left join contacts c on c.contact_id = e.contact_id and c.status = 'ACTIVE'
      where a.account_id = any($1::uuid[])`,
    [input.accountIds],
  );

  const eligible: EligibleContact[] = [];
  const rejected: EligibilityReport['rejected'] = [];

  for (const row of rows) {
    const reject = (reason: ExportRejectReason): void => {
      rejected.push({ accountId: row.account_id, companyName: row.canonical_name, reason });
    };

    // Suppression first, always.
    if (row.is_suppressed) { reject('SUPPRESSED'); continue; }
    if (row.relationship_state === 'CLIENT') { reject('CLIENT'); continue; }
    if (row.relationship_state === 'ACTIVE_OPPORTUNITY' || row.relationship_state === 'PROPOSAL') {
      reject('ACTIVE_OPPORTUNITY'); continue;
    }
    if (row.relationship_state === 'MEETING_SCHEDULED') { reject('MEETING_SCHEDULED'); continue; }
    if (row.relationship_state === 'POSITIVE_REPLY') { reject('UNOWNED_POSITIVE_REPLY'); continue; }
    if (row.already_enrolled > 0) { reject('ALREADY_ENROLLED'); continue; }

    if (!row.endpoint_id || !row.normalized_value) { reject('NO_ELIGIBLE_EMAIL'); continue; }
    // A guessed address is never outreach ready, whatever the campaign asks for.
    if (row.quality_state === 'GUESSED_UNVERIFIED') { reject('GUESSED_EMAIL'); continue; }
    if (!meetsQuality(row.quality_state ?? 'UNKNOWN', minimum)) {
      reject('EMAIL_QUALITY_BELOW_MINIMUM'); continue;
    }
    if (input.requireNamedContact && !row.contact_id) { reject('NO_ELIGIBLE_EMAIL'); continue; }

    // Personalization that references current observations needs current research.
    if (row.research_fresh_until && row.research_fresh_until < new Date()) {
      reject('RESEARCH_STALE'); continue;
    }

    eligible.push({
      accountId: row.account_id,
      contactId: row.contact_id,
      endpointId: row.endpoint_id,
      email: row.normalized_value,
      companyName: row.canonical_name,
      firstName: row.first_name,
      qualityState: row.quality_state ?? 'UNKNOWN',
    });
  }

  const breakdown: Record<string, number> = {};
  for (const entry of rejected) breakdown[entry.reason] = (breakdown[entry.reason] ?? 0) + 1;

  return {
    requested: input.accountIds.length,
    eligible,
    rejected,
    shortfall: input.accountIds.length - eligible.length,
    shortfallBreakdown: breakdown,
  };
}

/**
 * The minimum data an export may carry (spec §3).
 * Nothing internal travels: no DNC reasoning, no transcripts, no financial notes,
 * no prompt content.
 */
export interface ExportPayload {
  email: string;
  first_name: string | null;
  company_name: string;
  /** Correlation, so a reply resolves without relying on the address (spec §4). */
  yad_account_id: string;
  yad_contact_id: string | null;
  yad_enrollment_id: string;
  yad_campaign_id: string;
  personalization: Record<string, string>;
}

export function buildExportPayload(
  contact: EligibleContact, enrollmentId: string, campaignId: string,
  personalization: Record<string, string> = {},
): ExportPayload {
  return {
    email: contact.email,
    first_name: contact.firstName,
    company_name: contact.companyName,
    yad_account_id: contact.accountId,
    yad_contact_id: contact.contactId,
    yad_enrollment_id: enrollmentId,
    yad_campaign_id: campaignId,
    personalization,
  };
}
