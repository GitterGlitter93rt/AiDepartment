# YAD — TOMORROW OUTBOUND PILOT PREFLIGHT — CURRENT

**Status:** Immediate release/pilot authority  
**Target date:** 2026-09-04  
**Implementation owner:** Claude Code on EdgeXpert / voice server  
**Architecture owner:** ChatGPT  

This is the operational checklist for deciding what YAD can actually run tomorrow.

Do not call a release ready because the UI renders, Twilio credentials work, or the model can speak.

The end-to-end chain must be proven.

---

# 1. TOMORROW'S GOAL

The desired proof is:

```text
Researched Account
-> trustworthy contact route
-> current channel eligibility
-> exact Call Pack
-> correct Sales AI hook
-> low-latency natural conversation
-> correct qualification
-> correct next step
-> confirmed Cal.com booking/callback/email/no-sale/DNC
-> durable CRM/timeline record
-> versioned QA result
```

The first live objective is learning from a tiny controlled cohort, not maximizing dial volume.

---

# 2. THREE POSSIBLE RELEASE STATES

At the end of implementation/testing, Claude must explicitly classify tomorrow as one of:

## `REAL_AI_PILOT_ELIGIBLE`

All required infrastructure, screening/policy, Twilio preflight, voice, Call Pack, booking and persistence gates pass for the exact pilot prospect class.

## `INTERNAL_AI_TEST_ONLY`

Voice can be tested against approved internal/allowlisted participants, but one or more real-prospect AI eligibility/policy/screening gates are unresolved.

Human reps may still use Human Assist for separately eligible live human calls.

## `HUMAN_ASSIST_ONLY`

Realtime voice is not reliable enough for tomorrow. Sales Portal / researched prospect workflow remains usable for reps.

Do not blur these states.

---

# 3. GATE 0 — BRANCH / ENVIRONMENT

Before implementation changes:

- inspect local git status;
- preserve legitimate Claude work;
- fetch current `origin/feature/outbound-sales-brain`;
- reconcile without overwriting architecture commits;
- do not merge `main`;
- do not force push;
- do not re-enable automatic GitHub Actions;
- do not commit credentials.

Read:

- `CLAUDE-SALES-AI-PILOT-CURRENT.md`
- `CLAUDE-DNC-RELEASE-ADDENDUM.md`
- `outbound-sales-brain-phone-screening-provider-interface-spec.md`
- `outbound-sales-brain-human-manual-call-v1-spec.md`

---

# 4. GATE 1 — CANONICAL PROSPECT DATA

Required for every candidate:

- one canonical Account;
- correct business identity;
- location/geography;
- vertical/profile;
- fresh enough research for selected hook;
- Module 4C score/tier;
- research completeness;
- one primary opportunity hypothesis;
- fact vs hypothesis separation;
- target role;
- phone endpoint with source/type/freshness;
- ownership state;
- relationship/suppression state.

Hard fail:

- duplicate company with split DNC/history;
- wrong company/domain/phone;
- stale ad claim represented as current;
- guessed decision-maker/contact presented as confirmed.

---

# 5. GATE 2 — CONTACT ROUTING

For pilot candidates, prefer strongest available path:

1. current named stakeholder + explicit direct business endpoint;
2. current named stakeholder + verified company main line;
3. correct target role + verified company main line;
4. provider-sourced direct endpoint with correct source semantics;
5. lower-confidence endpoint -> review/human assist instead of pretending certainty.

Do not require Apollo if public routing is adequate.

Do not fabricate direct numbers or guessed emails.

---

# 6. GATE 3 — PHONE SCREENING / ELIGIBILITY

For each phone endpoint, determine separately:

- `HUMAN_MANUAL_CALL`
- `AUTONOMOUS_AI_VOICE`

Each returns:

- ALLOW
- BLOCK
- REVIEW_REQUIRED

Required inputs as applicable:

- internal YAD DNC/suppression;
- endpoint type/quality;
- jurisdiction;
- contact basis;
- intended technology;
- registry/provider screening required by current policy;
- provider/carrier policy;
- local time/calling window;
- attempt history;
- campaign state.

Hard fail:

- screening error becomes no-match;
- stale decision authorizes new AI call when refresh required;
- Twilio call issued without current AI ALLOW decision;
- rep ownership treated as permission;
- YAD DNC bypassed by another channel.

If required external registry credentials/access are not available, report the exact blocker. Do not invent a successful screen.

---

# 7. GATE 4 — HUMAN MANUAL CALL PATH

Even if AI is not real-prospect eligible tomorrow, the portal should prove:

```text
Claim Account
-> Start Manual Call
-> human-call preflight
-> ContactAttempt created
-> tel: action
-> rep makes call
-> disposition
-> callback/email/opportunity/DNC
-> timeline update
```

This is the fallback commercial path and must not be blocked by AI voice work.

---

# 8. GATE 5 — RUNTIME CALL PACK

AI candidate needs immutable runtime Call Pack containing only what the realtime model needs:

- account_id
- company name/pronunciation
- contact/target role
- phone endpoint ID
- vertical/profile
- three confirmed facts maximum for opening context
- primary hypothesis
- backup hypothesis
- selected hook family/version
- first question
- known systems only with evidence semantics
- prior relationship history relevant to call
- do-not-claim warnings
- allowed next-step actions
- eligibility decision ID/version
- booking config/version.

Do not feed raw crawler pages or provider payloads into realtime turn generation.

---

# 9. GATE 6 — SALES AI SCRIPT / HOOK

Current primary HVAC release candidates remain:

- `HVAC_AH_A1`
- `HVAC_OVERFLOW_A2`
- safe fallback `CATEGORY_AH_B1` when ad/current context is not claim-safe.

Before live prospect use:

- run roleplay fixtures;
- run hook backtest fixtures;
- verify selected hook can be supported by current Call Pack;
- reject generic AI-product pitch as default opener;
- reject unsupported spend/loss claims;
- reject creepy over-researched wording.

The first goal is to get the prospect answering a useful process question quickly.

---

# 10. GATE 7 — VOICE TRANSPORT

Audit/reuse the proven demo/receptionist transport where appropriate, while keeping sales prompt/context separate.

Test:

- Twilio webhook validation;
- WebSocket/ConversationRelay path;
- first greeting latency;
- normal turn latency;
- barge-in;
- interruption cancellation;
- stale response prevention;
- phone/email/number pronunciation;
- session cleanup;
- inbound/demo/outbound mode separation.

Hard fail:

- recurring 3–5 second dead air;
- agent continues talking over prospect;
- stale answer plays after interruption;
- demo content leaks into sales call;
- outbound crash affects inbound demo/receptionist.

---

# 11. GATE 8 — INTERNAL / ALLOWLISTED VOICE SCENARIOS

Run actual outbound voice configuration against approved participants for at least:

1. owner answers normally;
2. prospect interrupts opener;
3. `who is this?`;
4. `are you AI?`;
5. gatekeeper;
6. busy / call later;
7. send me an email;
8. already has system / no need;
9. strategy call accepted;
10. booking failure;
11. wrong number;
12. do not call;
13. silence / voicemail behavior as implemented;
14. multiple rapid interruptions.

Every DNC/wrong-number result must persist to canonical state.

---

# 12. GATE 9 — BOOKING

Current intended next step for genuinely qualified prospects:

**15-minute YAD AI Strategy Call with Michael.**

Current booking authority:

- Cal.com
- Michael calendar connection: `michael@youraidepartment.ai`
- configured YAD 15-minute event
- Cal Video unless current config says otherwise.

Test:

- availability lookup;
- timezone handling;
- same-day option when actually available;
- booking creation;
- confirmation returned before agent says booked;
- invite appears on Michael's calendar through Cal.com integration;
- attendee receives expected invite/notification;
- booking failure creates alternate next step, not false confirmation;
- booked Account exits generic cold outreach.

Do not create a second duplicate Outlook event when Cal.com owns calendar creation.

---

# 13. GATE 10 — QUALIFICATION / NEXT STEP

The AI does not exist merely to force meetings.

Allowed readiness results:

- BOOK_NOW
- CONTINUE_BRIEFLY
- CALLBACK
- SEND_TARGETED_INFO
- END_NO_NEED
- DISQUALIFY_OR_REVIEW

Offer the 15-minute call when there is enough legitimate reason for deeper discussion.

No-pain prospect -> no meeting needed.

Requested email -> send/draft the requested targeted information rather than stacking another pitch.

---

# 14. GATE 11 — CRM / TIMELINE

After every test/pilot call persist:

- call_id;
- account_id;
- contact/phone endpoint;
- campaign/pilot batch;
- hook version;
- Call Pack version;
- policy decision/version;
- start/end;
- disposition;
- useful process facts;
- prospect corrections;
- objection;
- next step;
- booking/callback/email result;
- DNC/wrong number;
- QA/version fields.

A failed call is still valuable data and must remain reviewable.

---

# 15. GATE 12 — PILOT CONTROL PLANE

For first real pilot, require:

- exact visible candidate cohort;
- account/contact/hook preview;
- current eligibility status;
- concurrency = 1;
- `Start Next Call`;
- `Pause After Current`;
- `STOP NEW OUTBOUND CALLS`;
- active call status;
- completed call review;
- no hidden background dialing.

Do not start with a 100-number unattended batch.

---

# 16. FIRST REAL COHORT DESIGN

If real AI prospect calling reaches `REAL_AI_PILOT_ELIGIBLE`, use a very small, intentionally reviewed cohort.

Prefer:

- one vertical: HVAC;
- one geography/consistent time zone: Jacksonville / St. Augustine area;
- current research;
- strongest available business contact path;
- Tier A/B;
- fresh advertiser/after-hours evidence when using `HVAC_AH_A1`;
- no existing relationship conflict;
- current AI ALLOW decision.

Do not mix law, roofing, collision, real estate and HVAC into the first handful of calls.

---

# 17. PILOT REVIEW AFTER EACH CALL

For the first calls, review each one before continuing the batch.

Score:

- correct company/person routing;
- greeting latency;
- opener naturalness;
- first-question response;
- useful fact by turn 3;
- interruption behavior;
- repetition;
- objection handling;
- unsupported claim count;
- qualification decision;
- next-step execution;
- DNC handling;
- booking truth;
- overall QA root cause.

If failure is component-specific, change the smallest responsible component and version it.

---

# 18. STOP CONDITIONS

Immediately pause new AI prospect calls for:

- DNC failure;
- wrong-number reuse;
- wrong company/Call Pack;
- unsupported current-ad statement;
- invented spend/revenue/results/system;
- false booking confirmation;
- repeated severe latency;
- repeated barge-in failure;
- demo context leak;
- eligibility/policy bypass;
- unexplained screening failure;
- repeated argumentative loop.

Do not continue dialing simply to collect more examples after a severe control failure.

---

# 19. TOMORROW MORNING STATUS REPORT

Claude should return one concise release report:

## Infrastructure

- Sales Portal URL/status
- voice service status
- DB/queue status
- Twilio mode separation

## Prospect Factory

- usable Jacksonville/St. Augustine HVAC inventory count
- contact route fill
- decision-maker/public vs paid enrichment breakdown if available

## Human Assist

- manual call preflight status
- claim/disposition/callback/DNC status

## AI Sales

- runtime Call Pack status
- selected hook/default
- roleplay/backtest results
- voice latency/barge-in results

## Compliance/phone eligibility

- screening provider/access status
- human eligibility implemented?
- AI eligibility implemented?
- DNC durability tests

## Booking

- Cal.com/Outlook integration test
- same-day booking behavior

## Release classification

Exactly one:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

## Blockers

Exact blockers and next action.

---

# 20. SUCCESS CONDITION

Tomorrow is successful if YAD has a trustworthy system it can learn from — even if the correct release classification is Human Assist or internal AI testing rather than a real AI cold-call batch.

The target architecture remains:

**EdgeXpert finds/researches the companies; reps can search and claim them; phone eligibility is channel-specific; one Sales AI uses the researched Call Pack; qualified prospects can be booked onto Michael's Cal.com-connected Outlook calendar; every outcome updates one canonical Account history.**