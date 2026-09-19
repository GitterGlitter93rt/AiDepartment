import { query } from '../db/pool.js';
import { previewStageDBatch } from './stageDPreview.js';

/**
 * SB-V2-6 — what the free stages actually produce, before anybody buys a contact list.
 *
 * The decision this exists to inform is whether to pay a contact-data vendor. That
 * decision needs three numbers nobody has: what first-party research alone yields, what
 * the public sources would add, and what the search stage would cost. This report
 * measures the first from what is in the database, says plainly that the second has not
 * run, and prices the third from the paid ledger without buying anything.
 *
 * Every rate carries the population it came from. "50%" off two accounts and off two
 * hundred are different facts, and the only way to tell them apart is to print both.
 *
 * The one measurement this file refuses to take at face value is the email one. 98 rows
 * in production carry the role DIRECT_PERSON_EMAIL and not one of them is linked to a
 * contact, so not one has a person attributed to it: the role was assigned from the
 * shape of the mailbox before the rule that now governs it existed. So a named email is
 * counted as one attributed to a person, and the difference between the two counts is
 * reported rather than hidden.
 */

export interface ContactYield {
  accounts: number;
  verified: number;
  withDomain: number;

  /** Stage A: the company's own website. */
  firstParty: {
    runs: number;
    completed: number;
    /** Ran, and read nothing: a source that was not there or refused us. */
    sourceUnavailable: number;
    averagePagesRead: number;
    /** Median seconds from a run starting to finishing. */
    medianLatencySeconds: number | null;
  };

  people: {
    /** A person named, not a role standing in for one. */
    namedDecisionMaker: number;
    /** A placeholder contact with no name: a front desk, not a decision maker. */
    roleOnly: number;
    /** No contact row at all, named or otherwise. */
    unresolved: number;
    /** Contacts carrying a role the evidence established. */
    withEstablishedRole: number;
  };

  email: {
    endpoints: number;
    /** Rows whose role says a person, whatever the evidence behind it. */
    roleSaysPerson: number;
    /** Rows where a person is actually attributed. This is the real figure. */
    attributedToPerson: number;
    roleInbox: number;
    general: number;
    guessed: number;
    accountsWithNamedEmail: number;
  };

  phone: {
    endpoints: number;
    mainLineOnly: number;
    direct: number;
    mobile: number;
    accountsWithDirectRoute: number;
  };

  /** Stages B and C. Reported as not run, never as nothing found. */
  officialSources: { state: 'NOT_RUN'; reason: string };

  /** Stage D, priced from the ledger and not executed. */
  searchStage: {
    state: 'PREVIEW_ONLY';
    accountsPreviewed: number;
    accountsNeedingNothing: number;
    averageQueriesPerAccount: number;
    unitCostUsd: number;
    estimatedCostPer100Usd: number;
    worstCasePer100Usd: number;
    /** Accounts a search cannot help until their stored name is fixed. */
    blockedByName: number;
  };
}

function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}% (${part} of ${whole})` : '— (0)';
}

export async function measureContactYield(sampleSize = 100): Promise<ContactYield> {
  const { rows: accountRows } = await query<Record<string, number>>(
    `select
       count(*)::int as accounts,
       count(*) filter (where entity_status = 'verified')::int as verified,
       count(*) filter (where canonical_domain is not null)::int as with_domain
     from accounts where merged_into_account_id is null and not is_suppressed`);
  const accounts = accountRows[0]!;

  const { rows: researchRows } = await query<Record<string, number | string | null>>(
    `select
       count(*)::int as runs,
       count(*) filter (where status = 'completed')::int as completed,
       count(*) filter (where status <> 'completed'
                          and coalesce((adapter_results->>'pages_fetched')::int, 0) = 0)::int
         as source_unavailable,
       round(avg(coalesce((adapter_results->>'pages_fetched')::int, 0)), 2)::text
         as average_pages,
       percentile_cont(0.5) within group (
         order by extract(epoch from (completed_at - started_at)))::numeric(10,1)::text
         as median_latency
     from research_runs`);
  const research = researchRows[0]!;

  /**
   * Three states, and they do not overlap.
   *
   * A role placeholder carries no name at all -- production holds 253 of them and not
   * one has a `full_name` -- so counting "role only" and "no name" separately counts
   * the same accounts twice and reports 79% twice over. Unresolved means neither: no
   * contact row of any kind, which is a different problem from having a front desk.
   */
  const { rows: peopleRows } = await query<Record<string, number>>(
    `select
       count(*) filter (where best_contact_name is not null
                          and coalesce(best_contact_is_role_only, false) = false)::int as named,
       count(*) filter (where best_contact_id is not null
                          and coalesce(best_contact_is_role_only, false))::int as role_only,
       count(*) filter (where best_contact_id is null)::int as unresolved
     from prospect_inventory where not is_suppressed`);
  const people = peopleRows[0]!;

  const { rows: roleRows } = await query<Record<string, number>>(
    `select count(*) filter (where company_relationship <> 'unknown')::int as with_role
       from contacts where status = 'ACTIVE'`);

  const { rows: emailRows } = await query<Record<string, number>>(
    `select
       count(*)::int as endpoints,
       count(*) filter (where endpoint_role = 'DIRECT_PERSON_EMAIL')::int as role_says_person,
       -- The only figure that means anything: a mailbox with a person attached to it.
       count(*) filter (where endpoint_role = 'DIRECT_PERSON_EMAIL'
                          and contact_id is not null)::int as attributed,
       count(*) filter (where endpoint_role = 'ROLE_EMAIL')::int as role_inbox,
       count(*) filter (where endpoint_role = 'GENERAL_BUSINESS_EMAIL')::int as general,
       count(*) filter (where quality_state = 'GUESSED_UNVERIFIED')::int as guessed,
       count(distinct account_id) filter (where endpoint_role = 'DIRECT_PERSON_EMAIL'
                          and contact_id is not null)::int as accounts_with_named
     from contact_endpoints where endpoint_type = 'EMAIL' and is_active`);
  const email = emailRows[0]!;

  const { rows: phoneRows } = await query<Record<string, number>>(
    `select
       count(*)::int as endpoints,
       count(*) filter (where endpoint_role = 'MAIN_BUSINESS_LINE')::int as main_only,
       count(*) filter (where endpoint_role = 'DIRECT_BUSINESS_LINE')::int as direct,
       count(*) filter (where endpoint_role = 'MOBILE_ASSERTED_BUSINESS')::int as mobile,
       count(distinct account_id) filter (
         where endpoint_role in ('DIRECT_BUSINESS_LINE','MOBILE_ASSERTED_BUSINESS','EXTENSION')
       )::int as accounts_with_direct
     from contact_endpoints where endpoint_type = 'PHONE' and is_active`);
  const phone = phoneRows[0]!;

  const stageD = await previewStageDBatch(sampleSize);
  const blockedByName = stageD.accounts.filter(
    (entry) => /page copy/.test(entry.plan.reason)).length;

  return {
    accounts: Number(accounts['accounts'] ?? 0),
    verified: Number(accounts['verified'] ?? 0),
    withDomain: Number(accounts['with_domain'] ?? 0),
    firstParty: {
      runs: Number(research['runs'] ?? 0),
      completed: Number(research['completed'] ?? 0),
      sourceUnavailable: Number(research['source_unavailable'] ?? 0),
      averagePagesRead: Number(research['average_pages'] ?? 0),
      medianLatencySeconds: research['median_latency'] === null
        ? null : Number(research['median_latency']),
    },
    people: {
      namedDecisionMaker: Number(people['named'] ?? 0),
      roleOnly: Number(people['role_only'] ?? 0),
      unresolved: Number(people['unresolved'] ?? 0),
      withEstablishedRole: Number(roleRows[0]?.['with_role'] ?? 0),
    },
    email: {
      endpoints: Number(email['endpoints'] ?? 0),
      roleSaysPerson: Number(email['role_says_person'] ?? 0),
      attributedToPerson: Number(email['attributed'] ?? 0),
      roleInbox: Number(email['role_inbox'] ?? 0),
      general: Number(email['general'] ?? 0),
      guessed: Number(email['guessed'] ?? 0),
      accountsWithNamedEmail: Number(email['accounts_with_named'] ?? 0),
    },
    phone: {
      endpoints: Number(phone['endpoints'] ?? 0),
      mainLineOnly: Number(phone['main_only'] ?? 0),
      direct: Number(phone['direct'] ?? 0),
      mobile: Number(phone['mobile'] ?? 0),
      accountsWithDirectRoute: Number(phone['accounts_with_direct'] ?? 0),
    },
    officialSources: {
      state: 'NOT_RUN',
      reason: 'Stages B and C are gated on a signed source-governance review. '
        + 'Nothing has been asked of them, so nothing has been found — which is not '
        + 'the same as their having nothing to say.',
    },
    searchStage: {
      state: 'PREVIEW_ONLY',
      accountsPreviewed: stageD.accounts.length,
      accountsNeedingNothing: stageD.alreadyAnswered,
      averageQueriesPerAccount: stageD.averageQueriesPerAccount,
      unitCostUsd: stageD.unitCostUsd,
      estimatedCostPer100Usd: stageD.estimatedCostPer100Usd,
      worstCasePer100Usd: stageD.worstCasePer100Usd,
      blockedByName,
    },
  };
}

/** The report as an operator reads it. Every rate carries its population. */
export function formatContactYield(measured: ContactYield): string {
  const lines: string[] = [];
  lines.push('CONTACT YIELD — what the free stages produce, and what a paid one would cost');
  lines.push('nothing in this report was bought\n');

  lines.push(`accounts measured            ${measured.accounts}`
    + `  (${measured.verified} verified, ${measured.withDomain} with a domain)`);
  lines.push('');

  lines.push('STAGE A — the company\'s own website');
  lines.push(`  research runs              ${measured.firstParty.runs}`);
  lines.push(`  read the site              ${rate(measured.firstParty.completed, measured.firstParty.runs)}`);
  lines.push(`  read nothing at all        ${rate(measured.firstParty.sourceUnavailable, measured.firstParty.runs)}`);
  lines.push(`  pages read per run         ${measured.firstParty.averagePagesRead}`);
  lines.push(`  median run latency         ${measured.firstParty.medianLatencySeconds ?? '—'}s`);
  lines.push('');

  lines.push('WHO WE CAN NAME');
  lines.push(`  named decision maker       ${rate(measured.people.namedDecisionMaker, measured.accounts)}`);
  lines.push(`  a role standing in for one ${rate(measured.people.roleOnly, measured.accounts)}`);
  lines.push(`  no contact of any kind     ${rate(measured.people.unresolved, measured.accounts)}`);
  lines.push(`  contacts with a role       ${measured.people.withEstablishedRole}`);
  lines.push('');

  lines.push('HOW WE CAN REACH THEM');
  lines.push(`  email endpoints            ${measured.email.endpoints}`);
  lines.push(`    role says a person       ${measured.email.roleSaysPerson}`);
  lines.push(`    person actually attached ${measured.email.attributedToPerson}`
    + (measured.email.roleSaysPerson > measured.email.attributedToPerson
      ? `   <- the difference is a role assigned from the shape of the mailbox`
      : ''));
  lines.push(`    role inbox               ${measured.email.roleInbox}`);
  lines.push(`    general                  ${measured.email.general}`);
  lines.push(`    guessed, never emailed   ${measured.email.guessed}`);
  lines.push(`  accounts with a named email ${rate(measured.email.accountsWithNamedEmail, measured.accounts)}`);
  lines.push(`  phone endpoints            ${measured.phone.endpoints}`);
  lines.push(`    main line only           ${measured.phone.mainLineOnly}`);
  lines.push(`    direct line              ${measured.phone.direct}`);
  lines.push(`    asserted mobile          ${measured.phone.mobile}`);
  lines.push(`  accounts with a direct route ${rate(measured.phone.accountsWithDirectRoute, measured.accounts)}`);
  lines.push('');

  lines.push('STAGES B & C — public registries');
  lines.push(`  ${measured.officialSources.state}: ${measured.officialSources.reason}`);
  lines.push('');

  lines.push('STAGE D — public search, priced and not run');
  lines.push(`  accounts previewed         ${measured.searchStage.accountsPreviewed}`);
  lines.push(`  need nothing bought        ${measured.searchStage.accountsNeedingNothing}`);
  lines.push(`    of which blocked by name ${measured.searchStage.blockedByName}`);
  lines.push(`  average queries per account ${measured.searchStage.averageQueriesPerAccount}`);
  lines.push(`  price per search           $${measured.searchStage.unitCostUsd.toFixed(4)}`);
  lines.push(`  estimated per 100 accounts $${measured.searchStage.estimatedCostPer100Usd.toFixed(2)}`);
  lines.push(`  worst case per 100         $${measured.searchStage.worstCasePer100Usd.toFixed(2)}`);
  lines.push('');

  lines.push('WHAT THIS DOES NOT SAY');
  lines.push('  It does not say a paid contact provider is unnecessary, and it does not');
  lines.push('  say one is needed. It says what the free stages have produced so far, on');
  lines.push('  this inventory, and what the cheapest paid stage would cost to try.');
  return lines.join('\n');
}
