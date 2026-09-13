import { query } from '../db/pool.js';

/**
 * Pre-meeting brief for the host.
 * Authority: outbound-sales-brain-calcom-strategy-call-booking-spec.md §11,
 * outbound-sales-brain-strategy-meeting-handoff-spec.md §2-§3.
 *
 * "Michael should not need to research the company from scratch before the
 * 15-minute call." The brief separates what the prospect actually said from what we
 * merely believe, and lists the questions already answered so they are not asked
 * again — the failure mode the handoff spec opens with.
 */

export interface PrepBrief {
  company: string;
  geography: string;
  vertical: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactConfidence: string | null;
  meetingObjective: string;
  /** Verbatim. Never paraphrased into something tidier. */
  prospectSaid: { text: string; capturedAt: Date; category: string }[];
  numbersTheyGave: string[];
  systemsTheyNamed: string[];
  objections: string[];
  /** Public research we believe but they have not confirmed. */
  observedContext: string[];
  primaryHypothesis: string | null;
  unknowns: string[];
  doNotAssume: string[];
  suggestedQuestions: string[];
  sourceCallPackId: string | null;
  sourceActivityId: number | null;
}

export async function buildPrepBrief(bookingId: string): Promise<PrepBrief | null> {
  const { rows: bookingRows } = await query<{
    account_id: string; contact_id: string | null; activity_id: number | null;
    company: string; geography: string; vertical: string | null;
    contact_name: string | null; contact_title: string | null; contact_confidence: string | null;
    hypothesis: string | null;
  }>(
    `select b.account_id, b.contact_id, b.activity_id,
            pi.company_name as company, pi.geography_summary as geography,
            pi.primary_vertical_profile_id as vertical,
            c.full_name as contact_name, c.raw_title as contact_title,
            c.role_confidence as contact_confidence,
            pi.primary_hypothesis as hypothesis
       from meeting_bookings b
       join prospect_inventory pi on pi.account_id = b.account_id
       left join contacts c on c.contact_id = b.contact_id
      where b.booking_id = $1`,
    [bookingId],
  );
  const booking = bookingRows[0];
  if (!booking) return null;

  // What they actually said outranks everything else in the brief.
  const { rows: statements } = await query<{
    statement_text: string; captured_at: Date; category: string;
  }>(
    `select statement_text, captured_at, category from prospect_statements
      where account_id = $1 order by captured_at desc limit 20`,
    [booking.account_id],
  );

  const { rows: activityRows } = await query<{ notes: string | null; payload: any; disposition: string | null }>(
    `select notes, payload, disposition from activities
      where account_id = $1 and disposition is not null
      order by occurred_at desc limit 10`,
    [booking.account_id],
  );

  // Only evidence that is still live and still statable becomes observed context.
  const { rows: evidence } = await query<{ claim_text: string; can_state_as_fact: boolean }>(
    `select claim_text, can_state_as_fact from evidence_records
      where account_id = $1 and contradicted_by_evidence_id is null
        and (expires_at is null or expires_at > now())
        and confidence in ('confirmed','likely')
      order by precedence_rank asc, observed_at desc limit 12`,
    [booking.account_id],
  );

  const { rows: hypothesisRows } = await query<{
    hypothesis_text: string; missing_fact_questions: string[]; category: string;
  }>(
    `select hypothesis_text, missing_fact_questions, category from opportunity_hypotheses
      where account_id = $1 and is_current order by priority asc limit 2`,
    [booking.account_id],
  );

  const numbers = statements
    .map((statement) => statement.statement_text.match(/[^.]*\b\d[\d,.]*\b[^.]*/g) ?? [])
    .flat().map((text) => text.trim()).filter(Boolean).slice(0, 6);

  const objections = activityRows
    .filter((row) => row.disposition === 'NOT_A_FIT' || row.notes?.match(/but|however|concern|worried/i))
    .map((row) => row.notes ?? '').filter(Boolean).slice(0, 4);

  return {
    company: booking.company,
    geography: booking.geography,
    vertical: booking.vertical,
    contactName: booking.contact_name,
    contactTitle: booking.contact_title,
    contactConfidence: booking.contact_confidence,
    meetingObjective:
      'Map the workflow they described, get the real numbers, and decide together whether there '
      + 'is a business case worth pursuing. Not a pitch.',
    prospectSaid: statements.map((statement) => ({
      text: statement.statement_text,
      capturedAt: statement.captured_at,
      category: statement.category,
    })),
    numbersTheyGave: numbers,
    systemsTheyNamed: extractSystems(statements.map((s) => s.statement_text).join(' ')),
    objections,
    observedContext: evidence.filter((row) => row.can_state_as_fact).map((row) => row.claim_text),
    primaryHypothesis: hypothesisRows[0]?.hypothesis_text ?? booking.hypothesis,
    unknowns: evidence.filter((row) => !row.can_state_as_fact)
      .map((row) => `${row.claim_text} — believed, not confirmed`),
    doNotAssume: [
      'Do not state their ad spend, close rate or missed-call rate — they have not given those.',
      'Do not assume which systems they run beyond the ones listed above.',
      'Do not present a price or a packaged solution before the workflow is mapped.',
    ],
    suggestedQuestions: (hypothesisRows[0]?.missing_fact_questions ?? []).slice(0, 3).length > 0
      ? (hypothesisRows[0]?.missing_fact_questions ?? []).slice(0, 3)
      : [
          'Walk me through what happens today, from the moment that enquiry arrives.',
          'Where in that does it most often go wrong?',
          'What would have to be true for this to be worth fixing this quarter?',
        ],
    sourceCallPackId: null,
    sourceActivityId: booking.activity_id,
  };
}

const KNOWN_SYSTEMS = [
  'servicetitan', 'housecall pro', 'jobber', 'salesforce', 'hubspot', 'zoho', 'pipedrive',
  'callrail', 'podium', 'quickbooks', 'acculynx', 'jobnimbus', 'clio', 'dentrix',
];

function extractSystems(text: string): string[] {
  const lower = text.toLowerCase();
  return KNOWN_SYSTEMS.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(lower);
  });
}

/** Stores the brief on the booking so the host sees the same thing later. */
export async function persistPrepBrief(bookingId: string): Promise<PrepBrief | null> {
  const brief = await buildPrepBrief(bookingId);
  if (!brief) return null;
  await query('update meeting_bookings set prep_brief = $2 where booking_id = $1',
    [bookingId, JSON.stringify(brief)]);
  return brief;
}
