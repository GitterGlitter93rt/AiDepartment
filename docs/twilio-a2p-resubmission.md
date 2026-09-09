# Twilio A2P 10DLC Resubmission — Your AI Department

**Updated:** 2026-09-09
**Status:** website changes implemented to address the reviewer's stated requirements. **Not deployed. Not submitted. Not approved.**

Nothing in this document claims Twilio or any carrier has accepted anything. It is a preparation pack: the copy to paste, the evidence to point at, and the manual steps that remain.

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

---

## 3. Campaign description — paste into Twilio

```
Catastrophic Solutions LLC operates the Your AI Department brand. This CUSTOMER_CARE campaign sends non-promotional customer-care messages only to people who have contacted Your AI Department and have expressly opted in to SMS. Messages may include requested follow-up, answers to service questions, appointment coordination, appointment reminders, and support related to an inquiry or requested service. We do not use purchased lists, affiliate marketing, third-party lead generation, or promotional SMS blasts in this campaign.
```

---

## 4. Message flow / how end users consent — paste into Twilio

This describes **exactly** the two methods that exist. Website contact forms and assessments collect a phone number for a callback and explicitly state on the form that a phone number alone is not SMS consent — they are not opt-in sources and are not claimed as such.

```
Opt-in method 1 — public website form. End users opt in at https://youraidepartment.ai/sms-consent/. The user enters their name and mobile number and must affirmatively check a separate SMS consent checkbox that is unchecked by default and is not required to use the site or purchase services. The disclosure shown immediately beside the checkbox before consent reads: "I agree to receive customer-care text messages from Your AI Department, operated by Catastrophic Solutions LLC, at the mobile number provided. Messages may include requested follow-up, appointment coordination or reminders, and support. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. See our Privacy Policy and Terms of Use." The Privacy Policy and Terms of Use are clickable links on that disclosure. Privacy Policy: https://youraidepartment.ai/privacy/ Terms of Use: https://youraidepartment.ai/terms/

Opt-in method 2 — recorded verbal consent. During a live conversation with a person who has already contacted us, a representative reads the approved verbal consent script, which states the sender, the customer-care message types, that message frequency varies, that message and data rates may apply, STOP and HELP instructions, that consent is not a condition of purchase, the Privacy Policy and Terms URLs, and that mobile information and SMS consent are not shared with third parties or affiliates for marketing or promotional purposes. We record the mobile number, date and time, representative, consent source, script version, and the affirmative response.

Other website forms do not collect SMS consent. Providing a phone number on our contact form or in an assessment does not enroll the user in SMS messaging, and those forms state this on the page. We never send an SMS to ask someone to opt in.
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

Delivered with each `/sms-consent/` submission, and only after delivery is confirmed:

| Field | Value |
|---|---|
| `name` | as entered |
| `phone` | as entered |
| `sms_opt_in` | `yes` (the record is only created when the box is checked) |
| `sms_program` | `Your AI Department customer care` |
| `sms_use_case` | `CUSTOMER_CARE` |
| `brand` | `Your AI Department` |
| `legal_entity` | `Catastrophic Solutions LLC` |
| `consent_source` | `website_form` |
| `consent_source_url` | `https://youraidepartment.ai/sms-consent/` |
| `consent_version` | `sms_customer_care_v1_2026_09` |
| `consent_recorded_at` | ISO 8601 timestamp |

The name, phone number and consent text go to the lead delivery destination only. **None of it reaches GA4, GTM or Meta.** A single non-PII diagnostic event (`sms_consent_submit`, carrying only `consent_version` and `source_page`) fires after delivery succeeds. It is not a lead and not a booking.

---

## 10. Reviewer checklist — verify after deployment

- [ ] The live site identifies Catastrophic Solutions LLC as the operator of the Your AI Department brand, in the footer of every page.
- [ ] `/privacy/` is public and reachable without login.
- [ ] `/privacy/#sms-privacy` states the mobile/SMS non-sharing language explicitly.
- [ ] `/terms/#sms-terms` contains the SMS program terms.
- [ ] `/sms-consent/` is public, loads without authentication, and works without a session.
- [ ] The consent checkbox is separate, unchecked, and not required.
- [ ] Message frequency, message/data rates, STOP, HELP, and Privacy/Terms links are all visible **before** consent is given.
- [ ] Privacy and Terms links on the disclosure are clickable and resolve.
- [ ] A test submission produces a consent record with all fields in §9.
- [ ] A submission with the box unchecked is refused and records nothing.
- [ ] Twilio campaign description, message_flow and samples all name the same sender as the website.

---

## 11. MANUAL ACTIONS AFTER WEBSITE DEPLOYMENT

**None of this is done. All of it is Michael's, in the Twilio console, after the site is live.** The copy blocks above are the exact text.

### 11.1 Order of operations

1. **Deploy the website first.** Every URL below must return 200 before submitting; a reviewer opening `/sms-consent/` and getting a 404 is an instant rejection.
2. Verify the URLs in §11.2 in a private browser window with no session.
3. Capture the screenshots in §11.4.
4. Paste the copy blocks into the Twilio campaign.
5. Resubmit.

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
2. `/sms-consent/` showing the full disclosure and the unchecked checkbox in one frame.
3. `/privacy/#sms-privacy` showing the non-sharing statement.
4. `/terms/#sms-terms` showing the SMS program terms.
5. Optionally, the consent form's success state after a real test submission.

### 11.5 Things Twilio may still reject that the website cannot fix

Recorded honestly rather than assumed away:

- Brand vetting is separate from campaign vetting. If the registered Brand's business details (EIN, address, contact) do not match public records, the campaign can fail regardless of the website.
- A reviewer may ask for the consent record itself for a specific number. §9 lists what the form stores; the verbal path depends on the business actually keeping the log described in §6.
- Carriers apply their own judgement on top of Twilio's.

---

## 12. Related documents

- `docs/legal-entity-cutover.md` — the procedure for switching to Your AI Department LLC. **Do not execute until Twilio/legal registration is ready.**
- `src/lib/businessIdentity.ts` — the code that renders every identity string above.
- `tests/twilioA2pCompliance.test.ts` — the automated assertions that keep these claims true.
