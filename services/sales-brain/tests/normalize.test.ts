import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEmail, extractExtension, normalizeCompanyName, normalizeEmail, normalizeHostname,
  normalizePhone, normalizePostalCode, normalizeState, registrableDomain, splitPersonName,
} from '../src/domain/normalize.js';

test('company names normalize past legal suffixes and punctuation', () => {
  assert.equal(normalizeCompanyName('ABC Air Conditioning, LLC'), 'abc air conditioning');
  assert.equal(normalizeCompanyName('ABC Air Conditioning LLC.'), 'abc air conditioning');
  // Initialisms collapse, and '&'/'and' are treated as noise, so these two spellings
  // of the same company resolve to one identity.
  assert.equal(normalizeCompanyName('A.B.C. Air & Heat Inc'), 'abc air heat');
  assert.equal(normalizeCompanyName('ABC Air and Heat'), 'abc air heat');
  assert.equal(normalizeCompanyName('The Smith Company'), 'smith');
  // A legal form that is genuinely part of the name is not stripped to nothing.
  assert.equal(normalizeCompanyName('LLC'), 'llc');
});

test('phone normalization produces E.164 and rejects impossible numbers', () => {
  assert.equal(normalizePhone('904-555-0100'), '+19045550100');
  assert.equal(normalizePhone('(904) 555-0100'), '+19045550100');
  assert.equal(normalizePhone('1 904 555 0100'), '+19045550100');
  assert.equal(normalizePhone('904.555.0100 ext 12'), '+19045550100');
  assert.equal(extractExtension('904.555.0100 ext 12'), '12');
  assert.equal(normalizePhone('555-0100'), null, 'seven digits is not a dialable business number');
  assert.equal(normalizePhone('104-555-0100'), null, 'area code cannot start with 0 or 1');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('email normalization and role classification keep info@ away from people', () => {
  assert.equal(normalizeEmail('  John.Smith@ABCAir.com '), 'john.smith@abcair.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail('john@localhost'), null, 'a bare hostname is not a business domain');

  assert.equal(classifyEmail('info@abcair.com'), 'GENERAL_BUSINESS_EMAIL');
  assert.equal(classifyEmail('sales@abcair.com'), 'ROLE_EMAIL');
  assert.equal(classifyEmail('front.desk@abcair.com'), 'ROLE_EMAIL');
  assert.equal(classifyEmail('john.smith@abcair.com'), 'DIRECT_PERSON_EMAIL');
  assert.equal(classifyEmail('john@abcair.com'), 'DIRECT_PERSON_EMAIL');
});

test('hostnames normalize to a comparable identity', () => {
  assert.equal(normalizeHostname('https://WWW.ABCAir.com/contact?x=1'), 'abcair.com');
  assert.equal(normalizeHostname('abcair.com:8080'), 'abcair.com');
  assert.equal(normalizeHostname('jax.abcair.com'), 'jax.abcair.com');
  assert.equal(registrableDomain('jax.abcair.com'), 'abcair.com');
  assert.equal(registrableDomain('abcair.co.uk'), 'abcair.co.uk');
  assert.equal(normalizeHostname('not a domain'), null);
});

test('geography normalization', () => {
  assert.equal(normalizePostalCode('32256-1234'), '32256');
  assert.equal(normalizePostalCode('3225'), null);
  assert.equal(normalizeState('Florida'), 'FL');
  assert.equal(normalizeState('fl'), 'FL');
  assert.equal(normalizeState('Republic of Nowhere'), null);
});

test('person name splitting keeps middle names out of the surname', () => {
  assert.deepEqual(splitPersonName('John Q. Smith'), { first: 'John', last: 'Smith' });
  assert.deepEqual(splitPersonName('Cher'), { first: 'Cher', last: null });
});
