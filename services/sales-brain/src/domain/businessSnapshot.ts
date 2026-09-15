import type { DetailEvidence } from './accountDetail.js';
import { licensingRequirement } from '../sources/requirements.js';

/**
 * The Account, arranged for someone about to make a phone call.
 *
 * The brief for this product is a stopwatch: a rep should be able to open an account
 * and answer who they are, whether they are real, who to ask for and what to pitch,
 * inside thirty seconds. Everything below exists to make that possible without
 * reading raw evidence rows.
 *
 * The distinction the whole surface turns on is epistemic, not visual. A state
 * registry saying a company is active is a FACT. The company's own site saying it is
 * family-owned is an OBSERVATION -- true that they say it, unverified that it is so.
 * A suggestion that they need after-hours intake is a HYPOTHESIS. And a field nobody
 * has looked into is UNKNOWN, which is shown rather than hidden, because a blank
 * space reads as "no" and that is a different claim entirely.
 */

export type ClaimKind = 'FACT' | 'OBSERVATION' | 'HYPOTHESIS' | 'UNKNOWN';

export interface SnapshotItem {
  label: string;
  value: string;
  kind: ClaimKind;
  /** Where it came from, in words a rep can read. */
  sourceLabel: string;
  sourceReference: string | null;
  observedAt: Date | null;
  /** True when the evidence has aged past its own expiry. */
  stale: boolean;
}

export interface SnapshotSection {
  id: string;
  title: string;
  /** Shown when the section has nothing, so absence is visible rather than silent. */
  emptyNote: string;
  items: SnapshotItem[];
}

const SOURCE_LABELS: Record<string, string> = {
  fl_sunbiz: 'Florida Division of Corporations',
  fl_dbpr: 'Florida DBPR',
  tx_comptroller: 'Texas Comptroller',
  tx_tdlr: 'Texas Dept. of Licensing and Regulation',
  tx_tsbpe: 'Texas State Board of Plumbing Examiners',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  first_party: 'the company’s own website',
  public_registry: 'an official public record',
  prospect_statement: 'someone at the company',
};

function sourceLabelFor(evidence: DetailEvidence, provider?: string | null): string {
  if (provider && SOURCE_LABELS[provider]) return SOURCE_LABELS[provider]!;
  return SOURCE_TYPE_LABELS[evidence.source_type] ?? evidence.source_type;
}

/**
 * Which kind of claim a piece of evidence is.
 *
 * An official record asserting something is a fact. A company asserting something
 * about itself is an observation however confidently it is worded -- "licensed and
 * insured" on a footer is a claim, and the licence registry is what turns it into a
 * fact. Expired evidence keeps its kind and gains a staleness marker instead of
 * silently disappearing: "we knew this in March" is more useful than nothing.
 */
export function claimKindOf(evidence: DetailEvidence): ClaimKind {
  if (evidence.source_type === 'public_registry' && evidence.can_state_as_fact) return 'FACT';
  if (evidence.source_type === 'prospect_statement') return 'FACT';
  return 'OBSERVATION';
}

/** Human labels for the claim keys the enrichment writes. */
const CLAIM_LABELS: Record<string, string> = {
  legal_entity_name: 'Legal entity',
  state_entity_number: 'State file number',
  entity_status: 'Entity status',
  entity_right_to_transact: 'Right to transact business',
  entity_filed_date: 'Registered since',
  entity_type: 'Entity type',
  entity_state_of_formation: 'State of formation',
  registered_principal_address: 'Address on file with the state',
  last_annual_report_year: 'Last annual report',
  last_public_information_report: 'Last public information report',
  registered_agent_name: 'Registered agent',
  professional_license_number: 'Licence',
  professional_license_status: 'Licence status',
  license_first_issued: 'Licensed since',
  license_qualifying_agent: 'Qualifying agent',
  responsible_master_plumber: 'Responsible Master Plumber',
  license_insurance_expiration: 'Insurance on file expires',
  license_endorsements: 'Endorsements',
  official_registry_source: 'Registry record',
  official_license_source: 'Licence record',
  year_founded: 'In business since',
  years_in_business: 'Years in business',
  family_owned: 'Family owned',
  locally_owned: 'Locally owned',
  franchise_affiliation: 'Franchise',
  licensed_and_insured_claim: 'Says licensed and insured',
  spanish_language_service: 'Spanish-language service',
  insurance_claim_assistance: 'Helps with insurance claims',
  membership_plan_offered: 'Membership / maintenance plan',
  license_number_displayed: 'Licence number shown on site',
  stated_service_area: 'Service area',
  stated_hours: 'Hours',
};

const OFFICIAL_ENTITY_KEYS = [
  'legal_entity_name', 'entity_status', 'entity_right_to_transact', 'entity_type',
  'entity_state_of_formation', 'entity_filed_date', 'state_entity_number',
  'registered_principal_address', 'last_annual_report_year',
  'last_public_information_report', 'registered_agent_name',
];

const LICENCE_KEYS = [
  'professional_license_number', 'professional_license_status', 'license_first_issued',
  'license_qualifying_agent', 'responsible_master_plumber',
  'license_insurance_expiration', 'license_endorsements',
];

const PROFILE_KEYS = [
  'year_founded', 'years_in_business', 'family_owned', 'locally_owned',
  'franchise_affiliation', 'stated_service_area', 'stated_hours',
  'spanish_language_service', 'insurance_claim_assistance', 'membership_plan_offered',
  'licensed_and_insured_claim', 'license_number_displayed',
];

function toItem(evidence: DetailEvidence, provider?: string | null): SnapshotItem {
  return {
    label: CLAIM_LABELS[evidence.claim_key] ?? evidence.claim_key.replace(/_/g, ' '),
    value: evidence.normalized_value ?? evidence.claim_text,
    kind: claimKindOf(evidence),
    sourceLabel: sourceLabelFor(evidence, provider),
    sourceReference: evidence.source_reference,
    observedAt: evidence.observed_at,
    stale: evidence.is_expired,
  };
}

/** Newest first, one row per claim key: an account is not a changelog. */
function newestByClaim(evidence: DetailEvidence[], keys: string[]): DetailEvidence[] {
  const wanted = new Set(keys);
  const seen = new Map<string, DetailEvidence>();
  for (const entry of [...evidence].sort((left, right) =>
    right.observed_at.getTime() - left.observed_at.getTime())) {
    if (!wanted.has(entry.claim_key)) continue;
    if (!seen.has(entry.claim_key)) seen.set(entry.claim_key, entry);
  }
  return keys.map((key) => seen.get(key)).filter((entry): entry is DetailEvidence => Boolean(entry));
}

export interface SnapshotInput {
  evidence: DetailEvidence[];
  stateRegion: string | null;
  verticalProfileId: string | null;
  /** Source provider per evidence id, when the caller has it. */
  providerByEvidenceId?: Map<string, string | null>;
}

export function buildBusinessSnapshot(input: SnapshotInput): SnapshotSection[] {
  const provider = (evidence: DetailEvidence): string | null =>
    input.providerByEvidenceId?.get(evidence.evidence_id) ?? null;

  const official = newestByClaim(input.evidence, OFFICIAL_ENTITY_KEYS)
    .map((entry) => toItem(entry, provider(entry)));

  const licence = newestByClaim(input.evidence, LICENCE_KEYS)
    .map((entry) => toItem(entry, provider(entry)));

  const profile = newestByClaim(input.evidence, PROFILE_KEYS)
    .map((entry) => toItem(entry, provider(entry)));

  const technology = input.evidence
    .filter((entry) => entry.category === 'technology' && !entry.is_expired)
    .map((entry) => ({
      ...toItem(entry, provider(entry)),
      label: 'Runs',
      value: entry.claim_text.replace(/^Runs /, ''),
    }));

  const routes = input.evidence
    .filter((entry) => entry.category === 'contact_route')
    .map((entry) => ({
      ...toItem(entry, provider(entry)),
      label: entry.claim_key.replace(/^route_/, '').replace(/_/g, ' '),
    }));

  const socials = input.evidence
    .filter((entry) => entry.category === 'social_profile')
    .map((entry) => ({
      ...toItem(entry, provider(entry)),
      label: entry.claim_key.replace(/^social_/, ''),
    }));

  // The licensing line a rep needs when there is no licence to show. A Texas roofer
  // has no state licence because Texas issues none, and an empty licence section
  // without this sentence reads as a company that failed a check it never had to sit.
  const requirement = licensingRequirement(input.stateRegion, input.verticalProfileId);
  const licenceEmptyNote = requirement.scope === 'NONE' || requirement.scope === 'LOCAL_ONLY'
    ? requirement.note
    : requirement.scope === 'STATEWIDE'
      ? `${requirement.authority} licenses this trade. No licence has been matched to this `
        + 'company yet — that is a gap worth checking, not a confirmed absence.'
      : requirement.note;

  return [
    {
      id: 'official', title: 'Official records',
      emptyNote: 'No official company record has been matched to this business yet.',
      items: official,
    },
    {
      id: 'licensing', title: 'Licensing',
      emptyNote: licenceEmptyNote,
      items: licence,
    },
    {
      id: 'profile', title: 'What they say about themselves',
      emptyNote: 'Their site does not state any of the things we look for here.',
      items: profile,
    },
    {
      id: 'technology', title: 'Technology on their site',
      emptyNote: 'Nothing identifiable was detected on their site.',
      items: technology,
    },
    {
      id: 'routes', title: 'Ways in',
      emptyNote: 'No booking, quote or contact page was found.',
      items: routes,
    },
    {
      id: 'social', title: 'Social profiles they link to',
      emptyNote: 'Their site links to no social profiles.',
      items: socials,
    },
  ];
}

/**
 * The single most useful person the official record names, if it names one.
 *
 * Deliberately not called "the owner". It is whoever the state ties to the company
 * most closely -- a Responsible Master Plumber, a qualifying agent, a manager on a
 * filing -- and the label says which, because a rep asking for "the owner" when the
 * record says "qualifying agent" is a rep who has been misled by their own CRM.
 */
export function officialPersonHighlight(evidence: DetailEvidence[]): SnapshotItem | null {
  for (const key of ['responsible_master_plumber', 'license_qualifying_agent']) {
    const found = evidence.find((entry) => entry.claim_key === key && !entry.is_expired);
    if (found) return toItem(found);
  }
  return null;
}
