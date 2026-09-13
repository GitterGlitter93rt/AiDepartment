# Your AI Department — Tomorrow Sales AI Release Candidate Plan

**Status:** Immediate release plan  
**Target date:** 2026-09-04  
**Branch:** `feature/outbound-sales-brain`

## Immediate release-script authority

Before implementing or testing this plan, read:

- `outbound-sales-brain-yad-sales-ai-release-delta-v1.1.md`
- `outbound-sales-brain-sales-message-backtest-report-v1.md`

For affected wording/behavior, the V1.1 release delta overrides older examples in the core script.

---

# 1. RELEASE OBJECTIVE

Tomorrow's objective is **not** to prove YAD can autonomously dial large volumes.

The objective is to prove the full controlled chain:

`researched eligible Account`
-> `correct Call Pack`
-> `fast natural voice connection`
-> `truthful relevant opener`
-> `useful business conversation`
-> `correct qualification decision`
-> `Cal.com booking / callback / email / no-sale / DNC`
-> `durable Account timeline`
-> `reviewable QA record`.

If this chain works on a small controlled cohort, scale becomes an engineering/operations problem instead of a conversation-design guess.

---

# 2. RELEASE CANDIDATE CONFIGURATION

## Agent

`yad-sales-core-v1`

One core Sales AI across verticals.

## Initial vertical

HVAC first.

Plumbing can follow after the first voice/behavior checkpoint because the urgent-call business model is similar while still testing a second profile.

## Initial geography

Use one deliberately approved market/territory with high-quality research. Jacksonville / St. Augustine is the canonical first Market Miner proof unless operator chooses another approved market.

## Initial Account quality

Prefer:

- Tier A first;
- strong Tier B second;
- fresh research;
- identity confidence high;
- legitimate current business number/contact route;
- useful target role/person where possible;
- current advertising evidence when using A1/A2 ad-context hooks.

Do not include weak/ambiguous entities just to create call volume.

---

# 3. OPENING FRAME RELEASE CANDIDATES

Hold the process hook constant initially and compare framing separately.

## F1 — explicit cold frame

> Hey [Name], [identity] with Your AI Department. Quick cold call — I'll keep it short.

Then claim-safe relevance + process question.

Offline design score: 47/50.

## F2 — out-of-nowhere frame

> Hey [Name], [identity] with Your AI Department. I know I'm calling you out of nowhere — one quick question.

Then claim-safe relevance + process question.

Offline design score: 46/50.

Do not default to `Did I catch you at a bad time?`.

Do not change frame and process hook at the same time when trying to learn which variable caused an outcome.

---

# 4. HOOK RELEASE CANDIDATES

## Primary A1

ID: `HVAC_AH_A1`

Context:

- fresh current advertiser observation;
- emergency/after-hours service context claim-safe.

Question:

> When a new call hits after hours, what happens today?

Offline design score: 48/50.

## Primary A2

ID: `HVAC_OVERFLOW_A2`

Question:

> When a new call comes in while everybody's already tied up, what happens next?

Offline design score: 46/50.

## Safe fallback B1

ID: `CATEGORY_AH_B1`

Use when advertiser claim is not sufficiently current/clear.

> When somebody reaches out after hours, what happens today?

Offline design score: 42/50.

No runtime may upgrade B1 to A1 merely because an old ad observation exists.

---

# 5. PRE-LIVE CHECKPOINT — INTERNAL / ALLOWLISTED VOICE

Before a real prospect hears the release candidate, complete an internal/allowlisted voice pass using the actual production outbound service and production configuration except destination.

Minimum scenarios:

1. normal engaged owner;
2. owner interrupts during opener;
3. owner asks `who is this?`;
4. owner asks `are you AI?`;
5. owner asks `how did you get my number?`;
6. gatekeeper;
7. send me an email;
8. busy owner;
9. not interested;
10. strong existing process/no-sale;
11. strategy-call booking through Cal.com test configuration;
12. booking-provider failure;
13. wrong number;
14. DNC;
15. stale advertiser evidence must degrade to safe opener;
16. incorrect/ambiguous target name must not be spoken as confident fact.

Hard requirements:

- no 3–5 second dead air;
- barge-in stops stale speech;
- no repeated sentence after interruption;
- natural phone/email/time pronunciation;
- no unsupported research claim;
- DNC terminates sales behavior;
- booking is not stated as confirmed before provider confirmation;
- endpoint provenance answer is truthful;
- strong system/no-pain does not become forced booking.

---

# 6. LIVE PILOT CONTROL

Use the Pilot Control Plane.

Initial live behavior:

- operator selects exact Accounts;
- operator can inspect Call Pack/frame/hook before start;
- one new call at a time initially;
- no uncontrolled auto-refill from Market Miner into active dial batch;
- `STOP NEW OUTBOUND CALLS` always available;
- active call may complete unless policy/technical kill requires termination;
- every call version-stamped under the pilot experiment contract.

---

# 7. FIRST LIVE CHECKPOINT

Do **not** decide the whole product from call #1.

After the first small eligible cohort, stop and review before increasing concurrency/volume.

Review:

- audio/greeting latency;
- contact correctness;
- right-person rate;
- frame reaction;
- opener/hook reaction;
- first-question answer rate;
- useful-process-fact rate;
- AI listening quality;
- interruption handling;
- objection behavior;
- qualification decision;
- booking flow;
- DNC/wrong-number behavior;
- call notes/handoff accuracy.

If voice/runtime quality is poor, fix voice/runtime before judging hook conversion.

If wrong decision-makers dominate, fix contact research before judging hook conversion.

If people answer the hook but the agent later gets robotic, fix dialogue/state handling rather than rewriting the opener.

---

# 8. LIVE EXPERIMENT ORDER

Do not create a combinatorial explosion.

## Stage 1 — frame

Hold `HVAC_AH_A1` constant and compare:

- F1 + A1;
- F2 + A1.

Only after baseline voice quality is acceptable.

## Stage 2 — hook

Use the acceptable/better frame and compare:

- `HVAC_AH_A1`;
- `HVAC_OVERFLOW_A2`.

Use reasonably similar prospect quality.

## Stage 3 — safe fallback

Use `CATEGORY_AH_B1` where current advertiser claim is not safe or as a deliberate non-ad-context comparison.

## Stage 4 — second vertical

Plumbing.

## Stage 5 — estimate workflow

Roofing `ESTIMATE_A1` after urgent-service proof.

Do not deliberately send weak/deceptive negative controls to real prospects.

---

# 9. LIVE METRICS

Primary directional metrics:

1. right-person first-question answer rate;
2. useful process fact by agent turn 3;
3. meaningful problem supported;
4. qualified strategy-call offer rate;
5. strategy-call booked rate;
6. early hang-up during frame/opener;
7. targeted email/callback;
8. no-need;
9. DNC;
10. qualitative naturalness/creepiness feedback;
11. latency/interruption/repetition failures.

The best message is not automatically the one with highest meeting count if it creates low-quality meetings.

---

# 10. QUALIFIED MEETING STANDARD

The AI may use `BOOK_NOW` when conversation supports a legitimate reason for deeper review.

Examples:

- after-hours service only takes messages and callback may wait until morning;
- sales follow-up depends on individual reps with weak management visibility;
- lead routing/follow-up is manual and prospect acknowledges inconsistency;
- existing systems do not cover the workflow being discussed;
- prospect explicitly asks for deeper evaluation of a relevant YAD capability.

Do not book merely because:

- prospect is friendly;
- prospect likes AI;
- prospect asks how the voice works;
- agent has been on the phone for a threshold duration;
- prospect says `interesting` without a business reason.

---

# 11. POSITIONING / MEETING CLOSE

When a supported problem exists, preferred short positioning from V1.1:

> That's the kind of workflow we help businesses tighten up — lead handling, follow-up and the systems around it. I don't want to guess at a solution on a cold call.

Preferred close when `BOOK_NOW`:

> Based on what you just told me, I think this is worth looking at properly instead of guessing on a cold call. Michael handles these strategy conversations for us, and it's only 15 minutes. Want me to see what he has open?

Compressed close for an obviously engaged/rushed prospect:

> That sounds worth a proper look. Michael handles the strategy side for us — it's 15 minutes. Want me to check his calendar?

If yes:

1. get timezone if needed;
2. check Cal.com;
3. offer at most two real slots;
4. collect/confirm business email;
5. book selected slot;
6. only then confirm;
7. generate Michael prep brief.

Do not use generic `schedule a demo?` as the default close.

---

# 12. RELEASE STOP CONDITIONS

Pause new outbound calls immediately if any of the following occurs:

- repeated 2+ second conversational dead air beyond accepted temporary tool wait;
- repeated barge-in failure;
- wrong Call Pack/company identity;
- stale/unsupported ad claims;
- hallucinated customer results/spend/CRM facts;
- DNC not durably enforced;
- wrong-number endpoint recycled;
- agent repeatedly argues with prospect;
- booking falsely reported confirmed;
- call recordings/transcripts/outcomes unavailable for review when required by approved configuration;
- mode routing accidentally points production call to demo prompt/context;
- policy/compliance gate is not functioning deterministically.

A severe single truth/DNC/policy failure is sufficient to stop the pilot.

---

# 13. RELEASE SUCCESS CONDITION

Tomorrow is a successful release even if zero meetings are booked if the sample demonstrates:

- stable voice transport;
- natural low-latency conversation;
- correct research use;
- correct role/gatekeeper handling;
- useful process discovery;
- trustworthy no-sale behavior;
- correct action tools;
- durable learning data.

A meeting is valuable only if the upstream chain is trustworthy.

---

# 14. AFTER EACH REVIEW BATCH

Classify every meaningful failure into one primary root cause:

- prospect quality;
- contact research;
- frame;
- hook;
- Call Pack;
- model/dialogue;
- objection handling;
- qualification;
- Cal.com booking;
- STT;
- TTS;
- latency;
- Twilio/telephony;
- policy/compliance.

Change the smallest responsible component.

Version it.

Rerun the affected offline fixtures.

Then move to the next controlled batch.

---

# 15. SCALE ORDER AFTER PROOF

Only after the release candidate proves stable:

1. more HVAC prospects;
2. Plumbing second-profile proof;
3. Roofing estimate hook;
4. broader saved markets;
5. carefully increased concurrency;
6. additional vertical/hook families;
7. closed-loop ranking based on actual outcomes.

Do not scale prospect count faster than QA/learning capacity.
