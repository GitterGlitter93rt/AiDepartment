# Your AI Department — Multi-Channel Outreach Coordination Specification

**Status:** Architecture authority  
**Purpose:** Coordinate human phone calls, Human Assist, Smartlead/cold email, approved SMS, field visits, future Twilio voice, callbacks, and meetings so one Account receives one coherent YAD relationship rather than overlapping campaigns.  
**Implementation owner:** Claude Code

---

# 1. CORE PROBLEM

The same company can appear in:

- Google advertiser mining
- Apollo list
- Smartlead campaign
- local no-website list
- Brent's personal target list
- in-person field route
- future autonomous phone queue
- referral list.

Without one coordination layer, YAD could:

- email someone in the morning;
- cold-call them as a “new prospect” an hour later;
- have a field rep walk in that afternoon;
- send another automated follow-up tomorrow.

That is not automation. That is organizational amnesia.

---

# 2. ACCOUNT-CENTRIC RELATIONSHIP

All channels resolve to canonical Account + Contact + relationship history.

Channel campaigns do not own separate copies of the business.

Required account-wide awareness:

- last outreach
- channel
- owner/rep
- outcome
- DNC/suppression
- requested callback
- email reply
- meeting
- active opportunity
- existing client
- in-flight lease.

---

# 3. CHANNEL TYPES

Canonical:

- HUMAN_PHONE
- HUMAN_EMAIL
- SMARTLEAD_EMAIL
- FIELD_VISIT
- APPROVED_SMS
- AUTONOMOUS_VOICE_TEST
- AUTONOMOUS_VOICE_PRODUCTION if ever approved
- INBOUND_CALLBACK
- WEBSITE_INBOUND
- REFERRAL
- MEETING

Future channels register through the same coordinator.

---

# 4. OUTREACH INTENT

Every outbound event has intent:

- cold_introduction
- followup
- requested_callback
- requested_information
- meeting_confirmation
- proposal_followup
- nurture
- existing_client_expansion
- field_visit

Do not treat every communication as interchangeable outreach.

---

# 5. CHANNEL ELIGIBILITY CHECK

Before sending/placing/assigning contact:

1. Account identity resolved
2. suppression/DNC policy
3. contact-specific policy
4. existing relationship stage
5. active lease/owner
6. promised callback/meeting
7. recent cross-channel outreach
8. campaign/channel policy
9. business/local timing where relevant
10. content/action approved.

---

# 6. CROSS-CHANNEL COOLDOWN

Company policy may configure minimum spacing between unsolicited channels.

Architecture requirement:

- central cooldown calculation
- channel-specific policy
- requested responses/callbacks override generic cold cooldown appropriately
- DNC overrides everything according to scope.

Do not hard-code final cadence values in architecture.

---

# 7. EMAIL REPLY STOPS GENERIC COLD SEQUENCE

If prospect replies meaningfully to Smartlead:

- ingest response/event
- stop/pause generic cold email sequence according to integration/policy
- create relationship state
- assign owner
- route to Human Assist
- do not later call them as `NEVER_CONTACTED`.

A negative reply/opt-out must update suppression according to policy.

---

# 8. HUMAN PHONE AFTER EMAIL

If a rep calls a company that recently received an email:

Call Pack should know the email history.

Possible opening:

> “I sent a short note earlier about your after-hours lead workflow…”

only if the rep/YAD actually sent that message and it is appropriate.

Never pretend email was opened/read unless reliable permitted evidence supports that claim, and avoid creepy tracking language.

---

# 9. FIELD VISIT COORDINATION

Before adding Account to field route:

- no active DNC/suppression
- no booked meeting making a walk-in inappropriate
- no other rep currently working it
- check prior phone/email outcome
- show who to ask for and context.

If prospect said:

> “Don't stop by; email me.”

field route respects that relationship instruction.

---

# 10. AUTONOMOUS VOICE COORDINATION

If ever approved:

- autonomous queue checks recent human/Smartlead/field activity
- cannot call Account currently leased to human rep unless explicit workflow
- cannot bypass requested callback owner
- cannot re-open DNC through another campaign.

Human relationship normally outranks automation.

---

# 11. INBOUND CALLBACK

Inbound call from previously contacted prospect:

- identify recent Account/contact
- load relationship brief
- route to current owner/appropriate callback brain
- stop competing outbound attempts while inbound interaction active.

---

# 12. MEETING OVERRIDE

Once meeting is booked:

- pause ordinary cold sequences
- remove from cold phone/field queues
- allow meeting reminders/appropriate requested communication
- preserve campaign source attribution.

If meeting cancels, route to specific follow-up policy rather than cold reset.

---

# 13. ACTIVE OPPORTUNITY OVERRIDE

Once Opportunity exists:

marketing/prospecting sequences should not independently continue as though Account is top-of-funnel.

All communication routes through opportunity owner/process.

---

# 14. EXISTING CUSTOMER OVERRIDE

If Account is client:

- remove from cold prospecting
- route research signals to account intelligence/expansion workflow
- never send generic “we help companies like yours” cold outreach.

---

# 15. OWNER / LEASE

Every active Account may have:

- sales owner
- temporary outreach lease
- opportunity owner
- account owner after sale.

Coordinator prevents conflicting activities.

Manager can reassign with audit trail.

---

# 16. CHANNEL EVENT OBJECT

`CommunicationEvent`

- account_id
- contact_id
- channel
- direction
- intent
- campaign
- owner
- occurred_at
- outcome
- content/template version where applicable
- response
- suppression impact
- next action
- provider/reference ID

---

# 17. CHANNEL PLAN

`AccountContactPlan`

- relationship_state
- current_owner
- permitted_channels
- blocked_channels
- next_allowed_actions
- due_callback
- active_sequence
- active_meeting
- cooldowns
- rationale
- policy_version.

---

# 18. SMARTLEAD INTEGRATION PRINCIPLE

If Smartlead connector/API is implemented later:

sync:

- campaign/source
- sent message
- reply
- bounce
- unsubscribe/opt-out
- pause state
- contact identity.

Do not make Smartlead a second CRM.

Canonical Account/relationship remains YAD source of truth.

---

# 19. ATTRIBUTION

Preserve first/meaningful source separately from latest touch.

Example:

- discovered via Google advertiser miner
- cold email via Smartlead
- Brent reaches by phone
- meeting books from phone conversation.

Analytics should retain full path.

Do not credit whichever channel happened last automatically for every metric.

---

# 20. CROSS-CHANNEL DNC

Opt-out semantics may differ by channel/policy, but coordinator must enforce the scope returned by deterministic policy engine.

Examples:

- email unsubscribe
- phone DNC
- account-wide no-contact

Model never guesses whether another channel is permitted after opt-out.

---

# 21. ACCEPTANCE TESTS

1. Smartlead reply -> cold phone queue sees engaged relationship, not never-contacted.
2. Email unsubscribe -> policy applies appropriate suppression before future email.
3. Account booked meeting -> removed from cold email/phone/field.
4. Brent leases Account -> later autonomous queue cannot take it.
5. Same business found in Apollo and Google -> one Account relationship.
6. Field rep visits after prior good phone conversation -> sees context.
7. Prospect requested email only -> route plan blocks unapproved field/phone according to policy.
8. Existing customer rediscovered -> no cold sequence.
9. Inbound callback occurs -> competing outbound jobs pause/lease.
10. Cross-channel attribution preserves discovery + touches + meeting source.

---

# 22. CORE RULE

The prospect should experience one Your AI Department relationship regardless of how many tools/channels YAD uses internally.
