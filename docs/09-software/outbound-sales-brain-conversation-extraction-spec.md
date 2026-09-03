# Your AI Department — Conversation Extraction & Structured Memory Specification

**Status:** Architecture authority  
**Purpose:** Convert calls, meetings, notes, and inbound replies into structured prospect statements, workflow facts, economic inputs, objections, commitments, corrections, qualification changes, and follow-up tasks without treating model inference as verified truth.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

A transcript is not a CRM record.

The system needs to extract useful structured information while preserving:

- what was actually said;
- who said it;
- whether it was an estimate;
- what is inference;
- what was promised;
- what needs human review.

The extractor may propose facts. It does not get to rewrite reality.

---

# 2. INPUT TYPES

- call transcript
- live conversation events
- human rep notes
- strategy meeting transcript
- email reply
- SMS reply where approved
- gatekeeper conversation
- field-visit notes.

Each input has source type/identity/timestamp.

---

# 3. OUTPUT GROUPS

Extract candidates for:

- ProspectStatements
- workflow steps
- systems/tools
- volumes/frequency
- economic inputs
- current pain/constraint
- desired state
- objections
- stakeholder/contact corrections
- requested callback
- meeting commitment
- promised action/material
- DNC/opt-out
- research corrections
- technical questions
- qualification update
- next action.

---

# 4. SOURCE LABELS

Every extracted value must inherit source.

Examples:

- `prospect_verified`
- `prospect_estimate`
- `gatekeeper_statement`
- `rep_observation`
- `model_inference_not_fact`

If prospect says:

> “Probably around 300 calls a month.”

Store:

- value: 300
- unit: calls/month
- source: prospect_estimate
- qualifier: approximately.

Not `system_verified`.

---

# 5. QUOTE ANCHOR

For important statements retain an anchor:

- transcript turn ID / timestamp
- short exact or close quote where retention policy allows.

Example:

`We use Housecall Pro now; switched about two months ago.`

This lets manager verify extraction.

---

# 6. CONFIDENCE IN EXTRACTION VS FACT CONFIDENCE

Separate:

- `extraction_confidence`: did model parse statement correctly?
- `source_truth_class`: what kind of evidence is the statement?

A perfectly extracted prospect estimate remains an estimate.

---

# 7. WORKFLOW EXTRACTION

Identify structured sequence only from stated information.

Example conversation:

> “Calls after six go to answering service. They email us and someone puts it in ServiceTitan in the morning.”

Extract:

- trigger: after-hours call
- system/person: answering service
- handoff: email
- next system: ServiceTitan
- timing: morning/manual
- unknown: whether all calls get entered / source retained / SLA.

Do not infer missing steps.

---

# 8. ECONOMIC INPUTS

Parse:

- quantity
- unit
- period
- service context
- source qualifier

Examples:

- `500 calls/week`
- `about 60 open proposals`
- `$15k typical sold roof` prospect estimate
- `4 hours/week per CSR` estimate.

Never calculate ROI until required fields and assumptions are explicit.

---

# 9. SYSTEM / CRM EXTRACTION

Normalize named systems:

- ServiceTitan
- Housecall Pro
- Jobber
- HubSpot
- Salesforce
- Clio
- CCC
- etc.

If prospect says:

> “I think marketing uses HubSpot but I don't touch it.”

Store:

- HubSpot mentioned
- source: prospect_statement
- confidence/ownership nuance
- current workflow still unknown.

---

# 10. OBJECTION EXTRACTION

Map to Objection Intelligence taxonomy and preserve raw language.

Examples:

> “We already have a receptionist.”

-> existing_receptionist.

> “Call me in January.”

-> timing_not_now + requested future follow-up if explicit.

---

# 11. REQUESTED CALLBACK EXTRACTION

High-priority deterministic validation around phrases such as:

- call Friday at 2
- call next week
- call after 4
- try me tomorrow morning.

Extract:

- date/time/daypart
- timezone context
- contact
- reason.

If ambiguous:

- human/agent confirms before creating exact callback where possible.

---

# 12. DNC EXTRACTION

DNC/stop intent uses the priority-intent detector, not post-call extraction alone.

Post-call extractor verifies/logs:

- exact language
- scope
- suppression event ID.

It may never undo suppression because transcript later seems ambiguous.

---

# 13. RESEARCH CORRECTION

Detect explicit correction:

> “That website is old.”

> “We're not 24/7 anymore.”

> “Sarah doesn't work here.”

> “We stopped running Google Ads last month.”

Create correction candidate linked to existing Evidence/Contact.

Current strategy refreshes accordingly.

---

# 14. PROMISE EXTRACTION

Extract YAD commitments made by rep/agent:

- send email
- verify integration
- call back
- bring demo
- schedule meeting
- get pricing approval.

Compare against Promise Authority Registry.

Any questionable promise gets manager/QA flag.

---

# 15. NEXT ACTION EXTRACTION

Possible:

- callback
- send information
- technical verification
- strategy meeting
- measurement request
- no action
- nurture
- DNC.

Every actionable commitment needs owner/date where applicable.

---

# 16. QUALIFICATION UPDATE

Extractor may propose state update:

- possible opportunity
- qualified discovery
- measurement first
- technical review
- strong workflow/no sale
- disqualified.

Transition rules validate before commit.

---

# 17. HUMAN REVIEW THRESHOLDS

Require review for:

- high-value financial inputs with low extraction confidence
- ambiguous DNC scope
- sensitive professional information
- identity/contact conflict
- major research contradiction
- promise violation
- stage change to proposal-ready/closed states.

Routine high-confidence structured notes may auto-write under policy.

---

# 18. SENSITIVE INFORMATION FILTER

Do not preserve unnecessary:

- legal case facts
- patient health information
- personal sensitive details
- unrelated confidential content.

Extract business-process relevance only where possible.

Example:

Instead of storing detailed medical issue:

`patient inquiry required clinical escalation`.

---

# 19. SUMMARY GENERATION

Produce two summaries:

## Rep/Relationship Summary

Business context, pain, systems, next step.

## Technical/Strategy Summary

Workflow, data, integration, constraints, unanswered questions.

Avoid one bloated paragraph for every audience.

---

# 20. EXTRACTION DIFF

When human corrects extraction:

- retain model proposal
- human final value
- correction reason.

Use corrections to improve extractor evaluation.

---

# 21. ACCEPTANCE TESTS

1. “About 300 calls/month” -> prospect_estimate, not verified.
2. “We switched to Housecall Pro” -> current system statement + prior signal superseded operationally.
3. “Call Friday after 2” -> callback task, no generic cadence.
4. “Stop calling” -> durable DNC already written; extractor confirms.
5. “We already recover every missed call” -> hypothesis contradiction/no-sale candidate.
6. “Can you integrate with CCC?” -> technical question, not integration fact.
7. Rep says “I'll verify that” -> Promise/Follow-up task.
8. Legal prospect shares unnecessary case detail -> sensitive filter excludes detail.
9. Gatekeeper says manager changed -> contact correction candidate.
10. Low-confidence monetary extraction -> human review required.

---

# 22. CORE RULE

The Conversation Extractor turns language into structured memory, but every value must retain its provenance. Clean CRM data is not worth having if the system silently upgrades estimates and inference into facts.
