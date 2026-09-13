# Your AI Department — Commercial Truth Snapshot Specification

**Status:** Architecture authority  
**Canonical source:** `docs/00-company/launch-decisions.md` and any explicitly designated newer commercial authority  
**Purpose:** Give sales/realtime systems a small deterministic source for current offer names, approved pricing language, CTAs and commercial boundaries so semantic retrieval cannot surface stale business terms.

---

# 1. PRINCIPLE

Commercial truth is different from Sales Manual doctrine.

Sales doctrine can be retrieved semantically.

Current pricing/offer/CTA truth must be deterministic and versioned.

The model should never choose among conflicting old/new prices based on embedding relevance.

---

# 2. SNAPSHOT FIELDS

`CommercialTruthSnapshot`:

- snapshot ID
- source repository commit SHA
- source file hashes
- generated/reviewed timestamp
- status: active/superseded
- company/brand name
- current offer families
- public entry points
- approved pricing language
- pricing status: fixed / starting point / custom / not finalized
- scheduling provider/process
- payment provider/process where relevant
- discount authority if defined
- current CTAs
- prohibited/stale commercial statements
- reviewer/approval metadata.

---

# 3. CURRENT ARCHITECTURE EXAMPLE

Implementation must read the current launch decisions rather than trust this example indefinitely.

Current reviewed concepts at architecture time include:

- AI Department Assessment — free
- AI Strategy Call — free
- Executive AI Strategy — approximately $5,000+ starting depending scope
- AI Implementation — approximately $5,000–$50,000+ depending scope
- AI Growth Systems — custom
- Managed AI Department — custom monthly retainer
- Google Ads
- Meta Ads
- SEO
- AI Training / Workshops / Executive AI Coaching
- Calendly as current scheduling provider
- Stripe as current payment provider for paid appointments where applicable.

Source changes always win.

---

# 4. OFFER RECORD

Each offer:

- offer ID
- display name
- status: active/paused/internal/not-public
- category
- description safe for sales use
- pricing type
- amount/range/starting language if approved
- CTA/next step
- qualification notes
- scope disclaimers
- forbidden promises.

---

# 5. PRICING TYPE

Values:

- `free`
- `fixed`
- `starting_at`
- `range_starting`
- `custom`
- `not_finalized`
- `not_public`

The renderer chooses wording based on type.

Do not convert `starting_at` into a guaranteed fixed price.

---

# 6. PRICE RESPONSE RULE

If prospect asks price:

## Fixed/free current offer

Agent may state current approved price/status.

## Starting/custom implementation

Agent states approved starting/range/custom language and explains scope depends on workflow.

## Not finalized/unknown

Agent does not invent; offers commercial follow-up.

---

# 7. DISCOUNT AUTHORITY

If launch decisions do not define discount authority:

- agent cannot negotiate arbitrary discount
- rep cannot claim special promotion not in commercial truth.

Any future discount policy is explicit snapshot field.

---

# 8. CTA

Current sales next-step actions can include:

- Assessment
- Strategy Call
- Executive AI Strategy
- technical review
- custom proposal after diagnosis.

Snapshot maps offer to current booking/payment flow.

Do not hard-code old scheduling URLs inside prompts.

---

# 9. SNAPSHOT GENERATION

Preferred process:

1. read current authority file
2. parse/normalize defined offer/pricing decisions
3. validate required fields
4. compare with previous snapshot
5. human/implementation review for material commercial change
6. store new immutable snapshot
7. mark current pointer.

Do not auto-deploy ambiguous changes from prose without validation.

---

# 10. MATERIAL CHANGE

Examples:

- price/range changes
- free becomes paid
- offer renamed/removed
- new commercial product
- scheduling provider changes
- payment flow changes
- public CTA changes
- discount authority added.

Material change triggers:

- new snapshot
- Call Pack regeneration where relevant
- regression tests for price/offer scenarios.

---

# 11. CALL PACK

Call Pack stores snapshot ID and only relevant current offer facts.

Live prompt gets compact commercial truth.

No need to inject every YAD service if call is about a simple strategy-call next step.

---

# 12. RAG PRECEDENCE

If retrieved Sales Manual says:

> Strategy call costs X

but CommercialTruthSnapshot says free:

CommercialTruthSnapshot wins.

QA should flag model if it states stale retrieved price.

---

# 13. EMPTY / AMBIGUOUS SOURCE

Repository rule remains:

If authority does not define a commercial fact:

- unknown
- no invention.

Do not infer price from old proposal/client memory.

---

# 14. FIXTURE A — FREE STRATEGY CALL

Current snapshot says free.

Old retrieved chunk says $X.

Expected:

- model says current free status
- stale chunk ignored for price.

---

# 15. FIXTURE B — CUSTOM MANAGED AI DEPARTMENT

Prospect asks:

> Is that $2,500 a month?

Snapshot says custom monthly retainer, no universal fixed price.

Expected:

- do not confirm $2,500 universally
- say scope/pricing is custom and needs diagnosis/current commercial review.

---

# 16. FIXTURE C — IMPLEMENTATION

Snapshot contains starting/range language.

Expected:

- describe as starting/range depending scope
- do not quote top/bottom as guaranteed proposal.

---

# 17. ACCEPTANCE

- current commercial source always traceable
- every Call Pack records snapshot ID
- stale manual price cannot override current snapshot
- missing price produces unknown/follow-up
- no arbitrary discounts
- offer/CTA changes create new snapshot/history.
