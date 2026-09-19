# Your AI Department — Closed-Loop Sales Learning Engine

**Status:** Architecture authority  
**Purpose:** Turn real prospecting outcomes into better market/query/hook/routing decisions while preserving the canonical YAD score, sales doctrine, and human review.  
**Implementation owner:** Claude Code

---

# 1. MISSION

The system should improve from actual outcomes.

It should learn things like:

- which markets produce the most Tier A/B businesses;
- which Google query families discover companies that become qualified conversations;
- which advertiser patterns predict meetings;
- which hooks work by vertical;
- which role is easiest and most productive to reach;
- which providers are cost-effective;
- which research claims are often corrected;
- which verticals produce the best opportunity economics for YAD.

It must NOT learn by silently rewriting production truth or compliance rules.

---

# 2. THREE SEPARATE LEARNING LOOPS

## Loop A — Supply Learning

Improves:

- market priority
- query priority
- search-cell priority
- provider routing
- research depth

## Loop B — Sales Learning

Improves proposals for:

- hook priority
- role targeting
- discovery-question priority
- follow-up strategy
- Call Pack composition

## Loop C — Quality Learning

Improves:

- evidence rules
- stale-data refresh
- false-positive exclusions
- QA checks
- voice/latency configuration proposals

Do not blend all signals into a single global score.

---

# 3. OUTCOME LADDER

The learning engine should understand that outcomes have different informational value.

Possible ladder:

1. discovered
2. research complete
3. Tier B+
4. contact attempted
5. live conversation
6. decision-maker reached
7. meaningful discovery
8. qualified opportunity/pain
9. meeting scheduled
10. meeting held
11. opportunity created
12. proposal
13. closed won/lost
14. collected revenue where available

A query that produces many Tier A prospects but zero decision-maker contacts may have a contactability problem rather than a fit problem.

---

# 4. ATTRIBUTION MODEL

Every downstream outcome should preserve lineage to:

- discovery source/provider
- search task/query family
- geography/search cell
- ad observation(s)
- vertical profile/version
- score snapshot/version
- research completeness
- advertiser strength
- primary/backup hook
- target role
- contact source
- campaign
- rep/agent version
- prompt/manual/commercial-truth versions

This allows analysis without pretending one factor caused the result.

---

# 5. LEARNING UNIT

`LearningObservation`

- observation_id
- account_id
- campaign_id
- outcome_type
- outcome_value
- occurred_at
- source_lineage
- score_snapshot_id
- call_pack_id
- contact_target_id
- conversation/call id optional
- vertical profile
- market
- query family
- hook family
- quality flags
- sample eligibility

---

# 6. SAMPLE ELIGIBILITY

Exclude or separately flag observations affected by:

- test/internal numbers
- malformed data
- known provider outage
- technical call failure before meaningful contact
- DNC/suppressed mistake
- duplicate outreach collision
- incomplete campaign experiment setup
- manual override outside normal process

Do not let test calls teach the system prospect-conversion behavior.

---

# 7. MARKET LEARNING

Per `(vertical, metro/territory)` measure:

- search cost
- unique Account yield
- advertiser density
- Tier B+ density
- contactability
- decision-maker reach
- qualified conversation rate
- meeting rate
- opportunity rate
- close/collected revenue when mature

Possible recommendation:

> Tampa HVAC produced lower search cost and 1.8x qualified-conversation rate versus Orlando over comparable samples. Recommend next expansion budget favor Tampa.

This is a proposal, not automatic unrestricted geographic expansion in V1.

---

# 8. QUERY LEARNING

Per query family:

- unique advertiser yield
- Tier B+ yield
- false-positive rate
- contactability
- qualified conversation
- meeting
- opportunity
- cost

Distinguish:

**Discovery productivity** from **sales productivity**.

Example:

`HVAC contractor` may discover many businesses cheaply.

`emergency AC repair` may discover fewer but stronger qualified prospects.

The planner can use both for different passes.

---

# 9. ADVERTISER PATTERN LEARNING

Analyze features without inferring spend:

- LSA observed
- paid search observed
- repeated observation across query families
- high-intent service category
- financing ad/landing page
- emergency/24-7
- multi-channel evidence
- dedicated landing page
- call tracking

Question:

> Which observable advertiser patterns correlate with meaningful YAD opportunities?

Do not convert visibility into dollar-spend estimates.

---

# 10. HOOK LEARNING

Measure hook by vertical + context.

Outcomes:

- prospect answers operational question
- continuation after opener
- qualified pain found
- meeting
- hostile response
- DNC
- QA score

Do not declare a hook “best” from five calls.

Maintain sample counts and confidence intervals/credible intervals as implementation permits.

---

# 11. ROLE-TARGET LEARNING

Measure by target role:

- reach rate
- decision authority
- meaningful discovery rate
- meeting rate
- handoff/referral rate

Example:

Roofing sales-manager targeting may outperform owner targeting for unsold-proposal discovery, while owner performs better for strategic CRM overhaul.

Role learning should be hypothesis-specific.

---

# 12. RESEARCH-DEPTH LEARNING

Compare:

- light research
- standard research
- deep research

against:

- provider cost
- correction rate
- rep usefulness rating
- qualified conversation
- meeting

Goal:

Find the minimum research depth that produces reliable sales context.

Do not automatically deep-research every prospect because more context exists.

---

# 13. CALL PACK QUALITY FEEDBACK

Human reps may rate after use:

- hook relevant: yes/no
- research accurate: yes/no
- decision-maker correct: yes/no
- prospect corrected material fact: yes/no
- Call Pack too long/short
- useful next question

Structured feedback feeds QA proposals.

Avoid open-ended subjective ratings as the only learning source.

---

# 14. RESEARCH CORRECTION LEARNING

If prospects repeatedly correct a claim class:

Example:

`24/7 website text` often means answering service, not full in-house operation.

Learning engine may propose:

> Keep 24/7 as confirmed public claim but modify hypothesis wording to ask how calls are handled rather than implying employee availability.

This improves claim policy without deleting the underlying evidence.

---

# 15. LOST/DISQUALIFIED LEARNING

Important reasons:

- no measurable problem
- strong existing workflow
- too small/low volume
- unsupported integration need
- no budget/priority
- wrong person
- wrong vertical
- duplicate/existing relationship
- hostile/DNC
- timing

These should inform future targeting differently.

Example:

`strong existing workflow` may suggest profile signal is good fit but hook/offer isn't differentiated.

`too small/low volume` may suggest search query discovers structurally weak targets.

---

# 16. NEGATIVE LEARNING GUARDRAIL

Never learn:

- “people with accent X convert worse”
- sensitive personal traits
- protected-class targeting
- medical/legal/private individual characteristics
- political/religious profiling

Learning operates on business, campaign, operational and public commercial features.

---

# 17. PROPOSAL OBJECT

`OptimizationProposal`

- proposal_id
- type
- target object/version
- current behavior
- proposed behavior
- evidence summary
- sample size
- uncertainty
- estimated benefit
- potential risks
- affected verticals/campaigns
- status: draft/reviewed/approved/rejected/deployed
- reviewer
- deployment version

Proposal types:

- query_priority
- new_query_candidate
- provider_route
- market_priority
- hook_priority
- role_priority
- research_depth
- refresh_ttl
- false_positive_rule
- QA_rule
- voice_config

---

# 18. WHAT MAY AUTO-ADAPT IN V1

Within explicitly bounded configuration, V1 may automatically adjust:

- queue ordering among eligible prospects
- approved query execution priority
- approved provider failover
- search-cell scheduling
- refresh scheduling
- research task prioritization

provided the adjustment remains auditable and reversible.

---

# 19. WHAT REQUIRES HUMAN APPROVAL

- new search query family
- changed Module 4C scoring rule
- changed vertical classification doctrine
- changed call claim language policy
- production prompt changes
- commercial offer/pricing changes
- compliance/contact policy changes
- new autonomous communication channel
- removal of global safety boundary

---

# 20. TIME DECAY

Outcome learning should favor reasonably current behavior when markets/providers change.

However:

- do not discard history;
- report current window vs lifetime;
- avoid overreacting to one bad week.

Suggested reporting windows:

- 7 days operational
- 30 days tactical
- 90 days strategic
- lifetime baseline

---

# 21. EXPLORATION VS EXPLOITATION

If the system only runs yesterday's winner, it may miss better markets/queries.

V1 should reserve a configurable minority of search budget for approved exploration.

Example concept:

- 80–90% proven productive routes
- 10–20% approved exploration

Actual ratio determined after pilot.

Exploration stays inside approved vertical/query/geography/provider policy.

---

# 22. LEARNING DASHBOARD

Show:

- top/bottom markets by stage
- top query families
- source/provider quality
- Tier conversion
- advertiser-pattern outcomes
- hooks by vertical
- role targets
- correction/error trends
- pending optimization proposals
- changes deployed and their before/after result

---

# 23. ACCEPTANCE TEST

Feed synthetic outcomes:

- emergency HVAC query: higher Tier B+ and meeting yield
- generic HVAC query: higher raw volume but lower qualification
- one provider: cheaper search but high false positives
- one hook: better continuation but worse meeting conversion

Engine must produce separate, explainable proposals rather than one opaque conclusion.

No proposal should silently modify canonical score or compliance.

---

# 24. CORE RULE

YAD should learn from outcomes, but the system must preserve the difference between **observed business performance**, **sales doctrine**, **commercial truth**, and **contact policy**. Learning improves prioritization; it does not get permission to rewrite reality.
