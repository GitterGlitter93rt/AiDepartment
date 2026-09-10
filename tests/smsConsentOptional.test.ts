// Twilio A2P 10DLC error 30923 — Forced Consent Violation.
//
// The rejection: "Your current signup workflow bundles SMS messaging
// consent directly into your mandatory Terms of Service or treats
// consent as a required condition to complete a transaction or create
// an account."
//
// The cause was not the markup. /sms-consent/ shipped a checkbox with
// no `checked` and no `required`, so every structural test passed and
// the page looked compliant to anyone reading the HTML. The submit
// handler was the violation:
//
//     if (!smsOptIn) { showError('...check the consent box...'); return; }
//
// Structural assertions cannot catch that, which is why this suite is
// behavioural. It extracts the inline handler from the BUILT page in
// dist/ and executes it against a small DOM shim, so what is under test
// is the exact JavaScript a Twilio reviewer's browser will run — not a
// paraphrase of it, and not the source it was compiled from.
//
// The shim is deliberately tiny and hand-rolled rather than a DOM
// library: it implements only the handful of APIs this one handler
// touches, and anything it does not implement throws loudly instead of
// silently returning undefined and turning a real failure green.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const HTML = readFileSync(join(DIST, 'sms-consent', 'index.html'), 'utf8');

// ============================================================
// Pull the shipped handler and the form's real fields out of dist/
// ============================================================

/** The inline script Astro emitted for this page. Found by content, not
 * by index, so adding another script to the page cannot silently point
 * this suite at the wrong one. */
function shippedHandler(): string {
  const scripts = [...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const match = scripts.filter((s) => s.includes("getElementById('sms-consent-form')"));
  assert.equal(match.length, 1, 'expected exactly one inline handler for the consent form');
  return match[0];
}

/**
 * The handler with comments removed.
 *
 * The 30923 fix documents itself by quoting the guard clause it
 * deleted, so any scan for `if (!smsOptIn)` matches the warning as
 * readily as the defect. Scoping to code is the fix; loosening the
 * assertion would be how the defect comes back unnoticed.
 *
 * Quote and template-literal state is tracked, because the script
 * contains `"https://youraidepartment.ai/sms-consent/"` and a naive
 * line-comment strip would swallow the rest of that line.
 */
function codeOnly(js: string): string {
  let out = '';
  for (let i = 0; i < js.length; ) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i += 1; continue; }
    if (c === '/' && js[i + 1] === '*') {
      i += 2;
      while (i < js.length && !(js[i] === '*' && js[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i += 1;
      while (i < js.length) {
        if (js[i] === '\\') { out += js.slice(i, i + 2); i += 2; continue; }
        out += js[i];
        i += 1;
        if (js[i - 1] === c) break;
      }
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<[a-zA-Z0-9-]+\s*/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) {
    out[m[1]] = m[2] ?? '';
  }
  return out;
}

/** Every control inside the real <form>, as it was built. */
function formControls(): Record<string, string>[] {
  const form = HTML.match(/<form id="sms-consent-form"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'the consent form is missing from the built page');
  return [
    ...[...form!.matchAll(/<input\b[^>]*>/g)].map((m) => attrsOf(m[0])),
    ...[...form!.matchAll(/<button\b[^>]*>/g)].map((m) => ({ ...attrsOf(m[0]), tag: 'button' })),
  ];
}

const control = (name: string) => formControls().find((c) => c.name === name);
const controlById = (id: string) => formControls().find((c) => c.id === id);

// ============================================================
// The DOM shim
// ============================================================

class El {
  attrs: Record<string, string> = {};
  checked = false;
  value = '';
  disabled = false;
  textContent = '';
  focusCount = 0;
  readonly tag: string;
  readonly id: string;
  constructor(id: string, attrs: Record<string, string> = {}, tag = 'input') {
    this.id = id;
    this.attrs = { ...attrs };
    this.tag = tag;
    this.checked = 'checked' in attrs;
    if ('hidden' in attrs) this.attrs.hidden = '';
  }
  get name() { return this.attrs.name ?? ''; }
  get type() { return this.attrs.type ?? ''; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  hasAttribute(k: string) { return k in this.attrs; }
  focus() { this.focusCount += 1; }
}

class FormEl extends El {
  listeners: Record<string, ((e: any) => any)[]> = {};
  controls: El[] = [];
  constructor(id: string) { super(id, {}, 'form'); }
  addEventListener(type: string, fn: (e: any) => any) { (this.listeners[type] ??= []).push(fn); }
  querySelector(sel: string) {
    if (sel === 'button[type="submit"]') return this.controls.find((c) => c.tag === 'button') ?? null;
    throw new Error(`shim: unsupported querySelector(${sel})`);
  }
  querySelectorAll(sel: string) {
    if (sel === '[aria-invalid]') return this.controls.filter((c) => c.hasAttribute('aria-invalid'));
    throw new Error(`shim: unsupported querySelectorAll(${sel})`);
  }
}

class Fd {
  private form: FormEl;
  constructor(form: FormEl) { this.form = form; }
  get(key: string): string | null {
    const el = this.form.controls.find((c) => c.name === key);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked ? 'on' : null;
    return el.value;
  }
}

interface Harness {
  form: FormEl;
  el: Record<string, El>;
  window: any;
  fetchCalls: { url: string; body: any }[];
  submit(): Promise<void>;
  sentBody(): any;
  errorShown(): string | null;
}

/**
 * A fresh page, wired from the built markup, with the built handler
 * attached. `fetchResult` lets a test make delivery fail.
 */
function mount(fetchResult: { ok: boolean; body: any } = { ok: true, body: { success: true } }): Harness {
  const form = new FormEl('sms-consent-form');
  const byId: Record<string, El> = { 'sms-consent-form': form };

  for (const c of formControls()) {
    const el = new El(c.id ?? '', c, c.tag ?? 'input');
    form.controls.push(el);
    if (c.id) byId[c.id] = el;
  }
  // The status panels live outside the <form>, so they are read from the
  // page rather than the form, by the same ids the handler asks for.
  for (const id of ['sms-form-error', 'sms-form-success', 'sms-form-declined']) {
    const tag = HTML.match(new RegExp(`<div id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `the built page has no #${id}`);
    byId[id] = new El(id, attrsOf(tag!), 'div');
  }

  const fetchCalls: { url: string; body: any }[] = [];
  const fetchStub = async (url: string, init: any) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    return { ok: fetchResult.ok, json: async () => fetchResult.body };
  };

  const doc = {
    getElementById(id: string) { return byId[id] ?? null; },
  };
  const win: any = {};

  const fn = new Function('document', 'window', 'fetch', 'FormData', shippedHandler());
  fn(doc, win, fetchStub, function (f: FormEl) { return new Fd(f); });

  return {
    form,
    el: byId,
    window: win,
    fetchCalls,
    async submit() {
      const handlers = form.listeners.submit ?? [];
      assert.equal(handlers.length, 1, 'the built page did not register a submit handler');
      let prevented = false;
      await handlers[0]({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true, 'the handler must preventDefault so nothing navigates away');
    },
    sentBody() {
      assert.equal(fetchCalls.length, 1, `expected exactly one delivery, saw ${fetchCalls.length}`);
      return fetchCalls[0].body;
    },
    errorShown() {
      const box = byId['sms-form-error'];
      return box.hidden ? null : box.textContent;
    },
  };
}

/** Fill in everything a real visitor would, then choose the answers. */
function fill(h: Harness, opts: { name?: string; phone?: string; terms?: boolean; sms?: boolean; honeypot?: boolean }) {
  const set = (id: string, v: string) => { h.el[id].value = v; };
  set('sms-name', opts.name ?? 'Reviewer Test');
  set('sms-phone', opts.phone ?? '+19045550147');
  h.el['sms-terms-accept'].checked = opts.terms ?? true;
  h.el['sms-opt-in'].checked = opts.sms ?? false;
  const honey = h.form.controls.find((c) => c.name === 'botcheck')!;
  honey.checked = opts.honeypot ?? false;
}

// ============================================================
// A — the reviewer's exact journey: decline, and still get through
// ============================================================

describe('30923 A: a visitor who declines SMS can still complete the form', () => {
  test('phone entered, Terms accepted, SMS DECLINED — the submission succeeds', async () => {
    const h = mount();
    fill(h, { sms: false });
    await h.submit();

    assert.equal(h.errorShown(), null, 'declining SMS produced a blocking error');
    assert.equal(h.fetchCalls.length, 1, 'declining SMS prevented the form from submitting');
    assert.equal(h.form.hidden, true, 'the form was not replaced by a confirmation');
    assert.equal(h.el['sms-form-declined'].hidden, false, 'no confirmation was shown to someone who declined');
  });

  test('the decline confirmation says plainly that no messages will be sent', async () => {
    const h = mount();
    fill(h, { sms: false });
    await h.submit();

    // Read from the built page, not from the shim: this is the text the
    // reviewer will actually see.
    const panel = HTML.match(/<div id="sms-form-declined"[\s\S]*?<\/div>/)?.[0] ?? '';
    const text = panel.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /did\s+not\s+opt in/i, 'the decline panel must state that no opt-in occurred');
    assert.match(text, /will not send you any|will not text/i, 'it must promise no messages');
    assert.match(text, /still contact us|still use|Nothing else is affected/i, 'it must say service is unaffected');
  });

  test('the SMS consent confirmation is NOT shown to someone who declined', async () => {
    const h = mount();
    fill(h, { sms: false });
    await h.submit();
    assert.equal(h.el['sms-form-success'].hidden, true, 'a decline rendered the consent-recorded panel');
  });
});

// ============================================================
// B — opting in still works, and is recorded as consent
// ============================================================

describe('30923 B: opting in still records a consent', () => {
  test('SMS checked — the submission succeeds and shows the consent confirmation', async () => {
    const h = mount();
    fill(h, { sms: true });
    await h.submit();

    assert.equal(h.errorShown(), null);
    assert.equal(h.el['sms-form-success'].hidden, false, 'the consent confirmation was not shown');
    assert.equal(h.el['sms-form-declined'].hidden, true, 'the decline panel was shown to someone who opted in');
  });
});

// ============================================================
// C — the control itself
// ============================================================

describe('30923 C: the SMS control is optional in the markup that ships', () => {
  test('unchecked by default, and not marked required', () => {
    const box = controlById('sms-opt-in');
    assert.ok(box, 'the SMS checkbox is missing from the built form');
    assert.equal(box!.type, 'checkbox');
    assert.equal('checked' in box!, false, 'the SMS box ships pre-checked');
    assert.equal('required' in box!, false, 'the SMS box ships as a required field');
    assert.equal('disabled' in box!, false, 'the SMS box ships disabled');
  });

  test('it is labelled Optional where a reviewer will see it', () => {
    const block = HTML.match(/<div class="perm-checkbox sms-checkbox"[\s\S]*?<\/div>/)?.[0] ?? '';
    assert.match(block, /perm-badge-optional/, 'the optional badge is missing from the SMS block');
    assert.match(block.replace(/<[^>]+>/g, ' '), /Optional/, 'the word "Optional" is not rendered');
    const note = HTML.match(/<p id="sms-opt-in-note"[\s\S]*?<\/p>/)?.[0]?.replace(/<[^>]+>/g, ' ') ?? '';
    assert.match(note, /unchecked/i);
    assert.match(note, /still submits?/i, 'the note must say the form submits without it');
  });

  test('nothing on the page pre-selects it after load', () => {
    // A script that ticks the box for the visitor would defeat every
    // assertion above. No handler may write to it at all.
    const scripts = [...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.equal(
      /sms-opt-in['"]\s*\)\s*\.checked\s*=/.test(scripts) || /\.checked\s*=\s*true/.test(scripts),
      false,
      'a script assigns .checked — the box must only ever be ticked by the visitor',
    );
  });
});

// ============================================================
// D — no gate anywhere in the shipped handler
// ============================================================

describe('30923 D: nothing in the shipped handler gates on the SMS answer', () => {
  const js = codeOnly(shippedHandler());

  test('the codeOnly() scanner keeps the URLs and drops the prose', () => {
    // Guarding the guard: if this helper silently returned '' the two
    // tests below would pass while checking nothing at all.
    assert.ok(js.includes('https://youraidepartment.ai/sms-consent/'), 'a string literal was eaten');
    assert.ok(js.includes("getElementById('sms-consent-form')"), 'the code was eaten');
    assert.equal(js.includes('Forced Consent'), false, 'comments survived');
    assert.equal(js.includes('the defect'), false, 'comments survived');
  });

  test('the 30923 guard clause is gone', () => {
    assert.equal(
      /if\s*\(\s*!\s*smsOptIn\s*\)/.test(js),
      false,
      'the handler still refuses to submit when SMS is unchecked',
    );
  });

  test('no early return is conditioned on the SMS value', () => {
    // Every `return` that aborts the submission must be reachable
    // without reference to the SMS answer. Take each guard and check
    // what it tests.
    const guards = [...js.matchAll(/if\s*\(([^)]*)\)\s*\{?\s*(?:showError|return)/g)].map((m) => m[1]);
    for (const g of guards) {
      assert.equal(
        /smsOptIn|sms_opt_in/.test(g),
        false,
        `a submission guard tests the SMS answer: if (${g.trim()})`,
      );
    }
  });

  test('the SMS answer is read, but only to be recorded', () => {
    assert.match(js, /sms_opt_in:\s*smsOptIn\s*\?\s*'yes'\s*:\s*'no'/, 'the decline is not recorded as a decline');
  });
});

// ============================================================
// E — Terms is required, and is a different thing from consent
// ============================================================

describe('30923 E: the mandatory agreement is separate from the optional one', () => {
  test('they are two controls with two names', () => {
    const terms = control('terms_accepted');
    const sms = control('sms_opt_in');
    assert.ok(terms, 'there is no separate Terms acceptance control');
    assert.ok(sms, 'there is no SMS control');
    assert.notEqual(terms!.id, sms!.id);
    assert.ok('required' in terms!, 'the Terms box should be the required one');
    assert.equal('required' in sms!, false, 'the SMS box must never be required');
  });

  test('the Terms label does not ask for permission to text', () => {
    const block = HTML.match(/<div class="perm-checkbox required-checkbox"[\s\S]*?<\/label>/)?.[0] ?? '';
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /Terms of Use/);
    // The bundling Twilio objects to is an agreement to RECEIVE
    // messages hidden inside the mandatory box. Naming SMS in order to
    // exclude it is the opposite, and is checked separately below.
    assert.equal(
      /agree to receive|consent to receive|opt[- ]?in to receive/i.test(text),
      false,
      'the mandatory checkbox contains an agreement to receive messages',
    );
  });

  test('the page says in as many words that accepting Terms is not an opt-in', () => {
    const note = HTML.match(/<p id="sms-terms-note"[\s\S]*?<\/p>/)?.[0]?.replace(/<[^>]+>/g, ' ') ?? '';
    assert.match(note, /does\s+not\s+opt you in/i);
  });

  test('declining Terms blocks, and the error says SMS is still optional', async () => {
    const h = mount();
    fill(h, { terms: false, sms: true });
    await h.submit();

    assert.equal(h.fetchCalls.length, 0, 'the form submitted without the required agreement');
    const err = h.errorShown();
    assert.ok(err, 'no error was shown for the missing required agreement');
    assert.match(err!, /Terms of Use/, 'the error does not name what is actually missing');
    assert.match(err!, /optional and separate/i, 'the error must not imply the SMS box was the problem');
    assert.equal(h.el['sms-terms-accept'].focusCount, 1, 'focus was not moved to the offending control');
    assert.equal(h.el['sms-opt-in'].focusCount, 0, 'focus was moved to the OPTIONAL control');
  });

  test('accepting Terms alone, with SMS declined, is a complete and valid submission', async () => {
    const h = mount();
    fill(h, { terms: true, sms: false });
    await h.submit();
    assert.equal(h.sentBody().terms_accepted, 'yes');
    assert.equal(h.sentBody().sms_opt_in, 'no');
  });
});

// ============================================================
// F — three facts, stored as three facts
// ============================================================

describe('30923 F: a phone number is not consent, and Terms is not consent', () => {
  test('the decline record keeps all three apart', async () => {
    const h = mount();
    fill(h, { phone: '+19045550147', terms: true, sms: false });
    await h.submit();
    const body = h.sentBody();

    assert.equal(body.phone, '+19045550147', 'the number the visitor gave was not recorded');
    assert.equal(body.phone_provided, 'yes');
    assert.equal(body.terms_accepted, 'yes');
    assert.equal(body.sms_opt_in, 'no', 'a provided number or accepted Terms was treated as consent');
    assert.equal(body.record_type, 'sms_opt_in_declined');
  });

  test('the consent record keeps all three apart too', async () => {
    const h = mount();
    fill(h, { terms: true, sms: true });
    const body = (await h.submit(), h.sentBody());
    assert.equal(body.sms_opt_in, 'yes');
    assert.equal(body.terms_accepted, 'yes');
    assert.equal(body.record_type, 'sms_opt_in');
  });

  test('both records carry the evidence a disputed opt-in would need', async () => {
    for (const sms of [true, false]) {
      const h = mount();
      fill(h, { sms });
      await h.submit();
      const body = h.sentBody();
      for (const field of [
        'name', 'phone', 'sms_opt_in', 'terms_accepted', 'record_type', 'sms_program',
        'sms_use_case', 'brand', 'legal_entity', 'consent_source', 'consent_source_url',
        'consent_version', 'consent_recorded_at',
      ]) {
        assert.ok(field in body, `sms=${sms}: the record omits ${field}`);
      }
      assert.match(body.consent_recorded_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'the timestamp is not ISO 8601');
      assert.equal(body.consent_source_url, 'https://youraidepartment.ai/sms-consent/');
    }
  });

  test('the two outcomes are distinguishable in the inbox, not just in a field', async () => {
    const yes = mount(); fill(yes, { sms: true }); await yes.submit();
    const no = mount(); fill(no, { sms: false }); await no.submit();
    assert.notEqual(yes.sentBody().subject, no.sentBody().subject);
    assert.match(no.sentBody().subject, /DECLINED/i, 'a decline arrives looking like a consent');
  });
});

// ============================================================
// G — analytics stays honest about which outcome it was
// ============================================================

describe('30923 G: the diagnostic event distinguishes a decline from a consent', () => {
  test('it reports the outcome', async () => {
    for (const [sms, expected] of [[true, 'yes'], [false, 'no']] as const) {
      const h = mount();
      fill(h, { sms });
      await h.submit();
      const pushes = (h.window.dataLayer ?? []).filter((e: any) => e.event === 'sms_consent_submit');
      assert.equal(pushes.length, 1, `sms=${sms}: expected one sms_consent_submit`);
      assert.equal(pushes[0].sms_opt_in, expected, 'a decline and a consent are indistinguishable in GA4');
      assert.equal(pushes[0].source_page, '/sms-consent/');
      assert.equal(pushes[0].consent_version, 'sms_customer_care_v1_2026_09');
    }
  });

  test('it still carries no personal data', async () => {
    const h = mount();
    fill(h, { name: 'Ada Lovelace', phone: '+19045550147', sms: true });
    await h.submit();
    const payload = JSON.stringify(h.window.dataLayer);
    for (const pii of ['Ada', 'Lovelace', '9045550147', 'michael@']) {
      assert.equal(payload.includes(pii), false, `the dataLayer carries ${pii}`);
    }
    assert.deepEqual(
      Object.keys(h.window.dataLayer[0]).sort(),
      ['consent_version', 'event', 'sms_opt_in', 'source_page'],
      'the diagnostic event grew a parameter that was never agreed',
    );
  });

  test('a failed delivery records nothing, claims nothing, and reports honestly', async () => {
    const h = mount({ ok: false, body: null });
    fill(h, { sms: false });
    await h.submit();

    assert.equal((h.window.dataLayer ?? []).length, 0, 'an event fired for a submission that never landed');
    assert.equal(h.form.hidden, false, 'the form vanished even though nothing was saved');
    assert.equal(h.el['sms-form-success'].hidden, true);
    assert.equal(h.el['sms-form-declined'].hidden, true, 'a failed submission showed a confirmation');
    assert.match(h.errorShown()!, /no consent has been saved/i);
  });
});

// ============================================================
// The Sprint 13 protections, re-proved behaviourally
// ============================================================

describe('30923: the earlier protections survived the change', () => {
  test('a filled honeypot is discarded silently and never shown success', async () => {
    const h = mount();
    fill(h, { honeypot: true, sms: false });
    await h.submit();
    assert.equal(h.fetchCalls.length, 0);
    assert.equal(h.el['sms-form-success'].hidden, true);
    assert.equal(h.el['sms-form-declined'].hidden, true, 'the honeypot path renders a fake confirmation');
    assert.equal(h.form.hidden, false);
  });

  test('a missing name or number still blocks, for either answer', async () => {
    for (const sms of [true, false]) {
      const noName = mount(); fill(noName, { name: '  ', sms }); await noName.submit();
      assert.equal(noName.fetchCalls.length, 0, `sms=${sms}: submitted with no name`);
      assert.match(noName.errorShown()!, /name/i);

      const noPhone = mount(); fill(noPhone, { phone: '', sms }); await noPhone.submit();
      assert.equal(noPhone.fetchCalls.length, 0, `sms=${sms}: submitted with no number`);
      assert.match(noPhone.errorShown()!, /mobile number/i);
    }
  });

  test('the button is re-enabled after a failure so a retry is possible', async () => {
    const h = mount({ ok: false, body: null });
    fill(h, { sms: false });
    await h.submit();
    const button = h.form.querySelector('button[type="submit"]')!;
    assert.equal(button.disabled, false, 'a failed submission left the form unusable');
  });

  test('a duplicate submit while one is in flight is ignored', () => {
    assert.match(shippedHandler(), /if\s*\(\s*submitting\s*\)\s*return/);
  });
});
