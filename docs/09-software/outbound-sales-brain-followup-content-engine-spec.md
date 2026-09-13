# Your AI Department — Follow-Up Content Engine Specification

**Status:** Architecture authority  
**Purpose:** Generate concise, context-specific email/SMS/follow-up drafts after real prospect interactions without fabricating claims, repeating generic brochures, or breaking relationship/compliance state.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Follow-up should answer:

> What did this prospect actually ask for, what did we discuss, and what is the smallest useful next message?

It should NOT dump every YAD service after every call.

---

# 2. INPUTS

`FollowUpContext`

- Account/Contact
- relationship stage
- prior conversation summary
- prospect-verified problem/objective
- exact request
- promised action/material
- objection(s)
- current commercial truth
- approved collateral catalog
- next step/date
- channel permission/policy
- vertical context
- Call Pack / qualification snapshot

---

# 3. FOLLOW-UP TYPES

- requested_information
- requested_email
- requested_callback_confirmation
- meeting_confirmation
- post_meeting_summary
- technical_answer_pending
- integration_verification_pending
- measurement_request
- proposal_followup
- nurture_future
- no_sale_closeout where appropriate

---

# 4. “SEND ME AN EMAIL”

Do not interpret as permission to send a massive pitch deck automatically.

If possible, caller first identifies relevance:

> “Absolutely — which part is most useful: missed-call/lead handling, CRM follow-up, or attribution?”

Then email is specific.

If conversation was too short to identify relevance:

- send brief company/context introduction;
- reference the one public workflow question that prompted outreach;
- invite response/strategy call;
- do not assert the problem exists.

---

# 5. EMAIL STRUCTURE

Recommended short structure:

1. subject relevant to actual topic
2. one-line context
3. what YAD heard / question being investigated
4. one useful idea or requested resource
5. clear next step
6. signature

Avoid:

- 12 bullets of capabilities
- hype about AI replacing teams
- invented ROI
- generic “revolutionize your business” language

---

# 6. SMS STRUCTURE

When approved/appropriate:

- identify YAD/rep
- reference requested context
- one action/link/time
- concise

Example requested callback confirmation:

> “Michael with Your AI Department — confirming I’ll call Friday around 2 PM about the estimate follow-up workflow we discussed.”

Do not put sensitive business detail in SMS unnecessarily.

---

# 7. TECHNICAL QUESTION PENDING

If prospect asks:

> “Can you integrate with X?”

and not verified:

Follow-up state:

- create technical verification task;
- do not send “yes” before verification;
- once verified, response includes exact support/limitations;
- if unsupported, say so clearly and offer alternatives only if legitimate.

---

# 8. MEASUREMENT REQUEST

When opportunity is `MEASUREMENT_FIRST`, follow-up can request only data required to evaluate the issue.

Example:

- missed-call report
- open-estimate count
- consultation no-show rate
- lead-source report
- repetitive task time estimate

Do not request an entire CRM export if three numbers would answer the business question.

---

# 9. MEETING CONFIRMATION

Should include:

- date/time/timezone
- attendees
- what meeting will determine
- any small prep request
- calendar link/confirmation

Do not promise proposal/outcome before discovery.

---

# 10. POST-MEETING SUMMARY

Use:

- confirmed problem
- agreed baseline/unknowns
- desired state
- constraints
- action items by owner
- next date

Avoid adding new claims not discussed.

---

# 11. COLLATERAL CATALOG

Every sendable item should be approved/versioned.

Fields:

- collateral_id
- title
- audience/vertical
- topic
- version
- approved status
- current URL/file reference
- expiration/review date

The model chooses only from approved catalog.

Do not hallucinate case studies, PDFs or demo links.

---

# 12. PERSONALIZATION BOUNDARY

Allowed personalization:

- company name
- observed public service/market
- actual conversation facts
- confirmed system
- requested topic

Do not mention creepy/unnecessary personal details or overstate research.

---

# 13. RELATIONSHIP MEMORY

Every sent/approved follow-up logs:

- content version
- channel
- recipient
- sent_at
- related promise/task
- delivery result where available
- response

Future agent knows what was already sent.

---

# 14. HUMAN ASSIST MODE

Default early behavior:

- AI drafts
- human reviews/sends

This provides labeled quality data before any broader automated follow-up authorization.

---

# 15. AUTOMATED FOLLOW-UP LATER

If later approved, automation still requires:

- campaign/contact policy
- channel permissions
- suppression check
- cadence eligibility
- approved template/content bounds
- idempotency
- send result logging

LLM does not bypass communication policy.

---

# 16. DNC / OPT-OUT

A DNC/opt-out immediately cancels pending promotional follow-up according to policy.

Do not allow an already-generated email/SMS job to send after suppression is written.

---

# 17. NO-SALE FOLLOW-UP

If no-sale because current workflow is strong:

Possible response:

- thank them
- do not manufacture urgency
- optionally note future contact only if prospect requests/agrees or policy allows

A respectful exit is better than turning no-sale into endless nurture.

---

# 18. QUALITY CHECKS

Before send:

- no invented facts
- no stale ad claim
- no unverified integration promise
- no outdated pricing
- no unsupported benchmark presented as prospect result
- correct company/contact
- correct meeting time/timezone
- no contradictory next step
- channel policy passes

---

# 19. ACCEPTANCE TESTS

1. “Send info on missed calls” -> short missed-call specific email, not full service catalog.
2. Prospect asks for integration proof -> task first, no premature yes.
3. Requested Friday callback -> confirmation matches requested time, cadence respects it.
4. DNC written after draft queued -> send canceled.
5. Roofing prospect discussed proposals -> email references proposal workflow, not AI receptionist unless relevant.
6. Law firm follow-up -> no substantive legal/client detail beyond business process.
7. Meeting booked -> confirmation accurately states meeting purpose and time.
8. No-sale strong workflow -> no aggressive automated nurture.
9. Old ad observation stale -> follow-up does not say “I saw you're currently advertising” unless fresh evidence exists.
10. Commercial offer changed -> CommercialTruthSnapshot controls current wording.

---

# 20. CORE RULE

Follow-up should prove YAD listened. It should move the agreed next step forward with the least amount of accurate, relevant content necessary.
