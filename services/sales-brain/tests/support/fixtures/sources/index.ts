/**
 * Sanitized fixtures for the official-source parsers.
 *
 * Carried into V2 from `feature/sales-brain-rep-enrichment` with the Texas fixtures
 * left behind: no Texas market exists yet, and a fixture nothing reads is a fixture
 * nobody maintains.
 *
 * Every one of these mirrors the structure of a real public record and contains no
 * real person, company, licence number or address. They exist so the parsers can be
 * tested offline, which matters more here than anywhere else in the suite: the
 * alternative is a test that sends traffic to a state agency every time it runs.
 */

/** Sunbiz entity detail, LLC with two managers and a commercial registered agent. */
export const SUNBIZ_LLC_DETAIL = `<html><body>
<div class="searchResultDetail">
<h2>Detail by Entity Name</h2>
<p>Florida Limited Liability Company</p>
<p>KOWALCZYK PLUMBING LLC</p>
<div><h3>Filing Information</h3>
<span>Document Number</span><span>L14000012345</span>
<span>FEI/EIN Number</span><span>47-1234567</span>
<span>Date Filed</span><span>03/14/2014</span>
<span>State</span><span>FL</span>
<span>Status</span><span>ACTIVE</span>
</div>
<div><h3>Principal Address</h3>
<div>120 ANASTASIA BLVD</div>
<div>SUITE 4</div>
<div>ST AUGUSTINE, FL 32095</div>
</div>
<div><h3>Mailing Address</h3>
<div>PO BOX 771</div>
<div>ST AUGUSTINE, FL 32085</div>
</div>
<div><h3>Registered Agent Name &amp; Address</h3>
<div>COASTAL AGENT SERVICES INC</div>
<div>900 REGISTRY WAY</div>
<div>TALLAHASSEE, FL 32301</div>
</div>
<div><h3>Authorized Person(s) Detail</h3>
<div>Title MGRM</div>
<div>KOWALCZYK, DANA</div>
<div>120 ANASTASIA BLVD</div>
<div>ST AUGUSTINE, FL 32095</div>
<div>Title MGR</div>
<div>ELLIS, MARCUS</div>
<div>120 ANASTASIA BLVD</div>
<div>ST AUGUSTINE, FL 32095</div>
</div>
<div><h3>Annual Reports</h3>
<div>2023</div><div>2024</div><div>2025</div>
</div>
</div></body></html>`;

/** An inactive entity, to prove status is read rather than assumed. */
export const SUNBIZ_INACTIVE_DETAIL = SUNBIZ_LLC_DETAIL
  .replace('<span>Status</span><span>ACTIVE</span>', '<span>Status</span><span>INACTIVE</span>')
  .replace('KOWALCZYK PLUMBING LLC', 'DORMANT AIR LLC')
  .replace('KOWALCZYK, DANA', 'REYES, PAULA');

/** A search-results page, which must never be read as a detail record. */
export const SUNBIZ_SEARCH_RESULTS = `<html><body><h2>Entity Name List</h2>
<table><tr><th>Entity Name</th><th>Document Number</th><th>Status</th></tr>
<tr><td>KOWALCZYK PLUMBING LLC</td><td>L14000012345</td><td>Active</td></tr>
<tr><td>KOWALCZYK PLUMBING OF MIAMI LLC</td><td>L19000099999</td><td>Active</td></tr>
</table></body></html>`;

/** DBPR licence held by a business with a named qualifying agent. */
export const DBPR_BUSINESS_LICENCE = `<html><body>
<table>
<tr><td>Licensee Name</td><td>KOWALCZYK PLUMBING LLC</td></tr>
<tr><td>DBA Name</td><td>KOWALCZYK PLUMBING</td></tr>
<tr><td>License Number</td><td>CFC1428888</td></tr>
<tr><td>License Type</td><td>Certified Plumbing Contractor</td></tr>
<tr><td>Rank</td><td>Cert Plumbing</td></tr>
<tr><td>Qualifying Agent</td><td>DANA KOWALCZYK</td></tr>
<tr><td>Primary Status</td><td>Current</td></tr>
<tr><td>Secondary Status</td><td>Active</td></tr>
<tr><td>Original Licensure Date</td><td>06/02/2014</td></tr>
<tr><td>Expires</td><td>08/31/2026</td></tr>
<tr><td>City</td><td>St Augustine</td></tr>
<tr><td>County</td><td>St Johns</td></tr>
</table></body></html>`;

export const DBPR_EXPIRED_LICENCE = DBPR_BUSINESS_LICENCE
  .replace('<td>Current</td>', '<td>Null</td>')
  .replace('<td>Active</td>', '<td>Expired</td>');

/** An electrical licence, used to prove trade coverage is checked. */
export const DBPR_WRONG_TRADE_LICENCE = DBPR_BUSINESS_LICENCE
  .replace('Certified Plumbing Contractor', 'Certified Electrical Contractor')
  .replace('Cert Plumbing', 'Cert Electrical')
  .replace('CFC1428888', 'EC13009999');

/** Texas Comptroller franchise tax account status with a public information report. */
export const SUNBIZ_AGENT_ONLY = `<html><body>
<div class="searchResultDetail">
<h2>Detail by Entity Name</h2>
<p>Florida Limited Liability Company</p>
<p>QUIET HOLDINGS LLC</p>
<div><h3>Filing Information</h3>
<span>Document Number</span><span>L20000055555</span>
<span>Date Filed</span><span>07/02/2020</span>
<span>State</span><span>FL</span>
<span>Status</span><span>ACTIVE</span>
</div>
<div><h3>Principal Address</h3>
<div>88 QUIET WAY</div>
<div>ST AUGUSTINE, FL 32095</div>
</div>
<div><h3>Registered Agent Name &amp; Address</h3>
<div>COASTAL AGENT SERVICES INC</div>
<div>900 REGISTRY WAY</div>
<div>TALLAHASSEE, FL 32301</div>
</div>
</div></body></html>`;

/** A DBPR licence held by an individual rather than a business. */
export const DBPR_INDIVIDUAL_LICENCE = `<html><body>
<table>
<tr><td>Licensee Name</td><td>MARCUS ELLIS</td></tr>
<tr><td>License Number</td><td>CFC1455555</td></tr>
<tr><td>License Type</td><td>Certified Plumbing Contractor</td></tr>
<tr><td>Rank</td><td>Cert Plumbing</td></tr>
<tr><td>Primary Status</td><td>Current</td></tr>
<tr><td>Secondary Status</td><td>Active</td></tr>
<tr><td>Expires</td><td>08/31/2026</td></tr>
<tr><td>City</td><td>St Augustine</td></tr>
</table></body></html>`;

/**
 * Texas Comptroller public-data API responses.
 *
 * Field names come from the published schema at api-doc.comptroller.texas.gov
 * (`FranchiseAccountWithOfficers`, `FranchiseAccountOfficer`). The values are
 * invented; the shape is the documented one. The live API answers 403 without a
 * registered api-key, so these could not be captured from a real response.
 */
export const DBPR_DATASET = [
  'License Number,License Type,Rank,Licensee Name,DBA Name,Business Name,Qualifying Agent,Primary Status,Secondary Status,Original Licensure Date,Expires,City,County',
  'CFC1428888,Certified Plumbing Contractor,Cert Plumbing,KOWALCZYK PLUMBING LLC,KOWALCZYK PLUMBING,KOWALCZYK PLUMBING LLC,DANA KOWALCZYK,Current,Active,06/02/2014,08/31/2026,St Augustine,St Johns',
  'EC13009999,Certified Electrical Contractor,Cert Electrical,VOLT MASTERS INC,,VOLT MASTERS INC,RAY SIMMS,Current,Active,03/11/2011,08/31/2026,St Augustine,St Johns',
  'CCC1330000,Certified Roofing Contractor,Cert Roofing,GULF ROOFING LLC,,GULF ROOFING LLC,MARIA SOLIS,Null,Expired,01/05/2009,08/31/2024,Miami,Miami-Dade',
  'CFC1499999,Certified Plumbing Contractor,Cert Plumbing,MARCUS ELLIS,,,,Current,Active,09/14/2018,08/31/2026,St Augustine,St Johns',
].join('\n');

/**
 * A TDLR result listing, in the shape the live site actually returns.
 *
 * Captured from `SearchResultsListBrowse.asp` on 2026-09-15 and sanitized: the
 * structure, column headings and licence-number format are real, the licensee is
 * invented. Note the heading "License Data Search Result" rather than "License #",
 * the spaced licence number, and the absence of any status column -- all three broke
 * the original parser, and none of them were visible from the earlier fixtures.
 */
