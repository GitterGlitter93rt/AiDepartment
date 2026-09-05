import { query } from '../db/pool.js';
import { getVerticalProfile } from '../domain/verticals.js';

/**
 * Call Pack assembly.
 * Authority: outbound-sales-brain-call-pack-spec.md, data-contract §20.
 *
 * A Call Pack is what the agent is allowed to know and allowed to say. Every fact
 * in it traces to an evidence record; every hypothesis is labelled a hypothesis;
 * and `prohibitedClaims` names the things that must not be said out loud even
 * though we may privately suspect them.
 *
 * Immutable once written — a material research change produces a new pack rather
 * than editing one a call already used.
 */

export interface CallPackFact {
  claim: string;
  source: string;
  observedAt: Date;
  /** Only a fact with this true may be stated on the call. */
  canStateAsFact: boolean;
}

export interface CallPack {
  callPackId: string | null;
  accountId: string;
  companyName: string;
  geography: string;
  vertical: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactIsRoleOnly: boolean;
  askForRoute: string | null;
  /** Facts safe to reference out loud. */
  confirmedFacts: CallPackFact[];
  /** Things we do not know and must not assume. */
  importantUnknowns: string[];
  primaryHypothesis: string | null;
  primaryHypothesisCategory: string | null;
  backupHypothesis: string | null;
  backupHypothesisCategory: string | null;
  firstQuestion: string | null;
  backupQuestion: string | null;
  likelyObjections: string[];
  knownSystems: string[];
  prohibitedClaims: string[];
  allowedNextSteps: string[];
  /** Every offer family we may mention, from the repo's commercial truth. */
  commercialTruth: string;
}

/**
 * Claims that must never be made on a cold call, regardless of what research
 * suggests. Sourced from Module 4A (§10, §16, §23) and the vertical profile's own
 * must_not_claim list.
 */
const UNIVERSAL_PROHIBITIONS = [
  'Do not state or estimate their advertising spend.',
  'Do not state a missed-call rate, close rate, or revenue figure they have not given you.',
  'Do not assert which CRM, phone system or software they use unless they say so.',
  'Do not claim a referral, a prior conversation, or that you are returning their call.',
  'Do not promise ROI, savings, or results.',
  'Do not position this as replacing or reducing their staff.',
  'Do not quote a price or describe a packaged solution on a first call.',
  'Do not claim every missed call would have become a customer.',
];

export async function buildCallPack(accountId: string): Promise<CallPack | null> {
  const { rows } = await query<{
    account_id: string; company_name: string; geography_summary: string;
    primary_vertical_profile_id: string | null; best_contact_name: string | null;
    best_contact_title: string | null; best_contact_is_role_only: boolean | null;
    best_contact_role: string | null; is_suppressed: boolean;
    primary_hypothesis: string | null; primary_hypothesis_category: string | null;
  }>(
    `select account_id, company_name, geography_summary, primary_vertical_profile_id,
            best_contact_name, best_contact_title, best_contact_is_role_only, best_contact_role,
            is_suppressed, primary_hypothesis, primary_hypothesis_category
       from prospect_inventory where account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account) return null;
  // A suppressed account never gets a Call Pack. There is nothing to prepare for.
  if (account.is_suppressed) return null;

  // Only live, unexpired, statable evidence may be referenced out loud.
  const { rows: evidenceRows } = await query<{
    claim_text: string; source_type: string; observed_at: Date; can_state_as_fact: boolean;
    claim_key: string;
  }>(
    `select claim_text, source_type, observed_at, can_state_as_fact, claim_key
       from evidence_records
      where account_id = $1
        and contradicted_by_evidence_id is null
        and (expires_at is null or expires_at > now())
        and confidence in ('confirmed','likely')
      order by precedence_rank asc, observed_at desc
      limit 25`,
    [accountId],
  );

  const confirmedFacts: CallPackFact[] = evidenceRows
    .filter((row) => row.can_state_as_fact)
    .map((row) => ({
      claim: row.claim_text,
      source: row.source_type,
      observedAt: row.observed_at,
      canStateAsFact: true,
    }));

  // Anything observed but not statable becomes an explicit unknown, so the agent
  // knows the topic exists without being able to assert it.
  const importantUnknowns: string[] = evidenceRows
    .filter((row) => !row.can_state_as_fact)
    .slice(0, 6)
    .map((row) => `${row.claim_key.replace(/_/g, ' ')} — suspected, not confirmed; ask rather than assert`);

  const { rows: hypothesisRows } = await query<{
    category: string; hypothesis_text: string; missing_fact_questions: string[];
  }>(
    `select category, hypothesis_text, missing_fact_questions
       from opportunity_hypotheses where account_id = $1 and is_current
      order by priority asc limit 2`,
    [accountId],
  );

  const { rows: statementRows } = await query<{ statement_text: string; category: string }>(
    `select statement_text, category from prospect_statements
      where account_id = $1 order by captured_at desc limit 10`,
    [accountId],
  );
  // What they have already told us is the strongest thing in the pack, and the one
  // thing we must not make them repeat.
  for (const statement of statementRows) {
    confirmedFacts.unshift({
      claim: `They previously said: "${statement.statement_text}"`,
      source: 'prospect_statement',
      observedAt: new Date(),
      canStateAsFact: true,
    });
  }

  const { rows: systemRows } = await query<{ normalized_value: string }>(
    `select distinct normalized_value from evidence_records
      where account_id = $1 and claim_key = 'crm_provider' and normalized_value is not null
        and contradicted_by_evidence_id is null`,
    [accountId],
  );

  const profile = account.primary_vertical_profile_id
    ? await getVerticalProfile(account.primary_vertical_profile_id) : null;

  const prohibitedClaims = [...UNIVERSAL_PROHIBITIONS];
  for (const hypothesis of profile?.opportunity_hypotheses ?? []) {
    for (const item of hypothesis?.must_not_claim ?? []) {
      const rendered = `Do not claim: ${String(item).replace(/_/g, ' ')}.`;
      if (!prohibitedClaims.includes(rendered)) prohibitedClaims.push(rendered);
    }
  }
  if (importantUnknowns.some((unknown) => /google|meta|ad/.test(unknown))) {
    prohibitedClaims.push('Advertising evidence is not fresh enough to describe in the present tense.');
  }

  const likelyObjections = [
    'We already use ChatGPT.',
    'We already have a receptionist.',
    'We already have a CRM.',
    'We have an IT company.',
    'We have a marketing agency.',
    'Send me an email.',
    "I'm busy right now.",
  ];

  return {
    callPackId: null,
    accountId: account.account_id,
    companyName: account.company_name,
    geography: account.geography_summary,
    vertical: account.primary_vertical_profile_id,
    contactName: account.best_contact_is_role_only ? null : account.best_contact_name,
    contactTitle: account.best_contact_title,
    contactIsRoleOnly: Boolean(account.best_contact_is_role_only) || !account.best_contact_name,
    askForRoute: account.best_contact_is_role_only || !account.best_contact_name
      ? (account.best_contact_role ?? 'operations')
      : null,
    confirmedFacts,
    importantUnknowns,
    primaryHypothesis: hypothesisRows[0]?.hypothesis_text ?? account.primary_hypothesis,
    primaryHypothesisCategory: hypothesisRows[0]?.category ?? account.primary_hypothesis_category,
    backupHypothesis: hypothesisRows[1]?.hypothesis_text ?? null,
    backupHypothesisCategory: hypothesisRows[1]?.category ?? null,
    firstQuestion: hypothesisRows[0]?.missing_fact_questions?.[0] ?? null,
    backupQuestion: hypothesisRows[1]?.missing_fact_questions?.[0] ?? null,
    likelyObjections,
    knownSystems: systemRows.map((row) => row.normalized_value),
    prohibitedClaims,
    allowedNextSteps: [
      'Book a short strategy call with Michael',
      'Agree a specific callback time',
      'Send one short email about the specific problem discussed',
      'Record a clear no-need and stop',
    ],
    commercialTruth:
      'YAD looks at how a business generates leads, handles customers, follows up, moves information '
      + 'and uses employee time, then identifies where opportunities or capacity are leaking. '
      + 'No pricing, no packaged solution, and no promised outcome may be discussed on a cold call.',
  };
}

/** Persists a Call Pack so a call can be traced to exactly what it knew. */
export async function persistCallPack(pack: CallPack, contactId: string | null): Promise<string> {
  const { rows } = await query<{ call_pack_id: string }>(
    `insert into call_packs (account_id, contact_id, vertical_profile_id, expires_at,
                             company_summary, top_confirmed_facts, important_unknowns,
                             primary_hypothesis, backup_hypothesis, primary_hook,
                             recommended_opener, first_questions, likely_objections,
                             known_system_signals, prohibited_claims, allowed_next_steps,
                             commercial_truth_summary)
     values ($1,$2,$3, now() + interval '48 hours',
             $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning call_pack_id`,
    [
      pack.accountId, contactId, pack.vertical,
      `${pack.companyName} — ${pack.geography}`,
      JSON.stringify(pack.confirmedFacts),
      JSON.stringify(pack.importantUnknowns),
      pack.primaryHypothesis, pack.backupHypothesis, pack.primaryHypothesisCategory,
      pack.firstQuestion,
      JSON.stringify([pack.firstQuestion, pack.backupQuestion].filter(Boolean)),
      JSON.stringify(pack.likelyObjections),
      JSON.stringify(pack.knownSystems),
      JSON.stringify(pack.prohibitedClaims),
      JSON.stringify(pack.allowedNextSteps),
      pack.commercialTruth,
    ],
  );
  return rows[0]!.call_pack_id;
}
