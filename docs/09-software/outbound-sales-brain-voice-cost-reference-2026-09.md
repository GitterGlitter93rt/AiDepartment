# Your AI Department — Voice Cost Reference September 2026

**Status:** Current provider price reference; supporting unit-economics input  
**Date:** 2026-09-03  
**Purpose:** Give YAD an explicit current variable-cost model for outbound ConversationRelay calls without hard-coding provider pricing into canonical business logic.

Prices change. Revalidate with provider Pricing API/current pricing page before production budgeting.

---

# 1. CURRENT TWILIO U.S. REFERENCE

Current Twilio U.S. public pricing reviewed September 2026 shows approximately:

- outbound U.S./Canada local Voice: `$0.0140 / minute`;
- ConversationRelay: `$0.07 / minute` active AI session;
- Answering Machine Detection: `$0.0075 / call`;
- Branded Calling: `$0.12 / call` where used/current product applies;
- call recording: `$0.0025 / minute` plus storage if enabled;
- ConversationRelay realtime transcription is included in the ConversationRelay per-minute price according to current Twilio docs.

Do not add standalone Gather/STT/TTS feature pricing unless the selected implementation actually invokes separately billed features outside ConversationRelay.

Use Twilio Pricing API / invoice data for actual account-specific accounting.

---

# 2. BASE CONVERSATIONRELAY FLOOR

Ignoring external LLM cost and optional features:

```text
base_connected_minute_cost
= twilio_outbound_voice_per_minute
+ conversationrelay_per_minute

= 0.014 + 0.070
= 0.084 USD/minute
```

If AMD is used on the call:

```text
call_floor
= connected_minutes * 0.084
+ 0.0075 AMD
```

Current illustrative values:

| Connected duration | Voice + Relay | + one AMD | External LLM not included |
|---|---:|---:|---|
| 1 min | $0.0840 | $0.0915 | additional |
| 2 min | $0.1680 | $0.1755 | additional |
| 3 min | $0.2520 | $0.2595 | additional |
| 5 min | $0.4200 | $0.4275 | additional |
| 10 min | $0.8400 | $0.8475 | additional |
| 15 min | $1.2600 | $1.2675 | additional |

These are budgeting examples, not invoice guarantees.

---

# 3. OPTIONAL / PRE-CALL COSTS

Possible per-endpoint or per-call additions:

## Twilio Lookup line type

If not already cached/current:

- current Line Type Intelligence charge applies per lookup;
- run at sales-ready/preflight rather than on every mined number;
- attribute lookup cost to endpoint screening, not every subsequent call while cache remains valid.

## DNC/compliance provider

Provider may charge:

- per number;
- per batch;
- subscription;
- hybrid.

Allocate separately as `phone_screening_cost`.

## Branded Calling

If current paid Twilio Branded Calling product is enabled:

- current public reference approximately `$0.12/call`;
- treat separately from transport/Relay cost;
- do not require it for internal test economics.

---

# 4. EXTERNAL LLM COST

ConversationRelay does not include YAD's external conversation-model inference.

Track per call:

```text
llm_provider
model
input_tokens_or_units
output_tokens_or_units
cached_input_units if applicable
tool/retrieval_usage
provider_cost
```

Model pricing/version must come from current provider configuration.

Do not assume the model used by pre-call research has the same pricing as realtime conversation model.

---

# 5. RAG / TOOL COST

A live conversation may also incur:

- Sales Manual retrieval/index cost;
- Cal.com API (often no per-call usage charge but provider subscription allocation may exist);
- email/SMS follow-up;
- contact refresh;
- human handoff/bridge Voice minutes.

Track as separate operation costs.

Do not bury all of these into `LLM cost`.

---

# 6. COST PER ATTEMPT VS CONNECTED CALL

Do not divide total voice cost only by meetings.

Track:

```text
attempted_calls
answered_calls
human_answers
right_stakeholder_conversations
qualified_conversations
booked_meetings
qualified_attended_meetings
opportunities
```

Then:

```text
cost_per_attempt
cost_per_human_answer
cost_per_right_stakeholder
cost_per_meaningful_problem
cost_per_booked_meeting
cost_per_qualified_attended_meeting
cost_per_opportunity
```

Include unsuccessful attempt costs actually billed by providers.

---

# 7. FULL VARIABLE CALL COST OBJECT

Suggested:

```text
VoiceAttemptCost
- call_id
- account_id
- provider_call_id
- outbound_voice_minutes
- outbound_voice_cost
- conversationrelay_minutes
- conversationrelay_cost
- amd_used
- amd_cost
- line_type_lookup_cost_allocated
- dnc_screening_cost_allocated
- external_llm_input_cost
- external_llm_output_cost
- rag_cost
- sms_email_followup_cost
- branded_calling_cost
- other_variable_cost
- total_variable_cost
- pricing_snapshot_id
- currency
- calculated_at
```

Do not double count one cached lookup across every call to the endpoint.

---

# 8. PRICING SNAPSHOT

Create/config concept:

`ProviderPricingSnapshot`

```text
provider
product
unit
unit_price
currency
source
retrieved_at
effective_date_if_known
```

Actual provider-returned billed cost overrides estimate when available.

Historical calls keep the pricing snapshot used at the time; do not recalculate old cost using today's rates.

---

# 9. TYPICAL COLD CALL DURATION ECONOMICS

The core Sales AI is designed to exit quickly on no-fit and move qualified interest to Michael rather than conducting a 15-minute cold discovery.

That architecture has a direct cost benefit:

- weak/no-fit calls generally short;
- useful owner calls often 1–4 minutes;
- qualified prospect transitions to scheduled 15-minute strategy call.

Do not shorten a productive conversation solely to save `$0.084/min` transport cost.

A few cents of additional voice cost is insignificant relative to destroying a qualified business conversation.

---

# 10. SCALE EXAMPLES — ILLUSTRATIVE

At the current Twilio floor and **excluding external LLM + screening + optional branding**:

### 100 connected calls averaging 2 minutes

```text
200 connected minutes * $0.084 = $16.80
100 AMD * $0.0075 = $0.75
Twilio floor ≈ $17.55
```

### 100 connected calls averaging 5 minutes

```text
500 connected minutes * $0.084 = $42.00
100 AMD * $0.0075 = $0.75
Twilio floor ≈ $42.75
```

This is why YAD should optimize for qualified meeting economics rather than obsessing over pennies per conversation minute.

These examples do not include attempts that incur other provider charges, LLM, DNC, Lookup, optional Branded Calling, or fixed infrastructure.

---

# 11. CAMPAIGN ECONOMICS

For each pilot/campaign report:

```text
discovery_cost
research_cost
contact_resolution_cost
phone_screening_cost
voice_attempt_cost
external_llm_cost
followup_cost
human_review_cost optional
```

Then downstream:

```text
cost_per_canonical_account
cost_per_ai_eligible_endpoint
cost_per_human_answer
cost_per_right_stakeholder
cost_per_qualified_attended_meeting
cost_per_opportunity
```

Never compare campaign cost without cohort quality.

---

# 12. PROVIDER SELECTION

A cheaper voice/model stack does not win if it causes:

- 3–5 second silence;
- worse STT;
- robotic speech;
- bad interruption behavior;
- more DNC/negative reactions;
- lower qualified meeting rate.

Realtime provider benchmark weighting should keep cost a minority factor until quality/reliability are acceptable.

---

# 13. MANAGER UI

Analytics / Pilot Review may show:

- provider cost today/week;
- average variable cost per attempt;
- average cost per human answer;
- average cost per qualified attended meeting;
- cost by hook/market/vertical;
- voice/model config cost comparison.

Do not show provider credentials or internal raw invoice payloads.

---

# 14. CORE RULE

**Measure every variable provider cost, but optimize the system for economically valuable conversations. At current Twilio pricing, ConversationRelay transport is cheap relative to the value of one real YAD opportunity; quality, reliability and qualification matter more than shaving a few cents off a call.**
