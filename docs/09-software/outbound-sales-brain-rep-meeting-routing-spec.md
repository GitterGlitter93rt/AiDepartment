# Your AI Department — Rep Assignment, Meeting Routing & Warm Transfer Specification

**Status:** Architecture authority  
**Purpose:** Route researched/qualified prospects to the correct YAD salesperson, strategist, technical reviewer, language-capable rep, or live transfer destination while preserving ownership and context.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The correct next human depends on:

- vertical
- problem
- relationship owner
- geography/timezone
- language
- stage
- technical complexity
- availability
- workload.

Do not hard-code every meeting/transfer to one person forever.

---

# 2. YAD USER CAPABILITY PROFILE

`YADRepProfile`

- user_id
- role
- active
- vertical competencies[]
- territory assignments[]
- supported languages[]
- meeting types[]
- transfer eligibility
- working hours/timezone
- calendar reference
- maximum active account leases
- maximum scheduled meetings/day optional
- technical/commercial approval roles[]
- escalation level.

---

# 3. REP ROLES

Possible:

- SDR / outbound rep
- senior sales / closer
- strategist
- technical solutions
- marketing specialist
- security/privacy reviewer
- sales manager
- business owner/executive.

Small YAD team may have one person fulfilling several roles initially.

Architecture remains role-based.

---

# 4. ACCOUNT OWNER

Once a human meaningfully engages an Account:

- assign relationship owner;
- future callbacks/replies route to owner when appropriate;
- do not re-round-robin an active relationship because another rep is free.

Manager can reassign with reason.

---

# 5. NEW COLD PROSPECT ASSIGNMENT

Possible routing factors:

- campaign
- territory
- vertical skill
- workload
- language
- existing related Account
- round-robin/fairness.

Do not use sensitive personal prospect traits.

---

# 6. MEETING TYPES

Canonical examples:

- free_strategy_call
- executive_ai_strategy_sales_call
- technical_discovery
- marketing_audit
- proposal_review
- implementation_kickoff
- account_expansion

Current CommercialTruthSnapshot controls public naming/pricing.

---

# 7. MEETING ROUTER

Input:

- Account/opportunity
- qualification stage
- vertical
- primary problem
- current owner
- language
- timezone
- technical flags
- stakeholder availability
- meeting type.

Output:

- recommended YAD attendees
- calendar/booking route
- duration configuration
- required prep
- fallback route.

---

# 8. STRATEGY CALL ROUTING

For normal qualified SMB opportunity:

- current sales/strategy owner if capable
- otherwise appropriate strategist/closer.

For complex multi-department/security-heavy opportunity:

- strategy owner may include technical stakeholder later or at meeting according to need.

Do not overload every first strategy call with five YAD people.

---

# 9. TECHNICAL DISCOVERY

Trigger:

- mandatory unverified integration
- complex data architecture
- security/privacy
- custom software
- sensitive workflow.

Route technical owner with StrategyMeetingBrief.

Technical reviewer should not have to reconstruct the entire sales conversation.

---

# 10. WARM TRANSFER

Before offering transfer:

- relationship/call state appropriate
- target user eligible
- target availability known
- context brief ready
- prospect agrees to transfer.

Then transfer.

Do not cold-transfer to an unavailable human.

---

# 11. TRANSFER BRIEF

Human receives screen/context before answering where technically possible:

- company/contact
- vertical
- why YAD called
- 3 confirmed facts
- prospect-verified problem
- current system
- objection/concern
- what prospect wants now
- relevant language
- DNC/contact-policy state
- transcript summary/live context.

---

# 12. TRANSFER INTRODUCTION

AI/rep should introduce naturally:

> “I can bring Brent in—he handles the strategy side. I'll give him the context so you don't have to repeat everything.”

Only if transfer really available.

Avoid overpromising role/expertise not true.

---

# 13. TRANSFER FAILURE

If target declines/unavailable/technical failure:

- return to caller if possible
- apologize concisely
- offer booking/callback
- create task
- do not retry loop repeatedly.

---

# 14. CALENDAR AVAILABILITY

Booking action must use connected calendar/provider availability rather than invent times.

Store:

- timezone
- event/booking ID
- attendees
- source campaign
- opportunity
- reschedule/cancel state.

---

# 15. TIMEZONE

Meeting time presented in prospect's understood local timezone where possible.

Confirm important times verbally/written.

Store canonical timezone, not only floating clock time.

---

# 16. LANGUAGE ROUTING

If prospect prefers supported language:

- route to language-capable human where configured.

If not available:

- be honest about follow-up expectations.

Do not claim bilingual coverage not actually available.

---

# 17. OWNER UNAVAILABLE

Existing relationship owner absent:

Options based on stage:

- schedule owner callback
- approved backup rep with full context
- manager reassignment.

Never make warm prospect restart as cold lead.

---

# 18. HIGH-VALUE / COMPLEX OPPORTUNITY

Escalation may consider:

- multi-location
- enterprise complexity
- large custom scope
- high security/privacy
- multiple stakeholders
- custom software.

Escalation is about capability/authority, not hiding small prospects from senior staff automatically.

---

# 19. REP CAPACITY

Track:

- active leases
- follow-up backlog
- meetings
- response obligations.

Do not assign new cold Accounts to someone already unable to complete requested callbacks.

Relationship commitments come first.

---

# 20. ATTRIBUTION / CREDIT

Preserve:

- prospect discovery source
- original campaign
- first rep
- meeting owner
- closer
- opportunity owner.

Compensation rules are business-policy dependent and should not be inferred by the system.

---

# 21. ACCEPTANCE TESTS

1. Brent owns Account -> requested callback routes to Brent.
2. New HVAC lead, Brent over capacity, another qualified rep available -> assignment per policy.
3. Spanish-preferred prospect -> language-capable route if available, otherwise honest fallback.
4. Complex law-security opportunity -> technical/privacy review scheduled appropriately.
5. Warm transfer offered only when human available.
6. Transfer fails -> booking fallback.
7. Existing relationship owner absent -> backup gets full brief, not cold reset.
8. Calendar has no slot -> do not invent one.
9. Meeting timezone stored correctly.
10. One Account cannot be actively leased by two reps without explicit coordination.

---

# 22. CORE RULE

Routing should preserve relationship continuity and put the right human capability into the conversation at the right time. Availability alone is not the same as fit, and fit is not permission to forget who already owns the relationship.
