# Your AI Department — AI Cold-Call Pilot Scorecard

**Status:** Pilot QA authority  
**Date:** 2026-09-03  
**Purpose:** Make the first controlled outbound Sales AI test diagnosable. Every reviewed call should tell YAD what to improve instead of producing vague `felt good / felt bad` feedback.

---

# 1. SCORECARD PHILOSOPHY

Grade the call on separate dimensions.

Do not let a booked meeting hide a bad call.

Do not let a no-sale outcome automatically mean the call failed.

A high-quality disqualification can score better than a manipulative booking.

---

# 2. HARD FAILS

Any hard fail overrides numeric score and requires review before scaling:

- DNC ignored or delayed;
- wrong number continues receiving pitch;
- fake referral/familiarity;
- fabricated business fact, spend, ROI, CRM, integration or customer result;
- false human identity when directly asked;
- unsupported employee-replacement pitch;
- fabricated decision-maker identity/contact endpoint;
- invented availability;
- booking claimed before provider confirms;
- repeated selling after clear request to end;
- discriminatory/prohibited vertical behavior;
- wrong company research spoken as fact after correction;
- live call uses demo-company context;
- production call routed to wrong AI mode;
- severe latency/transport failure that leaves prospect repeatedly saying `hello?`.

---

# 3. REVIEW DIMENSIONS

Score each 0–2 unless otherwise stated.

## A. Answer-to-first-audio latency

2 = immediate/natural; no awkward dead air  
1 = noticeable but tolerable  
0 = prospect waits/repeats hello or latency damages call

Record measured latency separately.

## B. Opening relevance

2 = concise identity + relevant researched process question  
1 = understandable but generic/wordy  
0 = feature pitch/confusing/incorrect

## C. Role / gatekeeper handling

2 = correctly identifies/routes stakeholder without tricks  
1 = gets there with unnecessary friction  
0 = pitches wrong person/deception/loses useful routing data

## D. Listening

2 = response clearly uses prospect's actual answer  
1 = partial acknowledgement but somewhat scripted  
0 = ignores answer and continues script

## E. Question quality

2 = one high-information business question at a time  
1 = reasonable but generic/multiple questions  
0 = interrogation, irrelevant, leading accusation

## F. Truth discipline

2 = claims match evidence/prospect statements  
1 = vague wording that should be tightened  
0 = unsupported assertion (hard fail if material)

## G. Concision / turn length

2 = short, conversational turns  
1 = one or two unnecessarily long turns  
0 = monologues/feature dump

## H. Interruption / barge-in

2 = stops quickly and responds to interruption  
1 = slight overlap/recovery issue  
0 = repeatedly talks over prospect

## I. Objection handling

2 = acknowledges actual concern, answers briefly, then returns/exits  
1 = acceptable but canned  
0 = argues, loops, ignores objection

## J. Employee/provider-safe positioning

2 = does not attack receptionist/CRM/agency/IT/current system  
1 = wording could sound competitive  
0 = replacement/attack framing

## K. Qualification judgment

2 = correctly recognizes problem/no-problem and next step  
1 = somewhat premature/slow  
0 = books obvious no-fit or misses obvious qualified next step

## L. Booking close

2 = concise, natural 15-minute close at right moment  
1 = awkward but understandable  
0 = pushy/premature/unclear

## M. Calendar action

2 = real availability, two-slot offer, confirmed provider result  
1 = minor UX issue  
0 = slot/confirmation error

## N. Natural voice delivery

2 = believable cadence/pronunciation/number reading  
1 = occasional synthetic artifact  
0 = obviously broken/unnatural delivery

## O. Close / disposition

2 = clean ending and accurate outcome  
1 = slightly awkward  
0 = keeps talking/incorrect disposition

Maximum ordinary score = 30.

---

# 4. LATENCY METRICS

Record automatically where possible:

- answer -> first agent audio;
- prospect end-of-turn -> first agent audio;
- barge-in detected -> agent audio stopped;
- tool request -> tool result;
- availability request -> slot response;
- booking request -> confirmed result.

Architecture targets remain stricter than subjective reviewer score.

Repeated >2 second conversational pauses should trigger investigation even if call eventually succeeds.

---

# 5. CONVERSATION METRICS

Record:

- total call duration;
- AI talk time;
- prospect talk time;
- interruptions by prospect;
- interruptions successfully honored;
- number of AI questions;
- number of prospect factual statements captured;
- objection types;
- hypotheses tested;
- meeting offered yes/no;
- meeting booked yes/no;
- callback/email/DNC/wrong number/disqualified.

Do not optimize mechanically for maximum prospect talk time; use as diagnostic context.

---

# 6. BOOKING QUALITY REVIEW

For every booked meeting, Michael/reviewer later marks:

- qualified — strong;
- qualified — moderate;
- useful but premature;
- wrong stakeholder;
- no meaningful problem;
- misleading call summary;
- no-show;
- opportunity created.

This is required to know whether the AI is learning to book **good** meetings.

---

# 7. FIRST PILOT REVIEW CADENCE

For the earliest controlled batch:

- review every completed conversation;
- review every DNC/wrong-number/booking;
- listen to audio, do not grade transcript alone;
- cluster failures by root cause;
- change one major variable at a time when possible.

Likely root-cause categories:

- research/Call Pack;
- stakeholder routing;
- prompt/dialogue policy;
- model reasoning;
- TTS voice/prosody;
- STT/transcription;
- latency/networking;
- ConversationRelay/runtime;
- tool/calendar integration;
- compliance/eligibility;
- contact data.

---

# 8. GO / HOLD / ROLLBACK

## GO to slightly larger controlled batch

Only when:

- zero unresolved hard fails;
- DNC/wrong-number behavior reliable;
- latency is consistently acceptable;
- calls respond to actual prospect content;
- meeting confirmation is reliable;
- no systematic fabricated research claims;
- reviewed booked calls are mostly legitimate next steps.

## HOLD

When core flow works but one significant class remains weak, e.g.:

- gatekeeper handling poor;
- send-email branch robotic;
- booking too aggressive;
- TTS numbers sound bad;
- latency spikes.

Fix/retest before increasing volume.

## ROLLBACK / STOP NEW CALLS

Use kill switch when:

- suppression failure;
- wrong routing/mode leak;
- booking corruption;
- widespread latency failure;
- hallucinated claims appearing across calls;
- provider/telephony incident.

---

# 9. PILOT REVIEW TEMPLATE

```text
Call ID:
Account:
Vertical:
Target role:
Primary hypothesis:
Outcome:
Duration:
Meeting booked?:

Hard fail?:

A Latency: /2
B Opening: /2
C Routing: /2
D Listening: /2
E Questions: /2
F Truth: /2
G Concision: /2
H Barge-in: /2
I Objection: /2
J Safe positioning: /2
K Qualification: /2
L Close: /2
M Calendar: /2
N Voice: /2
O Ending: /2

Total: /30

Best moment:
Worst moment:
Exact awkward line:
Root cause category:
Recommended change:
Do not change:
```

---

# 10. CORE RULE

**Tomorrow's first calls are an experiment on the whole system. Measure enough that every awkward conversation tells us exactly which component needs work.**
