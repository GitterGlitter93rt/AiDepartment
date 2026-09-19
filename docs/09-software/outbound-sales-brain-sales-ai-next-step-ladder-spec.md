# Your AI Department — Sales AI Next-Step Ladder

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Give the outbound Sales AI several legitimate low-friction next steps without turning every cold conversation into a forced calendar booking.

---

# 1. PRINCIPLE

Primary cold-call close:

**YAD 15-Minute AI Strategy Call with Michael**

Secondary next steps exist because not every potentially useful prospect is ready to schedule immediately.

The AI should choose the **smallest sensible commitment** supported by the conversation.

Canonical ladder:

1. strategy call;
2. requested callback;
3. targeted short email;
4. free AI Department Assessment when relevant;
5. human follow-up/research;
6. no-sale/disqualify;
7. DNC/end.

Do not keep stepping down the ladder after the prospect clearly wants the conversation to end.

---

# 2. STRATEGY CALL — PRIMARY QUALIFIED CLOSE

Use when Strategy Call Readiness = `BOOK_NOW`.

Purpose:

- map the actual workflow;
- collect/validate real business numbers;
- determine whether there is a real business case;
- identify appropriate next step.

Do not describe it as a guaranteed demo/proposal/ROI audit unless current event configuration explicitly provides that.

---

# 3. CALLBACK

Use when:

- correct stakeholder is busy but interested/open;
- gatekeeper provides a better time;
- prospect asks to continue later;
- booking a full strategy call is premature.

Capture:

- requested date/time/window;
- timezone;
- person/role;
- reason;
- source turn.

Requested callback outranks generic cold cadence.

---

# 4. TARGETED SHORT EMAIL

Use when prospect asks for information or when email is the explicitly requested next step.

Content should be generated from:

- exact topic discussed;
- confirmed facts;
- one relevant YAD capability/approach;
- one clear next step.

Avoid giant capability brochure.

If prospect says:

> Just email me.

AI may ask one short topic question if they remain engaged:

> Sure. So I don't send you generic AI garbage, what's more relevant — lead handling, follow-up, employee workload, marketing performance, or something else?

If they want off the phone, do not force that clarification.

---

# 5. FREE AI DEPARTMENT ASSESSMENT

The current commercial authority defines the public AI Department Assessment as free and intended to diagnose opportunities and create a reason for a strategy conversation.

Use it as a secondary next step when:

- prospect expresses curiosity but isn't ready to schedule;
- prospect wants to understand what YAD might find;
- prospect asks for something they can review on their own;
- multiple possible workflow areas exist and a structured self-assessment would help;
- human rep/AI believes first-party assessment data would materially improve later discovery.

Do not use it as a punishment for refusing a meeting.

Do not say it has a price; current public Assessment is free.

---

# 6. ASSESSMENT LINK ACTION

Typed action concept:

`send_ai_department_assessment`

Inputs:

- account/contact;
- approved business email or requested delivery channel;
- current assessment route/event config from source authority;
- attribution values;
- rep/source/campaign;
- call/session ID;
- personalization topic optional;
- idempotency key.

Do not hard-code a stale assessment URL into the realtime prompt.

The action should resolve the currently approved Short/Comprehensive assessment entry point from current application/config authority.

---

# 7. ATTRIBUTION

Assessment link should preserve enough attribution to connect completion back to the canonical Account.

Where current website architecture supports it, include non-PII identifiers such as:

- account/prospect reference token;
- source = outbound_ai_call;
- campaign;
- vertical;
- rep/agent source;
- relevant UTM fields;
- current approved `rep_code` convention where applicable.

Do not leak private internal database IDs if public-link tokenization is required.

---

# 8. ASSESSMENT COMPLETION LOOP

When prospect completes assessment:

`assessment submission`
-> identity resolution
-> same Account
-> first-party ProspectStatement/Evidence
-> update opportunity hypotheses
-> notify Account owner
-> recommend/book strategy call where appropriate.

Do not create a duplicate lead simply because the prospect entered through an inbound funnel after outbound contact.

---

# 9. TARGETED EMAIL + ASSESSMENT

If requested and relevant, email can be extremely short:

> John — good talking with you. You mentioned estimate follow-up is mostly handled individually by the sales team. Here's the free YAD assessment if you want to see the broader areas we look at. If it surfaces anything useful, happy to compare notes for 15 minutes.

Do not state the workflow is broken; use what prospect actually said.

Exact copy remains subject to email-personalization/claim policy.

---

# 10. HUMAN FOLLOW-UP

Use when:

- technical question exceeds approved cold-call scope;
- prospect requests a person;
- booking tool fails;
- contact information needs correction;
- prospect wants material not approved for autonomous sending;
- conversation identifies complex opportunity requiring review.

The AI should say what will happen next without promising an unconfirmed action.

---

# 11. NO SALE

Use when:

- no meaningful problem;
- strong systems/process already solve tested areas;
- no current priority/interest and no requested future timing;
- business fit weak;
- YAD isn't appropriate.

No-sale is not a failure.

Do not offer Assessment + email + callback + meeting one after another trying to salvage every call.

---

# 12. NEXT-STEP PRIORITY EXAMPLES

## Confirmed problem + interest

-> Strategy call.

## Busy but engaged

-> Callback or strategy booking depending prospect preference.

## Curious, wants something first

-> Targeted email and/or Assessment when relevant.

## Gatekeeper supplies correct person/time

-> Corrected contact + callback route.

## No pain

-> No sale.

## Explicit stop

-> DNC/end. No secondary offer.

---

# 13. CORE RULE

**The AI should earn one appropriate next step, not stack every YAD call-to-action until the prospect gives in.**
