# CLAUDE CODE — SALES AI TRANSCRIPT / HOOK AUTHORITY

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`

Before the next Sales AI conversation/voice pass, read:

1. `outbound-sales-brain-yad-sales-ai-core-script-v1.md`
2. `outbound-sales-brain-sales-ai-first-60-seconds-playbook.md`
3. `outbound-sales-brain-full-call-transcript-pack-v1.md`
4. `outbound-sales-brain-sales-ai-gold-dialogues-v1.md`
5. `outbound-sales-brain-sales-ai-hypothesis-question-bank.v1.yaml`
6. `outbound-sales-brain-sales-ai-opener-selector-spec.md`
7. `outbound-sales-brain-sales-ai-response-cards.v1.yaml`
8. `outbound-sales-brain-sales-ai-owner-question-cards.v1.yaml`
9. `outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`
10. `outbound-sales-brain-ai-cold-call-pilot-scorecard.md`

The transcript pack is a **gold behavioral library**, not a verbatim script to concatenate into the system prompt.

Implementation target:

`Call Pack + opener selector + problem-family question bank + state machine + working memory + relevant response/owner card + qualification gate + action tools -> natural live turn`.

## Hook optimization

Do not optimize hooks only for keeping someone on the phone.

Track downstream quality:

- correct decision-maker reached;
- useful process fact learned;
- objection/negative reaction;
- qualified opportunity;
- strategy call offered;
- strategy call booked;
- attended qualified meeting;
- DNC/complaint.

A hook that creates curiosity but low-quality meetings is not a winning hook.

For early pilot, change only one meaningful conversation component at a time and retain immutable version IDs so results can be attributed.

## Transcript QA

The simulator does not need exact word-for-word matching. Grade behavioral requirements:

- truthfulness;
- relevance;
- one question at a time;
- listening/reflection;
- no feature dump;
- no invented facts;
- appropriate objection behavior;
- correct strategy-call readiness;
- booking confirmation only after provider confirmation;
- immediate DNC/wrong-number handling;
- respectful no-sale.

## Core rule

Do not build one fixed transcript. Build one excellent salesperson whose behavior produces conversations resembling the gold transcripts while reacting to what the prospect actually says.
