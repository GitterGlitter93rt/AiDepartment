# Voice Agent — Client Onboarding

How a generic demo brain becomes one client's actual AI receptionist.

The strategic point of the architecture: onboarding a client should be
**supplying configuration**, not rewriting the agent.

```
  INDUSTRY BRAIN                 BUSINESS PROFILE
  (already built, shared)   +    (what we collect from the client)
  what any plumber knows         what THIS plumber charges
                     ↓
              their AI receptionist
```

---

## The two halves, and why the line is where it is

**Industry knowledge** — `services/ai-phone-agent/src/knowledge/` and
`src/industries/` — is what any competent person in the trade knows.
What a plumber asks about a leak. Why a burst pipe means shutting the
water off before taking a name. What a family-law intake needs before a
consultation. It is true of every business in that trade, so it ships
with the product and every client gets it on day one.

**Business configuration** — `src/business/profile.ts` — is true of
exactly one company. The service-call fee. The service area. Whether
they take State Farm. How long they have been in business.

The agent may reason freely from the first and may state the second
**only** when it has been given it. Everything not configured is
declared unknown in the prompt, and the agent says so honestly rather
than guessing. An agent that invents "our service call is $89" is worse
than no agent, because the customer calls back and hears a different
number.

**This means an under-configured client still works.** They get a
competent receptionist that books appointments and takes details, and
it simply says "I don't have that in front of me" more often. Every
field they fill in is one fewer deflection.

---

## Demo mode versus client mode

| | DEMO | CLIENT |
|---|---|---|
| Industry | inferred per call, switchable mid-call | **fixed** by configuration |
| Business identity | generic, unnamed | the client's real business |
| Scenario switching | yes — that is the point | **never** |
| Calendar / SMS / CRM | mocked | live |
| Transfer | demo number or callback promise | their escalation policy |
| Offer another industry at the end | yes | no |

`BusinessProfile.mode` is the switch, and the orchestrator gates
scenario switching on it. A plumbing company's receptionist does not
become a divorce intake because a caller mentioned their ex-wife — on a
real business line that would be an alarming bug.

---

## What we need from a client

Fields map to `BusinessProfile`. **None is required.** Anything missing
becomes an honest deflection rather than a wrong answer, so a client can
go live with the first section and fill the rest in later.

### 1. Identity — start here

| Field | Why it matters | If we don't have it |
|---|---|---|
| Business name | The agent uses it naturally | It never names the business |
| Industry | Selects the brain | — (required in practice) |
| Specialties | Selects sub-brains, e.g. which areas of law | Uses the general one |
| Main phone | For callbacks and texts | Uses the number the caller rang |
| Website | Referred to for detail | Not mentioned |

### 2. Coverage and hours — the two most-asked questions

| Field | Example |
|---|---|
| Service area | "St Johns and Duval counties", a list of towns, or a radius |
| Opening hours | "Monday to Friday, 7 to 5" |
| After-hours emergencies | Do they answer? What counts as one? |

Without these the agent cannot tell a caller whether they are covered
or when someone can come — and it will not guess, because sending a
truck outside the service area costs more than the deflection does.

### 3. Services

- What they do, in the customer's words, not industry jargon.
- **What they explicitly do NOT do.** As useful as the positive list:
  "do you do X?" is one of the most common opening questions, and a
  wrong yes wastes everyone's time.
- Anything seasonal or capacity-limited.

### 4. Pricing policy

We do **not** need a price list. We need to know how they want price
questions handled:

- Is there a service-call or diagnostic fee, and is it credited?
- Are estimates free?
- Anything they are happy to quote by phone — or a flat "never quote by
  phone", which is a valid and common answer.

`neverQuoteByPhone` is a policy, not a price: setting it does not let
the agent quote anything. It just stops the deflection sounding evasive.

### 5. Credentials — only what they can actually claim

- Licence and registration numbers
- Insurance and bonding
- Years in business
- Certifications

**We never infer any of this.** Claiming a licence a business does not
hold is not a customer-service mistake.

### 6. Warranty and financing

- Warranty terms, if published
- Financing or payment plans
- Accepted payment methods

### 7. Insurance (where relevant)

- Carriers worked with, or how insurance work is handled
- For healthcare: plans accepted and network status — **verify before
  configuring**, since a wrong answer becomes an unexpected bill

### 8. Appointments

- Typical visit length
- Minimum notice before the first bookable slot
- How far ahead the calendar opens
- What must be captured before booking (address? decision-maker?)
- Does the agent book directly, or take details for a callback?
- Calendar system and access (Google Calendar today)

### 9. Escalation

- Transfer number, and the hours it is answered
- What should always reach a person
- What to say when no transfer is possible
- After-hours emergency policy

### 10. Their own FAQs

Anything specific to them that the industry brain would not know —
parking, a second location, a policy quirk, a common misconception
about what they do. These become `customFaqs` and override the generic
guidance.

### 11. Integrations

- CRM, and how leads should arrive
- SMS preferences and opt-out language
- Where the end-of-call summary should go
- Any compliance constraints (recording consent, HIPAA, industry rules)

---

## Rollout

1. **Collect** the sections above. Identity, coverage and hours are
   enough to start.
2. **Configure** a `BusinessProfile` with `mode: 'client'`.
3. **Simulate** — `npm run voice:simulate -- --industry <theirs>` with
   their profile loaded. Read the transcripts with the client. This is
   the step that catches wrong assumptions, and it costs nothing.
4. **Add their FAQs** for anything the simulation showed it deflecting
   that it should not have.
5. **Connect** calendar, SMS, CRM, transfer.
6. **Test call** on a number they control before any customer sees it.
7. **Go live** — forward their main line, or a tracked number, or
   after-hours only. After-hours only is the lowest-risk start and
   still captures the leads they are currently losing to voicemail.
8. **Review** the first week's call summaries with them. Every "I don't
   have that in front of me" is a field worth filling in.

---

## What is NOT built yet

- **No onboarding UI.** Profiles are code today. A form feeding this
  structure is the obvious next product step.
- **No multi-tenant routing.** One process serves one profile. Serving
  many clients needs a per-number profile lookup — the seam exists
  (`OrchestratorDeps.resolveProfile`), the plumbing does not.
- **No per-client analytics separation.** The analytics event carries a
  CallSid and no tenant id.
- **CRM is a placeholder.** `CrmTool.pushLead` is the one method to
  implement.

None of these is architectural. The engine already takes a
`BusinessProfile` and behaves differently in client mode; what is
missing is the delivery around it.
