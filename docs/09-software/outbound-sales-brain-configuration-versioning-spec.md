# Your AI Department — Prospect Factory / Outbound Sales Brain Configuration & Versioning Specification

**Status:** Architecture authority  
**Purpose:** Define where settings live, which layer has precedence, how releases are versioned, and how historical calls/research remain reproducible.

---

# 1. PRINCIPLE

Do not configure the same business behavior independently in:

- environment variables
- database
- prompt text
- source code
- YAML profile
- provider dashboard.

Every configuration class gets one authoritative home and explicit precedence.

---

# 2. CONFIGURATION CLASSES

## Environment / deployment caps

Examples:

- environment name
- database URL
- secret references
- maximum allowed outbound mode
- test allowlist enforcement
- public base URLs.

## System runtime controls

- global autonomous kill switch
- provider circuit breakers
- maintenance state.

## Compliance policy

- policy version
- allowed contact technologies/jurisdictions/contact bases
- recording/transcription rules.

## Commercial truth

- current offer/pricing/CTA snapshot.

## Vertical profile

- search taxonomy
- business model
- hooks/hypotheses/boundaries.

## Campaign configuration

- market
- mode
- minimum tier
- budgets
- research depth
- voicemail/follow-up objective.

## Provider routing

- selected adapters
- queue/live mode
- limits
- fallback.

## Model/voice configuration

- prompt compiler version
- model
- TTS voice
- STT/endpointing
- RAG config.

---

# 3. PRECEDENCE FOR PERMISSION / SAFETY

Highest restriction wins.

Example outbound call eligibility:

`environment maximum mode`
AND
`global system flag`
AND
`compliance policy`
AND
`campaign mode`
AND
`prospect-level compliance decision`
AND
`current suppression/attempt/time gate`.

No lower layer can override a higher denial.

---

# 4. ENVIRONMENT VARIABLES

Use for:

- secrets/secret references
- deployment addresses
- environment hard caps
- bootstrap infrastructure.

Do NOT use environment variables for frequently changing business data such as:

- current offer price
- campaign score threshold
- current query list
- Sales Manual wording.

---

# 5. SECRETS

Secret values live only in approved secret/environment management.

Repository/config snapshot stores:

- secret name/reference
- provider account alias

not value.

Never put secrets in Call Pack/prompt/audit output.

---

# 6. SYSTEM FLAGS

Durable database/config service:

- autonomous_outbound_kill_switch
- provider_disabled
- maintenance.

Critical changes audited.

Kill switch defaults to safe state after uncertain restore/config corruption.

---

# 7. CAMPAIGN CONFIG IMMUTABILITY

Material campaign changes create version.

Examples:

- territory
- discovery mode
- tier threshold
- budget
- follow-up policy
- model/prompt experiment.

Existing attempts retain campaign version used.

Do not mutate historical meaning.

---

# 8. VERTICAL PROFILE VERSION

Every profile:

- semantic version
- source Manual commit/file hashes
- release date
- schema version.

Call Pack records exact profile version.

If profile changes, new ready packs may regenerate; old call remains linked to old version.

---

# 9. SCORE VERSION

Contains:

- canonical rule version
- recognizer version
- claim registry version
- vertical profile version.

Score snapshot immutable.

Changing a recognition rule creates new score version and fixture run.

---

# 10. CLAIM REGISTRY VERSION

EvidenceRecord stores:

- claim registry version/claim definition version where needed.

If TTL/source eligibility changes:

- current evidence read model may be recalculated
- historical observation remains.

---

# 11. COMMERCIAL TRUTH VERSION

Every live sales interaction records current CommercialTruthSnapshot ID.

Price/offer changes do not rewrite old Call Pack/transcript context.

---

# 12. KNOWLEDGE SNAPSHOT

Sales Manual RAG snapshot:

- repository commit SHA
- indexed file hashes
- chunking/index version
- embedding model/version
- index generated at.

Call records snapshot ID.

---

# 13. PROMPT COMPILER VERSION

Separate:

- invariant instruction version
- compiler code version
- template version
- campaign instruction version.

Do not treat changing model name as same prompt version if compiled context logic also changes.

---

# 14. MODEL CONFIG VERSION

Record:

- provider
- model name/version
- temperature/sampling settings relevant
- timeout
- tool configuration
- response-mode/schema.

For realtime:

- STT
- endpointing
- TTS/voice
- transport.

---

# 15. PROVIDER ADAPTER VERSION

Record with every provider observation/usage.

If parser bug found, system can locate all records produced by affected adapter version.

---

# 16. RESEARCH PROFILE VERSION

Research depth/config:

- pages crawled/priorities
- adapter set
- TTL requirements
- contact enrichment depth
- Meta/Transparency rules.

Store on ResearchRun.

---

# 17. CALL PACK VERSION

Call Pack schema + generation version.

Fields include references to:

- score snapshot
- evidence IDs
- profile version
- CommercialTruthSnapshot
- KnowledgeSnapshot
- strategy generator/prompt version.

Immutable after finalized.

---

# 18. EXPERIMENT VERSION

ExperimentAssignment records:

- experiment ID/version
- variant
- allocation logic
- start/end
- sample restrictions.

Historical outcomes stay tied to actual variant.

---

# 19. PROVIDER ROUTING CONFIG

Routing config can say:

- primary paid SERP provider
- fallback
- queue/live default
- max retries
- cost cap.

Changes audited/versioned because source/provider can affect research quality.

Do not hide provider routing in scattered conditionals.

---

# 20. CONFIG VALIDATION

At startup/config change validate:

- referenced vertical profile exists
- claim registry loads
- score version matches fixtures
- provider routes configured
- campaign mode <= environment cap
- production/autonomous mode cannot enable if required policy missing
- voice config references tested model/voice version.

Fail safely on invalid high-risk config.

---

# 21. STARTUP SAFETY

If configuration partially missing:

Allowed fallback:

- research-only/Human Assist depending safe state.

Not allowed fallback:

- “assume production outbound enabled.”

Missing compliance/system state -> no autonomous call.

---

# 22. CONFIG ADMIN UI

Expose:

- current values
- source of truth
- version
- last changed by/time
- pending/requires restart where applicable.

Do not expose secret values.

---

# 23. ROLLBACK

For:

- prompt version
- vertical profile
- provider adapter/routing
- campaign config

support rollback to known prior version when safe.

Rollback does not delete history.

Compliance policy rollback requires review; do not accidentally reactivate broader old permissions.

---

# 24. RELEASE MANIFEST

Every deployed version can record:

- app commit SHA
- migration version
- claim registry
- scoring
- vertical profiles
- prompt compiler
- knowledge snapshot
- provider adapters
- runtime feature flags.

This makes incidents reproducible.

---

# 25. TEST / STAGING CONFIG

Use explicit different config namespace/accounts.

Do not load production Twilio/contact provider credentials into normal unit test environment.

Staging max mode controlled_test.

---

# 26. FIRST IMPLEMENTATION ACCEPTANCE

Claude must be able to print a redacted configuration report containing:

- environment
- maximum outbound mode
- kill switch
- current claim/scoring/profile versions
- provider routes
- database migration version
- prompt/model config
- no secret values.

This report becomes useful for every gate/incident.
