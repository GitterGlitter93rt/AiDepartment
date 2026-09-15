import { flag } from '../config.js';
import type { SourceAvailability } from './types.js';

/**
 * Source governance, as a record rather than a comment.
 * Authority: the existing worker's own refusal -- stages B and C have been skipped
 * since they were written with the reason "source governance review not signed off".
 *
 * That refusal was right, and deleting it to turn the stages on would be the wrong
 * fix. What was missing was the thing it was waiting for: a written statement, per
 * source, of what we read, how often, under whose terms, and what happens when it
 * refuses us. This file is that statement, and the availability it computes is what
 * the worker consults.
 *
 * Nothing here enables itself. Every live adapter is additionally gated on an
 * explicit environment flag, so a deployment that has not made the decision runs
 * exactly as it does today.
 */

export interface SourceGovernance {
  sourceId: string;
  displayName: string;
  owner: string;
  publicUrl: string;
  /** Is the data public without an account? */
  publicAccess: boolean;
  authenticationRequired: boolean;
  paid: boolean;
  dataCollected: string[];
  businessPurpose: string;
  /** Requests per account lookup, and the floor between them. */
  requestPolicy: string;
  bulkStrategy: string;
  freshnessStrategy: string;
  attribution: string;
  failureBehaviour: string;
  /** The env flag that must be true before live calls are made. */
  enableFlag: string | null;
  /** Why this is not simply on. */
  status: SourceAvailability;
  statusReason: string;
}

export const SOURCE_GOVERNANCE: SourceGovernance[] = [
  {
    sourceId: 'fl_sunbiz',
    displayName: 'Florida Division of Corporations (Sunbiz)',
    owner: 'Florida Department of State',
    publicUrl: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['legal entity name', 'document number', 'status', 'filing date',
      'principal address', 'mailing address', 'registered agent', 'officers/directors'],
    businessPurpose: 'Confirm a discovered Florida business is a real registered '
      + 'entity, and surface publicly filed officers a rep may legitimately ask for.',
    requestPolicy: 'One search per account lookup, one page of detail. Per-host rate '
      + 'limiting and robots handling come from the shared polite fetcher.',
    bulkStrategy: 'None. Per-account lookup only; no enumeration of the register.',
    freshnessStrategy: 'Entity status re-verified every 90 days; a filing date never '
      + 'expires because it cannot change.',
    attribution: 'Every fact stores the Sunbiz detail URL it came from.',
    failureBehaviour: 'SOURCE_UNAVAILABLE. The account keeps all other evidence and '
      + 'the research run completes PARTIAL.',
    enableFlag: 'SOURCE_FL_SUNBIZ_ENABLED',
    status: 'BLOCKED',
    statusReason: 'Sunbiz returned HTTP 403 to an identified research user-agent '
      + 'during development (2026-09-15). That is an access control, and working '
      + 'around it is out of bounds. Parser, reconciliation, persistence and tests '
      + 'are complete and run against sanitized fixtures; live automation stays off '
      + 'until access is arranged with the Department of State or a published bulk '
      + 'download is used instead.',
  },
  {
    sourceId: 'fl_dbpr',
    displayName: 'Florida DBPR licence verification',
    owner: 'Florida Department of Business and Professional Regulation',
    publicUrl: 'https://www.myfloridalicense.com/wl11.asp',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['licence number', 'licence type', 'status', 'expiry',
      'qualifying agent', 'licensee name', 'business name'],
    businessPurpose: 'Verify that a Florida contractor holds the licence its trade '
      + 'requires, and surface the qualifying agent as a named, verifiable person.',
    requestPolicy: 'Zero per-account live requests. Reads a loaded licensee dataset.',
    bulkStrategy: 'Snapshot-based, sharing the source_snapshots infrastructure with '
      + 'the Texas plumbing board: one published licensee file, checksummed, indexed, '
      + 'and matched against every Florida account.',
    freshnessStrategy: 'Licence status re-verified every 30 days -- status and expiry '
      + 'both change without notice.',
    attribution: 'Facts store the DBPR detail reference.',
    failureBehaviour: 'SOURCE_UNAVAILABLE; never reported as an unlicensed company.',
    enableFlag: 'SOURCE_FL_DBPR_ENABLED',
    status: 'FEATURE_FLAGGED',
    statusReason: 'Validated against the live form on 2026-09-15. wl11.asp is a legacy '
      + 'ASP application: the licensee search is a POST to wl11.asp?mode=1 carrying a '
      + 'SearchType radio (Name | LicNbr | City | LicTyp) and roughly thirty hidden '
      + 'fields -- hOrgName, hLastName, hSearchType, hLicNbr, hCity, hDivision, '
      + 'hBoard, hSearchOpt, hRecsPerPage -- with a session identifier threaded '
      + 'through SID. The adapter previously built a GET with invented query '
      + 'parameters and would never have returned a record. Driving a stateful form '
      + 'once per account is fragile and rude to a state system, so DBPR now reads a '
      + 'published licensee dataset through the snapshot infrastructure. The parser, '
      + 'trade-coverage check, matching and tests are complete; the dataset must be '
      + 'obtained from DBPR before live use.',
  },
  {
    sourceId: 'tx_comptroller',
    displayName: 'Texas Comptroller — Taxable Entity Search',
    owner: 'Texas Comptroller of Public Accounts',
    publicUrl: 'https://api.comptroller.texas.gov/public-data/v1/public/franchise-tax-list',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['legal entity name', 'taxpayer number', 'SOS file number',
      'right to transact business status', 'state of formation', 'registered agent',
      'mailing address', 'officers/directors from public information reports'],
    businessPurpose: 'The free official confirmation that a Texas business exists and '
      + 'may legally transact -- the Texas equivalent of the Sunbiz question, without '
      + 'the per-search charge SOSDirect makes.',
    requestPolicy: 'One API call per account lookup, with a registered api-key header. '
      + 'Shared polite fetcher limits.',
    bulkStrategy: 'The published API also exposes franchise-tax-list, which is the '
      + 'route to bulk if per-account calls ever become the bottleneck.',
    freshnessStrategy: 'Re-verified every 90 days; right-to-transact status can lapse.',
    attribution: 'Facts store the Comptroller record reference.',
    failureBehaviour: 'SOURCE_UNAVAILABLE. Never falls back to paid SOSDirect.',
    enableFlag: 'SOURCE_TX_COMPTROLLER_ENABLED',
    status: 'FEATURE_FLAGGED',
    statusReason: 'Validated against the live site on 2026-09-15, and the finding '
      + 'changed the design. The account-status page is a JavaScript form posting to '
      + 'comptroller.texas.gov/data-search/, and that host\'s robots.txt is '
      + '"Disallow: /*/" with an explicit allow-list that does not include '
      + '/data-search/ -- so the obvious scraping path is one the site asks us not to '
      + 'take. The Comptroller instead publishes a documented public API at '
      + 'api.comptroller.texas.gov/public-data/v1/public/ (franchise-tax-list for '
      + 'search, franchise-tax/{id} for account and officer detail). It answers 403 '
      + 'without an api-key header. The adapter now targets that API and makes no '
      + 'request at all until TX_COMPTROLLER_API_KEY is set. Obtaining a key is a '
      + 'registration step for a human; everything else is built and tested against '
      + 'the published schema.',
  },
  {
    sourceId: 'tx_tdlr',
    displayName: 'Texas Department of Licensing and Regulation',
    owner: 'Texas Department of Licensing and Regulation',
    publicUrl: 'https://www.tdlr.texas.gov/LicenseSearch/',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['licence number', 'programme', 'licence type', 'status', 'expiry',
      'licensee name', 'business name', 'city'],
    businessPurpose: 'Verify Texas air-conditioning/refrigeration and electrical '
      + 'licences, the two TDLR programmes that cover our highest-volume Texas trades.',
    requestPolicy: 'One search per account lookup. Shared polite fetcher limits.',
    bulkStrategy: 'Explicitly NOT the published CSV files: tdlr.texas.gov/robots.txt '
      + 'disallows /*.csv, so those are not downloaded. Search pages only.',
    freshnessStrategy: 'Re-verified every 30 days.',
    attribution: 'Facts store the TDLR search reference.',
    failureBehaviour: 'SOURCE_UNAVAILABLE; never reported as unlicensed.',
    enableFlag: 'SOURCE_TX_TDLR_ENABLED',
    status: 'FEATURE_FLAGGED',
    statusReason: 'Validated against a live result listing on 2026-09-15, which found '
      + 'the parser broken in three ways that fixtures could never have shown. The '
      + 'licence column is headed "License Data Search Result", not "License #"; '
      + 'licence numbers print spaced, as "ACR - 4471"; and the browse view carries no '
      + 'status column at all. The parser required a status, so against every real '
      + 'page it returned nothing. Rebuilt from the live shape, with an unread status '
      + 'recorded as UNKNOWN rather than assumed active. Search is a POST to '
      + 'SearchResultsListBrowse.asp with per-programme forms. robots disallows '
      + '/*.csv, so the published CSVs are not downloaded. Live automation stays behind '
      + 'a flag pending governance sign-off.',
  },
  {
    sourceId: 'tx_tsbpe',
    displayName: 'Texas State Board of Plumbing Examiners',
    owner: 'Texas State Board of Plumbing Examiners',
    publicUrl: 'https://tsbpe.texas.gov/license-types/',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['licence number', 'licence type', 'status', 'expiry',
      'Responsible Master Plumber', 'company association', 'insurance expiry'],
    businessPurpose: 'The Responsible Master Plumber is the single highest-value '
      + 'person on a Texas plumbing account: a named individual the state ties to the '
      + 'company, verifiable, and usually senior.',
    requestPolicy: 'Zero per-account live requests. Designed to read a downloaded '
      + 'snapshot indexed locally, so one dataset serves every account.',
    bulkStrategy: 'Snapshot-based by design -- source_snapshots plus an indexed record '
      + 'table, refreshed on a schedule, never once per account.',
    freshnessStrategy: 'A snapshot is only ever as fresh as its download; the read '
      + 'model reports the snapshot date, never "verified today".',
    attribution: 'Facts cite the snapshot and the board as the source.',
    failureBehaviour: 'SOURCE_UNAVAILABLE when no snapshot is loaded.',
    enableFlag: 'SOURCE_TX_TSBPE_ENABLED',
    status: 'FEATURE_FLAGGED',
    statusReason: 'Licence verification is a session-based JSP application at '
      + 'vo.licensing.hpc.texas.gov/datamart, and no free public bulk dataset was '
      + 'located during development. Per-account scraping of a stateful form app is '
      + 'not appropriate, so the adapter reads a locally indexed snapshot instead. '
      + 'Parser, snapshot store, matching, persistence and tests are complete; the '
      + 'snapshot must be obtained through an official data request before live use.',
  },
  {
    sourceId: 'tx_state_bar',
    displayName: 'State Bar of Texas',
    owner: 'State Bar of Texas',
    publicUrl: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer',
    publicAccess: true,
    authenticationRequired: false,
    paid: false,
    dataCollected: ['attorney name', 'bar number', 'eligibility status', 'firm', 'city'],
    businessPurpose: 'Confirm that a law-firm account has real, eligible attorneys '
      + 'and surface them as named contacts.',
    requestPolicy: 'Not run. Contract and parser only.',
    bulkStrategy: 'None.',
    freshnessStrategy: 'Re-verified every 90 days if ever enabled.',
    attribution: 'Facts would store the member-directory reference.',
    failureBehaviour: 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS.',
    enableFlag: null,
    status: 'BLOCKED',
    statusReason: 'Firm-to-attorney identity cannot be established conservatively '
      + 'from a name search alone -- attaching every lawyer with a similar firm name '
      + 'is exactly the contamination this system exists to avoid. Adapter contract '
      + 'and fixtures exist; no live automation.',
  },
  {
    sourceId: 'tx_sosdirect',
    displayName: 'Texas SOSDirect (paid)',
    owner: 'Texas Secretary of State',
    publicUrl: 'https://direct.sos.state.tx.us/',
    publicAccess: false,
    authenticationRequired: true,
    paid: true,
    dataCollected: [],
    businessPurpose: 'None. Recorded so nothing quietly adds it later.',
    requestPolicy: 'None. No request is ever made.',
    bulkStrategy: 'None.',
    freshnessStrategy: 'None.',
    attribution: 'None.',
    failureBehaviour: 'Always SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS.',
    enableFlag: null,
    status: 'DISABLED_PAID_SOURCE',
    statusReason: 'SOSDirect charges roughly $1 per search and requires an account. '
      + 'No spending is authorised. The Texas entity question is answered free by the '
      + 'Comptroller adapter instead. This entry exists so the source is visibly '
      + 'refused rather than merely absent.',
  },
];

export function governanceFor(sourceId: string): SourceGovernance | null {
  return SOURCE_GOVERNANCE.find((entry) => entry.sourceId === sourceId) ?? null;
}

/**
 * Whether this source may make live calls right now.
 *
 * Two gates, both of which must pass: the written status above must permit it, and
 * the deployment must have set the flag. A paid or blocked source cannot be switched
 * on by a flag at all.
 */
export function liveCallsPermitted(
  sourceId: string, env: NodeJS.ProcessEnv = process.env,
): boolean {
  const governance = governanceFor(sourceId);
  if (!governance) return false;
  if (governance.status === 'DISABLED_PAID_SOURCE' || governance.status === 'BLOCKED') {
    return false;
  }
  if (governance.status === 'LIVE') return true;
  if (!governance.enableFlag) return false;
  return flag(governance.enableFlag, false, env);
}

export function availabilityFor(
  sourceId: string, env: NodeJS.ProcessEnv = process.env,
): SourceAvailability {
  const governance = governanceFor(sourceId);
  if (!governance) return 'BLOCKED';
  if (governance.status === 'FEATURE_FLAGGED' && liveCallsPermitted(sourceId, env)) {
    return 'LIVE';
  }
  return governance.status;
}
