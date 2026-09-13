import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  spokenPhone, spokenPhoneConfirmation, spokenExtension, spokenEmail, spokenUrl,
  spokenMoney, spokenPercentage, spokenApproximate, spokenDate, spokenTime,
  spokenBookingConfirmation, spokenTimezone, spokenAcronym, spokenToken, spokenZip,
  spokenVersion, spokenDuration, spokenNumber, spokenRange, spokenOrdinal,
} from '../src/callbrain/spoken.js';

/**
 * Spoken rendering, graded against the approved fixture set.
 * Authority: outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml.
 *
 * The negative controls matter as much as the positives: a phone number read in the
 * wrong groups and an ISO timestamp read aloud are both wrong answers that a
 * naturalness check alone would pass.
 */

const FIXTURES = parseYaml(readFileSync(
  new URL('../../../docs/09-software/outbound-sales-brain-sales-ai-spoken-normalization-fixtures.v1.yaml',
    import.meta.url), 'utf8')) as {
      fixtures: Record<string, any>[];
      rules: string[];
      acceptance: string[];
    };

const fixture = (id: string) => {
  const found = FIXTURES.fixtures.find((row) => row['id'] === id);
  assert.ok(found, `fixture ${id} exists`);
  return found!;
};

test('the fixture set loaded from the repository', () => {
  assert.equal(FIXTURES.fixtures.length, 40);
  assert.ok(FIXTURES.rules.includes('never_change_semantic_value_for_naturalness'));
});

test('V001-V004 a phone number keeps its digits and its grouping', () => {
  assert.equal(spokenPhone(fixture('V001')['canonical']), fixture('V001')['expected_spoken']);
  assert.equal(spokenPhone(fixture('V002')['canonical']), fixture('V002')['expected_spoken']);
  assert.equal(spokenPhoneConfirmation(fixture('V003')['canonical']),
    fixture('V003')['expected_shape']);
  assert.equal(spokenExtension(fixture('V004')['canonical']), fixture('V004')['expected_spoken']);

  for (const prohibited of fixture('V001')['prohibited'] as string[]) {
    assert.notEqual(spokenPhone(fixture('V001')['canonical']), prohibited);
  }
});

test('V038 the prohibited chunking is not what we produce', () => {
  const row = fixture('V038');
  assert.notEqual(spokenPhone(row['canonical']), row['prohibited_spoken'],
    'the same digits in the wrong groups is a different number to anyone listening');
});

test('V005-V007 an email is spoken with at and dot, exactly as stored', () => {
  assert.equal(spokenEmail(fixture('V005')['canonical']), fixture('V005')['expected_spoken']);
  assert.equal(spokenEmail(fixture('V006')['canonical']), fixture('V006')['expected_spoken_shape']);
  // The canonical address is never altered by how it is said.
  const canonical = fixture('V007')['canonical'] as string;
  const spoken = spokenEmail(canonical);
  assert.match(spoken, / at /);
  assert.match(spoken, / dot /);
  assert.equal(spoken.includes('@'), false);
});

test('V008 a URL is spoken in words, not character by character', () => {
  assert.equal(spokenUrl(fixture('V008')['canonical']), fixture('V008')['expected_spoken_shape']);
});

test('V009-V011, V027-V029, V036-V037 numbers read as people say them', () => {
  assert.equal(spokenMoney(Number(fixture('V009')['canonical'])),
    fixture('V009')['expected_spoken']);
  assert.equal(spokenMoney(Number(fixture('V010')['canonical'])),
    fixture('V010')['expected_spoken']);
  assert.equal(spokenPercentage(Number(fixture('V011')['canonical'])),
    fixture('V011')['expected_spoken']);
  assert.equal(spokenZip(fixture('V027')['canonical']), fixture('V027')['expected_spoken']);
  assert.equal(spokenVersion(fixture('V028')['canonical']), fixture('V028')['expected_spoken']);
  assert.equal(spokenDuration(15), fixture('V029')['expected_spoken']);
  assert.equal(spokenRange(3, 5, 'business days'), fixture('V036')['expected_spoken']);
  assert.equal(spokenOrdinal(Number(fixture('V037')['canonical'])),
    fixture('V037')['expected_spoken']);
});

test('V012, V035, V040 an estimate is never spoken as a fact', () => {
  const approximate = fixture('V012');
  assert.equal(spokenApproximate(Number(approximate['canonical'])),
    approximate['expected_spoken_shape']);
  for (const prohibited of approximate['prohibited'] as string[]) {
    assert.notEqual(spokenApproximate(Number(approximate['canonical'])), prohibited);
  }

  const uncertain = fixture('V035');
  assert.equal(spokenApproximate(Number(uncertain['canonical']), uncertain['unit'] === 'leads_per_month'
    ? 'leads a month' : undefined), uncertain['expected_spoken_shape']);

  // False precision: 17.382 does not become a verified figure just by being readable.
  assert.match(spokenNumber(17.382), /seventeen point/,
    'the value survives; whether it may be stated at all is a business decision');
});

test('V013-V016, V039 dates and times carry their zone and never their storage format', () => {
  assert.equal(spokenDate(fixture('V013')['canonical'], fixture('V013')['timezone']),
    fixture('V013')['expected_spoken_shape']);
  assert.equal(spokenTime(fixture('V014')['canonical']),
    fixture('V014')['expected_spoken_shape']);
  assert.equal(spokenTimezone(fixture('V016')['canonical']), fixture('V016')['expected_spoken']);

  // The negative control: no part of an ISO timestamp reaches speech.
  const spoken = `${spokenDate(fixture('V039')['canonical'])} ${spokenTime(fixture('V039')['canonical'])}`;
  assert.equal(/\d{4}-\d{2}|T\d{2}:|dash/.test(spoken), false, spoken);
  assert.notEqual(spoken, fixture('V039')['prohibited_spoken']);
});

test('V015 a booking read-back says tomorrow only when it is tomorrow', () => {
  const slot = fixture('V015')['canonical'] as string;
  // The fixture's own date context: the day before the slot.
  const dayBefore = new Date('2026-09-03T18:00:00-04:00');
  assert.equal(spokenBookingConfirmation(slot, 'America/New_York', dayBefore),
    fixture('V015')['expected_spoken_shape']);

  // A week earlier, "tomorrow" would be a lie, so the date is spoken instead.
  const weekBefore = new Date('2026-08-28T18:00:00-04:00');
  const distant = spokenBookingConfirmation(slot, 'America/New_York', weekBefore);
  assert.equal(distant.includes('tomorrow'), false);
  assert.match(distant, /September fourth/);
});

test('V017-V020 acronyms are spelled unless a spoken form exists', () => {
  for (const id of ['V017', 'V018', 'V019', 'V020']) {
    assert.equal(spokenAcronym(fixture(id)['canonical']), fixture(id)['expected_spoken']);
  }
  assert.equal(spokenAcronym('SEO'), 'seo', 'nobody spells S E O out loud');
});

test('V021-V025 product and company names read the way they are said', () => {
  assert.equal(spokenToken(fixture('V021')['canonical']), fixture('V021')['expected_spoken']);
  assert.equal(spokenToken(fixture('V022')['canonical']), fixture('V022')['expected_spoken']);
  assert.equal(spokenToken(fixture('V023')['canonical']), fixture('V023')['expected_spoken']);
  assert.equal(spokenToken(fixture('V024')['canonical']), fixture('V024')['expected_spoken']);
  assert.equal(spokenToken(fixture('V025')['canonical']), fixture('V025')['expected_spoken_shape']);
});

test('the pronunciation dictionary overrides by scope, closest first', () => {
  const dictionary = [
    { canonicalToken: 'ABC Air', spokenForm: 'A B C Air Conditioning', scope: 'global' as const,
      source: 'ops', verifiedAt: null },
    { canonicalToken: 'ABC Air', spokenForm: 'Abbey Air', scope: 'account' as const,
      source: 'the owner told us', verifiedAt: new Date() },
    { canonicalToken: 'ABC Air', spokenForm: 'Abbey', scope: 'contact' as const,
      source: 'the owner told us', verifiedAt: new Date() },
  ];
  assert.equal(spokenToken('ABC Air', dictionary), 'Abbey',
    'what the person we are speaking to calls it wins');
  assert.equal(spokenToken('ABC Air', dictionary.slice(0, 2)), 'Abbey Air');
});

test('V030 more than two slots returned still means two offered', () => {
  // Enforced in the agent rather than here, and asserted where it lives.
  assert.equal(fixture('V030')['expected_behavior'], 'offer_at_most_two_slots_even_if_more_returned');
});
