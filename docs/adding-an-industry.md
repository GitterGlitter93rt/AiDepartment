# Adding an Industry

Two separate jobs. The website and the voice agent live in different
build graphs and neither knows about the other, so an industry added to
one is invisible to the other until you add it to both.

Work through Part 1 if you want the industry **sold** on the site.
Work through Part 2 if you want the phone agent to **handle** those
calls. Usually you want both.

Current state: 28 industries on both sides, plus one specialist with no
website page. See `docs/voice-agent-industry-inventory.md`.

---

# Part 1 — The website

### 1. Register it

`src/lib/industries.ts` is the single source of truth. Nav, footer, the
industries index, and the assessment dropdown all read from it.

```ts
{
  name: 'Pressure Washing',
  href: '/industries/pressure-washing/',
  category: 'Home & Field Services',
  description: 'Lead response, quoting, and recurring commercial cleaning schedules.',
  assessmentValue: 'pressure-washing',
  showInPrimaryNav: false,
  showInFooter: true,
},
```

`assessmentValue` must be stable — it flows into stored assessment
results, and changing it later orphans historical data.

### 2. Build the page

`src/pages/industries/<slug>/index.astro`. Copy the closest existing
industry as the structural template.

Then re-read `CLAUDE.md`. The rules that bite hardest here:

> Do not invent offers, pricing, testimonials, case studies, results,
> ROI, statistics, or customer counts.

If you do not have the number, do not write the number.

### 3. URLs are permanent

Pick the slug once. Changing it later costs SEO and needs a redirect in
`public/.htaccess`.

### 4. Verify

```bash
npm run build
npx astro check
npm test                # includes the SEO quality suite
```

The SEO suite checks exact-list assertions about which routes are
indexable — a new page will fail it until it is accounted for, and that
failure is the test working.

---

# Part 2 — The voice agent

Four files, in this order. Each step is testable before you move on.

### 1. Add the ID to the taxonomy

`services/ai-phone-agent/src/core/taxonomy.ts`:

```ts
export const INDUSTRY_IDS = [
  // …
  'pressure_washing',
] as const;

export const INDUSTRY_LABELS: Record<Industry, string> = {
  // …
  pressure_washing: 'Pressure Washing',
};
```

Use `snake_case`. The ID names the *work*, not the business entity —
`electrical`, not `electrical_contractors`; the caller has an electrical
problem, they do not have a contractor problem.

At this point `npm test` **fails**, and it should: two structural tests
now report that the new ID has no specialist and no routing rule.

### 2. Write the specialist

`src/industries/<sector>/<name>.ts`. Use `defineSpecialist()`.

```ts
import { defineSpecialist, BOOKING_GUIDANCE, DEMO_INTEGRITY } from '../define.ts';

export const pressureWashing = defineSpecialist({
  industry: 'pressure_washing',
  specialty: 'general',
  displayName: 'Exterior Cleaning',
  supportedIntents: ['driveway', 'house_wash', 'roof_cleaning', 'commercial', 'quote_request'],
  matches: () => true,

  openingLine: (s) =>
    s.route.intent === 'roof_cleaning'
      ? "Happy to help. Is it a shingle roof or tile? That changes how we treat it."
      : "Sure — what surfaces are we looking at, and roughly how big an area?",

  qualificationSchema: [
    { key: 'surfaces', goal: 'which surfaces need cleaning', required: true },
    { key: 'propertyType', goal: 'residential or commercial' },
    { key: 'firstName', goal: "the caller's first name", required: true },
    { key: 'address', goal: 'the service address', required: true },
    { key: 'phone', goal: 'the best callback number', required: true },
  ],

  urgencyRules: [
    { when: 'a property is being listed or an inspection is imminent', level: 'high', action: 'prioritise scheduling' },
  ],

  escalationRules: [
    { when: 'the caller asks about mould remediation inside the building', action: 'that is a restoration job, not exterior cleaning — say so and offer to take details for a referral' },
  ],

  bookingRules: { appointmentName: 'on-site quote', durationMinutes: 30, booksOnCall: true, prerequisites: ['address', 'phone'] },

  sampleUtterances: [
    'My driveway is black and needs pressure washing.',
    'I want the whole house soft washed, the siding is green.',
    'Can someone clean the black streaks off my roof?',
  ],

  systemPrompt: `You are the intake coordinator for an exterior cleaning company.
…`,
});
```

Rules that are not optional:

- **At least 3 `sampleUtterances`**, asserted by a test. They double as
  routing fixtures, so write what a caller would actually *say* — not a
  description of the service.
- **Never state a price.** Take the details and book the quote.
- **`openingLine` is not generated.** It is returned instantly after
  routing, which is what makes the handoff feel seamless.
- Do **not** restate the common escalations (caller asks for a human,
  caller in distress, 911). `defineSpecialist()` adds them.
- End the prompt with `BOOKING_GUIDANCE` and `DEMO_INTEGRITY` — the
  latter is asserted present on every specialist.

### 3. Register it

`src/industries/index.ts`:

```ts
import { pressureWashing } from './home-services/pressure-washing.ts';

export const REGISTRY: Record<Industry, IndustrySpecialist[]> = {
  // …
  pressure_washing: [pressureWashing],
};
```

An industry may hold more than one specialist when one persona cannot
credibly cover it — `attorneys` holds four. Do not split for the sake
of it: a second specialist is only worth it when the intake questions,
the urgency rules, and the things you must never say genuinely differ.

### 4. Write the routing rules

`src/core/router-rules.ts`. This is the part that takes the longest and
matters the most.

```ts
{ industry: 'pressure_washing', specialty: 'general', intent: 'driveway',
  anchors: [/\b(driveway|patio|deck|concrete)\b[^.]{0,40}\b(pressure ?wash\w*|power ?wash\w*|clean\w*)\b/i],
  support: [/\bstain\w*/i, /\bmildew\b/i, /\balgae\b/i] },
```

- **Anchors** are distinctive. Matching one is strong evidence (10 pts).
- **Support** terms corroborate (2 pts) and can **never** classify on
  their own. A rule with no anchor hit is discarded.
- **Veto** discards the rule outright when disqualifying context is
  present.

Reach for a veto when a word makes a call *not* belong to some other
industry, rather than making it belong to yours:

```ts
// Somebody else's roof job.
veto: [/\b(soft ?wash|pressure ?wash)\w*/i, /\bsolar\b/i]
```

That is how "soft wash my roof" reaches exterior cleaning instead of a
roofer, and how "in my apartment" takes an HVAC call to the property
manager.

**Write the anchors for the sentences in your `sampleUtterances`
first**, then run the suite. Two failure modes to expect:

- *Your sample does not route.* Usually word order — callers say
  "sidewalks done for the complex" as often as "clean the sidewalks".
  Add the reversed alternation.
- *Your rule steals another industry's call.* The safety contract
  catches this. Narrow the anchor or add a veto; do not widen anything.

### 5. Run everything

```bash
cd services/ai-phone-agent
npx tsc --noEmit
npm test
```

All four structural tests should now pass for the new ID.

---

## When a sample utterance will not route

Some opening lines are genuinely ambiguous and **should not** be forced:

- "When can you come install?" — no subject at all
- "I have a question about my bill." — every industry bills someone
- "Where is my order?" — consumer retail or B2B manufacturing

If a sample of yours is one of these, the sample is wrong, not the
router. Rewrite it to include the distinguishing detail a real caller
would give ("When can you come install the fiber?"), or move it into
the `GENUINELY_AMBIGUOUS` list in `tests/routing-coverage.test.ts`,
which asserts such lines stay *below* the confidence threshold so the
agent asks instead of guessing.

Nine sample utterances were corrected this way during the initial
build. It is a normal outcome, not a failure.

---

## Checklist

**Website**
- [ ] Entry in `src/lib/industries.ts` with a stable `assessmentValue`
- [ ] Page at `src/pages/industries/<slug>/index.astro`
- [ ] No invented pricing, results, or testimonials
- [ ] `npm run build`, `npx astro check`, `npm test` all pass

**Voice agent**
- [ ] ID in `INDUSTRY_IDS` and `INDUSTRY_LABELS`
- [ ] Specialist module with ≥3 realistic sample utterances
- [ ] Registered in `REGISTRY`
- [ ] Routing rules with anchors, support, and vetoes where needed
- [ ] `npx tsc --noEmit` and `npm test` pass
- [ ] Row added to `docs/voice-agent-industry-inventory.md`
