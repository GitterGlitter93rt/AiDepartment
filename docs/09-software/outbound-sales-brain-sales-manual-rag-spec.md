# Your AI Department — Sales Manual Knowledge Index / RAG Specification

**Status:** Architecture authority  
**Purpose:** Make the canonical Sales Manual searchable by the pre-call strategy brain, human-assist UI, live voice agent, and post-call QA without creating a drifting duplicate sales doctrine.

---

# 1. SOURCE OF TRUTH

Primary sales knowledge:

`docs/07-sales/training-manual/**`

Commercial truth precedence:

`docs/00-company/launch-decisions.md`

If a Sales Manual passage contains an older commercial detail that conflicts with launch decisions, launch decisions control.

The RAG/index is a derived artifact. It is never the authoritative source itself.

---

# 2. USE CASES

## Pre-call strategy

Retrieve:

- vertical guidance;
- hook family;
- prospecting doctrine;
- CRM/system positioning;
- likely objections;
- relevant ROI method;
- next-step guidance.

## Human assist

Rep can search:

- “what do I say if they already use ServiceTitan?”
- “law firm after-hours intake hook”
- “how do I explain CRM?”

## Live voice

Retrieve a very small answer when prospect introduces a new topic not already in Call Pack.

## Post-call QA

Retrieve exact doctrine used to evaluate behavior.

---

# 3. INDEX BUILD INPUT

At index time record:

- repository commit SHA;
- included paths;
- excluded/generated files;
- parser/chunker version;
- embedding model/version;
- lexical-index version;
- build timestamp.

Create `KnowledgeSnapshot` with this metadata.

Every Call Pack stores the snapshot ID.

---

# 4. CHUNKING

Prefer semantic markdown structure.

Chunk boundaries:

- module;
- H1/H2/H3 heading;
- coherent subsection;
- script/example kept with its explanation where possible;
- evidence card kept with limitations/approved wording.

Do NOT slice blindly every N tokens if it separates:

- statistic from limitation;
- objection from forbidden wording;
- ROI formula from disclaimer;
- script from context.

---

# 5. CHUNK SIZE

Initial target:

- roughly 250–900 tokens depending on semantic section;
- small enough for precise retrieval;
- large enough to preserve doctrine/limitations.

Long lists may be split by subheading while retaining parent metadata.

---

# 6. METADATA

Each chunk:

- `chunk_id`
- source path
- source commit
- module number
- module title
- heading path
- vertical(s)
- sales stage(s)
- topic tags
- hook family
- objection category
- CRM/system tags
- ROI tool tags
- evidence-card flag
- approved/forbidden wording flag
- sensitivity/safety tags
- commercial-truth risk flag
- chunk text
- hash

---

# 7. CORE TOPIC TAXONOMY

Examples:

- sales_doctrine
- cold_calling
- gatekeeper
- discovery
- financial_diagnosis
- roi
- crm
- missed_calls
- after_hours
- speed_to_lead
- follow_up
- attribution
- employee_capacity
- reporting
- reactivation
- objections
- closing
- proposal
- integration
- employee_safe
- technical_boundary
- evidence
- roleplay
- management

---

# 8. RETRIEVAL METHOD

Use hybrid retrieval:

- lexical/BM25 or equivalent;
- semantic embeddings;
- metadata filters/boosts;
- optional reranker if latency/cost justifies it.

Do not rely solely on embeddings for exact phrases like system names or objection labels.

---

# 9. PRE-CALL RETRIEVAL QUERY

Input:

- vertical;
- prospect signals;
- primary hypothesis;
- backup hypothesis;
- system signals;
- offer hypothesis;
- likely objection categories;
- campaign objective.

Retrieve bounded set:

1. relevant cold-call doctrine;
2. vertical-specific primary hook guidance;
3. backup hook guidance;
4. CRM/system positioning if relevant;
5. top likely objections;
6. relevant ROI discipline;
7. next-step doctrine.

Strategy model synthesizes Call Pack.

---

# 10. LIVE RETRIEVAL CONTRACT

Live model should call retrieval only when:

- prospect asks unexpected material question;
- new objection not covered in Call Pack;
- specific YAD capability/policy needs canonical guidance;
- integration/price/commercial question requires current truth.

Do NOT live-retrieve for every normal turn.

Input:

- conversation intent;
- vertical;
- latest prospect utterance;
- current hypothesis;
- allowed topic filters.

Output:

- max 1–3 chunks;
- concise extracted guidance;
- source references;
- confidence;
- commercial-truth warning if applicable.

---

# 11. LIVE LATENCY BUDGET

Live retrieval target:

- p50 < 150 ms local index retrieval;
- p95 < 300 ms where feasible;
- reranking only if it stays within product latency budget.

If live retrieval exceeds configured timeout:

Use safe fallback rather than leaving dead air.

Examples:

Integration question:

> I’d need to verify that specific integration before I promise it.

Pricing question:

Use current commercial truth already included in safe base context or offer human follow-up.

---

# 12. COMMERCIAL TRUTH LAYER

Do not rely on semantic ranking alone for:

- prices;
- CTA names;
- assessment price;
- booking provider;
- current offer names;
- discount authority.

Create a small deterministic `CommercialTruthSnapshot` derived from current authority document.

Inject into Call Pack/live base context.

Example current facts:

- AI Department Assessment: free;
- AI Strategy Call: free;
- Executive AI Strategy: approximately $5,000+ starting point depending scope;
- AI Implementation: approximately $5,000–$50,000+ depending scope;
- AI Growth Systems: custom;
- Managed AI Department: custom monthly retainer;
- scheduling provider: Calendly;
- paid appointment provider: Stripe where applicable.

Never let an older retrieved chunk override this layer.

---

# 13. EVIDENCE CARD HANDLING

Evidence/statistics are special chunks.

Include together:

- claim;
- population/source;
- approved wording;
- forbidden overgeneralization;
- limitation;
- source reference;
- review status/date where available.

If evidence register marks claim pending/stale/unverified:

Do not give live agent permission to state it as settled fact.

---

# 14. SCRIPT HANDLING

Scripts are examples, not verbatim mandatory speech.

Metadata:

- channel: phone/field/voicemail;
- vertical;
- trigger/context;
- objective.

Live model should preserve doctrine and naturalness rather than reciting the same script every call.

---

# 15. OBJECTION RETRIEVAL

Query intent examples:

- already_have_crm
- already_have_receptionist
- marketing_agency
- IT_company
- use_chatgpt
- customers_want_humans
- price
- ROI_guarantee
- integration
- send_email
- too_busy

Prefer vertical-specific objection chunk if available, then general objection module.

---

# 16. HIERARCHICAL FALLBACK

For HVAC `we use ServiceTitan`:

1. HVAC-specific ServiceTitan objection.
2. General `we already have a CRM` guidance.
3. CRM fundamentals.
4. Sales doctrine.

Do not retrieve unrelated software competitive-positioning chunk just because `ServiceTitan` semantically resembles SaaS.

---

# 17. QUERY EXPANSION

Use vertical/profile synonyms for retrieval.

Example:

`field service software`

may map to:

- CRM
- ServiceTitan
- Housecall Pro
- Jobber
- lead routing
- follow-up

But preserve exact prospect term in context.

---

# 18. KNOWLEDGE UPDATE

On relevant repository change:

1. detect changed source files;
2. rebuild affected chunks/index;
3. create new KnowledgeSnapshot;
4. do not mutate old snapshot;
5. new Call Packs use new snapshot;
6. existing calls/history keep old snapshot reference.

No automatic production prompt change solely because index rebuilt; content changes are source-controlled/manual-reviewed.

---

# 19. EMPTY / MISSING KNOWLEDGE

If repository does not define an answer:

- mark unknown;
- do not invent policy/capability;
- offer technical/commercial follow-up.

This follows the repository Empty File / Claims rule.

---

# 20. RAG TEST QUERIES

The following must retrieve correct doctrine in top results.

## HVAC

- `we use ServiceTitan`
- `answering service handles after hours`
- `customers want humans`
- `AI cannot diagnose HVAC`
- `unsold replacement estimate`
- `paid Google after-hours call`

## Plumbing

- `we use Housecall Pro`
- `dispatchers already handle it`
- `most business referrals`
- `larger sewer estimate follow-up`

## General

- `what is a CRM`
- `send me an email`
- `we already have a receptionist`
- `we have an IT company`
- `we have a marketing agency`
- `guarantee ROI`
- `can you integrate with X`
- `cold call opener`
- `gatekeeper`
- `do not feature dump`

---

# 21. RAG PASS CONDITIONS

For gold test set:

- relevant canonical chunk in top 3 for >=95% of straightforward queries;
- no conflicting outdated commercial truth selected as authoritative;
- evidence chunk includes limitation with statistic;
- vertical-specific objection preferred when available;
- empty/missing capability yields uncertainty, not fabrication.

Tune with test set before adding sophisticated reranker.

---

# 22. HUMAN-ASSIST SEARCH

Rep search results should show:

- concise answer;
- module/heading;
- source link;
- vertical relevance;
- “say this / don't say this” where applicable.

Do not show embedding scores to salespeople.

---

# 23. QA USE

QA grader retrieves doctrine after the call using:

- hook used;
- objections encountered;
- claims made;
- financial-diagnosis behavior;
- vertical boundaries.

It should cite exact manual sections in internal coaching output so managers can understand why a behavior was flagged.

---

# 24. SECURITY

The Sales Manual is internal company knowledge.

Do not expose the entire internal manual or hidden coaching notes to a prospect through tools/prompts.

The live agent uses doctrine to answer; it does not offer to send internal manuals.

Restrict knowledge-search endpoint to authenticated internal/realtime services.

---

# 25. ACCEPTANCE MILESTONE

Before realtime phone integration, Claude should be able to run a local test suite where each of the RAG test queries returns the expected module/section and a strategy generator produces a Call Pack without copying the entire manual into context.
