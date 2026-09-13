import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonLd, peopleFromJsonLd, peopleFromText, endpointsFromHtml, stripTags,
} from '../src/resolver/adapters/firstParty.js';
import { reconcile } from '../src/resolver/reconcile.js';

/**
 * Stage A extraction.
 * The bar these must clear: never invent a person, and never let a page's layout
 * turn a main line into somebody's direct line.
 */

const REF = 'https://example.com/team';

test('schema.org Person and Organization nodes are read as first-party evidence', () => {
  const html = `
    <script type="application/ld+json">
    {
      "@context":"https://schema.org",
      "@type":"LocalBusiness",
      "name":"Northgate Air",
      "telephone":"+1-904-555-0100",
      "email":"info@northgate.example.com",
      "employee":[
        {"@type":"Person","name":"Dana Fielder","jobTitle":"Director of Operations",
         "email":"dana@northgate.example.com"}
      ]
    }
    </script>`;
  const blocks = extractJsonLd(html);
  assert.equal(blocks.length, 1);

  const { people, endpoints } = peopleFromJsonLd(blocks, REF);
  assert.equal(people.length, 1);
  assert.equal(people[0]!.personName, 'Dana Fielder');
  assert.equal(people[0]!.relationship, 'OPERATIONS');
  assert.equal(people[0]!.sourceClass, 'COMPANY_FIRST_PARTY');

  const orgPhone = endpoints.find((e) => e.kind === 'PHONE')!;
  assert.equal(orgPhone.isMainLine, true, 'an Organization telephone is a company route');
  assert.equal(orgPhone.explicitlyPersonal, false);

  const personEmail = endpoints.find((e) => e.kind === 'EMAIL' && e.explicitlyPersonal)!;
  assert.equal(personEmail.attributedToPersonName, 'Dana Fielder');
});

test('a malformed JSON-LD block is skipped rather than half-parsed', () => {
  const html = `
    <script type="application/ld+json">{ "@type": "Person", "name": </script>
    <script type="application/ld+json">{"@type":"Person","name":"Real Person","jobTitle":"Owner"}</script>`;
  const blocks = extractJsonLd(html);
  assert.equal(blocks.length, 1);
  assert.equal(peopleFromJsonLd(blocks, REF).people[0]!.personName, 'Real Person');
});

test('name and title pairs are read from visible text in the usual layouts', () => {
  const text = stripTags(`
    <div><h3>Dana Fielder</h3><p>Owner</p></div>
    <p>Riley Marsh — General Manager</p>
    <p>Operations Manager: Jordan Quill</p>
    <p>Alex Vance is the Managing Partner of the firm.</p>
    <p>Northgate Air was founded by Casey Nash in 2004.</p>
  `);
  const people = peopleFromText(text, REF);
  const byName = new Map(people.map((p) => [p.personName, p]));

  assert.equal(byName.get('Riley Marsh')?.relationship, 'GENERAL_MANAGER');
  assert.equal(byName.get('Jordan Quill')?.relationship, 'OPERATIONS');
  assert.equal(byName.get('Alex Vance')?.relationship, 'MANAGING_PARTNER');
  assert.equal(byName.get('Casey Nash')?.relationship, 'FOUNDER');
});

test('the company name is never extracted as a person', () => {
  // Regression: a team card ending in a title, followed by a sentence starting with
  // the company name, produced a contact called "Marsh Point Air, Office Manager".
  const text = stripTags(`
    <div><h3>Morgan Ober</h3><p>Office Manager</p></div>
    <p>Marsh Point Air was founded by Casey Nash in 2004.</p>
  `);
  const people = peopleFromText(text, REF, 'Marsh Point Air & Heating');
  const names = people.map((p) => p.personName);
  assert.ok(names.includes('Morgan Ober'));
  assert.ok(names.includes('Casey Nash'));
  assert.equal(names.includes('Marsh Point Air'), false, 'the company is not a person');
});

test('a title followed by a new sentence does not create a person', () => {
  const text = stripTags(`
    <div><h3>Dana Fielder</h3><p>Owner</p></div>
    <p>Riverbend Plumbing Serves Duval County residents every day.</p>
  `);
  const people = peopleFromText(text, REF, 'Northgate Air');
  assert.deepEqual(people.map((p) => p.personName), ['Dana Fielder']);
});

test('marketing prose does not manufacture people', () => {
  const text = stripTags(`
    <p>Our Owner Operated Trucks arrive fast. We treat every Customer Service Request
       with care. Emergency Service Available. Serving Jacksonville Beach and
       Orange Park since 1998. Financing Available Today.</p>
    <p>Trusted Local Experts. Free Estimates. Satisfaction Guaranteed.</p>
  `);
  const people = peopleFromText(text, REF);
  assert.deepEqual(people, [], 'no person may be invented from marketing copy');
});

test('a tel: link is a company route, not a personal line', () => {
  const html = `<a href="tel:+19045550100">Call us</a>
                <a href="mailto:info@northgate.example.com">Email</a>`;
  const endpoints = endpointsFromHtml(html, REF);

  const phone = endpoints.find((e) => e.kind === 'PHONE')!;
  assert.equal(phone.isMainLine, true);
  assert.equal(phone.explicitlyPersonal, false);
  assert.equal(phone.attributedToPersonName, undefined);
});

test('an explicit personal-line statement is the one thing that makes a direct line', () => {
  const html = `
    <p>Jane Smith, Owner. Call Jane Smith directly at 904-555-0400.</p>
    <a href="tel:+19045550100">Main office</a>`;
  const endpoints = endpointsFromHtml(html, REF);

  const direct = endpoints.find((e) => e.explicitlyPersonal)!;
  assert.ok(direct, 'the explicit statement is recognized');
  assert.equal(direct.attributedToPersonName, 'Jane Smith');
  assert.equal(direct.isMainLine, false);

  const main = endpoints.find((e) => e.isMainLine)!;
  assert.equal(main.explicitlyPersonal, false);

  // End to end: only the explicitly personal number becomes a direct line.
  const result = reconcile({
    companyName: 'Smith Roofing', verticalProfileId: 'roofing', hypothesisCategory: 'speed_to_lead',
    people: peopleFromText(stripTags(html), REF),
    endpoints,
  });
  const directPath = result.contactPaths.find((p) => p.relationshipToPerson === 'DIRECT_CONFIRMED');
  assert.equal(directPath?.value, '+19045550400');
  const mainPath = result.contactPaths.find((p) => p.value === '+19045550100');
  assert.equal(mainPath?.relationshipToPerson, 'COMPANY_ROUTE');
  assert.equal(result.status, 'NAMED_DIRECT_READY');
});

test('a name sitting near the main number does not turn it into a direct line', () => {
  const html = `
    <div class="team-card">
      <h3>Dana Fielder</h3><p>Owner</p>
      <a href="tel:+19045550100">904-555-0100</a>
    </div>`;
  const result = reconcile({
    companyName: 'Northgate Air', verticalProfileId: 'hvac', hypothesisCategory: 'after_hours',
    people: peopleFromText(stripTags(html), REF),
    endpoints: endpointsFromHtml(html, REF),
  });
  const path = result.contactPaths[0]!;
  assert.equal(path.relationshipToPerson, 'COMPANY_ROUTE',
    'proximity on a page is not evidence of a personal line');
  assert.equal(path.askFor, 'Dana Fielder');
  assert.equal(result.status, 'NAMED_MAINLINE_ROUTE_READY');
});

test('a published extension is captured against the person', () => {
  const html = `
    <a href="tel:+19045550100">904-555-0100</a>
    <p>Lisa Chen, Sales Manager, ext. 204</p>`;
  const endpoints = endpointsFromHtml(html, REF);
  const withExtension = endpoints.find((e) => e.extension === '204');
  assert.ok(withExtension, 'the extension is recorded');
  assert.equal(withExtension!.attributedToPersonName, 'Lisa Chen');
  assert.equal(withExtension!.explicitlyPersonal, false, 'an extension is still a company route');
});

test('an info@ address never attaches to a person', () => {
  const html = `<p>Dana Fielder, Owner</p><a href="mailto:info@northgate.example.com">Email us</a>`;
  const result = reconcile({
    companyName: 'Northgate Air', verticalProfileId: 'hvac', hypothesisCategory: 'after_hours',
    people: peopleFromText(stripTags(html), REF),
    endpoints: endpointsFromHtml(html, REF),
  });
  const emailPath = result.contactPaths.find((p) => p.kind === 'EMAIL')!;
  assert.equal(emailPath.endpointRole, 'GENERAL_BUSINESS_EMAIL');
  assert.equal(emailPath.relationshipToPerson, 'ROLE_INBOX');
  assert.notEqual(result.status, 'NAMED_EMAIL_READY');
});

test('stripTags removes script and style content, not just angle brackets', () => {
  const html = `<style>.a{content:"Fake Person, Owner"}</style>
                <script>var x = "Other Person, CEO";</script>
                <p>Real Person, Owner</p>`;
  const text = stripTags(html);
  assert.doesNotMatch(text, /Fake Person/);
  assert.doesNotMatch(text, /Other Person/);
  assert.match(text, /Real Person/);
});
