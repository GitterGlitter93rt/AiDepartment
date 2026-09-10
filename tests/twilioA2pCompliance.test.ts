// Twilio A2P 10DLC compliance contract.
// Run with: node --experimental-strip-types --test tests/twilioA2pCompliance.test.ts
// (requires dist/ — `npm test` builds first.)
//
// The campaign has been rejected on five codes. Each one is a claim
// about what the *live site* says, so these assertions run against the
// built HTML wherever possible rather than the source.
//
//   30907  website brand did not match the registered sender
//   30908  Privacy Policy lacked mobile/SMS non-sharing language
//   30896  opt-in flow did not demonstrate consent
//   30882  Terms insufficient for the SMS campaign
//   30923  forced consent — SMS treated as a condition of proceeding
//
// 30923 is the reason tests/smsConsentOptional.test.ts exists. Every
// structural assertion in this file passed on the build that earned
// that rejection: the checkbox had no `checked` and no `required`, and
// the submit handler refused the form anyway. Structure is necessary
// and not sufficient, so the optionality of the opt-in is proved by
// executing the shipped handler over there. What is asserted here is
// the part a reviewer reads rather than clicks.
//
// These test compliance SEMANTICS, not prose. They do not assert whole
// paragraphs of legal text — that would break on every copy edit and
// teach the next person to delete the test. They assert the things a
// reviewer actually checks and the things that would silently regress:
// that the entity is consistent, that the checkbox is unchecked, that
// no PII reaches analytics, and that tomorrow's legal entity has not
// been published early.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRAND_NAME,
  LEGAL_ENTITY,
  LEGAL_RELATIONSHIP,
  SMS_CONSENT_VERSION,
  SMS_CONSENT_DISCLOSURE_PLAIN,
  SMS_SENDER_DISPLAY_NAME,
  SMS_USE_CASE,
  LEGAL_ROUTES,
} from '../src/lib/businessIdentity.ts';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

/** The entity that must NOT yet appear as the active operator. When the
 * cutover happens this flips — see docs/legal-entity-cutover.md §3. */
const FUTURE_ENTITY = 'Your AI Department LLC';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function page(route: string): string {
  const file = join(DIST, route.slice(1), 'index.html');
  assert.ok(existsSync(file), `${route} must be built before this suite runs (npm test builds first)`);
  return readFileSync(file, 'utf8');
}

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_astro' || entry === 'node_modules') continue;
      out.push(...walk(full, match));
    } else if (match(full)) out.push(full);
  }
  return out;
}

const allHtml = () => walk(DIST, (f) => f.endsWith('.html'));

/** Every JSON-LD node on a page, parsed. Regex-slicing a node out of
 * the HTML breaks the moment a node nests another object — which is
 * exactly what happened when Organization gained an ImageObject logo. */
function jsonLdNodes(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
}

function stripCode(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
}

function visibleText(html: string): string {
  return stripCode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// ============================================================
// The identity module is the single source
// ============================================================

describe('Business identity is centralized, not scattered', () => {
  test('the module states today\'s entity, and the brand is not called a DBA', () => {
    assert.equal(BRAND_NAME, 'Your AI Department');
    assert.equal(LEGAL_ENTITY, 'Catastrophic Solutions LLC');
    assert.equal(LEGAL_RELATIONSHIP, 'Your AI Department is a business brand operated by Catastrophic Solutions LLC.');
    assert.equal(SMS_USE_CASE, 'CUSTOMER_CARE');
    const src = read('src/lib/businessIdentity.ts');
    // "DBA" is a specific legal filing. Nothing in this repository
    // evidences one, so nothing may assert it.
    assert.equal(/\bDBA\b|doing business as/i.test(LEGAL_RELATIONSHIP), false);
    // The comment wraps, so match the position rather than a sentence.
    assert.match(src, /NOT described as a DBA/);
    assert.match(src, /no evidence of one exists/);
  });

  test('no rendered page hardcodes the legal entity outside the module', () => {
    // Documents may name it; rendered .astro pages must read it from
    // the module, or the cutover becomes a hunt again.
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'), (f) => f.endsWith('.astro') || f.endsWith('.ts'))) {
      if (file.endsWith('businessIdentity.ts')) continue;
      if (readFileSync(file, 'utf8').includes('Catastrophic Solutions')) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    assert.deepEqual(offenders, [], 'these files hardcode the legal entity instead of importing it');
  });

  test('the consent version is a real version, not a bare date', () => {
    // A date cannot tell you whether the disclosure changed. A version
    // stamped on the record can.
    assert.match(SMS_CONSENT_VERSION, /^sms_[a-z_]+_v\d+_\d{4}_\d{2}$/);
    assert.ok(SMS_CONSENT_VERSION.includes('customer_care'));
  });
});

// ============================================================
// 30907 — brand / registered-sender consistency
// ============================================================

describe('30907: every page names the same operator as the Twilio Brand', () => {
  test('the relationship line is in the footer of a full-chrome page', () => {
    for (const route of ['/', '/contact/', '/privacy/', '/terms/', '/sms-consent/']) {
      assert.ok(page(route).includes(LEGAL_RELATIONSHIP), `${route}: footer disclosure missing`);
    }
  });

  test('the campaign landing pages carry it too, minimal chrome or not', () => {
    // These are the pages a reviewer is most likely to open from a
    // campaign link, and they use the minimal funnel footer.
    for (const route of ['/go/law-firms/', '/go/roofing/', '/plumbing-ai/', '/personal-injury-ai/', '/divorce-law-ai/']) {
      assert.ok(page(route).includes(LEGAL_RELATIONSHIP), `${route}: campaign page does not disclose the operator`);
    }
  });

  test('every page a reviewer can read discloses the operator', () => {
    // Redirect stubs are the one exemption, and they earn it: both are
    // noindex pages whose entire body is a meta refresh, so nobody
    // reads a footer on them. They are asserted to be redirects rather
    // than simply skipped by name.
    const REDIRECT_STUBS = ['/ai-department-audit/index.html', '/assessment/index.html'];
    for (const stub of REDIRECT_STUBS) {
      const html = readFileSync(join(DIST, stub), 'utf8');
      assert.match(html, /http-equiv="refresh"|location\.replace/, `${stub} is not a redirect stub`);
      assert.match(html, /<meta name="robots" content="noindex/, `${stub} is not noindex`);
    }
    const missing = allHtml()
      .filter((f) => !readFileSync(f, 'utf8').includes(LEGAL_RELATIONSHIP))
      .map((f) => f.slice(DIST.length))
      .filter((r) => !REDIRECT_STUBS.includes(r));
    assert.deepEqual(missing, [], 'these built pages never name the legal operator');
  });

  test('Organization schema carries legalName without renaming the brand', () => {
    // Parse whole ld+json blocks rather than regex-slicing to the first
    // "}". Organization now nests an ImageObject logo, and a non-greedy
    // slice stops inside it and yields invalid JSON.
    const org = jsonLdNodes(page('/')).find((n) => n['@type'] === 'Organization');
    assert.ok(org, 'Organization JSON-LD not found');
    assert.equal(org.name, BRAND_NAME, 'the searchable brand must not be replaced by the legal entity');
    assert.equal(org.legalName, LEGAL_ENTITY);
  });

  test('the future entity is NOT published as the active operator', () => {
    // The single most important assertion in this file. Publishing
    // "Your AI Department LLC" before the Twilio Brand changes is the
    // same 30907 mismatch, pointing the other way.
    const leaks = allHtml()
      .filter((f) => readFileSync(f, 'utf8').includes(FUTURE_ENTITY))
      .map((f) => f.slice(DIST.length));
    assert.deepEqual(leaks, [], `${FUTURE_ENTITY} must not appear in rendered output until cutover`);
  });

  test('the cutover is documented and clearly marked not-yet-executed', () => {
    const doc = read('docs/legal-entity-cutover.md');
    assert.match(doc, /DO NOT EXECUTE UNTIL TWILIO\/LEGAL REGISTRATION IS READY/);
    assert.match(doc, /NOT STARTED/);
    assert.ok(doc.includes(FUTURE_ENTITY), 'the future entity belongs in documentation, not in rendered copy');
    assert.ok(doc.includes('businessIdentity.ts'), 'the procedure must name the file that changes');
  });
});

// ============================================================
// 30908 — mobile / SMS privacy language
// ============================================================

describe('30908: the Privacy Policy carries the mobile non-sharing language', () => {
  const html = page('/privacy/');
  const text = visibleText(html);

  test('there is a stable #sms-privacy anchor to point Twilio at', () => {
    assert.match(html, /id="sms-privacy"/);
  });

  test('the non-sharing statement is explicit and unambiguous', () => {
    // The exact requirement Twilio named. Asserted semantically: the
    // sentence must cover mobile data, must be a refusal, and must
    // name marketing/promotional purposes and third parties/affiliates.
    assert.match(text, /do not share, sell, rent, or provide your mobile phone number, SMS opt-in data, or messaging consent to third parties or affiliates for marketing or promotional purposes/i);
  });

  test('operational processors are distinguished from marketing sharing', () => {
    // Naming Twilio as a processor must not read as a contradiction of
    // the sentence above.
    assert.match(text, /Twilio/);
    assert.match(text, /(solely as necessary|only as needed|only as necessary)/i);
    assert.match(text, /does not authorize them to use your mobile information or messaging consent for their own marketing/i);
  });

  test('it says a phone number alone is not enrollment, and consent is not required to buy', () => {
    assert.match(text, /Providing a phone number on a general website form does not by itself enroll you in SMS/i);
    assert.match(text, /not a condition of purchasing or receiving our services/i);
  });

  test('frequency, rates, STOP and HELP are all stated', () => {
    assert.match(text, /Message frequency varies/i);
    assert.match(text, /Message and data rates may apply/i);
    assert.match(text, /\bSTOP\b/);
    assert.match(text, /\bHELP\b/);
  });

  test('it links onward to Terms and the consent page', () => {
    assert.ok(html.includes(`href="${LEGAL_ROUTES.smsTermsAnchor}"`));
    assert.ok(html.includes(`href="${LEGAL_ROUTES.smsConsent}"`));
  });

  test('it states that PII does not reach analytics', () => {
    assert.match(text, /do not send your name, email address, phone number, SMS consent, or assessment answers to GA4/i);
  });
});

// ============================================================
// 30882 — SMS terms
// ============================================================

describe('30882: the Terms contain real SMS program terms', () => {
  const html = page('/terms/');
  const text = visibleText(html);

  test('there is a stable #sms-terms anchor', () => {
    assert.match(html, /id="sms-terms"/);
  });

  test('the program, sender and purpose are named', () => {
    assert.match(text, new RegExp(`${BRAND_NAME} customer-care SMS program is operated by ${LEGAL_ENTITY}`, 'i'));
    assert.match(text, /customer-care communications/i);
  });

  test('every carrier-required element is present', () => {
    for (const [label, pattern] of [
      ['consent is optional', /SMS consent is optional/i],
      ['not a condition of purchase', /not a condition of purchas/i],
      ['frequency varies', /Message frequency varies/i],
      ['rates may apply', /Message and data rates may apply/i],
      ['STOP', /\bSTOP\b/],
      ['HELP', /\bHELP\b/],
      ['carrier liability', /Wireless carriers are not responsible for delayed or undelivered messages/i],
      ['unchecked by default', /presented unchecked and requires an affirmative selection/i],
    ] as const) {
      assert.match(text, pattern, `SMS terms missing: ${label}`);
    }
  });

  test('the terms do not turn customer care into promotional consent', () => {
    for (const pattern of [/promotional (text|SMS|message)/i, /marketing text messages/i, /special offers/i]) {
      assert.equal(pattern.test(text), false, `terms describe promotional SMS: ${pattern}`);
    }
  });
});

// ============================================================
// 30896 — the opt-in flow itself
// ============================================================

describe('30896: the opt-in page demonstrates consent', () => {
  const html = page('/sms-consent/');
  const text = visibleText(html);

  test('it is public and indexable, matching the other legal pages', () => {
    // A reviewer must be able to open it with no session. noindex would
    // also be defensible, but privacy and terms are indexed and there is
    // nothing here worth hiding.
    assert.equal(/<meta name="robots"/.test(html), false, 'the consent page must not be noindexed');
    assert.ok(html.includes('rel="canonical"'));
    assert.ok(read('public/sitemap.xml').includes('https://youraidepartment.ai/sms-consent/'));
  });

  test('the consent checkbox exists, is separate, and is NOT pre-checked', () => {
    const box = html.match(/<input type="checkbox" id="sms-opt-in"[^>]*>/)?.[0];
    assert.ok(box, 'consent checkbox not found');
    assert.equal(/\schecked/.test(box!), false, 'the consent box must be unchecked by default');
    // Not required: consent cannot be a condition of using the page.
    assert.equal(/\srequired/.test(box!), false, 'consent must not be a required field');
    assert.ok(html.includes('for="sms-opt-in"'), 'the checkbox needs an associated label');
  });

  test('the disclosure sits with the checkbox and carries every required element', () => {
    for (const [label, needle] of [
      ['brand', BRAND_NAME],
      ['legal entity', LEGAL_ENTITY],
      ['customer-care', 'customer-care text messages'],
      ['frequency', 'Message frequency varies'],
      ['rates', 'Msg & data rates may apply'],
      ['STOP', 'Reply STOP to opt out'],
      ['HELP', 'HELP for help'],
      ['not a condition', 'Consent is not a condition of purchase'],
      ['privacy', 'Privacy Policy'],
      ['terms', 'Terms of Use'],
    ] as const) {
      assert.ok(text.includes(needle), `disclosure missing: ${label} ("${needle}")`);
    }
  });

  test('Privacy and Terms are clickable from the disclosure, at the SMS anchors', () => {
    assert.ok(html.includes(`href="${LEGAL_ROUTES.smsPrivacyAnchor}"`));
    assert.ok(html.includes(`href="${LEGAL_ROUTES.smsTermsAnchor}"`));
  });

  test('the rendered disclosure matches the one submitted to Twilio', () => {
    // The reviewer compares the submitted text against the live page.
    // Both come from SMS_CONSENT_DISCLOSURE_PLAIN, and the document is
    // checked against it here so the two cannot drift.
    const doc = read('docs/twilio-a2p-resubmission.md');
    assert.ok(doc.includes(SMS_CONSENT_DISCLOSURE_PLAIN), 'the submission document no longer matches the code');
    const withoutLinks = text.replace(/\s+/g, ' ');
    const disclosureStart = SMS_CONSENT_DISCLOSURE_PLAIN.slice(0, 120);
    assert.ok(withoutLinks.includes(disclosureStart), 'the rendered page no longer matches the code');
  });

  test('the form asks for the minimum: a name, a mobile number, and consent', () => {
    assert.match(html, /<input type="tel"[^>]*name="phone"/);
    assert.match(html, /autocomplete="tel"/);
    assert.match(html, /name="name"/);
  });

  test('the page states that other forms are not opt-in sources', () => {
    assert.match(text, /does not by itself enroll a visitor in this SMS program|not treated as SMS consent/i);
  });

  test('it describes verbal consent honestly, and rules out opt-in-by-text', () => {
    assert.match(text, /record consent verbally/i);
    assert.match(text, /We do not send a text message to ask someone to opt in/i);
  });
});

// ============================================================
// 30923 — consent is never a condition of anything
// ============================================================

describe('30923: the required agreement and the optional one are separate controls', () => {
  const html = page('/sms-consent/');
  const text = visibleText(html);

  test('the mandatory agreement is its own control, with its own name', () => {
    const terms = html.match(/<input type="checkbox" id="sms-terms-accept"[^>]*>/)?.[0];
    assert.ok(terms, 'there is no separate Terms acceptance control on the opt-in page');
    assert.match(terms!, /name="terms_accepted"/, 'the required agreement shares a name with something else');
    assert.match(terms!, /\srequired/, 'the Terms box is the one that should be required');
    assert.equal(/\schecked/.test(terms!), false, 'even the required box must not be pre-ticked for the visitor');
  });

  test('the page tells the visitor, before they submit, that declining is fine', () => {
    assert.match(text, /submits whether you check it or not/i);
    assert.match(text, /Declining text messages costs you nothing/i);
    assert.match(text, /never bundled into the Terms/i);
    assert.match(text, /may decline SMS messaging and still complete every form/i);
  });

  test('the two permissions are visually distinguishable, not two identical boxes', () => {
    assert.match(html, /perm-badge-required/);
    assert.match(html, /perm-badge-optional/);
  });

  test('the Terms page states that accepting it is not an SMS opt-in', () => {
    const terms = visibleText(page('/terms/'));
    assert.match(terms, /Accepting these Terms is not an SMS opt-in/i);
    assert.match(terms, /No form on this Site requires the SMS checkbox in order to submit/i);
  });

  test('the Privacy Policy says the same thing, in its own words', () => {
    const privacy = visibleText(page('/privacy/'));
    assert.match(privacy, /Accepting our Terms of Use or this Privacy Policy does not opt you in/i);
    assert.match(privacy, /three distinct facts/i, 'the storage separation is not described');
  });

  test('no page on the site ships a required or pre-checked SMS control', () => {
    // The rejection is site-wide, not page-specific: one forgotten
    // `required` on any messaging checkbox anywhere re-earns it.
    const jsBundles = walk(join(DIST, '_astro'), (f) => f.endsWith('.js'));
    for (const file of [...allHtml(), ...jsBundles]) {
      const body = readFileSync(file, 'utf8');
      for (const tag of body.match(/<input[^>]*type=.?"?checkbox[^>]*>/g) ?? []) {
        const name = tag.match(/name=\\?"([^"\\]*)/)?.[1] ?? '';
        if (!/sms|text|message/i.test(name)) continue;
        assert.equal(/\srequired/.test(tag), false, `${file}: "${name}" is a required messaging control`);
        assert.equal(/\schecked/.test(tag), false, `${file}: "${name}" ships pre-checked`);
      }
    }
  });

  test('a visitor can use the actual services without giving a phone number at all', () => {
    // "Consumers must be ... able to decline messaging and still utilize
    // your business services." The services are the contact form and
    // the two assessments; none of them may require a number.
    const contactPhone = page('/contact/').match(/<input type="tel"[^>]*>/)?.[0] ?? '';
    assert.ok(contactPhone, 'the contact phone field vanished');
    assert.equal(/\srequired/.test(contactPhone), false, 'contact: a phone number is required to submit');

    for (const app of ['src/components/assessment/quickAssessmentApp.ts', 'src/components/assessment/assessmentApp.ts']) {
      const tag = read(app).match(/<input type="tel"[^>]*>/)?.[0] ?? '';
      assert.ok(tag, `${app}: the phone field vanished`);
      assert.equal(/\srequired/.test(tag), false, `${app}: a phone number is required to submit`);
    }
  });

  test('the audit in the submission document still describes the site', () => {
    const doc = read('docs/twilio-a2p-resubmission.md');
    assert.match(doc, /Every form on the website, classified/);
    // The claim the document makes, re-derived rather than trusted.
    const smsBoxes = allHtml().flatMap((f) => {
      const body = readFileSync(f, 'utf8');
      return (body.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [])
        .filter((t) => /name="sms_opt_in"/.test(t))
        .map(() => f);
    });
    assert.equal(smsBoxes.length, 1, 'the site has more than one SMS checkbox, or none');
    assert.match(smsBoxes[0], /sms-consent/, 'the SMS checkbox moved off the consent page');
  });

  test('the consent record separates the number, the agreement, and the answer', () => {
    const src = read('src/pages/sms-consent/index.astro');
    assert.match(src, /phone_provided:\s*'yes'/, 'a provided number is not recorded as its own fact');
    assert.match(src, /terms_accepted:\s*'yes'/, 'Terms acceptance is not recorded as its own fact');
    assert.match(src, /sms_opt_in:\s*smsOptIn \? 'yes' : 'no'/, 'the SMS answer is not recorded as yes or no');
    // The three must never be written from one value.
    assert.equal(
      /terms_accepted:\s*smsOptIn|phone_provided:\s*smsOptIn|sms_opt_in:\s*termsAccepted/.test(src),
      false,
      'two of the three facts are being written from one variable',
    );
  });
});

describe('30896: other phone fields do not silently imply SMS consent', () => {
  test('the contact form says a phone number is not an opt-in, and links the real one', () => {
    const html = page('/contact/');
    assert.match(visibleText(html), /A phone number alone does not opt you in to text messages/i);
    assert.ok(html.includes(`href="${LEGAL_ROUTES.smsConsent}"`));
    // Associated with the field, not just floating near it.
    assert.match(html, /aria-describedby="cf-phone-sms"/);
  });

  test('both assessment apps carry the same notice at their phone field', () => {
    for (const app of ['src/components/assessment/quickAssessmentApp.ts', 'src/components/assessment/assessmentApp.ts']) {
      const src = read(app);
      assert.match(src, /A phone number alone does not opt you in to text messages/i, `${app}: notice missing`);
      assert.ok(src.includes('href="/sms-consent/"'), `${app}: no link to the consent page`);
      assert.match(src, /aria-describedby="a-phone-sms"/, `${app}: notice not associated with the field`);
    }
  });

  test('SMS consent was NOT bundled into the existing required consent checkbox', () => {
    // General form processing, marketing email, and SMS are three
    // different permissions. Merging any two makes all of them
    // unenforceable.
    for (const app of ['src/components/assessment/quickAssessmentApp.ts', 'src/components/assessment/assessmentApp.ts']) {
      const src = read(app);
      const generalConsent = src.match(/<input type="checkbox" name="consent"[\s\S]{0,600}?<\/label>/)?.[0] ?? '';
      assert.equal(/text message|SMS/i.test(generalConsent), false, `${app}: SMS folded into the general consent box`);
      const marketing = src.match(/<input type="checkbox" name="marketingOptIn"[\s\S]{0,400}?<\/label>/)?.[0] ?? '';
      assert.equal(/text message|SMS/i.test(marketing), false, `${app}: SMS folded into the marketing box`);
    }
    const contact = read('src/pages/contact/index.astro');
    const contactConsent = contact.match(/<input type="checkbox" name="consent"[\s\S]{0,600}?<\/label>/)?.[0] ?? '';
    assert.equal(/text message|SMS/i.test(contactConsent), false, 'contact: SMS folded into the general consent box');
  });
});

// ============================================================
// Consent records, and keeping PII out of analytics
// ============================================================

describe('The consent record is evidence, and never reaches analytics', () => {
  const src = read('src/pages/sms-consent/index.astro');

  test('every evidentiary field is captured', () => {
    for (const field of [
      'sms_opt_in', 'sms_program', 'sms_use_case', 'brand', 'legal_entity',
      'consent_source', 'consent_source_url', 'consent_version', 'consent_recorded_at',
      // 30923: a decline is a record too, and has to be tellable from a
      // consent by something other than the absence of a field.
      'terms_accepted', 'phone_provided', 'record_type',
    ]) {
      assert.ok(src.includes(field), `consent payload missing ${field}`);
    }
    assert.match(src, /new Date\(\)\.toISOString\(\)/, 'the timestamp must be ISO 8601');
  });

  test('the analytics event fires only after delivery, and carries no PII', () => {
    const push = src.match(/dataLayer\.push\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    assert.ok(push.includes("event: 'sms_consent_submit'"), 'diagnostic event missing');
    for (const forbidden of ['name', 'phone', 'email', 'consent_source_url']) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(push),
        false,
        `the analytics payload carries ${forbidden}`,
      );
    }
    // It must sit after the delivery check, not before it.
    assert.ok(
      src.indexOf("if (!response.ok || !body?.success) throw new Error('delivery failed')") <
        src.indexOf("event: 'sms_consent_submit'"),
      'the analytics event fires before delivery is confirmed',
    );
  });

  test('SMS opt-in is not promoted into a business conversion', () => {
    // Sprint 13 has exactly two: booking_confirmed and, when the CRM can
    // produce it, qualified_lead. An opt-in is neither.
    //
    // Against emitted event names, not prose — the page's own comment
    // explains the hierarchy by naming those events, and a comment
    // saying "this is not a booking" must not read as a violation.
    const emitted = [...src.matchAll(/event:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(emitted, ['sms_consent_submit'], 'the consent page emits an unexpected event');
    for (const forbidden of ['qualified_lead', 'call_booked', 'booking_confirmed']) {
      assert.equal(emitted.includes(forbidden), false, `the consent page emits ${forbidden}`);
    }
  });

  test('a failed delivery reports failure instead of faking success', () => {
    assert.match(src, /so no consent has been saved/i, 'the failure message must say nothing was recorded');
    // The honeypot path must not render the success panel either.
    const honeypot = src.match(/if \(data\.get\('botcheck'\)\)[^\n]*/)?.[0] ?? '';
    assert.ok(honeypot.includes('return'), 'honeypot path not found');
    assert.equal(/successBox/.test(honeypot), false, 'the honeypot path shows a fake success state');
  });

  test('duplicate submits are blocked', () => {
    assert.match(src, /if \(submitting\) return/);
  });
});

// ============================================================
// Nothing Sprint 13 established was regressed
// ============================================================

describe('Sprint 13 behaviour is intact', () => {
  test('the campaign pages are still noindex and still out of the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    for (const route of ['/go/law-firms/', '/go/roofing/']) {
      assert.match(page(route), /<meta name="robots" content="noindex, follow">/);
      assert.equal(sitemap.includes(route), false, `${route} leaked into the sitemap`);
    }
  });

  test('the SMS Consent link reaches both footers from the shared legal list', () => {
    const site = read('src/lib/site.ts');
    assert.match(site, /label: 'SMS Consent', href: LEGAL_ROUTES\.smsConsent/);
    assert.equal(
      read('src/components/Footer.astro').includes('<li><a href="/sms-consent/">'),
      false,
      'the link is hand-appended again instead of coming from FOOTER_LINKS.legal',
    );
    for (const route of ['/', '/go/roofing/']) {
      assert.ok(page(route).includes(`href="${LEGAL_ROUTES.smsConsent}"`), `${route}: no SMS Consent link`);
    }
  });

  test('the sample messages identify the same sender as the site', () => {
    const doc = read('docs/twilio-a2p-resubmission.md');
    const samples = [...doc.matchAll(/^\d\. (Your AI Department[^\n]*)$/gm)].map((m) => m[1]);
    assert.equal(samples.length, 4, 'expected four sample messages');
    for (const s of samples) {
      assert.ok(s.startsWith(`${SMS_SENDER_DISPLAY_NAME}:`), `sample does not identify the sender: ${s.slice(0, 60)}`);
      assert.match(s, /STOP/, 'every sample needs an opt-out reference');
      assert.match(s, /HELP/, 'every sample needs a help reference');
      assert.equal(/\b(\d{1,3}% off|discount|sale|free trial|limited time)\b/i.test(s), false, `promotional sample: ${s}`);
    }
  });

  test('the submission document makes no approval or compliance guarantee', () => {
    const doc = read('docs/twilio-a2p-resubmission.md');
    for (const pattern of [
      /twilio[- ]compliant/i,
      /carrier[- ]approved/i,
      /guaranteed approval/i,
      /fully TCPA compliant/i,
      /we are compliant/i,
    ]) {
      assert.equal(pattern.test(doc), false, `unsupported claim: ${pattern}`);
    }
    assert.match(doc, /Not deployed\. Not submitted\. Not approved\./);
    assert.match(doc, /No screenshots have been captured/);
  });

  test('the rejection matrix covers every code with evidence', () => {
    const doc = read('docs/twilio-a2p-resubmission.md');
    for (const code of ['30907', '30908', '30896', '30882', '30923']) {
      assert.ok(doc.includes(code), `rejection matrix missing ${code}`);
    }
    assert.match(doc, /MANUAL ACTIONS AFTER WEBSITE DEPLOYMENT/);
  });
});
