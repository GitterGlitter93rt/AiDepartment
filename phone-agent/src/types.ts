export type Confidence = 'confirmed' | 'likely' | 'unknown';
export type OperatingMode = 'research_only' | 'human_assist' | 'autonomous_outbound' | 'inbound_receptionist';
export type ComplianceDecision = 'allow' | 'human_only' | 'suppress' | 'review';

export interface Lead {
  id: string;
  companyName: string;
  website?: string;
  phone: string;
  city?: string;
  state?: string;
  industry?: string;
  source?: string;
  consentStatus?: 'express_written' | 'express' | 'business_contact' | 'unknown' | 'revoked';
  lineType?: 'landline' | 'mobile' | 'voip' | 'unknown';
  timezone?: string;
}

export interface Evidence<T = string> {
  value: T;
  confidence: Confidence;
  source: string;
  observedAt: string;
  notes?: string;
}

export interface ProspectDossier {
  leadId: string;
  companyName: string;
  website?: string;
  industry?: string;
  summary: string;
  ads: {
    google: Evidence<boolean>;
    meta: Evidence<boolean>;
  };
  tracking: Evidence<string[]>;
  leadCapture: Evidence<string[]>;
  crmSignals: Evidence<string[]>;
  afterHoursSignals: Evidence<string[]>;
  bookingSignals: Evidence<string[]>;
  risks: string[];
  opportunities: string[];
  rawFacts: Evidence[];
}

export interface SalesStrategy {
  leadId: string;
  icpScore: number;
  primaryAngle: string;
  opener: string;
  discoveryQuestions: string[];
  objectionPointers: string[];
  proofBoundaries: string[];
  callObjective: 'qualify' | 'book_demo' | 'transfer' | 'nurture' | 'human_followup';
  recommendedMode: OperatingMode;
  retrievedManualSections: string[];
}

export interface ComplianceResult {
  decision: ComplianceDecision;
  reasons: string[];
  checkedAt: string;
  earliestAllowedAt?: string;
}

export interface CallContext {
  lead: Lead;
  dossier: ProspectDossier;
  strategy: SalesStrategy;
  compliance: ComplianceResult;
}

export interface CallOutcome {
  callId: string;
  leadId: string;
  disposition:
    | 'booked'
    | 'transferred'
    | 'follow_up'
    | 'not_interested'
    | 'wrong_number'
    | 'voicemail'
    | 'no_answer'
    | 'do_not_call'
    | 'failed';
  summary: string;
  painPoints: string[];
  objections: string[];
  crmNamed?: string;
  nextAction?: string;
  nextActionAt?: string;
  transcriptRef?: string;
}
