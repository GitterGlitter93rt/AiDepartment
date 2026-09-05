# Your AI Department — Sales Promise Authority Registry

**Status:** Architecture authority  
**Purpose:** Control what salespeople, AI agents, proposal generators, and follow-up systems are allowed to promise, what requires verification/approval, and what is prohibited.  
**Source doctrine:** Sales Manual Module 9 Promise Authority.  
**Implementation owner:** Claude Code

---

# 1. WHY THIS EXISTS

The fastest way to destroy delivery quality is to let sales promise things implementation cannot support.

Promise control must exist as structured data, not just training advice.

---

# 2. PROMISE CLASSES

## `APPROVED_GENERAL`

May be discussed using current approved wording.

Examples:

- YAD methodology
- current approved offers
- documented capability categories
- approved indicative ranges
- approved example workflows.

## `VERIFICATION_REQUIRED`

May be discussed only conditionally until verified.

Examples:

- specific integration
- exact data migration
- vendor compatibility
- custom feature
- security architecture requirement
- exact delivery date.

## `APPROVAL_REQUIRED`

Requires authorized business approval.

Examples:

- custom price
- discount
- payment terms
- custom SLA
- exclusivity
- unusual support commitment
- scope expansion.

## `PROHIBITED`

Cannot be promised.

Examples:

- guaranteed financial result
- legal/regulatory outcome
- unverified security/compliance certification
- deceptive behavior
- professional judgment replacement beyond approved boundary.

---

# 3. REGISTRY OBJECT

`PromiseRule`

- rule_id
- category
- promise_type
- allowed_status
- approved_wording optional
- conditional_wording optional
- prohibited_wording[]
- required_evidence[]
- required_approval_role[]
- vertical_overrides[]
- effective_at
- expires/review_at
- source_authority
- version

---

# 4. INTEGRATION PROMISE

Default:

`VERIFICATION_REQUIRED`

Allowed:

> “We'd need to verify that specific integration before I put it in scope.”

Confirmed only after technical verification record exists for the specific context/scope.

Do not infer support merely because vendor has an API.

---

# 5. PRICING PROMISE

Use CommercialTruthSnapshot + approved quote.

Allowed general ranges only if current authority supports them.

Custom price requires appropriate approval.

Managed AI Department pricing remains custom until authority defines otherwise.

No model-generated discounts.

---

# 6. TIMELINE PROMISE

Exact date/duration is `VERIFICATION_REQUIRED` unless approved for a simple standardized offer.

Allowed:

- phased implementation approach
- approved milestone range

Prohibited:

> “We'll have everything live Friday.”

without approved plan/dependencies.

---

# 7. RESULTS PROMISE

Financial/business results:

`PROHIBITED` as guarantees.

Allowed:

- baseline
- scenario
- target
- measurement plan
- historical approved case study with limitations.

Do not convert target KPI into promised outcome.

---

# 8. SECURITY / COMPLIANCE PROMISE

Default:

`VERIFICATION_REQUIRED` or `PROHIBITED` depending claim.

Do not say:

- HIPAA compliant
- legally compliant
- secure
- ABA-compliant
- TCPA compliant

as broad guarantees without defined verified scope/appropriate authority.

YAD can describe controls/architecture and coordinate review.

---

# 9. PROFESSIONAL BOUNDARY PROMISES

Prohibited:

- AI will decide legal case acceptance
- AI will diagnose patients
- AI will determine electrical safety
- AI will determine repairability
- AI will decide insurance coverage
- AI will make regulated professional decisions beyond approved human-review design.

---

# 10. SUPPORT / REVISION PROMISES

Unlimited support/revisions are not implied.

Proposal scope must define:

- support period
- optimization scope
- ongoing managed scope
- exclusions.

Anything beyond standard authority requires approval.

---

# 11. CASE STUDY / CREDENTIAL PROMISES

Only approved verified case studies, metrics, customer references and credentials may be used.

The model must not create social proof because it would help close the deal.

---

# 12. PROMISE CHECK TOOL

Before agent/proposal says a material commitment, system may call deterministic:

`check_promise_authority(promise_type, proposed_value, scope_context)`

Returns:

- allowed
- conditional
- verification_required
- approval_required
- prohibited
- approved wording
- missing evidence/approval.

---

# 13. LIVE CONVERSATION BEHAVIOR

If verification/approval required:

> “I need to verify that before I promise it.”

This is preferred over speculation.

Create follow-up task automatically when relevant.

---

# 14. PROPOSAL GATE

Proposal compiler checks every:

- integration
- price
- timeline
- support commitment
- KPI/result statement
- security/compliance statement

against registry.

Client-ready status blocked on violations.

---

# 15. PROMISE AUDIT

QA should compare:

- transcript
- email/SMS
- proposal
- demo

against Promise Registry.

Flag:

- unauthorized promise
- unsupported specificity
- guarantee
- stale commercial truth
- false technical claim.

---

# 16. DELIVERY VISIBILITY

Delivery handoff includes every material promise made to client with:

- source conversation/proposal
- authority/evidence
- status
- owner.

Delivery should never discover promises only through client recollection.

---

# 17. ACCEPTANCE TESTS

1. Prospect asks “Can you integrate with CCC?” with no verification -> conditional/verification required.
2. Prospect asks exact launch date -> verification required.
3. Rep offers 25% discount without authority -> blocked.
4. Proposal says guaranteed 20% ROI -> prohibited.
5. Dental prospect asks if solution is HIPAA compliant -> no broad guarantee; technical/privacy review.
6. Current approved price range -> may state range with scope caveat.
7. Managed AI Department fixed package invented -> blocked.
8. Approved case study metric -> allowed only with source/limitations.
9. Promise made in call -> appears in delivery handoff.
10. Old commercial truth changes -> old promise rules remain historical, new outbound uses current version.

---

# 18. CORE RULE

When sales is uncertain, uncertainty must become a verification task — not a confident promise.
