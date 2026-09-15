import { politeFetch } from '../resolver/fetcher.js';
import { decideMatch, distinctByEntity, type MatchCandidate } from './match.js';
import { licensingRequirement } from './requirements.js';
import { liveCallsPermitted, availabilityFor } from './governance.js';
import { emptyResult, type SourceAdapter, type SourceLookupContext,
  type SourceLookupResult } from './types.js';
import { parseSunbizDetail, sunbizCandidate, sunbizFacts, sunbizPeople } from './adapters/flSunbiz.js';
import { parseDbprDetail, dbprCandidate, dbprFacts, dbprPeople, licenceCoversVertical }
  from './adapters/flDbpr.js';
import { parseComptrollerApiList, comptrollerCandidate, comptrollerFacts,
  comptrollerPeople, COMPTROLLER_API_BASE } from './adapters/txComptroller.js';
import { parseTdlrResults, tdlrCandidate, tdlrFacts, tdlrPeople, tdlrProgramFor,
  tdlrLicenceCoversVertical } from './adapters/txTdlr.js';
import { tsbpeCandidate, tsbpeFacts, tsbpePeople, rankTsbpe, type TsbpeRecord }
  from './adapters/txTsbpe.js';
import { findSnapshotRecordsByCompany } from './snapshots.js';

/**
 * The adapters, wired.
 *
 * Every live-capable adapter takes its fetcher by injection for the same reason the
 * discovery provider does: a test that needs real HTTP is a test that does not run.
 * Fixtures go in through this seam, and nothing in the test suite ever reaches a
 * state agency.
 */

export type Fetcher = (url: string, headers?: Record<string, string>) =>
Promise<{ ok: boolean; body: string; finalUrl: string; blockedReason?: string }>;

const defaultFetcher: Fetcher = async (url, headers) => {
  const response = await politeFetch(url, headers ?? {});
  return { ok: response.ok, body: response.body, finalUrl: response.finalUrl,
    blockedReason: response.blockedReason };
};

/** Shared shape for the two "fetch a page, parse it, decide if it is ours" adapters. */
async function lookupViaPage<TRecord>(input: {
  sourceId: string;
  url: string;
  fetcher: Fetcher;
  context: SourceLookupContext;
  parse: (html: string) => TRecord | TRecord[] | null;
  /** Sent with the request. Used for sources that require a registered credential. */
  headers?: Record<string, string>;
  toCandidate: (record: TRecord) => MatchCandidate;
  build: (record: TRecord, reference: string) => Pick<SourceLookupResult, 'facts' | 'people'>;
}): Promise<SourceLookupResult> {
  if (!liveCallsPermitted(input.sourceId)) {
    return emptyResult(input.sourceId, 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
      `Live lookups against ${input.sourceId} are not enabled in this deployment.`);
  }

  let response: Awaited<ReturnType<Fetcher>>;
  try {
    response = await input.fetcher(input.url, input.headers);
  } catch (error) {
    return emptyResult(input.sourceId, 'SOURCE_UNAVAILABLE',
      `The source could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    // A wall is not a finding about the company. It says only that we could not look.
    return emptyResult(input.sourceId, 'SOURCE_UNAVAILABLE',
      response.blockedReason
        ? `The source declined the request (${response.blockedReason}).`
        : 'The source did not return a readable page.');
  }

  const parsed = input.parse(response.body);
  const records = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []);
  if (records.length === 0) {
    return emptyResult(input.sourceId, 'NO_MATCH',
      'The source returned no record that could be read as a result.');
  }

  // The candidate a record produced, kept beside the record itself.
  //
  // `distinctByEntity` returns a subset of these very objects, so the selected
  // candidate identifies its record by reference -- no second search by name, which
  // is the thing that cannot be trusted here in the first place.
  const pairs = records.map((record) => ({ record, candidate: input.toCandidate(record) }));
  const candidates = distinctByEntity(pairs.map((pair) => pair.candidate));
  const decision = decideMatch(candidates, input.context);
  const capturedAt = new Date();

  if (decision.status !== 'MATCHED' || !decision.selected) {
    return {
      sourceId: input.sourceId, status: decision.status, reason: decision.reason,
      sourceReference: response.finalUrl, capturedAt, matchMethod: null,
      facts: [], people: [], endpoints: [], candidates: decision.considered,
    };
  }

  const selected = pairs.find((pair) => pair.candidate === decision.selected);
  if (!selected) {
    // Unreachable unless the matcher returns a candidate it was not given. Treated as
    // an ambiguity rather than defaulting to the first record: falling back to
    // records[0] would attach whichever company the source happened to list first,
    // which is precisely the contamination the matcher exists to refuse.
    return {
      sourceId: input.sourceId, status: 'AMBIGUOUS',
      reason: 'The matched record could not be tied back to a source row, so nothing '
        + 'was recorded.',
      sourceReference: response.finalUrl, capturedAt, matchMethod: null,
      facts: [], people: [], endpoints: [], candidates: decision.considered,
    };
  }
  const record = selected.record;
  const reference = decision.selected.reference
    ? `${response.finalUrl}#${decision.selected.reference}` : response.finalUrl;
  const built = input.build(record, reference);

  return {
    sourceId: input.sourceId, status: 'MATCHED', reason: decision.reason,
    sourceReference: reference, capturedAt, matchMethod: decision.matchMethod,
    facts: built.facts, people: built.people, endpoints: [],
    candidates: decision.considered,
  };
}

export function createSunbizAdapter(fetcher: Fetcher = defaultFetcher): SourceAdapter {
  return {
    id: 'fl_sunbiz',
    displayName: 'Florida Division of Corporations',
    sourceClass: 'PUBLIC_COMPANY_REGISTRY',
    stage: 'B_public_company_registry',
    stateRegion: 'FL',
    timeoutMs: 20_000,
    availability: () => availabilityFor('fl_sunbiz'),
    supports: (context) => context.stateRegion === 'FL' && Boolean(context.companyName),
    lookup: (context) => lookupViaPage({
      sourceId: 'fl_sunbiz',
      url: 'https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?searchNameOrder='
        + encodeURIComponent(context.companyName),
      fetcher, context,
      parse: parseSunbizDetail,
      toCandidate: sunbizCandidate,
      build: (record, reference) => ({
        facts: sunbizFacts(record, reference), people: sunbizPeople(record, reference),
      }),
    }),
  };
}

export function createComptrollerAdapter(fetcher: Fetcher = defaultFetcher): SourceAdapter {
  return {
    id: 'tx_comptroller',
    displayName: 'Texas Comptroller of Public Accounts',
    sourceClass: 'PUBLIC_COMPANY_REGISTRY',
    stage: 'B_public_company_registry',
    stateRegion: 'TX',
    timeoutMs: 20_000,
    availability: () => availabilityFor('tx_comptroller'),
    supports: (context) => context.stateRegion === 'TX' && Boolean(context.companyName),
    lookup: async (context) => {
      // The API answers 403 without a key, and a key is a registration step rather
      // than an obstacle to route around. Saying so plainly beats sending a request
      // that is certain to be refused.
      if (!process.env['TX_COMPTROLLER_API_KEY']) {
        return emptyResult('tx_comptroller', 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
          'The Texas Comptroller public-data API requires an api-key header. None is '
          + 'configured, so no request was made. Obtaining one is a registration step, '
          + 'not a technical obstacle.');
      }
      return lookupViaPage({
        sourceId: 'tx_comptroller',
        // The published API, not the account-status page: that page posts to
        // /data-search/, which comptroller.texas.gov's robots.txt disallows.
        url: `${COMPTROLLER_API_BASE}/franchise-tax-list?BUSINESS_NAME=`
          + encodeURIComponent(context.companyName),
        fetcher, context,
        headers: { 'api-key': process.env['TX_COMPTROLLER_API_KEY'] ?? '' },
        parse: parseComptrollerApiList,
        toCandidate: comptrollerCandidate,
        build: (record, reference) => ({
          facts: comptrollerFacts(record, reference),
          people: comptrollerPeople(record, reference),
        }),
      });
    },
  };
}

export function createDbprAdapter(fetcher: Fetcher = defaultFetcher): SourceAdapter {
  return {
    id: 'fl_dbpr',
    displayName: 'Florida DBPR',
    sourceClass: 'PUBLIC_LICENSE_REGISTRY',
    stage: 'C_public_license_registry',
    stateRegion: 'FL',
    timeoutMs: 20_000,
    availability: () => availabilityFor('fl_dbpr'),
    supports: (context) =>
      context.stateRegion === 'FL'
      && licensingRequirement('FL', context.verticalProfileId).sourceId === 'fl_dbpr',
    lookup: async (context) => {
      return lookupViaPage({
        sourceId: 'fl_dbpr',
        url: 'https://www.myfloridalicense.com/wl11.asp?mode=2&search=Name&SID=&brd=&typ=N&hid='
          + encodeURIComponent(context.companyName),
        fetcher, context,
        // Only a licence for the trade this account is about. A roofing company
        // holding an electrical licence has not had its roofing credentials verified,
        // and reporting it as licensed would be true of the wrong thing.
        parse: (html) => {
          const licence = parseDbprDetail(html);
          if (!licence) return null;
          return licenceCoversVertical(licence, context.verticalProfileId) ? licence : null;
        },
        toCandidate: dbprCandidate,
        build: (record, reference) => ({
          facts: dbprFacts(record, reference), people: dbprPeople(record, reference),
        }),
      });
    },
  };
}

export function createTdlrAdapter(fetcher: Fetcher = defaultFetcher): SourceAdapter {
  return {
    id: 'tx_tdlr',
    displayName: 'Texas Department of Licensing and Regulation',
    sourceClass: 'PUBLIC_LICENSE_REGISTRY',
    stage: 'C_public_license_registry',
    stateRegion: 'TX',
    timeoutMs: 20_000,
    availability: () => availabilityFor('tx_tdlr'),
    supports: (context) =>
      context.stateRegion === 'TX' && tdlrProgramFor(context.verticalProfileId) !== null,
    lookup: async (context) => {
      const program = tdlrProgramFor(context.verticalProfileId);
      if (!program) {
        return emptyResult('tx_tdlr', 'NOT_APPLICABLE_STATEWIDE',
          'TDLR does not run a licence programme covering this trade.');
      }
      return lookupViaPage({
        sourceId: 'tx_tdlr',
        url: 'https://www.tdlr.texas.gov/LicenseSearch/SearchResults.asp?searchtype=name&term='
          + encodeURIComponent(context.companyName),
        fetcher, context,
        // Only licences of the programme this trade needs. A company may hold both,
        // and an HVAC account verified against an electrical licence has not had its
        // air-conditioning credentials checked.
        parse: (html) => parseTdlrResults(html, program)
          .filter((licence) => tdlrLicenceCoversVertical(licence, context.verticalProfileId)),
        toCandidate: tdlrCandidate,
        build: (record, reference) => ({
          facts: tdlrFacts(record, reference), people: tdlrPeople(record, reference),
        }),
      });
    },
  };
}

/**
 * TSBPE, read from a snapshot rather than from the board.
 *
 * No `fetcher` at all: there is no per-account request to make. If no snapshot has
 * been loaded the honest answer is SOURCE_UNAVAILABLE, which says we could not look
 * rather than that the company is unlicensed.
 */
export function createTsbpeAdapter(): SourceAdapter {
  return {
    id: 'tx_tsbpe',
    displayName: 'Texas State Board of Plumbing Examiners',
    sourceClass: 'PUBLIC_LICENSE_REGISTRY',
    stage: 'C_public_license_registry',
    stateRegion: 'TX',
    timeoutMs: 10_000,
    availability: () => availabilityFor('tx_tsbpe'),
    supports: (context) =>
      context.stateRegion === 'TX' && context.verticalProfileId === 'plumbing',
    lookup: async (context) => {
      const found = await findSnapshotRecordsByCompany({
        sourceId: 'tx_tsbpe', dataset: 'licensees', companyName: context.companyName,
      });
      if (!found) {
        return emptyResult('tx_tsbpe', 'SOURCE_UNAVAILABLE',
          'No Texas plumbing board dataset has been loaded, so no licence could be '
          + 'looked up. This says nothing about the company.');
      }
      const records = found.payloads as unknown as TsbpeRecord[];
      if (records.length === 0) {
        return {
          sourceId: 'tx_tsbpe', status: 'NO_MATCH',
          reason: 'The plumbing board dataset holds no licence under this company name.',
          sourceReference: found.snapshot.sourceReference,
          capturedAt: found.snapshot.downloadedAt,
          facts: [], people: [], endpoints: [],
          fromSnapshot: {
            snapshotId: found.snapshot.snapshotId,
            downloadedAt: found.snapshot.downloadedAt,
            sourceGeneratedAt: found.snapshot.sourceGeneratedAt,
          },
        };
      }

      // One company may hold several licences; those rows are one entity, not
      // several candidates competing to be it.
      const candidates = distinctByEntity(records.map(tsbpeCandidate));
      const decision = decideMatch(candidates, context);
      if (decision.status !== 'MATCHED' || !decision.selected) {
        return {
          sourceId: 'tx_tsbpe', status: decision.status, reason: decision.reason,
          sourceReference: found.snapshot.sourceReference,
          capturedAt: found.snapshot.downloadedAt,
          facts: [], people: [], endpoints: [], candidates: decision.considered,
          fromSnapshot: {
            snapshotId: found.snapshot.snapshotId,
            downloadedAt: found.snapshot.downloadedAt,
            sourceGeneratedAt: found.snapshot.sourceGeneratedAt,
          },
        };
      }

      // Every licence this company holds, most senior first, so the Responsible
      // Master Plumber leads rather than whichever row the dataset happened to order
      // first.
      const selectedName = decision.selected.name;
      const matching = rankTsbpe(records.filter((record) =>
        (record.companyName ?? record.licenseeName) === selectedName));

      const reference = found.snapshot.sourceReference
        ?? `tsbpe-snapshot:${found.snapshot.snapshotId}`;
      return {
        sourceId: 'tx_tsbpe', status: 'MATCHED', reason: decision.reason,
        sourceReference: reference,
        // Captured when the snapshot was downloaded. Not now: reading a cached row
        // today does not make it verified today.
        capturedAt: found.snapshot.downloadedAt,
        matchMethod: decision.matchMethod,
        facts: matching.flatMap((record) => tsbpeFacts(record, reference)),
        people: matching.flatMap((record) => tsbpePeople(record, reference)),
        endpoints: [],
        candidates: decision.considered,
        fromSnapshot: {
          snapshotId: found.snapshot.snapshotId,
          downloadedAt: found.snapshot.downloadedAt,
          sourceGeneratedAt: found.snapshot.sourceGeneratedAt,
        },
      };
    },
  };
}

/**
 * Texas SOSDirect, present only to be refused.
 *
 * Recorded as an adapter so the refusal is visible in the registry and in operator
 * reporting. It has no fetcher, no URL builder and no code path that could make a
 * request; the Texas entity question is answered free by the Comptroller.
 */
export function createSosDirectAdapter(): SourceAdapter {
  return {
    id: 'tx_sosdirect',
    displayName: 'Texas SOSDirect (paid — disabled)',
    sourceClass: 'PUBLIC_COMPANY_REGISTRY',
    stage: 'B_public_company_registry',
    stateRegion: 'TX',
    timeoutMs: 1,
    availability: () => 'DISABLED_PAID_SOURCE',
    supports: () => false,
    lookup: async () => emptyResult('tx_sosdirect', 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
      'SOSDirect charges per search and no spending is authorised. The Texas entity '
      + 'question is answered by the Comptroller adapter instead.'),
  };
}

/** Every adapter, in the order the stages run them. */
export function allSourceAdapters(fetcher: Fetcher = defaultFetcher): SourceAdapter[] {
  return [
    createSunbizAdapter(fetcher),
    createComptrollerAdapter(fetcher),
    createSosDirectAdapter(),
    createDbprAdapter(fetcher),
    createTdlrAdapter(fetcher),
    createTsbpeAdapter(),
  ];
}
