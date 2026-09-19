# Your AI Department — Field Sales Route Planner Specification

**Status:** Architecture authority  
**Purpose:** Turn Market Miner intelligence into efficient in-person B2B routes for YAD salespeople while respecting relationship state, business relevance, travel efficiency, and workplace boundaries.  
**Implementation owner:** Claude Code

---

# 1. CORE USE CASE

A rep should be able to ask:

> Give me the best 20 businesses to visit around St. Augustine today, in a reasonable driving route, with the right person/role, the one question to ask, and any prior relationship context.

This is not a raw Google Maps list.

---

# 2. ROUTE INPUTS

- rep
- start/end point
- time window
- target campaigns/verticals
- geography/radius
- maximum stops
- minimum Tier/research completeness
- route mode
- existing leases
- business hours where independently/permissibly available
- prior contact history
- requested appointments/return visits
- suppression/policy
- travel-time provider if configured

---

# 3. FIELD ROUTE MODES

- advertiser_priority
- no_verified_website
- weak_website
- general_tier_A_B
- scheduled_return_visits
- dense_industrial_commercial_route
- vertical_specific
- mixed_route

Campaign determines which prospects are eligible.

---

# 4. FIELD ELIGIBILITY GATES

Exclude/block when:

- DNC/no-visit instruction by policy
- active opportunity owned by someone else
- meeting already booked
- business identity/location unresolved
- location is remote/mailbox/non-public office where walk-in inappropriate
- explicit “do not stop by” relationship note
- safety/privacy restricted facility where unsolicited walk-in inappropriate
- business closed/nonoperating
- prospect already visited too recently under cadence policy.

---

# 5. LOCATION QUALITY

Classify location:

- customer-facing storefront/office
- trade shop/warehouse with front office
- professional office
- multi-tenant office suite
- home-based business
- virtual office/mailbox
- unknown

Field routing may prefer customer-facing/appropriate commercial locations.

Home addresses should not be used for unsolicited sales visits unless clearly public business premises and policy allows; default conservative.

---

# 6. FIELD PRIORITY

Within eligible prospects consider:

1. scheduled return visit / explicit invitation
2. Tier/score
3. field suitability
4. advertiser/website opportunity strength
5. hypothesis strength
6. target role availability likelihood
7. research freshness
8. geographic clustering/travel cost
9. route aging/fairness.

Do not choose a terrible prospect solely because it is next door.

---

# 7. ROUTE OPTIMIZATION

Goal is not mathematically shortest drive at any cost.

Optimize for:

- high-value stops
- reasonable geographic sequence
- time windows/business hours
- scheduled commitments
- route start/end
- realistic stop duration
- travel buffer.

A high-value detour may be worthwhile.

---

# 8. STOP CARD

For each stop show:

- company
- address
- location type
- vertical
- Tier/score
- why visit
- public signal
- target role
- named contact if current
- prior outreach/context
- first field question
- backup question
- do-not-claim
- evidence link
- last visit/contact
- quick disposition buttons.

---

# 9. WALK-IN OPENING

Follow Module 4B principles:

- acknowledge no appointment
- do not disrupt workplace
- one relevant business question
- ask who owns the process
- leave if asked
- respect safety/privacy boundaries.

No deceptive “I was just in the area because a client sent me.”

---

# 10. NO-WEBSITE FIELD MODE

For businesses with no verified website:

Opportunity hypothesis may be:

- website/conversion foundation
- phone/lead handling
- local visibility.

Do not assume no website means they need a $X website.

First question should diagnose how new customers currently find/contact them.

Example:

> “I couldn't find a current website for the business, so I was curious—where do most new customers find you today?”

Only if website absence is sufficiently verified/current and phrased non-confrontationally.

---

# 11. ADVERTISER FIELD MODE

If current paid-ad evidence:

> “I noticed you guys are advertising around roof replacement locally. I had one question about what happens after those leads come in.”

Use fresh evidence only.

Never mention spend.

---

# 12. GATEKEEPER CAPTURE

At front desk rep may capture:

- correct role/person
- best return time
- appointment suggestion
- email/business card path

These update Prospect Memory and Decision-Maker Routing.

Do not collect unnecessary personal data.

---

# 13. ROUTE DISPOSITIONS

- not_open
- could_not_enter
- front_desk_only
- correct_person_identified
- decision_maker_spoken
- return_visit_requested
- leave_information
- possible_opportunity
- qualified_followup
- meeting_booked
- not_fit
- do_not_visit/contact
- moved/closed

---

# 14. RETURN VISITS

A requested return visit is relationship commitment and outranks generic new stops near that time.

Store:

- date/time/daypart
- who requested
- who to ask for
- reason
- promised item.

---

# 15. FIELD SAFETY / PRIVACY

Examples:

- body shop production floor: stay in customer/front-office area unless invited/authorized
- construction sites: no entry into active work area
- law firm: do not inspect client files/screens
- healthcare: do not discuss visible patients/information
- industrial facilities: follow visitor/safety rules
- private/home address: conservative no-walk-in policy.

---

# 16. ROUTE LEARNING

Track:

- visit
- correct-person identification
- decision-maker conversation
- qualified conversation
- return visit
- meeting
- distance/time
- vertical
- route/time block
- public qualification signals.

Learn which route types generate meaningful conversations, not maximum door count.

---

# 17. REP CHECK-IN

Optional mobile workflow:

- arrived
- completed
- disposition
- notes/correction
- next step

Avoid continuous employee surveillance unrelated to business need.

---

# 18. BUSINESS HOURS

Hours are research data with freshness/source.

Do not assume third-party hours always accurate.

Route planner should:

- use current first-party hours where available
- mark uncertain hours
- avoid strict dependency on stale data
- allow rep correction.

---

# 19. ACCEPTANCE TESTS

1. 30 local prospects -> planner selects 15 high-value geographically reasonable stops.
2. Scheduled return visit at 2 PM -> route respects it.
3. DNC/no-visit Account -> excluded.
4. Existing meeting booked -> excluded from cold walk-in.
5. No-website verified contractor -> appropriate website-discovery question.
6. Current roofing advertiser -> ad-specific field hook allowed.
7. Stale ad -> generic workflow hook instead.
8. Home-based address -> default excluded/review.
9. Law office -> formal front-desk behavior/privacy notes.
10. Two reps -> same Account cannot be leased to both routes.

---

# 20. CORE RULE

Field sales should use the same intelligence and relationship memory as phone/email. The route planner optimizes meaningful business conversations, not miles driven or doors touched.
