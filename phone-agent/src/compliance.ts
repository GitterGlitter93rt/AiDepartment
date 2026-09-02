import type { ComplianceResult, Lead } from './types';

export interface CompliancePolicy {
  internalSuppressionNumbers: Set<string>;
  maxAttemptsPer30Days: number;
  allowUnknownLineType: boolean;
  autonomousMobileTelemarketingEnabled: boolean;
  callingWindowLocal: { startHour: number; endHour: number };
}

export interface ComplianceHistory {
  attemptsLast30Days: number;
  doNotCall: boolean;
  lastDisposition?: string;
}

export function evaluateCompliance(
  lead: Lead,
  history: ComplianceHistory,
  policy: CompliancePolicy,
  localHour: number,
): ComplianceResult {
  const reasons: string[] = [];

  if (history.doNotCall || lead.consentStatus === 'revoked') {
    return result('suppress', ['Lead has revoked consent or is marked do-not-call.']);
  }

  if (policy.internalSuppressionNumbers.has(normalizePhone(lead.phone))) {
    return result('suppress', ['Phone number is on the internal suppression list.']);
  }

  if (history.attemptsLast30Days >= policy.maxAttemptsPer30Days) {
    return result('suppress', ['Retry-frequency limit reached for the current 30-day window.']);
  }

  if (localHour < policy.callingWindowLocal.startHour || localHour >= policy.callingWindowLocal.endHour) {
    return result('review', ['Lead is currently outside the configured local calling window.']);
  }

  if (lead.lineType === 'mobile' && !policy.autonomousMobileTelemarketingEnabled) {
    return result('human_only', ['Autonomous marketing calls to mobile numbers are disabled by policy.']);
  }

  if ((!lead.lineType || lead.lineType === 'unknown') && !policy.allowUnknownLineType) {
    return result('review', ['Line type is unknown; enrichment/review is required before autonomous dialing.']);
  }

  if (lead.consentStatus === 'unknown') {
    reasons.push('Consent/contact basis is unknown; autonomous mode should remain disabled unless a reviewed policy permits this lead class.');
    return result('human_only', reasons);
  }

  reasons.push('Lead passed configured suppression, retry, line-type, consent, and calling-window checks.');
  return result('allow', reasons);
}

function result(decision: ComplianceResult['decision'], reasons: string[]): ComplianceResult {
  return { decision, reasons, checkedAt: new Date().toISOString() };
}

function normalizePhone(input: string): string {
  return input.replace(/\D/g, '');
}
