#!/usr/bin/env node
// Live acceptance test for Twilio A2P error 30923 (forced consent).
//
//   node scripts/verify-30923-live.mjs [baseUrl]
//
// Run it against PRODUCTION after deploying and purging the CDN. It
// fetches the real pages, and for the behavioural checks it extracts
// the inline handler the live page actually serves and executes it
// against a DOM shim with fetch stubbed out — so Test A and Test B
// prove the deployed JavaScript accepts a decline WITHOUT sending a
// real consent record to the lead inbox.
//
// Exit code 0 = every check passed. Non-zero = do not resubmit.
//
// Running this against the un-deployed site is a valid thing to do: it
// should fail on A, D and E, and that failure is the evidence that the
// fix is not live yet.

const BASE = (process.argv[2] || 'https://youraidepartment.ai').replace(/\/$/, '');

let pass = 0;
const failures = [];
const note = [];

function check(id, label, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  PASS  ${id}  ${label}`); }
  else { failures.push(`${id} ${label}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${id}  ${label}${detail ? '\n          ' + detail : ''}`); }
}

async function guard(id, label, fn) {
  try { await fn(); } catch (e) { check(id, label, false, `threw: ${e.message}`); }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ')
  .replace(/\s+/g, ' ');

/** Strip comments without eating the URLs inside string literals. */
function codeOnly(js) {
  let out = '';
  for (let i = 0; i < js.length; ) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') { while (i < js.length && js[i] !== '\n') i += 1; continue; }
    if (c === '/' && js[i + 1] === '*') { i += 2; while (i < js.length && !(js[i] === '*' && js[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i += 1;
      while (i < js.length) {
        if (js[i] === '\\') { out += js.slice(i, i + 2); i += 2; continue; }
        out += js[i]; i += 1;
        if (js[i - 1] === c) break;
      }
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

const attrsOf = (tag) => {
  const out = {};
  const body = tag.replace(/^<[a-zA-Z0-9-]+\s*/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) out[m[1]] = m[2] ?? '';
  return out;
};

// ---------- the DOM shim ----------
class El {
  constructor(id, attrs = {}, tag = 'input') {
    this.id = id; this.tag = tag; this.attrs = { ...attrs };
    this.checked = 'checked' in attrs; this.value = ''; this.disabled = false;
    this.textContent = ''; this.focusCount = 0;
  }
  get name() { return this.attrs.name ?? ''; }
  get type() { return this.attrs.type ?? ''; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  focus() { this.focusCount += 1; }
}
class FormEl extends El {
  constructor(id) { super(id, {}, 'form'); this.listeners = {}; this.controls = []; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  querySelector(s) { if (s === 'button[type="submit"]') return this.controls.find((c) => c.tag === 'button') ?? null; throw new Error('shim: ' + s); }
  querySelectorAll(s) { if (s === '[aria-invalid]') return this.controls.filter((c) => c.hasAttribute('aria-invalid')); throw new Error('shim: ' + s); }
}

function mountLive(html, { ok = true, body = { success: true } } = {}) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const handler = scripts.filter((s) => s.includes("getElementById('sms-consent-form')"));
  if (handler.length !== 1) throw new Error(`expected 1 inline consent handler on the live page, found ${handler.length}`);

  const formHtml = html.match(/<form id="sms-consent-form"[\s\S]*?<\/form>/)?.[0];
  if (!formHtml) throw new Error('no consent form on the live page');

  const form = new FormEl('sms-consent-form');
  const byId = { 'sms-consent-form': form };
  const controls = [
    ...[...formHtml.matchAll(/<input\b[^>]*>/g)].map((m) => attrsOf(m[0])),
    ...[...formHtml.matchAll(/<button\b[^>]*>/g)].map((m) => ({ ...attrsOf(m[0]), tag: 'button' })),
  ];
  for (const c of controls) {
    const el = new El(c.id ?? '', c, c.tag ?? 'input');
    form.controls.push(el);
    if (c.id) byId[c.id] = el;
  }
  for (const id of ['sms-form-error', 'sms-form-success', 'sms-form-declined']) {
    const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`))?.[0];
    byId[id] = new El(id, tag ? attrsOf(tag) : { hidden: '' }, 'div');
  }
  const sent = [];
  const fetchStub = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok, json: async () => body }; };
  const win = {};
  function FormDataShim(f) {
    this.get = (k) => {
      const el = f.controls.find((c) => c.name === k);
      if (!el) return null;
      return el.type === 'checkbox' ? (el.checked ? 'on' : null) : el.value;
    };
  }
  new Function('document', 'window', 'fetch', 'FormData',
    handler[0])({ getElementById: (id) => byId[id] ?? null }, win, fetchStub, FormDataShim);

  return {
    form, el: byId, win, sent, handler: handler[0], controls,
    async submit({ name = 'Compliance Check', phone = '+19045550147', terms = true, sms = false } = {}) {
      byId['sms-name'] && (byId['sms-name'].value = name);
      byId['sms-phone'] && (byId['sms-phone'].value = phone);
      byId['sms-terms-accept'] && (byId['sms-terms-accept'].checked = terms);
      byId['sms-opt-in'] && (byId['sms-opt-in'].checked = sms);
      await (form.listeners.submit ?? [])[0]({ preventDefault() {} });
    },
  };
}

// ================================================================
console.log(`\nTwilio 30923 live acceptance test — ${BASE}\n`);

const consent = await get('/sms-consent/');
const privacy = await get('/privacy/');
const terms = await get('/terms/');
const contact = await get('/contact/');

console.log('SERVING');
console.log(`  /sms-consent/  HTTP ${consent.status}  last-modified: ${consent.headers.get('last-modified') || 'n/a'}  cf-cache: ${consent.headers.get('cf-cache-status') || 'n/a'}`);
console.log(`  /privacy/      HTTP ${privacy.status}  last-modified: ${privacy.headers.get('last-modified') || 'n/a'}  cf-cache: ${privacy.headers.get('cf-cache-status') || 'n/a'}`);
console.log(`  /terms/        HTTP ${terms.status}  last-modified: ${terms.headers.get('last-modified') || 'n/a'}  cf-cache: ${terms.headers.get('cf-cache-status') || 'n/a'}\n`);

for (const [p, r] of [['/sms-consent/', consent], ['/privacy/', privacy], ['/terms/', terms], ['/contact/', contact]]) {
  check('SERV', `${p} returns 200`, r.status === 200, `got ${r.status}`);
}

// ---------------- Test C — initial state ----------------
console.log('\nTEST C — initial state of the controls');
const smsTag = consent.body.match(/<input[^>]*id="sms-opt-in"[^>]*>/)?.[0] ?? '';
const termsTag = consent.body.match(/<input[^>]*id="sms-terms-accept"[^>]*>/)?.[0] ?? '';
check('C1', 'the SMS checkbox exists on the live page', Boolean(smsTag));
check('C2', 'it is NOT pre-checked', Boolean(smsTag) && !/\schecked/.test(smsTag), smsTag);
check('C3', 'it has NO required attribute', Boolean(smsTag) && !/\srequired/.test(smsTag), smsTag);
check('C4', 'a separate Terms control exists and IS required', Boolean(termsTag) && /\srequired/.test(termsTag) && /name="terms_accepted"/.test(termsTag), termsTag);
check('C5', 'the two are visibly badged Required and Optional', /perm-badge-required/.test(consent.body) && /perm-badge-optional/.test(consent.body));
check('C6', 'the page says the form submits either way', /submits whether you check it or not/i.test(visible(consent.body)));

// ---------------- Test D — the deployed JavaScript ----------------
console.log('\nTEST D — the JavaScript actually being served');
let live;
try { live = mountLive(consent.body); } catch (e) { check('D0', 'the inline handler could be extracted', false, e.message); }
if (live) {
  const js = codeOnly(live.handler);
  check('D1', 'no `if (!smsOptIn)` gate in the deployed code', !/if\s*\(\s*!\s*smsOptIn\s*\)/.test(js));
  const guards = [...js.matchAll(/if\s*\(([^)]*)\)\s*\{?\s*(?:showError|return)/g)].map((m) => m[1]);
  const bad = guards.filter((g) => /smsOptIn|sms_opt_in/.test(g));
  check('D2', 'no submission guard tests the SMS answer', bad.length === 0, bad.join(' | '));
  check('D3', 'the SMS answer is recorded as yes or no', /sms_opt_in:\s*smsOptIn\s*\?\s*'yes'\s*:\s*'no'/.test(js));
}

// ---------------- Test A — decline, the reviewer's journey ----------------
console.log('\nTEST A — decline SMS and submit  (THE acceptance test)');
if (live) await guard('A0', 'the decline journey ran to completion', async () => {
  const a = mountLive(consent.body);
  await a.submit({ sms: false });
  const err = a.el['sms-form-error'];
  check('A1', 'the submission was accepted and sent', a.sent.length === 1, `deliveries: ${a.sent.length}`);
  check('A2', 'NO validation error was raised', err.hidden === true, err.textContent);
  check('A3', 'the form was replaced by a confirmation', a.form.hidden === true);
  check('A4', 'the decline confirmation was shown', a.el['sms-form-declined'].hidden === false);
  check('A5', 'the consent confirmation was NOT shown', a.el['sms-form-success'].hidden === true);
  check('A6', 'focus was never thrown to the SMS checkbox', (a.el['sms-opt-in']?.focusCount ?? 0) === 0);
});

// ---------------- Test B — opt in ----------------
console.log('\nTEST B — opt in and submit');
if (live) await guard('B0', 'the opt-in journey ran to completion', async () => {
  const b = mountLive(consent.body);
  await b.submit({ sms: true });
  check('B1', 'the submission was accepted and sent', b.sent.length === 1);
  check('B2', 'the consent confirmation was shown', b.el['sms-form-success'].hidden === false);
  check('B3', 'no validation error', b.el['sms-form-error'].hidden === true);
});

// ---------------- Test E — stored distinction ----------------
console.log('\nTEST E — the three facts are stored apart');
if (live) await guard('E0', 'both record journeys ran to completion', async () => {
  const d = mountLive(consent.body); await d.submit({ sms: false });
  const o = mountLive(consent.body); await o.submit({ sms: true });
  const dec = d.sent[0] ?? {}, opt = o.sent[0] ?? {};
  check('E1', 'declined: a phone number was provided', dec.phone_provided === 'yes' && Boolean(dec.phone));
  check('E2', 'declined: Terms accepted = yes', dec.terms_accepted === 'yes');
  check('E3', 'declined: SMS opt-in = no', dec.sms_opt_in === 'no', `got ${dec.sms_opt_in}`);
  check('E4', 'opted in:  a phone number was provided', opt.phone_provided === 'yes' && Boolean(opt.phone));
  check('E5', 'opted in:  Terms accepted = yes', opt.terms_accepted === 'yes');
  check('E6', 'opted in:  SMS opt-in = yes', opt.sms_opt_in === 'yes', `got ${opt.sms_opt_in}`);
  check('E7', 'the two records are distinguishable', dec.record_type !== opt.record_type && dec.subject !== opt.subject);
  const leaked = ['name', 'phone', 'email'].filter((k) => JSON.stringify(d.win.dataLayer ?? []).toLowerCase().includes(k));
  check('E8', 'no personal data reached the dataLayer', leaked.length === 0, leaked.join(', '));
});

// ---------------- Test F — the three pages agree ----------------
console.log('\nTEST F — /sms-consent/, Privacy and Terms agree');
const claims = [
  ['SMS is optional', [/optional/i, /optional/i, /optional/i]],
  ['not a condition of purchase/services', [/not a condition of purchas|never a condition of doing business/i, /not a condition of purchasing or receiving our services/i, /not a condition of purchasing or receiving our services/i]],
  ['a phone number alone is not consent', [/phone number without the checked consent box is not treated as SMS consent/i, /does not by itself enroll you in SMS/i, /does not by itself enroll you in SMS messaging/i]],
  ['message frequency varies', [/frequency varies/i, /frequency varies/i, /frequency varies/i]],
  ['message and data rates may apply', [/rates may apply/i, /rates may apply/i, /rates may apply/i]],
  ['STOP is described', [/\bSTOP\b/, /\bSTOP\b/, /\bSTOP\b/]],
  ['HELP is described', [/\bHELP\b/, /\bHELP\b/, /\bHELP\b/]],
];
const texts = [visible(consent.body), visible(privacy.body), visible(terms.body)];
const names = ['/sms-consent/', '/privacy/', '/terms/'];
claims.forEach(([label, pats], i) => {
  const missing = pats.map((p, j) => (p.test(texts[j]) ? null : names[j])).filter(Boolean);
  check(`F${i + 1}`, label, missing.length === 0, missing.length ? `missing on ${missing.join(', ')}` : '');
});
check('F8', 'Terms states that accepting it is not an SMS opt-in', /Accepting these Terms is not an SMS opt-in/i.test(texts[2]));
check('F9', 'Privacy states that accepting it is not an SMS opt-in', /does not opt you in to text messages/i.test(texts[1]));

// ---------------- Phase 6 — other phone forms ----------------
console.log('\nPHASE 6 — the other phone-collecting forms');
const contactPhone = contact.body.match(/<input[^>]*type="tel"[^>]*>/)?.[0] ?? '';
check('P1', '/contact/ phone field is NOT required', Boolean(contactPhone) && !/\srequired/.test(contactPhone), contactPhone);
check('P2', '/contact/ says a phone number is not an opt-in', /A phone number alone does not opt you in to text messages/i.test(visible(contact.body)));
check('P3', '/contact/ has no SMS checkbox at all', !/name="sms[_-]?opt/i.test(contact.body));
const contactRequired = [...contact.body.matchAll(/<input[^>]*type="checkbox"[^>]*required[^>]*>/g)].map((m) => m[0]);
check('P4', '/contact/ required checkboxes do not mention SMS', contactRequired.every((t) => !/sms|text message/i.test(t)));

for (const [label, path] of [['short assessment', '/free-ai-assessment/'], ['comprehensive assessment', '/ai-assessment/full/']]) {
  const p = await get(path);
  const bundles = [...p.body.matchAll(/src="(\/_astro\/[^"]+\.js)"/g)].map((m) => m[1]);
  let js = '';
  for (const b of bundles) js += (await get(b)).body;
  const tel = js.match(/<input type="tel"[^>]*>/)?.[0] ?? '';
  check(`P5-${label}`, `${path} phone field is NOT required`, Boolean(tel) && !/\srequired/.test(tel), tel || 'phone field not found in bundles');
  check(`P6-${label}`, `${path} carries the "phone is not an opt-in" notice`, /A phone number alone does not opt you in to text messages/i.test(js));
  check(`P7-${label}`, `${path} has no SMS checkbox`, !/name="sms[_-]?opt/i.test(js));
}

// ================================================================
console.log(`\n${'='.repeat(64)}`);
console.log(`  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n  DO NOT RESUBMIT TO TWILIO. Failing checks:');
  for (const f of failures) console.log(`    - ${f}`);
  console.log('');
  process.exit(1);
}
console.log('\n  All live checks passed. Error 30923\'s cause is gone from the live journey.');
console.log('  Resubmission is still a separate, manual, authorized step.\n');
