# Your AI Department — Sales AI Conversation Optimization Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Improve the outbound Sales AI from reviewed calls without letting one bad conversation or a small sample cause uncontrolled prompt drift.

---

# 1. PRINCIPLE

The sales conversation is versioned software.

Do not edit the live prompt after every call.

Optimization loop:

`call -> structured QA -> root cause -> change proposal -> text regression -> controlled voice test -> reviewed pilot -> promote/reject`.

---

# 2. VERSIONED COMPONENTS

Track separately:

- core Sales AI script/process version;
- dialogue policy version;
- opener selector version;
- response-card version;
- state-machine version;
- strategy-call qualification policy version;
- prompt-composition version;
- model/provider/version;
- TTS voice/config;
- STT config;
- Call Pack contract/version;
- vertical profile/version;
- Cal.com booking adapter/version.

This allows YAD to know whether an improvement came from language, model, data or voice/runtime changes.

---

# 3. ROOT-CAUSE CLASSIFICATION

Every reviewed bad call should be assigned one primary cause when possible:

- bad prospect/contact data;
- weak/misclassified hypothesis;
- wrong opener selection;
- generic/scripted response;
- listening failure;
- objection response failure;
- qualification/booking threshold failure;
- hallucinated/unsupported claim;
- state-transition failure;
- working-memory failure;
- retrieval/manual failure;
- TTS/prosody;
- STT;
- latency/transport;
- booking/tool action;
- policy/compliance;
- operator/configuration;
- unknown.

Do not solve a TTS problem by rewriting the sales script.

---

# 4. CHANGE PROPOSAL

Before changing live conversation behavior, capture:

```text
ConversationChangeProposal
- proposal_id
- issue observed
- supporting call_ids[]
- root_cause
- component_to_change
- current behavior
- proposed behavior
- expected benefit
- possible downside
- affected fixtures[]
- author
- reviewer
- status
```

---

# 5. REGRESSION FIRST

Any significant conversation change must rerun relevant existing fixtures.

Examples:

Changing `not interested` behavior must retest:

- no-pain rejection;
- bad-timing rejection;
- explicit call ending;
- DNC;
- busy owner.

Changing booking close must retest:

- confirmed pain;
- polite/no pain;
- booking failure;
- no slots;
- prospect asks price first.

Do not improve one scenario while silently breaking three others.

---

# 6. GOLD DIALOGUES

`outbound-sales-brain-sales-ai-gold-dialogues-v1.md` is a style/process reference.

Gold dialogues are not immutable doctrine.

If real calls show a better natural behavior:

- propose update;
- ensure it still follows Sales Manual truth/process;
- revise gold reference after review.

---

# 7. EXPERIMENTS

Allowed controlled experiment categories may include:

- honest opener phrasing;
- question wording;
- short YAD explanation;
- strategy-call close wording;
- `send email` clarification wording;
- voicemail wording;
- TTS voice/prosody/config.

Do not experiment with:

- deception;
- fake urgency;
- fake referral;
- ignoring DNC;
- fabricated social proof;
- unsupported ROI;
- weakening compliance;
- employee-replacement positioning.

---

# 8. OPTIMIZATION METRICS

Do not optimize for one metric.

Track:

- correct stakeholder conversations;
- prospect engagement after first question;
- meaningful problem discovery;
- qualified strategy-call offer rate;
- accepted/booked rate;
- attended rate;
- Michael-rated qualification quality;
- opportunity creation;
- no-sale accuracy;
- DNC/negative reaction;
- average turn latency;
- interruption success;
- hard fails;
- call duration;
- contact correction value.

A wording variant that books more meetings but lowers meeting quality is not automatically better.

---

# 9. SMALL SAMPLE CAUTION

The first calls are highly noisy.

One charismatic prospect can make a weak script look excellent.

One hostile prospect can make a good script look bad.

Use early calls to identify obvious defects, not claim statistical superiority.

When enough volume exists, compare variants within similar:

- vertical;
- market;
- target role;
- source/contact quality;
- hypothesis;
- advertiser cohort.

---

# 10. HUMAN REVIEW

Michael/manager should be able to mark exact transcript/audio moments:

- `great line`;
- `too long`;
- `robotic`;
- `missed what they said`;
- `good question`;
- `bad assumption`;
- `should have booked here`;
- `booked too early`;
- `should have ended here`;
- `voice/pronunciation issue`.

These annotations can generate structured change proposals.

---

# 11. PROMOTION

Conversation configuration states:

- draft;
- regression_testing;
- internal_voice_test;
- controlled_pilot;
- approved_current;
- rolled_back;
- retired.

Promotion requires recorded test/review evidence.

---

# 12. ROLLBACK

Keep last-known-good conversation package available.

If new version produces:

- hallucinated facts;
- repetitive objection loops;
- lower DNC reliability;
- booking mistakes;
- severe naturalness regression;
- unexpected call-length explosion;

operator can revert current configuration without code surgery.

---

# 13. CORE RULE

**Improve the Sales AI like a product: diagnose the actual failure, change the smallest responsible component, regression-test it, and promote only after reviewed evidence.**
