# Your AI Department — Market Miner Refresh Orchestrator

**Status:** Architecture authority  
**Purpose:** Keep prospect research current without re-crawling/re-buying every data source before every outreach attempt.  
**Implementation owner:** Claude Code

---

# 1. PROBLEM

Prospect data ages at different speeds.

Examples:

- a current Google ad can disappear tomorrow;
- a landing-page offer may change this week;
- a decision-maker may change this quarter;
- a business address may remain stable for years;
- a DNC decision must be checked immediately before contact.

A good system therefore refreshes by **claim type and business importance**, not by blindly rerunning every adapter.

---

# 2. REFRESH OBJECT

`RefreshPlan`

- account_id
- campaign_id optional
- reason
- generated_at
- required_before
- claim_groups[]
- source_adapters[]
- expected_cost
- priority
- contact_blocking boolean
- planner_version

Reasons:

- pre_contact_refresh
- scheduled_aging
- ad_specific_hook_refresh
- prospect_correction
- website_change_detected
- decision_maker_stale
- campaign_reactivation
- compliance_preflight
- manual_request

---

# 3. CLAIM FRESHNESS CLASSES

## REALTIME / ATTEMPT-TIME

Reevaluate before each outreach attempt:

- suppression/DNC
- campaign eligibility
- contact-policy decision
- local time/calling window
- attempt limits
- number status where policy requires

## VERY FAST

Suggested initial TTL: 24–72 hours.

- active Google ad observation
- LSA observation
- current storm/hail market ad
- current Meta ad observation where used

## FAST

Suggested initial TTL: 3–14 days.

- advertised offer
- landing page CTA
- emergency/24-7 claims
- financing promotion
- campaign-specific service page
- hiring/growth signal

## MEDIUM

Suggested initial TTL: 14–45 days.

- website technology signals
- CRM/frontend signals
- leadership/team page
- locations/service area
- contact roles

## SLOW

Suggested initial TTL: 30–180 days depending source.

- legal business identity
- license/public-registry record
- long-lived company category
- parent/franchise relationship

These are defaults to test, not legal truth.

---

# 4. CONTACT-BLOCKING VS NON-BLOCKING STALENESS

Not all stale research should remove a prospect from a human queue.

## Contact-blocking example

Call Pack opener says:

> “I noticed you're actively advertising emergency AC today...”

but ad evidence is stale.

Action:

- refresh ad evidence before using that opener;
- if refresh unavailable, switch to a non-ad-specific hook rather than claim current advertising.

## Non-blocking example

Company team page is 40 days old but role target remains plausible.

Action:

- may queue with role confidence marked stale/likely depending campaign policy;
- do not claim the named person is current without appropriate confidence.

---

# 5. MINIMUM REFRESH PRINCIPLE

Refresh only what is needed to support the next decision.

Example Tier A HVAC account:

- website crawl from 5 days ago: fresh enough;
- Google ad observation from 4 days ago: stale for current-ad opener;
- operations director found 20 days ago: still within policy;

Pre-contact refresh should rerun Google-ad evidence, not recrawl the entire site and rebuy the contact record.

---

# 6. DEPENDENCY GRAPH

Claims may depend on other claims.

Example:

`primary_hook = paid_after_hours`

depends on:

- target service classification
- current ad evidence
- after-hours/emergency evidence OR a question framed without assuming it

If current ad evidence expires:

- hook loses `safe_to_state_current_ad` permission;
- strategy may remain viable as a question without the ad reference.

The Call Pack should know its evidence dependencies.

---

# 7. REFRESH PRIORITY

Suggested order:

1. contact-blocking compliance/suppression
2. evidence directly used in opener
3. evidence responsible for Tier A/B score
4. decision-maker/contact data
5. high-value opportunity hypothesis evidence
6. secondary research context

---

# 8. TRIGGER-BASED REFRESH

Refresh events may be triggered by:

- prospect says current research is wrong;
- website fingerprint changed materially;
- domain redirects to a different entity;
- returned email / disconnected phone;
- decision-maker no longer employed;
- new paid-ad observation for previously organic account;
- campaign restarts after long pause;
- target market changes due storm/event;
- manual rep correction.

---

# 9. WEBSITE CHANGE FINGERPRINT

Store lightweight fingerprints for researched pages:

- final URL
- title
- relevant structured extraction hash
- key CTA/service/technology signature hash
- fetched_at

Do not use raw whole-page byte changes as the only trigger; sites change tracking IDs/layout constantly.

Material change examples:

- new phone/CTA
- new service
- removed 24/7
- new financing offer
- CRM/booking provider change
- location count change

---

# 10. ADVERTISEMENT REFRESH

For a prospect whose priority is driven by current paid demand:

- refresh the specific query/service/geography evidence supporting the hook;
- if unavailable, search a small approved related query set;
- do not run the entire territory mining matrix for one pre-call refresh.

Output:

- current confirmed
- no current observation found -> `UNKNOWN_CURRENT`, not automatically “stopped ads”
- conflicted/provider failure

---

# 11. CONTACT REFRESH

When contact data is stale:

- first check current first-party leadership/team pages where inexpensive;
- then licensed enrichment if needed;
- preserve prior contact as historical relationship;
- do not erase prior conversations when employee leaves.

---

# 12. SCORE SNAPSHOTS

Never mutate historical score snapshots in place.

If fresh evidence changes the score:

- create new ScoreSnapshot;
- link previous score;
- record changed evidence;
- recalculate tier;
- update current queue state.

This keeps later analytics reproducible.

---

# 13. CALL PACK REFRESH

A Call Pack should be regenerated when any of these materially changes:

- active vertical context
- primary hypothesis evidence
- score/tier
- decision-maker target
- current commercial truth
- relevant Sales Manual version
- compliance/tool availability

Minor website changes do not require a new Call Pack unless they affect a claim or strategy.

---

# 14. REFRESH BUDGET

Track:

- refresh tasks
- provider cost
- prospects refreshed
- score changes
- queue promotions/demotions
- material research corrections prevented

Useful metric:

`refresh_cost_per_contact_ready_prospect`

and later:

`refresh_cost_per_prevented_material_error` where review labels allow it.

---

# 15. STALE INVENTORY MANAGEMENT

Ready inventory should distinguish:

- READY_FRESH
- READY_NEEDS_LIGHT_REFRESH
- BLOCKED_STALE_HOOK
- BLOCKED_STALE_CONTACT
- BLOCKED_COMPLIANCE
- REFRESHING

A campaign should not count blocked stale prospects toward true ready high-water inventory.

---

# 16. REACTIVATION OF OLD ACCOUNTS

When a campaign returns to a market months later:

Do not start from zero.

Reuse:

- Account identity
- historical source observations
- previous contacts
- DNC/suppression
- prior CRM outcomes
- historical vertical assignments

Refresh:

- current ads
- website/service/offer
- contacts
- current systems/signals
- current score
- current hypothesis

This turns the prospect database into a compounding asset.

---

# 17. EVENT-DRIVEN HAIL SPECIAL CASE

Hail/PDR research can age unusually fast.

A market page/ad tied to a specific storm may be relevant for days/weeks, not months.

Store:

- storm/event identifier if known
- market
- first/last observed
- active-event context
- operator location context

Do not use last year's hail-market evidence as current-market language.

---

# 18. LAW SPECIAL CASE

Practice-area advertising must be refreshed at the practice-area level.

A firm may stop divorce ads and start PI ads.

The profile remains Law; ad-specific opener context changes.

---

# 19. FAILURE BEHAVIOR

Provider refresh failure:

- preserve previous evidence as stale history;
- mark refresh incomplete;
- remove permission for current-tense claim where required;
- use safe generic question or defer contact according to campaign rules.

Never promote stale evidence to current because a provider is down.

---

# 20. ACCEPTANCE TESTS

1. Current Google ad expires before call -> ad opener blocked until refresh.
2. Refresh finds ad again -> current opener allowed with new observation.
3. Refresh finds no ad -> status unknown; generic workflow hook remains possible.
4. Website removed 24/7 -> new evidence supersedes old claim; score/hook recalculated.
5. decision-maker leaves -> contact target changes, prior history retained.
6. business changes domain -> identity review, no blind new Account.
7. old HVAC prospect re-mined 90 days later -> identity reused, research refreshed.
8. DNC old prospect re-mined -> remains suppressed regardless of fresh ads.
9. law firm changes practice-area ads -> Call Pack uses current practice area.
10. hail market evidence from prior storm -> not allowed for current-event opener.

---

# 21. CORE RULE

Freshness controls what the system is allowed to say and which decision it can make. Stale evidence remains valuable history, but history must never masquerade as a current fact.
