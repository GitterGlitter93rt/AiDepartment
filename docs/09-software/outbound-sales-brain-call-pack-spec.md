# Your AI Department — Call Pack Specification & Worked Examples

**Status:** Architecture authority  
**Purpose:** Define the compact, prospect-specific context handed from Market Miner/Strategy Brain to a human rep or realtime voice agent.

---

# 1. CALL PACK PURPOSE

The Call Pack exists so the caller does NOT need to:

- browse the internet during the call;
- read the whole Sales Manual every turn;
- interpret raw crawler output;
- guess why the prospect was selected;
- invent a hook;
- confuse public facts with hypotheses;
- dump every YAD capability.

A good Call Pack answers:

1. Who are we calling?
2. Why are they high priority?
3. What do we actually know?
4. What do we only suspect?
5. What is the best first question?
6. What is the backup question?
7. What should we avoid claiming?
8. What next steps are currently approved?

---

# 2. IMMUTABLE SNAPSHOT

A Call Pack is immutable.

It references:

- research run;
- canonical score;
- vertical-profile version;
- Sales Manual knowledge snapshot;
- commercial-truth snapshot/reference;
- compliance decision where applicable;
- campaign/version.

If relevant research changes, generate a new Call Pack rather than mutating history.

---

# 3. CANONICAL FIELDS

## Identity

- `call_pack_id`
- `account_id`
- `company_name`
- `location_summary`
- `website`
- `phone`
- `contact_name` optional
- `contact_role` optional
- `vertical`
- `campaign`

## Prioritization

- `yad_score`
- `yad_tier`
- `score_reasons[]`
- `research_completeness`
- `queue_rank_reason`

## Confirmed facts

Maximum 5 in live pack.

Each:

- `fact`
- `evidence_id`
- `observed_at`
- `freshness`

## Important unknowns

Maximum 5.

Examples:

- unanswered-call rate
- actual CRM workflow
- monthly ad spend
- replacement close rate
- decision-maker

## Primary hypothesis

- category
- one-sentence hypothesis
- why it is worth asking
- evidence IDs
- questions needed to verify

## Backup hypothesis

Same structure, shorter.

## Primary/secondary offer hypothesis

Used internally to guide positioning. Not automatically spoken.

## Hook

- primary hook
- backup hook
- alternate gatekeeper version

## Opener

One recommended opener, generally no more than ~35 spoken words before first question.

## First questions

3–5 ordered questions. The caller does NOT have to ask all of them.

## Objection pointers

Top 3–5 likely objections with compact guidance/manual retrieval keys.

## System signals

Only meaningful systems with confidence labels.

## Prohibited claims

Prospect-specific list.

## Approved next steps

Examples:

- strategy_call
- assessment
- technical_follow_up
- send_targeted_email
- human_callback
- disqualify

## Compliance

For autonomous call use only:

- decision
- reason codes
- expiry
- recording/transcription flags

---

# 4. CONTEXT BUDGET

The realtime Call Pack should be compact enough that it is always in immediate model context.

Initial target:

- 800–1,500 words of prospect-specific context maximum;
- prefer structured compact fields;
- no raw HTML;
- no full web pages;
- no complete Sales Manual module;
- no duplicate facts.

Live RAG can retrieve one small manual excerpt when a new objection/topic emerges.

The human-assist UI may show deeper evidence separately.

---

# 5. FACT LANGUAGE

## Confirmed + fresh

Allowed:

- “I noticed...”
- “I saw...”
- “Your site says...”
- “You’re currently advertising...” only with fresh current ad evidence.

## Likely

Prefer question form:

- “It looked like you may use ServiceTitan — is that what you’re on?”

or simply:

- “What are you using today for the field-service/CRM side?”

## Unknown

Ask. Never convert unknown to assertion.

---

# 6. PROSPECT CORRECTION RULE

If prospect contradicts the pack:

1. accept correction;
2. do not defend crawler/research;
3. update conversation state;
4. create `ProspectStatement`;
5. mark relevant public evidence stale/contradicted after call;
6. choose new hypothesis if necessary.

Example:

Agent:

> It looked like you may be using ServiceTitan—

Prospect:

> No, we switched to Housecall Pro.

Correct:

> Got it. What happens automatically after a new lead enters Housecall Pro today?

Incorrect:

> Our research says ServiceTitan.

---

# 7. PRIMARY HOOK SELECTION

Choose one hook using this order:

1. freshest confirmed high-value prospect-specific signal;
2. vertical relevance;
3. economic leverage;
4. easiest useful question;
5. least accusatory wording.

Do not select a clever hook that depends on weak evidence over a simpler hook based on a confirmed signal.

---

# 8. BACKUP HOOK RULE

Backup hook should normally test a different workflow category.

Example HVAC:

Primary: paid after-hours call handling.

Backup: unsold replacement estimates.

If prospect says after-hours process is excellent, caller can genuinely say:

> Great. I’d leave that alone. What happens to replacement estimates that don’t close on the first presentation?

---

# 9. WORKED EXAMPLE 1 — TIER A HVAC GOOGLE ADVERTISER

## Research

Company: Example Comfort Air

Observed:

- fresh Google sponsored result for `emergency AC repair Jacksonville`;
- website says `24/7 Emergency Service`;
- replacement + financing page;
- phone CTA and quote form;
- ServiceTitan-related booking signal;
- one Jacksonville location.

Unknown:

- monthly ad spend;
- missed-call rate;
- whether answering service/overflow exists;
- actual ServiceTitan workflow;
- replacement close/follow-up process.

## Score

Google ads +4
High-value economics +2
Lead/intake operational importance +2
24/7 +1
Estimate/intake-heavy +1
Phone dependence +1
Lead form +1

Total: 12 — Tier A

## Call Pack

Primary hypothesis:

Paid/urgent calls may require measurable after-hours/overflow recovery.

Primary hook:

> I noticed you guys are advertising around emergency AC in Jacksonville. When one of those calls comes in after hours or everybody is already tied up, what happens next?

Backup:

> What happens to a replacement estimate that doesn’t close on the first presentation?

First questions:

1. What happens after hours today?
2. Do missed calls create a text or callback task automatically?
3. Roughly how many inbound calls do you handle in a normal month?
4. If that part is already strong: who owns unsold replacement follow-up?

Likely objections:

- we use ServiceTitan;
- we have an answering service;
- our dispatchers handle it.

Primary offer hypothesis:

AI Implementation / AI Growth Systems around call capture, CRM workflow or follow-up — only if discovery confirms gap.

Prohibited claims:

- you are spending heavily on Google;
- you miss X% of calls;
- ServiceTitan is not configured correctly;
- AI will recover every missed customer.

---

# 10. WORKED EXAMPLE 2 — HVAC META + FORM LEAD FUNNEL

Observed:

- confirmed active Meta ad promoting AC replacement financing;
- website form requests consultation/estimate;
- no fresh Google sponsored observation;
- phone prominent;
- no CRM signal confirmed.

Primary hypothesis:

Paid social inquiries may need fast acknowledgement, assignment and follow-up.

Hook:

> I saw you’re promoting AC replacement financing on Facebook. When somebody responds but doesn’t book on the first contact, what happens next?

Backup:

> How quickly does a brand-new web lead normally hear from somebody?

Unknowns:

- exact response time;
- lead volume;
- CRM;
- close rate;
- ad spend.

Do not say:

> Your Facebook leads are going cold.

---

# 11. WORKED EXAMPLE 3 — HVAC, NO CONFIRMED ADS, MULTI-LOCATION

Observed:

- three locations;
- 24/7 service;
- online booking;
- replacement focus;
- visible CSR/dispatcher hiring;
- no confirmed current paid-ad evidence.

Primary hypothesis:

Multi-location + hiring + urgent volume creates a reasonable capacity/routing consistency question.

Hook:

> Quick question — when peak-season volume spikes across all three locations, where does the office get overloaded first: phones, scheduling, dispatch, follow-up, or reporting?

Backup:

> Does every new call/form land in one system with an assigned owner, or is it different by location?

Do not mention ads.

---

# 12. WORKED EXAMPLE 4 — STRONG SERVICETITAN SIGNAL

Observed:

- ServiceTitan booking widget;
- Google ads;
- call tracking;
- two locations.

Primary hypothesis:

Not “needs CRM.”

Instead:

How well is the acquisition-to-revenue workflow configured through existing systems?

Hook:

> I noticed you’re advertising and it looks like ServiceTitan is part of the customer flow. Can you trace one Google lead from the original call all the way through booked job and actual revenue in one place?

If prospect confirms yes and strong:

> Good. I’d leave that alone.

Move to another legitimate hypothesis or disqualify.

---

# 13. WORKED EXAMPLE 5 — NO VERIFIED WEBSITE

Observed:

- active business independently verified;
- business phone/location confirmed;
- after multiple independent checks, no canonical current website identified;
- no paid-ad evidence yet.

Primary hypothesis:

Digital conversion foundation may be an opportunity, but confirm first.

Opener:

> Hey, this is [Agent] with Your AI Department. This is a cold call, so I’ll be brief. I was looking at HVAC companies in the area and couldn’t find a current website for you. Are you mainly getting business through referrals/Google Business Profile today, or is there a site I missed?

If site exists:

Acknowledge and correct.

If no site:

Ask whether growth/digital acquisition is actually a priority before pitching one.

Prohibited:

> You need a website or your business is losing money.

---

# 14. WORKED EXAMPLE 6 — GOOGLE ADVERTISER WITH EXCELLENT AFTER-HOURS

Observed:

- Google ad + 24/7.

Initial hook tests after-hours.

Prospect says:

> We use live CSRs 24/7, answer 99% of calls, have overflow, and measure it weekly.

Conversation update:

- primary hypothesis becomes contradicted/low priority;
- record strong process;
- do not argue.

Correct transition:

> Great. I’d leave that alone. What happens to replacement estimates that don’t close on the first presentation?

If that is strong too, test attribution/capacity only if relevant, then disqualify if no pain.

---

# 15. WORKED EXAMPLE 7 — ANSWERING SERVICE

Observed:

- 24/7 website;
- paid ads.

Prospect:

> We already have an answering service.

Correct:

> Good. Does it mainly take the message, or can it actually qualify, schedule, route, and create the next tracked step?

Follow:

> How quickly does your internal team take over?

The Call Pack should contain this objection pointer, not a generic “overcome answering service” sales response.

---

# 16. WORKED EXAMPLE 8 — REPLACEMENT / FINANCING SPECIALIST

Observed:

- dedicated system-replacement pages;
- financing prominently promoted;
- no emergency/24-7 messaging;
- quote request;
- paid search for `AC replacement`.

Primary hypothesis:

Unsold replacement estimate follow-up.

Hook:

> I noticed you’re advertising around AC replacement and financing. When a homeowner gets a proposal and says they need to think about it, who owns the next 30 days of follow-up?

Backup:

> Can management see the total dollar value and age of every open replacement proposal right now?

Do not use after-hours as primary merely because HVAC often has emergency calls; research points elsewhere.

---

# 17. WORKED EXAMPLE 9 — GOOGLE + META + MULTI-CHANNEL

Observed:

- Google sponsored AC replacement;
- Meta replacement financing creative;
- two locations;
- call tracking;
- web quote form.

Primary hypothesis:

Attribution may be worth testing because multiple paid sources feed phone/form pathways.

Possible hook:

> You guys are active on both Google and Facebook around replacement. Can you tie those campaigns all the way through to booked jobs and collected revenue, or does reporting mostly stop around the lead stage?

Important:

The second half is a question. Do not assert reporting stops at the lead stage.

---

# 18. WORKED EXAMPLE 10 — HIRING / CAPACITY SIGNAL

Observed:

- careers page hiring CSRs and dispatchers;
- multiple locations;
- no fresh ad evidence;
- heavy phone/scheduling CTAs.

Primary hypothesis:

Office capacity may be constraining growth or driving hiring.

Hook:

> I saw you’re hiring on the office/dispatch side. When volume grows, what workload actually creates the need for the next CSR or dispatcher?

Backup:

> What repetitive task would that team happily stop doing manually?

Do not say:

> AI can save you from hiring them.

---

# 19. WORKED EXAMPLE 11 — GATEKEEPER

Call Pack target contact unknown.

Gatekeeper answers.

Primary gatekeeper line:

> Totally fair — I’m not trying to pitch software to you at the front desk. I had one question about how new calls and follow-up are handled. Who normally owns that process — operations, sales, or the GM?

Goal:

- correct stakeholder;
- routing/contact path;
- no deception.

Success can be `gatekeeper_decision_maker_identified` without a pitch.

---

# 20. WORKED EXAMPLE 12 — NO GOOD FIT

Observed:

Research creates possible missed-call/CRM hypotheses.

Prospect demonstrates:

- excellent live answer/overflow;
- measured speed-to-lead;
- standardized follow-up;
- closed-loop attribution;
- strong CRM usage;
- no meaningful repetitive/admin pain;
- no growth problem.

Correct outcome:

Disqualify / no current project.

Call Pack/agent should permit:

> It sounds like you’ve got the areas I was calling about pretty well handled. I’d rather tell you that than manufacture a project.

This is a successful diagnostic outcome.

---

# 21. WORKED EXAMPLE 13 — WRONG PUBLIC CRM SIGNAL

Research:

- ServiceTitan frontend signature.

Prospect:

> We switched to Housecall Pro a month ago.

Agent:

> Got it. What happens automatically after a new lead enters Housecall Pro today?

Post-call:

- create prospect statement;
- mark ServiceTitan signal stale/contradicted;
- refresh website/tech evidence.

---

# 22. WORKED EXAMPLE 14 — SEND ME AN EMAIL

Call Pack says primary issue is replacement follow-up.

Prospect:

> Just email me something.

Correct:

> Absolutely. So I don’t send generic AI garbage — is the replacement follow-up piece actually the relevant one, or is there something else you’d rather see?

Then generate a short topic-specific follow-up.

Do not attach every YAD service by default.

---

# 23. WORKED EXAMPLE 15 — PRICE ASKED IMMEDIATELY

Prospect:

> How much is this?

Call Pack commercial truth:

- free AI Strategy Call;
- Executive AI Strategy roughly $5,000+ depending on scope;
- implementation roughly $5,000–$50,000+ depending on scope;
- AI Growth Systems custom;
- Managed AI Department custom.

Correct behavior:

Do not quote a fake fixed price for an undefined phone/CRM workflow.

Possible response:

> It depends on what the problem actually is and whether you need a small workflow fix or a broader implementation. I don’t want to throw a fake number at you before I understand it. The strategy call itself is complimentary; if there’s a real implementation case, scope and pricing come after that.

If a specific approved fixed-price service applies, use current commercial truth only.

---

# 24. CALL PACK GENERATION CHECKS

Before Call Pack becomes `ready`:

- score exists;
- score components trace to evidence;
- referenced facts are fresh enough for wording;
- primary hook references only confirmed facts;
- hypotheses are labeled internally;
- no unsupported spend/revenue/CRM claims;
- offer hypothesis maps to current commercial truth;
- vertical boundaries included;
- manual snapshot recorded;
- no DNC/suppression violation for autonomous-use pack.

---

# 25. CALL PACK QUALITY TEST

A reviewer should be able to read the pack in under two minutes and answer:

- Why this company?
- Why now?
- What do we know?
- What are we testing?
- What should the rep say first?
- What should the rep never say?

If not, the pack is too noisy or incomplete.
