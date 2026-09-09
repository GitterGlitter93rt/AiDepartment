# Sprint 13 — Cold-Outbound Conversion, Trustworthy Conversion Measurement, and Search-Intent SEO

**Branch:** `sprint13-outbound-conversion-seo`
**Branched from:** `sprint12-industry-content-expansion` @ `cbbdca2`
**Date:** 2026-09-09
**Status:** implemented, verified, and **backed up on `origin`** at `84b0dc206a0d2db93f2c0d06c1eeaa09c811094e`. **Not merged, not deployed.**

**One deployment blocker remains:** the live SiteGround `.htaccess` must be read and merged by hand before `dist/` is uploaded — see §A2a. Two external configurations (Cal.com, GTM/GA4) are still required before parts of this sprint produce data — see §M.

---

## A. What was discovered before anything was changed

### A1. The branch named in the brief was not the branch that was checked out

The brief named `sprint12-industry-content-expansion` at `897bccb3f5…`. That SHA is a **tree**, not a commit — it is the tree of `cbbdca2`, the head of that branch. The branch is current with `origin`.

The working directory was on `feature/outbound-sales-brain`, a different lineage that shares only `main` (`648da9d`, 14 Aug) with the website. It carries `services/`, `phone-agent/`, and the operational `brain/`, and its `src/` is the **older, pre-Sprint-12 website** — 18,803 lines behind on `src/` alone, with none of `attribution.ts`, `repAttribution.ts`, `scheduling.ts`, `bookingConfirmation.ts`, `ga4Events.ts`, `AnalyticsEvents.astro` or `AttributionCapture.astro`. Every file the brief asked to inspect exists only on the sprint12 lineage.

Doing this sprint's work on the checked-out branch would have built it on top of a website months out of date. All work is therefore branched from `sprint12-industry-content-expansion`.

**This is an open reconciliation item, not something this sprint fixed.** See §Q3.

### A2. The repository said production was ahead of GitHub. It was, once — but not any more

`brain/WEBSITE.md` and `brain/TODO.md` (WEB-003, INPUT-005) record that **production contains fixes not present at any GitHub head**, and that source synchronisation is required before overwriting website code.

**That warning is stale, and this sprint was built defensively before it was known to be stale.** The defensive posture is worth keeping either way, so it is described here as written:

- Every new capability is a **new file**. The `/go/` pages, the outbound module, `BreadcrumbSchema.astro`, both resources, the OG image and its generator, and all new tests are additive.
- Edits to existing files are **surgical and individually described** in §B, so they can be re-applied by hand against the production source if it turns out to differ.
- Nothing in the assessment engine, the quick-assessment app, the audit page, or the lead-submission path was touched.

### A2a. The production-source audit, and what it established

A read-only audit on 2026-09-09 established that **`cbbdca2` is the deployed production source**, and therefore that Sprint 13 cannot regress a production-only change. The brain's warning predates the sync by one day and was never updated.

**The sequence that resolved it.** The brain snapshot is dated 2026-08-30 and inspected sprint12 at `989ee8a`. Two commits landed after that inspection:

- `64adcc1` (2026-08-31) — *"feat: preserve production funnels and add Smartlead attribution"*. Its message states: *"Captures the exact deployed production source, which until now existed only in the deployment workspace. Verified against live production before committing: normalized HTML for /, /ai-assessment/, /free-ai-assessment/ and /comprehensive-ai-business-audit/ matches this tree's build output."*
- `cbbdca2` (2026-09-01) — *"fix: preserve assessment forms and track rep attribution"*.

**Evidence gathered independently of those commit messages:**

| Signal | Finding |
|---|---|
| `last-modified` on `https://youraidepartment.ai/` | `Tue, 01 Sep 2026 05:42:08 GMT` — **18 minutes after `cbbdca2` was committed**, and unchanged when re-checked on 2026-09-09. Nothing has been deployed since. |
| Content-hashed shared libraries | `attribution.DFbyELri.js`, `repAttribution.BR-s0p-j.js`, `scheduling.DUe-L1wn.js` — production's filenames *and* bytes are identical to this tree's build. Astro hashes on content, so an identical hash is an identical source file. These three are untouched by Sprint 13. |
| Production's `booking-confirmed` bundle | Decompiles to exactly `buildBookingConfirmedEvent(bookingType, repCode)` — two parameters, `sessionStorage`, key `yai_booking_confirmed_seen`, `.slice(-20)`. That is `cbbdca2` unmodified. |
| Production's assessment bundle | Contains `captureContactDraft`, `a-contact-error`, `aria-invalid`, `showContactError` — the `cbbdca2` contact-form preservation fix. |
| All 28 industry pages, production vs local build | 16 byte-identical; 9 differ only by the `BreadcrumbList` schema Sprint 13 adds; 3 differ by the deliberate Sprint 13 deepening. **No production-only content anywhere.** |
| Production `sitemap.xml` | 117 URLs, every one present in this branch. Nothing live is missing from Git. |
| `/assessment/?utm_…` | Real HTTP 301 preserving the query string, and a real 404 with the branded page — so `public/.htaccess` from `64adcc1` is live at the origin. |

**Each brain claim, tested against `cbbdca2`:** `booking_click_comprehensive_audit` present · Cal.com $495 audit flow present · the corrected `#a-quick-start-btn` handler present · the retired on-site audit form and `paid_audit_request_submit` both gone.

**Conclusion: no Sprint 13 modification can overwrite a production-only change, because there are none.** WEB-003 and INPUT-005 were completed by `64adcc1` + `cbbdca2`; only the brain never recorded it. See §Q3 for the brain reconciliation that is still owed.

### A2b. The remaining deployment risk is the live SiteGround `.htaccess`

This is now the **only** unresolved deployment blocker, and it is not a Git problem.

`dist/.htaccess` ships from `public/.htaccess`. The live SiteGround web-root `.htaccess` is **not readable from this environment** — it returns HTTP 403 over the web (correctly), and there is no SSH, SFTP or credential access configured on this machine.

Read-only probes prove that live rules exist which are **not represented in Git**:

| Probe | Result | Inference |
|---|---|---|
| `/favicon.svg` | `cache-control: max-age=31536000` **and an `Expires` header** | `mod_expires` is active at the origin. The pre-Sprint-13 `public/.htaccess` has no `Expires` block, so this is SiteGround-managed. |
| `/sitemap.xml` | `max-age=15552000` (180 days) | A **different** TTL from the assets, which is the signature of an `ExpiresByType` block rather than a single CDN-wide setting. |
| `/.git/config` → `403` while `/package.json` → `404` | Different status codes | Something explicitly blocks `.git`, and it is not in `public/.htaccess`. |
| `http://` → `https://`, `www` → apex | Both 301 | Origin or Cloudflare; cannot be attributed without reading the file. |

**Two behaviour changes to expect once the merge is done**, both improvements but both worth naming:

- `/sitemap.xml` moves from a 180-day browser cache to `max-age=0, must-revalidate`. A sitemap cached for six months is actively harmful.
- HTML gains `Cache-Control: public, max-age=0, must-revalidate`; it currently has none.

Note also that Cloudflare already serves `content-encoding: br`, so the origin-side compression directives are largely redundant behind the CDN — correct for direct-origin requests, but do not expect a visible change.

**Do not overwrite the live file.** §M5 has the exact merge procedure.

### A3. The existing architecture is good, and was extended rather than replaced

The first-touch/latest-touch attribution store, the rep-code capture, the Cal.com link enrichment, the shared assessment event family, the `booking_click_*` discipline, and the `/booking-confirmed/` UID-gated conversion are all well-built and well-commented. No part of them was rewritten. The paid-social funnel system (`src/lib/funnels/`, three VSL pages) was likewise left intact — see §C3 for why the cold-email pages got their own registry rather than joining it.

---

## B. What changed

### New files

| Path | What it is |
|---|---|
| `src/pages/go/law-firms/index.astro` | Cold-email landing route (3 lines) |
| `src/pages/go/roofing/index.astro` | Cold-email landing route (3 lines) |
| `src/data/outbound/law-firms.ts` | Law-firm page content |
| `src/data/outbound/roofing.ts` | Roofing page content |
| `src/data/outbound/index.ts` | Outbound registry |
| `src/lib/outbound/types.ts` | Typed config contract |
| `src/lib/outbound/analytics.ts` | Pure event builders |
| `src/components/outbound/OutboundPage.astro` | The six-section page |
| `src/components/outbound/OutboundAnalytics.astro` | The page's single analytics source |
| `src/layouts/OutboundLayout.astro` | BaseLayout + minimal chrome |
| `src/components/BreadcrumbSchema.astro` | Shared BreadcrumbList JSON-LD |
| `src/content/resources/what-is-ai-conversion-tracking.mdx` | New resource |
| `public/og-default.png` | Default social sharing image, 1200×630 |
| `tools/generate-og-image.py` | Reproducible recipe for the above |
| `docs/analytics/conversion-event-taxonomy.md` | The GA4/GTM handoff document |
| `docs/analytics/smartlead-experiment-plan.md` | The reply-first / call-first test |
| `docs/sprints/sprint13-outbound-conversion-seo.md` | This file |
| `tests/outboundLanding.test.ts` | 45 tests |
| `tests/seoContent.test.ts` | 50 tests |

### Edited files

| Path | Change |
|---|---|
| `src/components/AnalyticsEvents.astro` | `pushEvent` now applies `withCampaign` at the choke point |
| `src/lib/bookingConfirmation.ts` | `buildBookingConfirmedEvent` takes an optional campaign snapshot |
| `src/pages/booking-confirmed/index.astro` | Passes campaign; dedupe moved to `localStorage`; "what happens next" content added |
| `src/lib/funnels/types.ts` | `CtaType` gains `'assessment'`; `CtaLocation` gains `'mid'` |
| `src/components/SEO.astro` | Default absolute `og:image` + dimensions + alt |
| `src/lib/site.ts` | `SITE.defaultSocialImage`; anchor text "AI CRM Integration" |
| `src/pages/ai-crm-integration/index.astro` | Title/H1 realignment + four new sections + FAQ entries |
| `src/pages/conversion-tracking-analytics/index.astro` | One "Where AI fits" section + resource links |
| `src/content/resources/ai-for-logistics-document-processing-and-back-office-automation.mdx` | Rewritten and deepened; URL unchanged |
| `src/pages/resources/index.astro` | New resource categorised |
| `src/pages/industries/*/index.astro` (28) | Converted to `BreadcrumbSchema`; 9 gained schema they never had |
| `src/pages/industries/{hvac,law-firms,roofing}/index.astro` | Deepened from ~98-line stubs |
| `public/sitemap.xml` | One new URL |
| `public/.htaccess` | 301 for the retired audit route; compression; cache policy |
| `tests/seoQuality.test.ts` | Two new noindex routes registered |
| `tests/attribution.test.ts` | New booking-attribution and dedupe tests |
| `tests/repAttributionAndFormPreservation.test.ts` | Two assertions updated to the new signatures |
| `tests/paidSocialFunnels.test.ts` | One false-positive assertion tightened (see §Q2) |

---

## C. Conversion funnel architecture

### C1. What changed for cold outbound

```
BEFORE   Smartlead email -> /free-ai-assessment/ -> 15 questions -> contact gate -> score -> (maybe) call
AFTER    Smartlead email -> /go/{vertical}/     -> book a free 30-minute AI Strategy Call
                                                 \-> (secondary) /free-ai-assessment/
```

A free assessment is a good offer for someone arriving from search already thinking about the problem. It is the wrong first ask for someone interrupted at work by an email from a stranger: fifteen questions before any human has spoken to them, with the effort entirely on the side of the person who did not ask to be contacted.

**The assessment is not retired, and nothing about it changed.** It remains `PRIMARY_CTA` site-wide, which is correct for organic and paid-search traffic. Only the cold-outbound destination moved.

### C2. The pages

Six sections, in the order a cold reader needs: hero → the chain a lead travels → six places it leaks → what this is *not* → what the call actually contains, with objections → close. CTA at four placements plus a mobile sticky bar; the assessment appears exactly once, in the hero, as a quiet text link after the primary button.

`noindex, follow`, and excluded from `sitemap.xml`. They overlap `/industries/law-firms/` and `/industries/roofing/` by design — same audience, different job — and two of our own pages competing for one query helps nobody. "follow" rather than "nofollow" so their internal links still pass equity. No indexable page links into `/go/`; a test enforces that.

No price. Not because pricing is secret — `/comprehensive-ai-business-audit/` publishes its price — but because no price has been approved for cold outbound and scope has not been established with a stranger.

### C3. Why a separate registry from the paid-social funnels

`FunnelConfig` requires an `offer` with price lines, and `tests/paidSocialFunnels.test.ts` enforces that contract on every member of `FUNNELS` (~30 assertions dereference `f.offer`). Adding a price-less page to that registry would mean either weakening those tests or writing a hollow offer section.

The cold-email pages therefore have their own lean contract and registry, while **reusing** `FunnelCTA.astro`, `FunnelStickyCta.astro`, `FunnelStyles.astro`, `FunnelCta`/`CtaLocation`/`CtaType`/`IconItem`, `BaseLayout` with `chrome="minimal"`, `AttributionCapture`, `AnalyticsEvents`, and the shared attribution and rep-code modules. There is no second document shell, no second CTA component, no second stylesheet, and no second tracking system.

---

## D. Analytics event taxonomy

**The full contract is `docs/analytics/conversion-event-taxonomy.md`.** It is the document to hand to whoever configures GA4. Summary of what changed:

### D1. `call_booked` is `booking_confirmed`

The brief names the real booked-call conversion `call_booked`. This site emits it as `booking_confirmed`, and no second name was added. `booking_confirmed` was already implemented, already documented in `brain/TRACKING.md`, and already in the GTM work in flight. A second name would either double-count every booking (if both fire) or split the history (if one replaces the other).

### D2. Campaign attribution now reaches the conversions that matter

`withCampaign()` was applied only at the assessment-start call site, so every `booking_click_*` — the closest micro-conversion to revenue — reached GA4 with no campaign of its own. It now applies at `pushEvent`, the single choke point, so an event added to that tracker later cannot ship without it.

`booking_confirmed` had none at all, and structurally could not: the visitor leaves for cal.com and returns on a URL Cal.com constructs, so the acquisition query string is gone and the referrer is cal.com. It now restores the six UTM fields from the first-party store. Without that, the only real conversion on the site was the one event that could not say which campaign paid for it.

Both use the same fixed six-field allowlist as the assessment events, so a field added to the attribution record later cannot start flowing into analytics without a deliberate change.

### D3. Duplicate bookings across sessions

The seen-UID list moved from `sessionStorage` to `localStorage`, same key. The rule is "one booking UID counts once", and a UID outlives a session: bookmark the confirmation URL, reopen it from the Cal.com email tomorrow, restore the tab after a restart — `sessionStorage` has forgotten it while the booking is still the same booking. A different UID still fires, because the gate is the UID and never the session.

### D4. Three new diagnostic events

`cold_lp_view`, `cold_lp_engaged`, `outbound_cta_click`. All diagnostics. None may be a Key Event. §E2 explains what `cold_lp_view` is for.

### D5. `qualified_lead` is prepared and deliberately absent

No code emits it. A qualified lead is a judgement made after a conversation — real business, real problem, budget, authority. A website cannot observe any of that, and a client-side event with that name would be a page view wearing a suit.

The honest path, when it is wanted: the CRM is the system of record; `ai_assessment_lead_submit` already emits a non-PII `lead_id` that reaches the lead email as the join key; when a lead is marked qualified in the CRM, send the conversion **server-side** via GA4 Measurement Protocol or a Google Ads offline import keyed on the stored `gclid`/`gbraid`/`wbraid`. That import — not a browser event — is what may be marked a Key Event.

---

## E. Smartlead UTM standard

Full templates in `docs/analytics/smartlead-campaign-links.md` §4a. §L below carries the copy-paste URLs.

### E1. The attribution epochs, and what can honestly be said about the cutover

The brief is right that historical "Direct" traffic in GA4 is contaminated by untagged Smartlead clicks, and that the two epochs must not be compared.

**Repository evidence, which is all that exists here:**

- **2026-08-31, commit `64adcc1`** — the first and only commit that introduces `utm_id` capture, `getCampaignAttribution()`, the GA4 campaign enrichment on assessment events, `docs/analytics/smartlead-campaign-links.md`, and the `/assessment/` → `/free-ai-assessment/` 301. Before this commit the repository contains no Smartlead campaign convention at all.
- **The send identifiers that document names** — `sl_roofing_20260820` and `sl_law_firms_20260820` — assert 2026-08-20, and the campaign values are suffixed `202608`.
- The owner's recollection places the change roughly one week before 2026-09-08, i.e. around 2026-09-01, which is consistent with the commit date.

**The exact date cannot be proven from this repository, and is not asserted anywhere.** The honest statement is that the cutover falls between **2026-08-20 and 2026-08-31**, that the site-side handling was committed on 2026-08-31, and that the authoritative answer is in the Smartlead campaign dashboard — the date the tagged link replaced the untagged one in each sequence.

Note also that until 2026-08-31 the roofing sequence pointed at `/assessment/`, a route that has never existed. **Those clicks reached a 404.** That alone is a sufficient explanation for zero replies from that sequence, and it is a reason not to reach for the bot hypothesis first.

**Reading rule:**

- **Before the cutover** — Direct is contaminated. Do not attribute it, do not model it, do not retroactively assign it to Smartlead.
- **After the cutover** — use explicit UTM data. This is the only period in which Smartlead landing sessions, engagement, booking clicks and bookings can be compared.

### E2. The click-quality diagnostic

Roofing reported ~227 clicks against ~230 opens with zero replies. That is not a plausible human click rate on cold outbound, and security appliances, corporate link scanners and privacy proxies all fetch URLs found in email.

**This is a hypothesis and is written down nowhere as a finding.** We cannot inspect Smartlead's counter and must not assert what it counts. What we can do is measure the far side of the click:

```
Smartlead clicks    a URL was fetched, by something
cold_lp_view        a browser rendered the page and ran JavaScript
cold_lp_engaged     that browser then stayed 15s visible, or interacted
```

`227 / 12 / 3` and `227 / 210 / 180` are completely different worlds, and today we cannot tell them apart at all. Neither event proves a human — a determined headless scanner runs JavaScript. They narrow it enough to decide what to change next.

### E3. Convention changes, and why

Two deliberate departures from the §2 convention in the links document:

- **`utm_campaign` drops the `_{yyyymm}` suffix** and is now exactly the site's own `campaignId`, so a GA4 report grouped by `campaign_id` and one grouped by `utm_campaign` line up without a lookup table. Separating two runs is `utm_id`'s job, which §2 already said.
- **`utm_content` carries the vertical** (`law_e1_a`, not `step_1`). With two sequences running at once, a report grouped by `utm_content` alone shows one `step_1` row containing both.

`tests/outboundLanding.test.ts` checks the documented URLs against the page configuration, so the document and the code cannot drift apart.

---

## F. Smartlead experiment structure

Full design in `docs/analytics/smartlead-experiment-plan.md`. In brief:

- **Arm A (control) — reply-first.** Email #1 carries no link. The ask is a reply. This is the control precisely because a reply cannot be produced by a link scanner.
- **Arm B (challenger) — call-first.** Email #1 links to the vertical's `/go/` page, which asks for the call.
- Split **within** each vertical, randomised, same window and sender state.
- Compare replies, `cold_lp_view`, `cold_lp_engaged`, `outbound_cta_click` and `booking_confirmed` — **not** raw Smartlead click percentage.

**Honest statistics.** At ~600–800 sends per sequence, this will not reach significance on bookings and will likely produce zero or single-digit bookings per arm. It *can* answer whether a link-free email produces replies where a linked one produced zero, and whether Smartlead's click count reflects browsers. It *cannot* declare a winner on booked calls. The plan says so explicitly, and the decision rule is based on the diagnostic, not on bookings.

**Not programmed.** This repository has no Smartlead credentials or API integration. The sequences are a specification for a person to configure.

---

## G. SEO keyword and page map

| Query family | Page | Position seen | Action |
|---|---|---|---|
| ai crm integration / …services / ai crm configuration | `/ai-crm-integration/` | ~70s, ~88 impressions | Realigned + 4 sections |
| ai chatbot crm integrate | `/ai-crm-integration/` | ~70s, ~23 impressions | Own section |
| ai document processing in logistics | `/resources/ai-for-logistics-document-processing-and-back-office-automation/` | **~18.75** | Rewritten, URL unchanged |
| ai conversion tracking | `/resources/what-is-ai-conversion-tracking/` (new) | ~47 on the service page | New supporting resource |
| ai csr for hvac companies | `/industries/hvac/` | sparse | Own section on a deepened page |
| ai answering service for garage door companies | `/industries/garage-door-companies/` | sparse | **No change** — page already substantial and on-intent |
| ai automation for pest control | `/industries/pest-control/` | sparse | **No change** — same |
| ai for financial services | `/industries/financial-services/` | sparse | **No change** — page plus three resources already cover it |

**No thin page was created for a one-impression query.** One new resource exists, for the only query family with no honest home anywhere on the site.

---

## H. Search Console signals used

Everything in §G came from the owner's Search Console screenshots for the observed period. They are recorded here as approximate because that is what they are. No projection, no traffic estimate, and no claim about what any of them will become has been written anywhere in the repository.

---

## I. New pages and resources

| Route | Indexable | In sitemap |
|---|---|---|
| `/go/law-firms/` | No — `noindex, follow` | No |
| `/go/roofing/` | No — `noindex, follow` | No |
| `/resources/what-is-ai-conversion-tracking/` | Yes | Yes |

---

## J. Existing pages improved

- `/ai-crm-integration/` — title and H1 name the service; new sections on chatbot-to-CRM, connection methods, CRM prerequisites, and illustrative examples; five FAQ entries. All prior content kept.
- `/resources/ai-for-logistics-document-processing-and-back-office-automation/` — expanded from ~400 words to a full treatment. **Slug unchanged**, because the position belongs to the path.
- `/conversion-tracking-analytics/` — one section and resource links. **Not specialised** toward the query; a strong page was not narrowed to chase one term.
- `/industries/hvac/`, `/industries/law-firms/`, `/industries/roofing/` — from ~98-line stubs to full pages with FAQ, fit/not-fit, breadcrumb schema and cluster links.
- All 28 industry pages — breadcrumb schema via a shared component.
- `/booking-confirmed/` — now tells the customer what happens next.

---

## K. Internal linking

Added, all as sentences a human would follow rather than link blocks:

- **CRM cluster** — `/ai-crm-integration/` → `/crm-setup-automation/`, `/ai-agent-development/`, `/ai-implementation/`, `/conversion-tracking-analytics/`, and three resources.
- **Conversion cluster** — service ⇄ new resource, plus speed-to-lead and Google Ads resources.
- **Logistics cluster** — resource → `/industries/logistics-transportation/`, `/ai-implementation/`, `/ai-crm-integration/`; industry page already linked back.
- **Industry clusters** — HVAC, law firms and roofing each now link to AI agent development, AI CRM integration, conversion tracking, and three relevant resources.

Nothing links into `/go/`. A test enforces it: campaign pages are reached from email, never from site navigation.

---

## L. Exact URLs for Smartlead

Replace `20260909` with the date the sequence actually starts sending.

**Law firms**

```
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e1_a
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e1_b
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e2_a
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e3_a
```

**Roofing**

```
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e1_a
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e1_b
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e2_a
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e3_a
```

**These URLs 404 until this branch is deployed.** Verify a 200 with the full query string before a sequence sends.

Never put a prospect identifier in a URL — no `{{email}}`, no `{{first_name}}`, no per-recipient hash. UTM values reach GA4, referrer headers and browser history.

---

## M. External configuration still required

### M1. Cal.com — blocking `booking_confirmed`

**Until this is done, `booking_confirmed` will never fire, and the site has no booked-call conversion.**

For each event type, set "Redirect on booking":

| Cal.com event | Redirect URL |
|---|---|
| AI Strategy Call | `https://youraidepartment.ai/booking-confirmed/?booking_type=strategy` |
| Enterprise Engagement Discussion | `…?booking_type=enterprise` |
| AI Training Consultation | `…?booking_type=training` |
| Executive AI Advisory Session | `…?booking_type=executive_advisory` |
| Comprehensive AI Business Audit | `…?booking_type=comprehensive_audit` |

Also enable forwarding of booking parameters on redirect, so the booking UID arrives in the query string. The page checks `bookingUid`, `uid`, `booking_uid` and `bookingId` defensively, but **which one actually arrives has never been verified against production.** One real test booking settles it. Full procedure in `docs/analytics/conversion-event-taxonomy.md` §8.

### M2. GA4 / GTM

Website work is complete; none of the below needs a code change. Full lists in the taxonomy document §7.

- Custom Event triggers for `cold_lp_view`, `cold_lp_engaged`, `outbound_cta_click`, plus the three already-missing ones (`ai_assessment_lead_submit`, `booking_click_comprehensive_audit`, `booking_confirmed`).
- Data Layer Variables for the new parameters.
- GA4 Event tags forwarding only the listed parameters.
- **Add the six `utm_*` parameters to the existing booking-click tags** — they are now on the dataLayer and were not before.
- Event-scoped custom dimensions: `audience`, `campaign_id`, `cta_type`, `engagement_signal`, `score_band`, `booking_type`, `rep_code`.
- Key Events exactly as §6 of the taxonomy recommends. If the Key Event count falls, that is the correct outcome.

### M3. Deployment

Static output. Upload the contents of `dist/` to the SiteGround web root. Node ≥22.12.0 to build; no runtime required.

**`.htaccess` is the exception: do NOT upload `dist/.htaccess` as-is.** Complete §M5 first.

### M4. Search Console

After deploy: submit `sitemap.xml`, and request indexing for `/ai-crm-integration/`, the logistics resource, and `/resources/what-is-ai-conversion-tracking/`. **Do not** submit the `/go/` routes.

### M5. The `.htaccess` merge — the one blocking manual step

Nothing else in this sprint requires a manual file merge. This does, because the live file contains rules that exist nowhere in Git (§A2b), and `dist/.htaccess` would replace it wholesale.

**Step 1 — obtain the live file.** In SiteGround Site Tools → **File Manager** (or over SFTP/SSH), download the `.htaccess` in the **document root** of `youraidepartment.ai` — the directory that contains `index.html`, `favicon.svg` and `sitemap.xml`. On SiteGround this is normally:

```
~/www/youraidepartment.ai/public_html/.htaccess
```

Take a timestamped copy before touching anything:

```
cp .htaccess .htaccess.pre-sprint13-$(date +%Y%m%d)
```

**Step 2 — classify every block in it.** Expect three categories:

| Category | What to do |
|---|---|
| **A — in both** | `ErrorDocument 404 /404.html` and the `^assessment/?$` → `/free-ai-assessment/` `[R=301,QSA,L]` rule. Keep once; they are identical. |
| **B — live only** | Anything SiteGround wrote: SG Optimizer blocks, `ExpiresByType` / `ExpiresActive`, `mod_pagespeed`, PHP handler (`AddHandler`/`SetHandler`, `php_value`), HTTPS or www canonicalisation, `.git`/dotfile denials, `Options -Indexes`. **Keep all of it.** These are the rules this sprint must not destroy. |
| **C — Git only** | The new Sprint 13 additions: the `^ai-department-audit/?$` 301, the `mod_deflate`/`mod_brotli` blocks, and the `mod_expires` + `mod_headers` cache policy. **Add these.** |

**Step 3 — resolve the one real conflict.** If the live file has its own `ExpiresByType` / cache block (the probes say it almost certainly does), the two cache policies overlap. The Sprint 13 policy is the correct one and should win, because it is the only one that distinguishes content-hashed immutable assets from HTML and XML. Replace the live cache block rather than stacking both — two `ExpiresByType` blocks for the same MIME type is ambiguous and the result depends on load order.

Keep everything else from category B untouched.

**Step 4 — order matters.** Put SiteGround's PHP-handler and canonicalisation directives first, then the redirects, then compression, then caching, then `ErrorDocument`. `RewriteRule` evaluation is order-sensitive; `ExpiresByType` and `Header set` are not.

**Step 5 — verify immediately after upload**, and be ready to restore the `.pre-sprint13` copy:

```
curl -sI 'https://youraidepartment.ai/assessment/?utm_id=probe'   # 301, query preserved
curl -sI  https://youraidepartment.ai/ai-department-audit/         # 301 (was 200 + meta refresh)
curl -sI  https://youraidepartment.ai/zzz-no-such-page/            # 404, branded page
curl -sI  https://youraidepartment.ai/sitemap.xml                  # max-age=0, must-revalidate
curl -sI  https://youraidepartment.ai/                             # 200
curl -sI  https://youraidepartment.ai/.git/config                  # still 403
```

If any of those regress, restore the backup copy first and diagnose second. A broken `.htaccess` can take the whole site down; every directive in `public/.htaccess` is `<IfModule>`-guarded so a missing module is a no-op, but a syntax error is not.

---

## N. Validation and test results

```
npm run build          128 pages, clean
npx astro check        0 errors, 0 warnings, 7 hints (pre-existing)
node --experimental-strip-types --test tests/*.test.ts
                       514 tests, 514 pass, 0 fail
```

There is no `test` script in `package.json`; the suites are run per-file as above, which is what their own headers document.

95 tests were added. Highlights of what they hold:

- Campaign attribution survives to `booking_confirmed`, and the allowlist rejects a contaminated record.
- A booking UID cannot be counted twice, across sessions.
- No outbound event is or resembles a booking.
- No PII-shaped key can reach any payload.
- The `/go/` pages are noindex, absent from the sitemap, unlinked from any indexable page, and carry no price, no fabricated statistic and no staff-replacement framing.
- The documented Smartlead URLs match the page configuration.
- All 28 industry pages emit correct breadcrumb schema from the shared component.
- `og:image` is absolute, exists in the build, and matches its declared dimensions.
- Every `.htaccess` directive is `IfModule`-guarded and every redirect carries `QSA`.

**Not verifiable here, and not claimed:** anything requiring a browser or a live service. Cal.com's actual UID parameter, GTM tag firing, GA4 DebugView, real Core Web Vitals, and whether Smartlead's click count reflects browsers all need production.

---

## O. Manual QA the owner should still do

1. Open `/go/law-firms/` with a full tagged URL on a phone. Confirm the CTA is reachable without scrolling far, and that the sticky bar appears mid-page and disappears at the close.
2. GTM Preview on the same URL: one `cold_lp_view` carrying the UTM fields; one `cold_lp_engaged` after scrolling; one `outbound_cta_click` plus one `booking_click_strategy` on the CTA.
3. Click through to Cal.com and confirm the UTM parameters are on the URL that opens.
4. Complete a real test booking and follow §M1's six-step verification.
5. Share a page URL into Slack or LinkedIn and confirm the card renders the image.

---

## P. Rollback

Every commit is independent and revertable.

| Concern | Rollback |
|---|---|
| Campaign params on events | `git revert 6957392` |
| The `/go/` pages | `git revert fc0209b`, or leave them and stop sending traffic — they are noindex and unlinked, so an unused `/go/` page is inert |
| CRM page realignment | `git revert fec56dd` |
| Resource work | `git revert f6e039a` |
| Breadcrumbs + industry depth | `git revert 64acc40` |
| OG image, .htaccess, cache | `git revert 400e342` |

The `.htaccess` change is the only one with a hosting-level failure mode. Every directive is `IfModule`-guarded, so a missing module is a no-op rather than a 500 — but if anything is wrong on SiteGround, restoring the previous `.htaccess` is the fastest fix.

The riskiest single change for measurement continuity is `sessionStorage` → `localStorage` for booking dedupe. It can only reduce `booking_confirmed` counts, never inflate them, and only by removing repeat counts of the same booking. If historical comparison matters more than accuracy, revert that hunk alone.

---

## Q. Open items and decisions taken

**Q1. Titles and descriptions over the SERP limits.** 82 of 118 indexable pages carry titles over 60 characters; 66 carry descriptions over 160. `docs/seo/metadata-before-after.md` records that a previous deliberate pass weighed truncation and kept this copy. **Measured, reported, not changed** — rewriting 82 titles with no query-level reason is churn against pages that already rank.

**Q2. One test assertion was tightened, not weakened.** `tests/paidSocialFunnels.test.ts` asserted that `fnl-vsl` appears nowhere in a funnel's HTML, to prove no empty video player ships. Adding two pages changed Astro's CSS chunk graph so `FunnelVSL.astro`'s scoped stylesheet is now inlined, and the string appeared inside a `<style>` block. A CSS selector for a class nothing renders is not a shipped player. The assertion now runs against markup via the file's own `stripCode()` helper — which exists for exactly this — and the three checks that would actually catch a rendered player are untouched.

**Q3. The two lineages have genuinely diverged, and this sprint did not merge them.** `feature/outbound-sales-brain` carries `brain/`, `services/`, `phone-agent/` and an older `src/`. The website lineage carries none of the brain. Merging them is a real piece of work with real risk and was out of scope here. Consequences to be aware of:

- `brain/TODO.md`, `brain/TRACKING.md` and `brain/WEBSITE.md` **do not know about this sprint.** When the lineages are reconciled, TRACK-003's list of missing GTM events should gain the three new diagnostics, and `brain/TRACKING.md` should absorb `docs/analytics/conversion-event-taxonomy.md` (or point at it).
- The `CLAUDE.md` on this branch has no "Operational Project Brain" section, so an agent working here will not be told to read `brain/`.
- **WEB-003 / INPUT-005 are in fact complete, but the brain still says otherwise.** They were resolved by `64adcc1` + `cbbdca2` on 2026-08-31/09-01 and independently confirmed by the audit in §A2a. Until the brain is corrected it will send the next person — as it sent this one — chasing a blocker that no longer exists. The correction owed to `brain/WEBSITE.md` and `brain/TODO.md` should record the **deployed commit SHA** and the **`last-modified` timestamp it was verified against**; had those two facts been written down, the entire audit would have been a two-line check.

**Q4. No Cal.com inline embed.** Investigated and rejected, with reasons, in `docs/analytics/conversion-event-taxonomy.md` §9. Briefly: it would put `/booking-confirmed/` inside an iframe and risk silently breaking the only real conversion signal; it would bypass the site's existing `<a href>` attribution enrichment and require a parallel mechanism; and it is a third-party script on a mobile-first page with a near-zero JS budget. The centralized link appears at four placements plus the sticky bar instead.

**Q5. The OG image is a first pass.** It is assembled only from things already in the repository — brand tokens, the existing YAD mark, the brand name, `SITE.tagline`. It invents no claim. It should be replaced whenever a properly designed asset exists; `tools/generate-og-image.py` is the recipe, and `SITE.defaultSocialImage` is the one place to point at a new file.

**Q6. The branch is backed up on `origin`, and nothing is merged.** `sprint13-outbound-conversion-seo` was pushed on approval and `origin/sprint13-outbound-conversion-seo` matches local `HEAD`. No merge, no PR merge, no deploy, and no change to any other branch on `origin`. The PR targets `sprint12-industry-content-expansion` — **never `main`**, which is still the 14 August site and would regress everything.

**Q7. The two lineages now have separate worktrees, so they cannot be confused.** `/home/roothecks/YAD-Sales-Brain` holds `feature/outbound-sales-brain`. The website worktree could not be renamed to `/home/roothecks/YAD-Website` in the same pass, because it is the *main* worktree and its branch is checked out there — and because three live systemd units point into it. That is sales-brain infrastructure work, tracked separately, and deliberately out of scope for website deployment.

---

## R. What to measure over the next 7 / 14 / 30 days

### Days 1–7 — instrumentation truth, not performance

Nothing here is about whether the campaign works. It is about whether the numbers mean anything.

1. Complete the Cal.com configuration (§M1) and the GA4/GTM configuration (§M2).
2. One real test booking through the full six-step verification.
3. Confirm the three diagnostics appear with UTM fields in GA4 DebugView.
4. Start a tagged sequence and watch **Smartlead clicks vs `cold_lp_view`** for the first send. This is the single highest-value number of the whole sprint and needs no volume to be readable.

**Do not judge the campaign this week.** Judge the measurement.

### Days 8–14 — the click question, answered

5. By now the click/view/engaged shape should be legible per campaign. Read it as §E2 describes and write the actual numbers into `docs/analytics/`, including a null result.
6. Compare arm A's replies against arm B's engaged sessions. Zero versus any is a real signal at this volume.
7. Watch `outbound_cta_click` by `cta_type` — do cold readers take the call or the assessment. This directly tests the sprint's central assumption.
8. Fix the ~8% sender bounce rate before scaling volume. It threatens domain reputation and will swamp any result being measured.

### Days 15–30 — outcomes, carefully

9. `booking_confirmed` by `utm_campaign`. Expect small numbers. **Do not declare a winner on bookings** at this volume; the plan says why.
10. Search Console for the three SEO targets — impressions and average position for the query families in §G. Position movement is the leading indicator; clicks lag.
11. Reconcile GA4's `booking_confirmed` count against Cal.com's actual bookings. A gap in either direction is a measurement bug worth finding while the numbers are small enough to trace by hand.
12. Report the honest state of `qualified_lead`: the CRM's number, not GA4's. If a qualified-lead conversion is wanted in GA4, §D5 is the path.

### The number that should not be reported

The GA4 Key Event count, as a proxy for sales. 114 Key Events and zero qualified leads were both true in the observed period. The work in this sprint makes that distinction legible; it does not remove the temptation to collapse it.
