# Your AI Department — Financial Diagnosis / Business-Case Calculator Specification

**Status:** Architecture authority  
**Purpose:** Let the sales brain perform useful arithmetic without turning incomplete prospect data into fake ROI, revenue guarantees, or inflated “money lost” claims.

---

# 1. PRINCIPLE

The calculator is deterministic arithmetic around sourced inputs.

The LLM may:

- identify which inputs are needed;
- ask the prospect for them;
- explain the result in business language.

The LLM may NOT:

- invent missing inputs;
- choose aggressive assumptions silently;
- turn theoretical exposure into expected recovery;
- claim the scenario is guaranteed.

---

# 2. SOURCE CLASS REQUIRED FOR EVERY INPUT

- `prospect_verified`
- `prospect_estimate`
- `system_verified`
- `public_source`
- `external_benchmark`
- `illustrative_assumption`
- `unknown`

Every calculation stores source class with each input.

---

# 3. OUTPUT CLASSES

Separate:

## Observed/current fact

Derived entirely from verified/prospect-supplied inputs with straightforward arithmetic.

## Theoretical exposure

Maximum/upper-bound pool potentially affected by a problem.

## Illustrative scenario

Uses clearly labeled assumptions to model possibilities.

## Recoverable opportunity estimate

Only when inputs/data support a defensible estimate; must still be framed as estimate, not guarantee.

## Actual measured ROI

Only after implementation with real baseline/post-period data and agreed methodology.

Cold calling usually reaches only the first three categories.

---

# 4. CALCULATION RECORD

Fields:

- calculator ID/version
- account/opportunity/call ID
- calculation type
- input values + units + source classes
- formula
- output value/range
- output class
- assumptions[]
- missing inputs[]
- sensitivity scenarios[]
- disclaimer/approved wording key
- created timestamp

Preserve exactly what inputs generated the number.

---

# 5. MISSED-CALL EXPOSURE

Inputs:

- monthly inbound calls
- unanswered/missed percent
- legitimate new-business percent among missed calls
- average first-job/customer revenue

Formula:

`monthly_missed_calls = inbound_calls * missed_rate`

`missed_legitimate_opportunities = monthly_missed_calls * legitimate_new_business_rate`

`gross_opportunity_value_touching_missed_calls = missed_legitimate_opportunities * average_customer_revenue`

This last figure is **exposure**, not recoverable revenue.

Do NOT automatically multiply every legitimate missed opportunity by 100% close rate.

---

# 6. MISSED-CALL RECOVERY SCENARIO

Optional additional input:

- illustrative incremental capture/close percentage

Formula:

`illustrative_recovered_customers = missed_legitimate_opportunities * scenario_capture_close_rate`

`illustrative_revenue = illustrative_recovered_customers * average_customer_revenue`

Required wording concept:

> If your estimate of X missed legitimate opportunities is close, and a better process ultimately converted Y% of that group, this would be an illustrative revenue scenario of Z. That is not a guarantee; we should replace the assumptions with actual call and sales data.

---

# 7. LEAD RESPONSE

Inputs may include:

- lead volume by channel
- current median/average response time if measured
- contact rate
- appointment rate
- close rate
- customer value

Do not invent a universal uplift from faster response.

If only lead volume and current process are known:

Output:

- measurement plan;
- affected lead pool;
- no promised recovery.

---

# 8. UNSOLD ESTIMATE / PROPOSAL EXPOSURE

Inputs:

- number of unsold/open estimates
- total face value or average estimate value
- age buckets
- current follow-up process

`open_pipeline_face_value` can be calculated.

But:

`open_pipeline_face_value != recoverable revenue`

Optional scenario input:

- illustrative incremental close percentage

`scenario_incremental_revenue = eligible_open_pipeline_value * illustrative_incremental_close_rate`

Eligibility may exclude stale/lost/ineligible estimates where data permits.

---

# 9. EMPLOYEE-CAPACITY VALUE

Inputs:

- number of affected employees
- repetitive/admin hours per week
- percentage realistically addressable
- loaded hourly labor cost or approved cost basis
- weeks/year or analysis period

Formula:

`addressable_hours = employees * repetitive_hours * addressable_percent`

`capacity_value = addressable_hours * loaded_hourly_cost`

Position as:

- capacity value;
- redeployable time;
- possible avoided incremental workload;

Do NOT automatically call it payroll savings.

---

# 10. HIRING-DEFERRAL / CAPACITY SCENARIO

If prospect says next hire is driven by workload, model only with explicit inputs:

- role cost;
- workload being added;
- portion addressable through system improvement;
- hiring timing.

Output:

> potential capacity/hiring-deferral scenario

not:

> guaranteed headcount reduction.

---

# 11. ADVERTISING EFFICIENCY

Inputs:

- ad spend by source from prospect/system data
- leads
- booked jobs/appointments
- sold customers
- collected revenue

Metrics:

- cost per lead
- cost per booked job
- cost per customer
- revenue by source
- ROAS where methodology/data is appropriate

Do not estimate spend from visible ad count/position.

---

# 12. ATTRIBUTION GAP

If spend exists but revenue mapping does not:

Do not fake ROAS.

Output:

- known spend
- known leads
- known booked jobs if available
- missing revenue attribution
- measurement gap.

The business case may be improved visibility/decision quality rather than direct revenue claim.

---

# 13. REACTIVATION

Inputs:

- contactable eligible population
- response rate assumption/data
- qualification rate
- close rate
- customer value
- outreach cost

Use funnel stages separately.

Never:

`database size * customer value = opportunity`

without response/qualification/close assumptions.

Compliance/communication permission is a separate gate before outreach.

---

# 14. NO-SHOW / APPOINTMENT RECOVERY

Inputs:

- appointments
- no-show rate
- eligible recovery population
- scenario recovered-show rate
- conversion/customer value where relevant

Again: label assumptions.

---

# 15. RANGE SCENARIOS

When prospect data is uncertain, model:

- conservative
- middle illustrative
- high illustrative

But never choose the high scenario as the headline.

Each scenario explicitly lists changed assumptions.

Example missed calls:

- 10% recovery scenario
- 20%
- 30%

not “we will recover 30%.”

---

# 16. MISSING-DATA BEHAVIOR

If a required input is missing:

Return:

- `calculation_status = insufficient_data`
- missing fields
- next measurement question/action

Do not auto-fill with “industry average” unless:

- benchmark is approved/current;
- it is explicitly labeled external benchmark;
- scenario is clearly illustrative;
- Sales Manual evidence rules allow use.

Prefer prospect data.

---

# 17. BENCHMARK USE

External benchmarks can help contextualize, not replace prospect facts.

Store:

- benchmark source
- population
- date
- limitation
- approved wording

If evidence register says pending/unverified, do not use as settled calculator input.

---

# 18. DISPLAY / SPOKEN OUTPUT

Human Assist UI should show:

- inputs
- source labels
- formula
- exposure vs illustrative recovery
- assumptions
- missing data

Voice agent should summarize simply.

Bad:

> You're losing $45,000 a month.

Better:

> Based on your estimate of 500 calls and about 10% missed, that's roughly 50 missed calls. We still don't know how many are legitimate new customers or what percentage could actually be recovered, so I wouldn't call that lost revenue yet.

---

# 19. TOOL CONTRACT

`calculate_business_case` input:

- calculation_type
- inputs[] with value/unit/source
- scenario assumptions[]

Tool validates:

- required units
- ranges
- formula
- missing inputs

Output:

- calculation status
- results
- output class
- assumptions
- approved summary facts
- prohibited overstatement warning.

The LLM does not manually do complex arithmetic when tool is available.

---

# 20. SANITY VALIDATION

Reject/flag:

- percentages <0 or >100
- negative volume/value unless metric legitimately permits
- obvious unit mismatch
- impossible time period
- suspiciously large input requiring confirmation
- contradictory source values.

Do not silently “fix” prospect numbers.

---

# 21. FIXTURE A — INCOMPLETE MISSED CALL

Inputs:

- 500 calls/month prospect estimate
- 10% missed prospect estimate
- $900 average customer prospect estimate
- legitimate-new-business percent unknown

Expected:

- 50 missed calls calculated
- lost revenue NOT calculated
- missing legitimate-opportunity share
- no $45,000 loss claim.

---

# 22. FIXTURE B — COMPLETE ILLUSTRATIVE MISSED CALL

Inputs:

- 500 calls
- 10% missed
- 50% legitimate new business
- $900 average revenue
- illustrative 20% capture/close

Results:

- 50 missed calls
- 25 legitimate opportunity calls
- $22,500 gross opportunity value touching those calls
- illustrative 5 recovered customers
- illustrative $4,500 revenue scenario

Required labels:

- $22,500 = exposure, not expected recovery
- $4,500 = illustrative scenario, not guarantee.

---

# 23. FIXTURE C — UNSOLD ESTIMATES

Inputs:

- 40 open eligible estimates
- $8,000 average
- 5% illustrative incremental close

Results:

- $320,000 face-value open pipeline
- $16,000 illustrative incremental scenario

Never say:

> You're losing $320,000.

---

# 24. FIXTURE D — CAPACITY

Inputs:

- 4 CSRs
- 5 repetitive hours/week each
- 60% realistically addressable
- $32 loaded hourly cost

Result:

- 12 addressable hours/week
- $384/week capacity-cost equivalent

Wording:

`capacity value`, not guaranteed payroll reduction.

---

# 25. FIXTURE E — AD SPEND UNKNOWN

Public Google ad observed.

Expected:

- ad spend remains unknown
- no CAC/ROAS calculation
- ask prospect/system for spend if financially relevant.

---

# 26. QA HARD FAILS

- calls exposure “lost revenue” without support
- uses public ad visibility as spend number
- assumes 100% recovery
- hides illustrative assumption
- quotes external benchmark as prospect fact
- converts recovered employee time directly into payroll savings without qualification
- guarantees ROI/payback.
