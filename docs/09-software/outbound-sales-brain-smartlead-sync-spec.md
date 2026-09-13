# Your AI Department — Smartlead Synchronization Specification

**Status:** Architecture authority  
**Purpose:** Integrate Smartlead as an outbound email execution channel while keeping Account identity, relationship memory, suppression, research, attribution, and qualification inside the YAD Sales Brain.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Smartlead is an email execution platform, not YAD's master prospect database.

Canonical relationship state remains in YAD.

---

# 2. EXPORT TO SMARTLEAD

Only export prospects passing:

- canonical Account/contact resolution
- email/contact eligibility
- campaign policy
- cross-channel relationship gate
- suppression/opt-out checks
- research freshness required for personalization
- approved email variant.

---

# 3. MINIMUM EXPORTED DATA

Prefer least necessary:

- email
- first name if verified
- company name
- selected personalization fields
- campaign/account correlation IDs where supported
- source/rep identifiers needed for attribution.

Do not export:

- internal DNC reasons beyond needed suppression action
- sensitive transcripts
- detailed financial notes
- unnecessary private data
- secret/internal prompt content.

---

# 4. CORRELATION

Every external lead should be recoverable to:

- account_id
- contact_id
- YAD campaign_id
- email variant
- research/call-pack version where relevant.

Do not rely only on email address as permanent identity.

---

# 5. INBOUND EVENTS

Sync relevant events if API/webhooks support them:

- campaign assignment
- email sent
- delivery/bounce
- reply
- unsubscribe
- spam/complaint where available
- sequence stopped/paused
- campaign complete.

Claude must verify current Smartlead API/webhook capabilities during implementation.

---

# 6. REPLY HANDLING

On meaningful reply:

1. attach to canonical Account/contact;
2. classify reply;
3. update relationship state;
4. pause/stop generic sequence where appropriate;
5. assign human owner;
6. create task/meeting/callback as needed;
7. prevent contradictory cold outreach.

---

# 7. REPLY CLASSES

- POSITIVE_INTEREST
- QUESTION
- SEND_INFO
- CORRECT_PERSON_REFERRAL
- TIMING_LATER
- ALREADY_SOLVED
- NOT_INTERESTED
- UNSUBSCRIBE_OPT_OUT
- WRONG_PERSON
- WRONG_COMPANY
- OUT_OF_OFFICE
- BOUNCE
- OTHER_REVIEW.

Do not auto-book or send complex answers purely from classifier without relevant policy/tool checks.

---

# 8. UNSUBSCRIBE / OPT-OUT

Smartlead unsubscribe event must reach YAD suppression/policy engine promptly.

Scope (email-only/account-wide/etc.) is determined by approved policy, not guessed by the model.

Pending emails must stop accordingly.

---

# 9. BOUNCE

On hard bounce:

- mark email endpoint invalid/stale
- do not mark Account bad prospect
- allow contact enrichment/role routing if legitimate.

Do not repeatedly resend same invalid address.

---

# 10. OUT-OF-OFFICE

Extract return date if clear.

Do not classify as positive/negative.

May pause/reschedule email sequence according to policy.

Do not create phone cold call just because email OOO occurred unless channel plan independently permits it.

---

# 11. CORRECT-PERSON REFERRAL

If reply:

> “You need Sarah, our Ops Director.”

Create/update Contact candidate and role route.

Preserve referral source.

Do not fabricate Sarah's email; enrich/verify through approved methods.

---

# 12. PERSONALIZATION VERSION

Store which:

- subject variant
- personalized line
- hook family
- CTA

was sent.

This allows outcome attribution to actual email strategy.

---

# 13. RESEARCH CHANGE AFTER EXPORT

If prospect is queued but not yet sent and key personalization becomes stale/contradicted:

- update/pause lead if integration permits;
- otherwise avoid exporting far ahead of intended send where stale evidence matters.

The system should not generate months of ad-specific emails from one research snapshot.

---

# 14. DUPLICATE PREVENTION

Before export:

- same Account/contact not active in conflicting Smartlead campaigns
- same email not duplicated unintentionally
- cross-vertical relationship checked
- existing client/opportunity blocked from generic cold sequence.

---

# 15. CAMPAIGN SOURCE ATTRIBUTION

Preserve:

- Market Miner discovery source
- Smartlead campaign
- email variant
- later phone/field touches
- meeting/opportunity source path.

Do not give all credit to Smartlead merely because first reply occurred there.

---

# 16. HUMAN OWNERSHIP

Positive/question replies default to Human Assist ownership early.

AI can draft reply using Follow-Up Content Engine.

Human reviews/sends until automation for that reply class is explicitly approved.

---

# 17. FAILURE HANDLING

Smartlead unavailable:

- durable outbox/retry
- no duplicate export
- status visible
- Human Assist phone/field may continue only if cross-channel policy allows.

Webhook/event duplicate:

- idempotent ingestion.

---

# 18. API SECRETS

Smartlead credentials server-side.

Never expose to browser/model/log.

Least privilege where supported.

---

# 19. ANALYTICS

Per campaign/variant:

- exported
- delivered
- bounce
- replies
- positive
- referral
- meetings
- qualified opportunities
- unsubscribes/complaints
- downstream opportunity/revenue where eventually available.

Compare by:

- vertical
- tier
- advertiser status
- hook
- target role
- research personalization level.

---

# 20. ACCEPTANCE TESTS

1. Same Account already active in human opportunity -> not exported to cold Smartlead.
2. Positive reply -> generic sequence pauses + human task.
3. Unsubscribe -> suppression sync.
4. Hard bounce -> email invalid, Account retained.
5. Correct-person referral -> new Contact candidate, no invented email.
6. Duplicate webhook -> one event state change.
7. Stale ad personalization before send -> refresh/downgrade.
8. Smartlead outage -> durable retry, no duplicate lead creation.
9. Cross-vertical duplicate campaign -> coordinator blocks conflicting cold sequence.
10. Analytics retain discovery source + email variant + later meeting.

---

# 21. CORE RULE

Smartlead should execute YAD's email strategy, not become a disconnected second sales organization. Every send and reply must feed the same Account memory and relationship logic as phone, field and meetings.
