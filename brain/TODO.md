# Your AI Department — Master TODO / Roadmap

**Status:** Active source of truth for execution  
**Last triaged:** 2026-09-03  
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
- [ ] **MKT-001 — Finalize the Facebook Page identity and initial Meta creative set.** The recovered Gradient Y direction is selected; the exact Facebook profile, cover, and Page copy package is prepared under `assets/social/facebook-page/`. **Next action:** upload it to Facebook, verify desktop/mobile crops, then build campaign graphics, hooks, copy, CTAs, and naming for the selected vertical.

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

## 🟢 Completed — Outbound Sales Brain / Sales Portal (2026-09-03)

- [x] **SB-T0 — EdgeXpert and repository audit.** Canonical database stood up as Docker
  PostgreSQL 16 on loopback. **Gate:** findings, blockers and structure recorded in
  docs/09-software/IMPLEMENTATION-LOG.md.
- [x] **SB-T1 — Canonical Account data foundation.** 35 tables and one search projection;
  ownership, suppression, evidence immutability and booking-confirmation invariants enforced in the
  database rather than in application code. **Gate:** all six acceptance data tests from
  rep-ownership-data-model.md §20 pass, plus the mandatory concurrency test.
- [x] **SB-T2 — Rep portal.** Overview, Find Prospects, Markets, My Prospects, Account detail,
  Follow-Ups, manager Team. **Gate:** hero workflow verified end to end; every hard-fail case
  refused server-side; 12 HTTP-level tests.
- [x] **SB-T3 — List import pipeline.** normalize → identity resolve → suppression → upsert.
  **Gate:** verified against a messy synthetic list; an imported row merged into an
  already-discovered Account rather than forking it. Real lists still needed (blocker B-2).
- [x] **SB-T4 — PUBLIC_ONLY decision-maker resolver.** Stage A first-party research, no Apollo.
  **Gate:** all 13 canonical fixtures pass with every hard_fail_if asserted; live crawl resolves
  Operations ahead of Owner for an after-hours hypothesis.
- [x] **SB-T5 — Market Miner inventory connection.** Refresh runs today; discovery is an adapter
  interface gated on credential *and* governance review. **Gate:** cached ZIP search returns in
  under 500 ms; Research More is idempotent.
- [x] **SB-T6 — Secure internal deployment.** systemd user services with linger, verified backup
  and restore, 19-check preflight. **Gate:** cold stop of both services and the database recovered
  with ownership, suppressions and follow-ups intact. HTTPS hostname still blocked (B-4).
- [x] **SB-T7 — Strategy-call booking.** Provider-neutral with a Microsoft Graph adapter.
  **Gate:** a booking cannot be spoken as confirmed without a provider event id — enforced in code,
  in the schema, and in 21 tests. Real calendar blocked on B-1.
- [x] **SB-T8 — Cold-call brain.** Built from Module 4A doctrine; orchestration owns terminal and
  safety transitions. **Gate:** all five transition tests from the state machine spec pass; six
  roleplay scenarios run as text. No dialling.
- [x] **SB-EMAIL — Smartlead preparation.** Canonical email state, eligibility gate, reply
  classification and idempotent event ingestion. **Gate:** spec §20 acceptance tests pass. No email
  sent; provider credential still needed (B-5).

## 🚧 Blocked — Outbound Sales Brain (needs Michael)

- [ ] **SB-B1 — Azure app registration** for michael@youraidepartment.ai: tenant ID, client ID,
  client secret, `Calendars.ReadWrite` *application* permission with admin consent. Blocks real
  calendar booking. Everything else in that path is built and tested.
- [ ] **SB-B2 — The real YAD prospect lists.** Jacksonville / St. Augustine, prior CSVs, the
  Airtable export, any Apollo exports. None are on the EdgeXpert. Drop them anywhere on the box and
  run `npm run import -- --file <csv> --source <name> --dry-run` first.
- [ ] **SB-B3 — Source governance sign-off + a search provider** for resolver stages B–D and for
  new-business discovery. Stage A carries the resolver without it.
- [ ] **SB-B4 — HTTPS for sales.youraidepartment.ai.** Two one-liners: enable HTTPS certificates in
  the Tailscale admin console, and `sudo tailscale set --operator=$USER`. See
  docs/09-software/SALES-PORTAL-RUNBOOK.md §3 for the option that works today without either.
- [ ] **SB-B5 — Smartlead API key and webhook secret.**
- [ ] **SB-PILOT — Controlled outbound pilot approval.** Not authorized. Requires explicit approval
  plus the compliance gates in CLAUDE-CURRENT-TASK.md §5. `OUTBOUND_DIAL_ENABLED` and
  `OUTBOUND_EMAIL_ENABLED` are both false and `preflight.sh` fails if either changes.

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
5. MKT-001 and MKT-002 — upload and verify the selected Page identity, finish campaign assets, and launch the first controlled campaign.
