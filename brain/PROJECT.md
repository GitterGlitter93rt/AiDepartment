# Your AI Department — Current Project Snapshot

**Status date:** 2026-08-30

## Company

- **Brand:** Your AI Department
- **Primary domain:** YourAIDepartment.ai
- **Campaign domain:** HireAnAIDepartment.com
- **Owner/founder:** Michael Chanata
- **Core positioning:** An external AI strategy, implementation, growth, training, and optimization capability for businesses that do not need or do not yet have a full internal AI department.
- **Business principle:** Start with the business problem, diagnose before prescribing, and sell measurable business improvement rather than AI hype.

## Current stage

The repository has moved beyond company-foundation-only work. It contains a substantial custom Astro website, a deterministic assessment engine, core pages, industry pages, and launch resources. Current launch work is measurement, funnel/assessment reconciliation, backend/lead operations, booking, deployment truth, and campaign readiness.

The early WordPress/GeneratePress concept is superseded for V1. The locked repository direction and current implementation use a custom-coded Astro site intended for SiteGround.

## Canonical V1 offers

| Offer | Current commercial position |
|---|---|
| AI Department Assessment | Free public diagnostic and lead-generation entry point; now being split operationally into short and long experiences |
| Executive AI Strategy | Deeper paid diagnostic/planning engagement; indicative starting point approximately $5,000+ |
| AI Implementation | Working systems and integrations; indicative range approximately $5,000–$50,000+ depending on scope |
| AI Growth Systems | Connected marketing, CRM, response, automation, conversion tracking, and attribution; custom setup/management |
| Managed AI Department | Ongoing strategy, implementation oversight, training, governance, and optimization; custom monthly retainer |
| AI Training | Custom team/company training |
| AI Workshops | Paid; V1 scope and pricing remain TBD |
| Executive AI Coaching | Session, package, or retainer pricing based on scope |
| Executive AI Advisory Session | Approved paid appointment: $750 for 60 minutes plus pre-session intake and an Executive Action Brief |

All pricing is governed by docs/00-company/launch-decisions.md. Do not publish indicative internal ranges as fixed promises unless intentionally approved for the specific page or campaign.

## Target buyers and verticals

Primary buyers are owners, CEOs, executives, and other leaders who can influence or approve business transformation work. The broad market is growing small and mid-sized businesses, with enterprise handled through a separate conversation.

Current website vertical coverage includes collision repair, law firms, roofing, HVAC, construction, professional services, healthcare, insurance, and manufacturing. Paid-campaign priorities are not yet locked; body/collision repair, law firms, roofing, plumbing/HVAC, and other owner-operated service businesses have been discussed as candidates.

## Funnel

The locked V1 documents currently describe:

Traffic → AI Department Assessment → score/recommendations → strategy call → Executive AI Strategy → implementation → Managed AI Department

On 2026-08-30, the operating direction changed to include both a short assessment and a long assessment. The concept is approved, but the exact routes, handoff, result depth, lead gate, and CTA hierarchy must be reconciled before the old single-assessment funnel is treated as current.

Enterprise visitors should not be forced through the public SMB assessment funnel.

## Technical snapshot

- Astro ^7.2.0
- TypeScript
- Node >=22.12.0
- Static output with trailing-slash URLs
- Canonical site configured as https://youraidepartment.ai
- MDX content collections
- Vanilla TypeScript assessment application
- Deterministic assessment scoring and recommendation logic
- Approved production host: SiteGround VPS/cloud environment

See brain/WEBSITE.md for implementation details and brain/AI-ASSESSMENTS.md for the assessment split.

## Non-negotiables

- Do not invent clients, testimonials, case studies, ROI, results, credentials, partnerships, statistics, or team members.
- Do not expose secrets or private assessment/lead data in client code, analytics, Git, or the brain.
- Keep marketing claims grounded and funnel promises aligned with what the product actually delivers.
- Prefer business value, speed, SEO, conversion, mobile usability, accessibility, maintainability, and portability.
- Use approved source documents rather than rewriting strategy during implementation.
