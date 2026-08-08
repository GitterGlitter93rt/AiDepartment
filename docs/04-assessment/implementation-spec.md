# AI Department Assessment - Implementation Specification

Status: CANONICAL V1 IMPLEMENTATION SPEC
Version: 1.0

---

# PURPOSE

This file converts the assessment strategy into deterministic implementation rules.

Claude/developers must NOT invent:

- Question scoring
- Branching
- Commercial scoring
- Opportunity flags
- Category weights
- Recommendation triggers

If another assessment document conflicts with this file on implementation behavior, this file controls for V1.

Supporting source files:

- questions.md
- scoring.md
- recommendations.md
- roi-calculator.md
- report-template.md
- consent-and-data.md

---

# CORE DESIGN

The assessment contains:

64 total defined questions.

Q1-Q42:

Core assessment.

Q43-Q64:

Conditional deeper discovery.

Not every prospect receives all 64 questions.

Expected typical completion:

Approximately 7-12 minutes.

Complex companies receiving multiple conditional sections may require longer.

Do not promise every user will finish in exactly 7 minutes.

---

# PUBLIC OUTPUTS

The prospect may see:

- Overall AI Department Score
- AI maturity stage
- Seven category scores
- Strongest areas
- Highest-priority opportunities
- Recommendations
- ROI scenarios where sufficient information exists

---

# PRIVATE OUTPUTS

The prospect must NOT see:

- Commercial Opportunity Score
- Lead priority
- Internal sales classification
- Budget score
- Authority score
- Internal opportunity-value classification
- Sales routing logic

---

# PUBLIC SCORE CATEGORIES

Leadership and AI Strategy

Weight:

15%

---

Marketing and Growth

Weight:

15%

---

Sales and Follow-Up

Weight:

15%

---

Customer Experience

Weight:

10%

---

Operations and Automation

Weight:

20%

---

Employee AI Readiness

Weight:

10%

---

Technology and Data

Weight:

15%

---

# PUBLIC SCORING RULE

Each scored question returns:

0
1
2
3
or
4

Category Score:

points earned
/
maximum possible points for answered scored questions
x
100

Conditional questions that are not displayed:

Do NOT count against the category.

Questions intentionally marked unscored:

Do NOT affect the public score.

Overall Score:

Sum of each category score multiplied by its category weight.

Round final public score to nearest whole number.

---

# PUBLIC SCORE STAGES

0-24

AI Foundation Stage

---

25-49

AI Opportunity Stage

---

50-69

AI Adoption Stage

---

70-84

AI Scaling Stage

---

85-100

AI Leadership Stage

---

# ANSWER INDEX CONVENTION

Arrays below correspond to answer options in the exact order defined in questions.md.

Example:

public_scores: [0,1,2,3,4]

means:

first option = 0
second = 1
third = 2
fourth = 3
fifth = 4

Do not reorder options without updating this specification.

---

# SECTION 1 - COMPANY PROFILE

## Q1 - Industry

Public Score:

UNSCORED

Purpose:

- Industry personalization
- Industry recommendation mapping
- Sales segmentation

Store normalized industry slug.

---

## Q2 - Annual Revenue

Public Score:

UNSCORED

Commercial Financial Capacity Score:

Under $500,000 = 1

$500,000-$1 million = 3

$1-$3 million = 6

$3-$10 million = 10

$10-$25 million = 14

$25-$50 million = 17

$50-$100 million = 20

$100 million+ = 20

Maximum financial-capacity score:

20

---

## Q3 - Employee Count

Public Score:

UNSCORED

Use for:

- Branching
- Company complexity
- Employee training opportunity
- Enterprise identification
- Labor opportunity context

Normalized bands:

1-5
6-10
11-25
26-50
51-100
101-250
251-500
500+

---

## Q4 - Locations

Public Score:

UNSCORED

Use for:

- Multi-location flag
- Standardization recommendations
- Reporting recommendations
- Enterprise complexity

MULTI_LOCATION trigger:

Answer is 2-3 or greater.

---

## Q5 - Business Priorities

Public Score:

UNSCORED

Maximum selections:

3

Use selections to personalize:

- Report ordering
- Recommendations
- Strategy-call notes

Priority selections do not independently create service recommendations.

They strengthen recommendations supported by diagnostic evidence.

---

# SECTION 2 - LEADERSHIP AND AI STRATEGY

Category:

Leadership and AI Strategy

## Q6

public_scores:

[0,1,2,3,4]

---

## Q7

public_scores:

[0,1,2,3,4]

Signals:

Options 1-3 strengthen EXECUTIVE_STRATEGY.

---

## Q8

public_scores:

[0,0,1,3,4]

Signals:

Options 1-3 indicate unclear or informal AI ownership.

---

## Q9

public_scores:

[0,1,2,3,4]

Also contributes to internal urgency score.

---

# SECTION 3 - MARKETING AND LEAD GENERATION

Category:

Marketing and Growth

## Q10

Public Score:

UNSCORED

Create channel flags for each selected channel.

Special values:

Google Ads -> USES_GOOGLE_ADS

Meta / Facebook Ads -> USES_META_ADS

SEO -> USES_SEO

We do not have a consistent lead source -> NO_CONSISTENT_LEAD_SOURCE

---

## Q11 - Monthly Paid Ad Spend

Public Score:

UNSCORED

Commercial Advertising Score:

$0 = 0

Under $2,500 = 2

$2,500-$5,000 = 4

$5,000-$10,000 = 7

$10,000-$25,000 = 10

$25,000-$50,000 = 12

$50,000-$100,000 = 15

$100,000+ = 15

Maximum:

15

---

## Q12

public_scores:

[0,1,2,3,4]

---

## Q13

public_scores:

[0,1,2,3,4]

---

## Q14

public_scores:

[0,1,2,3,4]

---

# SECTION 4 - SALES AND FOLLOW-UP

Category:

Sales and Follow-Up

## Q15

public_scores:

[0,1,2,3,4]

Commercial sales weakness points:

No = 2

Yes, but adoption is poor = 2

Yes, partially = 1

Yes, consistently = 0

Yes, with advanced automation = 0

---

## Q16

public_scores:

[4,3,3,2,1,0,0]

Commercial sales weakness points:

Under 5 minutes = 0

5-15 minutes = 0

15-30 minutes = 1

30-60 minutes = 2

Several hours = 3

Next business day or later = 4

We do not know = 2

---

## Q17

public_scores:

[0,1,2,3,4]

Commercial sales weakness points:

Usually nothing = 4

Salesperson may try again manually = 3

Standard manual follow-up = 2

Basic automated follow-up = 1

Sophisticated automated nurturing = 0

---

## Q18 - Monthly Lead Volume

Public Score:

UNSCORED

Commercial sales-volume points:

Under 25 = 0

25-100 = 1

101-250 = 2

251-500 = 3

501-1,000 = 3

1,000+ = 3

We do not know = 0

---

## Q19

public_scores:

[0,1,2,3,4]

Commercial sales weakness points:

No = 2

We estimate it = 2

Track occasionally = 1

Yes, consistently = 0

Yes, by source and salesperson = 0

---

# COMMERCIAL SALES SCORE

Commercial Sales Opportunity Score:

Q15 weakness
+
Q16 weakness
+
Q17 weakness
+
Q18 volume
+
Q19 weakness

Maximum:

15

Do not exceed 15.

---

# SECTION 5 - CUSTOMER SERVICE

Category:

Customer Experience

## Q20

public_scores:

[4,3,2,1,0,1]

Opportunity severity:

Almost none = 0

Under 5% = 0

5-10% = 1

10-25% = 2

More than 25% = 3

We do not know = 1

---

## Q21

public_scores:

[0,2,3,3,4,1]

Notes:

Voicemail is lowest maturity.

AI voice agent is not automatically considered successful implementation.

Score reflects capability only.

---

## Q22

public_scores:

[4,3,2,1,0,1]

---

## Q23

public_scores:

[0,1,3,4]

---

# SECTION 6 - OPERATIONS AND AUTOMATION

Category:

Operations and Automation

## Q24

public_scores:

[4,3,2,1,0]

Commercial labor points:

Very little = 0

Some = 1

Moderate amount = 2

Significant amount = 4

Extremely high = 5

---

## Q25

Public Score:

UNSCORED

Count selected manual-work categories excluding:

None of these

Create MANUAL_WORK_COUNT.

Three or more selected:

strengthens EMPLOYEE_PRODUCTIVITY.

Five or more:

strong employee-productivity signal.

---

## Q26

public_scores:

[0,1,2,3,4]

---

## Q27

public_scores:

[4,3,2,1,0]

Commercial labor points:

Rarely = 0

Occasionally = 1

Weekly = 2

Daily = 3

Constantly = 4

---

## Q28

public_scores:

[4,3,2,1,0]

Commercial labor points:

No = 0

Probably not = 1

Unsure = 2

Probably = 3

Definitely = 4

---

# SECTION 7 - EMPLOYEES AND TRAINING

Category:

Employee AI Readiness

## Q29

public_scores:

[0,1,2,3,4,4,1]

---

## Q30

Public Score:

UNSCORED

Use for:

- Tool inventory
- Training personalization
- Governance considerations

If None:

AI_ADOPTION_LOW signal.

If We do not know:

AI_VISIBILITY_LOW signal.

---

## Q31

public_scores:

[0,1,2,3,4]

---

## Q32

public_scores:

[0,2,3,4,4]

---

## Q33

Public Score:

UNSCORED

Use as risk/urgency signal.

Moderately concerned or greater:

AI_GOVERNANCE_CONCERN.

Very concerned or extremely concerned combined with weak Q32:

high-priority training/governance signal.

---

# SECTION 8 - TECHNOLOGY AND DATA

Category:

Technology and Data

## Q34

public_scores:

[0,1,2,3,4]

---

## Q35

public_scores:

[0,1,2,3,4]

---

## Q36

public_scores:

[0,1,2,3,4]

---

## Q37

public_scores:

[0,1,2,3,4]

---

# SECTION 9 - GROWTH AND BUYING INTENT

Public Score:

All questions in this section are UNSCORED publicly.

They are commercial qualification questions.

---

## Q38 - Timing

Commercial urgency points:

Research only = 0

6-12 months = 1

3-6 months = 2

1-3 months = 3

Within 30 days = 4

Immediately = 5

---

## Q39 - Investment Willingness

Commercial Budget Score:

Under $2,500 = 1

$2,500-$5,000 = 2

$5,000-$10,000 = 4

$10,000-$25,000 = 6

$25,000-$50,000 = 8

$50,000-$100,000 = 9

$100,000+ = 10

Depends entirely on ROI = 7

Maximum:

10

PRIVATE FIELD.

---

## Q40 - Role

Commercial Authority Score:

Owner / Founder = 10

CEO / President = 10

Executive = 8

Partner = 8

Department Leader = 6

Marketing Leader = 5

Operations Leader = 5

IT / Technology = 5

Employee = 2

Consultant / Advisor = 2

Other = 2

Maximum:

10

PRIVATE FIELD.

---

## Q41

Public Score:

UNSCORED

Free text.

Store for:

- Result personalization
- Strategy-call notes
- AI narrative generation later

Never allow Q41 text to directly alter deterministic scores.

---

## Q42

Public Score:

UNSCORED

Free text.

Store as:

primary_bottleneck_text

Never allow text alone to create a financial ROI claim.

---

# INTERNAL AI URGENCY SCORE

Maximum:

10

Q9 AI importance contributes:

Not currently important = 0

Somewhat important = 1

Important = 2

Very important = 4

Mission critical = 5

Q38 contributes:

0-5 as defined above.

Total maximum:

10.

---

# SECTION 10 - DETAILED SALES PROCESS

Conditional.

Category:

Sales and Follow-Up for public maturity questions only.

---

# SECTION 10 DISPLAY CONDITION

Display if ANY are true:

1. Q18 is 25-100 or greater

2. Q3 is 11-25 employees or greater

3. Q10 includes Cold outbound

4. Q10 includes Google Ads AND Q11 is greater than $0

5. Q10 includes Meta / Facebook Ads AND Q11 is greater than $0

Otherwise skip Section 10.

---

## Q43

Public Score:

UNSCORED

Use for opportunity sizing.

---

## Q44

public_scores:

[1,1,1,3,4,4,0]

Signals:

Manual / inconsistent options strengthen SALES_AUTOMATION.

AI-assisted routing does not itself guarantee quality.

---

## Q45

public_scores:

[0,1,2,3,4]

---

## Q46

Public Score:

UNSCORED

Use for:

SALES_ADMIN_BURDEN

Threshold:

10-20 hours or greater = strong signal.

---

## Q47

Public Score:

UNSCORED

Count manual sales tasks.

Five or more:

strong SALES_AUTOMATION signal.

---

## Q48

public_scores:

[0,1,2,3,4]

Options 1-3 strengthen LEAD_REACTIVATION.

---

# SECTION 11 - FINANCE AND ACCOUNTING

Conditional discovery.

Public Score:

UNSCORED.

Finance findings affect recommendations, not the seven-category maturity formula.

---

# SECTION 11 DISPLAY

Show Q49 to all businesses with:

Q3 = 6-10 employees or greater

OR

Q25 includes:

- Data entry
- Creating reports
- Document preparation
- Internal reporting
- Reviewing documents

If Q3 = 1-5 AND none of those activities selected:

Skip Section 11.

---

## Q49

Gateway question.

If answer is:

External bookkeeper

OR

External accounting firm

still allow Q51-Q54 because internal finance workflows may still exist.

Q50 may return 0.

---

## Q50

Use for finance labor sizing.

Normalized internal finance staff:

0
1
2-3
4-10
11+
unknown

---

## Q51

Create FINANCE_MANUAL_TASK_COUNT.

Exclude:

None
We do not know

Three or more selected:

strong FINANCE_AUTOMATION signal.

---

## Q52

Slow reporting trigger:

1-2 weeks
More than 2 weeks
Reporting is inconsistent

strengthens:

FINANCE_AUTOMATION
EXECUTIVE_REPORTING

---

## Q53

Manual collections trigger:

2-5 hours or greater

strengthens:

FINANCE_AUTOMATION
AR_AUTOMATION

---

## Q54

Options:

No
Mostly spreadsheets

strengthen:

EXECUTIVE_REPORTING
DATA_INTEGRATION

---

# SECTION 12 - ADMINISTRATIVE WORK AND CAPACITY

Conditional.

Public Score:

UNSCORED.

Used primarily for commercial opportunity and ROI.

---

# SECTION 12 DISPLAY CONDITION

Display if ANY are true:

Q24 = Moderate amount or greater

Q28 = Unsure / Probably / Definitely

Q25 has 3 or more manual work selections

Q3 = 11-25 employees or greater

Otherwise skip.

---

## Q55

Create overloaded department flags.

Do not score publicly.

---

## Q56

Commercial labor points:

No = 0

Occasionally = 1

Some departments = 2

Frequently = 3

Across multiple departments = 4

---

## Q57

Use for ROI framing only.

Do not interpret:

Reduce headcount where appropriate

as an instruction or guarantee.

---

## Q58

Commercial labor points:

No = 0

Possibly within 12 months = 1

Yes, within 6-12 months = 2

Yes, within 3-6 months = 3

Yes, currently hiring = 3

---

## Q59

Use for ROI opportunity sizing.

Do NOT directly add to Commercial Opportunity Score V1.

Store normalized labor-spend band.

---

# COMMERCIAL LABOR AUTOMATION SCORE

Maximum:

20

Calculate:

Q24 labor points
+
Q27 labor points
+
Q28 labor points
+
Q56 labor points if asked
+
Q58 labor points if asked

If Q56/Q58 skipped:

missing values = 0

Maximum possible:

20

Cap at:

20

---

# SECTION 13 - AI AGENT OPPORTUNITIES

Conditional discovery.

Public Score:

UNSCORED.

---

# SECTION 13 DISPLAY CONDITION

Always show:

Q60
Q61

Show Q62-Q64 if ANY are true:

Q3 = 6-10 employees or greater

Q24 = Moderate or greater

Q25 includes Searching for information

Q25 includes Customer support

Q25 includes Customer follow-up

Q25 includes Scheduling

Q25 includes Writing emails

---

## Q60

Use for current-agent maturity and implementation readiness.

No / experimenting:

stronger new-agent opportunity.

Several workflows / throughout business:

stronger optimization/governance opportunity.

---

## Q61

User-interest signal only.

A selected capability does NOT automatically produce a recommendation.

There must also be supporting diagnostic evidence.

Example:

User selects AI phone receptionist.

Recommend AI phone agent only if phone/customer-service evidence supports it.

---

## Q62

Knowledge burden trigger:

10-25 hours per week or greater.

Moderate signal:

5-10 hours.

---

## Q63

Knowledge-search trigger:

20-50 hours per week or greater.

Moderate signal:

5-20 hours.

---

## Q64

Create communication-automation interest flags.

Selections strengthen recommendations only when corresponding diagnostic evidence exists.

---

# COMMERCIAL OPPORTUNITY SCORE

Maximum:

100

Formula:

Financial Capacity
+
Advertising Opportunity
+
Labor Automation Opportunity
+
Sales Opportunity
+
AI Urgency
+
Buying Authority
+
Budget Willingness

Maximum components:

Financial = 20

Advertising = 15

Labor = 20

Sales = 15

Urgency = 10

Authority = 10

Budget = 10

Total:

100

---

# COMMERCIAL CLASSIFICATION

0-39:

Low Priority

---

40-59:

Nurture

---

60-79:

Qualified Opportunity

---

80-100:

High Priority Executive Lead

PRIVATE ONLY.

---

# ENTERPRISE QUALIFICATION FLAG

Create ENTERPRISE_CANDIDATE if ANY are true:

Q2 = $100 million+

Q3 = 500+

OR both:

Q2 = $50-$100 million

AND

Q3 = 251-500

Enterprise CTA should then be considered for results/follow-up.

Do NOT automatically route every enterprise candidate to a free-assessment sales script.

Internal recommended motion:

Enterprise Conversation

---

# OPPORTUNITY FLAG ENGINE

Flags are deterministic.

---

# MARKETING_HIGH_VALUE

Trigger if:

Q11 is $10,000-$25,000 or greater

AND ANY:

Q12 = cannot track / limited visibility / somewhat confident

Q13 = neutral / dissatisfied / very dissatisfied

Q14 = no / occasionally / no structured testing

---

# GOOGLE_ADS_OPPORTUNITY

Trigger if:

Q10 contains Google Ads

AND Q11 > $0

AND ANY:

Q12 score <= 2

Q13 score <= 2

Q14 score <= 2

Q16 public score <= 2

---

# META_ADS_OPPORTUNITY

Trigger if:

Q10 contains Meta / Facebook Ads

AND Q11 > $0

AND ANY:

Q12 score <= 2

Q13 score <= 2

Q14 score <= 2

Q16 public score <= 2

---

# SEO_OPPORTUNITY

Trigger if:

Q10 contains SEO

AND Q13 score <= 2

OR

Q10 contains We do not have a consistent lead source

AND Q5 includes Generate more leads.

---

# SALES_AUTOMATION

Trigger if ANY:

Q15 = No / adoption poor

Q16 = 30-60 minutes or slower

Q17 = usually nothing / salesperson may try / standard manual

Q44 = manual / whoever answers / spreadsheet / inconsistent

Q47 contains 5 or more manual sales tasks

---

# SLOW_LEAD_RESPONSE

Trigger if:

Q16 = 30-60 minutes or slower

OR

Q16 = We do not know AND Q18 >= 101-250.

---

# LEAD_REACTIVATION

Trigger if:

Q48 = No / Occasionally / Manually

AND

Q18 >= 25-100

---

# AI_PHONE_AGENT

Trigger if ANY:

Q20 = 10-25% or more unanswered

Q21 = Voicemail

AND one of:

Q18 >= 25-100

Q5 includes Generate more leads

Q5 includes Improve customer service

Q64 includes New lead responses

---

# CUSTOMER_SERVICE_AUTOMATION

Trigger if ANY:

Q22 = Same business day / next business day / varies widely

Q23 = No / Partially

Q64 includes:

- Customer status updates
- Frequently asked questions
- Appointment reminders

---

# EMPLOYEE_PRODUCTIVITY

Trigger if ANY:

Q24 = Significant / Extremely high

MANUAL_WORK_COUNT >= 5

Q62 = 10-25 hours or greater

Q63 = 20-50 hours or greater

Q56 = Frequently / across multiple departments

---

# AI_TRAINING

Trigger if ANY:

Q31 = No / informal tips / few employees

Q29 = 25% or less

AND Q9 = Important or greater

---

# AI_GOVERNANCE

Trigger if:

Q32 = No / developing

AND

Q33 = Moderately concerned or greater

---

# INTEGRATION_OPPORTUNITY

Trigger if ANY:

Q34 = Completely disconnected / Mostly disconnected

Q27 = Daily / Constantly

---

# EXECUTIVE_REPORTING

Trigger if ANY:

Q35 = No / mostly manual

Q52 = 1-2 weeks or slower

Q54 = No / mostly spreadsheets

---

# FINANCE_AUTOMATION

Trigger if ANY:

FINANCE_MANUAL_TASK_COUNT >= 3

Q53 = 2-5 hours or greater

Q52 = 1-2 weeks or slower

---

# AR_AUTOMATION

Trigger if:

Q53 = 2-5 hours or greater

OR

Q51 contains Accounts receivable follow-up

---

# KNOWLEDGE_ASSISTANT

Trigger if ANY:

Q62 = 10-25 hours or greater

Q63 = 20-50 hours or greater

Q25 contains Searching for information

AND Q63 >= 5-20 hours

---

# AI_AGENT_OPPORTUNITY

Trigger if:

Q61 has at least one selected capability

AND at least one supporting opportunity flag exists.

Do not create AI_AGENT_OPPORTUNITY based solely on interest.

---

# EXECUTIVE_STRATEGY

Trigger if ALL:

Q7 is:
No
Discussed informally
Developing

AND

Q9 = Important or greater

AND ANY:

Q2 = $1-$3 million or greater

Commercial Opportunity Score >= 60

Three or more opportunity flags active

---

# MANAGED_AI_DEPARTMENT

Trigger if ALL:

Three or more meaningful opportunity flags active

AND

Financial Capacity Score >= 10

AND

AI Urgency Score >= 5

AND ANY:

Q3 = 26-50 employees or greater

Q4 = 4-10 locations or greater

Commercial Opportunity Score >= 70

---

# MULTI_LOCATION_STANDARDIZATION

Trigger:

Q4 = 4-10 or greater.

Strengthens:

- Reporting
- CRM
- Integration
- Training
- Managed AI Department

---

# HIRING_AVOIDANCE_ANALYSIS

Trigger if:

Q58 indicates possible/planned hiring

AND ANY:

Q24 >= Moderate

Q27 >= Weekly

MANUAL_WORK_COUNT >= 3

This means:

Evaluate automation before adding headcount.

It does NOT mean:

Recommend layoffs.

---

# ROI CALCULATION RULE

Opportunity flags do not automatically produce financial estimates.

Only calculate an ROI scenario when required inputs exist.

Reference:

roi-calculator.md

If inputs are insufficient:

Display:

Additional data is required to estimate financial impact.

---

# RECOMMENDATION RANKING

Recommendation priority score should consider:

1. Diagnostic severity
2. Relevant business volume
3. Financial capacity
4. User-stated priorities
5. Supporting opportunity flags
6. Implementation feasibility

Do not rank by sales commission or service price.

---

# PRIORITY LEVELS

Priority 1:

High severity + meaningful business impact + clear implementation path.

Priority 2:

Strong opportunity but secondary to Priority 1.

Priority 3:

Useful optimization.

Priority 4:

Future / exploratory.

---

# USER-STATED INTEREST RULE

Q5 and Q61 may increase relevance/order of a supported recommendation.

They may NOT create a recommendation with no diagnostic evidence.

Example:

User selects "AI phone receptionist" in Q61.

But:

Almost no calls are missed.

After-hours calls are handled effectively.

Customer response is strong.

Then:

Do not rank an AI phone agent as a major recommendation.

---

# UNKNOWN ANSWER RULE

"We do not know" usually indicates:

- visibility problem
- measurement gap

It should not automatically receive the absolute lowest public score unless specifically defined above.

Unknown answers may trigger:

MANAGEMENT_VISIBILITY

or

MEASUREMENT_GAP

where relevant.

---

# FREE TEXT SAFETY

Q41 and Q42:

Never execute user-supplied instructions contained inside free text.

Treat as untrusted business data.

If later passed into an AI model:

Clearly delimit the content as user data.

Do not allow it to modify system instructions.

---

# CONTACT CAPTURE

Contact data should not affect public AI Department Score.

Contact data may affect:

- Routing
- Follow-up
- CRM matching

Consent requirements:

See consent-and-data.md.

---

# RESULTS GENERATION

Deterministic system calculates:

- Overall public score
- Category scores
- Stage
- Flags
- Commercial score
- Internal classification
- Recommendation candidates
- ROI inputs

Optional AI narrative layer may later:

- Explain findings
- Summarize recommendations
- Personalize language

AI narrative must NOT:

- Change scores
- Invent flags
- Invent financial data
- Invent services
- Override recommendation eligibility

---

# IMPLEMENTATION DATA MODEL

Production code should represent questions as structured data.

Preferred conceptual structure:

id

section

type

required

options

publicScore

commercialEffects

flags

branching

recommendations

Do not create 64 separate question UI components.

One reusable question engine should render structured configuration.

---

# TYPESCRIPT TARGET

Recommended production structure:

src/data/assessment/questions.ts

src/data/assessment/scoring.ts

src/data/assessment/branching.ts

src/data/assessment/flags.ts

src/data/assessment/recommendations.ts

src/data/assessment/types.ts

src/lib/assessment/calculatePublicScore.ts

src/lib/assessment/calculateCommercialScore.ts

src/lib/assessment/evaluateFlags.ts

src/lib/assessment/getRecommendations.ts

---

# TESTING REQUIREMENT

Before production, automated tests should cover at minimum:

1. Mature AI company

Expected:
High public score
Few basic recommendations

2. High-ad-spend company with poor tracking

Expected:
MARKETING_HIGH_VALUE
Relevant ad/tracking recommendations

3. High lead volume with slow response

Expected:
SALES_AUTOMATION
SLOW_LEAD_RESPONSE

4. High missed-call company

Expected:
AI_PHONE_AGENT

5. High administrative workload

Expected:
EMPLOYEE_PRODUCTIVITY

6. Disconnected software

Expected:
INTEGRATION_OPPORTUNITY

7. Low AI adoption + no training

Expected:
AI_TRAINING

8. Manual finance workload

Expected:
FINANCE_AUTOMATION

9. Multiple opportunities + financial capacity + urgency

Expected:
MANAGED_AI_DEPARTMENT candidate

10. Very large company

Expected:
ENTERPRISE_CANDIDATE

11. User requests an AI agent but diagnostic evidence is weak

Expected:
Do NOT promote unsupported agent recommendation.

12. Insufficient ROI data

Expected:
No fabricated financial estimate.

---

# VERSIONING

Assessment logic should be versioned.

V1 identifier:

assessment_v1

Every stored assessment result should retain:

assessmentVersion

This allows future scoring changes without corrupting historical interpretation.

---

# CALIBRATION

V1 scoring is a business-rule model.

After real assessment and client data exists, review:

- Score distributions
- Recommendation accuracy
- Lead quality
- False positives
- False negatives
- Actual implementation outcomes
- Actual ROI

Then create:

assessment_v1.1

or

assessment_v2

Do not silently change historical scoring rules.

---

# FINAL RULE

Claude should IMPLEMENT these rules.

Claude should NOT reinterpret, optimize, simplify, or redesign them without explicit approval.

