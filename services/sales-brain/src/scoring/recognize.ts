import { query } from '../db/pool.js';
import { getVerticalProfile } from '../domain/verticals.js';
import type { ScoreRuleId, ScoreSignals } from './model.js';

/**
 * Evidence to signals.
 *
 * The vertical profiles have carried this mapping all along: each one lists
 * `public_signal_rules`, and each rule names the evidence claim key that proves it,
 * the confidence required, and the Module 4C rule it feeds. Nothing read it, so
 * nothing has ever been scored.
 *
 * Reading it rather than hard-coding a list means a new vertical brings its own
 * signals with it, and the reason a company scored what it did can be traced to a
 * document somebody wrote on purpose.
 */

/** The profile's word for a score rule, in our vocabulary. */
const RULE_BY_REFERENCE: Record<string, ScoreRuleId> = {
  module4c_google_ads_plus4: 'google_paid_search_confirmed',
  module4c_meta_ads_plus3: 'meta_active_ads_confirmed',
  module4c_after_hours_plus1: 'emergency_after_hours',
  module4c_multiple_locations_plus1: 'multiple_locations_or_service_territories',
  module4c_growth_plus1: 'visible_growth_hiring',
  module4c_lead_capture_plus1: 'prominent_forms_booking_quote_consultation_cta',
  module4c_high_value_plus2_if_vertical_model_rule_satisfied: 'high_value_economics_signal',
  // Deliberately not a score rule. A vertical may care about a signal without it
  // being worth points in the canonical model, and the profiles say so.
  vertical_priority_signal_only: undefined as unknown as ScoreRuleId,
};

interface SignalRule {
  claimKey: string;
  ruleId: ScoreRuleId;
  confidenceRequired: string;
}

/** The claim keys this vertical says are worth points, and which rule each feeds. */
export async function signalRulesFor(verticalProfileId: string | null): Promise<SignalRule[]> {
  if (!verticalProfileId) return [];
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  if (!definition) return [];

  const declared = definition['public_signal_rules'];
  if (!Array.isArray(declared)) return [];

  const rules: SignalRule[] = [];
  for (const entry of declared as Record<string, unknown>[]) {
    const claimKey = typeof entry['evidence_claim_key'] === 'string'
      ? entry['evidence_claim_key'].trim() : '';
    const reference = typeof entry['score_rule_reference'] === 'string'
      ? entry['score_rule_reference'].trim() : '';
    const ruleId = RULE_BY_REFERENCE[reference];
    if (!claimKey || !ruleId) continue;
    rules.push({
      claimKey,
      ruleId,
      confidenceRequired: typeof entry['confidence_required'] === 'string'
        ? entry['confidence_required'] : 'confirmed',
    });
  }
  return rules;
}

interface EvidenceRow {
  evidence_id: string;
  claim_key: string;
  claim_text: string | null;
  confidence: string | null;
  can_state_as_fact: boolean;
  expired: boolean;
  contradicted: boolean;
}

/**
 * The parts of a vertical profile that describe how the business actually works.
 *
 * These fields have been in all thirteen profiles since they were written and
 * nothing read them, so four of the eleven Module 4C rules had no recognizer at all
 * -- six of eighteen points unreachable, concentrated in exactly the rules that
 * separate a business that advertises from a business whose operations we can help.
 */
interface BusinessModel {
  phoneDependence: string;
  appointmentDependence: string;
  estimateDependence: string;
  highValueFamilies: string[];
  leadTypes: string[];
}

/** How strong a dependence has to be before the profile counts as asserting it. */
const STRONG_DEPENDENCE = new Set(['high', 'very_high', 'medium_high', 'critical']);

function businessModelOf(definition: Record<string, unknown> | null): BusinessModel {
  const model = (definition?.['business_model'] ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    phoneDependence: String(model['phone_dependence'] ?? ''),
    appointmentDependence: String(model['appointment_dependence'] ?? ''),
    estimateDependence: String(model['estimate_proposal_dependence'] ?? ''),
    highValueFamilies: list(model['high_value_service_families']),
    leadTypes: list(model['lead_types']),
  };
}

/**
 * Lead types that mean getting customers is a process rather than a by-product.
 *
 * The policy's test is whether the vertical profile marks customer acquisition as
 * central. A profile listing paid search leads, web forms and online booking among
 * its lead types is saying exactly that.
 */
const ACQUISITION_LEAD_TYPES = new Set([
  'paid_search_lead', 'local_services_lead', 'meta_lead', 'web_form', 'online_booking',
  'urgent_service_call', 'consultation_request', 'estimate_request', 'quote_request',
]);

/**
 * The signals an Account's current evidence supports.
 *
 * Three things disqualify a piece of evidence and each is a separate fact worth
 * keeping: it has been contradicted, it has aged past its window, or it was never
 * confident enough to count. None of them makes the opposite claim true, so a rule
 * that does not fire says which of the three happened rather than announcing that
 * the company does not advertise.
 */
export async function recognizeSignals(accountId: string): Promise<ScoreSignals> {
  const { rows: accountRows } = await query<{ primary_vertical_profile_id: string | null }>(
    'select primary_vertical_profile_id from accounts where account_id = $1', [accountId]);
  const rules = await signalRulesFor(accountRows[0]?.primary_vertical_profile_id ?? null);
  const verticalProfileId = accountRows[0]?.primary_vertical_profile_id ?? null;
  // No early return on an empty claim-key map: four of the eleven rules are read
  // from the profile's business model rather than from its signal list, and a
  // vertical can have the second without the first.

  const { rows } = await query<EvidenceRow>(
    `select evidence_id, claim_key, claim_text, confidence, can_state_as_fact,
            (expires_at is not null and expires_at <= now()) as expired,
            (contradicted_by_evidence_id is not null) as contradicted
       from evidence_records
      where account_id = $1`,
    [accountId],
  );

  const byClaim = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const held = byClaim.get(row.claim_key) ?? [];
    held.push(row);
    byClaim.set(row.claim_key, held);
  }

  const signals: ScoreSignals = {};
  for (const rule of rules) {
    const evidence = byClaim.get(rule.claimKey) ?? [];
    const usable = evidence.filter((row) =>
      !row.contradicted && !row.expired
      && (rule.confidenceRequired !== 'confirmed'
        || row.can_state_as_fact || row.confidence === 'confirmed'));

    // A rule already satisfied by another claim key stays satisfied: two profile
    // signals can feed one Module 4C rule, and the rule awards once either way.
    const existing = signals[rule.ruleId];
    const alreadyQualified = typeof existing === 'object' ? existing.qualified : Boolean(existing);
    const existingIds = typeof existing === 'object' ? existing.evidenceIds ?? [] : [];

    if (usable.length > 0) {
      signals[rule.ruleId] = {
        qualified: true,
        evidenceIds: [...existingIds, ...usable.map((row) => row.evidence_id)],
        reason: `Confirmed by current ${rule.claimKey.replace(/_/g, ' ')} evidence`,
      };
      continue;
    }
    if (alreadyQualified) continue;

    const contradicted = evidence.some((row) => row.contradicted);
    const stale = evidence.some((row) => row.expired);
    signals[rule.ruleId] = {
      qualified: false,
      evidenceIds: [],
      reason: contradicted
        ? `Earlier ${rule.claimKey.replace(/_/g, ' ')} evidence was contradicted and has not been re-confirmed`
        : stale
          ? `The ${rule.claimKey.replace(/_/g, ' ')} evidence we had has aged out and has not been re-confirmed`
          : evidence.length > 0
            ? `${rule.claimKey.replace(/_/g, ' ')} was observed but not to the confidence this rule requires`
            : `No ${rule.claimKey.replace(/_/g, ' ')} evidence has been recorded yet`,
    };
  }

  // The four rules the profiles describe in prose rather than by claim key. Each
  // needs the vertical to assert something about how the business works AND
  // evidence that this company does it -- the policy is explicit that a vertical
  // alone never awards, because every business technically sells something.
  const definition = verticalProfileId
    ? await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null
    : null;
  const model = businessModelOf(definition);
  const usableClaims = new Set(
    rows.filter((row) => !row.contradicted && !row.expired
      && (row.can_state_as_fact || row.confidence === 'confirmed'))
      .map((row) => row.claim_key));
  const evidenceIdsFor = (claimKeys: string[]): string[] =>
    rows.filter((row) => claimKeys.includes(row.claim_key)
      && !row.contradicted && !row.expired
      && (row.can_state_as_fact || row.confidence === 'confirmed'))
      .map((row) => row.evidence_id);

  const qualified = (ruleId: ScoreRuleId): boolean => {
    const signal = signals[ruleId];
    return typeof signal === 'object' ? signal.qualified : Boolean(signal);
  };

  // +1 The phone is a primary way customers reach them.
  //
  // Never awarded for having a phone number, which every business has. The vertical
  // has to say the phone is a primary path AND the company has to show a call route
  // a customer would actually use: a call CTA on the site, or a Local Services
  // listing, which is a phone lead surface by construction.
  const phoneClaims = ['website_cta', 'click_to_call', 'active_local_service_ad'];
  const phoneEvidence = evidenceIdsFor(phoneClaims);
  const phoneProfileSays = STRONG_DEPENDENCE.has(model.phoneDependence);
  signals['strong_phone_dependence'] = phoneProfileSays && phoneEvidence.length > 0
    ? {
      qualified: true, evidenceIds: phoneEvidence,
      reason: `The ${model.phoneDependence.replace('_', ' ')} phone dependence this vertical `
        + 'describes, with a call route observed on the company itself',
    }
    : {
      qualified: false, evidenceIds: [],
      reason: phoneProfileSays
        ? 'This vertical runs on the phone, but no call route has been observed on this '
          + 'company yet. Having a phone number is not evidence that customers use it.'
        : 'This vertical does not describe the phone as a primary customer path.',
    };

  // +1 The sale runs through an appointment, estimate or consultation.
  const intakeClaims = ['online_quote_booking', 'appointment_booking', 'website_cta'];
  const intakeEvidence = evidenceIdsFor(intakeClaims);
  const intakeProfileSays = STRONG_DEPENDENCE.has(model.appointmentDependence)
    || STRONG_DEPENDENCE.has(model.estimateDependence);
  signals['appointment_estimate_consultation_intake_heavy'] =
    intakeProfileSays && intakeEvidence.length > 0
      ? {
        qualified: true, evidenceIds: intakeEvidence,
        reason: 'The buying process in this vertical runs through an appointment or '
          + 'estimate, and this company has a booking or quote path',
      }
      : {
        qualified: false, evidenceIds: [],
        reason: intakeProfileSays
          ? 'The buying process here runs through an appointment or estimate, but no '
            + 'booking or quote path has been observed on this company yet.'
          : 'This vertical does not describe an appointment or estimate as central to '
            + 'the sale.',
      };

  // +2 One job or contract is worth enough for lost calls to matter.
  //
  // The vertical names its high-value families; the company has to be observed
  // offering one. A website offer naming a family is that observation.
  const offerRows = rows.filter((row) =>
    (row.claim_key === 'website_offer' || row.claim_key.startsWith('high_value'))
    && !row.contradicted && !row.expired
    && (row.can_state_as_fact || row.confidence === 'confirmed'));
  const familyWords = model.highValueFamilies
    .flatMap((family) => family.split('_').filter((word) => word.length > 3));
  const offerMatches = offerRows.filter((row) =>
    row.claim_key.startsWith('high_value')
    || familyWords.some((word) => (row.claim_text ?? '').toLowerCase().includes(word)));

  if (!qualified('high_value_economics_signal')) {
    signals['high_value_economics_signal'] = model.highValueFamilies.length > 0
      && offerMatches.length > 0
      ? {
        qualified: true, evidenceIds: offerMatches.map((row) => row.evidence_id),
        reason: 'This vertical has jobs worth enough for a lost call to matter, and this '
          + 'company is observed offering one of them',
      }
      : {
        qualified: false, evidenceIds: [],
        reason: model.highValueFamilies.length === 0
          ? 'This vertical does not define a high-value service family.'
          : 'No evidence yet that this company offers one of this vertical\'s high-value '
            + 'services. Every business sells something; that is not the same thing.',
      };
  }

  // +2 Getting and handling enquiries is a real operating process here.
  //
  // Two independent scale signals, from the policy's own list, on top of the vertical
  // saying acquisition is central. Counted from rules already recognized rather than
  // from raw evidence, so one observation cannot satisfy two of them.
  const acquisitionCentral = model.leadTypes.some((type) => ACQUISITION_LEAD_TYPES.has(type));

  // Independent means independent.
  //
  // Google paid and Meta paid are two channels -- which is what the multi-channel
  // bonus is for -- but they are one scale signal: this company buys advertising.
  // Counting them as two would let a single underlying fact satisfy a rule that
  // asks for two different kinds of evidence, and an advertiser with nothing else
  // known about it would score as an operationally complex business.
  const SCALE_CATEGORIES: { category: string; rules: ScoreRuleId[] }[] = [
    { category: 'paid acquisition',
      rules: ['google_paid_search_confirmed', 'meta_active_ads_confirmed'] },
    { category: 'more than one location',
      rules: ['multiple_locations_or_service_territories'] },
    { category: 'hiring or expanding', rules: ['visible_growth_hiring'] },
    { category: 'a lead-capture path',
      rules: ['prominent_forms_booking_quote_consultation_cta'] },
  ];
  const presentCategories = SCALE_CATEGORIES.filter(
    (entry) => entry.rules.some(qualified));

  signals['operationally_important_lead_volume_signal'] =
    acquisitionCentral && presentCategories.length >= 2
      ? {
        qualified: true,
        evidenceIds: presentCategories.flatMap((entry) => entry.rules.flatMap((ruleId) => {
          const signal = signals[ruleId];
          return typeof signal === 'object' ? signal.evidenceIds ?? [] : [];
        })),
        reason: 'Customer acquisition is central in this vertical, and this company shows '
          + `${presentCategories.map((entry) => entry.category).join(' and ')}`,
      }
      : {
        qualified: false, evidenceIds: [],
        reason: !acquisitionCentral
          ? 'This vertical does not describe customer acquisition as a central process.'
          : presentCategories.length === 1
            ? `Acquisition is central here and this company shows `
              + `${presentCategories[0]!.category}, but one kind of signal is not evidence `
              + 'of volume. A second, different kind is required.'
            : 'Acquisition is central here, but no independent scale signal is confirmed '
              + 'on this company yet.',
      };

  return signals;
}
