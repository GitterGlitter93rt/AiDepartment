// The collision record, laid out the way a service writer reads it.
//
// Built as sections rather than a flat blob because the person picking
// this up needs to see at a glance whose insurance is whose. Two
// carriers, two policy numbers and two claim numbers appear on the same
// call, and flattening them is how a shop bills the wrong one.
//
// One rule governs the whole file: this is a record of what the CALLER
// SAID, never a conclusion about who is liable. The labels say so
// out loud, because a CRM note reading "other driver at fault" is a
// legal determination nobody on this call was qualified to make.

import type { Session } from './types.ts';

export type FaultPosition =
  | 'caller_reports_self'
  | 'caller_reports_other_party'
  | 'disputed'
  | 'unclear'
  | 'unknown';

export type ClaimStatus = 'known' | 'pending' | 'not_filed' | 'unknown';
export type PaymentPath = 'first_party' | 'third_party' | 'self_pay' | 'undetermined';

export interface CollisionRecord {
  customer: { firstName?: string; lastName?: string; phone?: string; email?: string };
  vehicle: {
    year?: string; make?: string; model?: string; color?: string; licensePlate?: string;
    drivable?: boolean; airbagsDeployed?: boolean; damageArea?: string;
  };
  accident: {
    date?: string; time?: string; location?: string; roadway?: string;
    directionOfTravel?: string; city?: string; state?: string;
    /** True when a secure link produced coordinates. Never the coordinates. */
    preciseLocationCaptured: boolean;
    policeResponded?: boolean; policeAgency?: string; policeReportNumber?: string;
    /** Phrased as the caller's account, never as a finding. */
    faultPositionLabel: string;
    citationIssued?: boolean; citedParty?: string;
  };
  customerInsurance: {
    carrier?: string; policyNumber?: string;
    claimStatus: ClaimStatus; claimNumber?: string; policyholderName?: string;
  };
  otherParty: {
    firstName?: string; lastName?: string; phone?: string;
    vehicleYear?: string; vehicleMake?: string; vehicleModel?: string;
    vehicleColor?: string; licensePlate?: string;
  };
  otherPartyInsurance: {
    carrier?: string; policyNumber?: string;
    claimStatus: ClaimStatus; claimNumber?: string;
  };
  repair: {
    paymentPath: PaymentPath;
    repairIntentConfirmed: boolean;
    towStatus?: string; towDestination?: string;
    authorizationPacketStatus?: string;
    directionToPayIncluded: boolean;
    photoUploadStatus?: string;
    documentUploadStatus?: string;
    locationLinkStatus?: string;
    rentalNeeded?: boolean;
  };
  referral: { offered: boolean; consent: boolean; partner?: string; outcome?: string };
}

/** Human labels that keep an account an account. */
const FAULT_LABELS: Record<FaultPosition, string> = {
  caller_reports_self: 'Caller reports they were responsible',
  caller_reports_other_party: 'Caller reports the other driver was responsible',
  disputed: 'Caller reports responsibility is disputed',
  unclear: 'Caller is unsure who was responsible',
  unknown: 'Not established on the call',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Which claim status applies.
 *
 * A number present means known, whatever anyone wrote in the status
 * field, so a stale "pending" cannot hide a claim number the shop
 * actually has.
 */
function claimStatus(number: unknown, declared: unknown): ClaimStatus {
  if (str(number)) return 'known';
  const d = str(declared);
  if (d === 'known') return 'unknown'; // claimed known with no number — treat as unknown
  if (d === 'pending' || d === 'not_filed' || d === 'unknown') return d;
  return 'unknown';
}

function faultPosition(v: unknown): FaultPosition {
  const s = str(v);
  return s && s in FAULT_LABELS ? (s as FaultPosition) : 'unknown';
}

function paymentPath(q: Record<string, unknown>): PaymentPath {
  const declared = str(q.repairPaymentPath);
  if (declared === 'first_party' || declared === 'third_party' || declared === 'self_pay') return declared;
  return 'undetermined';
}

export function buildCollisionRecord(session: Session): CollisionRecord {
  const q = session.qualification as Record<string, unknown>;
  const c = session.contact;

  return {
    customer: { firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email },
    vehicle: {
      year: str(q.vehicleYear), make: str(q.vehicleMake), model: str(q.vehicleModel),
      color: str(q.vehicleColor), licensePlate: str(q.licensePlate),
      drivable: bool(q.vehicleDrivable), airbagsDeployed: bool(q.airbagsDeployed),
      damageArea: str(q.damageArea),
    },
    accident: {
      date: str(q.accidentDate), time: str(q.accidentTime),
      location: str(q.accidentLocation), roadway: str(q.roadway),
      directionOfTravel: str(q.directionOfTravel), city: str(q.city), state: str(q.state),
      // The flag, never the coordinates.
      preciseLocationCaptured: session.roadsideLocation?.confirmed === true,
      policeResponded: bool(q.policeResponded), policeAgency: str(q.policeAgency),
      policeReportNumber: str(q.policeReportNumber),
      faultPositionLabel: FAULT_LABELS[faultPosition(q.faultPosition)],
      citationIssued: bool(q.citationIssued), citedParty: str(q.citedParty),
    },
    customerInsurance: {
      carrier: str(q.insuranceCarrier), policyNumber: str(q.policyNumber),
      claimStatus: claimStatus(q.claimNumber, q.claimNumberStatus),
      claimNumber: str(q.claimNumber), policyholderName: str(q.policyholderName),
    },
    otherParty: {
      firstName: str(q.otherPartyFirstName), lastName: str(q.otherPartyLastName),
      phone: str(q.otherPartyPhone),
      vehicleYear: str(q.otherPartyVehicleYear), vehicleMake: str(q.otherPartyVehicleMake),
      vehicleModel: str(q.otherPartyVehicleModel), vehicleColor: str(q.otherPartyVehicleColor),
      licensePlate: str(q.otherPartyLicensePlate),
    },
    otherPartyInsurance: {
      carrier: str(q.otherPartyInsuranceCarrier), policyNumber: str(q.otherPartyPolicyNumber),
      claimStatus: claimStatus(q.otherPartyClaimNumber, q.otherPartyClaimNumberStatus),
      claimNumber: str(q.otherPartyClaimNumber),
    },
    repair: {
      paymentPath: paymentPath(q),
      repairIntentConfirmed: q.repairIntentConfirmed === true,
      towStatus: str(q.towStatus), towDestination: str(q.towDestination),
      authorizationPacketStatus: str(q.esignStatus),
      // True whenever the sent packet was the one that contains it.
      directionToPayIncluded: str(q.esignPacketId) === 'collision_repair_intake',
      photoUploadStatus: str(q.uploadLinkPurpose) === 'collision_damage_photos' ? str(q.uploadLinkStatus) : undefined,
      documentUploadStatus: str(q.uploadLinkPurpose) === 'collision_insurance_documents' ? str(q.uploadLinkStatus) : undefined,
      locationLinkStatus: str(q.locationLinkStatus),
      rentalNeeded: bool(q.rentalNeeded),
    },
    referral: {
      offered: q.referralOffered === true,
      consent: q.referralConsent === true,
      partner: str(q.referralPartner),
      outcome: str(q.referralStatus),
    },
  };
}
