/**
 * Whether a form can be probed at all, and why not when it cannot.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §12, and the product
 * decisions of 2026-09-09 (consent gates, terms gates, vertical eligibility).
 *
 * Everything here fails closed. A form we cannot classify is ineligible, a required
 * checkbox we do not recognise is a consent gate, and an unreadable form is a fact
 * about the form. That direction is not caution for its own sake: the failure mode on
 * the other side is submitting a consent representation on behalf of somebody who
 * does not exist, or putting a truck on a road.
 *
 * Note what this file never does. It does not reinterpret the wording of a
 * checkbox to decide it is harmless, and it does not solve, skip or click through a
 * gate. Both were available and both are the wrong answer: circumventing an access
 * control to audit somebody is a different act from measuring a public response time.
 */

export type FieldKind =
  | 'NAME' | 'EMAIL' | 'PHONE' | 'MESSAGE' | 'ZIP_OR_CITY'
  /** Substantive facts a probe would have to invent. Each blocks when required. */
  | 'SERVICE_ADDRESS' | 'APPOINTMENT_TIME' | 'VEHICLE_VIN' | 'INSURANCE_CLAIM'
  | 'FINANCING_DETAIL' | 'MEDICAL_OR_LEGAL_DETAIL' | 'EMERGENCY_FLAG'
  | 'OTHER';

export type CheckboxClass =
  /** Agreeing to be contacted, including by automated means. */
  | 'CONSENT_MARKETING'
  /** Clickwrap terms, or an attestation that the information is truthful. */
  | 'TERMS_ATTESTATION'
  | 'PRIVACY_ACKNOWLEDGEMENT'
  /** A genuine preference with no representation attached. */
  | 'OPTIONAL_PREFERENCE'
  /** Unrecognised. Treated as a gate when required. */
  | 'UNKNOWN';

export interface FormField {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
}

export interface FormCheckbox {
  name: string;
  label: string;
  klass: CheckboxClass;
  required: boolean;
}

export interface FormDescriptor {
  url: string;
  fields: FormField[];
  checkboxes: FormCheckbox[];
  hasCaptcha: boolean;
  /** A visible rule prohibiting automated submission, as actually presented. */
  antiAutomationNotice: string | null;
  /** Terms acceptance required to submit, presented as text rather than a checkbox. */
  requiresTermsAcceptance: boolean;
  /** The form's only mode is requesting service/dispatch. */
  dispatchOnly: boolean;
  /** True when no submittable form was found at all. */
  formFound: boolean;
  emailFieldRejectsPlus: boolean;
}

export type IneligibleReason =
  | 'INELIGIBLE_CONSENT_GATE'
  | 'INELIGIBLE_TERMS_GATE'
  | 'INELIGIBLE_CAPTCHA'
  | 'INELIGIBLE_ANTI_AUTOMATION_NOTICE'
  | 'INELIGIBLE_DISPATCH_ONLY'
  | 'INELIGIBLE_REQUIRES_FABRICATED_FACT'
  | 'INELIGIBLE_VERTICAL'
  | 'INELIGIBLE_NO_FORM'
  | 'INELIGIBLE_NO_CONTACT_CHANNEL';

export interface EligibilityVerdict {
  eligible: boolean;
  reason: IneligibleReason | null;
  /** What was actually presented, recorded rather than inferred. */
  detail: string;
  /** Every blocking observation, so one fix does not hide another. */
  blockers: { reason: IneligibleReason; detail: string }[];
  /** Recorded verbatim whether or not any was checked. V1 checks none. */
  checkboxesPresented: { name: string; label: string; klass: CheckboxClass; required: boolean }[];
  plusAddressingAllowed: boolean;
}

/**
 * Verticals approved for V1, by product decision.
 *
 * A vertical being listed is necessary and not sufficient: eligibility is also
 * form-level, because a roofing form demanding a service address and an appointment
 * is no more probeable than a clinic's.
 */
export const V1_ELIGIBLE_VERTICALS: readonly string[] = [
  'roofing', 'hvac', 'plumbing', 'collision-repair', 'real-estate-brokerages',
];

/**
 * Categorically excluded regardless of authorization.
 *
 * This list is a floor rather than a ceiling. The shared property is that an inquiry
 * can create a professional-client relationship, a clinical record, or a dispatch to
 * a reported hazard -- none of which a measurement is worth.
 */
export const EXCLUDED_VERTICALS: readonly string[] = [
  // These four are ids that exist in the vertical registry today, so the exclusion
  // bites on real configuration rather than on names invented here.
  'law-firms', 'dental', 'med-spas', 'restoration',
  // And these are the shapes to refuse if such a profile is ever added.
  'legal', 'medical', 'mental-health', 'therapy',
  'emergency-restoration', 'water-damage', 'fire-restoration',
  'towing', 'roadside-assistance', 'ambulance', 'locksmith-emergency',
];

/** Field kinds that would require inventing a substantive fact. */
const FABRICATION_KINDS: readonly FieldKind[] = [
  'SERVICE_ADDRESS', 'APPOINTMENT_TIME', 'VEHICLE_VIN', 'INSURANCE_CLAIM',
  'FINANCING_DETAIL', 'MEDICAL_OR_LEGAL_DETAIL', 'EMERGENCY_FLAG',
];

/** Checkbox classes that carry a representation, so a required one is a gate. */
const REPRESENTING_CLASSES: readonly CheckboxClass[] = [
  'CONSENT_MARKETING', 'TERMS_ATTESTATION', 'PRIVACY_ACKNOWLEDGEMENT', 'UNKNOWN',
];

export function analyzeForm(input: {
  form: FormDescriptor;
  verticalProfileId: string | null;
}): EligibilityVerdict {
  const { form } = input;
  const blockers: EligibilityVerdict['blockers'] = [];
  const checkboxesPresented = form.checkboxes.map((box) => ({
    name: box.name, label: box.label, klass: box.klass, required: box.required,
  }));

  const vertical = input.verticalProfileId ?? '';
  if (EXCLUDED_VERTICALS.includes(vertical)) {
    blockers.push({
      reason: 'INELIGIBLE_VERTICAL',
      detail: `"${vertical}" is categorically excluded: an inquiry here can create `
        + 'professional-client, clinical or emergency-dispatch consequences.',
    });
  } else if (!V1_ELIGIBLE_VERTICALS.includes(vertical)) {
    blockers.push({
      reason: 'INELIGIBLE_VERTICAL',
      detail: `"${vertical || 'unknown'}" is not in the V1 eligible set `
        + `(${V1_ELIGIBLE_VERTICALS.join(', ')}).`,
    });
  }

  if (!form.formFound) {
    blockers.push({
      reason: 'INELIGIBLE_NO_FORM',
      detail: 'No submittable form was found at this URL.',
    });
  }

  if (form.hasCaptcha) {
    blockers.push({
      reason: 'INELIGIBLE_CAPTCHA',
      detail: 'A CAPTCHA or bot challenge is presented. Not solved, not outsourced, '
        + 'not bypassed.',
    });
  }

  if (form.antiAutomationNotice) {
    blockers.push({
      reason: 'INELIGIBLE_ANTI_AUTOMATION_NOTICE',
      // Recorded as presented. Nothing is inferred about terms we did not see.
      detail: `The page presents an anti-automation rule: "${form.antiAutomationNotice}"`,
    });
  }

  if (form.requiresTermsAcceptance) {
    blockers.push({
      reason: 'INELIGIBLE_TERMS_GATE',
      detail: 'Submission requires accepting terms. V1 does not accept terms on a '
        + 'third party form.',
    });
  }

  const gates = form.checkboxes.filter(
    (box) => box.required && REPRESENTING_CLASSES.includes(box.klass));
  if (gates.length > 0) {
    blockers.push({
      reason: 'INELIGIBLE_CONSENT_GATE',
      detail: `${gates.length} mandatory checkbox(es) carry a representation and are `
        + `not checked: ${gates.map((box) => `"${box.label}" [${box.klass}]`).join('; ')}. `
        + 'The wording is not reinterpreted and the box is not ticked.',
    });
  }

  if (form.dispatchOnly) {
    blockers.push({
      reason: 'INELIGIBLE_DISPATCH_ONLY',
      detail: 'The form\'s only mode is requesting service or dispatch. A probe '
        + 'submits an inquiry, never a service request.',
    });
  }

  const fabricated = form.fields.filter(
    (field) => field.required && FABRICATION_KINDS.includes(field.kind));
  if (fabricated.length > 0) {
    blockers.push({
      reason: 'INELIGIBLE_REQUIRES_FABRICATED_FACT',
      detail: `Required field(s) would have to be invented: `
        + `${fabricated.map((f) => `${f.label} [${f.kind}]`).join('; ')}.`,
    });
  }

  // A probe with no way to be answered measures nothing. Phone is what the pool
  // exists for; email alone is acceptable because the alias attributes exactly.
  const hasPhone = form.fields.some((field) => field.kind === 'PHONE');
  const hasEmail = form.fields.some((field) => field.kind === 'EMAIL');
  if (form.formFound && !hasPhone && !hasEmail) {
    blockers.push({
      reason: 'INELIGIBLE_NO_CONTACT_CHANNEL',
      detail: 'The form collects neither a phone number nor an email address, so no '
        + 'response could be attributed.',
    });
  }

  const first = blockers[0];
  return {
    eligible: blockers.length === 0,
    reason: first ? first.reason : null,
    detail: first ? first.detail : 'Eligible: a neutral request for information can be '
      + 'submitted without a representation or an invented fact.',
    blockers,
    checkboxesPresented,
    plusAddressingAllowed: !form.emailFieldRejectsPlus,
  };
}

/** Field-kind classification from a label, deterministic and case-insensitive. */
export function classifyField(label: string, inputType = 'text'): FieldKind {
  const text = label.toLowerCase();
  if (/\bvin\b|vehicle identification/.test(text)) return 'VEHICLE_VIN';
  if (/claim\s*(number|no|#)|insurance claim|policy number/.test(text)) return 'INSURANCE_CLAIM';
  if (/credit score|financing|monthly payment|income|loan amount/.test(text)) return 'FINANCING_DETAIL';
  if (/diagnos|symptom|medical|injur|prescription|legal matter|case detail/.test(text)) {
    return 'MEDICAL_OR_LEGAL_DETAIL';
  }
  if (/emergency|urgent|same.?day|asap|dispatch now/.test(text)) return 'EMERGENCY_FLAG';
  if (/appointment|preferred (date|time)|schedule|book a|arrival window/.test(text)) {
    return 'APPOINTMENT_TIME';
  }
  if (/street|address(?! ?line ?2)?|service location|property address/.test(text)
      && !/email/.test(text)) {
    return 'SERVICE_ADDRESS';
  }
  if (inputType === 'email' || /e-?mail/.test(text)) return 'EMAIL';
  if (inputType === 'tel' || /phone|mobile|cell|telephone/.test(text)) return 'PHONE';
  if (/\bzip\b|postal|city|town/.test(text)) return 'ZIP_OR_CITY';
  if (/message|comment|describe|how can we help|details|tell us|inquiry|question/.test(text)) {
    return 'MESSAGE';
  }
  if (/name/.test(text)) return 'NAME';
  return 'OTHER';
}

/**
 * Checkbox classification.
 *
 * UNKNOWN is a real answer and it blocks when the box is required. The alternative --
 * defaulting an unrecognised mandatory checkbox to a harmless preference -- is
 * exactly how a consent representation gets made by accident.
 */
export function classifyCheckbox(label: string): CheckboxClass {
  const text = label.toLowerCase();
  if (/terms|conditions|i (certify|attest|confirm)|accurate|truthful|i agree to the/.test(text)) {
    return 'TERMS_ATTESTATION';
  }
  if (/privacy policy|data (use|processing)|gdpr|ccpa/.test(text)) {
    return 'PRIVACY_ACKNOWLEDGEMENT';
  }
  if (/consent|agree to (be|receive)|autodial|automated|text message|sms|marketing|promotional|opt.?in/
      .test(text)) {
    return 'CONSENT_MARKETING';
  }
  if (/newsletter|keep me posted|send me tips|subscribe to updates/.test(text)) {
    return 'OPTIONAL_PREFERENCE';
  }
  return 'UNKNOWN';
}
