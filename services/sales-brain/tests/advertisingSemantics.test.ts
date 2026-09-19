import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adBadges } from '../src/web/components.js';

/**
 * A grey dash was answering two different questions.
 *
 * The Advertising column rendered "—" both for the company nobody has looked at and
 * for the company we hold current evidence about that shows no advertising. A rep
 * reads a dash as "no". One of those is a gap in our work and the other is a fact
 * about the prospect, and advertiser-first mining makes the difference the whole
 * basis of who to call first.
 *
 * `prospect_inventory` builds these with `bool_or` over current uncontradicted
 * evidence, and `bool_or` over no rows is null -- so the two were always
 * distinguishable and nothing read the difference.
 */

const render = (row: Parameters<typeof adBadges>[0]): string => String(adBadges(row));

test('an observed advertiser still shows its channels', () => {
  const google = render({ google_paid: true, google_lsa: false, meta_paid: false });
  assert.match(google, /Google/);
  assert.doesNotMatch(google, /None seen|Not checked/);

  const both = render({ google_paid: true, google_lsa: true, meta_paid: false });
  assert.match(both, /Google/);
  assert.match(both, /LSA/);
});

test('evidence that shows no advertising says so', () => {
  const row = render({ google_paid: false, google_lsa: false, meta_paid: false });
  assert.match(row, /None seen/);
  assert.doesNotMatch(row, /Not checked/);
});

test('a company nobody has looked at says that instead', () => {
  const row = render({ google_paid: null, google_lsa: null, meta_paid: null });
  assert.match(row, /Not checked/);
  assert.doesNotMatch(row, /None seen/);
});

test('neither empty answer is a bare dash any more', () => {
  for (const row of [
    { google_paid: null, google_lsa: null, meta_paid: null },
    { google_paid: false, google_lsa: false, meta_paid: false },
  ]) {
    assert.doesNotMatch(render(row), /—/,
      'the ambiguous dash is still being rendered');
  }
});

test('a row that never selected the columns is not reported as a finding', () => {
  // A caller that does not ask for advertising knows nothing about it, and must not
  // be made to say we checked and found none.
  assert.match(render({}), /Not checked/);
});
