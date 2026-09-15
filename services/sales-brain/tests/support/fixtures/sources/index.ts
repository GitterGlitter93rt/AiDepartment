/**
 * Sanitized fixtures for the official-source parsers.
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
export const COMPTROLLER_ACTIVE = `<html><body>
<table>
<tr><td>Taxpayer Name</td><td>LONE STAR DRAIN WORKS LLC</td></tr>
<tr><td>Taxpayer Number</td><td>32012345678</td></tr>
<tr><td>Texas SOS File Number</td><td>0801234567</td></tr>
<tr><td>Right to Transact Business in Texas</td><td>ACTIVE</td></tr>
<tr><td>State of Formation</td><td>TX</td></tr>
<tr><td>Effective SOS Registration Date</td><td>05/09/2016</td></tr>
<tr><td>Registered Agent Name</td><td>HILL COUNTRY AGENTS LLC</td></tr>
<tr><td>Registered Office Street Address</td><td>4400 CONGRESS AVE, AUSTIN, TX 78701</td></tr>
<tr><td>Report Year</td><td>2025</td></tr>
</table>
<h3>Officers and Directors</h3>
<pre>
PRIYA NAIR        PRESIDENT        YES
TOMAS HERRERA     DIRECTOR         YES
</pre>
</body></html>`;

/** The status that is not "active" and not "gone" -- the one a boolean would hide. */
export const COMPTROLLER_FRANCHISE_ENDED = COMPTROLLER_ACTIVE
  .replace('<td>ACTIVE</td>', '<td>FRANCHISE TAX ENDED</td>');

/** TDLR air-conditioning contractor search results. */
export const TDLR_HVAC_RESULTS = `<html><body><table>
<tr><th>License #</th><th>Name</th><th>Business</th><th>City</th><th>Status</th><th>Expires</th></tr>
<tr><td>TACLA00123456</td><td>ELENA VOSS</td><td>BLUEBONNET AIR LLC</td><td>Austin</td><td>Active</td><td>11/30/2026</td></tr>
</table></body></html>`;

export const TDLR_EXPIRED_RESULTS = TDLR_HVAC_RESULTS.replace('<td>Active</td>', '<td>Expired</td>');

/** Two licences of one name in two cities: the ambiguity the matcher must refuse. */
export const TDLR_COLLISION_RESULTS = `<html><body><table>
<tr><th>License #</th><th>Name</th><th>Business</th><th>City</th><th>Status</th><th>Expires</th></tr>
<tr><td>TACLA00123456</td><td>ELENA VOSS</td><td>BLUEBONNET AIR LLC</td><td>Austin</td><td>Active</td><td>11/30/2026</td></tr>
<tr><td>TACLA00777777</td><td>RAY SIMMS</td><td>BLUEBONNET AIR LLC</td><td>Dallas</td><td>Active</td><td>02/28/2027</td></tr>
</table></body></html>`;

export const TDLR_NO_RESULTS = `<html><body><p>No records found matching your search.</p></body></html>`;

/** A TSBPE licensee export. Tab-delimited, as the board's files tend to be. */
export const TSBPE_DATASET = [
  'License Number\tLicense Type\tLicensee Name\tCompany Name\tStatus\tExpiration Date\tInsurance Expiration\tCity\tCounty\tEndorsements',
  'M-40111\tResponsible Master Plumber\tJORDAN OKAFOR\tLONE STAR DRAIN WORKS LLC\tActive\t03/31/2027\t01/15/2027\tAustin\tTravis\tMedical Gas',
  'J-55222\tJourneyman Plumber\tCASEY LIN\tLONE STAR DRAIN WORKS LLC\tActive\t09/30/2026\t\tAustin\tTravis\t',
  'M-40999\tResponsible Master Plumber\tDANA WHITFIELD\tGULF COAST PIPE CO\tExpired\t04/30/2024\t\tHouston\tHarris\t',
  'M-41777\tResponsible Master Plumber\tSAM ORTEGA\tBLUEBONNET AIR LLC\tActive\t06/30/2027\t\tAustin\tTravis\t',
].join('\n');

/** The same company name in two cities, to prove the snapshot matcher is careful. */
export const TSBPE_DUPLICATE_COMPANY = [
  'License Number\tLicense Type\tLicensee Name\tCompany Name\tStatus\tExpiration Date\tInsurance Expiration\tCity\tCounty\tEndorsements',
  'M-60111\tResponsible Master Plumber\tALEX RIVERS\tSTATEWIDE PLUMBING CO\tActive\t03/31/2027\t\tAustin\tTravis\t',
  'M-60222\tResponsible Master Plumber\tMORGAN DIAZ\tSTATEWIDE PLUMBING CO\tActive\t03/31/2027\t\tHouston\tHarris\t',
].join('\n');

/** A filing that names a registered agent and no officers at all. */
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
