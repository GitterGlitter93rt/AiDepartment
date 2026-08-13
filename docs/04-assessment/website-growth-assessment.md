# Your AI Department — Website & Growth Assessment

Status: Approved Concept — Architecture Required Before Build

## Purpose

Your AI Department should eventually offer a second free diagnostic:

Website & Growth Assessment

This assessment is separate from the existing AI Department Assessment.

The AI Department Assessment evaluates the overall business.

The Website & Growth Assessment evaluates how effectively the company's website and digital customer-acquisition system support:

- search visibility
- conversion
- lead capture
- tracking
- attribution
- follow-up
- automation
- performance
- AI readiness
- business growth

## Core Position

The assessment should not simply ask:

"Is this a good website?"

It should evaluate:

"Where is this website or digital growth system losing visibility, leads, conversions, attribution, follow-up opportunities, or automation potential?"

The assessment should connect website findings to real business outcomes.

## Proposed Funnel

Website URL
→ Automated Technical Analysis
→ Supplemental Business Questions
→ Website & Growth Score
→ Priority Opportunities
→ Recommended Next Steps
→ Relevant Your AI Department Services
→ Strategy Call

## User Input

Initial input may include:

- website URL
- company name
- contact name
- business email
- optional phone
- industry

The assessment should require as little manual input as practical.

## Automated Analysis

Where technically possible and reliable, the system may inspect objective website signals such as:

### Search / SEO

- page titles
- meta descriptions
- H1 structure
- canonical tags
- robots directives
- XML sitemap availability
- indexability signals
- internal linking
- structured data
- content architecture
- basic crawlability

### Conversion

- visible CTAs
- contact pathways
- form availability
- phone accessibility
- booking pathways
- landing-page structure
- friction in primary conversion paths
- mobile conversion experience

### Technical / Performance

- HTTPS
- mobile responsiveness
- page performance signals
- asset loading
- broken links where detectable
- major technical errors
- basic accessibility signals where reliably measurable

### Tracking & Attribution

Where detectable:

- analytics tags
- advertising measurement tags
- tag-manager presence
- conversion tracking indicators
- call-tracking indicators

The system must not claim tracking is correctly configured merely because a script is present.

### AI / Automation Readiness

Potential observable signals may include:

- structured lead capture
- scheduling capabilities
- chat or messaging systems
- CRM-connected form indicators where detectable
- automation entry points
- machine-readable site structure

Do not infer hidden backend integrations without evidence.

## Supplemental Questions

Some important business facts cannot be determined by crawling the website.

The assessment may ask a small number of questions such as:

- Where do website leads currently go?
- Do leads automatically enter a CRM?
- How quickly are new inquiries normally contacted?
- Can you identify which marketing source produced a customer?
- Are phone calls tracked back to marketing sources?
- Do you use Google Ads?
- Do you use Meta Ads?
- Is website-generated revenue tracked back to acquisition source?
- Are leads automatically acknowledged or routed?
- Are old leads or customers systematically reactivated?

Avoid turning this into another long 64-question assessment.

Target a short supplemental questionnaire.

## Proposed Public Score Categories

Potential categories:

1. Search Visibility
2. Conversion
3. Lead Capture
4. Speed & Performance
5. Tracking & Attribution
6. Follow-Up Systems
7. AI & Automation Readiness

Exact score definitions and weights are NOT yet approved.

Do not implement scoring until deterministic scoring specifications are written and reviewed.

## Example Result

Illustrative concept only:

Website & Growth Score: 64 / 100

Search Visibility — 58
Conversion — 71
Lead Capture — 63
Speed & Performance — 76
Tracking & Attribution — 41
Follow-Up Systems — 52
AI & Automation Readiness — 68

Example scores are illustrative only and must never appear as an actual customer result unless generated from the approved scoring model.

## Recommendations

Recommendations must be evidence-based.

Potential finding:

"Conversion tracking could not be verified."

Acceptable.

Potential finding:

"Your website is losing $42,000 per month because tracking is broken."

Not acceptable without factual evidence.

Recommendations should clearly distinguish:

- observed technical facts
- user-provided information
- reasonable diagnostic conclusions
- items requiring manual verification

## Service Mapping

Assessment findings may map naturally to existing commercial pages.

Search visibility
→ /seo/

Paid acquisition
→ /google-ads/
→ /meta-ads/

Conversion / lead routing / attribution
→ /ai-growth-systems/

Automation / CRM / integration
→ /ai-implementation/

Broader strategic problem
→ /ai-consulting/

Complex organization
→ /enterprise/

## Commercial Purpose

The assessment should provide legitimate standalone value while also functioning as a qualified lead-generation system.

Primary conversion path:

Free Assessment
→ Useful Score / Findings
→ Priority Opportunities
→ Strategy Call
→ Relevant Engagement

Do not intentionally hide all useful information behind a sales call.

## Security Requirements

Any future automated website scanner must be designed with security controls.

Before implementation, define protections against:

- SSRF
- requests to localhost
- requests to private/internal IP ranges
- cloud metadata endpoints
- non-HTTP protocols
- redirect abuse
- excessive crawling
- extremely large responses
- malicious HTML
- script execution
- file downloads
- denial-of-service behavior

The scanner should treat external websites as untrusted input.

Do not build a production URL crawler until these controls are explicitly designed.

## Technical Architecture

The current Astro site is primarily statically generated.

A real automated website assessment will likely require a server-side or external analysis layer rather than relying entirely on browser-side JavaScript.

Possible architecture:

Astro Website
→ Assessment Form
→ Secure Analysis API / Worker
→ Controlled Website Fetching
→ Deterministic Analysis
→ Scoring Engine
→ Results

Exact provider and implementation remain TBD.

Do not expose API keys or infrastructure secrets client-side.

## SEO Opportunity

Potential canonical route:

/website-assessment/

Potential working H1:

Free Website & Growth Assessment

Potential supporting language:

Find out where your website may be losing visibility, leads, conversions, attribution, and follow-up opportunities.

Final route, SEO title, meta description, H1, and keyword/search-intent strategy must follow:

docs/05-seo/page-seo-standard.md

before implementation.

## Relationship to AI Department Assessment

Keep the assessments distinct.

### AI Department Assessment

Evaluates:

- strategy
- marketing
- sales
- operations
- employees
- technology
- automation

Primary question:

Where can AI and better business systems create value across the company?

### Website & Growth Assessment

Evaluates:

- website
- search visibility
- conversion
- tracking
- lead capture
- attribution
- lead response
- automation readiness

Primary question:

Where is the company's website and digital growth system losing opportunities?

The two assessments may cross-link where appropriate.

## Build Status

Concept:

Approved.

Scoring model:

Not yet defined.

Crawler architecture:

Not yet defined.

Security architecture:

Not yet defined.

Backend provider:

Not yet selected.

Results logic:

Not yet defined.

Production implementation:

DO NOT BUILD YET.

The next assessment sprint should first create the deterministic scoring, technical architecture, security specification, and result recommendation logic before frontend implementation.

