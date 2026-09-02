# Your AI Department — Market Miner / Prospect Factory Specification

**Status:** Architecture authority for Claude Code  
**Purpose:** Build the system that continuously finds, researches, deduplicates, scores, and prioritizes businesses before any human rep or Twilio agent contacts them.  
**Implementation owner:** Claude Code  
**Production calling:** Out of scope for this phase

---

# 1. CORE PRODUCT IDEA

The Market Miner is the front end of the entire outbound system.

Its job is to answer, continuously and defensibly:

1. Which businesses exist in the target territory?
2. Which of them look most likely to have a meaningful YAD opportunity?
3. What can we responsibly know about them before contact?
4. What should we sell or investigate first?
5. Why should this business be called before the next business?
6. What exact hook should the caller use?
7. What evidence supports that hook?

The phone agent should never start with a raw phone list.

The correct flow is:

`Territory -> Business Discovery -> Identity Resolution -> Independent Enrichment -> Website Research -> Ad Research -> Technology/CRM Signals -> Opportunity Classification -> YAD Score/Tier -> Offer/Hook Selection -> Human/Phone Queue`

The Market Miner is useful even if autonomous calling is never enabled. It should be able to produce a ranked daily research-backed call list for Brent or any other salesperson.

---

# 2. INPUTS

A Market Mining Job should accept:

- vertical / industry;
- country;
- one or more states;
- one or more counties;
- one or more cities;
- one or more ZIP/ZCTA codes;
- radius around a point or city;
- metro/CBSA where useful;
- minimum YAD tier;
- target services/keywords;
- excluded services/keywords;
- minimum/maximum business size signals if desired;
- campaign objective;
- maximum number of new prospects requested;
- research freshness window;
- optional required signals, e.g. active ads, 24/7, multiple locations;
- optional exclusions, e.g. existing customer, prior DNC, franchise corporate account, already researched.

Example job:

- Vertical: HVAC
- Geography: Jacksonville + St. Augustine, Florida
- Radius: 50 miles
- Required tier: B or higher
- Priority: Google/Meta advertisers
- Goal: identify 250 research-complete prospects
- Output: ranked prospect queue with Call Packs

---

# 3. GEOGRAPHY ENGINE

The system must treat geography as structured data, not as free-text only.

## 3.1 Hierarchy

Support:

`Country -> State -> County -> Place/City -> ZCTA/ZIP-like geography -> Search Cell -> Business`

Also support:

- CBSA / metro area;
- radius from latitude/longitude;
- rectangular search bounds;
- service-area overlap.

## 3.2 Canonical U.S. geography source

Use U.S. Census Gazetteer/reference files for durable geographic enumeration of:

- states;
- counties;
- places;
- CBSAs;
- ZCTAs;
- representative latitude/longitude.

Important: ZCTAs are Census geographic approximations of USPS ZIP Code delivery areas, not a perfect replacement for USPS ZIP Codes. Treat them as search geography, not mailing truth.

## 3.3 Search-cell generation

Large cities and counties cannot be adequately covered by one generic search.

Create search cells using one or more strategies:

- each target city;
- each target ZCTA;
- a grid of latitude/longitude cells;
- radius circles centered on populated areas;
- county subdivisions where useful.

Every discovery result should retain:

- mining job ID;
- territory ID;
- search cell ID;
- query/keyword that found it;
- discovery source;
- discovery timestamp.

This allows YAD to measure coverage and avoid searching the same territory forever.

---

# 4. VERTICAL SEARCH DICTIONARY

Every vertical gets a machine-readable dictionary.

For HVAC, initial query families may include:

## Core category

- HVAC contractor
- air conditioning contractor
- heating contractor
- AC company
- heating and cooling

## Urgent/high-intent

- AC repair
- emergency AC repair
- emergency HVAC
- no cool repair
- furnace repair
- heat pump repair

## High-ticket

- AC replacement
- HVAC replacement
- new air conditioner
- heat pump installation
- HVAC installation

## Commercial variants

- commercial HVAC
- commercial air conditioning

## Exclusions / classification warnings

- appliance repair only
- auto AC
- supply house
- manufacturer only
- wholesaler only
- school/training program

The query generator should combine query families with:

- city;
- county;
- state;
- ZCTA;
- neighborhood/market where useful.

Do not generate every Cartesian combination blindly. Use query budgeting and coverage rules.

---

# 5. BUSINESS DISCOVERY PROVIDER LAYER

Claude must implement discovery behind provider interfaces so YAD can change vendors without rewriting the system.

Conceptual interface:

`discoverBusinesses(searchCell, queryFamily, cursor) -> DiscoveryCandidate[]`

Every candidate must contain:

- source provider;
- source-native ID if allowed to retain;
- observed business name;
- observed website/domain if available;
- observed phone if available;
- observed address/geography if available;
- source URL/reference if allowed;
- discovery timestamp;
- raw-source retention policy classification.

## 5.1 Source classes

### Class A — Durable first-party/public-record source

Examples:

- company website;
- public state licensing registry;
- Secretary of State/public business registry where legally/technically appropriate;
- Census geography;
- public professional directories with suitable terms;
- government contractor/license lists.

Data independently obtained from these sources may become part of YAD's durable prospect record subject to the source's terms.

### Class B — Licensed lead/business provider

Examples may include Apollo or another licensed business-data source.

Store/use according to contract and license.

### Class C — Discovery-only platform with restrictive content terms

Google Maps/Places belongs here unless current terms explicitly permit the desired retention.

Current architecture rule:

- use the source to discover/resolve a business;
- retain durable identifiers only where permitted (for Google Places, Place ID is specifically exempt from normal caching restrictions);
- independently re-acquire durable business facts from the company's own website, direct public records, or a licensed source;
- do not build YAD's permanent database by bulk copying restricted platform content.

### Class D — Browser/manual/transient advertising evidence

Meta Ad Library and Google Ads Transparency research may fall here depending on current API/terms/access.

Store the minimal evidence needed for sales relevance:

- advertiser identity;
- platform;
- service/offer observed;
- landing destination if legitimately available;
- observed timestamp;
- source reference;
- confidence.

Do not treat an ad-research source as YAD's canonical business identity database.

---

# 6. SOURCE STRATEGY — GOOGLE

## 6.1 Business discovery

Google Places API (New) is useful as a discovery/identity source because Text Search can find businesses from queries such as `HVAC contractor Jacksonville Florida` and supports geographic bias/restriction.

Architecture constraints:

- provider adapter only;
- field masks to control cost;
- use Place ID as durable cross-run identifier where permitted;
- do not assume identical searches return identical result sets;
- search pagination has practical result limits, so geography/query decomposition is required;
- respect current Maps/Places storage/caching/attribution requirements.

## 6.2 Google sponsored-search signal

Places results do not prove Google Ads activity.

Google paid-search detection is a separate evidence adapter.

The system may use an approved SERP/ad-evidence provider or reviewed browser workflow to capture clearly labeled Sponsored/Ad results for relevant high-intent queries.

Required evidence:

- query;
- geography context;
- advertiser/business identity;
- advertised service/offer;
- landing domain/URL if available;
- timestamp;
- screenshot/reference where policy and storage permit.

A company absent from one sponsored result is `UNKNOWN`, not `NOT ADVERTISING`.

## 6.3 Google Ads Transparency Center

Use as additional advertiser confirmation where practical.

Treat as evidence, not spend intelligence.

Never infer:

- monthly spend;
- ROI;
- campaign quality;
- lead volume;
- profitability.

---

# 7. SOURCE STRATEGY — META

Meta Ad Library publicly exposes currently running ads across Meta technologies through its search experience.

Important architecture nuance:

The official Ad Library API does not necessarily provide unrestricted programmatic access to every ordinary U.S. commercial ad in the same way the public Ad Library search UI does. Current Meta documentation emphasizes API coverage for political/issue ads globally and all ad types in certain regulated regions such as the EU/UK.

Therefore Claude must NOT design V1 assuming:

`Meta Ad Library API -> all U.S. local-business commercial ads`

Instead implement a `MetaAdEvidenceProvider` abstraction with possible implementations:

1. officially supported API where the requested data class is available;
2. reviewed browser-assisted research;
3. licensed third-party ad intelligence provider;
4. human-review queue;
5. `UNKNOWN` when no compliant automated source is configured.

The sales system can operate with Meta signal unknown.

It must never fabricate a negative result merely because the adapter is unavailable.

---

# 8. IDENTITY RESOLUTION / DEDUPLICATION

This is critical because the same business may appear from:

- five keyword searches;
- several ZCTAs;
- Google Places;
- Apollo;
- state licensing;
- Meta;
- Google Ads;
- its own website;
- several locations.

## 8.1 Entity model

Separate:

- `Company/Account` — the organization/brand/business entity;
- `Location` — physical office/shop/branch;
- `Domain` — one or more web properties;
- `PhoneEndpoint` — one or more numbers;
- `Contact` — person/role;
- `SourceIdentity` — provider-native reference.

Do not collapse a multi-location contractor into multiple unrelated accounts by default.

## 8.2 Strong matching keys

Examples:

- normalized canonical domain;
- exact normalized phone;
- permitted source-native stable ID;
- exact street address + business identity;
- license number;
- explicit website organization schema identifiers.

## 8.3 Fuzzy matching

Use fuzzy company-name/address matching only when strong keys are unavailable.

Fuzzy matches should carry a confidence and may require review before merging.

Examples requiring caution:

- `ABC Air LLC` vs `ABC Heating & Air`;
- franchise locations sharing a brand domain;
- parent company with multiple DBA names;
- lead-generation websites forwarding calls to several contractors.

## 8.4 Merge policy

Never irreversibly destroy source records.

Maintain source observations and map them to a canonical entity.

A merge must be reversible/auditable.

---

# 9. INDEPENDENT WEBSITE RESEARCH

After a candidate is resolved to a domain, the business's own website becomes one of the most valuable durable sources.

## 9.1 Crawl budget

V1 should not crawl an entire 5,000-page site.

Suggested priority:

1. homepage;
2. contact;
3. about/team;
4. primary service pages;
5. emergency/24-7 page;
6. financing/offers;
7. location pages;
8. booking/estimate/consultation pages;
9. privacy/terms only if needed to understand providers/lead flow.

Target 5–20 useful pages, configurable.

## 9.2 Extracted facts

### Business model

- services;
- residential/commercial;
- service area;
- locations;
- hours;
- emergency/24-7 language;
- financing;
- memberships;
- high-value services;
- current offers.

### Customer acquisition / CTA

- click-to-call;
- phone placement;
- form types;
- quote/estimate request;
- consultation request;
- chat;
- text/SMS;
- self-booking;
- lead magnet;
- financing application.

### People/roles

- owner;
- GM;
- operations;
- sales;
- marketing;
- office manager;
- leadership team.

### Technology signals

- GTM;
- GA4;
- Google Ads tags;
- Meta Pixel;
- call tracking;
- forms;
- chat;
- booking platform;
- marketing automation;
- public CRM/field-service widgets.

## 9.3 Frontend-signal rule

A script/widget tells us only that a signal exists.

Examples:

- HubSpot form detected -> `HubSpot-related frontend signal`.
- ServiceTitan booking widget -> `ServiceTitan-related booking signal`.

It does NOT automatically mean:

- all leads go to that CRM;
- missed calls are automated;
- attribution is configured;
- salespeople consistently use the system.

Those become discovery questions.

---

# 10. WEBSITE QUALITY / SALES OPPORTUNITY CLASSIFIER

The Market Miner should not only ask whether a website exists.

Classify the observable customer-acquisition system.

## Website presence

- no domain found;
- social-only presence;
- thin/basic website;
- functioning business website;
- sophisticated funnel.

## Lead-capture maturity

- phone only;
- generic contact form;
- service-specific form;
- booking;
- chat;
- SMS;
- multi-step funnel;
- after-hours acknowledgement visible/unknown.

## Measurement maturity signals

- no visible analytics signal;
- analytics present;
- ad pixels present;
- call tracking present;
- multiple tracking systems.

## CRM/system maturity signal

- none visible/unknown;
- one system signal;
- advanced system signal;
- multiple/disconnected frontend systems.

Again: these are observable maturity signals, not a backend audit.

---

# 11. OPPORTUNITY / OFFER CLASSIFICATION

After research, classify the strongest plausible YAD offer families.

The output should rank offer hypotheses, not assign one product permanently.

## Offer family examples

### Website / conversion foundation

Signals:

- no website;
- outdated/poor lead capture;
- weak mobile CTA;
- generic contact-only funnel.

### AI receptionist / missed-call recovery

Signals:

- phone-heavy vertical;
- emergency/after-hours;
- high-value lead flow;
- no confirmed robust overflow/recovery.

### Speed-to-lead / appointment setting

Signals:

- Meta lead ads;
- web forms;
- consultation/quote funnels;
- urgent customer journey.

### CRM implementation / cleanup

Signals:

- no CRM evidence plus meaningful lead flow;
- spreadsheets/manual process publicly described;
- fragmented customer intake;
- prospect later confirms no central system.

### CRM integration / automation

Signals:

- existing CRM/system signal;
- paid acquisition;
- calls/forms/booking;
- opportunity to connect follow-up, reactivation, attribution.

### Marketing / paid acquisition

Signals:

- strong business/funnel but weak visible demand generation;
- underdeveloped paid/SEO presence;
- prospect confirms growth objective.

### Attribution / analytics

Signals:

- active paid channels;
- multiple sources;
- call/form conversion;
- no confirmed revenue attribution.

### Reactivation

Signals:

- repeat/recurring/high-volume vertical;
- memberships/maintenance/old estimates/customer database likely to matter;
- prospect later confirms database size.

### Employee-capacity automation

Signals:

- multiple locations;
- hiring;
- phone-heavy operations;
- complex intake/scheduling/admin.

Output per prospect:

- primary offer hypothesis;
- secondary offer hypothesis;
- why;
- supporting facts;
- missing facts to ask;
- prohibited assumptions.

---

# 12. CANONICAL YAD SCORING

Use the Sales Manual Module 4C score exactly as the auditable baseline.

## Paid acquisition

- +4 confirmed Google paid-search/high-intent sponsored signal
- +3 confirmed Meta active-ad signal
- +1 active on more than one paid channel

## Economic value

- +2 high-value customer/job/case/treatment/contract/recurring-account economics
- +2 lead/intake/estimate volume appears operationally important

## Urgency/workflow

- +1 emergency/after-hours/24-7
- +1 appointment/estimate/consultation/intake-heavy process
- +1 multiple locations/service territories
- +1 visible growth/hiring/expansion
- +1 strong phone dependence
- +1 prominent forms/booking/quote/consultation CTA

## Tier

- A: 9+
- B: 6–8
- C: 3–5
- D: 0–2

Each point must reference supporting evidence.

If an input is unknown, award zero for that item; do not assume the negative fact is true.

---

# 13. SECONDARY RESEARCH-COMPLETENESS SCORE

Do not mix data quality into YAD fit.

Create a separate `Research Completeness` score.

Example components:

- canonical domain resolved;
- phone independently verified;
- business category confirmed;
- geography confirmed;
- website analyzed;
- ad status checked;
- offer/CTA identified;
- decision-maker search attempted;
- CRM/technology detection attempted;
- evidence fresh.

Possible labels:

- COMPLETE
- GOOD
- PARTIAL
- THIN
- STALE

A Tier A prospect with stale/partial research should be refreshed before the caller uses a research-specific opener.

---

# 14. FUTURE LEARNED PROPENSITY SCORE

After YAD has real outcomes, build a separate model estimating outcomes such as:

- probability of reaching decision-maker;
- probability of qualified conversation;
- probability of meeting;
- probability of closed opportunity.

Features may include:

- vertical;
- geography;
- YAD manual score;
- Google/Meta signals;
- number of locations;
- emergency service;
- CRM signal;
- hook family;
- source;
- website maturity;
- call time/day;
- campaign version.

Never overwrite the canonical manual score. Store both.

---

# 15. QUERY COVERAGE ENGINE

The Miner needs to know when a territory has been adequately searched.

Track:

- geography searched;
- query family;
- provider;
- pages/cursors exhausted;
- unique businesses found;
- new-business yield;
- duplicate rate;
- date last searched.

## Saturation logic

Example:

If repeated queries in a search cell return >90% already-known businesses across several distinct query families, mark the cell `SATURATED` for a cooldown period.

Do not waste API/browser budget endlessly rediscovering the same top ten contractors.

## Refresh logic

Reopen saturated territories periodically because:

- businesses open/close;
- advertisers change;
- offers change;
- new locations appear;
- websites change.

---

# 16. COST/BUDGET ENGINE

Every provider call should be measurable.

Track cost or usage by:

- mining job;
- provider;
- vertical;
- geography;
- prospect successfully discovered;
- Tier A/B prospect produced.

Useful management metric:

`research cost per Tier A/B prospect`

and eventually:

`research cost per qualified meeting`

The engine should support per-job budgets so a runaway search cannot create an unexpected vendor bill.

---

# 17. RESEARCH QUEUE PRIORITY

Research expensive/deep sources only after cheap identity/discovery filters where sensible.

Example cascade:

1. discover candidate;
2. dedupe;
3. discard obvious non-fit category;
4. resolve website;
5. basic website research;
6. calculate preliminary score;
7. if plausible Tier B/A or campaign requires it, perform deeper ad/CRM/decision-maker research;
8. final score;
9. create Call Pack.

Do not spend a premium ad-intelligence request on a supply house accidentally found in an HVAC search.

---

# 18. PROSPECT STATUS MACHINE

Suggested states:

- `DISCOVERED`
- `DUPLICATE_LINKED`
- `IDENTITY_RESOLVED`
- `RESEARCH_QUEUED`
- `RESEARCHING`
- `RESEARCH_PARTIAL`
- `RESEARCH_COMPLETE`
- `SCORED`
- `READY_HUMAN_ASSIST`
- `READY_COMPLIANCE_REVIEW`
- `READY_CALL_QUEUE`
- `CONTACTED`
- `FOLLOW_UP`
- `QUALIFIED`
- `DISQUALIFIED`
- `SUPPRESSED`
- `STALE_REFRESH_REQUIRED`

The Market Miner itself stops at a research/queue-ready state. Telephony is downstream.

---

# 19. DAILY OUTPUT FOR SALESPEOPLE

The system must be valuable before automated calls exist.

Generate a daily ranked list containing:

- rank;
- company;
- city;
- industry;
- phone;
- website;
- YAD score/tier;
- research completeness;
- why this business ranks highly;
- confirmed ad evidence;
- advertised service/offer;
- emergency/after-hours signal;
- CRM/system signal;
- primary YAD offer hypothesis;
- primary hook;
- backup hook;
- first question;
- decision-maker/role if known;
- last contact/outcome;
- evidence links/reference.

Example human-facing summary:

> **#1 — ABC Air — Tier A (12)**  
> Google sponsored signal for emergency AC + 24/7 service + two locations + strong phone/estimate funnel. ServiceTitan booking signal detected.  
> **Primary hypothesis:** paid/after-hours lead handling and missed-call recovery.  
> **Hook:** “I noticed you’re advertising emergency AC in Jacksonville. When one of those calls comes in after hours and the office can’t grab it immediately, what happens next?”  
> **Do not claim:** spend level, missed-call percentage, or that ServiceTitan follow-up is incomplete.

---

# 20. MARKET AUTOPILOT

A long-term Market Mining Campaign can maintain a target inventory.

Example:

`Jacksonville HVAC — maintain 250 READY prospects at Tier B+`

The controller watches inventory:

- 250 ready -> pause mining;
- calls consume 30 -> inventory 220;
- miner resumes and replenishes 30;
- saturated local territory -> expand according to approved territory order.

This creates a continuous prospect supply rather than periodic spreadsheet projects.

---

# 21. TERRITORY EXPANSION ORDER

The architecture must support explicit expansion rules rather than random nationwide searching.

Example HVAC pilot:

1. St. Augustine / St. Johns County
2. Jacksonville / Duval
3. Clay / Nassau adjacent markets
4. Orlando metro
5. Tampa Bay
6. South Florida
7. other Florida metros
8. Southeast expansion after Florida metrics justify it

The exact business rollout is configurable; this list is an initial operating example, not a hard-coded national strategy.

---

# 22. SOURCE OWNERSHIP / RETENTION METADATA

Every data field should know where it came from and whether it can be retained.

Suggested metadata:

- `source_provider`
- `source_type`
- `source_reference`
- `observed_at`
- `retention_class`
- `expires_at`
- `independently_verified`

Retention classes:

- `DURABLE`
- `DURABLE_WITH_LICENSE`
- `TRANSIENT`
- `IDENTIFIER_ONLY`
- `DO_NOT_STORE_RAW`

This prevents accidental permanent storage of restricted source data.

---

# 23. SECURITY / ABUSE GUARDRAILS

- Respect robots/terms/source policies.
- No bypassing authentication, CAPTCHAs, rate limits, or technical access controls.
- No fake customer inquiries to test lead response.
- No collection of unnecessary personal information.
- No sensitive-person profiling.
- No contact to suppressed accounts/numbers.
- No automatic dial handoff until compliance decision exists.
- Provider keys server-side only.
- Search job budgets and concurrency caps required.

---

# 24. FIRST CLAUDE BUILD ORDER FOR MARKET MINER

## M0 — Source/terms audit

Before coding adapters, Claude documents for each intended provider:

- official API or method;
- allowed data;
- storage/retention limits;
- rate limits;
- authentication;
- cost model;
- failure mode.

No scraping implementation until source method is approved.

## M1 — Geography database

Import Census state/county/place/ZCTA/CBSA geography.

Build search-cell generator.

Test:

- Jacksonville city;
- St. Johns County;
- Florida ZCTAs;
- 50-mile radius around Jacksonville.

## M2 — Mining job + provider interfaces

Define stable interfaces and queue/status models.

Use a fake provider for tests.

## M3 — First business discovery provider

Implement one approved source end-to-end.

Goal: discover HVAC businesses across a test territory without calling them.

## M4 — Identity resolver / dedupe

Test with deliberately duplicated records from multiple searches.

## M5 — Website resolver/crawler

Independently confirm domain, phone, services, geography and extract CTA/system signals.

## M6 — Canonical score

Implement Module 4C fixtures exactly.

## M7 — Google ad evidence adapter

Add approved current-source method.

## M8 — Meta ad evidence adapter

Add only after confirming a compliant access method for the target ad class/region.

## M9 — Opportunity/offer classifier

Generate primary/backup YAD offer hypotheses and hook family.

## M10 — Human sales queue

Create usable ranked output for salespeople.

This milestone should produce value before Twilio integration.

## M11 — Replenishment controller

Maintain target inventory and territory saturation metrics.

## M12 — Twilio handoff contract

Only now hand `READY_CALL_QUEUE` prospects to the downstream compliance/call system.

---

# 25. ACCEPTANCE TEST — FIRST REAL MILESTONE

Without calling anyone, YAD should be able to request:

> HVAC, Jacksonville + St. Augustine, Florida, Tier B+, 100 prospects.

The system should return a deduplicated ranked list where every prospect has:

- canonical company identity;
- independently verified website/phone where available;
- geography;
- evidence-backed score;
- research completeness;
- ad status as Yes/Unknown, never fabricated No;
- website/CTA findings;
- CRM/system signals clearly labeled as signals;
- primary/secondary opportunity hypothesis;
- primary/backup hook;
- evidence source/timestamp;
- no contact attempt.

A human should be able to inspect ten randomly selected prospects and understand exactly why each was ranked where it was.

That is the first true proof that the outbound brain has a reliable supply chain.
