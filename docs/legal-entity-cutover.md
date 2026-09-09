# FUTURE LEGAL ENTITY CUTOVER — DO NOT EXECUTE UNTIL TWILIO/LEGAL REGISTRATION IS READY

**Status: NOT STARTED. NOT APPROVED. NOTHING BELOW HAS BEEN DONE.**

| | |
|---|---|
| **Current active entity** | Catastrophic Solutions LLC |
| **Current Twilio Brand** | Catastrophic Solutions LLC |
| **Anticipated future entity** | Your AI Department LLC |
| **Expected timing** | approximately 1–4 days from 2026-09-09, per Michael |
| **Trigger to execute** | Michael confirms Your AI Department LLC is legally active **and** the Twilio Brand is being re-registered |

---

## Why this is a procedure and not a config flag

The website and the Twilio Brand must name the same sender at the same time. Twilio error 30907 is precisely the failure where they do not.

That makes the cutover a **synchronised** change, not a deployment. Publishing "Your AI Department LLC" while the Twilio Brand still reads "Catastrophic Solutions LLC" recreates the rejection in the opposite direction — the website would then be the thing that is wrong.

For that reason `src/lib/businessIdentity.ts` deliberately contains **no** `futureLegalEntity` field. A future value sitting in the active config is a value someone renders by accident.

---

## Step 0 — preconditions. Do not start until all four are true

- [ ] Your AI Department LLC is legally formed and active in its jurisdiction.
- [ ] EIN, registered address, and authorised contact for the new entity are available and match what will be filed with Twilio.
- [ ] Michael has confirmed the Twilio Brand is being changed or re-registered.
- [ ] It is understood whether the existing A2P campaign can be reassociated or must be recreated — see Step 2.

If any is unknown, stop. A half-executed cutover is worse than no cutover.

---

## Step 1 — decide what happens to the existing Brand and campaign

This determines everything after it, and **only Twilio can answer it.** Ask Twilio support or check the console before touching code:

- Can an existing A2P Brand's legal entity name be **edited**, or does a new legal entity require a **new Brand registration**?
- If a new Brand is required, must the campaign be recreated and re-vetted, and is there a re-vetting fee?
- Does the existing 10DLC number need to be reassociated with the new campaign?

**Do not guess.** Record the answer in this document when known.

> Working assumption, unverified: a change of registered legal entity generally requires a new Brand and therefore a new campaign, because Brand vetting is tied to the EIN. Treat as an assumption until confirmed.

---

## Step 2 — the code change

This is the small part. One file:

**`src/lib/businessIdentity.ts`**

```diff
-export const LEGAL_ENTITY = 'Catastrophic Solutions LLC';
+export const LEGAL_ENTITY = 'Your AI Department LLC';
```

and bump the consent version, because the sender the person consented to receive messages from has changed — a material change to what they agreed to, not a cosmetic one:

```diff
-export const SMS_CONSENT_VERSION = 'sms_customer_care_v1_2026_09';
+export const SMS_CONSENT_VERSION = 'sms_customer_care_v2_<yyyy>_<mm>';
```

Consider whether the relationship sentence still makes sense. If Your AI Department LLC operates the brand directly, "Your AI Department is a business brand operated by Your AI Department LLC" is technically true but reads oddly. A better form may be:

```
Your AI Department is operated by Your AI Department LLC.
```

That is a wording decision, made in `LEGAL_RELATIONSHIP` in the same file.

### What this one change propagates to automatically

No manual editing required in any of these:

| Surface | Consumes |
|---|---|
| Site footer (every full-chrome page) | `LEGAL_RELATIONSHIP`, `BRAND_NAME`, `LEGAL_ENTITY` |
| Funnel/campaign footer (`/go/*`, three VSL funnels) | `LEGAL_RELATIONSHIP` |
| `Organization` JSON-LD `legalName` | `LEGAL_ENTITY` |
| `/privacy/` — opening, SMS section, contact block, meta description | `LEGAL_ENTITY`, `BRAND_NAME`, `LEGAL_RELATIONSHIP` |
| `/terms/` — opening, IP, SMS program, liability, contact, meta description | same |
| `/sms-consent/` — sender, disclosure, contact, form payload, meta description | same plus `SMS_CONSENT_DISCLOSURE_LEAD`, `SMS_CONSENT_VERSION` |
| Legal nav links | `LEGAL_ROUTES` |

---

## Step 3 — files that still need a human after the code change

The centralised change does **not** reach these. Each must be edited deliberately.

| File | What to change | Why it is not automatic |
|---|---|---|
| `docs/twilio-a2p-resubmission.md` | §1 identity table, §3 campaign description, §4 message_flow, §5 disclosure, §6 verbal script, §7 all four samples, §8 opt-in/STOP/HELP, §9 consent-record table | Markdown copy destined for the Twilio console; it is text a human pastes, not rendered code |
| `docs/legal-entity-cutover.md` (this file) | Mark executed, record the date and the answers from Step 1 | — |
| `docs/sprints/sprint13-outbound-conversion-seo.md` | Compliance note, if it names the entity | Historical sprint record |
| `tests/twilioA2pCompliance.test.ts` | The forbidden-string assertion inverts: `Your AI Department LLC` becomes the expected active operator and `Catastrophic Solutions LLC` becomes the stale one | The test exists to catch a premature rename; after cutover it must catch the opposite |
| `src/pages/privacy/index.astro`, `src/pages/terms/index.astro`, `src/pages/sms-consent/index.astro` | `lastUpdated` date | Deliberately literal — a legal document's revision date should be a decision, not a build artefact |
| Twilio console | Everything in §11 of the resubmission doc | External system |
| Any signed contracts, invoices, Stripe/Cal.com account names, bank and email footers | Out of scope for this repository | Named here so they are not forgotten |

**Historical documents are not rewritten.** `docs/seo/full-site-seo-audit.md` and `docs/seo/metadata-before-after.md` record metadata as it was at the time, including the old "Your AI Department LLC" string. They are audit records; falsifying them to match today would destroy their only value. They render nothing.

---

## Step 4 — execution checklist, in order

The order matters. Website and Twilio must not disagree for longer than one deployment window.

1. [ ] Step 0 preconditions all true.
2. [ ] Step 1 answered by Twilio, recorded here.
3. [ ] Branch from the then-current website head. Do not reuse an old branch.
4. [ ] Change `LEGAL_ENTITY` and bump `SMS_CONSENT_VERSION`.
5. [ ] Review `LEGAL_RELATIONSHIP` wording.
6. [ ] Update `lastUpdated` on privacy, terms, sms-consent.
7. [ ] Invert the entity assertions in `tests/twilioA2pCompliance.test.ts`.
8. [ ] Update every §3 document, especially the resubmission pack.
9. [ ] `npm ci && npx astro check && npm test && npm run build`.
10. [ ] Grep the **built** output: `grep -rl "Catastrophic Solutions" dist` must return nothing.
11. [ ] Deploy the website. **Deploy before submitting to Twilio** — the reviewer checks a live site.
12. [ ] Verify the four public URLs return 200 and name the new entity.
13. [ ] Capture fresh screenshots. The old ones show the wrong entity and must not be reused.
14. [ ] Create or update the Twilio Brand per Step 1's answer.
15. [ ] Update or recreate the campaign: description, message_flow, samples, opt-in confirmation, STOP, HELP.
16. [ ] Reassociate the phone number(s) if a new campaign was required.
17. [ ] Submit.
18. [ ] Record the outcome and date in this document.

---

## Step 5 — consent records created under the old entity

People who opted in before the cutover consented to receive messages from **Catastrophic Solutions LLC**. That is what `consent_version: sms_customer_care_v1_2026_09` records, and it is why the version is stamped on every record.

Decide deliberately, and take advice if unsure — this document does not give legal advice and does not decide it:

- Whether existing consent carries over to the successor entity, which commonly depends on whether it is a continuation of the same business or a genuinely new party.
- Whether to send a notice of the operator change to opted-in numbers before the first message from the new sender.
- Whether the first message under the new entity should re-identify the sender explicitly.

Do not silently start texting an old opt-in list under a new company name without making that decision.

---

## Rollback

The code change is one line and one commit; `git revert` restores it. The real exposure is the window where the deployed site and the Twilio Brand disagree. Keep it short, and if the Brand registration stalls after the site has been deployed, **revert the website** rather than leaving the mismatch standing.
