# CLAUDE CODE — SALES AI OPTIMIZATION LATEST

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Point implementation at the latest conversation-selection and downstream-quality architecture without replacing the current core script/pilot authority.

This supplements:

- `CLAUDE-CURRENT-TASK.md`
- `CLAUDE-SALES-AI-PILOT-CURRENT.md`
- `CLAUDE-SALES-AI-PILOT-LATEST-ADDENDUM.md`
- `CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md`

Preserve completed implementation. Reconcile these files into the appropriate next conversation/analytics/CRM gate.

---

# 1. READ THESE NEW FILES

1. `outbound-sales-brain-cold-call-external-research-evidence-2026-09.md`
2. `outbound-sales-brain-sales-ai-hook-selection-matrix.v1.yaml`
3. `outbound-sales-brain-sales-ai-objection-language-fixtures.v1.yaml`
4. `outbound-sales-brain-strategy-call-outcome-feedback-spec.md`
5. `outbound-sales-brain-strategy-call-outcome-contract.v1.yaml`

These extend existing opener, hook-backtest, objection, CRM, Meetings and analytics specs.

---

# 2. EXTERNAL RESEARCH SYNTHESIS

Do not hard-code vendor benchmark percentages into the agent.

Use public research only to prioritize what YAD tests first.

Current directional synthesis:

- research/personalization matters;
- state the reason for the call early;
- avoid generic `Did I catch you at a bad time?` as default;
- do not make the cold call an eight-question discovery interview;
- use one easy operational question and only enough probing to establish whether a deeper meeting is warranted;
- scripts are adaptive talk tracks, not verbatim transcripts.

YAD live reviewed data ultimately wins.

---

# 3. MACHINE-READABLE HOOK SELECTION

Use:

`outbound-sales-brain-sales-ai-hook-selection-matrix.v1.yaml`

Selection must consider:

- relationship/history;
- claim-safe current evidence;
- problem family;
- target role;
- business model;
- evidence strength;
- freshness.

Do not select from vertical name or Tier score alone.

Choose one primary hook and at most one supported backup.

If evidence degrades, fall back to safer category/role process context rather than making a stronger claim.

---

# 4. OBJECTION LANGUAGE REGRESSION

Add:

`outbound-sales-brain-sales-ai-objection-language-fixtures.v1.yaml`

to the text roleplay/classifier regression suite.

The test is meaning classification and correct next-state behavior, not exact phrase matching.

Critical categories include:

- send email;
- busy/callback;
- CRM;
- receptionist/answering service;
- agency/IT;
- ChatGPT/AI skepticism;
- human preference;
- bad prior automation;
- price/budget/timing;
- partner/corporate/franchise authority;
- guarantee;
- integration;
- privacy/security;
- professional judgment;
- no problem;
- not interested;
- wrong person/company;
- DNC;
- AI identity;
- contact provenance;
- sales-intent question;
- Michael handoff questions;
- demo curiosity.

DNC/clear end/wrong number override ordinary objection handling.

---

# 5. MEETING QUALITY FEEDBACK

A booking is not the final optimization target.

Implement the canonical outcome defined in:

- `outbound-sales-brain-strategy-call-outcome-feedback-spec.md`
- `outbound-sales-brain-strategy-call-outcome-contract.v1.yaml`

For attended strategy calls Michael should be able to record, in roughly one minute:

- attendance;
- meeting-worth-taking quality 1–5;
- whether original problem was confirmed;
- whether attendee was right stakeholder;
- next step;
- optional note.

Join this outcome back to:

- source call;
- hook/frame;
- Call Pack;
- hypothesis;
- target role;
- agent version;
- booking.

Do not optimize hook selection on booking rate alone.

Use `qualified_attended_meeting` as a downstream quality signal.

---

# 6. ANALYTICS ADDITIONS

Where current schema/UI makes sense, support fields for:

- strategy_call_attended;
- Michael qualification-quality score;
- original problem confirmation;
- stakeholder fit;
- business-case path;
- qualified_attended_meeting;
- bad-booking root cause;
- opportunity created.

Do not block the core portal if these belong in a follow-on migration, but design the linkage now so call/version provenance is preserved.

---

# 7. CHANGE DISCIPLINE

Do not rewrite the full prompt because one new fixture fails.

Use:

`failure -> root cause -> smallest component change -> relevant regressions -> full critical regression -> controlled voice test`.

External research is not permission to weaken Sales Manual doctrine or compliance.

---

# 8. CORE RULE

**Select a hook from real evidence and role fit, understand real-world objections by meaning, and judge the Sales AI by whether the right person with a real problem reaches Michael — not by whether the calendar gets filled.**
