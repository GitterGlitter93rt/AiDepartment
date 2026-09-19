# Your AI Department — Opportunity & Offer Selection Engine Specification

**Status:** Architecture authority  
**Commercial truth source:** `docs/00-company/launch-decisions.md`  
**Purpose:** Decide what business problem to investigate first and which current YAD offer/capability could logically follow if the prospect confirms the problem.

---

# 1. PRIMARY RULE

The engine does NOT ask:

> What product can we pitch this company?

It asks:

> What observable business condition creates the strongest reason to investigate a problem, and what YAD capability/offer may be relevant if discovery confirms it?

The output is an `OfferHypothesis`, not a guaranteed recommendation.

---

# 2. TWO-LAYER OUTPUT

Separate:

## Layer A — Solution / capability hypothesis

Examples:

- website/conversion foundation
- missed-call recovery
- AI phone handling
- speed-to-lead
- CRM implementation
- CRM optimization
- workflow automation
- attribution/reporting
- reactivation
- paid acquisition
- SEO
- landing page/conversion optimization
- employee-capacity automation
- internal AI assistant
- training

## Layer B — Commercial wrapper

Must map to current launch decisions:

- `AI Department Assessment` — free
- `AI Strategy Call` — free discovery/qualification conversation
- `Executive AI Strategy` — approximately $5,000+ starting point depending on scope
- `AI Implementation` — approximately $5,000–$50,000+ depending on scope
- `AI Growth Systems` — custom setup/management architecture
- `Managed AI Department` — custom monthly retainer
- `Google Ads`
- `Meta Ads`
- `SEO`
- `AI Training`
- `AI Workshops`
- `Executive AI Coaching`
- `Enterprise AI Transformation` when applicable

Do not create a new canonical package name such as “HVAC AI Receptionist Platinum” unless leadership intentionally approves it.

---

# 3. OUTPUT CONTRACT

For each ranked offer hypothesis:

- `solution_category`
- `commercial_offer_family`
- `rank`
- `why_now`
- `supporting_evidence_ids[]`
- `supporting_opportunity_hypothesis_ids[]`
- `missing_discovery_questions[]`
- `confidence`
- `recommended_next_step`
- `must_not_claim[]`
- `do_not_recommend_if[]`

The engine should return at most three offer hypotheses for a normal cold-call Call Pack.

The live caller usually discusses ONE confirmed problem, not all three.

---

# 4. RECOMMENDED NEXT-STEP HIERARCHY

## If the problem is not yet verified

Preferred:

- ask discovery question;
- AI Strategy Call;
- free AI Department Assessment where useful;
- request measurement/data review.

## If a narrow, well-defined implementation problem is confirmed

Potential:

- AI Implementation;
- AI Growth Systems component;
- standalone current service where appropriate.

## If business complexity spans departments/workflows

Potential:

- Executive AI Strategy;
- Managed AI Department later if ongoing relationship makes sense.

## If there is no meaningful problem

- no sale;
- maintain relationship;
- future follow-up only if legitimate.

Do not force the free Assessment onto every outbound prospect. Launch decisions explicitly allow qualified prospects with defined problems to enter through a Strategy Call or service-specific inquiry.

---

# 5. WEBSITE / CONVERSION FOUNDATION

## Signals

- no independently verified website;
- social-only presence;
- website exists but core service/phone/CTA is difficult to find;
- severe mobile usability/conversion issue observable without guessing backend performance;
- paid advertising landing on a visibly weak/generic experience;
- no dedicated high-value-service landing page where the company is actively advertising that service.

## Primary problem hypothesis

The customer-acquisition path may be weaker than the traffic source because prospects have difficulty understanding, trusting, or taking the next action.

## Possible solution categories

- website improvement;
- landing page;
- conversion optimization;
- tracking foundation.

## Commercial mapping

- AI Growth Systems;
- AI Implementation when implementation is primarily technical/custom;
- service-specific marketing engagement if approved.

## Questions before recommending

- How important is the website to lead generation today?
- Which services are you trying to grow?
- Where are calls/forms currently coming from?
- Are you planning a redesign already?

## Must not claim

- the website has a bad conversion rate unless measured;
- redesign will increase revenue by a specific percentage;
- no website equals no business success.

---

# 6. MISSED-CALL / AFTER-HOURS / AI PHONE

## Signals

- phone-heavy vertical;
- emergency/24-7 service;
- fresh paid-search/LSA evidence;
- visible after-hours service promise;
- multiple locations;
- heavy call CTA;
- prospect confirms unanswered/overflow/after-hours gap.

## Primary hypothesis

High-value or paid inbound calls may need more reliable capture, routing, acknowledgement, scheduling, follow-up, or escalation.

## Possible solution categories

- AI phone handling;
- overflow;
- missed-call SMS;
- callback workflow;
- call summaries;
- routing;
- CRM update;
- human escalation.

## Commercial mapping

- AI Implementation;
- AI Growth Systems when tied to acquisition/conversion;
- Managed AI Department only if ongoing optimization scope is justified.

## Gate

Do NOT recommend AI phone merely because the business has a phone number.

Strong current answering/overflow process should demote this solution and move discovery elsewhere.

## Must not claim

- every missed call is a lost customer;
- AI replaces receptionist/dispatcher;
- AI handles technical/safety judgment;
- all calls can be fully automated.

---

# 7. SPEED-TO-LEAD / APPOINTMENT SETTING

## Signals

- active Meta lead generation;
- active paid search sending to forms;
- quote/consultation/estimate forms;
- urgent or competitive buying journey;
- prospect confirms delayed response or inconsistent callback.

## Possible solution categories

- instant acknowledgment;
- lead routing;
- SMS/email follow-up;
- AI qualification;
- appointment setting;
- task creation;
- sales alerts.

## Commercial mapping

- AI Growth Systems;
- AI Implementation.

## Must not claim

- current response time from frontend observation alone;
- faster response guarantees sales.

---

# 8. CRM IMPLEMENTATION

## Signals

Public signals alone are insufficient to conclusively say the company has no CRM.

The recommendation becomes strong only when discovery confirms:

- no central lead/customer system;
- spreadsheets/paper/inboxes/personal phones dominate;
- lead ownership/status/follow-up cannot be reliably seen;
- business volume/economics justify the implementation.

## Possible solution categories

- CRM selection;
- pipeline design;
- lead source fields;
- routing;
- follow-up tasks;
- dashboards;
- integrations.

## Commercial mapping

- AI Implementation;
- AI Growth Systems where acquisition-to-revenue is the use case.

## Must not claim

- no CRM because no script was detected;
- YAD's preferred platform must replace an incumbent.

---

# 9. CRM OPTIMIZATION / INTEGRATION

## Signals

- ServiceTitan/Housecall Pro/Jobber/HubSpot/Salesforce/etc. signal;
- multiple lead-entry methods;
- call tracking;
- paid ads;
- multiple locations;
- prospect confirms manual transfer, follow-up, reporting or attribution gap.

## Positioning

Existing CRM is positive.

Ask:

- What happens automatically after the lead enters?
- What still happens manually?
- Can calls/forms/bookings/revenue be connected?
- What do employees wish the system did better?

## Commercial mapping

- AI Implementation;
- AI Growth Systems;
- Managed AI Department later for ongoing optimization.

## Must not claim

- incumbent CRM is bad;
- integration definitely exists until technically verified.

---

# 10. UNSOLD ESTIMATE / PROPOSAL FOLLOW-UP

## Signals

- high-ticket estimate/proposal-driven business;
- financing;
- replacement/installation/project services;
- prospect confirms open estimates and inconsistent follow-up.

## Possible solution categories

- pipeline stages;
- automated follow-up;
- task automation;
- aged-estimate dashboards;
- financing reminders;
- reactivation;
- lost-reason reporting.

## Commercial mapping

- AI Implementation;
- AI Growth Systems where it is part of sales conversion.

## Must not claim

- open pipeline is recoverable revenue;
- fixed close-rate improvement.

---

# 11. ATTRIBUTION / ANALYTICS

## Signals

- active paid ads;
- call tracking;
- multiple lead sources;
- multiple locations;
- CRM/system signals;
- prospect cannot answer which campaigns lead to booked/collected revenue.

## Possible solution categories

- source capture;
- offline conversion flow;
- CRM attribution;
- call attribution;
- dashboards;
- executive reporting.

## Commercial mapping

- AI Growth Systems;
- AI Implementation.

## Must not claim

- agency is wasting money;
- current attribution is wrong until diagnosed;
- ad spend amount from ad visibility.

---

# 12. PAID ACQUISITION / GOOGLE ADS / META ADS

## Signals

This recommendation is NOT simply the inverse of “not currently advertising.”

Relevant evidence may include:

- strong website and conversion foundation;
- clear growth objective;
- high-value economics;
- geographic/service expansion;
- current paid acquisition weak/absent as confirmed through discovery;
- prospect wants more demand;
- YAD can realistically serve the market.

## Commercial mapping

- Google Ads;
- Meta Ads;
- AI Growth Systems.

## Must not claim

- not seeing an ad proves no campaign exists;
- prospect needs ads when it already has more demand than capacity;
- advertising will guarantee leads/revenue.

---

# 13. SEO / LOCAL VISIBILITY

## Signals

- relevant business with strong economics;
- prospect confirms organic/local visibility is a growth priority;
- meaningful website/local-search opportunity after audit.

## Commercial mapping

- SEO;
- AI Growth Systems.

Do not recommend SEO solely because the business did not rank in one personalized search.

---

# 14. REACTIVATION

## Signals

- recurring/repeat service model;
- memberships/maintenance;
- old estimates;
- long-lived customer database;
- prospect confirms stale leads/customers or inconsistent reactivation.

## Possible solution categories

- customer segmentation;
- compliant email/SMS/call sequences;
- renewal reminders;
- old-estimate follow-up;
- seasonal reactivation.

## Commercial mapping

- AI Implementation;
- AI Growth Systems.

## Gate

Actual outreach permissions/compliance must be evaluated separately.

---

# 15. EMPLOYEE-CAPACITY AUTOMATION

## Signals

- hiring/growth;
- multiple locations;
- seasonal surge;
- phone/scheduling/admin-heavy workflow;
- prospect identifies repetitive work.

## Possible solution categories

- workflow automation;
- call summaries;
- CRM note automation;
- recurring reporting;
- customer-status communication;
- internal AI assistants;
- integrations.

## Commercial mapping

- AI Implementation;
- Executive AI Strategy if cross-department complexity;
- Managed AI Department where ongoing optimization is justified.

## Must not claim

- employees are wasteful;
- labor hours equal payroll savings;
- implementation means layoffs.

---

# 16. TRAINING / ADOPTION

## Signals

Usually prospect-confirmed, not externally inferred.

Examples:

- leadership bought AI tools but adoption is inconsistent;
- employees use public AI without guidance;
- management wants approved workflows;
- executives want practical training.

## Commercial mapping

- AI Training;
- AI Workshops;
- Executive AI Coaching;
- Executive AI Strategy when broader roadmap needed.

---

# 17. EXECUTIVE AI STRATEGY

Recommend when:

- multiple high-value opportunity categories exist;
- cross-department workflow mapping is needed;
- the system landscape is complex;
- data/security/governance questions materially affect design;
- the prospect needs prioritization/roadmap before implementation.

Do not use Executive AI Strategy merely as an upsell when a small, obvious implementation is sufficient.

Current launch decision: approximately $5,000+ starting point depending on scope.

---

# 18. MANAGED AI DEPARTMENT

Potential only after enough discovery exists to justify an ongoing strategic relationship.

Signals:

- multiple recurring AI/automation opportunities;
- continuous vendor/implementation oversight;
- governance/training/optimization needs;
- executive leadership wants ongoing capability without building full internal department.

Pricing is custom monthly retainer.

The cold caller should not quote an invented monthly price.

---

# 19. NO-SALE / MEASURE-FIRST

This is a valid and important output.

Choose when:

- the hypothesized problem is already handled strongly;
- no meaningful pain is found;
- economics appear too small;
- prospect lacks volume/complexity to justify implementation;
- public research is too thin to make a relevant recommendation;
- a measurement baseline is needed before solution design;
- requested solution would be unsafe/unethical;
- existing software/process already solves the problem;
- YAD is not a good fit.

Possible next steps:

- leave it alone;
- measure call/lead data;
- revisit later;
- complete Assessment;
- no further contact.

---

# 20. OFFER RANKING LOGIC

The engine scores offer hypotheses using separate dimensions; this is NOT the YAD prospect fit score.

Suggested 0–5 per dimension:

- evidence relevance;
- likely economic leverage;
- prospect-specific fit;
- urgency/time sensitivity;
- measurability;
- YAD capability fit;
- implementation simplicity.

Subtract/demote for:

- contradictory evidence;
- strong incumbent workflow;
- missing critical discovery;
- sensitive/regulatory complexity;
- research staleness.

Do not expose this internal rank as promised ROI.

---

# 21. TIE-BREAK RULES

When two offer hypotheses rank similarly:

1. prefer the one tied to the clearest observed public signal;
2. prefer the one with the simplest high-value discovery question;
3. prefer the one closest to the company's stated growth/customer journey;
4. prefer the one easiest to measure;
5. prefer improving an existing system before replacing it;
6. prefer narrower diagnosis before broader expensive implementation.

---

# 22. HVAC EXAMPLES

## Example A — Google advertiser + 24/7 + replacement financing

Observed:

- Google sponsored AC repair/replacement;
- 24/7;
- financing;
- phone + quote CTA;
- ServiceTitan booking signal.

Rank:

1. missed-call/after-hours workflow -> AI Implementation / AI Growth Systems
2. unsold replacement estimate follow-up -> AI Implementation
3. attribution -> AI Growth Systems

Do NOT rank “new CRM” first merely because a CRM-related signal exists.

## Example B — no website

Observed:

- verified operating HVAC business;
- no canonical website found after independent checks;
- strong local customer economics likely from vertical model.

Rank:

1. website/conversion foundation -> AI Growth Systems / implementation scope
2. lead tracking/CRM discovery -> ask, do not assume
3. paid acquisition -> only after capacity/growth goals are confirmed

## Example C — sophisticated operator

Observed/prospect-confirmed:

- strong field-service platform;
- live overflow;
- automated missed-call recovery;
- measured lead response;
- closed-loop attribution;
- standardized estimate follow-up.

Output:

`no_sale_measure_first`

Investigate another legitimate category only if there is evidence. Do not manufacture an AI project.

---

# 23. LIVE-CALL BEHAVIOR

The caller should usually NOT tell the prospect:

> Our engine thinks you need an AI phone agent.

Instead:

1. use public evidence to ask a relevant question;
2. learn the real process;
3. update the hypothesis;
4. position a capability only if a meaningful gap exists;
5. earn the correct next step.

The offer engine prepares the conversation; it does not replace discovery.
