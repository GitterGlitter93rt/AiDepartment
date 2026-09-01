# Voice Agent — Industry Inventory

Reconciles the industries the website presents against the specialist
modules the AI phone agent actually ships.

**Source of truth for the website side:** `src/lib/industries.ts` — the
single registry that drives navigation, the footer, the industries
index page, and the assessment's industry dropdown. It was read
directly rather than inferred from page files, because a page can exist
without being in the registry and vice versa.

**Source of truth for the agent side:** `services/ai-phone-agent/src/industries/index.ts`.

**Verified:** 1 September 2026.

---

## Summary

| | Count |
|---|---|
| Industries in the website registry | 28 |
| Industries in the agent taxonomy | 28 |
| Specialist modules shipped | 31 |
| Website industries with no specialist | 0 |
| Specialists with no website industry | 1 (Pressure Washing — see gaps) |

Three industries carry more than one specialist because one persona
cannot credibly cover them:

- **Law Firms → 4 specialists.** A family-law intake and a criminal-defence
  intake share almost nothing: different urgency, different qualifying
  questions, different things you must never say.
- Every other industry has exactly one.

---

## Home & Field Services (14 website entries)

| Website industry | Registry href | Agent industry ID | Specialist(s) |
|---|---|---|---|
| Automotive Dealer Groups | `/industries/automotive-dealers/` | `automotive_dealer` | `automotive_dealer.general` |
| Collision Repair | `/industries/collision-repair/` | `collision_repair` | `collision_repair.general` |
| Home Services (Overview) | `/industries/home-services/` | *(umbrella — see note)* | — |
| Roofing | `/industries/roofing/` | `roofing` | `roofing.general` |
| HVAC | `/industries/hvac/` | `hvac` | `hvac.general` |
| Plumbing | `/industries/plumbing/` | `plumbing` | `plumbing.general` |
| Electrical Contractors | `/industries/electrical-contractors/` | `electrical` | `electrical.general` |
| Pest Control | `/industries/pest-control/` | `pest_control` | `pest_control.general` |
| Garage Door Companies | `/industries/garage-door-companies/` | `garage_door` | `garage_door.general` |
| Pool Companies | `/industries/pool-companies/` | `pool` | `pool.general` |
| Screen Enclosure Companies | `/industries/screen-enclosure-companies/` | `screen_enclosure` | `screen_enclosure.general` |
| Landscaping & Outdoor Living | `/industries/landscaping-outdoor-living/` | `landscaping` | `landscaping.general` |
| Restoration & Emergency Services | `/industries/restoration-emergency-services/` | `restoration` | `restoration.general` |
| Construction | `/industries/construction/` | `construction` | `construction.general` |

**Note on Home Services (Overview).** This is a category landing page,
not a trade. It has no specialist of its own by design: a caller never
says "I need home services", they say "my water heater is leaking".
The router classifies to the specific trade underneath it. Giving the
umbrella its own persona would create a specialist that can only be
reached by a sentence nobody says.

## Professional & Property (7 website entries)

| Website industry | Registry href | Agent industry ID | Specialist(s) |
|---|---|---|---|
| Real Estate | `/industries/real-estate/` | `real_estate` | `real_estate.general` |
| Property Management | `/industries/property-management/` | `property_management` | `property_management.general` |
| Professional Services | `/industries/professional-services/` | `professional_services` | `professional_services.general` |
| Law Firms | `/industries/law-firms/` | `attorneys` | `attorneys.family_law`, `attorneys.personal_injury`, `attorneys.criminal_defense`, `attorneys.probate_estate` |
| Healthcare | `/industries/healthcare/` | `healthcare` | `healthcare.general` |
| Insurance | `/industries/insurance/` | `insurance` | `insurance.general` |
| Manufacturing | `/industries/manufacturing/` | `manufacturing` | `manufacturing.general` |

## Sales & Growth (3 website entries)

| Website industry | Registry href | Agent industry ID | Specialist(s) |
|---|---|---|---|
| Solar | `/industries/solar/` | `solar` | `solar.general` |
| Fiber & Broadband | `/industries/fiber-broadband/` | `fiber_broadband` | `fiber_broadband.general` |
| E-commerce | `/industries/ecommerce/` | `ecommerce` | `ecommerce.general` |

## Enterprise & Regulated (4 website entries)

| Website industry | Registry href | Agent industry ID | Specialist(s) |
|---|---|---|---|
| Financial Services | `/industries/financial-services/` | `financial_services` | `financial_services.general` |
| Logistics & Transportation | `/industries/logistics-transportation/` | `logistics` | `logistics.general` |
| Energy | `/industries/energy/` | `energy` | `energy.general` |
| Defense & Aerospace | `/industries/defense-aerospace/` | `defense_aerospace` | `defense_aerospace.general` |

---

## Attorney specialisation

Law Firms is the one website industry deep enough to need real
sub-specialisation, and it was built out furthest.

### `attorneys.family_law`
Covers divorce (contested and uncontested), child custody and
visitation, child support, alimony and spousal support, property
division, domestic violence and protective orders, post-judgment
modification, and enforcement.

Treated as distinct from the rest because family-law callers are
frequently in the middle of the worst week of their life, and because a
domestic-violence disclosure changes the call immediately — it becomes
a safety conversation before it is an intake conversation.

### `attorneys.personal_injury`
Covers motor-vehicle collisions, slip and fall, dog bites, wrongful
death, and medical malpractice.

The distinguishing intake concern is time: statutes of limitation are
real deadlines and the agent captures the date of the incident early.
It also watches for the caller mentioning that an insurer wants a
recorded statement, which is a moment where a firm wants to reach them
quickly.

### `attorneys.criminal_defense`
Covers arrests, DUI/DWI, felony and misdemeanour charges, warrants,
probation violations, bond, and expungement.

Distinct because a court date is a hard deadline, and because the
things the agent must not do are sharper here than anywhere else on the
platform.

### `attorneys.probate_estate`
Covers probate administration, estate disputes and will contests, and
estate planning (wills, trusts, powers of attorney, guardianship).

Distinct because half these callers are recently bereaved and the other
half are planning ahead, and those two conversations sound nothing
alike.

---

## Gaps and deliberate decisions

### Pressure Washing — a specialist with no website page

`pressure_washing` ships a full specialist, but there is **no Pressure
Washing entry in `src/lib/industries.ts` and no page under
`src/pages/industries/`**. A search across `src/`, `docs/02-website/`
and `docs/12-industries/` returned no hits.

It was built because it was explicitly requested and because it fits
the existing Home & Field Services category cleanly. It is flagged here
as a **website content gap**, not an agent gap: the agent can handle
these calls today, and the website cannot currently sell to them.

Adding the page would need a registry entry, a page under
`src/pages/industries/pressure-washing/`, and an assessment dropdown
value — see `docs/adding-an-industry.md`.

### Industries deliberately NOT invented

Nothing was added that the website does not represent, with the single
requested exception above. In particular, no specialist was created for
adjacent trades that would have been easy to guess at — flooring, fencing,
appliance repair, moving, security systems, veterinary, dental,
staffing, or education. Each would be a plausible business, and none of
them is on the website, so building one would be inventing an offer.

### Where the taxonomy and the website deliberately differ

| Website label | Agent ID | Why |
|---|---|---|
| Law Firms | `attorneys` | The agent ID names the professional, not the entity, because the four sub-specialists are people-shaped roles. |
| Electrical Contractors | `electrical` | "Contractors" is a business-model word; the caller has an electrical problem. |
| Landscaping & Outdoor Living | `landscaping` | Shortened; the specialist covers the full scope including hardscape and irrigation. |
| Restoration & Emergency Services | `restoration` | Shortened. |
| Logistics & Transportation | `logistics` | Shortened. |
| Garage Door Companies / Pool Companies / Screen Enclosure Companies | `garage_door`, `pool`, `screen_enclosure` | "Companies" is a page-title convention, not part of the industry. |

These are naming differences only. Every website industry maps to
exactly one agent industry, and `tests/routing-coverage.test.ts`
asserts that every ID in the taxonomy has both a specialist and at
least one routing rule, so the mapping cannot silently rot.

---

## How this stays true

Three tests fail if this document goes stale:

1. **Every taxonomy industry has a specialist.** Adding an ID without a
   module fails the build.
2. **Every taxonomy industry has a routing rule.** A specialist that
   exists but can never be routed to is dead code with a nice prompt.
3. **Every specialist's sample utterances route to its own industry.**
   The samples are the module author's claim about what they handle;
   the test holds them to it.

What no test can catch is the website registry gaining a 29th industry
without a matching specialist, because the two live in different build
graphs. `docs/adding-an-industry.md` is the checklist for that case.
