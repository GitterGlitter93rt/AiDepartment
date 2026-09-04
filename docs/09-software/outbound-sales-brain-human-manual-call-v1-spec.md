# Your AI Department — Human Manual Call V1 Specification

**Status:** Near-term product authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code on EdgeXpert  
**Primary users:** YAD sales representatives  

---

# 1. PRODUCT DECISION

V1 does not require an integrated human dialer.

A sales rep may use the rep's normal mobile/cell phone as the transport for a live human call **only when the server-side `HUMAN_MANUAL_CALL` decision is currently `ALLOW`**.

The Sales Portal remains the system of record.

The phone is only the transport.

Canonical flow:

```text
Find Prospects
-> Claim Account
-> Open Account
-> Start Manual Call
-> server-side eligibility preflight
-> create ContactAttempt
-> open device dialer / tel: link
-> human conversation
-> return to portal
-> disposition + notes + next action
-> shared timeline
```

The manual call workflow must not bypass canonical ownership, suppression, DNC, callback, opportunity, or client state.

---

# 2. WHY THIS EXISTS

YAD needs reps selling immediately while:

- Market Miner is running 24/7;
- the portal is being rolled out;
- autonomous AI voice remains a separate downstream path;
- a full company-managed human dialer may not yet exist.

The system should capture the important operational value now:

- who called;
- which Account/contact/endpoint;
- why they called;
- whether the call was eligible;
- what happened;
- what the prospect said;
- what must happen next.

---

# 3. REQUIRED PRECONDITIONS

A rep may initiate `Start Manual Call` only when:

- authenticated;
- authorized for the Account;
- rep owns/has approved relationship access to the Account;
- Account is not blocked by another rep's protected ownership;
- Account is not a current client in generic cold workflow;
- no active applicable YAD DNC/suppression exists;
- specific phone endpoint is not wrong/disconnected/suppressed;
- current `HUMAN_MANUAL_CALL` policy decision is `ALLOW`;
- current relationship/cadence does not prohibit a new cold call;
- current local-time policy permits the call where required;
- no promised callback/meeting state requires a different action.

Ownership alone does not grant permission to call.

---

# 4. START MANUAL CALL ACTION

Conceptual endpoint:

`POST /api/accounts/{account_id}/manual-call/preflight`

Request:

- account_id
- contact_id optional
- phone_id
- actor_user_id from authenticated session
- intended intent: cold_introduction / requested_callback / followup / requested_information / other approved
- current UI/search context optional

Server performs fresh checks and returns one of:

- `ALLOW`
- `BLOCK`
- `REVIEW_REQUIRED`

Do not trust a stale frontend badge as authorization.

---

# 5. ALLOW RESPONSE

On `ALLOW`, server atomically creates a `ContactAttempt` before exposing the active dial action.

Required fields:

- contact_attempt_id
- account_id
- contact_id optional
- phone_id
- rep_user_id
- channel = HUMAN_PHONE
- transport = REP_DEVICE_MANUAL
- intent
- eligibility_decision_id
- eligibility_policy_version
- started_at / initiated_at
- status = INITIATED
- source context / campaign if applicable

Then the response may include:

- safe display number
- dialable URI/value
- contact display name/role
- compact call prep ID/version
- contact_attempt_id

The browser may open a `tel:` URI on supported mobile devices.

---

# 6. BLOCK / REVIEW

On `BLOCK`:

- do not return an active dial URI through ordinary rep workflow;
- show concise operational reason;
- preserve Account for non-phone channels where eligible.

Examples:

- `Do Not Call`
- `Wrong number`
- `Account already in protected relationship`
- `Outside approved calling window`

On `REVIEW_REQUIRED`:

- do not let rep self-override;
- create/attach ReviewItem when applicable;
- show `Phone review required`.

---

# 7. REP DEVICE / PERSONAL NUMBER

V1 may permit the rep to place the call from the rep's own phone service.

Do not assume YAD automatically knows:

- the caller ID presented;
- whether the rep's carrier connected the call;
- exact call duration;
- whether voicemail answered;
- audio/transcript.

Therefore V1 uses explicit post-call disposition rather than pretending telephony metadata exists.

If a future company-managed dialer is introduced, it should plug into the same ContactAttempt and Account timeline model.

---

# 8. PERSONAL NUMBER PRIVACY

Do not require storage of a rep's personal mobile number merely to support `tel:` dialing.

If the company later needs caller-ID management, callback routing, recording, analytics, or branded calling, use a reviewed company telephony workflow rather than quietly collecting/publishing rep personal numbers.

The portal should identify the actor by YAD user ID, not by inferred carrier/caller ID.

---

# 9. RETURN / POST-CALL EXPERIENCE

After initiating the call, the Account should surface a persistent `Finish Call` / `Log Outcome` action.

Mobile-first design:

- one tap back to account/workflow;
- large outcome buttons;
- minimal typing required;
- optional note/voice-to-text through device/browser only if approved later.

Core quick outcomes:

- NO_ANSWER
- VOICEMAIL
- GATEKEEPER
- WRONG_CONTACT
- DECISION_MAKER_REACHED
- SEND_INFORMATION
- CALLBACK_REQUESTED
- POSSIBLE_OPPORTUNITY
- QUALIFIED_OPPORTUNITY
- MEETING_SCHEDULED
- NOT_A_FIT
- WRONG_NUMBER
- DO_NOT_CONTACT

---

# 10. DISPOSITION RULES

A disposition updates relationship state only according to the lifecycle contract.

Examples:

## NO_ANSWER

- ContactAttempt -> completed/no_answer
- update last attempt
- cadence determines future eligibility

## VOICEMAIL

- store voicemail disposition
- do not claim voicemail means decision-maker reached

## GATEKEEPER

Capture if supplied:

- correct person
- title
- extension
- direct business phone
- email
- best time

Create evidence/contact correction with source = gatekeeper/prospect.

## WRONG_NUMBER

- disable/downgrade specific endpoint
- Account remains intact
- trigger contact refresh when valuable

## DO_NOT_CONTACT

- write durable suppression immediately
- end all affected YAD phone actions
- do not create a generic sales follow-up
- future Twilio/other rep calls must see the suppression

---

# 11. CALLBACK

For `CALLBACK_REQUESTED`, require:

- due date/time
- timezone
- contact/role if known
- prospect-requested flag
- brief context

Callback becomes protected relationship state.

It should surface in My Prospects / Follow-Ups ahead of new cold work.

---

# 12. SEND INFORMATION

If prospect requests information:

- capture what they asked for;
- draft concise topic-specific email;
- human reviews/sends or routes through approved workflow;
- do not dump a generic giant deck unless requested/appropriate.

This changes the next action from generic cold outreach to requested follow-up.

---

# 13. MEETING SCHEDULED

Do not mark meeting scheduled unless the booking action returns confirmed success.

Current booking authority is Cal.com / configured strategy-call workflow.

Once confirmed:

- Account relationship -> MEETING_BOOKED
- remove from generic cold prospect inventory
- preserve source attribution
- create Michael strategy-call prep brief according to existing spec.

---

# 14. DNC DURING MANUAL CELL CALL

Because the actual conversation occurs outside Twilio, DNC handling depends on the rep recording the request correctly.

The UI must make `Do Not Call` obvious and fast.

Expected flow:

```text
Prospect: "Take me off your list."
Rep ends/acknowledges call
Rep returns to portal
Tap DO NOT CONTACT
Server writes suppression synchronously
All affected call channels blocked immediately
```

Target interaction: under 10 seconds after rep returns to the portal.

Manager approval is not required to add DNC.

---

# 15. OUT-OF-BAND LIMITATION

Software cannot physically stop a rep from copying a number elsewhere or dialing outside the YAD workflow.

Product design should reduce this risk by:

- not displaying active dial actions for blocked endpoints;
- clear DNC badges;
- company policy/training;
- auditable workflow;
- making the approved workflow faster than manual side processes.

Do not pretend technical controls can guarantee behavior outside the system.

---

# 16. MOBILE UI

Account detail mobile layout should prioritize:

1. Company + owner/role
2. Why Reach Out
3. First Question
4. Phone eligibility badge
5. `Start Manual Call`
6. Email action
7. Finish/Disposition
8. Callback / DNC

After `Start Manual Call`, preserve the Account context so returning from the Phone app does not lose the workflow.

---

# 17. CALL PREP

Before dial, show a compact 15–30 second prep card:

- correct company
- person/target role
- three confirmed facts maximum
- primary hypothesis
- opener/hook
- first question
- one important `Do Not Claim` warning
- prior contact history if any.

Do not force reps through a long research page before every call.

---

# 18. ACCOUNT TIMELINE

Manual cell calls create canonical timeline events:

- MANUAL_CALL_INITIATED
- CALL_OUTCOME
- CONTACT_CORRECTION
- CALLBACK_CREATED
- EMAIL_REQUESTED
- OPPORTUNITY_CREATED
- MEETING_BOOKED
- DNC
- WRONG_ENDPOINT

This ensures a later AI caller, Smartlead sequence, manager, or second rep sees the human history.

---

# 19. METRICS

Track per rep/market/source/hook where meaningful:

- manual calls initiated
- completed dispositions
- no answer
- gatekeeper
- decision-maker reached
- useful process fact
- callback
- send info
- meeting
- no need
- DNC
- wrong number
- missing-disposition rate
- time from call initiation to disposition
- decision-maker reach by contact source

Do not reward raw dial count alone.

---

# 20. MISSING DISPOSITION RECOVERY

If ContactAttempt stays `INITIATED` without outcome:

- surface unresolved attempt to rep;
- allow quick finish later;
- do not invent a call result;
- do not automatically count it as connected/no-answer.

Manager can see unresolved call attempts for coaching/data hygiene.

---

# 21. FUTURE COMPANY DIALER MIGRATION

Later human calling can move to:

- company Twilio voice;
- another managed dialer;
- click-to-call;
- WebRTC;
- company mobile numbers.

The migration should preserve:

- Account ownership;
- PhoneEndpoint;
- eligibility decision;
- ContactAttempt;
- disposition;
- timeline;
- DNC.

Do not rebuild a second CRM around the dialer.

---

# 22. ACCEPTANCE TESTS

1. Eligible claimed Account -> preflight ALLOW -> ContactAttempt created -> tel action returned.
2. DNC Account -> no active dial action.
3. Rep owns Account but human channel BLOCK -> ownership does not override.
4. AI REVIEW_REQUIRED but human ALLOW -> manual call works, AI remains blocked.
5. Two reps -> second rep cannot manual-call another rep's protected Account.
6. Wrong number -> endpoint disabled; Account retained.
7. DNC disposition -> future manual and AI phone actions immediately blocked.
8. Callback -> durable and protected after restart.
9. Unresolved initiated attempt -> appears in rep cleanup, no invented outcome.
10. Meeting action failure -> does not become MEETING_BOOKED.
11. Mobile return from dialer -> Account context/disposition available.
12. Rep personal number not required in canonical Prospect Factory schema.

---

# 23. FIRST REAL USER PROOF

Brent should be able to:

1. search HVAC + 32256;
2. claim five Accounts;
3. open one Account on iPhone;
4. see why it matters and who to ask for;
5. tap Start Manual Call;
6. have the server authorize/log the attempt;
7. make the live call through his phone;
8. return and disposition in under 15 seconds;
9. create a callback or DNC;
10. have another rep immediately see the new state.

If Brent must maintain a second spreadsheet or remember who he called manually, the workflow is not done.

---

# 24. CORE RULE

**Use the rep's phone for transport if needed; keep eligibility, ownership, research, history, DNC, disposition and next action inside YAD.**