# Your AI Department — Master TODO / Roadmap

**Status:** Active source of truth for execution  
**Last triaged:** 2026-08-30  
**Owner:** Michael Chanata

Task states:

- 🔴 High priority: Launch-critical work that should be selected first.
- 🟡 In progress: Work with an active owner or active execution thread.
- ⚪ Next: Queued after the high-priority launch gates.
- 🔵 Backlog: Valid future work, not part of the immediate launch path.
- 🟢 Completed: Verified against its completion gate.
- 🚧 Blocked / input needed: Cannot be completed honestly until the named dependency is resolved.

A task should appear in only one status section. Dependencies may be referenced separately under Current blockers.

## 🔴 High priority

- [ ] **WEB-001 — Complete the live CTA and funnel-routing audit.** The chooser, short assessment, $495 audit, internal long engine, and confirmation route are confirmed. Audit every navigation/button/campaign URL so no old one-assessment destination remains. **Completion gate:** every live CTA has an intentional destination and the result is documented.
- [ ] **TRACK-001 — Finish the production measurement inventory.** GTM, GA4, Google tag, and Google Ads IDs are confirmed in brain/TRACKING.md. Record account ownership/access, Meta Dataset/Pixel, consent requirements, and production/staging behavior. **Completion gate:** all non-secret IDs, owners, and consent decisions are documented.
- [ ] **TRACK-003 — Finish and verify GA4 funnel coverage through GTM.** Add the three missing live events documented in brain/TRACKING.md and inspect parameter forwarding on existing tags. **Completion gate:** the complete event sequence appears once with correct non-PII parameters in Tag Assistant, GA4 DebugView, and production.
- [ ] **TRACK-004 — Configure and verify Meta Pixel through GTM.** Map approved assessment/lead/booking actions to Meta standard or custom events. Evaluate Conversions API separately; do not claim it is implemented with browser Pixel alone. **Completion gate:** browser events are deduplicated, contain no prohibited data, and appear correctly in Meta Events Manager.
- [ ] **TRACK-005 — Finalize the vendor-neutral dataLayer contract.** The live contract is now recorded in brain/TRACKING.md. Reconcile the committed source with production, confirm parameter forwarding, and add tests for the missing conversion steps. **Completion gate:** event names, triggers, parameters, privacy rules, and automated/manual tests match production.
- [ ] **TRACK-006 — Complete attribution and consent QA before paid traffic.** Preserve UTMs and approved click IDs through the assessment and Cal.com handoff; verify privacy/consent behavior and exclude sensitive assessment answers. **Completion gate:** one documented test lead and booking can be traced without duplicate events or leaked sensitive data.
- [ ] **WEB-002 — Finish launch and funnel QA.** Verify the exact deployed commit, forms/backend, legal pages, result privacy, booking paths, mobile behavior, performance, accessibility, redirects, sitemap, and Search Console readiness. **Completion gate:** the launch checklist has evidence for every critical item.
- [ ] **MKT-002 — Define the first paid campaign and audience plan.** Decide launch vertical, geography, budget, campaign objective, retargeting, exclusions, and lawful Apollo/custom-audience usage. **Completion gate:** campaign brief is approved and measurement prerequisites are green.

## 🟡 In progress

- [ ] **WEB-003 — Synchronize GitHub with the exact production source.** Production contains newer fixes than current main and the inspected sprint12 branch. **Next action:** from the EdgeXpert/deployment workspace, commit and push the exact deployed source before any website-code overwrite.
- [ ] **ASM-001 — Reconcile canonical documents with the deployed two-path architecture.** Production now uses a free 15-question assessment and a $495 comprehensive audit backed by the internal long engine. **Next action:** update stale one-assessment and Calendly-era documents without changing the live offer.
- [ ] **ASM-002 — Preserve and validate the deterministic long-assessment engine.** The 64-question engine is present as an internal/noindex route. **Next action:** verify authorization/handoff from paid Cal.com booking, version it explicitly, and run the full test suite after source synchronization.
- [ ] **MKT-001 — Finalize the Facebook Page identity and initial Meta creative set.** The new Concept 01 was rejected; the prior #2 YAD/YAI/Y directions were recovered. **Next action:** select the recovered base, refine its Facebook-safe profile/cover pair, then build campaign graphics, hooks, copy, CTAs, and naming for the selected vertical.

## ⚪ Next

- [ ] **LEAD-001 — Confirm and document the production lead destination.** Record the actual server-side delivery/storage, notifications, spam controls, consent, retention, and deletion workflow used by the live short assessment and contact form.
- [ ] **BOOK-001 — Verify the production Cal.com booking/payment configuration.** Confirm the $495 event, payment requirement, return URL/query contract, cancellation/rescheduling policy, and booking conversion behavior.
- [ ] **SEO-001 — Finish launch SEO operations.** Verify Search Console, sitemap submission, indexing controls, canonical URLs, metadata, structured data, redirects, and production domain behavior.
- [ ] **MKT-003 — Prepare Apollo/outbound and Meta audience operations.** Document lawful data handling, list hygiene, matching fields, suppression, consent/platform-policy checks, seed/lookalike strategy, and the separation between outbound lists and ad optimization.
- [ ] **OPS-002 — Add a lightweight recurring brain-review habit.** Re-triage this file after material work, before launches, and when an execution thread rolls over.

## 🔵 Backlog

- [ ] **TRACK-007 — Evaluate Meta Conversions API.** Choose a partner, gateway, or server implementation only after the lead backend and event identifiers exist; design browser/server deduplication.
- [ ] **TRACK-008 — Implement server-verified Cal.com webhooks.** Use the signed webhook architecture documented in docs/cal-booking-webhook.md after choosing durable storage.
- [ ] **SEO-002 — Investigate Google Preferred Sources.** Use official Google documentation, separate documented behavior from social-media claims, and implement only if applicable.
- [ ] **ADBR-001 — Productionize the EdgeXpert AI creative pipeline.** Create reproducible manifests for models, prompts, audio, frames, versions, outputs, and accepted settings.
- [ ] **ADBR-002 — Resolve and document the echo/audio quality issue in generated video outputs.** Preserve before/after samples and the accepted fix.
- [ ] **PHONE-001 — Develop the SMB AI phone-agent offer and technical architecture.** Cover VoIP/forwarding, hosting, privacy, failure handling, unit economics, and recurring pricing without exposing client credentials.
- [ ] **SEO-003 — Expand industry and use-case content from measured demand.** Do not delay launch to fill empty repository placeholders.
- [ ] **PROD-001 — Explore future proprietary products.** Assessment software, client dashboard, AI phone-agent appliance, and vertical solutions remain separate validation projects.

## 🚧 Blocked / input needed

- [ ] **INPUT-001 — Meta account and Dataset/Pixel details.** The Meta Dataset/Pixel ID, account ownership, access, consent settings, and current Events Manager state are not yet recorded.
- [ ] **INPUT-003 — Lead backend and lifecycle truth.** The live assessment successfully calls a delivery adapter, but the destination, persistent storage, notification provider, retention, and deletion behavior are not recorded in the brain.
- [ ] **INPUT-004 — Cal.com dashboard configuration.** Confirm access, event/payment settings, booking-return query parameters, and whether the production redirect is configured for every relevant event.
- [ ] **INPUT-005 — Exact production source.** The deployed build contains code not present at the known GitHub heads. Source synchronization is required before safe website edits.

## 🟢 Completed

- [x] **OPS-001 — Establish the versioned shared project brain.** Added operational context, task tracking, decisions, website/marketing/assessment/EdgeXpert notes, workflows, and agent update rules on 2026-08-30.
- [x] **TRACK-002 — Implement GTM as the central browser tracking layer.** Production loads GTM-5G8Q7KKZ once through BaseLayout, with GA4 routed through the container and no duplicate hard-coded gtag install.
- [x] **TRACK-BASE-001 — Confirm production Google measurement IDs.** GTM-5G8Q7KKZ, GA4 G-GLSRPH43L4, Google tag GT-5TQWWPV2, and Google Ads AW-1839535359 were verified from the supplied workspace screenshots and production.
- [x] **ASM-ROUTE-001 — Implement the public assessment choice.** /ai-assessment/ now separates the free 15-question opportunity assessment from the $495 comprehensive business audit.
- [x] **ARCH-001 — Lock the V1 custom-coded website direction.** Astro, TypeScript, static-first output, portable SiteGround deployment, performance, SEO, and accessibility are established.
- [x] **ASM-BASE-001 — Build the first deterministic assessment implementation.** Typed question configuration, branching, scoring, opportunity flags, recommendations, results, persistence adapters, and automated tests exist.
- [x] **CONTENT-001 — Build the initial website/content foundation through Sprint 8.** Core solution/service/industry routes and launch resources exist.

## Current blockers

1. INPUT-005 must be resolved before changing the assessment/audit source without risking deployed fixes.
2. TRACK-003 is missing GTM listeners for ai_assessment_lead_submit, booking_click_comprehensive_audit, and booking_confirmed.
3. INPUT-001 is required before Meta Pixel work can be completed.
4. INPUT-003 and INPUT-004 limit durable lead/booking attribution.
5. Paid Meta traffic should not scale until TRACK-003 through TRACK-006 pass their completion gates.

## Next recommended execution order

1. WEB-003 — commit/push the exact deployed production source.
2. TRACK-003 — add the three missing GTM/GA4 event tags and run Preview/DebugView.
3. TRACK-001 and TRACK-004 — inventory and install Meta Pixel.
4. TRACK-006 and BOOK-001 — test attribution and a real Cal.com booking end to end.
5. MKT-001 and MKT-002 — select/refine the recovered Page identity, finish campaign assets, and launch the first controlled campaign.
