import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail } from '../src/domain/normalize.js';

/**
 * A mailbox on a company domain is not a person.
 *
 * Production showed a rep a U-Haul drawer where `donations@`, `propane@`,
 * `influencer@`, `equipmentrecovery@`, `credit_department@`, `investor_relations@`,
 * `publications@`, `tickets@`, `saleswss@`, `trucksales@` and `customer_care@` were all
 * labelled "Personal work email". The classifier promoted any local part shaped like a
 * word or two to the person class, and its own comment conceded that identity still
 * needed separate evidence before returning the person class anyway.
 *
 * The rule now: shape may describe a mailbox, only evidence may make it a person.
 */

const PERSON = { attributedToPersonName: 'Jane Doe' };

test('the production mailboxes that were called personal are not personal', () => {
  const observed = [
    'influencer@uhaul.com', 'donations@uhaul.com', 'equipmentrecovery@uhaul.com',
    'saleswss@uhaul.com', 'tickets@uhaul.com', 'credit_department@uhaul.com',
    'publications@uhaul.com', 'investor_relations@amerco.com',
    'sustainability@uhaul.com', 'propane@uhaul.com',
    'customer_care@collegeboxes.com', 'trucksales@uhaul.com',
    'corporatesales@uhaul.com', 'militarymove@uhaul.com', 'publicrelations@uhaul.com',
  ];
  for (const email of observed) {
    const role = classifyEmail(email);
    assert.notEqual(role, 'DIRECT_PERSON_EMAIL',
      `${email} is still classified as a person's address`);
  }
});

test('function mailboxes read as roles', () => {
  const roles: [string, string][] = [
    ['sales@company.com', 'ROLE_EMAIL'],
    ['support@company.com', 'ROLE_EMAIL'],
    ['billing@company.com', 'ROLE_EMAIL'],
    ['customer_care@company.com', 'ROLE_EMAIL'],
    ['investor_relations@company.com', 'ROLE_EMAIL'],
    ['credit_department@company.com', 'ROLE_EMAIL'],
    ['trucksales@company.com', 'ROLE_EMAIL'],
    ['equipmentrecovery@company.com', 'ROLE_EMAIL'],
    ['donations@company.com', 'ROLE_EMAIL'],
    ['publications@company.com', 'ROLE_EMAIL'],
    ['tickets@company.com', 'ROLE_EMAIL'],
  ];
  for (const [email, expected] of roles) {
    assert.equal(classifyEmail(email), expected, `${email} misclassified`);
  }
});

test('the front door is general, not a role and not a person', () => {
  for (const email of ['info@company.com', 'contact@company.com', 'hello@company.com', 'mail@company.com']) {
    assert.equal(classifyEmail(email), 'GENERAL_BUSINESS_EMAIL', `${email} misclassified`);
  }
});

test('a person-shaped mailbox is a person only with evidence', () => {
  // Shape alone: honest "some other business mailbox", never a claim about a human.
  assert.equal(classifyEmail('john.smith@company.com'), 'UNKNOWN_EMAIL_TYPE');
  assert.equal(classifyEmail('jane@company.com'), 'UNKNOWN_EMAIL_TYPE');
  assert.equal(classifyEmail('jsmith@company.com'), 'UNKNOWN_EMAIL_TYPE');

  // Attributed to a named individual by the page it was published on.
  assert.equal(classifyEmail('john.smith@company.com', PERSON), 'DIRECT_PERSON_EMAIL');
  assert.equal(classifyEmail('jane@company.com', PERSON), 'DIRECT_PERSON_EMAIL');
});

test('evidence cannot promote a role mailbox to a person', () => {
  // Even published beside a named person, `sales@` is still the sales desk.
  assert.equal(classifyEmail('sales@company.com', PERSON), 'ROLE_EMAIL');
  assert.equal(classifyEmail('investor_relations@company.com', PERSON), 'ROLE_EMAIL');
  assert.equal(classifyEmail('info@company.com', PERSON), 'GENERAL_BUSINESS_EMAIL');
});

test('an unrecognised mailbox with no attribution is other business, not a person', () => {
  assert.equal(classifyEmail('randomalias@company.com'), 'UNKNOWN_EMAIL_TYPE');
  assert.equal(classifyEmail('xq7@company.com'), 'UNKNOWN_EMAIL_TYPE');
});

test('case and separators do not change the answer', () => {
  assert.equal(classifyEmail('Credit_Department@Company.com'), 'ROLE_EMAIL');
  assert.equal(classifyEmail('INVESTOR-RELATIONS@company.com'), 'ROLE_EMAIL');
  assert.equal(classifyEmail('John.Smith@company.com', PERSON), 'DIRECT_PERSON_EMAIL');
});
