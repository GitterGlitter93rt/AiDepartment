# Website & Growth Assessment — Scoring Architecture

Status: Architecture Draft Authority

## Objective

Define a deterministic, explainable Website & Growth Assessment that evaluates a company's website and digital growth system without inventing facts or presenting false precision.

The system should combine:

1. automatically observed website signals
2. user-provided business information
3. deterministic scoring rules
4. evidence-based recommendations

The assessment must clearly distinguish what was observed, what was supplied by the user, and what could not be verified.

## Public Score Categories

Use seven public score categories:

1. Search Visibility
2. Conversion
3. Lead Capture
4. Speed & Performance
5. Tracking & Attribution
6. Follow-Up Systems
7. AI & Automation Readiness

Each category should score from 0–100.

The overall score should also be 0–100.

Exact category weights remain to be finalized during this architecture sprint.

## Scoring Principles

Scoring must be:

- deterministic
- reproducible
- evidence-based
- explainable
- conservative where evidence is incomplete

Do not use arbitrary "AI judgment" to assign numeric scores.

Do not allow free-form model output to directly determine a score.

A model may assist with explanation after deterministic scoring, but the score itself must come from defined rules.

## Evidence Types

Each scoring rule should be assigned an evidence type.

### Observed

Directly detected from the public website or approved technical analysis.

Examples:

- HTTPS present
- title tag present
- meta description present
- visible contact form
- phone number visible
- CTA visible
- sitemap found
- analytics script detected

### User-Provided

Information explicitly answered by the assessment user.

Examples:

- leads enter a CRM
- average response time
- phone calls are tracked
- revenue attribution exists
- lead follow-up is automated

### Unverified

The system cannot confidently determine the condition.

Unverified items should not automatically be treated as failures unless the scoring rule explicitly defines that behavior.

## Confidence

Each finding should have a confidence state:

- Verified
- User-Reported
- Likely
- Not Verified

Avoid presenting "Likely" findings as confirmed facts.

## Category Concept

### 1. Search Visibility

Potential signals:

- HTTPS
- indexability
- robots directives
- sitemap
- title tags
- meta descriptions
- H1 structure
- canonical tags
- structured data
- internal linking
- basic content architecture
- crawl errors
- broken internal links where measurable

Do not attempt to calculate rankings or traffic without external search/analytics data.

### 2. Conversion

Potential signals:

- clear primary CTA
- visible contact options
- contact friction
- booking path
- mobile usability
- landing page clarity
- service clarity
- trust/credibility elements where factual
- conversion path consistency

Avoid subjective design scoring unless the criterion can be defined objectively.

### 3. Lead Capture

Potential signals:

- contact form
- phone number
- email path
- scheduling path
- form usability
- form fields
- lead-source capture indicators
- confirmation state where testable

Do not submit real forms during automated analysis without explicit architecture approval.

### 4. Speed & Performance

Potential signals:

- page-load metrics from approved performance provider
- page weight
- blocking resources
- layout stability
- mobile performance
- major technical failures

Use an approved objective performance source.

Do not invent performance scores from HTML inspection alone.

### 5. Tracking & Attribution

Potential signals:

- analytics tag detected
- tag manager detected
- Google Ads tag detected
- Meta Pixel detected
- call-tracking indicators
- CRM attribution answered by user
- source/campaign preservation answered by user
- revenue attribution answered by user

Important:

Presence of a tracking script does not prove correct configuration.

Finding language should use terms such as:

"Detected"

rather than:

"Configured correctly"

unless actual configuration can be verified.

### 6. Follow-Up Systems

Primarily user-provided because backend workflow is often not publicly observable.

Potential questions:

- Where do web leads go?
- Is a CRM used?
- Is the lead automatically acknowledged?
- Is the lead automatically assigned?
- What is typical first-response time?
- Are follow-up tasks/reminders automated?
- Is there escalation for uncontacted leads?
- Are missed calls handled?
- Are old leads reactivated?

Avoid pretending public crawling can see internal CRM workflows.

### 7. AI & Automation Readiness

Potential signals:

- structured lead capture
- scheduling integration
- chat/messaging system
- machine-readable website structure
- CRM usage from user answer
- automation tools from user answer
- documented lead workflow
- data/attribution readiness
- governance questions where applicable

This category should not simply reward having a chatbot.

## Overall Score

The overall score should be calculated from category scores using explicit approved weights.

Do not implement the overall formula until the final scoring matrix is approved.

## Score Bands

Potential working bands:

0–39:
Significant Opportunity

40–59:
Foundational Improvements Needed

60–74:
Good Foundation

75–89:
Strong Digital Growth System

90–100:
Advanced

These names are provisional and must be reviewed before production use.

Avoid language that implies certification, compliance, or guaranteed performance.

## Missing Evidence

The system must define how missing evidence affects scoring.

Possible rule types:

- neutral / excluded from denominator
- partial credit
- explicit zero only when absence is verifiably a weakness

Do not silently treat "not detected" as "does not exist."

## Recommendation Logic

Each recommendation must map to one or more failed or weak scoring rules.

Recommendations should include:

- finding
- evidence
- why it matters
- recommended action
- relevant Your AI Department service where appropriate

Do not generate recommendations that are unrelated to the evidence.

## Service Mapping

Search Visibility
→ SEO

Paid tracking / attribution
→ Google Ads / Meta Ads / AI Growth Systems

Lead capture / follow-up
→ AI Growth Systems

Automation / CRM integration
→ AI Implementation

Broad strategic issues
→ AI Consulting

Complex organizational issues
→ Enterprise

## Private Commercial Signals

A future private commercial-opportunity layer may be considered separately.

Do not expose private qualification scoring publicly.

Do not implement one during this architecture sprint unless separately approved.

