# Your AI Department — First AI Cold-Call Pilot Cohort Selection Specification

**Status:** Architecture authority for first controlled live pilot  
**Date:** 2026-09-03  
**Purpose:** Select a deliberately high-quality first cohort so YAD tests the Sales AI conversation/runtime rather than accidentally testing poor lead data, weak hypotheses, and telephony all at once.

---

# 1. PRINCIPLE

The first live AI outbound cohort should be **easy to understand, easy to route, and worth calling**.

Do not maximize lead count.

Do not randomly sample the entire database.

Do not select only by Module 4C score either.

Pilot selection combines:

- business fit;
- research clarity;
- contact-path quality;
- hypothesis clarity;
- evidence freshness;
- relationship safety;
- operational readiness.

Module 4C score remains unchanged and is not replaced by a new fit score.

---

# 2. PREFERRED FIRST COHORT

For the first real run, prefer a single narrow campaign context such as:

`HVAC + approved Jacksonville/St. Augustine market + advertiser-first + Tier B+ + current phone + unclaimed/no relationship conflict`

The exact vertical/market can change if another current cohort is materially cleaner.

Reason for a narrow cohort:

- similar business language;
- similar stakeholder routing;
- similar primary hypotheses;
- easier call review;
- easier to distinguish script failure from vertical mismatch;
- easier to compare calls.

The Sales AI itself remains one shared core agent.

---

# 3. REQUIRED HARD ELIGIBILITY

An Account is excluded from pilot selection if any hard gate fails:

- suppressed/DNC according to policy;
- active client conflict;
- active opportunity/meeting already owns the relationship;
- another rep/account owner conflict that disallows AI outreach;
- phone endpoint not currently usable for the campaign;
- business identity unresolved;
- wrong-business/aggregator/lead-gen false positive unresolved;
- campaign/policy eligibility not approved;
- duplicate Account/contact attempt already in flight;
- current Call Pack cannot be built safely;
- required runtime/booking/callback path unavailable.

Hard-ineligible Accounts are excluded, not merely ranked lower.

---

# 4. PILOT PREFERENCE SIGNALS

Among eligible Accounts, prefer:

## Strong business fit

- Tier A/B under canonical Module 4C;
- business model where inbound lead handling/follow-up matters;
- meaningful customer/job economics without inventing actual revenue.

## Clear current paid-demand context

Where available:

- recent paid-search/LSA/sponsored evidence;
- advertised service/market clear;
- landing page/business identity resolved.

Paid demand is useful because it gives the opener a concrete reason, not because it proves waste.

## Strong identity

- canonical domain verified;
- location/market clear;
- no franchise/corporate ambiguity for the intended problem.

## Strong contact path

Preferred order for pilot ease:

1. named relevant decision-maker + supported direct business endpoint;
2. named relevant decision-maker + verified main line/ask-for route;
3. clear target role + verified main business line.

Do not exclude every main-line prospect; gatekeeper behavior must be tested too. But avoid making the entire first cohort gatekeeper-only.

## Clear hypothesis

The Call Pack should have one obvious first workflow question.

Examples:

- after-hours lead handling;
- paid-lead speed to response;
- unsold estimate follow-up;
- CRM follow-up visibility;
- marketing-source-to-revenue attribution.

Avoid first-pilot Accounts where the system has five equally weak hypotheses.

## Fresh evidence

Prefer fresh observations required for the opener.

Do not force stale ad evidence into a current-tense cold call.

---

# 5. PILOT READINESS OBJECT

Create a separate `PilotReadiness` projection for operator selection.

This is NOT another fit score.

Fields:

- account_id;
- campaign_id;
- hard_eligible boolean;
- hard_fail_reasons[];
- yad_tier;
- module_4c_score;
- advertiser_evidence_strength;
- research_completeness;
- contact_path_class;
- decision_maker_known boolean;
- direct_phone_available boolean;
- main_line_route_available boolean;
- primary_hypothesis;
- primary_question;
- opener_context_ready boolean;
- evidence_freshness;
- callpack_ready boolean;
- callback_route_ready boolean;
- booking_route_ready boolean;
- ownership_state;
- last_outreach_at;
- operator_notes;
- recommended_for_pilot boolean;
- recommendation_reasons[].

Do not expose a fake `AI score 97` to the operator.

---

# 6. COHORT BALANCE

The first cohort should include enough variation to test important routing without becoming chaotic.

Suggested balance concept:

- majority clear decision-maker/main-line routes;
- at least a small number of realistic gatekeeper/main-line calls;
- at least a few advertiser-grounded openers;
- at least a few non-ad-specific but strong workflow hypotheses if useful;
- avoid multiple Accounts from the same parent/franchise unless intentionally testing that case.

Do not deliberately add dirty records merely for variety.

---

# 7. OPERATOR PREVIEW

Before each real call, operator should see:

```text
Company
Vertical / market
Tier / Module 4C breakdown
Why selected for pilot
Current advertiser evidence
Target person / role
Phone type + source
Primary hypothesis
Exact primary question
Fact-safe opener context
Backup hypothesis
What the AI must NOT claim
Prior contact / ownership / suppression status
```

Operator may remove an Account before launch without deleting it from inventory.

---

# 8. DO NOT OVERFIT TO FRIENDLY PROSPECTS

Pilot selection should optimize data clarity, not cherry-pick businesses known personally to Michael or known to be friendly unless the specific test is an internal/allowlisted test.

The first real cohort should still behave like cold outreach.

---

# 9. ACCOUNT SUPPLY SHORTFALL

If requested pilot cohort asks for 20 Accounts but only 8 meet the quality criteria:

Return 8 plus shortfall reasons.

Do not silently include:

- Tier C/D;
- stale contacts;
- guessed phone identities;
- unresolved franchise records;
- weak/no Call Pack;
- suppressed/relationship-conflicted Accounts.

Pilot quality is more important than round-number batch size.

---

# 10. CONTACT SOURCE TRANSPARENCY

Because prospects may ask how YAD got the number, every selected Account must have source/provenance available to the runtime in an appropriate safe summary.

Examples:

- official business website;
- public business listing;
- public first-party team/contact page;
- licensed provider assertion;
- gatekeeper/prospect supplied;
- imported internal list with source metadata.

Do not let the AI answer vaguely or invent a source.

---

# 11. RESEARCH REFRESH BEFORE CALL

For a pilot-selected Account, refresh only evidence required to safely execute the opener/contact route when stale/aging.

Do not rerun the entire expensive research stack immediately before every call if the relevant facts are fresh.

Call Pack generation should fail closed on a required stale/unknown claim rather than turn it into a fact.

---

# 12. PILOT COHORT LOCK

Once an operator starts a pilot batch:

- snapshot selected account IDs;
- snapshot Call Pack/config/behavior version per call;
- later research refresh may update canonical Account but must not silently mutate an already-active call's context;
- each new call gets a fresh immutable Call Pack at preparation time.

This preserves auditability.

---

# 13. LEARNING AFTER PILOT

Compare outcomes by:

- contact path class;
- decision-maker-known vs role-only;
- advertiser evidence;
- hypothesis family;
- opener family;
- Tier;
- data source;
- vertical/market;
- Sales AI behavior version.

Do not conclude `HVAC does not work` from one poor contact-data cohort.

---

# 14. ACCEPTANCE FIXTURES

## A — ideal advertiser

Tier A HVAC advertiser, verified website/main line, named GM, clear after-hours hypothesis.

Expected:

- recommended_for_pilot = true when all hard gates pass.

## B — great fit, wrong-number history

Expected:

- endpoint excluded;
- Account can return only after corrected usable contact path exists.

## C — Tier A, unresolved franchise ownership

Expected:

- not recommended until routing scope resolved.

## D — Tier B, current main line, target role only

Expected:

- may be included as realistic gatekeeper route.

## E — Tier A, stale ad evidence

Expected:

- refresh ad-dependent opener evidence or use fact-safe non-ad opener; never assert stale ad as current.

## F — only eight qualify for requested twenty

Expected:

- return eight + shortage explanation;
- never weaken standards silently.

---

# 15. CORE RULE

**The first live pilot should give the Sales AI the best possible chance to demonstrate its conversation quality while still being a genuine cold-call test.**
