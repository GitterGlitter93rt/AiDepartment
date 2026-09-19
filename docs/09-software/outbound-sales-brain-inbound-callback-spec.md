# Your AI Department — Inbound Callback Handling for Outbound Sales Campaigns

**Status:** Architecture authority  
**Purpose:** Handle prospects who call a YAD outbound sales number back after a missed call, voicemail, SMS, or prior conversation without routing them into an unrelated generic receptionist script.

---

# 1. PRINCIPLE

Outbound sales creates inbound callbacks.

Those callbacks are high-intent compared with a cold attempt and should be handled as a continuation of existing sales context when identity can be resolved safely.

The mode is:

`inbound_sales_callback`

It is distinct from:

- generic YAD inbound receptionist
- autonomous outbound cold call
- existing client support.

---

# 2. INBOUND ENTRY

Twilio receives an inbound call on a number used by outbound campaign.

System checks:

- dialed YAD number
- caller number
- recent outbound attempts to that number
- Account/Contact match
- active follow-up/opportunity
- DNC/suppression state
- existing customer/support routing.

Then selects route.

---

# 3. CALLBACK MATCH

Strong match:

- caller ANI matches PhoneEndpoint contacted recently;
- one clear Account/Contact/Location candidate.

Possible match:

- phone shared across multiple locations/accounts;
- tracking/main number ambiguity;
- multiple people from same company.

Unknown:

- no recent outbound context.

Do not assert identity when match ambiguous.

---

# 4. STRONG-MATCH GREETING

Use concise transparent context.

Example intent:

> Thanks for calling Your AI Department. We reached out earlier with a quick question about how your company handles [workflow]. I can help with that or get you to the right person.

Do not say:

> Hi John, I know exactly who you are

merely because caller ID matched a business line.

Personal name only when sufficiently verified/current and appropriate.

---

# 5. UNKNOWN CALLER

Use normal YAD inbound identification/routing:

- identify Your AI Department;
- ask how caller can be helped;
- do not assume it is a cold prospect.

If caller says:

> Someone from your company called me

search recent outbound attempts using phone/other identifiers and transition to callback context.

---

# 6. CONTEXT PACK

For callback, load compact `CallbackPack`:

- Account identity
- most recent outbound attempt(s)
- voicemail left? yes/no
- primary reason/hypothesis from Call Pack
- rep/agent that attempted
- prior conversation/outcome
- promised follow-up
- DNC/suppression state
- current campaign
- available human/booking actions.

Do not inject entire account research database.

---

# 7. CALLBACK OBJECTIVE

First objective:

Understand why they called back.

Do not immediately restart the cold-call script.

Possible paths:

- wants to know why called
- wants information
- wants to speak to rep
- wants to schedule
- wrong number
- wants no more calls
- returning existing customer/support issue.

---

# 8. “WHY DID YOU CALL ME?”

Answer with original honest business reason.

Example:

> We work with service businesses on lead handling, follow-up, CRM and marketing efficiency. We came across your company while researching HVAC businesses advertising around emergency service, and we had one question about how those inquiries are handled after hours.

Only mention advertising if original evidence/currentness still supports it or phrase historically:

> We had seen...

Do not invent a new reason after the fact.

---

# 9. CALLBACK AFTER VOICEMAIL

If prior voicemail said YAD had a question about a specific workflow:

Callback should align with that workflow.

Do not confuse caller by switching to a completely different pitch unless conversation naturally changes.

---

# 10. CALLBACK AFTER LIVE CONVERSATION

Load prior CallOutcome/ProspectStatements.

If they were supposed to call Brent or schedule:

- continue from agreed next step;
- do not make prospect re-explain the whole problem.

Example:

> Yes — we spoke about the after-hours call workflow. You mentioned wanting your operations manager involved. I can help get that next conversation set up.

Use only verified prior notes.

---

# 11. HUMAN REP ROUTING

If caller asks for Brent/rep:

- check approved availability/transfer configuration;
- warm transfer when possible;
- otherwise create high-priority callback task.

Returning prospect callback should be high priority.

---

# 12. CALLBACK DNC

Caller:

> Stop calling me.

Same DNC semantics:

- durable suppression
- brief acknowledgement
- end.

Do not argue because they called inbound.

---

# 13. WRONG NUMBER

Caller says company/person relationship is wrong.

- mark phone/contact correction;
- prevent repeat outbound attempt;
- preserve Account research separately;
- apologize briefly/end.

---

# 14. EXISTING CUSTOMER / SUPPORT

If callback number belongs to an existing YAD client or caller states support need:

- sales callback context is secondary;
- route to appropriate support/account path.

Do not force sales conversation on existing customer support request.

---

# 15. INBOUND COMPLIANCE / RECORDING

Inbound callback has different legal/policy context from outbound initiation, but recording/transcription/disclosure rules still apply.

Use deterministic inbound policy.

Do not assume inbound call automatically permits recording or every downstream action.

---

# 16. CALLBACK SCORE / ATTRIBUTION

Track:

- original outbound source/campaign
- callback event
- time from attempt to callback
- voicemail vs no voicemail
- query/hook cohort
- callback conversation outcome.

This lets YAD learn whether certain voicemail/hooks drive useful callbacks.

---

# 17. CALLBACK WINDOW

Recent attempt matching should use configurable window.

Examples:

- hours/days for strong automatic context
- older matches may require neutral greeting.

Do not assume a business calling six months later is returning one old cold call.

---

# 18. SHARED BUSINESS NUMBER

Many SMB main lines can be used by several employees.

Even with strong Account match:

- do not assume caller is owner/contact;
- ask role/name naturally if needed.

Account context is safer than person identity.

---

# 19. MULTIPLE OUTBOUND CAMPAIGNS

If same Account has several historical attempts:

- choose latest relevant active campaign
- respect latest disposition/DNC
- do not surface conflicting old pitches.

If ambiguous, ask neutral reason for callback.

---

# 20. CALLBACK CALL PACK FRESHNESS

Do not use stale current-ad claim merely because original call did.

For short callback after same-day attempt, original evidence may still be current.

For delayed callback after TTL:

- describe original research historically if needed;
- do not claim current ad state without refresh.

---

# 21. CRM OUTCOME

Inbound callback creates Call/ContactAttempt event linked to original campaign/account.

Disposition examples:

- inbound_callback_connected
- inbound_callback_booked
- inbound_callback_transfer
- inbound_callback_information
- inbound_callback_dnc
- inbound_callback_wrong_number
- inbound_callback_support_routed.

---

# 22. ROLEPLAY FIXTURES

## A — “You called me”

Expected: identify YAD + original reason, then listen.

## B — wants Brent

Expected: transfer/follow-up, no re-pitch.

## C — DNC

Expected: suppress immediately.

## D — shared line employee

Expected: do not assume owner identity.

## E — support customer

Expected: route support.

## F — callback 30 days after stale ad

Expected: historical language, no current-ad assertion.

---

# 23. ACCEPTANCE

Before outbound campaign uses a callback-capable number:

- inbound route tested
- recent attempt matching works
- unknown callers route safely
- DNC works
- rep transfer/follow-up works
- shared-number identity not overclaimed
- callback attribution stored
- generic receptionist does not hijack sales callback context.
