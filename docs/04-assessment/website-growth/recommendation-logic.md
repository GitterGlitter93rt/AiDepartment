# Website & Growth Assessment — Recommendation Logic

Status: Architecture Draft Authority

## Objective

Generate useful, evidence-based recommendations that correspond directly to observed or user-reported conditions.

Recommendations must not invent business problems.

## Finding Model

Each finding should contain:

- finding ID
- category
- evidence source
- confidence
- severity
- user-facing statement
- explanation
- recommended action
- related score rule
- related service where appropriate

## Evidence Sources

Allowed:

- observed website evidence
- approved performance data
- user-provided assessment answer
- deterministic combination of the above

Do not base recommendations solely on generative model speculation.

## Confidence Labels

Potential labels:

Verified
User-Reported
Likely
Not Verified

## Severity

Potential working levels:

High Priority
Medium Priority
Lower Priority

Severity should be deterministic.

## Examples

### Tracking

Observed:

Google Analytics script detected.

User reports:

Cannot connect closed customers to marketing source.

Finding:

"Analytics is present, but closed-revenue attribution is not currently reported."

Recommended action:

"Preserve source and campaign information through the CRM/customer journey and connect closed outcomes back to acquisition source."

Relevant destinations:

/ai-growth-systems/
/google-ads/
/meta-ads/

### Lead Follow-Up

User reports:

No automated lead acknowledgment.

No automated follow-up tasks.

Finding:

"New inquiries rely primarily on manual response and follow-up."

Recommended action:

"Create a lead-response workflow with immediate acknowledgment, routing, follow-up tasks, and escalation."

Relevant destinations:

/ai-growth-systems/
/ai-implementation/

### SEO

Observed:

Multiple pages missing unique title tags.

Finding:

"Some analyzed pages do not have unique page titles."

Recommended action:

"Create unique, intent-aligned title tags for important indexable pages."

Relevant destination:

/seo/

### Technical Failure

Performance API unavailable.

Do not generate:

"Your site is slow."

Generate:

"Performance testing could not be completed during this assessment."

Do not penalize the score for unavailable external analysis unless the scoring standard explicitly defines a neutral fallback.

## Priority Opportunity Selection

The results page should identify a small number of highest-priority opportunities.

Potential target:

3–5 priority opportunities.

Priority should consider:

- score impact
- severity
- business relevance
- user answers
- confidence
- implementation dependency

The algorithm must be deterministic.

## Language Rules

Use:

"Detected"
"Could not verify"
"Based on your answers"
"On the pages analyzed"

Avoid:

"Your website definitely..."
when evidence is incomplete.

Avoid financial-loss statements without verified data.

Avoid promises of ROI.

## Service Mapping

Recommendations may connect to relevant services, but the report must remain useful even when no service is promoted.

Do not force every recommendation into a sales CTA.

## Generative AI Use

Generative AI may eventually assist with:

- rewriting deterministic findings into polished language
- summarizing the user's highest-priority findings
- tailoring examples to industry

It must not:

- invent evidence
- change numeric scores
- create unsupported claims
- override scoring rules
- claim access to systems not analyzed

A deterministic fallback should exist if generative output is unavailable.

