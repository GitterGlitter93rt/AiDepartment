import { query } from '../db/pool.js';
import { politeFetch } from '../resolver/fetcher.js';
import { stripTags, peopleFromJsonLd, peopleFromText, extractJsonLd, endpointsFromHtml }
  from '../resolver/adapters/firstParty.js';
import { classifySourceRole, provenanceForRole, isFirstParty, type SourceRole }
  from './sourceRole.js';

/**
 * Reading the search results, rather than reading Google's summary of them.
 *
 * A snippet is what a page is about according to somebody who is not the page. Michael's
 * instruction is the whole of this module: run the grounded search, take up to fifty
 * organic results, classify every one of them, open the ones that could carry identity
 * or contact evidence, and read what is actually there.
 *
 * It also has to answer whether that was worth paying for. Every result keeps its rank,
 * every fact keeps the rank it was first found at and the exact page URL it came from,
 * so "page one was enough" and "the owner's name was on result thirty-seven" are both
 * findable afterwards instead of being matters of opinion.
 */

/** Roles worth the bandwidth of opening. */
const WORTH_OPENING: ReadonlySet<SourceRole> = new Set<SourceRole>([
  'COMPANY_OWNED_SITE', 'COMPANY_LOCATION_PAGE', 'COMPANY_SERVICE_PAGE',
  'COMPANY_BLOG_PAGE', 'SOCIAL_PROFILE', 'DIRECTORY', 'NEWS_OR_PUBLISHER',
  'GOVERNMENT', 'LICENSING_DATABASE', 'MANUFACTURER_LOCATOR',
]);

/** Never opened: a lead-generation funnel has nothing to say about a company. */
const NOT_WORTH_OPENING: ReadonlySet<SourceRole> = new Set<SourceRole>([
  'LEAD_GEN_DIRECTORY', 'VIDEO', 'FORUM', 'MARKETPLACE', 'AGGREGATOR', 'UNKNOWN',
]);

export interface SerpResultInput {
  rank: number;
  url: string;
  title: string | null;
  snippet?: string | null;
}

export type FactKind =
  | 'PERSON_NAME' | 'PERSON_ROLE' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'COMPANY_IDENTITY';

export interface PageFacts {
  kinds: FactKind[];
  people: { name: string; title: string | null }[];
  emails: string[];
  phones: string[];
  count: number;
}

/** The words that mark a page as carrying the thing we are looking for. */
const ROLE_WORDS =
  /\b(owner|founder|co-founder|president|principal|ceo|chief executive|general manager|operations manager|managing (member|partner)|proprietor|vice president)\b/i;

/**
 * What a page actually says, as opposed to what a snippet claims it says.
 *
 * Deliberately reuses the first-party extractors rather than growing a second set: a
 * person found on a BBB page and a person found on a company's About page must be
 * recognised by the same rules, or the two sources disagree for reasons that have
 * nothing to do with the sources.
 */
export function factsOnPage(html: string, url: string): PageFacts {
  const text = stripTags(html);
  const jsonLd = extractJsonLd(html);
  const structured = peopleFromJsonLd(jsonLd, url);
  const people = [...structured.people, ...peopleFromText(text, url)]
    .map((p) => ({ name: p.personName ?? "", title: p.rawTitle ?? null }))
    .filter((p) => Boolean(p.name));

  const endpoints = [...structured.endpoints, ...endpointsFromHtml(html, url)];
  const emails = [...new Set(endpoints
    .filter((e) => e.kind === 'EMAIL').map((e) => e.value))];
  const phones = [...new Set(endpoints
    .filter((e) => e.kind === 'PHONE').map((e) => e.value))];

  const kinds: FactKind[] = [];
  if (people.length > 0) kinds.push('PERSON_NAME');
  if (people.some((p) => p.title && ROLE_WORDS.test(p.title)) || ROLE_WORDS.test(text)) {
    kinds.push('PERSON_ROLE');
  }
  if (emails.length > 0) kinds.push('EMAIL');
  if (phones.length > 0) kinds.push('PHONE');

  return { kinds, people, emails, phones,
    count: people.length + emails.length + phones.length };
}

export interface AuditedResult extends SerpResultInput {
  role: SourceRole;
  roleConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  opened: boolean;
  openState: string | null;
  facts: PageFacts | null;
  provenance: string;
}

export interface SerpAuditOutcome {
  auditId: string;
  results: AuditedResult[];
  /** Facts first seen at each rank band, which is the question about paying for depth. */
  factsByBand: { band: '1-10' | '11-30' | '31-50'; facts: number; results: number }[];
  firstUsefulRank: number | null;
  openedCount: number;
}

function bandOf(rank: number): '1-10' | '11-30' | '31-50' {
  if (rank <= 10) return '1-10';
  if (rank <= 30) return '11-30';
  return '31-50';
}

/**
 * Classifies every result, opens the ones worth opening, and records what was found.
 *
 * `open` is injectable so the tests can drive it without a network, and so a dry run can
 * measure what it *would* open before any bandwidth is spent.
 */
export async function auditSerp(input: {
  accountId: string | null;
  companyName: string;
  companyPhone?: string | null;
  companyAddress?: string | null;
  queryText: string;
  provider?: string | null;
  jobId?: string | null;
  pagesRequested?: number;
  results: readonly SerpResultInput[];
  maxToOpen?: number;
  open?: (url: string) => Promise<{ ok: boolean; body: string; state: string }>;
}): Promise<SerpAuditOutcome> {
  const openPage = input.open ?? (async (url: string) => {
    const result = await politeFetch(url);
    return {
      ok: result.ok && !result.blockedReason,
      body: result.body,
      state: result.blockedReason ? 'REFUSED'
        : result.ok ? 'READ'
        : result.failureReason === 'http_error' ? 'HTTP_ERROR' : 'UNREACHABLE',
    };
  });

  const { rows } = await query<{ audit_id: string }>(
    `insert into serp_audits (account_id, query, provider, job_id, pages_requested, results_seen)
     values ($1,$2,$3,$4,$5,$6) returning audit_id`,
    [input.accountId, input.queryText, input.provider ?? null, input.jobId ?? null,
     input.pagesRequested ?? 1, input.results.length]);
  const auditId = rows[0]!.audit_id;

  const audited: AuditedResult[] = [];
  let opened = 0;
  const budget = input.maxToOpen ?? 15;

  for (const result of [...input.results].sort((a, b) => a.rank - b.rank)) {
    const verdict = classifySourceRole({
      url: result.url,
      title: result.title,
      companyName: input.companyName,
      companyPhone: input.companyPhone ?? null,
      companyAddress: input.companyAddress ?? null,
    });

    const worthIt = WORTH_OPENING.has(verdict.role) && !NOT_WORTH_OPENING.has(verdict.role);
    let facts: PageFacts | null = null;
    let openState: string | null = null;
    let didOpen = false;

    if (worthIt && opened < budget) {
      const page = await openPage(result.url);
      didOpen = true;
      opened += 1;
      openState = page.state;
      if (page.ok && page.body) facts = factsOnPage(page.body, result.url);
    }

    const entry: AuditedResult = {
      ...result, role: verdict.role, roleConfidence: verdict.confidence,
      opened: didOpen, openState, facts,
      provenance: provenanceForRole(verdict.role, didOpen),
    };
    audited.push(entry);

    await query(
      `insert into serp_audit_results
         (audit_id, rank, url, title, source_role, role_confidence, opened, open_state,
          facts_found, fact_kinds, provenance)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (audit_id, rank) do nothing`,
      [auditId, result.rank, result.url, result.title, verdict.role, verdict.confidence,
       didOpen, openState, facts?.count ?? 0, facts?.kinds ?? [], entry.provenance]);
  }

  const bands: SerpAuditOutcome['factsByBand'] = (['1-10', '11-30', '31-50'] as const)
    .map((band) => ({
      band,
      results: audited.filter((r) => bandOf(r.rank) === band).length,
      facts: audited.filter((r) => bandOf(r.rank) === band)
        .reduce((sum, r) => sum + (r.facts?.count ?? 0), 0),
    }));

  const firstUseful = audited.find((r) => (r.facts?.count ?? 0) > 0)?.rank ?? null;

  await query(
    `update serp_audits set results_opened = $2, facts_found = $3 where audit_id = $1`,
    [auditId, opened, audited.reduce((sum, r) => sum + (r.facts?.count ?? 0), 0)]);

  return { auditId, results: audited, factsByBand: bands,
    firstUsefulRank: firstUseful, openedCount: opened };
}

/**
 * Whether paying to read past page one actually bought anything.
 *
 * Reported across every audit rather than per audit, because one company's owner being
 * on result thirty-seven is an anecdote and three hundred companies' worth of ranks is a
 * decision about how many pages to buy next time.
 */
export async function depthReport(): Promise<{
  band: string; results: number; opened: number; facts: number;
  auditsWhereBandWasFirst: number;
}[]> {
  const { rows } = await query<{
    band: string; results: string; opened: string; facts: string; firsts: string;
  }>(
    `with banded as (
       select r.*, case when r.rank <= 10 then '1-10'
                        when r.rank <= 30 then '11-30' else '31-50' end as band
         from serp_audit_results r),
     firsts as (
       select audit_id, min(rank) as first_rank
         from banded where facts_found > 0 group by audit_id)
     select b.band,
            count(*)::text                                             as results,
            count(*) filter (where b.opened)::text                      as opened,
            coalesce(sum(b.facts_found), 0)::text                       as facts,
            count(distinct case
              when f.first_rank = b.rank then b.audit_id end)::text     as firsts
       from banded b
       left join firsts f on f.audit_id = b.audit_id
      group by b.band
      order by case b.band when '1-10' then 1 when '11-30' then 2 else 3 end`);

  return rows.map((r) => ({
    band: r.band, results: Number(r.results), opened: Number(r.opened),
    facts: Number(r.facts), auditsWhereBandWasFirst: Number(r.firsts),
  }));
}

/**
 * How often a company's own site only gave up its facts below the homepage.
 *
 * The other half of the depth question: `MAX_PAGES` was raised from eight to sixteen on
 * the theory that the pages naming an owner sit behind a submenu. This is what says
 * whether that was true.
 */
export async function homepageVersusDeepPages(): Promise<{
  homepageFacts: number; deepPageFacts: number; accountsOnlyDeep: number;
}> {
  const { rows } = await query<{ homepage: string; deep: string; only_deep: string }>(
    `with pages as (
       select account_id, source_page_url,
              case when source_page_url ~ '^https?://[^/]+/?$' then true else false end as is_home,
              count(*) as facts
         from evidence_records
        where source_page_url is not null and fact_provenance = 'OFFICIAL_COMPANY_SITE'
        group by 1,2,3)
     select coalesce(sum(facts) filter (where is_home), 0)::text      as homepage,
            coalesce(sum(facts) filter (where not is_home), 0)::text  as deep,
            count(distinct account_id) filter (
              where not is_home and account_id not in (
                select account_id from pages where is_home))::text    as only_deep
       from pages`);
  const row = rows[0];
  return {
    homepageFacts: Number(row?.homepage ?? 0),
    deepPageFacts: Number(row?.deep ?? 0),
    accountsOnlyDeep: Number(row?.only_deep ?? 0),
  };
}

export { isFirstParty };
