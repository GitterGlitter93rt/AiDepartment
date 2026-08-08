# AI Department Assessment ROI Calculator

Status: Draft
Version: 1.0

---

# Purpose

The ROI calculator supports the AI Department Assessment by estimating the potential financial value of identified opportunities.

It should help estimate:

- Labor capacity recovered
- Overtime reduction
- Future hires potentially avoided
- Lead conversion opportunity
- Missed-call opportunity
- Advertising efficiency opportunity
- Accounts receivable efficiency
- Revenue opportunity
- Payback period
- Potential annual value

All calculations are estimates.

The system must clearly label assumptions.

The calculator should never present estimates as guaranteed outcomes.

---

# Core ROI Philosophy

AI should be justified financially whenever possible.

The assessment should help answer:

1. How much time is currently being consumed?
2. What is that time worth?
3. What percentage of the work may realistically be improved?
4. What would implementation cost?
5. What business value could be created?
6. How long could it take for the investment to pay back?

---

# Labor Capacity Calculator

Use when repetitive employee workload is identified.

## Inputs

Number of employees affected

Average repetitive hours per employee per week

Average hourly loaded labor cost

Estimated percentage of work that could be reduced or automated

Weeks per year

Default:

48 productive weeks per year

---

# Formula

Annual repetitive hours:

Employees
x
Repetitive hours per week
x
48

Potentially addressable hours:

Annual repetitive hours
x
Addressable percentage

Potential labor capacity value:

Potentially addressable hours
x
Loaded hourly labor cost

---

# Example

Employees affected:

5

Repetitive hours per employee per week:

8

Loaded hourly labor cost:

$35

Addressable percentage:

40%

Annual repetitive hours:

5 x 8 x 48

1,920 hours

Potentially addressable hours:

1,920 x 40%

768 hours

Potential labor capacity value:

768 x $35

$26,880 annually

---

# Important Labor Rule

Do not automatically describe recovered employee capacity as payroll savings.

Recovered capacity may instead create value by:

- Handling more customers
- Reducing overtime
- Increasing sales activity
- Improving customer service
- Completing work faster
- Avoiding future hiring
- Reassigning employees to higher-value activities

Preferred language:

"Potential annual labor capacity value"

Avoid:

"Guaranteed payroll savings"

---

# Loaded Labor Cost

Loaded labor cost should include more than hourly wage when appropriate.

Potential inputs:

- Salary or hourly wage
- Payroll taxes
- Benefits
- Insurance
- Employer contributions
- Equipment
- Software
- Management overhead

Simplified estimate:

Annual compensation
x
1.20 to 1.35

depending on available information.

If exact data is unavailable, clearly label the number as an estimate.

---

# Avoided Hiring Calculator

Use when the company is planning to hire additional administrative or support staff.

## Inputs

Expected annual compensation

Estimated employer burden

Recruiting cost

Training and onboarding cost

Percentage of workload potentially addressed through automation

---

# Formula

Estimated loaded annual employee cost:

Salary
x
Burden multiplier

Potential first-year hiring cost:

Loaded annual employee cost
+
Recruiting cost
+
Training cost

---

# Example

Salary:

$55,000

Burden multiplier:

1.25

Loaded annual cost:

$68,750

Recruiting and onboarding:

$7,500

Potential first-year cost:

$76,250

If workflow improvements allow the company to delay or avoid that hire, the business case may include some or all of this cost.

Important:

Do not assume AI can eliminate a planned role without workflow analysis.

---

# Overtime Reduction Calculator

## Inputs

Employees receiving overtime

Average overtime hours per week

Average overtime hourly cost

Potential overtime reduction percentage

---

# Formula

Annual overtime cost:

Employees
x
Overtime hours per week
x
48
x
Overtime hourly cost

Potential annual value:

Annual overtime cost
x
Potential reduction percentage

---

# Lead Conversion Calculator

Use when monthly lead volume and approximate customer value are available.

## Inputs

Monthly leads

Current conversion rate

Potential improved conversion rate

Average customer value

Months per year

---

# Formula

Current customers per month:

Monthly leads
x
Current conversion rate

Scenario customers per month:

Monthly leads
x
Improved conversion rate

Additional customers per month:

Scenario customers
-
Current customers

Potential annual additional revenue:

Additional customers per month
x
Average customer value
x
12

---

# Example

Monthly leads:

400

Current conversion:

10%

Scenario conversion:

12%

Current customers:

40

Scenario customers:

48

Potential additional customers:

8 per month

Average customer value:

$2,500

Potential annual revenue opportunity:

8 x $2,500 x 12

$240,000

Important:

This is a scenario estimate.

Do not represent the improved conversion rate as guaranteed.

---

# Lead Response Opportunity

Use when response time is slow.

The calculator may show scenario ranges based on:

- Monthly lead volume
- Average customer value
- Current conversion rate
- Estimated conversion improvement

Do not assume a specific conversion improvement unless supported by client data or clearly identified as an example scenario.

---

# Missed Call Calculator

## Inputs

Inbound calls per month

Estimated percentage unanswered

Percentage of unanswered calls that are legitimate sales opportunities

Expected close rate

Average customer value

---

# Formula

Unanswered calls:

Monthly calls
x
Unanswered percentage

Potential sales opportunities:

Unanswered calls
x
Qualified opportunity percentage

Scenario customers:

Potential opportunities
x
Expected close rate

Potential annual revenue represented:

Scenario customers
x
Average customer value
x
12

---

# Example

Monthly inbound calls:

1,000

Unanswered:

15%

Unanswered calls:

150

Estimated legitimate opportunities:

50%

75 opportunities

Expected close rate:

20%

15 potential customers

Average customer value:

$1,500

Potential monthly revenue represented:

$22,500

Potential annual revenue represented:

$270,000

Important:

Do not claim that an AI phone agent will capture all of this revenue.

Preferred wording:

"Estimated revenue represented by currently unanswered opportunities."

---

# Advertising Spend Calculator

## Inputs

Monthly advertising spend

Current cost per lead

Current lead volume

Current conversion rate

Average customer value

Potential efficiency scenario

---

# Annual Advertising Spend

Monthly spend
x
12

---

# Cost Per Acquired Customer

Cost per lead
divided by
Lead-to-customer conversion rate

Example:

Cost per lead:

$100

Conversion rate:

10%

Estimated acquisition cost:

$1,000

---

# Advertising Efficiency Scenario

Example:

Monthly spend:

$30,000

Current cost per qualified lead:

$300

Current qualified leads:

100

Scenario cost per qualified lead:

$250

Scenario qualified leads at same spend:

120

Additional qualified leads:

20

The assessment can show:

"Improving qualified lead efficiency from $300 to $250 could produce approximately 20 additional qualified leads per month at the same advertising budget."

Do not guarantee that this efficiency improvement is achievable.

---

# Advertising Waste Scenario

When enough campaign information exists, estimate:

Annual advertising spend

x
Potential inefficient-spend percentage

Example:

Annual spend:

$360,000

Scenario inefficient spend:

10%

Potential spend requiring review:

$36,000

Preferred language:

"Advertising spend potentially worth auditing"

Avoid:

"$36,000 is being wasted"

until a real audit supports that conclusion.

---

# Lead Reactivation Calculator

## Inputs

Inactive leads in database

Contactable percentage

Expected response rate

Expected appointment rate

Expected close rate

Average customer value

---

# Formula

Contactable leads:

Inactive leads
x
Contactable percentage

Responses:

Contactable leads
x
Response rate

Appointments:

Responses
x
Appointment rate

Customers:

Appointments
x
Close rate

Potential revenue:

Customers
x
Average customer value

---

# Accounts Receivable Labor Calculator

Use when employees spend significant time manually following up on unpaid invoices.

## Inputs

Employees involved

Hours per week

Loaded hourly labor cost

Potential automation percentage

---

# Formula

Annual collections labor:

Employees
x
Hours per week
x
48
x
Loaded hourly cost

Potential addressable labor value:

Annual collections labor
x
Automation percentage

---

# Accounts Receivable Cash Flow Opportunity

If client provides:

Average outstanding receivables

Average days sales outstanding

Potential reduced days outstanding

Then show a cash-flow scenario.

Do not treat accelerated collections as new revenue.

Preferred language:

"Potential working-capital improvement"

---

# Reporting Automation Calculator

## Inputs

Employees involved in reporting

Hours spent per reporting cycle

Reporting cycles per year

Loaded hourly labor cost

Estimated automation percentage

---

# Formula

Annual reporting labor:

Employees
x
Hours per cycle
x
Cycles per year
x
Loaded hourly cost

Potential annual capacity:

Annual reporting labor
x
Automation percentage

---

# Document Processing Calculator

Use for:

- Invoices
- Receipts
- Estimates
- Claims
- Applications
- Customer documents
- Contracts
- Forms

## Inputs

Documents per month

Minutes per document

Loaded hourly labor cost

Potential processing-time reduction

---

# Formula

Current monthly hours:

Documents per month
x
Minutes per document
divided by
60

Potential monthly hours saved:

Current monthly hours
x
Reduction percentage

Potential annual capacity value:

Monthly hours saved
x
12
x
Loaded hourly cost

---

# Customer Service Capacity Calculator

## Inputs

Customer inquiries per month

Average handling time

Percentage potentially handled or assisted by AI

Loaded hourly labor cost

---

# Formula

Monthly handling hours:

Inquiries
x
Average minutes
divided by
60

Potential AI-assisted hours:

Monthly handling hours
x
Addressable percentage

Potential annual labor capacity:

AI-assisted hours
x
12
x
Loaded hourly labor cost

---

# Internal Search and Knowledge Calculator

Use when employees spend time searching across documents and systems.

## Inputs

Employees affected

Average search time per employee per week

Loaded hourly labor cost

Potential reduction percentage

---

# Formula

Annual search hours:

Employees
x
Hours per week
x
48

Potential recovered hours:

Annual search hours
x
Reduction percentage

Potential capacity value:

Recovered hours
x
Loaded hourly labor cost

---

# Sales Administration Calculator

Use when salespeople spend time on:

- CRM entry
- Meeting notes
- Proposals
- Follow-up
- Scheduling
- Reporting

## Inputs

Salespeople affected

Administrative hours per salesperson per week

Average loaded hourly cost

Potential automation percentage

---

# Formula

Annual sales administration hours:

Salespeople
x
Administrative hours per week
x
48

Potential recovered selling capacity:

Annual administration hours
x
Automation percentage

Potential capacity value:

Recovered hours
x
Loaded hourly cost

---

# Revenue Per Employee

Optional strategic metric.

Formula:

Annual revenue
divided by
Number of employees

This may help assess scalability.

Do not use alone to judge employee efficiency.

---

# Cost of Delay

For high-value opportunities, the report may estimate what delaying implementation could represent.

Example:

Estimated monthly opportunity:

$10,000

Six-month delay scenario:

$60,000

Important:

Only use when the monthly opportunity itself is based on defensible assumptions.

Clearly label as a scenario.

---

# Implementation ROI

## Inputs

Estimated annual value

Implementation cost

Annual ongoing cost

---

# First-Year Net Value

Estimated annual value
-
Implementation cost
-
First-year ongoing cost

---

# Simple ROI Percentage

First-year net value
divided by
Total first-year investment

x
100

---

# Payback Period

Total implementation investment
divided by
Estimated monthly value

---

# Example

Implementation:

$20,000

Monthly ongoing:

$2,000

Estimated annual value:

$120,000

First-year investment:

$44,000

First-year net value:

$76,000

Simple first-year ROI:

approximately 173%

Estimated monthly value:

$10,000

Implementation-only payback:

approximately 2 months

This remains an estimate.

---

# Scenario Levels

Whenever uncertainty is meaningful, use three scenarios:

## Conservative

Low improvement assumption.

## Expected

Reasonable planning assumption.

## Aggressive

Higher improvement assumption.

The prospect should clearly understand that these are scenarios, not forecasts or guarantees.

---

# Example Scenario Table

Conservative:

$25,000 annual opportunity

Expected:

$60,000 annual opportunity

Aggressive:

$100,000 annual opportunity

This is more credible than presenting one unsupported number.

---

# Minimum Data Requirement

Do not calculate ROI merely because a category scored poorly.

Only calculate when sufficient data exists.

Examples:

Labor ROI requires:

- Workload
- Hours or volume
- Labor cost estimate

Growth ROI requires:

- Lead volume
- Conversion rate or scenario
- Customer value

Advertising ROI requires:

- Ad spend
- Lead or customer data

Missed-call ROI requires:

- Call volume
- Miss rate
- Customer value or scenario data

---

# Unknown Data

When information is missing, say:

"Additional data is required to estimate financial impact."

The strategy call can then collect the missing inputs.

This is useful because missing data itself can become part of the discovery process.

---

# Assessment ROI Outputs

The report may display:

## Potential Annual Labor Capacity

[XX hours]

## Potential Labor Capacity Value

$[XX]

## Potential Revenue Opportunity

$[XX] to $[XX]

## Potential Hiring Cost Avoidance

$[XX]

## Advertising Spend Worth Reviewing

$[XX]

## Potential Working Capital Improvement

$[XX]

Only show outputs supported by sufficient assessment inputs.

---

# Internal Opportunity Estimate

The internal sales dashboard may estimate:

Low potential value

Medium potential value

High potential value

Strategic opportunity

Suggested internal ranges may later be defined using real client data.

Do not automatically expose these classifications to prospects.

---

# Accuracy Improvement

As Your AI Department completes real engagements, record:

- Original assessment estimates
- Actual implementation scope
- Actual hours saved
- Actual revenue impact
- Actual cost reductions
- Actual project cost
- Actual payback

Use this data to improve future assumptions and ROI models.

Over time, the assessment should become more accurate based on real implementation results.

---

# Final Rule

The purpose of the ROI calculator is not to create the largest possible number.

The purpose is to create a credible business case.

A smaller, defensible estimate is more valuable than an exaggerated estimate that damages trust.
