# Your AI Department — Master TODO / Roadmap

**Status:** Active source of truth for execution  
**Last triaged:** 2026-08-30  
**Owner:** Michael Chanata

Task states:

- 🔴 **High priority:** Launch-critical work that should be selected first.
- 🟡 **In progress:** Work with an active owner or active execution thread.
- ⚪ **Next:** Queued after the high-priority launch gates.
- 🔵 **Backlog:** Valid future work, not part of the immediate launch path.
- 🟢 **Completed:** Verified against its completion gate.
- 🚧 **Blocked / input needed:** Cannot be completed honestly until the named dependency is resolved.

A task should appear in only one status section. Dependencies may be referenced separately under **Current blockers**.

## 🔴 High priority

- [ ] **ASM-001 — Lock the short/long AI Assessment architecture.** Define each assessment's purpose, audience, length, required data, result, lead-capture point, route, handoff, and CTA. **Completion gate:** approved architecture is documented and the canonical assessment/website documents no longer assume one undifferentiated assessment.
- [ ] **WEB-001 — Reconcile the website and funnels with the assessment split.** Audit navigation, buttons, copy, result pages, landing pages, and campaign URLs that currently point to /ai-assessment/. **Completion gate:** every live CTA has an intentional short, long, results, contact, or booking destination.
- [ ] **TRACK-001 — Establish the production measurement inventory.** Confirm the Google Tag Manager container, GA4 property/web stream, Meta Dataset/Pixel, domains, account owners, access, consent requirements, and whether Google Ads tracking is part of V1. **Completion gate:** non-secret IDs and ownership are recorded in approved configuration or deployment documentation.
- [ ] **TRACK-002 — Implement Google Tag Manager as the central browser tracking layer.** Add the container through one reusable Astro integration/config path; do not scatter vendor snippets across pages. **Completion gate:** GTM loads once in production and preview modes behave intentionally.
- [ ] **TRACK-003 — Configure and verify GA4 through GTM.** Include baseline page measurement and approved funnel events. **Completion gate:** events appear with correct parameters in Tag Assistant and GA4 DebugView, then in the production property.
- [ ] **TRACK-004 — Configure and verify Meta Pixel through GTM.** Map lead and assessment actions to approved Meta standard/custom events. Evaluate Conversions API separately; do not claim it is implemented with browser Pixel alone. **Completion gate:** browser events are deduplicated, contain no prohibited data, and appear correctly in Meta Events Manager.
- [ ] **TRACK-005 — Implement a vendor-neutral dataLayer event contract.** Cover funnel views, CTA clicks, short assessment start/complete, long assessment start/complete, contact submitted, qualified lead where legitimately defined, and booked call. **Completion gate:** event names, triggers, parameters, privacy rules, and tests are documented and exercised end to end.
- [ ] **TRACK-006 — Complete attribution and consent QA before paid traffic.** Preserve UTMs and approved click IDs through the assessment and lead handoff; verify privacy/consent behavior and exclude sensitive assessment answers from analytics. **Completion gate:** one documented test lead can be traced from campaign URL through conversion without duplicate events or leaked sensitive data.
- [ ] **WEB-002 — Finish launch and funnel QA.** Verify production deployment method, forms/backend, legal pages, result privacy, booking paths, mobile behavior, performance, accessibility, redirects, sitemap, and Search Console readiness. **Completion gate:** launch checklist has evidence for every critical item.
- [ ] **MKT-001 — Produce the initial Meta creative set aligned to real funnel destinations.** Create platform-ready graphics/video variants, hooks, copy, CTAs, and naming by chosen vertical. **Completion gate:** approved assets and copy are mapped to a tracked landing page and campaign objective.
- [ ] **MKT-002 — Define the first paid campaign and audience plan.** Decide launch vertical, geography, budget, campaign objective, retargeting, exclusions, and lawful Apollo/custom-audience usage. **Completion gate:** campaign brief is approved and measurement prerequisites are green.

## 🟡 In progress

- [ ] **WEB-003 — Assess the current Astro build against the actual launch state.** The repository contains a substantial static Astro website through the Aug. 14 Sprint 8 merge, but deployment status and post-build changes are not yet recorded in the shared brain. **Next action:** compare the live/staging site, main, and SiteGround deployment before editing production code.
- [ ] **ASM-002 — Preserve and validate the existing deterministic long-assessment engine.** The repo contains typed questions, branching, scoring, flags, recommendations, persistence, results, and tests. **Next action:** designate whether this implementation is the long assessment, version it explicitly, and run the full suite after the architecture decision.

## ⚪ Next

- [ ] **LEAD-001 — Select and implement the production lead destination.** Decide CRM/storage, server-side form handler, notification email, spam controls, and deletion/retention workflow.
- [ ] **BOOK-001 — Finish the approved Calendly/Stripe booking setup.** Configure event URLs, /book/ routing, paid Executive AI Advisory checkout, cancellation policy, and booking conversion tracking.
- [ ] **SEO-001 — Finish launch SEO operations.** Verify Search Console, sitemap submission, indexing controls, canonical URLs, metadata, structured data, redirect plan, and production domain behavior.
- [ ] **MKT-003 — Prepare Apollo/outbound and Meta audience operations.** Document lawful data handling, list hygiene, matching fields, suppression, consent/platform-policy checks, seed/lookalike strategy, and the separation between outbound lists and ad optimization.
- [ ] **OPS-002 — Add a lightweight recurring brain-review habit.** Re-triage this file after material work, before launches, and when an execution thread rolls over.

## 🔵 Backlog

- [ ] **TRACK-007 — Evaluate Meta Conversions API.** Choose partner, gateway, or server implementation only after the lead backend and event identifiers exist; design deduplication with browser events.
- [ ] **SEO-002 — Investigate Google Preferred Sources.** Use official Google documentation, separate documented behavior from social-media claims, and implement only if applicable to YourAIDepartment.ai.
- [ ] **ADBR-001 — Productionize the EdgeXpert AI creative pipeline.** Create reproducible manifests for models, prompts, audio, frames, versions, outputs, and accepted settings.
- [ ] **ADBR-002 — Resolve and document the echo/audio quality issue in generated video outputs.** Preserve before/after samples and the accepted fix.
- [ ] **PHONE-001 — Develop the SMB AI phone-agent offer and technical architecture.** Cover VoIP/forwarding, hosting, privacy, failure handling, unit economics, and recurring pricing without exposing client credentials.
- [ ] **SEO-003 — Expand industry and use-case content from measured demand.** Do not delay launch to fill empty repository placeholders.
- [ ] **PROD-001 — Explore future proprietary products.** Assessment software, client dashboard, AI phone-agent appliance, and vertical solutions remain separate validation projects.

## 🚧 Blocked / input needed

- [ ] **INPUT-001 — Production analytics identifiers and access.** GTM container ID, GA4 measurement/web-stream details, and Meta Dataset/Pixel ID are not present in the repository as of 2026-08-30.
- [ ] **INPUT-002 — Final short/long assessment routing choices.** Exact routes, naming, question count, lead gate, scoring, result depth, and handoff are not yet approved.
- [ ] **INPUT-003 — Lead backend and lifecycle.** CRM destination, persistent storage, email provider, SMS behavior/consent, retention, and deletion process are not yet recorded as approved.
- [ ] **INPUT-004 — Booking configuration.** Calendly is approved and Stripe is approved for the paid advisory session, but exact event URLs, embed approach, workshop pricing, and cancellation/rescheduling policy remain unresolved in the canonical docs.
- [ ] **INPUT-005 — Deployment truth.** SiteGround is the approved host, but the current live/staging deployment, credentials, release method, and deployed commit must be verified outside this repository.

## 🟢 Completed

- [x] **OPS-001 — Establish the versioned shared project brain.** Added operational context, task tracking, decisions, website/marketing/assessment/EdgeXpert notes, workflows, and agent update rules on 2026-08-30.
- [x] **ARCH-001 — Lock the V1 custom-coded website direction.** Astro, TypeScript, static-first output, portable SiteGround deployment, performance, SEO, and accessibility are established in the canonical repository documents and current code.
- [x] **ASM-BASE-001 — Build the first deterministic assessment implementation.** Typed question configuration, branching, scoring, opportunity flags, recommendations, results, persistence adapters, and automated tests exist on main. The Aug. 14 resource sprint reported 29/29 assessment tests passing; this must be re-run before relying on it for launch.
- [x] **CONTENT-001 — Build the initial website/content foundation through Sprint 8.** Core solution/service/industry routes and five launch resources exist in the Aug. 14 main history.

## Current blockers

1. ASM-001 must be settled before funnel routing and event names can be finalized.
2. INPUT-001 is required before production vendor tags can be verified.
3. INPUT-003 is required before forms, secure result delivery, CAPI, and reliable lead lifecycle attribution can be completed.
4. Paid Meta traffic should not scale until TRACK-002 through TRACK-006 pass their completion gates.

## Next recommended execution order

1. ASM-001 — approve short/long architecture.
2. WEB-001 — map every funnel and CTA to that architecture.
3. TRACK-001 and INPUT-001 — inventory accounts and IDs.
4. TRACK-002 through TRACK-005 — implement measurement.
5. LEAD-001, BOOK-001, and TRACK-006 — complete the lead/booking loop and verify attribution.
6. MKT-001 and MKT-002 — finish creatives and launch the first controlled campaign.
