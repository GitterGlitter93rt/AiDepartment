// Business policies for the actions a receptionist can actually take.
//
// Everything a caller is promised — where a tow goes, which forms they
// sign, what can be uploaded, who a referral reaches — is a decision the
// BUSINESS made, not one a language model may make on a call. So each
// lives here as typed configuration, and the tool layer accepts only
// identifiers that appear in it.
//
// That is the whole security model in one sentence: Claude picks from a
// list, the backend owns the list. A model cannot invent a tow yard, a
// DocuSign template, an upload bucket, or a law firm to send someone's
// details to, because none of those are free-text parameters anywhere.

import type { Industry } from '../core/taxonomy.ts';

// ---------------------------------------------------------------------
// Towing
// ---------------------------------------------------------------------

export interface TowDestination {
  id: string;
  /** How the agent refers to it aloud. */
  name: string;
  /** Never spoken unprompted; used by the dispatcher, not the caller. */
  address?: string;
}

export interface TowPolicy {
  available: boolean;
  /** "24/7", "during business hours" — spoken as written. */
  availabilityDescription: string;
  /** Where vehicles go. Claude may only choose from these. */
  destinations: TowDestination[];
  defaultDestinationId: string;
  /**
   * Demo ETA range. Only ever spoken as approximate, and only used when
   * a live provider has not returned a real one.
   */
  etaMinMinutes: number;
  etaMaxMinutes: number;
  /**
   * What may truthfully be said about who pays.
   *
   * Deliberately a sentence rather than a boolean: "insurance covers
   * towing" is not a fact about this business, it is a prediction about
   * someone else's claim decision, and the difference has to survive
   * into the prompt intact.
   */
  billingLanguage: string;
}

export const COLLISION_DEMO_TOW: TowPolicy = {
  available: true,
  availabilityDescription: 'around the clock for accident vehicles',
  destinations: [{ id: 'main_shop', name: 'our repair facility' }],
  defaultDestinationId: 'main_shop',
  etaMinMinutes: 45,
  etaMaxMinutes: 90,
  billingLanguage:
    'The shop can arrange the tow and coordinate the towing charge through the insurance claim where it applies. Whether the carrier ultimately pays depends on the claim, the policy and liability — say that plainly. Never say the tow is free, and never say insurance will cover it.',
};

// ---------------------------------------------------------------------
// Collision repair process
// ---------------------------------------------------------------------

export interface RepairStep {
  title: string;
  /** What actually happens, in the words a receptionist would use. */
  detail: string;
}

export interface CollisionRepairPolicy {
  steps: RepairStep[];
  /** Business days from arrival to teardown. */
  teardownMinDays: number;
  teardownMaxDays: number;
  /** Typical span AFTER approvals and parts, in weeks. */
  repairMinWeeks: number;
  repairMaxWeeks: number;
  /** Why a completion date cannot be given. Spoken, not hidden. */
  unknownsLanguage: string;
  rentalLanguage: string;
}

export const COLLISION_DEMO_REPAIR: CollisionRepairPolicy = {
  teardownMinDays: 1,
  teardownMaxDays: 2,
  repairMinWeeks: 1,
  repairMaxWeeks: 4,
  steps: [
    { title: 'Arrival', detail: 'the vehicle is towed in or dropped off and checked in' },
    { title: 'Teardown and blueprint', detail: 'within about one to two business days the shop disassembles what it needs to and documents the visible and hidden damage' },
    { title: 'Repair plan', detail: 'the shop writes the repair plan and submits the documentation to the insurer when it is a claim' },
    { title: 'Insurer review', detail: 'the carrier reviews it — some send an adjuster, many review photos or handle it electronically; it varies by carrier and claim' },
    { title: 'Approval and parts', detail: 'once it is authorised, parts are ordered and the schedule becomes clearer' },
    { title: 'Repair', detail: 'body, paint, reassembly, calibrations and any sublet work' },
  ],
  unknownsLanguage:
    'Actual repair time depends on severity, hidden damage found at teardown, structural work, parts availability, how quickly the insurer responds, supplements, calibrations and sublet operations — and occasionally the vehicle is written off instead. That is why nobody can give a completion date before teardown.',
  rentalLanguage:
    'Ask whether they need a rental. Do not say rental is covered — rental coverage comes from the policy, not from the shop.',
};

// ---------------------------------------------------------------------
// Electronic signature packets
// ---------------------------------------------------------------------

export interface EsignPacket {
  id: string;
  /** How the agent describes it. Never a description of legal terms. */
  label: string;
  industry: Industry;
  /** Provider-side template identifier. Opaque here on purpose. */
  templateId: string;
  /** Fields that must exist on the session before it may be sent. */
  requires: string[];
  /**
   * Whether signing this packet, by itself, creates the relationship.
   *
   * Defaults false everywhere and should stay false unless a specific
   * client's signed agreement genuinely says otherwise. An AI telling
   * someone they are represented when no attorney has reviewed the
   * matter is a serious problem, not a UX detail.
   */
  createsRelationshipOnSignature: boolean;
  /** What the agent may say once it is sent. */
  afterSendLanguage: string;
}

export const ESIGN_PACKETS: EsignPacket[] = [
  {
    id: 'collision_repair_intake',
    label: 'repair authorisation packet',
    industry: 'collision_repair',
    templateId: 'tpl_collision_repair_intake_v1',
    requires: ['firstName', 'phone'],
    createsRelationshipOnSignature: false,
    afterSendLanguage:
      'Say the packet is on its way and they can sign it whenever they are somewhere safe. Do not describe what the forms say — the shop wrote them, not you.',
  },
  {
    id: 'pi_engagement_packet',
    label: "the firm's engagement packet",
    industry: 'attorneys',
    templateId: 'tpl_pi_engagement_v1',
    requires: ['firstName', 'phone', 'incidentType'],
    createsRelationshipOnSignature: false,
    afterSendLanguage:
      'Say the firm will review the signed packet and the intake, and confirm representation. Do NOT say they are represented, that the firm has taken the case, or that they now have a lawyer. Signing a packet is not the same as a firm accepting a matter.',
  },
];

// ---------------------------------------------------------------------
// Secure upload links
// ---------------------------------------------------------------------

export interface UploadPurpose {
  id: string;
  label: string;
  industries: Industry[];
  /** What the agent asks them to send. */
  guidance: string;
  /**
   * Situations where asking for photos would put someone at risk.
   *
   * Present on purpose: a link is worth nothing next to somebody
   * walking through a live traffic lane or opening an electrical panel
   * to photograph it.
   */
  safetyPrecondition?: string;
}

export const UPLOAD_PURPOSES: UploadPurpose[] = [
  {
    id: 'collision_damage_photos', label: 'damage photos', industries: ['collision_repair'],
    guidance: 'a few photos of the damage from a safe distance',
    safetyPrecondition: 'ONLY once they are out of traffic and somewhere safe. Never ask someone at a roadside scene to walk around the vehicle.',
  },
  { id: 'roof_damage_photos', label: 'roof or storm damage photos', industries: ['roofing'], guidance: 'photos of the damage from the ground', safetyPrecondition: 'From the ground only. Never suggest anyone climb onto a roof.' },
  { id: 'water_damage_photos', label: 'water or fire damage photos', industries: ['restoration'], guidance: 'photos of the affected areas', safetyPrecondition: 'Only if the property is safe to be in. Not if there is standing water near electrics, structural damage, or contamination.' },
  { id: 'hvac_equipment_photos', label: 'equipment photos', industries: ['hvac'], guidance: 'a photo of the model and serial label on the unit', safetyPrecondition: 'Only if the label is easily visible. Never suggest opening a panel or removing a cover.' },
  {
    id: 'electrical_panel_photos', label: 'panel photos', industries: ['electrical'],
    guidance: 'a photo of the panel with the cover CLOSED, and of any affected outlet or fixture',
    safetyPrecondition: 'The cover stays on. Never ask anyone to remove a panel cover, touch a conductor, or approach anything sparking, smoking or hot. If there is any of that, no photo is worth it — escalate instead.',
  },
  { id: 'plumbing_leak_photos', label: 'photos of the leak', industries: ['plumbing'], guidance: 'photos of the fixture and where the water is coming from', safetyPrecondition: 'AFTER the water is shut off and the emergency is under control. Never before.' },
  { id: 'construction_project_photos', label: 'project photos', industries: ['construction'], guidance: 'photos of the space or area involved' },
  { id: 'construction_plans', label: 'plans and drawings', industries: ['construction'], guidance: 'the plans, drawings or architect files' },
  { id: 'construction_bid_documents', label: 'the bid package', industries: ['construction'], guidance: 'the bid package, scope of work and any engineering documents' },
  { id: 'property_photos', label: 'property photos', industries: ['pressure_washing', 'landscaping', 'real_estate', 'property_management'], guidance: 'photos of the areas involved' },
  { id: 'garage_door_photos', label: 'door photos', industries: ['garage_door'], guidance: 'a photo of the door and the opener', safetyPrecondition: 'Only if the door is stable. Never near a broken spring or a door hanging off its track.' },
  { id: 'pool_photos', label: 'pool photos', industries: ['pool'], guidance: 'photos of the water and the equipment pad' },
  { id: 'general_project_files', label: 'project files', industries: ['professional_services', 'manufacturing', 'defense_aerospace'], guidance: 'the relevant files' },
];

export interface UploadPolicy {
  enabled: boolean;
  /** Purpose ids this business allows. */
  allowedPurposes: string[];
  /** How long a link stays live, for the caller's benefit. */
  expiryHours: number;
}

// ---------------------------------------------------------------------
// Partner referrals
// ---------------------------------------------------------------------

export interface ReferralPartner {
  id: string;
  /** What the agent may call them. Deliberately generic in the demo. */
  label: string;
  /** What the partner does, for the offer wording. */
  kind: 'personal_injury_attorney' | 'restoration' | 'towing' | 'other';
  /** Fields sent. Nothing outside this list ever leaves. */
  payloadFields: string[];
  /**
   * Exactly what the agent may claim about the relationship.
   *
   * Overclaiming here — "they'll take your case", "they're our
   * attorneys" — is the failure mode, so the truthful sentence is
   * configured rather than improvised.
   */
  offerLanguage: string;
}

export const REFERRAL_PARTNERS: ReferralPartner[] = [
  {
    id: 'pi_partner_demo',
    label: 'a personal injury attorney',
    kind: 'personal_injury_attorney',
    // Minimal by design. An injury referral does not need a medical
    // history to be useful, and sending one creates risk with no
    // corresponding benefit.
    payloadFields: ['firstName', 'phone', 'email', 'incidentDate', 'accidentLocation', 'incidentType', 'injuryReported'],
    offerLanguage:
      'You may say you can pass their contact information to a personal injury attorney for a free case review. Do NOT say they have a case, that the attorney will take it, that they will recover anything, or that the firm is "ours". Declining changes nothing about the repair.',
  },
];

export interface ReferralPolicy {
  enabled: boolean;
  /** Partner ids this business may refer to. */
  allowedPartnerIds: string[];
  /** Referral is never made without explicit spoken agreement. */
  requiresExplicitConsent: true;
}

// ---------------------------------------------------------------------
// Per-industry bundle
// ---------------------------------------------------------------------

export interface ActionPolicies {
  tow?: TowPolicy;
  collisionRepair?: CollisionRepairPolicy;
  esignPacketIds: string[];
  upload?: UploadPolicy;
  referral?: ReferralPolicy;
}

const NONE: ActionPolicies = { esignPacketIds: [] };

/**
 * What this industry's demo business is configured to do.
 *
 * A real client replaces the entry for its own industry; nothing else
 * in the system changes.
 */
export function policiesFor(industry: Industry | null): ActionPolicies {
  switch (industry) {
    case 'collision_repair':
      return {
        tow: COLLISION_DEMO_TOW,
        collisionRepair: COLLISION_DEMO_REPAIR,
        esignPacketIds: ['collision_repair_intake'],
        upload: { enabled: true, allowedPurposes: ['collision_damage_photos'], expiryHours: 72 },
        referral: { enabled: true, allowedPartnerIds: ['pi_partner_demo'], requiresExplicitConsent: true },
      };
    case 'attorneys':
      return {
        esignPacketIds: ['pi_engagement_packet'],
        upload: { enabled: true, allowedPurposes: ['general_project_files'], expiryHours: 168 },
      };
    case 'construction':
      return {
        esignPacketIds: [],
        upload: { enabled: true, allowedPurposes: ['construction_plans', 'construction_bid_documents', 'construction_project_photos'], expiryHours: 168 },
      };
    default: {
      const purposes = UPLOAD_PURPOSES.filter((p) => industry && p.industries.includes(industry)).map((p) => p.id);
      return purposes.length
        ? { esignPacketIds: [], upload: { enabled: true, allowedPurposes: purposes, expiryHours: 72 } }
        : NONE;
    }
  }
}

export const packetById = (id: string): EsignPacket | undefined => ESIGN_PACKETS.find((p) => p.id === id);
export const purposeById = (id: string): UploadPurpose | undefined => UPLOAD_PURPOSES.find((p) => p.id === id);
export const partnerById = (id: string): ReferralPartner | undefined => REFERRAL_PARTNERS.find((p) => p.id === id);

// ---------------------------------------------------------------------
// Your AI Department's own appointment
// ---------------------------------------------------------------------

/**
 * The discovery call.
 *
 * Deliberately its own configuration rather than borrowing whichever
 * industry the caller happened to be testing. A plumbing estimate and a
 * sales call with us are different things, and reusing the plumbing
 * appointment would put "service visit" on our own calendar.
 */
export interface DiscoveryCallConfig {
  title: string;
  durationMinutes: number;
  booksDirectly: boolean;
  /** Minimum notice before the first offerable slot. */
  minimumLeadHours: number;
  maximumLeadDays: number;
  /** Must exist on the PROSPECT record before booking. */
  requires: string[];
}

export const YAD_DISCOVERY_CALL: DiscoveryCallConfig = {
  title: 'Your AI Department Discovery Call',
  durationMinutes: 30,
  booksDirectly: true,
  minimumLeadHours: 2,
  maximumLeadDays: 30,
  requires: ['firstName', 'companyName', 'email', 'phone'],
};
