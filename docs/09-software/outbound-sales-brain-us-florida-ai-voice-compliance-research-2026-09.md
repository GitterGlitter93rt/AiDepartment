# Your AI Department — U.S. / Florida AI Voice Compliance Research

**Status:** Official-source architecture research; not legal advice  
**Date:** 2026-09-03  
**Purpose:** Prevent YAD from treating `B2B` as a universal authorization for autonomous AI-generated voice outreach. Translate current federal/Florida official-source research into conservative software classification requirements pending formal legal/policy review.

---

# 1. OFFICIAL SOURCES REVIEWED

Federal Communications Commission:

- FCC 24-17, Declaratory Ruling, released February 8, 2024:
  `https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf`
- FCC press release on AI-generated voices:
  `https://docs.fcc.gov/public/attachments/DOC-400393A1.pdf`

Federal Trade Commission:

- `Complying with the Telemarketing Sales Rule`:
  `https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule`
- DNC Q&A:
  `https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0`

Florida:

- Florida Department of Agriculture and Consumer Services, Florida Do Not Call:
  `https://www.fdacs.gov/Business-Services/Florida-Do-Not-Call`
- Florida Statutes § 501.059, Telephone solicitation
- Florida Statutes § 501.603, commercial telephone solicitation definitions
- Florida Statutes § 501.616, unlawful acts and practices

Formal production policy should be reviewed by qualified counsel/compliance professionals. The software should not invent an exemption.

---

# 2. FCC — AI VOICES ARE ARTIFICIAL / PRERECORDED VOICE

FCC 24-17 confirms that current AI technologies that generate human voices fall within the TCPA's restrictions on `artificial or prerecorded voice`.

The Declaratory Ruling states that calls using such technology fall under the TCPA and implementing rules and require prior express consent of the called party absent an emergency purpose or applicable exemption.

It also notes identification/disclosure and opt-out requirements for artificial/prerecorded voice messages, including telemarketing messages.

Architecture consequence:

**Do not classify an outbound call as autonomous-AI eligible merely because YAD is calling a business.**

The exact destination endpoint / called-party context / applicable exemption or consent must be determined by reviewed policy.

---

# 3. FTC — MOST B2B CALLS ARE GENERALLY OUTSIDE TSR / NATIONAL DNC

FTC guidance states that most phone calls between a telemarketer and a business are exempt from the Telemarketing Sales Rule, subject to exceptions such as certain nondurable office/cleaning supplies and calls soliciting individual employees for personal purchases/contributions.

FTC guidance also states that the National DNC prohibition generally does not apply to business-to-business calls.

Architecture consequence:

This can matter to the **TSR/National DNC** layer, but it does **not** mean all other phone laws disappear.

Specifically:

- FCC/TCPA artificial-voice rules remain a separate analysis;
- state rules remain separate;
- internal YAD DNC always applies;
- carrier/Twilio rules remain separate;
- mobile/personal vs true business endpoint context remains important.

Therefore YAD should not have one boolean `B2B_EXEMPT` that bypasses the rest of the compliance engine.

---

# 4. BUSINESS NUMBER DOES NOT PROVE BUSINESS-ENDPOINT LEGAL CLASS

A company may publish:

- traditional business landline;
- VoIP business main line;
- call-tracking number;
- owner's mobile;
- employee's mobile;
- shared personal/business mobile;
- home office number;
- franchise/corporate line.

Google/company-site labeling as `business phone` is useful identity evidence but is not sufficient legal classification for autonomous AI voice.

Keep separate fields:

```text
endpoint_business_context
telecom_line_type
called_party_class
endpoint_provenance
consent_or_exemption_basis
policy_decision
```

Unknown values remain unknown.

---

# 5. ENDPOINT CLASSIFICATION — SOFTWARE DECISION

The compliance engine should distinguish at least:

## HUMAN_MANUAL_CALL

Live human sales call policy.

May legitimately be `ALLOW` for a B2B context where autonomous AI is not.

## AUTONOMOUS_AI_VOICE

AI-generated/artificial voice policy.

Requires its own affirmative current policy basis.

Possible state:

```text
HUMAN_MANUAL_CALL = ALLOW
AUTONOMOUS_AI_VOICE = BLOCK | REVIEW_REQUIRED
```

This is not an error; it is an expected channel distinction.

---

# 6. CONSERVATIVE AI-VOICE CLASSIFICATION

Until a reviewed policy explicitly authorizes a class, default to:

### AI voice — ALLOW only when

- exact endpoint/called-party class is supported;
- required consent/exemption basis is documented under current policy;
- jurisdiction/state policy passes;
- internal DNC passes;
- provider/carrier policy passes;
- local time/cadence passes;
- all other pilot gates pass.

### AI voice — REVIEW_REQUIRED / BLOCK when

- mobile/personal-use possibility is unresolved;
- consent/exemption basis is unresolved;
- jurisdiction rule is unresolved;
- provider screening fails/unknown;
- source semantics do not establish required policy facts.

A Tier A score or Google-advertiser status never changes this result.

---

# 7. FLORIDA CONSUMER TELEMARKETING RULES

Florida's official consumer Do Not Call materials describe protections for Florida consumers and numbers on the state list.

FDACS materials state, among other things, that:

- Florida residents can add residential/mobile/paging numbers to the state DNC list;
- businesses must maintain entity-specific requests from consumers;
- the consumer telephone-solicitation law includes restrictions around automated solicitation devices/recorded messages;
- calling/text time limits apply.

Florida statutes use defined concepts such as `consumer goods or services` and `commercial telephone solicitation`.

YAD sells business services, so the exact application to a particular B2B campaign should not be guessed in code or prompt text.

Architecture response:

- maintain Florida as a distinct jurisdiction policy pack;
- treat consumer/mobile ambiguity conservatively;
- maintain entity-specific DNC universally;
- allow reviewed B2B policy rules to differ from consumer rules only through versioned deterministic configuration.

---

# 8. FLORIDA CALLING-HOUR DISCREPANCY / SAFE ENGINEERING DEFAULT

Current FDACS FAQ material states calls/texts are permitted from 8 a.m. through 9 p.m. local time.

Florida Statutes § 501.616 currently states commercial telephone solicitation calls may not be made before 8 a.m. or after 8 p.m. local time in the called person's time zone for that statutory category.

Because official public materials appear to describe different scopes/rules, YAD software must not choose the more permissive hour based on a marketing FAQ alone.

Until reviewed policy resolves the exact campaign class:

- use the stricter applicable configured window;
- never let the model decide calling hours;
- store policy version and destination timezone;
- support per-jurisdiction/per-campaign windows.

Do not hard-code `8 AM–9 PM` globally.

---

# 9. FLORIDA FREQUENCY / CALLER-ID SIGNALS

Florida Statutes § 501.616 includes restrictions for the commercial telephone solicitation category such as limits on repeated calls on the same subject matter over a 24-hour period and prohibitions on intentionally concealing/spoofing caller ID.

Architecture already supports:

- cross-campaign attempt history;
- frequency/cadence gate;
- no number-churn evasion;
- legitimate caller number registry;
- caller identity/trust configuration.

Keep these server-side and policy-versioned.

Do not try to evade frequency rules by switching outbound numbers.

---

# 10. ENTITY-SPECIFIC DNC IS UNIVERSAL YAD POLICY

Regardless of a possible B2B statutory exemption, YAD's internal rule remains simple:

If a prospect says any clear equivalent of:

- stop calling;
- take me off your list;
- don't call this number again;

then:

- durable suppression;
- scope determined by policy/request;
- pending generic outreach cancelled;
- future rediscovery cannot resurrect the endpoint as cold-call eligible.

Do not use a possible legal exemption as a reason to ignore a stated preference.

---

# 11. AI DISCLOSURE / IDENTITY

FCC 24-17 requires artificial/prerecorded voice calls to comply with existing identification/disclosure rules, and later FCC proceedings have continued to explore additional AI-specific transparency.

YAD agent policy already requires truthfulness if asked whether it is AI.

For production, the compliance policy should explicitly define required start-of-call AI/identity disclosure for the selected legal/campaign class and current FCC rules at launch time.

Do not let the model choose whether a mandatory disclosure applies.

---

# 12. PILOT IMPLICATION

The first **real autonomous AI cold-call** cohort should not simply be:

`HVAC business + public phone + Tier B+`.

It must additionally have:

- endpoint class that current reviewed policy permits for AI voice;
- affirmative consent/exemption basis where required;
- current jurisdiction decision;
- exact `AUTONOMOUS_AI_VOICE = ALLOW` result.

If no such cold-prospect set is legally/policy-ready, the system still has valuable launch paths:

1. internal/allowlisted AI voice tests;
2. eligible HUMAN_MANUAL_CALL workflow for sales reps;
3. inbound AI receptionist/demo;
4. AI callbacks/other contexts only where current policy expressly allows.

Do not lower policy quality merely to make a real-AI-cold-call demo happen sooner.

---

# 13. DATA MODEL ADDITIONS / CONFIRMATION

`ChannelEligibilityDecision` should retain references such as:

```text
channel
endpoint_id
jurisdiction
called_party_class
line_type
business_context
consent_basis
exemption_basis
internal_dnc_result
external_registry_result
state_policy_result
provider_policy_result
calling_window_result
cadence_result
final_decision
reason_codes[]
policy_version
evaluated_at
refresh_by
```

Not every field must always be known; unknown inputs can cause REVIEW/BLOCK according to policy.

---

# 14. HUMAN VS AI PORTAL UX

Account Detail may legitimately show:

```text
Human Call: Allowed
AI Voice: Review Required
Email: Ready
```

or:

```text
Human Call: Allowed
AI Voice: Blocked for this endpoint
```

Do not hide the Account simply because AI voice is unavailable.

This is a major value of YAD's multi-channel architecture.

---

# 15. FORMAL REVIEW BEFORE SCALE

Before scaled real autonomous AI outbound use:

- re-check current FCC rules/orders;
- re-check destination-state rules;
- review provider/Twilio policy;
- confirm how YAD's actual calling model is classified;
- have qualified counsel/compliance review the production policy pack.

Then encode the result as deterministic versioned policy instead of oral guidance or prompt text.

---

# 16. CORE RULE

**`B2B` may affect TSR/National-DNC analysis, but it is not a universal AI-voice permission. Autonomous AI voice needs its own affirmative channel decision based on the exact endpoint, called-party context, jurisdiction and current consent/exemption policy. Human selling and AI voice remain separate channels.**
