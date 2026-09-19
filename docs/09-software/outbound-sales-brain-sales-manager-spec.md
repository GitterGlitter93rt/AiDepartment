# Your AI Department — Sales Manager Brain Specification

**Status:** Architecture authority  
**Purpose:** Give YAD management an evidence-based system for rep priorities, pipeline hygiene, deal review, forecast discipline, promise audits, coaching, and campaign/vertical performance.  
**Source doctrine:** Sales Manual Module 40.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Do not manage activity for activity's sake.

The Sales Manager Brain should optimize for:

- qualified business conversations
- accurate opportunity stages
- defensible business cases
- clean next steps
- truthful promises
- rep improvement
- good delivery handoffs.

A rep making 100 weak dials is not automatically outperforming a rep producing five high-quality diagnostic conversations.

---

# 2. MANAGEMENT INPUTS

- rep queues / leases
- activity events
- relationship outcomes
- qualification snapshots
- opportunity stages
- business-case inputs
- proposal readiness
- proposal versions
- decision process
- promises
- follow-up tasks
- meetings
- closed outcomes
- QA scores
- campaign/market/query/hook lineage
- provider economics
- delivery handoff quality.

---

# 3. CORE FUNNEL VIEW

Normalize internal funnel to:

1. Target / Prospect
2. Contacted
3. Discovery / Qualification
4. Financial Diagnosis / Business Case
5. Strategy / Solution Definition
6. Proposal / Decision
7. Closed Won
8. Closed Lost / Disqualified
9. Delivery Handoff

Underlying system may use more detailed lifecycle states, but management reporting maps cleanly to these stages.

---

# 4. EVIDENCE-BASED STAGE ADVANCEMENT

Stage transitions require evidence.

## Discovery

Should normally include:

- identified problem/objective
- current workflow description
- likely process owner/stakeholder
- next action.

## Financial Diagnosis

- defensible inputs or explicit measurement plan
- business consequence
- source labels.

## Proposal

- proposal readiness gate
- defined scope
- stakeholder/decision process
- pricing authority
- assumptions
- measurement plan.

No “rep feels good” stage changes.

---

# 5. PIPELINE HYGIENE FLAGS

Auto-flag:

- stage missing required evidence
- no next action/date
- overdue callback
- stale opportunity
- no decision-maker access
- economic inputs unlabeled
- proposal before readiness
- promise verification pending
- technical blocker hidden
- duplicated Account/opportunity
- DNC/contact state conflict
- meeting held with no outcome update.

---

# 6. WEEKLY DEAL REVIEW PACK

For each meaningful opportunity, generate:

1. prospect-stated problem
2. current workflow
3. evidence/provenance
4. frequency/volume
5. business value scenario
6. verified vs estimated inputs
7. human-required decisions
8. system/integration constraints
9. decision-maker
10. other stakeholders
11. next action
12. deal risks
13. promises made
14. proposal readiness
15. why current stage is justified.

Manager should be able to challenge weak assumptions quickly.

---

# 7. PROMISE AUDIT

Before proposal and before delivery handoff, automatically review:

- result guarantee
- integration promise
- date/timeline
- technology/vendor commitment
- price/discount/payment terms
- sensitive decision automation
- employee replacement implication
- security/compliance claim
- SLA/support/exclusivity.

Compare against `sales-promise-registry.v1.yaml`.

Any violation requires resolution/approval before progressing.

---

# 8. FORECAST CATEGORIES

Working internal categories:

## PIPELINE

Qualified, but substantial work remains.

## BEST_CASE

Credible decision path exists in forecast period; unresolved risks remain.

## COMMIT

Decision process, stakeholders, commercial terms and next steps are sufficiently clear for management to consider close highly likely.

## CLOSED

Won/lost.

These are internal categories, not promises.

---

# 9. FORECAST EVIDENCE

A forecast category should reference:

- current opportunity stage
- problem confirmation
- economic case quality
- decision access
- stakeholder alignment
- technical feasibility
- proposal state
- commercial approval
- explicit next action/date
- prospect signals/commitments.

No AI-generated “92% close probability” without validated learned model and sufficient data.

---

# 10. DEAL HEALTH DIMENSIONS

Keep dimensions separate (1–5 or categorical internally):

- economic value
- pain frequency
- data quality
- urgency
- decision access
- feasibility
- measurability
- stakeholder alignment
- implementation readiness
- expansion potential.

Do not turn this into Module 4C prospect score.

It is post-discovery deal health.

---

# 11. RISK FLAGS

Examples:

- single-threaded champion
- no signer access
- unknown technical integration
- security/privacy unresolved
- weak baseline
- value case depends on aggressive assumption
- proposal scope creep
- stale meeting/next step
- unapproved discount request
- no client owner
- conflicting desired outcomes
- prospect expects guarantee.

---

# 12. DAILY MANAGER BRIEF

Suggested 10–15 minute view:

- callbacks/commitments overdue
- top 5 opportunities requiring action
- rep queue health
- one deal blocker per rep
- yesterday's missed follow-ups
- DNC/QA incidents
- provider/campaign anomaly
- today's coaching focus.

Do not create a one-hour status dashboard ritual.

---

# 13. WEEKLY MANAGER BRIEF

- pipeline/deal review
- funnel conversion
- advertiser-source performance
- hook performance
- market/vertical performance
- one call/roleplay review per rep
- CRM hygiene
- promise audit exceptions
- closed-lost reasons
- follow-up completion
- research correction trends
- one or two coaching priorities per rep.

---

# 14. MONTHLY BUSINESS REVIEW

- qualified pipeline created
- wins/revenue if available
- stage conversion
- proposal conversion
- cycle length
- vertical performance
- advertiser vs generic source
- provider cost per qualified outcome
- market performance
- claim/promise errors
- delivery handoff quality
- rep development
- system/process bottlenecks.

Look for system problems, not only individual blame.

---

# 15. REP PERFORMANCE DENOMINATORS

Track:

- conversations / attempts
- decision-makers / conversations
- qualified / decision-makers
- meetings / qualified
- opportunities / meetings
- proposals / opportunities
- wins / proposals.

Also:

- disqualification quality
- follow-up completion
- note quality
- promise violations
- research corrections
- no-sale discipline.

Do not reward indiscriminate dial volume.

---

# 16. HOOK PERFORMANCE

Report by:

- vertical
- market
- tier
- advertiser status
- role target
- rep

Measure:

- continuation
- qualified discovery
- meeting
- opportunity
- DNC/hostile/QA.

Question:

> Which hooks create qualified conversations, not merely longer calls?

---

# 17. ADVERTISER-SOURCED PERFORMANCE

Track:

- Google Sponsored source
- LSA
- Meta
- multi-channel
- advertised service/offer
- form vs phone funnel
- decision-maker reach
- qualified opportunity
- meeting
- close.

This directly validates the user's Google-advertiser-first strategy by vertical.

---

# 18. CALL COACHING

QA/coaching score dimensions:

- opener relevance
- tone
- listening
- discovery
- follow-up questions
- quantification
- business language
- employee-safe framing
- objection handling
- next step
- claim discipline.

Manager coaching should cite exact transcript moments where available.

---

# 19. COACHING RECOMMENDATION ENGINE

Recommend one or two priorities, not twenty.

Examples:

- “Rep reaches owners but jumps into pitch before workflow discovery.”
- “Rep handles CRM objection well but fails to set explicit next-action dates.”
- “Rep is overusing generic AI opener instead of Call Pack hook.”

Recommendations require evidence/sample and remain coaching, not automatic disciplinary action.

---

# 20. 30 / 60 / 90 REP DEVELOPMENT

Architecture supports milestone tracking:

## 0–30

- doctrine
- CRM fundamentals
- economics
- cold opener
- top objections
- 2 core verticals
- note standards.

## 31–60

- discovery
- ROI worksheets
- advertiser targets
- broader objections
- independent routes
- 3–5 verticals
- proposal participation.

## 61–90

- own opportunities
- deeper discovery
- business-case presentation
- multi-stakeholder management
- final certification
- clean handoffs.

---

# 21. MANAGER INTERVENTION RULES

Escalate when:

- severe claim/promise violation
- DNC mishandling
- high-value opportunity stalled with no next step
- proposal gate bypass attempt
- discount/commercial authority issue
- security/professional boundary
- repeated duplicate contact
- rep follow-up backlog exceeds threshold
- delivery handoff blocked by sales expectation conflict.

---

# 22. CLOSED-LOST LEARNING

Managers should inspect reason distributions.

Examples:

- no meaningful pain
- economics small
- no urgency
- no decision access
- existing system sufficient
- technical infeasible
- security constraint
- chose competitor
- no response
- unsafe/guarantee demand.

Losses feed targeting/learning, not shame.

---

# 23. MANAGER ACTIONS

Allowed actions:

- reassign Account/opportunity
- update priority/campaign assignment
- require additional discovery
- return proposal to draft
- request technical review
- approve permitted commercial action if authorized
- pause campaign
- assign coaching/roleplay
- resolve duplicate/identity review.

All audited.

---

# 24. ACCEPTANCE TESTS

1. Opportunity advanced to proposal with no readiness -> flag/reject.
2. Rep has 20 overdue callbacks -> Daily Brief highlights commitments before new cold leads.
3. Proposal has unverified integration promise -> Promise Audit blocks.
4. Rep makes many calls but few decision-makers -> manager sees targeting/opening issue, not praised for activity alone.
5. Advertiser-sourced HVAC leads outperform generic -> report by source with sample sizes.
6. Five-call hook sample -> no strong global conclusion.
7. Closed-lost existing system sufficient -> preserved as useful learning/no-sale.
8. Commit forecast with no signer/next step -> downgrade/flag.
9. Delivery handoff conflict -> management alert.
10. Rep coaching identifies one or two evidence-based priorities.

---

# 25. CORE RULE

Management should make the sales system more truthful, more diagnostic, and more repeatable. The Sales Manager Brain exists to improve judgment and process—not to turn reps into activity counters.
