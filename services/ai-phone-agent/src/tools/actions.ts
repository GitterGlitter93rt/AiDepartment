// Tow dispatch, e-signature packets, secure upload links, and partner
// referrals.
//
// All four share one shape, because they share one risk: each performs
// something in the outside world that a caller will believe happened.
// So each reports its MODE honestly, and the agent is told what to say
// accordingly. A mocked action must never be described as done — a
// prospect watching a demo can be shown the workflow without being lied
// to about an integration nobody has connected.
//
// None of these tools accepts a URL, a phone number, a template, a
// partner or a destination as free text. Every identifier is looked up
// against src/business/policies.ts, which is what makes it impossible
// for a language model to invent an endpoint.

import { randomBytes } from 'node:crypto';

/** What actually happened. Never guessed at, never softened. */
export type ActionMode = 'sent' | 'queued' | 'mocked' | 'failed';

export interface ActionResult {
  mode: ActionMode;
  /** Safe reference the caller could quote. Never a tokenised URL. */
  reference?: string;
  /** Why it failed, for logs. Never spoken verbatim. */
  error?: string;
}

// ---------------------------------------------------------------------
// Tow
// ---------------------------------------------------------------------

export interface TowRequest {
  callerName: string;
  callbackPhone: string;
  pickupLocation: string;
  directionOfTravel?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleCondition?: string;
  /** Resolved from configuration before it reaches here. */
  destinationId: string;
  destinationName: string;
  insuranceCarrier?: string;
  claimNumber?: string;
  notes?: string;
  callSid: string;
  // ---- Equipment. What kind of truck, and why. ----------------------
  /** flatbed, wheel_lift, recovery, dispatcher_review… */
  towType?: string;
  /** Why that truck was chosen. For the dispatcher, never the caller. */
  towTypeReason?: string;
  drivetrain?: string;
  rolls?: boolean;
  steers?: boolean;
  wheelLocked?: boolean;
  suspensionDamage?: boolean;
  /** road, parking_garage, ditch, median, tight_access… */
  accessType?: string;
  accessNotes?: string;
  recoveryRequired?: boolean;

  // ---- Unattended vehicle. ------------------------------------------
  /** The caller will not be there when the driver arrives. */
  unattended?: boolean;
  /** hand_to_driver, hidden_at_vehicle, inside_vehicle… */
  keyHandoffMethod?: string;
  /** Verbatim for the driver: "Key on top of driver's rear tire." */
  keyInstructions?: string;
  vehicleUnlockedForTow?: boolean;

  /** Policy number, when there is no claim yet. */
  policyNumber?: string;
  /** insurance, self_pay, third_party_insurance. No tow without one. */
  paymentPath?: string;
  paymentResponsibilityAcknowledged?: boolean;
  towCostDisclosed?: boolean;
}

export interface TowResult extends ActionResult {
  /** Minutes, only when a live provider actually returned one. */
  driverEtaMinutes?: number;
  /** A range, when the provider gives one instead of a point estimate. */
  driverEtaRangeMinutes?: [number, number];
  destinationName: string;
  /** queued, assigned, en_route — whatever the provider reports. */
  dispatchStatus?: string;
  provider?: string;
  /** True once a specific driver is on it. An ETA before this is a
   * guess about a truck nobody has picked yet. */
  driverAssigned?: boolean;
  /** The equipment actually being sent, if the provider confirms it. */
  towType?: string;
}

export interface TowTool {
  dispatch(req: TowRequest): Promise<TowResult>;
  mode: 'mock' | 'live';
}

/**
 * Mock dispatcher.
 *
 * Deliberately returns no driver ETA. A demo that invents "your driver
 * is 38 minutes away" teaches the agent to say things it cannot know,
 * and the habit survives the integration.
 */
export function createMockTow(sink: (r: TowRequest) => void = () => {}): TowTool {
  return {
    mode: 'mock',
    async dispatch(req) {
      sink(req);
      return { mode: 'mocked', reference: `tow-${shortId()}`, destinationName: req.destinationName };
    },
  };
}

// ---------------------------------------------------------------------
// E-signature
// ---------------------------------------------------------------------

export interface EsignRequest {
  /** Provider-side template. Resolved from config, never from the model. */
  templateId: string;
  packetId: string;
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  deliveryChannel: 'sms' | 'email';
  callSid: string;
  claimNumber?: string;
}

export interface EsignResult extends ActionResult {
  /** Envelope reference. Safe to log; contains no access token. */
  envelopeId?: string;
}

export interface EsignTool {
  send(req: EsignRequest): Promise<EsignResult>;
  mode: 'mock' | 'docusign';
}

/**
 * Mock e-sign provider.
 *
 * The seam a real DocuSign adapter drops into: same interface, same
 * validation, same result shape. Nothing in the conversation layer has
 * to change when it is connected — which is the point of building it
 * this way rather than wiring the provider into the prompt.
 */
export function createMockEsign(sink: (r: EsignRequest) => void = () => {}): EsignTool {
  return {
    mode: 'mock',
    async send(req) {
      sink(req);
      return { mode: 'mocked', envelopeId: `env-${shortId()}`, reference: `env-${shortId()}` };
    },
  };
}

// ---------------------------------------------------------------------
// Secure upload links
// ---------------------------------------------------------------------

export interface UploadLinkRequest {
  /** Purpose id, already checked against the business's allowed list. */
  purposeId: string;
  callSid: string;
  expiryHours: number;
}

export interface UploadLinkResult extends ActionResult {
  /**
   * The link itself.
   *
   * Returned to the tool layer so it can be texted, and deliberately
   * never logged: it carries a token, and a token in a log file is a
   * token in a backup.
   */
  url?: string;
  expiresAt?: string;
}

export interface UploadLinkTool {
  create(req: UploadLinkRequest): Promise<UploadLinkResult>;
  mode: 'mock' | 'live';
}

/**
 * Mock link generator.
 *
 * The URL is built HERE, from a configured base. The model never sees a
 * URL parameter and could not supply one if it tried.
 */
export function createMockUploadLink(baseUrl = 'https://upload.example-demo.invalid'): UploadLinkTool {
  return {
    mode: 'mock',
    async create(req) {
      const token = randomBytes(16).toString('hex');
      return {
        mode: 'mocked',
        url: `${baseUrl}/u/${token}`,
        reference: `upl-${shortId()}`,
        expiresAt: new Date(Date.now() + req.expiryHours * 3_600_000).toISOString(),
      };
    },
  };
}

// ---------------------------------------------------------------------
// Secure location sharing
// ---------------------------------------------------------------------

/** How a location reached us. */
export type LocationSource = 'spoken' | 'current_location' | 'pin' | 'live';

/**
 * Where the vehicle actually is.
 *
 * Coordinates live in application state and in the dispatch payload,
 * and nowhere else. They are never logged, never returned to the model,
 * and never read aloud — "I have the vehicle location" is the whole of
 * what a caller needs to hear.
 */
export interface RoadsideLocation {
  source: LocationSource;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  /** A pin's label, or the caller's own words for a spoken location. */
  label?: string;
  capturedAt?: string;
  confirmed: boolean;
}

export interface LocationLinkRequest {
  callSid: string;
  /** Fixed for now; the type exists so live sharing can be added. */
  purpose: 'roadside_dispatch';
  expiryMinutes: number;
}

export interface LocationLinkResult extends ActionResult {
  /**
   * The link, for texting only.
   *
   * Carries an opaque token bound to the call. Deliberately never
   * logged and never handed to the model: a token in a log file is a
   * token in a backup, and a token the model can see is a token it can
   * read out loud.
   */
  url?: string;
  expiresAt?: string;
}

export interface LocationLinkTool {
  create(req: LocationLinkRequest): Promise<LocationLinkResult>;
  /**
   * What the caller submitted, if anything.
   *
   * Polled by the application, never by the model. A real provider
   * would push this; the mock has nothing to report, which is honest —
   * a demo has no browser on the other end granting geolocation.
   */
  submitted(callSid: string): Promise<RoadsideLocation | null>;
  mode: 'mock' | 'live';
}

export function createMockLocationLink(baseUrl = 'https://loc.example-demo.invalid'): LocationLinkTool {
  return {
    mode: 'mock',
    async create(req) {
      // Opaque and random. The CallSid is an identifier, not a secret,
      // and using it as one would let anyone who saw a call log open
      // somebody's location page.
      const token = randomBytes(24).toString('base64url');
      return {
        mode: 'mocked',
        url: `${baseUrl}/l/${token}`,
        reference: `loc-${shortId()}`,
        expiresAt: new Date(Date.now() + req.expiryMinutes * 60_000).toISOString(),
      };
    },
    async submitted() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------
// Partner referral
// ---------------------------------------------------------------------

export interface ReferralRequest {
  partnerId: string;
  partnerLabel: string;
  /** Only the fields the partner's config lists. Nothing else. */
  payload: Record<string, string>;
  consentAt: string;
  callSid: string;
}

export interface ReferralResult extends ActionResult {
  partnerId: string;
}

export interface PartnerReferralTool {
  refer(req: ReferralRequest): Promise<ReferralResult>;
  mode: 'mock' | 'live';
}

export function createMockReferral(sink: (r: ReferralRequest) => void = () => {}): PartnerReferralTool {
  return {
    mode: 'mock',
    async refer(req) {
      sink(req);
      return { mode: 'mocked', reference: `ref-${shortId()}`, partnerId: req.partnerId };
    },
  };
}

// ---------------------------------------------------------------------

function shortId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * How the agent should describe an outcome.
 *
 * The distinction that keeps a sales demo honest: a real send may be
 * announced as done, a mocked one is described as something the system
 * can do. Both are useful to watch; only one of them is true.
 */
export function speechFor(mode: ActionMode, doneWording: string, capabilityWording: string): string {
  switch (mode) {
    case 'sent':
      return `DONE — you may tell the caller: ${doneWording}`;
    case 'queued':
      return `QUEUED — tell the caller it is on its way. ${doneWording}`;
    case 'mocked':
      return `NOT ACTUALLY SENT — this is a demonstration. Do NOT say you sent it. Say instead: ${capabilityWording}`;
    case 'failed':
      return 'FAILED — do not mention a system problem. Say the team will follow up, and carry on with the call.';
  }
}
