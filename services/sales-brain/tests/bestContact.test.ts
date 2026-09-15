import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBestContact } from '../src/domain/bestContact.js';

/**
 * Who to ask for, said separately from what the record says they are.
 *
 * Collapsing the two is how "qualifying agent" becomes "owner" in a CRM and then
 * becomes "can I speak to the owner?" on a call to somebody who has never owned
 * anything.
 */

const person = (over: Partial<Parameters<typeof chooseBestContact>[0][number]> = {}) => ({
  personName: 'Dana Kowalczyk', relationship: 'OWNER', rawTitle: 'Owner',
  fromFirstParty: true, ...over,
});

test('an owner named by the company is the best contact and is called owner', () => {
  const best = chooseBestContact([person()])!;
  assert.equal(best.personName, 'Dana Kowalczyk');
  assert.equal(best.isOwner, true);
  assert.equal(best.confidence, 'NAMED_AND_VERIFIED');
  assert.match(best.askFor, /Ask for Dana Kowalczyk, Owner/);
});

test('a registered agent is never suggested, even as the only name', () => {
  const best = chooseBestContact([
    person({ personName: 'Coastal Agent Services Inc', relationship: 'REGISTERED_AGENT',
      rawTitle: 'Registered Agent', fromFirstParty: false }),
  ]);
  assert.equal(best, null,
    'a service-of-process address was offered as the person to call');
});

test('a qualifier is offered as a name, never as an owner', () => {
  const best = chooseBestContact([
    person({ personName: 'Jordan Okafor', relationship: 'QUALIFIER',
      rawTitle: 'Responsible Master Plumber', fromFirstParty: false }),
  ])!;
  assert.equal(best.personName, 'Jordan Okafor');
  assert.equal(best.isOwner, false, 'a regulatory designation became ownership');
  assert.equal(best.verifiedRole, 'Responsible Master Plumber',
    'the record’s own words were replaced');
  assert.equal(best.confidence, 'NAMED_UNVERIFIED');
  assert.match(best.reason, /not that they run it/i);
  assert.match(best.askFor, /by name rather than by title/i,
    'a rep would have asked for them by a regulatory title');
});

test('an operational role beats an evidence-only one', () => {
  const best = chooseBestContact([
    person({ personName: 'Jordan Okafor', relationship: 'QUALIFIER', rawTitle: null,
      fromFirstParty: false }),
    person({ personName: 'Priya Nair', relationship: 'OPERATIONS',
      rawTitle: 'Operations Manager', fromFirstParty: true }),
  ])!;
  assert.equal(best.personName, 'Priya Nair');
});

test('the company naming someone beats a filing naming them', () => {
  const best = chooseBestContact([
    person({ personName: 'Filing Person', relationship: 'PRESIDENT',
      rawTitle: 'PRESIDENT', fromFirstParty: false }),
    person({ personName: 'Website Person', relationship: 'PRESIDENT',
      rawTitle: 'President', fromFirstParty: true }),
  ])!;
  assert.equal(best.personName, 'Website Person',
    'a filing that says who signed something once beat a site that says who works there');
});

test('an operations manager is preferred over a distant director', () => {
  const best = chooseBestContact([
    person({ personName: 'Distant Director', relationship: 'OFFICER',
      rawTitle: 'DIRECTOR', fromFirstParty: false }),
    person({ personName: 'Ops Lead', relationship: 'OPERATIONS',
      rawTitle: 'Operations Manager', fromFirstParty: true }),
  ])!;
  assert.equal(best.personName, 'Ops Lead');
});

test('no people at all yields no suggestion rather than a role placeholder', () => {
  assert.equal(chooseBestContact([]), null);
  assert.equal(chooseBestContact([person({ personName: null })]), null);
});

test('owner is printed only when a source actually said owner', () => {
  for (const relationship of ['QUALIFIER', 'LICENSE_HOLDER', 'OFFICER', 'MEMBER',
    'PRESIDENT', 'OPERATIONS']) {
    const best = chooseBestContact([
      person({ relationship, rawTitle: null, fromFirstParty: false })])!;
    assert.equal(best.isOwner, false, `${relationship} was reported as ownership`);
  }
  assert.equal(chooseBestContact([person({ relationship: 'OWNER' })])!.isOwner, true);
});
