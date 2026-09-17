import type { Queryable } from '../db/pool.js';
import { query, withTransaction } from '../db/pool.js';
import { classifyEmail, normalizeCompanyName, registrableDomain } from '../domain/normalize.js';
import { loadAccountBundles } from './load.js';
import { classifyAccount, type AccountVerdict, type Finding } from './classify.js';

/**
 * The apply half of the remediation preview, authorised by Michael on 2026-09-17.
 *
 * The preview has said the same thing about production since it was written; this is the
 * part that acts on it. What it may do is narrow on purpose, and every instrument is
 * reversible:
 *
 *   a non-company is suppressed, not deleted -- `suppressions.is_active = false` puts it
 *   back and the trigger recomputes the flag;
 *   an unsupported trade is cleared, not replaced with a guess;
 *   a page-copy name is trimmed to a name the evidence already holds, never to a new one;
 *   an endpoint role is recomputed by the same classifier the product uses;
 *   and every change writes an `audit_log` row carrying the before and the after.
 *
 * Nothing here deletes an observation, a candidate, an evidence record or an Account.
 * Raw evidence is what makes a remediation auditable, and an audit of deleted evidence is
 * a story nobody can check.
 *
 * The five conditions, all of which must hold, re-checked per Account inside the
 * transaction rather than trusted from a preview taken minutes earlier:
 *
 *   1. no human sales activity on the Account;
 *   2. the finding is HIGH confidence and does not require review;
 *   3. the action leaves raw evidence untouched;
 *   4. an audit row records before and after;
 *   5. the action is reversible.
 */

export type RemediationAction =
  | 'SUPPRESS_NON_COMPANY'
  | 'CLEAR_UNSUPPORTED_VERTICAL'
  | 'TRIM_PAGE_COPY_NAME'
  | 'RECLASSIFY_ENDPOINT_ROLE'
  | 'VERIFY_FROM_SITE_IDENTITY';

export interface PlannedChange {
  accountId: string;
  companyName: string;
  action: RemediationAction;
  code: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ReviewItem {
  accountId: string;
  companyName: string;
  code: string;
  why: string;
}

export interface ApplyPlan {
  changes: PlannedChange[];
  review: ReviewItem[];
  protectedByHumanActivity: string[];
  accountsExamined: number;
}


/**
 * The hard guard: a source we could not read is not evidence against a company.
 *
 * Michael opened three Accounts that Research Health called "Broken Website" and found
 * three live HVAC businesses. Every one of them would have arrived at this code with a
 * research run that read nothing, and every negative instrument here would have had a
 * plausible-looking case to act on. None of those cases is evidence.
 *
 * So an Account whose site we could not read is exempt from every negative action --
 * suppression, trade removal, name replacement, legacy rejection -- and goes to review
 * instead. Not because the company is proven good, but because nothing was proven at
 * all, and unknown is not a reason to take something away from a rep.
 *
 * `NO_WEBSITE` is deliberately not in the list. Nothing failed there: an article
 * headline with no domain of its own has no site to read, and that absence is a fact
 * about the record rather than a failure of ours.
 *
 * A run written before the source state existed reports null, and null is treated as
 * unreadable. Most of production is in that state, and "we do not know why nothing was
 * read" has to behave like "we could not read it", never like "there was nothing there".
 */
const UNREADABLE_SOURCE_STATES = new Set([
  'REFUSED', 'UNREACHABLE', 'HTTP_ERROR', 'DISALLOWED',
]);

export function sourceWasUnreadable(research: {
  status?: string | null; sourceState?: string | null; pagesFetched?: number | null;
} | null): boolean {
  if (!research) return false;
  if (research.sourceState) return UNREADABLE_SOURCE_STATES.has(research.sourceState);
  // Older runs recorded only a count. Nothing read and the run did not complete is the
  // shape of a failure whose reason nobody kept.
  return (research.pagesFetched ?? 0) === 0 && research.status !== 'completed';
}

/** A finding the authorization covers: decisive, and not one a person must see first. */
function isActionable(finding: Finding): boolean {
  return finding.confidence === 'HIGH' && !finding.reviewRequired;
}

/**
 * A name the evidence already holds, contained in the name on the row.
 *
 * Two sources and no others. A resolver candidate whose normalized form is inside the
 * stored name -- the rule the preview already applies -- or a segment of the stored title
 * whose normalized form matches the Account's own domain. "HVAC Services in St.
 * Augustine, FL - Palatka - Southern Air" on `southernair.com` yields "Southern Air"; the
 * same string on a directory's domain yields nothing.
 *
 * Never a name from outside the stored one. Production holds candidate names belonging to
 * other cities and other companies, and replacing a bad name with a wrong one is worse: a
 * rep can see that a name reads like a page title and cannot see that it names somebody
 * else.
 */
export function proposeTrimmedName(input: {
  canonicalName: string;
  canonicalDomain: string | null;
  candidateNames: { name: string; basis: string | null }[];
  /** What the site calls itself, when it has been asked. */
  siteIdentity?: { name: string; basis: string | null } | null;
  /**
   * True when the record is shaped like a page rather than a company.
   *
   * The declaration rule below is refused for such a record, and this flag is the only
   * thing that refuses it. Without it the rule renames "10 Best Roofers in St.
   * Augustine, FL" to "Today's Homeowner", because a directory names itself on its own
   * domain exactly as convincingly as a contractor does. A page on somebody's site is
   * suppressed, not relabelled with the site's name.
   */
  recordLooksLikeAPage?: boolean;
}): { name: string; basis: string } | null {
  const stored = normalizeCompanyName(input.canonicalName);
  if (!stored) return null;

  /**
   * The site's own name, from the Account's own domain.
   *
   * Two shapes, and the second one needed the estate to be looked at before it could be
   * written honestly.
   *
   * The first is containment: "HVAC Services in St. Augustine, FL - Palatka - Southern
   * Air" becomes "Southern Air" because southernair.com says so and the stored name
   * already carries the words.
   *
   * The second is the case containment misses, and it is the common one. Production
   * holds "Top St. Augustine Roofing Contractor | Free Roof Inspection" on
   * hightideroofing.com, whose own schema.org block says "High Tide Roofing &
   * Waterproofing, Inc". The stored name contains none of that -- it is pure page copy
   * with no brand segment at all -- so containment refuses exactly the records that most
   * need fixing.
   *
   * What makes the replacement safe is not containment, it is *whose site said it*. A
   * machine-readable self-declaration, on the domain attributed to this Account, whose
   * name matches that domain, is the company naming itself. The domain check is the
   * load-bearing part: it is what stops a directory's own name -- "Today's Homeowner" on
   * todayshomeowner.com -- from being written onto a record that merely sits there,
   * because such a record is a page rather than a company and is handled by suppression
   * instead.
   */
  const site = input.siteIdentity;
  if (site) {
    const siteName = normalizeCompanyName(site.name);
    if (siteName.length >= 4 && siteName !== stored && stored.includes(siteName)) {
      return { name: site.name.trim(), basis: `the site's own name (${site.basis ?? 'first party'})` };
    }

    const declared = /SCHEMA_ORG_NAME|OG_SITE_NAME/.test(site.basis ?? '');
    const domain = input.canonicalDomain ? registrableDomain(input.canonicalDomain) : null;
    const domainStem = domain ? domain.split('.')[0]!.replace(/[^a-z0-9]/gi, '').toLowerCase() : null;
    const siteCompact = siteName.replace(/[^a-z0-9]/g, '');
    const namesItsOwnDomain = Boolean(domainStem && domainStem.length >= 5 && siteCompact.length >= 5
      && (domainStem.includes(siteCompact.slice(0, Math.min(siteCompact.length, 12)))
        || siteCompact.includes(domainStem)));
    if (declared && namesItsOwnDomain && siteName.length >= 4 && siteName !== stored
      && !input.recordLooksLikeAPage) {
      return {
        name: site.name.trim(),
        basis: `the company's own site declares it (${site.basis}), on its own domain ${domain}`,
      };
    }
  }

  const fromResolver = input.candidateNames
    .map((candidate) => ({ ...candidate, normalized: normalizeCompanyName(candidate.name) }))
    .filter((candidate) => candidate.normalized.length >= 4
      && candidate.normalized !== stored
      && stored.includes(candidate.normalized))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (fromResolver) {
    return { name: fromResolver.name.trim(), basis: `resolver candidate (${fromResolver.basis ?? 'no basis'})` };
  }

  const domain = input.canonicalDomain ? registrableDomain(input.canonicalDomain) : null;
  const domainStem = domain ? domain.split('.')[0]!.replace(/[^a-z0-9]/gi, '').toLowerCase() : null;
  if (!domainStem || domainStem.length < 5) return null;

  const segments = input.canonicalName
    .split(/[|–—]|\s-\s|:/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 3);
  for (const segment of segments) {
    const compact = normalizeCompanyName(segment).replace(/\s+/g, '');
    if (compact.length >= 5 && (domainStem.includes(compact) || compact.includes(domainStem))) {
      return { name: segment, basis: `title segment matching the Account's own domain ${domain}` };
    }
  }
  return null;
}

/** What would change, and what would not. Reads only. */
export async function planRemediation(limit: number | null = null): Promise<ApplyPlan> {
  const bundles = await loadAccountBundles(limit);
  const verdicts = bundles.map(classifyAccount);
  const changes: PlannedChange[] = [];
  const review: ReviewItem[] = [];
  const protectedByHumanActivity: string[] = [];

  for (const verdict of verdicts) {
    const bundle = bundles.find((entry) => entry.accountId === verdict.accountId)!;

    /**
     * Nothing negative happens to an Account whose website we could not read.
     *
     * The guard sits before every instrument rather than inside each one, so a new
     * instrument added later inherits it instead of having to remember it.
     */
    if (sourceWasUnreadable(bundle.latestResearch)) {
      const why = bundle.latestResearch?.sourceState
        ? `the last research run could not read the site (${bundle.latestResearch.sourceState.toLowerCase()})`
        : 'the last research run read nothing and did not record why';
      for (const finding of verdict.findings) {
        if (finding.code === 'VERTICAL_SUPPORTED' || finding.code === 'LOW_CONFIDENCE_FINDING') continue;
        review.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          code: finding.code,
          why: `${why}, and a source we could not read is not evidence against a company`,
        });
      }
      continue;
    }

    if (verdict.activityState === 'human_sales_activity') {
      protectedByHumanActivity.push(verdict.accountId);
      for (const finding of verdict.findings) {
        review.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          code: finding.code,
          why: 'a person has worked this Account, so nothing is changed automatically',
        });
      }
      continue;
    }

    for (const finding of verdict.findings) {
      if (!isActionable(finding)) {
        if (finding.code !== 'LOW_CONFIDENCE_FINDING' && finding.code !== 'VERTICAL_SUPPORTED') {
          review.push({
            accountId: verdict.accountId, companyName: verdict.canonicalName,
            code: finding.code,
            why: finding.reviewRequired ? 'the finding asks for a person' : `confidence ${finding.confidence}`,
          });
        }
        continue;
      }

      if (finding.code === 'NON_COMPANY_ENTITY') {
        changes.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          action: 'SUPPRESS_NON_COMPANY', code: finding.code, reason: finding.reason,
          before: { entityStatus: verdict.entityStatus, suppressed: false },
          after: { entityStatus: 'rejected', suppressed: true },
        });
        continue;
      }

      if (finding.code === 'VERTICAL_FROM_QUERY_ONLY' && bundle.verticalProfileId) {
        changes.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          action: 'CLEAR_UNSUPPORTED_VERTICAL', code: finding.code, reason: finding.reason,
          before: { verticalProfileId: bundle.verticalProfileId },
          after: { verticalProfileId: null },
        });
        continue;
      }

      if (finding.code === 'ENDPOINT_ROLE_PREDATES_RULE') {
        for (const email of bundle.emails) {
          const now = classifyEmail(email.normalizedValue,
            email.attributedToPersonName ? { attributedToPersonName: email.attributedToPersonName } : {});
          if (email.persistedRole === null || email.persistedRole === now) continue;
          changes.push({
            accountId: verdict.accountId, companyName: verdict.canonicalName,
            action: 'RECLASSIFY_ENDPOINT_ROLE', code: finding.code,
            reason: `${email.normalizedValue}: ${email.persistedRole} is not what today's rule gives`,
            before: { endpointId: email.endpointId, role: email.persistedRole },
            after: { endpointId: email.endpointId, role: now },
          });
        }
        continue;
      }
    }

    /**
     * A legacy record whose own site names it.
     *
     * `legacy_unverified` from a discovery run is not workable, which is correct while
     * nothing has confirmed the record names a company -- and it is also why 66 real
     * Roofing companies sit outside the rep's list. The only thing that moves one is
     * evidence: the site was read, it names itself, and the name it gives is the name on
     * the record. Anything less stays where it is, because promoting to reduce a count
     * is how an unverified record becomes a verified wrong one.
     */
    if (bundle.entityStatus === 'legacy_unverified' && bundle.siteIdentity
      && !verdict.findings.some((f) => f.code === 'NON_COMPANY_ENTITY')) {
      const stored = normalizeCompanyName(verdict.canonicalName);
      const site = normalizeCompanyName(bundle.siteIdentity.name);
      const agrees = site.length >= 4
        && (stored === site || stored.includes(site) || site.includes(stored));
      if (agrees) {
        changes.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          action: 'VERIFY_FROM_SITE_IDENTITY', code: 'LEGACY_UNVERIFIED',
          reason: `The site calls itself "${bundle.siteIdentity.name}", which is the name `
            + 'on this record, so something has now confirmed it names a company.',
          before: { entityStatus: 'legacy_unverified' },
          after: { entityStatus: 'verified' },
        });
      } else {
        review.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          code: 'LEGACY_UNVERIFIED',
          why: `the site calls itself "${bundle.siteIdentity.name}", which is not the name on the record`,
        });
      }
    }

    // Names are handled outside the actionable gate, because the preview marks every
    // name finding for review and tonight's authorization narrows that to the case where
    // the evidence already holds the shorter name.
    const nameFinding = verdict.findings.find((f) => f.code === 'CANONICAL_NAME_IS_PAGE_COPY');
    if (nameFinding) {
      const proposal = proposeTrimmedName({
        canonicalName: verdict.canonicalName,
        canonicalDomain: verdict.canonicalDomain,
        candidateNames: bundle.candidateResolvedNames,
        siteIdentity: bundle.siteIdentity,
        recordLooksLikeAPage: verdict.findings.some((f) => f.code === 'NON_COMPANY_ENTITY'),
      });
      if (proposal) {
        changes.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          action: 'TRIM_PAGE_COPY_NAME', code: nameFinding.code,
          reason: `${nameFinding.reason} The shorter name comes from ${proposal.basis}.`,
          before: { canonicalName: verdict.canonicalName },
          after: { canonicalName: proposal.name },
        });
      } else {
        review.push({
          accountId: verdict.accountId, companyName: verdict.canonicalName,
          code: nameFinding.code,
          why: 'no shorter name is held that the stored name already contains',
        });
      }
    }
  }

  return {
    changes, review, protectedByHumanActivity, accountsExamined: verdicts.length,
  };
}

/** Human activity, re-asked inside the transaction that is about to change something. */
async function hasHumanActivity(client: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await client.query<{ n: number }>(
    `select (
       (select count(*) from activities
         where account_id = $1 and (actor_user_id is not null
           or notes is not null or disposition is not null))
       + (select count(*) from ownership_events where account_id = $1)
       + (select count(*) from follow_ups where account_id = $1)
       + (select count(*) from opportunities where account_id = $1)
       + (select count(*) from contact_attempts where account_id = $1)
       + (select count(*) from meeting_bookings where account_id = $1)
       + (select count(*) from accounts where account_id = $1 and current_owner_user_id is not null)
     )::int as n`, [accountId]);
  return Number(rows[0]?.n ?? 0) > 0;
}

export interface ApplyResult {
  applied: PlannedChange[];
  skipped: { change: PlannedChange; why: string }[];
}

/**
 * Applies one Account's changes in one transaction.
 *
 * Per Account rather than per estate: a failure on the three hundredth must not roll back
 * the two hundred and ninety-nine that were right, and an operator watching `audit_log`
 * should see it fill rather than appear.
 */
export async function applyForAccount(
  accountId: string, changes: PlannedChange[],
): Promise<ApplyResult> {
  const applied: PlannedChange[] = [];
  const skipped: { change: PlannedChange; why: string }[] = [];

  await withTransaction(async (client) => {
    if (await hasHumanActivity(client, accountId)) {
      for (const change of changes) {
        skipped.push({ change, why: 'human sales activity appeared on this Account' });
      }
      return;
    }

    /**
     * Asked again here, and not trusted from the plan.
     *
     * A research run can finish between planning and applying, and the one that matters
     * is the one that is true when the change is written. The same reason the human
     * activity check lives inside the transaction.
     */
    const { rows: research } = await client.query<{
      status: string | null; source_state: string | null; pages_fetched: number | null;
    }>(
      `select status, adapter_results->>'source_state' as source_state,
              (adapter_results->>'pages_fetched')::int as pages_fetched
         from research_runs
        where account_id = $1 and completed_at is not null
        order by completed_at desc limit 1`, [accountId]);
    const unreadable = sourceWasUnreadable(research[0]
      ? { status: research[0].status, sourceState: research[0].source_state,
          pagesFetched: research[0].pages_fetched }
      : null);
    if (unreadable) {
      for (const change of changes) {
        skipped.push({
          change,
          why: 'the site could not be read, and a source we could not read is not '
            + 'evidence against a company',
        });
      }
      return;
    }

    for (const change of changes) {
      switch (change.action) {
        case 'SUPPRESS_NON_COMPANY': {
          await client.query(
            `insert into suppressions (scope, account_id, suppression_type, source, reason)
             values ('ACCOUNT', $1, 'WRONG_ENTITY', 'v2_remediation', $2)`,
            [accountId, change.reason.slice(0, 500)]);
          await client.query(
            `update accounts set entity_status = 'rejected',
                    entity_status_basis = $2, entity_status_at = now()
              where account_id = $1`,
            [accountId, 'V2 remediation: not a company']);
          break;
        }
        case 'CLEAR_UNSUPPORTED_VERTICAL': {
          await client.query(
            'update accounts set primary_vertical_profile_id = null where account_id = $1',
            [accountId]);
          break;
        }
        case 'TRIM_PAGE_COPY_NAME': {
          await client.query(
            'update accounts set canonical_name = $2, normalized_name = lower($2) where account_id = $1',
            [accountId, String(change.after['canonicalName'])]);
          break;
        }
        case 'RECLASSIFY_ENDPOINT_ROLE': {
          await client.query(
            'update contact_endpoints set endpoint_role = $2 where endpoint_id = $1',
            [String(change.after['endpointId']), String(change.after['role'])]);
          break;
        }
        case 'VERIFY_FROM_SITE_IDENTITY': {
          await client.query(
            `update accounts set entity_status = 'verified',
                    entity_status_basis = $2, entity_status_at = now()
              where account_id = $1 and entity_status = 'legacy_unverified'`,
            [accountId, 'V2 re-research: the company\'s own site names it']);
          break;
        }
      }

      await client.query(
        `insert into audit_log (action, subject_type, subject_id, reason, detail)
         values ($1, 'account', $2, $3, $4::jsonb)`,
        [`v2_remediation.${change.action}`, accountId, change.reason,
         JSON.stringify({ code: change.code, before: change.before, after: change.after })]);
      applied.push(change);
    }
  });

  return { applied, skipped };
}
