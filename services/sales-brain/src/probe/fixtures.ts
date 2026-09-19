import { classifyField, classifyCheckbox, type FormDescriptor, type FormField, type FormCheckbox } from './forms.js';

/**
 * The forms the dry-run is tested against.
 * Authority: outbound-sales-brain-speed-to-lead-probe-spec.md §21.
 *
 * These are real markup rather than hand-built descriptors, and parsed by the same
 * function a live path would use. The difference matters: a descriptor written by
 * hand tests the analyzer against my own assumptions about what a form looks like,
 * which is the one thing it should not be tested against.
 *
 * Nothing here is served over HTTP. There is no local server and no fetch, so there
 * is no code path from the dry-run to a network at all -- which is a stronger
 * guarantee than a server on loopback plus a promise not to point it outward.
 */

/** A deterministic parser for our own fixture markup. Not a general HTML parser. */
export function parseFormHtml(html: string, url: string): FormDescriptor {
  const formMatch = /<form\b[\s\S]*?<\/form>/i.exec(html);
  if (!formMatch) {
    return {
      url, fields: [], checkboxes: [], hasCaptcha: false,
      antiAutomationNotice: null, requiresTermsAcceptance: false,
      dispatchOnly: false, formFound: false, emailFieldRejectsPlus: false,
    };
  }
  const form = formMatch[0];
  const fields: FormField[] = [];
  const checkboxes: FormCheckbox[] = [];

  const inputRe = /<(input|textarea|select)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputRe.exec(form)) !== null) {
    const attrs = match[2] ?? '';
    const type = (/\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const required = /\brequired\b/i.test(attrs);
    const label = labelFor(form, name) ?? name;

    if (type === 'checkbox') {
      checkboxes.push({ name, label, klass: classifyCheckbox(label), required });
      continue;
    }
    fields.push({ name, label, kind: classifyField(label, type), required });
  }

  const hasCaptcha = /g-recaptcha|h-captcha|data-sitekey|cf-turnstile|captcha/i.test(html);
  const notice = /<[^>]*\bdata-anti-automation\b[^>]*>([\s\S]*?)</i.exec(html)?.[1]
    ?? (/automated (?:submissions?|access|queries) (?:are|is) (?:prohibited|not permitted)/i
      .exec(html)?.[0] ?? null);
  const requiresTermsAcceptance = /\bdata-requires-terms\b/i.test(html);
  const dispatchOnly = /\bdata-dispatch-only\b/i.test(html);
  const emailFieldRejectsPlus = /\bdata-rejects-plus\b/i.test(html);

  return {
    url, fields, checkboxes, hasCaptcha,
    antiAutomationNotice: notice ? notice.trim() : null,
    requiresTermsAcceptance, dispatchOnly, formFound: true, emailFieldRejectsPlus,
  };
}

function labelFor(form: string, name: string): string | null {
  if (!name) return null;
  const byFor = new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${escapeRe(name)}["'][^>]*>([\\s\\S]*?)</label>`, 'i')
    .exec(form)?.[1];
  if (byFor && stripTags(byFor)) return stripTags(byFor);

  // A wrapping label, where the text may come either side of the input:
  //   <label><input name="x"> Subscribe to updates</label>
  //
  // Each label block is examined whole. An earlier attempt matched from the first
  // `<label>` in the document up to the named input, which for a checkbox at the
  // bottom of a form swept up every preceding field's text -- so a newsletter box
  // was classified from the words "Your name Phone Email", came out UNKNOWN, and
  // an optional preference was treated as a mandatory consent gate.
  const labelBlocks = form.match(/<label\b[\s\S]*?<\/label>/gi) ?? [];
  const holder = labelBlocks.find(
    (block) => new RegExp(`\\bname\\s*=\\s*["']${escapeRe(name)}["']`, 'i').test(block));
  if (holder) {
    const text = stripTags(holder);
    if (text) return text;
  }

  const placeholder = new RegExp(`\\bname\\s*=\\s*["']${escapeRe(name)}["'][^>]*\\bplaceholder\\s*=\\s*["']([^"']+)["']`, 'i')
    .exec(form)?.[1];
  return placeholder ? placeholder.trim() : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface FixtureForm {
  key: string;
  description: string;
  html: string;
  /** What the analyzer is expected to conclude. Asserted by the suite. */
  expectEligible: boolean;
}

const ORDINARY = `
<h1>Marsh Point Air &amp; Heating</h1>
<form action="/lead" method="post">
  <label for="name">Your name</label><input name="name" required>
  <label for="phone">Phone number</label><input name="phone" type="tel" required>
  <label for="email">Email address</label><input name="email" type="email" required>
  <label for="zip">Zip code</label><input name="zip">
  <label for="message">How can we help?</label><textarea name="message" required></textarea>
  <input type="submit" value="Request info">
</form>`;

export const FIXTURE_FORMS: readonly FixtureForm[] = [
  {
    key: 'ordinary',
    description: 'Name, phone, email, message. A neutral request for information fits.',
    html: ORDINARY,
    expectEligible: true,
  },
  {
    key: 'optional_checkbox',
    description: 'An optional newsletter checkbox. Left unchecked, and not a gate.',
    expectEligible: true,
    html: ORDINARY.replace('<input type="submit"',
      '<label><input name="newsletter" type="checkbox"> Subscribe to updates and seasonal tips</label>\n  <input type="submit"'),
  },
  {
    key: 'mandatory_consent_gate',
    description: 'A required consent-to-be-contacted checkbox. V1 does not tick it.',
    expectEligible: false,
    html: ORDINARY.replace('<input type="submit"',
      '<label><input name="consent" type="checkbox" required> I agree to receive calls and text messages, including automated messages, at the number provided</label>\n  <input type="submit"'),
  },
  {
    key: 'mandatory_terms_gate',
    description: 'Submission requires accepting terms and attesting the information is truthful.',
    expectEligible: false,
    html: ORDINARY.replace('<form action="/lead" method="post">',
      '<form action="/lead" method="post" data-requires-terms>')
      .replace('<input type="submit"',
        '<label><input name="terms" type="checkbox" required> I certify the information above is accurate and accept the Terms of Use</label>\n  <input type="submit"'),
  },
  {
    key: 'dispatch_only',
    description: 'The only mode is booking a technician to an address. Not probeable.',
    expectEligible: false,
    html: `
<h1>Emergency AC Repair — Book a Technician</h1>
<form action="/dispatch" method="post" data-dispatch-only>
  <label for="name">Your name</label><input name="name" required>
  <label for="phone">Phone</label><input name="phone" type="tel" required>
  <label for="street">Service address</label><input name="street" required>
  <label for="when">Preferred arrival window</label><input name="when" required>
  <input type="submit" value="Dispatch a tech">
</form>`,
  },
  {
    key: 'captcha',
    description: 'A CAPTCHA is presented. Not solved, not outsourced, not bypassed.',
    expectEligible: false,
    html: ORDINARY.replace('<input type="submit"',
      '<div class="g-recaptcha" data-sitekey="fixture-key-not-a-secret"></div>\n  <input type="submit"'),
  },
  {
    key: 'anti_automation_notice',
    description: 'The page states that automated submissions are prohibited.',
    expectEligible: false,
    html: ORDINARY.replace('<h1>',
      '<p data-anti-automation>Automated submissions are prohibited.</p>\n<h1>'),
  },
  {
    key: 'plus_address_rejected',
    description: 'The email validator rejects "+". Eligible, but the alias must be a '
      + 'catch-all subdomain rather than sub-addressing.',
    expectEligible: true,
    html: ORDINARY.replace('name="email" type="email" required',
      'name="email" type="email" required data-rejects-plus'),
  },
  {
    key: 'requires_fabricated_fact',
    description: 'A required VIN and insurance claim number. Both would have to be invented.',
    expectEligible: false,
    html: `
<h1>Collision Estimate Request</h1>
<form action="/estimate" method="post">
  <label for="name">Your name</label><input name="name" required>
  <label for="phone">Phone</label><input name="phone" type="tel" required>
  <label for="vin">Vehicle VIN</label><input name="vin" required>
  <label for="claim">Insurance claim number</label><input name="claim" required>
  <input type="submit" value="Request estimate">
</form>`,
  },
  {
    key: 'no_form',
    description: 'A call-only landing page. Nothing to submit.',
    expectEligible: false,
    html: '<h1>Call us now</h1><a href="tel:+19045550177">904-555-0177</a>',
  },
];

export function fixtureForm(key: string): FixtureForm {
  const found = FIXTURE_FORMS.find((form) => form.key === key);
  if (!found) throw new Error(`No fixture form "${key}"`);
  return found;
}
