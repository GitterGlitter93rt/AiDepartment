# Your AI Department — Scheduling and Booking

Status: Approved V1

This document defines the V1 scheduling and booking architecture for Your AI Department.

---

## Provider

Scheduling provider:

Calendly

Payment provider for paid booking:

Stripe

Calendly URLs and event IDs must be centralized in site configuration.

Do not hardcode scheduling URLs across individual components or pages.

---

## Booking Architecture

Your AI Department will support multiple booking paths because different buyers may enter the company at different stages.

The primary V1 booking paths are:

1. AI Strategy Call
2. Executive AI Advisory Session
3. Enterprise Engagement Discussion
4. AI Training Consultation
5. AI Workshop

---

## 1. AI Strategy Call

Price:

Free

Duration:

30 minutes

Purpose:

A complimentary discovery and qualification conversation for companies that want to discuss their AI Department Assessment, business priorities, or potential engagement.

This call is designed to determine:

- what the company wants to improve
- where meaningful AI or automation opportunities may exist
- whether there is a fit with Your AI Department
- which engagement, if any, is the appropriate next step

This call is not intended to provide a full consulting engagement or detailed written strategy.

It should not include:

- a complete AI roadmap
- detailed implementation architecture
- extensive vendor evaluation
- a written consulting deliverable
- unlimited problem-solving or free consulting

The call should leave the prospect with clarity about whether and how to move forward.

Website CTA may continue to use:

Schedule a Strategy Call

Supporting copy should make clear that this is a complimentary discovery conversation.

---

## 2. Executive AI Advisory Session

Price:

$750 USD

Duration:

60 minutes

Purpose:

A paid working session for owners, executives, and senior leaders who want practical guidance on a specific AI, automation, technology, growth, operational, or implementation decision.

This is actual paid advisory work rather than a qualification call.

The engagement includes:

- pre-session intake
- review of the executive's stated questions or business situation
- 60-minute private advisory session
- post-session Executive Action Brief

The session should focus on real business decisions and practical next steps.

Potential topics may include:

- AI opportunity prioritization
- automation decisions
- AI vendor or platform evaluation
- build-versus-buy decisions
- AI governance
- workflow improvement
- AI adoption
- marketing and growth systems
- implementation priorities
- executive AI strategy
- technology investment decisions

---

## Executive Action Brief

The Executive AI Advisory Session includes a concise post-session deliverable.

Working name:

Executive Action Brief

Expected format:

Approximately 2–4 useful pages or equivalent concise structured output.

The brief may include:

- Situation
- Key Observations
- Priority Opportunities
- Risks and Constraints
- Recommended Next Actions

The brief is intended to provide real standalone value even if the client does not purchase another engagement.

It is not intended to replace a full Executive AI Strategy engagement or detailed implementation roadmap.

---

## Free Call vs. Paid Advisory Session

The distinction must remain clear.

### Free AI Strategy Call

Primary question:

Should we work together, and what should the next engagement be?

Characteristics:

- complimentary
- 30 minutes
- discovery
- qualification
- high-level discussion
- no formal consulting deliverable

### Executive AI Advisory Session

Primary question:

Help me think through or solve this business decision now.

Characteristics:

- paid
- $750
- 60 minutes
- pre-session context review
- focused advisory work
- Executive Action Brief included

Do not allow the complimentary strategy call to become an unpaid substitute for the Executive AI Advisory Session.

---

## 3. Enterprise Engagement Discussion

Price:

Free

Duration:

30–45 minutes

Purpose:

A qualification and discovery conversation for larger organizations already considering a substantial AI transformation, implementation, governance, or managed-services engagement.

Potential discussion areas include:

- organizational priorities
- executive stakeholders
- departments involved
- AI governance
- existing AI initiatives
- implementation requirements
- enterprise systems
- adoption
- timelines
- transformation scope

The purpose is to determine whether a deeper enterprise discovery or strategy engagement is appropriate.

Do not charge an enterprise prospect simply to discuss a potentially significant engagement.

Primary CTA:

Discuss an Enterprise Engagement

---

## 4. AI Training Consultation

Price:

Free

Duration:

30 minutes

Purpose:

A scoping conversation for companies considering employee, department, executive, or company-wide AI training.

Potential discovery topics include:

- number of participants
- departments and roles
- current AI usage
- desired business outcomes
- approved tools
- data/privacy requirements
- governance considerations
- delivery format
- training objectives

The purpose is to scope the appropriate training engagement before quoting or scheduling paid delivery.

Primary CTA:

Schedule AI Training

The CTA may route into the training consultation booking path until a separate booking label is implemented.

---

## 5. AI Workshop

Price:

Paid

V1 pricing:

TBD

Payment structure:

TBD

Potential future models may include:

- full payment at booking
- deposit at booking
- proposal/invoice after scoping

Do not lock workshop pricing until duration, audience, preparation requirements, and deliverables are formally approved.

The website may continue to use:

Book an AI Workshop

but should not collect payment until the commercial model is approved.

---

## Dedicated Booking Page

Planned route:

/book/

The booking page should eventually present a clear choice between available engagement paths instead of sending every visitor into a single generic calendar.

Suggested positioning:

How Would You Like to Work With Us?

Potential booking cards:

- AI Strategy Call
- Executive AI Advisory Session
- Enterprise Engagement Discussion
- AI Training Consultation
- AI Workshop

Each option should explain:

- who it is for
- duration
- price or free status
- what the visitor receives
- the appropriate next step

---

## Calendly Integration

Calendly is the approved V1 scheduling platform.

The implementation should support multiple Calendly event types.

Potential event types:

AI Strategy Call
Executive AI Advisory Session
Enterprise Engagement Discussion
AI Training Consultation
AI Workshop

Exact Calendly event URLs must be stored centrally in the application configuration.

Example conceptual configuration:

strategyCallUrl
executiveAdvisoryUrl
enterpriseDiscussionUrl
trainingConsultationUrl
workshopUrl

Do not place literal Calendly URLs throughout page components.

---

## Paid Booking

The Executive AI Advisory Session will use Calendly payment collection through Stripe when implemented.

Price:

$750 USD

Payment should be required before the paid appointment is confirmed.

Do not describe a paid session as booked until payment succeeds.

---

## Scheduling UX

The scheduling experience should remain professional and low-friction.

Avoid forcing every visitor through the same meeting type.

The site should route visitors according to intent.

Examples:

Assessment prospect
→ AI Strategy Call

Executive seeking immediate paid guidance
→ Executive AI Advisory Session

Large organization
→ Enterprise Engagement Discussion

Training inquiry
→ AI Training Consultation

Workshop inquiry
→ AI Workshop path

---

## Scheduling Implementation Status

Provider decision:

Approved — Calendly

Stripe payment direction:

Approved for paid advisory booking

Website integration:

Deferred until implementation sprint

Exact Calendly event URLs:

Not yet configured

Cancellation/rescheduling policy:

TBD

Workshop pricing:

TBD

Booking embed style:

TBD

Possible approaches:

- dedicated booking page
- Calendly inline embed
- modal/popup embed
- external Calendly booking page

The implementation approach should be selected before production integration.

---

## V1 Principle

Scheduling should support the sales process without becoming the sales process itself.

Small, fixed advisory engagements may be paid directly through Calendly.

Large consulting, implementation, managed-service, training, workshop, and enterprise engagements should be scoped appropriately before final pricing and contracting.
