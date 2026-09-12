import { query } from '../db/pool.js';
import { researchPictureFor, UNKNOWING, type ResearchPicture } from './researchFacts.js';
import { SCORE_VERSION } from '../scoring/model.js';
import { entityGate } from './entityStatus.js';
import { automatedDiscoveryPredicate } from './discoverySources.js';

/**
 * Whether a record is something a rep can actually work, or only something we found.
 *
 * Discovery finding a company and research finishing with it are different events,
 * and the portal treated the first as though it were the second: a name, a URL and a
 * tier appeared in Find Prospects, and a rep opened it to nothing they could act on.
 * The cost is not a wasted click -- it is a rep learning that the list is unreliable,
 * which is expensive to undo.
 *
 * Readiness is a contract with named requirements, each one machine-evaluable and
 * each one explaining itself when it is not met. A record that fails any of them is
 * RESEARCH_NEEDED, which is a queue rather than a verdict: it names the work left to
 * do rather than telling a rep the company is bad.
 *
 * Deliberately not a score. Nine requirements averaged into a number is a number
 * nobody can act on; a rep needs to know which one is missing, because the answer is
 * a different next step in every case.
 */

export type ReadinessState = 'REP_READY' | 'RESEARCH_NEEDED' | 'NOT_WORKABLE';

export interface ReadinessRequirement {
  key: string;
  /** What this requirement is, in the words an operator would use. */
  label: string;
  met: boolean;
  /** Why it is not met, and what would meet it. Empty when it is. */
  detail: string;
  /**
   * True when nothing a research run does can fix this -- suppression, a DNC
   * listing, a merge tombstone. These are not work items, and putting them in the
   * same list as "no phone number yet" is how a rep spends a morning on a company
   * they are not allowed to call.
   */
  blocking: boolean;
}

export interface Readiness {
  state: ReadinessState;
  requirements: ReadinessRequirement[];
  /** Requirements not met, in the order they should be worked. */
  missing: ReadinessRequirement[];
  /** One sentence for the top of the record. */
  summary: string;
}

interface AccountRow {
  account_id: string;
  canonical_name: string;
  normalized_name: string;
  primary_vertical_profile_id: string | null;
  manual_score: number | null;
  manual_tier: string | null;
  score_version: string | null;
  is_suppressed: boolean;
  suppression_summary: string | null;
  merged_into_account_id: string | null;
  last_researched_at: Date | null;
  entity_status: string | null;
  /** True when a discovery run created this, rather than an import or a person. */
  found_by_machine: boolean;
}

/**
 * Names that are not company names.
 *
 * Discovery can produce a heading, a category page or a slogan, and the adapter
 * dropping the worst of them does not mean none arrive. A rep handed "HVAC
 * Contractors Near You" as a company loses trust in every row beside it.
 */
const NOT_A_COMPANY = [
  /^(hvac|roofing|plumbing|electrical|dental)\s+(contractors?|companies|services)\b/i,
  /\bnear\s+(me|you)\b/i,
  /^(best|top|cheap|affordable)\s+\d*\s*\w+/i,
  /^\d+\s+best\b/i,
];

function looksLikeACompany(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  return !NOT_A_COMPANY.some((pattern) => pattern.test(trimmed));
}

export async function readinessFor(
  accountId: string, picture?: ResearchPicture,
): Promise<Readiness | null> {
  const { rows } = await query<AccountRow>(
    `select account_id, canonical_name, normalized_name, primary_vertical_profile_id,
            manual_score, manual_tier, score_version, is_suppressed, suppression_summary,
            merged_into_account_id, last_researched_at, entity_status,
            exists (select 1 from activities act
                     where act.account_id = accounts.account_id
                       and act.activity_type = 'DISCOVERED'
                       and ${automatedDiscoveryPredicate('act.source_system')}) as found_by_machine
       from accounts where account_id = $1`, [accountId]);
  const account = rows[0];
  if (!account) return null;

  const research = picture ?? await researchPictureFor(accountId);
  const requirements: ReadinessRequirement[] = [];
  const add = (
    key: string, label: string, met: boolean, detail: string, blocking = false,
  ): void => { requirements.push({ key, label, met, detail, blocking }); };

  // --- things no amount of research can fix ------------------------------------
  add('not_merged', 'Not a duplicate redirect',
    account.merged_into_account_id === null,
    account.merged_into_account_id === null ? ''
      : 'This record was merged into another one. Work the surviving Account instead.',
    true);

  add('not_suppressed', 'Not suppressed',
    !account.is_suppressed,
    account.is_suppressed
      ? `Suppressed: ${account.suppression_summary ?? 'no reason recorded'}. Do not contact.`
      : '',
    true);

  // --- identity ----------------------------------------------------------------
  //
  // Two separate questions, deliberately, and they used to be one.
  //
  // The first is whether this record has been established to refer to an operating
  // business at all. That is a fact about provenance, it is decided by the resolver
  // at discovery time, and no amount of research changes it: research on a directory
  // page completes successfully and produces a directory. It is blocking.
  //
  // The second is whether the name reads like a company's. It is a weaker, textual
  // check, and it stays because a verified entity can still carry a bad name.
  const gate = entityGate({
    entityStatus: account.entity_status, foundByMachine: account.found_by_machine });
  add('entity', 'Established to be a company', gate.workable, gate.reason, true);

  add('identity', 'A company, with a name that is one',
    looksLikeACompany(account.canonical_name),
    looksLikeACompany(account.canonical_name) ? ''
      : `"${account.canonical_name}" reads as a heading or a category rather than a `
        + 'company. It came from a search result and nothing has confirmed it names a '
        + 'business.');

  const { rows: locationRows } = await query<{ n: number }>(
    `select count(*)::int as n from locations
      where account_id = $1 and (city is not null or postal_code is not null
                                 or state_region is not null)`, [accountId]);
  const located = (locationRows[0]?.n ?? 0) > 0;
  add('geography', 'Somewhere to place them', located,
    located ? '' : 'No city, state or postal code is on record, so this company cannot '
      + 'be searched for, assigned to a market, or called at a sensible hour.');

  // A vertical may be honestly unknown; what it may not be is silently absent while
  // scoring and search behave as though it were known.
  add('vertical', 'A vertical, or an explicit unknown',
    account.primary_vertical_profile_id !== null,
    account.primary_vertical_profile_id !== null ? ''
      : 'No vertical is set. Scoring reads its rules from the vertical profile, so an '
        + 'Account without one is scored against nothing and ranked as though that '
        + 'were a finding.');

  // --- how to reach them -------------------------------------------------------
  const contactRoute = research.facts.find((fact) => fact.key === 'contact_route');
  add('contact_route', 'A way to reach them, or a job to find one',
    contactRoute?.state === 'YES',
    contactRoute?.state === 'YES' ? ''
      : contactRoute?.state === 'NOT_CHECKED'
        ? 'Nobody has looked for a phone number or an email yet. Contact research is '
          + 'the next step, not a different prospect.'
        : 'Research ran and found no usable contact route. This needs contact research '
          + 'with a wider source, not a rep.');

  const decisionMaker = research.facts.find((fact) => fact.key === 'decision_maker');
  // A named person is not required -- most cold calls start with a gatekeeper. What
  // is required is that somebody looked, so a rep knows whether to ask by name.
  add('decision_maker_attempted', 'Somebody has looked for a name',
    decisionMaker?.state !== 'NOT_CHECKED',
    decisionMaker?.state !== 'NOT_CHECKED' ? ''
      : 'No research has looked for a decision-maker, so a rep cannot know whether to '
        + 'ask for someone by name or to start with the gatekeeper.');

  // --- what we know about them -------------------------------------------------
  const websiteRead = research.facts.find((fact) => fact.key === 'website_read');
  add('research_attempted', 'The research attempt has an outcome',
    websiteRead?.state !== 'NOT_CHECKED' || Boolean(account.last_researched_at),
    websiteRead?.state !== 'NOT_CHECKED' || account.last_researched_at ? ''
      : 'No research has run against this company, so everything below the name is '
        + 'blank for want of looking rather than for want of facts.');

  // Advertising does not have to be confirmed. It has to be honest: a state that
  // says which kind of not-knowing it is, rather than a false negative.
  const advertising = research.facts.filter((fact) => fact.key.startsWith('advertising_'));
  const dishonest = advertising.filter(
    (fact) => !UNKNOWING.has(fact.state) && fact.state !== 'YES');
  add('advertising_honest', 'The advertising picture is honest',
    advertising.length > 0 && dishonest.length === 0,
    advertising.length === 0
      ? 'No advertising picture could be built for this company.'
      : dishonest.length === 0 ? ''
        : `${dishonest.map((fact) => fact.key).join(', ')} claims something the evidence `
          + 'does not support.');

  // Three distinct answers, not two. "Scored under an older ruleset" was previously
  // treated as scored, so after a SCORE_VERSION bump a superseded tier read as the
  // current Module 4C opinion on every rep-facing surface -- the account page said
  // SUPERSEDED and the operations page counted it, but the record a rep opens said
  // it was scored. A historical score may stay visible as provenance; it may not be
  // presented as the current answer.
  //
  // Not blocking: `recomputeStaleScores()` in the worker sweep is the work that
  // meets this, so it is a work item rather than a wall.
  const scoredUnderCurrentPolicy = account.score_version === SCORE_VERSION;
  add('scored', 'Scored against what we know',
    account.manual_tier !== null && scoredUnderCurrentPolicy,
    account.manual_tier === null
      ? 'Not scored yet, so its position in a ranked list is not a judgement about the '
        + 'company. A tier arrives with research.'
      : account.score_version === null
        ? 'Scored under an unrecorded policy, so this score cannot be compared with '
          + 'any other.'
        : !scoredUnderCurrentPolicy
          ? `Scored under ${account.score_version}; the current ruleset is `
            + `${SCORE_VERSION}. The tier shown is the older opinion and is awaiting `
            + 'recompute, so it should not be read as the current judgement.'
          : '');

  // --- may we call them --------------------------------------------------------
  const { rows: screenRows } = await query<{ screened: number; phones: number }>(
    `select count(distinct s.endpoint_id)::int as screened,
            count(distinct e.endpoint_id)::int as phones
       from contact_endpoints e
       left join dnc_screen_log s on s.endpoint_id = e.endpoint_id
      where e.account_id = $1 and e.endpoint_type = 'PHONE'
        and e.is_active and not e.is_suppressed`, [accountId]);
  const phones = screenRows[0]?.phones ?? 0;
  const screened = screenRows[0]?.screened ?? 0;
  add('dnc_checked', 'Every number has been screened',
    phones === 0 || screened >= phones,
    phones === 0
      ? ''
      : screened >= phones ? ''
        : `${phones - screened} of ${phones} number(s) have never been screened against `
          + 'the do-not-call registry. Screening is fail-closed, so they cannot be '
          + 'dialled until it runs.');

  const missing = requirements.filter((requirement) => !requirement.met);
  const blocked = missing.filter((requirement) => requirement.blocking);

  const state: ReadinessState = blocked.length > 0 ? 'NOT_WORKABLE'
    : missing.length > 0 ? 'RESEARCH_NEEDED'
    : 'REP_READY';

  return {
    state,
    requirements,
    missing,
    summary: state === 'REP_READY'
      ? 'Ready to work: identified, located, researched, scored and screened.'
      : state === 'NOT_WORKABLE'
        ? blocked[0]!.detail
        : `${missing.length} thing(s) still to do before a rep should open this: `
          + `${missing.map((requirement) => requirement.label.toLowerCase()).join('; ')}.`,
  };
}

/** How many of a set of Accounts a rep could actually work. */
export async function readinessCounts(accountIds: string[]): Promise<{
  repReady: number; researchNeeded: number; notWorkable: number;
}> {
  const counts = { repReady: 0, researchNeeded: 0, notWorkable: 0 };
  for (const accountId of accountIds) {
    const readiness = await readinessFor(accountId);
    if (!readiness) continue;
    if (readiness.state === 'REP_READY') counts.repReady += 1;
    else if (readiness.state === 'NOT_WORKABLE') counts.notWorkable += 1;
    else counts.researchNeeded += 1;
  }
  return counts;
}
