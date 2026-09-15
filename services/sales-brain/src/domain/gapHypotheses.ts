import { query } from '../db/pool.js';
import type { DerivedHypothesis } from './hypotheses.js';

/**
 * Hypotheses that live in the gap between two observations.
 *
 * The vertical profiles declare hypotheses triggered by signals a company *has*.
 * The most sellable openings, though, are in what a company has next to what it
 * lacks: paying for clicks with nowhere to book, advertising round-the-clock cover
 * with no after-hours intake, three locations behind one phone number. Neither half
 * is interesting alone, which is why a single-signal rule cannot find them.
 *
 * Three rules keep these honest:
 *
 *   - both halves must be observed. An absence only counts when we actually read the
 *     site, because "no booking page" on a site we could not fetch is a fact about
 *     our crawler;
 *   - every rule names the evidence on both sides, so a rep can check the reasoning
 *     rather than trust it;
 *   - they are hypotheses, stored and rendered as hypotheses, and worded as
 *     questions to ask rather than conclusions to assert. The company has not told us
 *     anything about its operations, and a confident sentence here would be a guess
 *     wearing a fact's clothes.
 */

interface GapRule {
  id: string;
  storedCategory: string;
  sourceCategory: string;
  /** Claim keys that must be present. */
  requires: string[];
  /** Claim keys that must be absent. */
  absent: string[];
  text: string;
  questions: string[];
  priority: number;
  /**
   * Verticals this applies to. Omitted means every trade.
   *
   * A trade-specific opening has to be trade-specific or it is noise: telling a law
   * firm it should capture storm-damage calls is the kind of thing that ends a
   * conversation rather than starting one.
   */
  verticals?: string[];
}

const GAP_RULES: GapRule[] = [
  {
    id: 'paid_clicks_without_booking',
    storedCategory: 'speed_to_lead',
    sourceCategory: 'paid_lead_response',
    requires: ['tech_google_ads_tag'],
    absent: ['route_booking'],
    text: 'They are paying for Google clicks and there is no way to book on the site, '
      + 'so every paid lead has to be caught by a person answering a phone or a form.',
    questions: [
      'What happens to a form that comes in after hours?',
      'How quickly does someone call a new enquiry back?',
      'Do you know how many paid clicks turn into booked work?',
    ],
    priority: 10,
  },
  {
    id: 'emergency_claim_without_after_hours_intake',
    storedCategory: 'after_hours',
    sourceCategory: 'after_hours_intake',
    requires: ['emergency_24_7_service'],
    absent: ['route_booking', 'tech_intercom', 'tech_tawk', 'tech_drift', 'tech_tidio',
      'tech_livechat'],
    text: 'The site advertises round-the-clock cover but offers no way to start a job '
      + 'outside office hours — no booking, no chat, only a number.',
    questions: [
      'Who picks up at two in the morning?',
      'What happens to the calls that go unanswered overnight?',
      'Would you rather capture those jobs or keep paying to be on call?',
    ],
    priority: 5,
  },
  {
    id: 'multiple_locations_one_route',
    storedCategory: 'customer_communication',
    sourceCategory: 'routing',
    requires: ['multiple_locations'],
    absent: ['route_booking'],
    text: 'More than one location, and one general way in for all of them, so somebody '
      + 'is sorting which branch a caller needs by hand.',
    questions: [
      'How does a call for one branch get to that branch?',
      'Does each location have its own number, or does the office route them?',
    ],
    priority: 20,
  },
  {
    id: 'hiring_front_office',
    storedCategory: 'repetitive_admin',
    sourceCategory: 'intake_capacity',
    requires: ['route_careers', 'visible_growth_hiring'],
    absent: [],
    text: 'They are hiring, which usually means the current team is at capacity — '
      + 'and some of what a new hire would absorb is repeatable intake work.',
    questions: [
      'What would the next hire spend most of their day doing?',
      'How much of that is answering the same questions?',
    ],
    priority: 30,
  },
  {
    id: 'call_tracking_without_followup_system',
    storedCategory: 'follow_up',
    sourceCategory: 'lead_conversion',
    requires: ['tech_callrail'],
    absent: ['tech_servicetitan', 'tech_housecall_pro', 'tech_jobber', 'tech_hubspot',
      'tech_gohighlevel'],
    text: 'They measure inbound calls carefully and nothing visible picks up what '
      + 'happens after the call — so the number that matters is counted and then '
      + 'left to memory.',
    questions: [
      'Where does a call go once it has been answered?',
      'How do you know which calls turned into work?',
      'Who chases the ones that did not book?',
    ],
    priority: 15,
  },
  {
    id: 'financing_without_fast_quote',
    storedCategory: 'unsold_estimate',
    sourceCategory: 'quote_follow_up',
    requires: ['financing_promoted'],
    absent: ['route_booking'],
    text: 'They promote financing, which is a tool for winning bigger jobs, and the '
      + 'only way to start one is a form somebody has to get back to.',
    questions: [
      'How long between a quote request and a quote?',
      'What happens to the estimates that never get a yes or a no?',
    ],
    priority: 25,
  },

  // --- trade-specific openings -------------------------------------------------
  {
    id: 'storm_demand_without_intake',
    storedCategory: 'speed_to_lead',
    sourceCategory: 'surge_capacity',
    requires: ['hail_repair_service'],
    absent: ['route_booking'],
    verticals: ['roofing', 'collision-repair', 'pdr-hail', 'restoration'],
    text: 'They sell into storm demand, which arrives all at once and goes to whoever '
      + 'answers first \u2014 and the only way in is a form somebody has to get back to.',
    questions: [
      'What happens to your phones the week after a storm?',
      'How many of those calls do you think go unanswered?',
      'Who follows up with the ones you could not get to?',
    ],
    priority: 8,
  },
  {
    id: 'insurance_work_without_status_updates',
    storedCategory: 'customer_communication',
    sourceCategory: 'claims_communication',
    requires: ['insurance_claim_assistance'],
    absent: ['route_customer_portal'],
    verticals: ['roofing', 'collision-repair', 'restoration', 'pdr-hail'],
    text: 'They handle insurance claims, which run for weeks, and there is no portal '
      + 'for a customer to check where theirs has got to \u2014 so the office fields '
      + '"any update?" by phone.',
    questions: [
      'How often does someone ring just to ask where their claim is?',
      'Who answers those calls, and what else were they doing?',
    ],
    priority: 18,
  },
  {
    id: 'consultation_offer_without_intake',
    storedCategory: 'intake',
    sourceCategory: 'consultation_intake',
    requires: ['online_quote_booking'],
    absent: ['route_booking', 'tech_calendly', 'tech_cal_com', 'tech_acuity'],
    verticals: ['law-firms'],
    text: 'They offer a consultation and there is no way to book one \u2014 every '
      + 'enquiry waits for somebody to call back, and the first firm to answer usually '
      + 'keeps the client.',
    questions: [
      'How quickly does a new enquiry get a call back?',
      'What happens to the ones that come in overnight or at the weekend?',
      'Do you know how many never get through?',
    ],
    priority: 8,
  },
  {
    id: 'membership_plan_without_portal',
    storedCategory: 'repetitive_admin',
    sourceCategory: 'membership_admin',
    requires: ['membership_plan_offered'],
    absent: ['route_customer_portal', 'route_payment_portal'],
    verticals: ['hvac', 'plumbing'],
    text: 'They sell a maintenance plan, which means recurring visits to schedule and '
      + 'recurring payments to chase, and there is no portal for either.',
    questions: [
      'How do plan members book their seasonal visit?',
      'Who keeps track of which members are due?',
      'How much of that is somebody working through a list by hand?',
    ],
    priority: 22,
  },
];

/**
 * The gap hypotheses this account's evidence supports.
 *
 * Requires that the site was actually read: without that, every `absent` clause is a
 * statement about our crawler rather than about the company, and a rep would be sent
 * into a call armed with our own failure.
 */
export async function deriveGapHypotheses(accountId: string): Promise<DerivedHypothesis[]> {
  const { rows: accountRows } = await query<{ vertical: string | null }>(
    'select primary_vertical_profile_id as vertical from accounts where account_id = $1',
    [accountId]);
  const vertical = (accountRows[0]?.vertical ?? '').toLowerCase();

  const { rows: runRows } = await query<{ pages: number }>(
    `select coalesce(max((adapter_results->>'pages_fetched')::int), 0) as pages
       from research_runs where account_id = $1`, [accountId]);
  if ((runRows[0]?.pages ?? 0) === 0) return [];

  const { rows } = await query<{ claim_key: string; evidence_id: string }>(
    `select claim_key, evidence_id from evidence_records
      where account_id = $1
        and contradicted_by_evidence_id is null
        and (expires_at is null or expires_at > now())`,
    [accountId]);

  const evidenceByKey = new Map<string, string[]>();
  for (const row of rows) {
    const held = evidenceByKey.get(row.claim_key) ?? [];
    held.push(row.evidence_id);
    evidenceByKey.set(row.claim_key, held);
  }

  const derived: DerivedHypothesis[] = [];
  for (const rule of GAP_RULES) {
    // A trade-specific opening has to be trade-specific or it is noise.
    if (rule.verticals && !rule.verticals.includes(vertical)) continue;
    const present = rule.requires.every((key) => evidenceByKey.has(key));
    if (!present) continue;
    const missing = rule.absent.every((key) => !evidenceByKey.has(key));
    if (!missing) continue;

    derived.push({
      hypothesisId: rule.id,
      sourceCategory: rule.sourceCategory,
      storedCategory: rule.storedCategory,
      text: rule.text,
      questions: rule.questions,
      // Both halves of the reasoning: what we saw, and nothing for what we did not,
      // because an absence has no evidence row to point at.
      supportingEvidenceIds: rule.requires.flatMap((key) => evidenceByKey.get(key) ?? []),
      priority: rule.priority,
      matchedSignals: [...rule.requires, ...rule.absent.map((key) => `absent:${key}`)],
    });
  }
  return derived;
}
