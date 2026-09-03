# Your AI Department — Contact / Decision-Maker Waterfall Specification

**Status:** Architecture authority  
**Purpose:** Turn a researched company into one or more trustworthy human/business contact paths for YAD reps to call and email.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

For every sales-ready Account answer:

> Who is the best person/role for the hypothesis, and what legitimate phone/email path can YAD actually use to reach them?

The system must not stop at company discovery if contact enrichment can responsibly improve the rep's chances.

It also must not fabricate a person, title, email pattern, or direct number merely to fill fields.

---

# 2. CONTACT TARGET STARTS WITH PROBLEM OWNERSHIP

Target role is selected from the active opportunity hypothesis.

Examples:

## Missed calls / after-hours / dispatch

Priority roles may be:

- Operations Manager
- Office Manager
- Service Manager
- Dispatcher/Dispatch Manager
- GM
- Owner for smaller company

## Unsold estimates / proposals

- Sales Manager
- Sales Director
- GM
- Owner
- Estimating Manager where appropriate

## Paid marketing / attribution

- Marketing Director
- Growth/Marketing Manager
- Operations leader
- Owner/CEO for smaller company

## Law intake

- Intake Director
- COO / Firm Administrator
- Managing Partner
- Marketing Director where issue is acquisition attribution

## Real estate lead nurture

- ISA/Lead Manager
- Sales Manager
- Team Leader/Broker
- Operations

Do not enrich blindly for `owner` when another role clearly owns the workflow.

---

# 3. CONTACT WATERFALL

Use sources in an auditable sequence.

## Stage A — First-party website

Look for:

- team/leadership pages
- contact/about pages
- public staff directories
- role-specific email addresses
- public direct numbers
- schema/structured data

Advantages:

- current first-party evidence
- strong company relationship

Do not infer a person's email from a naming pattern unless verification policy explicitly supports it and the result is labeled accordingly.

## Stage B — Licensed business/contact provider

Examples:

- Apollo or approved equivalent

Use for:

- name/title
- business email
- business/direct phone where licensed
- employment/company matching

Preserve provider identity, timestamp, verification status and license metadata.

## Stage C — Approved public professional/business sources

Use only methods allowed by source terms.

Possible evidence:

- public company profile
- association/business directory
- licensing/public registry when it identifies responsible professional/owner
- public press/team page

Do not build prohibited scraping around login-gated networks.

## Stage D — Main business line / role route

If no reliable named decision-maker exists, create a legitimate role path:

> Call main business line and ask for the person responsible for inbound lead handling / operations / sales follow-up.

A verified main business phone + correct target role is better than a fabricated direct contact.

## Stage E — Gatekeeper learning

If receptionist/gatekeeper provides:

- name
- title
- extension
- best time
- email

store as prospect/gatekeeper-supplied contact evidence.

Do not generate missing fields that were not supplied.

---

# 4. CONTACT CANDIDATE OBJECT

```text
ContactCandidate
- contact_candidate_id
- account_id
- person_name optional
- first_name optional
- last_name optional
- job_title optional
- normalized_role_category
- department optional
- seniority optional
- business_email optional
- email_quality/status
- phone optional
- phone_quality/status
- extension optional
- source_type
- source_reference
- source_provider optional
- observed_or_verified_at
- employer_match confidence
- role_match confidence
- active/employment confidence
- license/retention metadata
- notes
```

---

# 5. CONTACT CONFIDENCE DIMENSIONS

Do not collapse everything into one confidence score.

Track separately:

## Employer Match

- confirmed
- likely
- uncertain

## Role Match

- strong owner of hypothesis
- acceptable stakeholder
- weak/general

## Recency

- fresh
- aging
- stale

## Endpoint Quality

Phone/email states use Sales Team Access contract.

This allows:

> Sarah is definitely Operations Manager, but we only have the main business number.

rather than pretending a direct number exists.

---

# 6. CONTACT PRIORITY

Conceptual ordering:

1. prospect-requested/referral contact
2. confirmed current decision-maker with verified endpoint
3. confirmed current decision-maker + main business route
4. likely decision-maker with licensed endpoint
5. role target + verified main business line
6. generic role inbox if appropriate
7. review/enrichment required

Never rank a stale named contact above a current verified business route solely because personalization looks better.

---

# 7. MULTIPLE CONTACTS

One Account can have several useful contacts.

Example HVAC company:

- Owner
- Operations Manager
- Marketing Director

The primary contact depends on current hypothesis/campaign.

Store alternatives for:

- gatekeeper referral
- no response
- stakeholder expansion
- meeting invitation

Do not email all contacts simultaneously by default.

---

# 8. BUSINESS PHONE RESOLUTION

Phone candidate sources may include:

- first-party website
- licensed provider
- approved business discovery source subject to retention rules
- gatekeeper/prospect supplied

Normalize E.164.

Store source/freshness.

Before production autonomous calling, additional line-type/policy checks occur downstream.

For Human Assist, UI still shows phone quality/source and applicable approved human-sales rules.

---

# 9. EMAIL RESOLUTION

Preferred:

- first-party published business email
- licensed provider verified business email
- prospect/gatekeeper supplied business email

Potential email states:

- VERIFIED_BUSINESS_EMAIL
- LICENSED_PROVIDER_EMAIL
- ROLE_INBOX
- UNVERIFIED
- BOUNCED
- OPTED_OUT

Do not let `UNVERIFIED` silently become Smartlead-ready.

---

# 10. EMAIL VERIFICATION

Claude should evaluate an approved verification provider/workflow during implementation if needed.

Verification is separate from discovery.

Record:

- verifier
- result
- checked_at
- risk/status

Do not turn catch-all/unknown into “verified” merely to increase list size.

---

# 11. PHONE VALIDATION

Separate:

- syntactic validity
- reachable/assigned where provider can responsibly establish
- business-source association
- line type when needed downstream

Wrong-number rep feedback should immediately age/invalidate that endpoint without disqualifying Account.

---

# 12. EMPLOYMENT STALENESS

People change jobs.

Named contact freshness should decay.

Refresh triggers:

- provider/source record old
- website no longer lists person
- bounce
- gatekeeper says person left
- prospect correction
- repeated wrong-contact outcome

On correction:

- retain historical Contact record
- mark employment/end relationship
- find current target
- do not erase history.

---

# 13. ROLE INBOXES

Examples:

- sales@
- marketing@
- intake@
- office@
- info@

Role inbox can be useful, but should not be treated as named decision-maker email.

Use deliberately according to campaign/channel strategy.

---

# 14. CONTACT ENRICHMENT BUDGET

Do not spend expensive contact credits on every discovered company before fit is known.

Suggested sequence:

1. discover/dedupe company
2. basic website research
3. preliminary fit
4. if plausible Tier B+ / campaign-ready -> deeper decision-maker enrichment
5. verify endpoint before export/contact when required

Measure:

- enrichment cost / sales-ready Account
- named-decision-maker rate
- verified-email rate
- usable-phone rate
- cost / qualified conversation

---

# 15. CONTACT COVERAGE METRICS

Per vertical/market/provider:

- % with verified main business phone
- % with named target contact
- % with verified/usable business email
- % with both call + email
- % role-route only
- % blocked by contact review
- bounce rate
- wrong-number rate
- correct-person referral rate

This tells YAD whether the problem is prospect supply or contact enrichment.

---

# 16. REP-FACING EXAMPLES

## Strong named contact

> Sarah Jones — Operations Manager  
> Email: licensed provider email, checked 4 days ago  
> Phone: main business line  
> Ask for Sarah / Operations.

## No name, strong role route

> Named decision-maker not verified.  
> Call verified main number and ask for the person who oversees inbound lead handling / operations.

## Stale named contact

> John Smith — former owner/contact signal from 2024; current employment unverified.  
> Do not personalize as current. Use company/role route.

---

# 17. SMARTLEAD ELIGIBILITY

A contact is not Smartlead-ready merely because an email string exists.

Required:

- Account eligible
- contact relationship valid enough
- email quality accepted by campaign policy
- no bounce/opt-out
- no conflicting sequence
- no client/active-opportunity exclusion
- personalization freshness sufficient

---

# 18. REGRESSION TESTS

1. Website confirms Ops Manager, no direct endpoint -> use role/name + main phone.
2. Apollo lists owner but website says founder retired -> contact review; do not confidently use stale owner.
3. Gatekeeper gives new Sales Manager email -> preserve referral evidence; no duplicate Account.
4. Hard bounce -> invalidate email only.
5. Wrong number -> invalidate phone only.
6. Catch-all/unknown email verifier -> do not label verified.
7. Multiple stakeholders -> primary chosen by hypothesis, alternatives preserved.
8. No named person -> role route is valid.
9. Contact found in another vertical campaign -> same Contact/Account, history preserved.
10. DNC/opt-out -> endpoint/Account excluded according to policy regardless of contact quality.

---

# 19. CORE RULE

The brain should maximize **usable, trustworthy contact paths**, not the percentage of rows with a name/email populated. An honest role route on a verified business number is better than a fabricated decision-maker record.