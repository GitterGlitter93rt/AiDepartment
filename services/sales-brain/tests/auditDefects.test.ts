import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePersonIdentity, mayBeDecisionMaker } from '../src/resolver/personIdentity.js';
import {
  attributeEndpoint, attributionsInHtml, isRoleMailbox, localPartNamesPerson,
} from '../src/resolver/attribution.js';
import { judgeDomain, isUsableWebsiteDomain } from '../src/domain/domainValidity.js';
import { classifySourceRole, mayPromoteRole } from '../src/discovery/sourceRole.js';

/**
 * Six defects, each measured against the live estate on 2026-09-17 and each pinned here
 * by the record that exposed it.
 *
 * Evidence: GitterGlitter93rt/SalesBrain-Audit-Data, research-audits/claude-2026-09-17,
 * commit b5af52fedc1e09c448035dbb32382684a5b33b62. Every fixture below is a production
 * shape copied from that audit; none of these tests reaches a network.
 */

/* ------------------------------------------------------ A. people are not people --- */

test('a name in a person-shaped place is not yet a person', () => {
  // The seven classes the audit actually found, with the record that produced each.
  const refused: [string, string, string][] = [
    ['wpadmin', 'Climate Systems', 'CMS_OR_USERNAME'],
    ['degreeadm', 'Degree 71', 'CMS_OR_USERNAME'],
    ['actuate', 'Alvarez Plumbing & AC', 'CMS_OR_USERNAME'],
    ['admin', 'Irvine Mechanical', 'CMS_OR_USERNAME'],
    ['Organization', 'Acree: Plumbing, HVAC & Electrical', 'SCHEMA_LITERAL'],
    ['Stryker Digital', 'Climate Systems', 'BUSINESS_OR_AGENCY'],
    ['MosierData', 'Lakeland Air Conditioning', 'BUSINESS_OR_AGENCY'],
    ['Florida Certified Contractors', 'Contractor St. Augustine', 'BUSINESS_OR_AGENCY'],
    ['Benjamin Franklin Plumbing', 'Benjamin Franklin Plumbing Fort Worth', 'COMPANY_NAME'],
    ['Colder of Miami Inc', 'Colder of Miami: HVAC Contractor', 'COMPANY_NAME'],
  ];
  for (const [name, company, expected] of refused) {
    const verdict = judgePersonIdentity({ name, companyName: company });
    assert.equal(verdict.validity, expected, `${name} -> ${verdict.validity}`);
    assert.equal(verdict.mayHoldDecisionMakerAuthority, false,
      `${name} must never hold decision-maker authority`);
  }
});

test('real people are still people', () => {
  // The other 108. Refusing these to be safe would be the more expensive mistake.
  for (const [name, title, source] of [
    ['Yadiel Castro', 'Owner & Lead HVAC Contractor', 'https://colderofmiamiinc.com/about'],
    ['Ricky Orta', 'Founder', 'https://theairbros.com/about-us'],
    ['Mitchell Taback', 'Founder', 'https://allianceairsolutions.com/about'],
    ['Ashley Compton', 'Office Manager', 'https://boeschenheatandcool.com/contact'],
    ['Pedro Javier Pereira', null, 'https://example-co.test/team'],
    ["Sean O'Brien", 'President', 'https://example-co.test/leadership'],
  ] as const) {
    assert.equal(mayBeDecisionMaker({ name, rawTitle: title, sourceReference: source }), true,
      `${name} should be allowed to be a decision maker`);
  }
});

test('one name is not enough on its own, and is not deleted either', () => {
  // Michael's caution: do not overcorrect and lose the real single-name owner.
  const bare = judgePersonIdentity({ name: 'Mauricio', companyName: 'Air Dynamics' });
  assert.equal(bare.validity, 'INSUFFICIENT_PERSON_IDENTITY');
  assert.equal(bare.mayHoldDecisionMakerAuthority, false);

  // Carried by context: a person's title, on a page about the people who work here.
  const carried = judgePersonIdentity({
    name: 'Mauricio', companyName: 'Air Dynamics', rawTitle: 'Owner',
    sourceReference: 'https://adtx.us/our-team' });
  assert.equal(carried.validity, 'LIKELY_PERSON');
  assert.equal(carried.mayHoldDecisionMakerAuthority, true);
  assert.equal(carried.confidence, 'LOW', 'and it says how sure it is');
});

/* ---------------------------------------------- B. contact route attribution --- */

test("the owner's own address is attributed to the owner", () => {
  // colderofmiamiinc.com/contact publishes both of these under "Email Address". Sales
  // Brain found the person, found the address, and linked neither: contact_id is null on
  // all 609 production endpoints.
  const direct = attributeEndpoint({
    endpointKind: 'EMAIL', value: 'yadielcastro2@gmail.com', personName: 'Yadiel Castro',
    observedBasis: 'SAME_CONTACT_CARD' });
  assert.equal(direct.role, 'DIRECT_PERSON_EMAIL');
  assert.equal(direct.attributedTo, 'Yadiel Castro');
  assert.equal(direct.confidence, 'HIGH', 'the card and the spelling agree');
  assert.match(direct.reasons.join(' '), /local part spells Yadiel Castro/);

  assert.equal(localPartNamesPerson('yadielcastro2@gmail.com', 'Yadiel Castro'), true);
  // One matching token is not a claim on a mailbox.
  assert.equal(localPartNamesPerson('yadiel@example-co.test', 'Yadiel Castro'), false);
  assert.equal(localPartNamesPerson('jsmith@example-co.test', 'John Smith'), false);
});

test('a role mailbox never becomes a person, wherever it sits on the page', () => {
  // The false positive that would do real damage: a rep who believes they hold the
  // owner's direct line stops looking for it.
  for (const address of ['info@colderofmiamiinc.com', 'office@example-co.test',
    'service@example-co.test', 'sales@example-co.test', 'support@example-co.test',
    'booknow@acsheatingandairllc.com']) {
    assert.equal(isRoleMailbox(address), true, `${address} is a role mailbox`);
    const verdict = attributeEndpoint({
      endpointKind: 'EMAIL', value: address, personName: 'Yadiel Castro',
      // Even handed the strongest possible basis.
      observedBasis: 'MAILTO_ON_PERSON' });
    assert.equal(verdict.role, 'ROLE_EMAIL', `${address} must stay a role mailbox`);
    assert.equal(verdict.attributedTo, null);
  }
});

test('sharing a website is not attribution', () => {
  // The owner on /about and info@ on /contact are two facts, not one.
  // A neutral mailbox -- not a role address, not spelling his name -- so the test is
  // about co-occurrence rather than about either of the other two rules.
  const apart = attributeEndpoint({
    endpointKind: 'EMAIL', value: 'm.taback@example-co.test', personName: 'Ricky Orta',
    observedBasis: 'NONE' });
  assert.equal(apart.role, 'GENERAL_BUSINESS_EMAIL');
  assert.equal(apart.attributedTo, null);
  assert.match(apart.reasons.join(' '), /same site, which is not evidence/);

  // A number cannot spell a name, so a phone needs the layout to say so.
  const phone = attributeEndpoint({
    endpointKind: 'PHONE', value: '+17864747519', personName: 'Yadiel Castro',
    observedBasis: 'NONE' });
  assert.equal(phone.role, 'MAIN_BUSINESS_LINE');
  assert.equal(phone.attributedTo, null);

  const stated = attributeEndpoint({
    endpointKind: 'PHONE', value: '+17864747519', personName: 'Yadiel Castro',
    observedBasis: 'EXPLICIT_TEXT_STATEMENT' });
  assert.equal(stated.role, 'DIRECT_PERSON_PHONE');
});

test('a mailto wrapped around a name is the company saying so', () => {
  const html = `<div class="team-card">
      <h3>Ricky Orta</h3><p>Founder</p>
      <a href="mailto:ricky@theairbros.test">Ricky Orta</a>
    </div>
    <footer><a href="mailto:info@theairbros.test">Email us</a></footer>`;
  const found = attributionsInHtml(html, 'Ricky Orta');
  const mailto = found.find((f) => f.basis === 'MAILTO_ON_PERSON');
  assert.equal(mailto?.value, 'ricky@theairbros.test');
  // The footer address is not in his card and is not claimed for him.
  assert.equal(found.some((f) => f.value === 'info@theairbros.test'
    && f.basis === 'MAILTO_ON_PERSON'), false);
});

/* ------------------------------------------------- C. reserved domains --- */

test('a reserved domain is never a website and never worth retrying', () => {
  const verdict = judgeDomain('proofroof.invalid');
  assert.equal(verdict.validity, 'RESERVED_TLD');
  assert.equal(verdict.usableAsWebsite, false);
  assert.equal(verdict.worthRecovering, false,
    'ten hours of DNS lookups against a name that cannot resolve');
  assert.match(verdict.reason, /RFC 2606/);

  for (const bad of ['x.test', 'y.example', 'z.localhost', 'example.com', '10.0.0.1', 'nodots']) {
    assert.equal(isUsableWebsiteDomain(bad), false, `${bad} is not a company website`);
  }
  for (const good of ['colderofmiamiinc.com', 'theairbros.com', 'masterrepairplumbing.com',
    'adtx.us', 'some-company.co.uk']) {
    assert.equal(isUsableWebsiteDomain(good), true, `${good} is a usable domain`);
  }
});

/* ----------------------------------------------- F. product pages --- */

test('a cutting-tool SKU page is not an HVAC contractor', () => {
  // Account 05d63b3f: "Tool # 32806" on harveytool.com, workable, three named people.
  const verdict = classifySourceRole({
    url: 'https://harveytool.com/Products/Miniature-End-Mills/Tool-32806',
    title: 'Tool # 32806', companyName: 'Tool # 32806' });
  assert.equal(verdict.role, 'PRODUCT_PAGE');
  assert.equal(mayPromoteRole('PRODUCT_PAGE'), false);

  // Shape-based, so the next manufacturer is caught without being named.
  for (const [url, title] of [
    ['https://anyvendor.test/product/abc-123', 'Widget 44-A'],
    ['https://anyvendor.test/catalog/x', 'Part No. 9912'],
    ['https://anyvendor.test/shop/y', 'SKU: 55120'],
  ] as const) {
    assert.equal(classifySourceRole({ url, title }).role, 'PRODUCT_PAGE', url);
  }

  // And a contractor whose page merely mentions a product is untouched.
  assert.equal(classifySourceRole({
    url: 'https://coolairtampa.com/services/ac-repair',
    title: 'AC Repair | Cool Air Tampa', companyName: 'Cool Air Tampa' }).role,
    'COMPANY_SERVICE_PAGE');
});

/* ------------------------------- things already correct, pinned so nobody "fixes" them --- */

test('a form placeholder is not a company email', () => {
  // allianceairsolutions.com publishes xyz@123.com as a form-field placeholder. Sales
  // Brain did not ingest it and no placeholder-shaped address exists anywhere in the
  // estate. Pinned because the audit checked, not because anything was broken.
  const verdict = attributeEndpoint({
    endpointKind: 'EMAIL', value: 'xyz@123.com', personName: 'Mitchell Taback',
    observedBasis: 'NONE' });
  assert.equal(verdict.attributedTo, null,
    'a placeholder must never be attributed to a person');
});
