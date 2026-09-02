# Your AI Department — Outbound Contact Compliance Policy Engine Specification

**Status:** Software architecture; NOT legal advice  
**Purpose:** Make outbound eligibility deterministic, auditable, versioned, and fail-closed rather than allowing an LLM to decide whether a contact is permissible.  
**Production requirement:** Final policy table must be reviewed/approved by appropriate legal/company decision-makers before autonomous prospect calling is enabled.

---

# 1. WHY THIS ENGINE EXISTS

YAD's outbound system may involve:

- business-to-business prospecting;
- business landlines;
- mobile/wireless numbers used for business;
- live human sales calls;
- AI-generated voices;
- prerecorded/artificial voice rules;
- SMS/email follow-up;
- call recording/transcription;
- federal and state rules;
- provider/carrier policies;
- entity-specific do-not-call requests.

These are not interchangeable categories.

A business prospect is not automatically safe for every calling technology merely because the sales purpose is B2B.

Therefore:

**Fit score never determines legal/contact eligibility.**

The compliance engine runs separately and controls downstream actions.

---

# 2. CURRENT FEDERAL ARCHITECTURE REFERENCES

Revalidate before production.

## FCC — AI voice

FCC Declaratory Ruling FCC 24-17 (released February 8, 2024) states that TCPA restrictions on artificial or prerecorded voice encompass AI technologies that generate human voices and therefore such calls fall under the TCPA/implementing rules, requiring prior express consent absent an emergency purpose or exemption.

Reference:

https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf

Architecture implication:

Do not equate “AI sounds human” with a live-human call for policy purposes.

## FTC — B2B

FTC Telemarketing Sales Rule guidance states that most phone calls between a telemarketer and a business are exempt from the TSR, subject to exceptions. The FTC also notes that the FCC separately enforces the TCPA and that states may impose additional requirements.

Reference:

https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule

FTC amendments adopted in 2024 also address deceptive/misleading practices in B2B telemarketing.

Architecture implication:

A TSR B2B exemption is NOT a global “safe to AI-call” flag.

---

# 3. POLICY ENGINE RULE

The LLM receives the result.

It never produces the result.

Input:

`ContactPolicyContext`

Output:

`ComplianceDecision`

Decision values:

- `allow_autonomous`
- `human_only`
- `research_only`
- `review_required`
- `suppress`

Default uncertainty moves toward `human_only`, `research_only`, or `review_required` — not autonomous.

---

# 4. REQUIRED INPUTS

## Account/contact identity

- account ID;
- contact ID if known;
- phone ID;
- campaign ID;
- intended seller/company identity;
- call purpose.

## Destination

- country;
- state/territory;
- locality when relevant;
- IANA timezone;
- destination local time.

## Number intelligence

- normalized E.164;
- line type: landline/mobile/VoIP/toll-free/unknown;
- line-type source and freshness;
- business-number confidence;
- personal/direct-number confidence.

## Contact basis

Examples:

- cold_business_prospect
- inbound_inquiry
- explicit_consent
- existing_business_relationship
- customer
- partner/referral
- manual_import_unknown
- controlled_internal_test

Store the evidence/source supporting the basis.

## Communication technology

- human_live_call
- AI_generated_voice
- prerecorded_voice
- SMS
- email
- mixed/handoff

## Suppression

- entity-specific DNC;
- phone DNC;
- contact DNC;
- account DNC;
- campaign exclusion;
- existing customer exclusion;
- internal strategic suppression.

## Attempt history

- attempts in configured windows;
- last attempt;
- last live conversation;
- voicemail count;
- explicit requested callback.

## Recording/media

- recording requested;
- transcription requested;
- storage requested;
- jurisdiction policy result.

---

# 5. DECISION PRIORITY

Evaluate in this order.

## 1. Internal/global kill switch

If global outbound disabled:

`research_only`

## 2. Explicit DNC/suppression

`suppress`

No later rule may override an explicit valid suppression.

## 3. Controlled test allowlist

Only if destination is explicitly allowlisted and test policy permits the selected technology.

## 4. Required data unavailable

If a required policy input cannot be resolved:

`review_required` or `human_only` depending on policy.

## 5. Jurisdiction/technology/contact-basis rule

Apply versioned rule table.

## 6. Calling window

If outside allowed window:

not callable now; schedule eligibility for later rather than altering fit.

## 7. Attempt frequency

If cooldown/max-attempt rule reached:

not callable now / suppress per campaign policy.

## 8. Recording/transcription

May permit call but disable recording/transcription if policy allows that combination.

## 9. Final decision

Return reason codes and policy version.

---

# 6. DNC HIERARCHY

Suppression scopes:

1. phone-specific;
2. contact-specific;
3. account/company-specific when request clearly covers company-wide outreach;
4. campaign-specific exclusion;
5. global YAD suppression.

When prospect says variants such as:

- stop calling;
- take me off your list;
- do not call again;
- remove this number;

realtime orchestration should immediately invoke deterministic `add_do_not_contact`.

Requirements:

- write synchronously/durably before normal sales conversation continues;
- acknowledge briefly;
- end sales call;
- prevent immediate race-condition redial;
- preserve timestamp/source/call ID;
- propagate to future campaign eligibility.

If suppression store is unavailable, autonomous dialing should fail closed.

---

# 7. TIMEZONE / CALLING WINDOW

Never use server local time.

Resolve destination timezone in this order:

1. verified physical/business location tied to destination;
2. explicit contact timezone;
3. phone-number geography only as a weaker fallback where appropriate;
4. unknown -> review/human-only according to policy.

Policy table defines permitted local windows by jurisdiction/campaign/contact type.

Do not hard-code one national 9 AM–8 PM rule as universal law.

The queue asks the engine:

`eligible_now?`

and receives:

- yes/no;
- next eligible timestamp;
- policy reason.

---

# 8. LINE TYPE

Line type is a policy input, not a sales score.

Possible values:

- landline
- mobile
- fixed_voip
- non_fixed_voip
- toll_free
- unknown

Default architecture:

- unknown line type should not become autonomous merely because the account is a business;
- direct mobile numbers deserve separate policy treatment from a main business landline;
- line-type lookup can be delayed until a prospect is otherwise high enough priority to contact.

---

# 9. AI-GENERATED VOICE

Policy engine must explicitly know when the outbound call uses AI-generated voice.

Do not disguise this as:

`live_agent = true`

simply because the AI is realtime.

Software field:

`voice_origin = ai_generated | human | prerecorded_human | other`

Autonomous AI voice production calls remain disabled unless the policy rule for the exact destination/contact basis/technology combination returns `allow_autonomous` after legal/company review.

---

# 10. HUMAN-ASSIST MODE

If autonomous AI voice is not approved for a prospect class, the system can still create value:

- mine;
- research;
- score;
- create Call Pack;
- assign to Brent/human salesperson;
- optionally support notes/CRM after the live human call.

This is why compliance uncertainty should not stop Market Miner development.

---

# 11. CONTACT-BASIS EVIDENCE

Every basis must include provenance.

Examples:

## `inbound_inquiry`

- form/call source;
- timestamp;
- requested topic;
- consent language if any.

## `explicit_consent`

- exact consent record;
- timestamp;
- scope;
- channel/technology covered;
- seller identity.

## `cold_business_prospect`

- public/licensed business source;
- intended B2B purpose;
- role/business context.

Never upgrade `cold_business_prospect` to `explicit_consent` because a phone number was publicly listed.

---

# 12. ATTEMPT FREQUENCY

Campaign policy controls:

- max total attempts;
- max attempts per day/week/window;
- minimum cooldown;
- voicemail-specific cadence;
- live “call me later” requested timestamp;
- wrong-number termination;
- no-answer retry logic.

The compliance policy may impose stricter ceilings.

The stricter rule wins.

---

# 13. REQUESTED CALLBACK

If prospect says:

> Call me Thursday at 2.

Store:

- requested timestamp;
- timezone;
- contact who requested it;
- scope/topic.

Queue should prioritize the legitimate requested callback at the requested time instead of applying generic cold-call cadence.

The original DNC status still wins if changed later.

---

# 14. RECORDING / TRANSCRIPTION

Separate flags:

- `call_recording_allowed`
- `call_transcription_allowed`
- `transcript_storage_allowed`
- `audio_storage_allowed`
- `required_disclosure_script_id`

A call may have different policy results for recording vs transcription/storage.

Architecture must support:

- realtime call without retained audio;
- ephemeral speech processing without persistent transcript where technically/provider-wise supported;
- human/manual notes when transcript retention is disallowed;
- jurisdiction-specific disclosure logic.

Do not assume a single-party recording rule applies nationwide.

---

# 15. AI IDENTITY / DECEPTION

Policy/truth rules:

- never impersonate Brent/Michael/another named human;
- accurately identify Your AI Department;
- if directly asked whether caller is AI, answer truthfully;
- do not claim referral when none exists;
- do not claim returning a call when not true;
- do not use fake familiarity;
- do not hide a DNC request in transcript rather than acting on it.

This also aligns with the Sales Manual's honest cold-call doctrine.

---

# 16. B2B TRUTH / MISREPRESENTATION

Regardless of exemption analysis, YAD policy should prohibit:

- invented ad spend;
- invented revenue leakage;
- fake customer relationship;
- fake referral;
- false company credentials;
- false guarantee;
- pretending a third-party platform partnership exists;
- claiming an integration is verified when it is not.

Truth controls are always on.

---

# 17. POLICY TABLE DESIGN

Do not scatter if-statements through Twilio handlers.

Store versioned rule table with dimensions such as:

- country;
- state;
- contact basis;
- line type;
- business/personal classification;
- voice origin;
- purpose;
- recording/transcription;
- consent status.

Rule output:

- decision;
- calling window policy;
- recording policy;
- disclosure policy;
- max attempt policy;
- review requirement;
- rationale/source references.

Rules are edited intentionally and versioned.

---

# 18. INITIAL SAFE SOFTWARE DEFAULTS

Until policy is formally approved:

## Research

Allowed under source/provider policies.

## Human assist

Prepare ranked leads/Call Packs; human outreach follows approved company procedures.

## Controlled internal AI tests

Allow only explicit test-number allowlist and approved participants.

## Autonomous cold AI voice

Default:

`review_required / disabled`

Do not let a developer flip it on merely by setting a Twilio credential.

Production enablement should require at least:

- environment-level production flag;
- database/global admin flag;
- campaign mode;
- current policy decision;
- no suppression;
- current Call Pack.

Multiple independent gates reduce accidental activation.

---

# 19. DECISION REASON CODES

Examples:

- global_kill_switch
- campaign_paused
- explicit_dnc_phone
- explicit_dnc_contact
- explicit_dnc_account
- existing_customer_excluded
- controlled_test_allowlist
- line_type_unknown
- jurisdiction_unknown
- timezone_unknown
- contact_basis_unknown
- ai_voice_not_approved_for_class
- consent_required_not_present
- outside_calling_window
- attempt_limit_reached
- requested_callback_future
- recording_not_allowed
- transcription_not_allowed
- manual_review_required
- allowed_by_policy_rule

Never return only `false` without an auditable reason.

---

# 20. COMPLIANCE DECISION TTL

Different inputs age differently.

Before every autonomous attempt, re-evaluate:

- suppression;
- campaign/global enablement;
- local time;
- attempt history;
- policy version.

Line/contact-basis lookup may use a configured freshness TTL.

A decision generated yesterday should not authorize a call today if local time or suppression changed.

---

# 21. AUDIT RECORD

Every decision stores:

- policy version;
- input snapshot/hash;
- decision;
- reason codes;
- evaluated timestamp;
- next eligible timestamp if applicable;
- reviewer override if any;
- override identity/reason;
- source/legal reference IDs used by policy version.

Do not overwrite old compliance decisions.

---

# 22. ADMIN OVERRIDES

Overrides are dangerous and must be narrow.

Allowed architecture:

- authorized role only;
- reason required;
- expiry required where sensible;
- audit log;
- cannot override global immutable safety controls without higher-level authorization;
- cannot erase DNC history.

Never let the LLM request a compliance override tool.

---

# 23. SOFTWARE FIXTURES

## Fixture A — explicit DNC

Any line/contact class + explicit current DNC -> `suppress`.

## Fixture B — unknown line type for autonomous cold AI

Unknown line type + cold business prospect + AI-generated voice -> `review_required` under initial safe defaults.

## Fixture C — controlled internal test

Allowlisted internal number + controlled-test campaign + no suppression -> allowed under controlled-test policy.

## Fixture D — outside permitted local window

Otherwise eligible + local time outside configured window -> not eligible now; `next_eligible_at` calculated.

## Fixture E — human assist

High-fit prospect where autonomous policy unavailable -> `human_only`; Call Pack still created.

## Fixture F — suppression store unavailable

Autonomous attempt -> fail closed.

## Fixture G — recording restricted but call otherwise permitted

Return call eligibility independently plus `recording_allowed = false`; runtime must obey media policy.

---

# 24. PRODUCTION READINESS CHECK

Before any real autonomous prospect campaign:

- current federal rule review;
- state-by-state policy review for target states;
- carrier/Twilio acceptable-use review;
- AI voice policy reviewed;
- line-type policy reviewed;
- consent/contact-basis rules reviewed;
- DNC procedure implemented/tested;
- recording/transcription matrix reviewed;
- retry cadence reviewed;
- policy fixtures passing;
- global kill switch tested;
- counsel/company approval recorded.

Until then, Market Miner + Human Assist remain the primary operational path.
