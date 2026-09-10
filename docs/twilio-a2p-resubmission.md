# Twilio A2P 10DLC Resubmission — Your AI Department

**Updated:** 2026-09-10
**Status:** website changes implemented to address the reviewer's stated requirements, across two rejection rounds. **Not deployed. Not submitted. Not approved.**

Nothing in this document claims Twilio or any carrier has accepted anything. It is a preparation pack: the copy to paste, the evidence to point at, and the manual steps that remain.

**Round 2 — error 30923, forced consent.** The reviewer wrote: *"Your current signup workflow bundles SMS messaging consent directly into your mandatory Terms of Service or treats consent as a required condition to complete a transaction or create an account."* The second half was true and the first was not. `/sms-consent/` shipped a checkbox with no `required` and no `checked` attribute — the markup was correct — but its submit handler refused the form unless the box was ticked. Anyone who filled the form in and declined was blocked. §2 records the fix; §10 is how to verify it before resubmitting.

---

## 1. Active identity — use this everywhere, without variation

| Field | Value |
|---|---|
| Legal registered sender / Twilio Brand | **Catastrophic Solutions LLC** |
| Customer-facing brand | **Your AI Department** |
| Relationship language | **Your AI Department is a business brand operated by Catastrophic Solutions LLC.** |
| SMS sender display name | **Your AI Department (Catastrophic Solutions LLC)** |
| Website | `https://youraidepartment.ai/` |
| Privacy Policy | `https://youraidepartment.ai/privacy/` |
| SMS section of Privacy Policy | `https://youraidepartment.ai/privacy/#sms-privacy` |
| Terms of Use | `https://youraidepartment.ai/terms/` |
| SMS section of Terms | `https://youraidepartment.ai/terms/#sms-terms` |
| Public SMS opt-in page | `https://youraidepartment.ai/sms-consent/` |
| A2P use case | **CUSTOMER_CARE** |
| Consent version stamped on records | `sms_customer_care_v1_2026_09` |

Two rules that caused the original rejection and must not be relaxed:

- **Do not describe Catastrophic Solutions LLC and Your AI Department as unrelated senders.** Every public page now carries the same relationship sentence.
- **Do not call Your AI Department a DBA.** A fictitious-name registration is a specific filing and no evidence of one exists. "A business brand operated by" states the relationship without asserting a registration nobody has confirmed.

**Source of truth in code:** `src/lib/businessIdentity.ts`. Every rendered statement of legal identity reads from that file. The values above are its current values.

> **A change is expected within days.** The entity is anticipated to become **Your AI Department LLC**. It is deliberately absent from the website and from this document's active copy, because publishing it before the Twilio Brand changes recreates the same mismatch in the opposite direction. See `docs/legal-entity-cutover.md`.

---

## 2. Rejection-code matrix

| Code | Reviewer's finding | What was changed | Live evidence URL | Code / file | Twilio field to update manually |
|---|---|---|---|---|---|
| **30907** | Website brand did not match the registered sender | Site named "Your AI Department LLC" in Privacy and Terms; it is now Catastrophic Solutions LLC operating the Your AI Department brand, stated identically on the footer of every page (including the campaign landing pages), Privacy, Terms and the consent page. `Organization.legalName` added to structured data. | `/` (footer), `/privacy/`, `/terms/`, `/sms-consent/` | `src/lib/businessIdentity.ts`, `src/components/Footer.astro`, `src/components/funnel/FunnelFooter.astro`, `src/layouts/BaseLayout.astro` | Brand/business name and campaign description |
| **30908** | Privacy Policy lacked adequate mobile/SMS privacy language | Added a dedicated `#sms-privacy` section with the explicit non-sharing statement, the separation of operational processors from marketing sharing, and the fact that a phone number alone is not enrollment. | `/privacy/#sms-privacy` | `src/pages/privacy/index.astro` | Privacy Policy URL |
| **30896** | Opt-in / message flow did not adequately demonstrate consent | Built a real public opt-in page with a separate, unchecked, non-required checkbox carrying the full disclosure and clickable Privacy and Terms links. Added the notice on every other phone field that a phone number is not SMS consent. Rewrote the verbal script to include privacy/terms verbiage and the non-sharing statement. | `/sms-consent/` | `src/pages/sms-consent/index.astro`, `src/pages/contact/index.astro`, both assessment apps | message_flow, opt-in URL, verbal consent description |
| **30882** | Terms and Conditions insufficient for the SMS campaign | Added a dedicated `#sms-terms` section: program, sender, purpose, consent, frequency, rates, STOP, HELP, carrier liability, privacy link. | `/terms/#sms-terms` | `src/pages/terms/index.astro` | Terms URL |
| **30923** | SMS consent bundled into mandatory Terms, or treated as a condition of proceeding | The checkbox was already optional in markup; the **submit handler** was not. Removed the `if (!smsOptIn) { showError(…); return; }` gate, so the form now submits with the box unchecked, records `sms_opt_in: no`, and shows a confirmation saying no messages will be sent and no service is affected. Added a **separate required** Terms/Privacy checkbox beside the optional one, so the mandatory agreement and the optional consent are two controls with two names and two stored fields, each badged Required / Optional. Terms and Privacy now state in as many words that accepting them is not an SMS opt-in. | `/sms-consent/`, `/terms/#sms-terms`, `/privacy/#sms-privacy` | `src/pages/sms-consent/index.astro`, `src/pages/terms/index.astro`, `src/pages/privacy/index.astro` | message_flow (§4), opt-in URL |

> **Why the first fix did not hold.** Every structural assertion passed on the build that earned 30923: unchecked box, no `required`, disclosure present, links clickable. The defect lived in JavaScript that no structural test could see. `tests/smsConsentOptional.test.ts` now executes the **built** handler from `dist/` against a DOM shim and fails on the reintroduced gate in nine places.

---

## 3. Campaign description — paste into Twilio

```
Catastrophic Solutions LLC operates the Your AI Department brand. This CUSTOMER_CARE campaign sends non-promotional customer-care messages only to people who have contacted Your AI Department and have expressly opted in to SMS. Messages may include requested follow-up, answers to service questions, appointment coordination, appointment reminders, and support related to an inquiry or requested service. We do not use purchased lists, affiliate marketing, third-party lead generation, or promotional SMS blasts in this campaign.
```

---

## 4. Message flow / how end users consent — paste into Twilio

This describes **exactly** the two methods that exist. Website contact forms and assessments collect a phone number for a callback and explicitly state on the form that a phone number alone is not SMS consent — they are not opt-in sources and are not claimed as such.

The first paragraph is the one that answers 30923. It is written to be checkable line by line against the live page.

```
Opt-in method 1 — public website form. End users opt in at https://youraidepartment.ai/sms-consent/, which is public and requires no login, no account and no purchase. The user enters their name and mobile number, accepts the required Terms of Use and Privacy Policy in one checkbox labeled Required, and separately decides whether to check a second checkbox labeled Optional that grants SMS consent. The SMS checkbox is unchecked by default, carries no required attribute, is never pre-selected by script, and is not linked to the Terms checkbox in any way. SMS consent is not bundled into the Terms of Use: the Terms contain no agreement to receive text messages and state explicitly that accepting them is not an SMS opt-in. The form submits successfully whether or not the SMS box is checked. If it is left unchecked the submission is accepted and recorded as sms_opt_in=no, and the user is shown a confirmation stating that they did not opt in, that no text messages will be sent, and that they can still contact us, complete an assessment, schedule a call, purchase, and receive every service we offer. SMS consent is never a condition of submitting a form, completing a transaction, creating an account, or receiving any service. The disclosure shown immediately beside the SMS checkbox before consent reads: "I agree to receive customer-care text messages from Your AI Department, operated by Catastrophic Solutions LLC, at the mobile number provided. Messages may include requested follow-up, appointment coordination or reminders, and support. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. See our Privacy Policy and Terms of Use." The Privacy Policy and Terms of Use are clickable links on that disclosure. Privacy Policy: https://youraidepartment.ai/privacy/ Terms of Use: https://youraidepartment.ai/terms/

Opt-in method 2 — recorded verbal consent. During a live conversation with a person who has already contacted us, a representative reads the approved verbal consent script, which states the sender, the customer-care message types, that message frequency varies, that message and data rates may apply, STOP and HELP instructions, that consent is not a condition of purchase, the Privacy Policy and Terms URLs, and that mobile information and SMS consent are not shared with third parties or affiliates for marketing or promotional purposes. We record the mobile number, date and time, representative, consent source, script version, and the affirmative response.

Other website forms do not collect SMS consent. Providing a phone number on our contact form or in an assessment does not enroll the user in SMS messaging, and those forms state this on the page beside the phone field. No form anywhere on the website requires an SMS permission in order to submit, and no required checkbox on the website asks for permission to send text messages. We never send an SMS to ask someone to opt in.
```

---

## 5. Website checkbox disclosure — as rendered

Rendered on `/sms-consent/` from `SMS_CONSENT_DISCLOSURE_LEAD` in `src/lib/businessIdentity.ts`. `tests/twilioA2pCompliance.test.ts` asserts the built page and this document still match.

```
I agree to receive customer-care text messages from Your AI Department, operated by Catastrophic Solutions LLC, at the mobile number provided. Messages may include requested follow-up, appointment coordination or reminders, and support. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. See our Privacy Policy and Terms of Use.
```

On the live page, "Privacy Policy" links to `/privacy/#sms-privacy` and "Terms of Use" links to `/terms/#sms-terms`.

---

## 6. Approved verbal opt-in script

Read in full. Do not paraphrase or shorten — the previous submission was rejected partly because the verbal description omitted the privacy and terms verbiage.

```
Before I send you any text messages, I need your permission.

Do you agree to receive customer-care text messages from Your AI Department, which is a business brand operated by Catastrophic Solutions LLC, at the mobile number you provided?

These would be messages about your inquiry — requested follow-up, appointment coordination or reminders, and support. Message frequency varies, and message and data rates may apply. You can reply STOP at any time to opt out, or HELP for help.

Consent is not a condition of purchasing anything from us, and you can say no and still work with us.

Our Privacy Policy is at youraidepartment.ai/privacy and our Terms are at youraidepartment.ai/terms. We do not share, sell, or rent your mobile number or your SMS consent to third parties or affiliates for marketing or promotional purposes.

Do you agree to receive these customer-care text messages?
```

Consent is valid for our process only after a clear affirmative answer. Record for every verbal opt-in:

| Field | Example |
|---|---|
| Mobile number | the number consented for |
| Date and time | ISO 8601, with timezone |
| Representative | name of the person who read the script |
| Consent source | `verbal` |
| Script version | `sms_customer_care_v1_2026_09` |
| Affirmative response | recorded yes |

**Never** send an SMS to someone who has not already consented in order to ask them to consent.

---

## 7. Sample messages — CUSTOMER_CARE only

Every sample identifies the same sender as the website and the Brand.

```
1. Your AI Department (Catastrophic Solutions LLC): Thanks for contacting us about your AI project. I can help with your questions and next steps. Reply STOP to opt out, HELP for help.

2. Your AI Department (Catastrophic Solutions LLC): Reminder about your requested strategy call tomorrow at 2:00 PM. Reply if you need to reschedule. STOP to opt out, HELP for help.

3. Your AI Department (Catastrophic Solutions LLC): Following up on the question you sent us about AI automation. Are you available for a quick call this afternoon? STOP to opt out, HELP for help.

4. Your AI Department (Catastrophic Solutions LLC): Your appointment has been updated to Thursday at 11:30 AM. Reply here if you need anything else. STOP to opt out, HELP for help.
```

No marketing offers, discounts, newsletters, cold prospecting, affiliate promotions, or unrelated sales content belongs in this campaign. If promotional messaging is wanted later it needs its own use case and its own consent.

---

## 8. Opt-in confirmation, STOP and HELP

**Opt-in confirmation**
```
Your AI Department (Catastrophic Solutions LLC): You are opted in to customer-care texts. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.
```

**STOP confirmation**
```
Your AI Department (Catastrophic Solutions LLC): You have been opted out and will receive no further customer-care texts unless you opt in again.
```

**HELP response**
```
Your AI Department (Catastrophic Solutions LLC): For help, reply to this message or email michael@youraidepartment.ai. Reply STOP to opt out.
```

---

## 9. Consent records captured by the website form

Delivered with each `/sms-consent/` submission, and only after delivery is confirmed. **Both answers produce a record.** A decline is stored as evidence in its own right, arrives with a subject line reading `SMS opt-in DECLINED (no consent)`, and is what proves the form does not force consent:

| Field | Value |
|---|---|
| `name` | as entered |
| `phone` | as entered |
| `sms_opt_in` | `yes` or `no` — **the only field that means consent** |
| `record_type` | `sms_opt_in` or `sms_opt_in_declined` |
| `terms_accepted` | `yes` — the required agreement, recorded separately and never as consent |
| `phone_provided` | `yes` — a number was given, which is also not consent |
| `sms_program` | `Your AI Department customer care` |
| `sms_use_case` | `CUSTOMER_CARE` |
| `brand` | `Your AI Department` |
| `legal_entity` | `Catastrophic Solutions LLC` |
| `consent_source` | `website_form` |
| `consent_source_url` | `https://youraidepartment.ai/sms-consent/` |
| `consent_version` | `sms_customer_care_v1_2026_09` |
| `consent_recorded_at` | ISO 8601 timestamp |

Three facts are kept apart because collapsing any two of them is what carriers object to:

```
phone number provided   !=  SMS consent
Terms of Use accepted   !=  SMS consent
```

The name, phone number and consent text go to the lead delivery destination only. **None of it reaches GA4, GTM or Meta.** A single non-PII diagnostic event (`sms_consent_submit`, carrying only `consent_version`, `source_page` and `sms_opt_in: yes|no`) fires after delivery succeeds. It is not a lead and not a booking. The `sms_opt_in` parameter exists so a decline and a consent are never one indistinguishable number — see `docs/analytics/gtm-sprint15-operator-actions.md` §4.2.

### 9.1 Every form on the website, classified

Four forms exist. Audited against the **built** site, not the source, so client-rendered markup is included.

| Form | Collects a phone? | SMS checkbox? | Required checkboxes | Can it be completed with no phone and no SMS? |
|---|---|---|---|---|
| `/sms-consent/` | Yes, required — it is the messaging-preference form | **Yes — the only one on the site.** `sms_opt_in`, unchecked, not required, badged Optional | `terms_accepted` (Terms of Use + Privacy Policy; contains no agreement to receive messages) | Not applicable — but it submits fully with SMS declined |
| `/contact/` | Optional field, no `required` | None | `consent` — permission to reply to the inquiry. Does not mention SMS or text messages | **Yes** |
| `/free-ai-assessment/` (quick) | Optional field, no `required` | None | `consent` — permission to process the answers. Does not mention SMS. Plus `marketingOptIn`, optional, email only | **Yes** |
| `/ai-assessment/` (full) | Optional field, no `required` | None | `consent`, same wording. Plus `marketingOptIn`, optional, email only | **Yes** |

Every phone field outside `/sms-consent/` is optional and carries, associated to the input via `aria-describedby`, the line: *"A phone number alone does not opt you in to text messages. To receive customer-care texts, use our SMS Consent page."*

**No required checkbox anywhere on the website asks for permission to send text messages.** The only checkbox that does is `sms_opt_in`, and it is optional. `tests/twilioA2pCompliance.test.ts` asserts this across every built page and every client bundle, so a new form cannot quietly reintroduce it.

---

## 10. Reviewer checklist — verify on the LIVE site after deployment

Do this in a private window with no session, on the deployed site, after the CDN cache is purged. Every line is something the Twilio reviewer can repeat.

**The 30923 checkpoints — these are the ones that failed last time**

1. [ ] `/sms-consent/` loads over HTTPS with no login, no account, and no prior purchase.
2. [ ] The SMS checkbox renders **unchecked** on first load, and again after a hard refresh.
3. [ ] View source: the SMS input has **no** `required` and **no** `checked` attribute.
4. [ ] It is visibly badged **Optional**, and the required Terms box beside it is visibly badged **Required**.
5. [ ] Ticking or unticking the Terms box does **not** change the SMS box, and vice versa.
6. [ ] Fill in name and mobile number, tick **Terms only**, leave SMS unchecked, press Submit → **the form submits**.
7. [ ] The confirmation says you did **not** opt in, that no texts will be sent, and that no service is affected.
8. [ ] No error appears anywhere in that flow, and focus is never thrown to the SMS checkbox.
9. [ ] Repeat with the SMS box ticked → a different confirmation, the one that records consent.
10. [ ] `/terms/#sms-terms` contains "Accepting these Terms is not an SMS opt-in" and no agreement to receive messages.
11. [ ] `/contact/` and `/free-ai-assessment/` submit successfully with the phone field left empty, and neither has any SMS checkbox at all.

**The round-1 checkpoints, re-verified**

- [ ] The live site identifies Catastrophic Solutions LLC as the operator of the Your AI Department brand, in the footer of every page.
- [ ] `/privacy/` is public and reachable without login.
- [ ] `/privacy/#sms-privacy` states the mobile/SMS non-sharing language explicitly.
- [ ] `/terms/#sms-terms` contains the SMS program terms.
- [ ] Message frequency, message/data rates, STOP, HELP, and Privacy/Terms links are all visible **before** consent is given.
- [ ] Privacy and Terms links on the disclosure are clickable and resolve to the right anchors.
- [ ] A test submission produces a record with all fields in §9 — run it **twice**, once opted in and once declined, and confirm both arrive.
- [ ] Twilio campaign description, message_flow and samples all name the same sender as the website.

---

## 11. MANUAL ACTIONS AFTER WEBSITE DEPLOYMENT

**None of this is done. All of it is Michael's, in the Twilio console, after the site is live.** The copy blocks above are the exact text.

### 11.1 Order of operations

1. **Deploy the website first.** Every URL below must return 200 before submitting; a reviewer opening `/sms-consent/` and getting a 404 is an instant rejection.
2. **Purge the CDN / Cloudflare cache** for `/sms-consent/`, `/privacy/`, `/terms/`, and the hashed asset bundles. A reviewer served the cached pre-fix page sees the forced-consent behaviour and rejects again. Confirm with `curl -sI https://youraidepartment.ai/sms-consent/` that `last-modified` has moved.
3. **Walk all eleven 30923 checkpoints in §10 on the live site**, in a private window. Do not skip #6 — that single interaction is the whole rejection.
4. Verify the URLs in §11.2 in a private browser window with no session.
5. Capture the screenshots in §11.4.
6. Paste the copy blocks into the Twilio campaign — §4 in particular is new and must replace the old message_flow text.
7. **Only then** resubmit.

> **Do not press Resubmit before steps 1–6 are done.** A second rejection on the same code is worse than a delayed submission: it is evidence to the reviewer that the first fix was not real.

### 11.2 URLs to submit to Twilio

```
Website:        https://youraidepartment.ai/
Privacy Policy: https://youraidepartment.ai/privacy/
Terms of Use:   https://youraidepartment.ai/terms/
SMS opt-in:     https://youraidepartment.ai/sms-consent/
```

### 11.3 Fields to paste

| Twilio field | Source in this document |
|---|---|
| Business / Brand name | §1 — `Catastrophic Solutions LLC` |
| Brand ↔ brand relationship note | §1 relationship language |
| Campaign description | §3 |
| Message flow / opt-in description | §4 |
| Sample message 1–4 | §7 |
| Opt-in confirmation message | §8 |
| STOP / opt-out message | §8 |
| HELP message | §8 |
| Verbal consent description, if asked | §6 |

### 11.4 Screenshot checklist

**No screenshots have been captured.** They cannot be taken before deployment, since they must show the live site. Capture after deploy:

1. Homepage scrolled to the footer, showing the legal relationship line.
2. `/sms-consent/` showing the full disclosure, the **Required** Terms box and the **Optional** unchecked SMS box in one frame. This is the single most important image in the submission — both badges must be legible.
3. **The decline path, in three frames.** (a) The filled form with Terms ticked and SMS unchecked, before pressing Submit. (b) The confirmation that appears after pressing Submit, showing the "you did not opt in / we will not send you any" wording. (c) Browser devtools with the SMS input selected, showing no `required` and no `checked` attribute.
4. The consent path: the same form with the SMS box ticked, and the confirmation that records consent.
5. `/privacy/#sms-privacy` showing the non-sharing statement and the "accepting our Terms of Use … does not opt you in" paragraph.
6. `/terms/#sms-terms` showing the SMS program terms and "Accepting these Terms is not an SMS opt-in".
7. `/contact/` showing the phone field with its "a phone number alone does not opt you in" note, and no SMS checkbox anywhere on the form.

Save them to a folder named for the resubmission date so the set that was attached is recoverable later; nothing in this repository stores them.

### 11.5 Things Twilio may still reject that the website cannot fix

Recorded honestly rather than assumed away:

- Brand vetting is separate from campaign vetting. If the registered Brand's business details (EIN, address, contact) do not match public records, the campaign can fail regardless of the website.
- A reviewer may ask for the consent record itself for a specific number. §9 lists what the form stores; the verbal path depends on the business actually keeping the log described in §6.
- Carriers apply their own judgement on top of Twilio's.

---

## 12. Related documents

- `docs/legal-entity-cutover.md` — the procedure for switching to Your AI Department LLC. **Do not execute until Twilio/legal registration is ready.**
- `src/lib/businessIdentity.ts` — the code that renders every identity string above.
- `tests/twilioA2pCompliance.test.ts` — the structural assertions that keep these claims true.
- `tests/smsConsentOptional.test.ts` — the **behavioural** proof for 30923. It runs the built handler from `dist/` and fails if consent ever becomes a condition of submitting again.
- `docs/analytics/gtm-sprint15-operator-actions.md` §4.2 — the one GTM parameter this change adds.
