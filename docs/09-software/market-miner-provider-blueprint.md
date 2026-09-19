# Your AI Department — Market Miner Provider Blueprint

**Status:** Architecture decision record  
**Date:** 2026-09-02  
**Scope:** Data sources for advertiser-first prospect discovery and enrichment  
**Implementation owner:** Claude Code  
**Important:** Revalidate provider pricing/terms immediately before implementation because external services change.

---

# 1. PROVIDER STRATEGY

The Market Miner should not depend on one source.

The recommended V1 source hierarchy is:

1. **Google paid-search SERP evidence** — primary advertiser discovery signal.
2. **Business's own website** — primary durable research/enrichment source.
3. **Licensed business/contact data** — owner/role/contact enrichment.
4. **Google Ads Transparency evidence** — advertiser confirmation and additional context.
5. **Google Places/Maps-style discovery** — gap filling, business identity, geographic coverage; not the primary advertiser source.
6. **Meta advertising evidence** — secondary cross-platform qualification signal.
7. **Public licensing/business registries** — independent identity/category verification where useful.

The goal is not to create the biggest database. The goal is to create the highest-quality ranked call queue.

---

# 2. PRIMARY BULK GOOGLE PROVIDER — DATAFORSEO

## Recommended role

Use DataForSEO as the default V1 bulk Google SERP provider, subject to final account/terms review.

Reasons:

- location-specific Google SERP tasks;
- Google paid and organic result support;
- dedicated Google Ads Search SERP product;
- Google Ads Advertisers data based on Ads Transparency;
- local-services SERP elements appear in its advanced SERP schema;
- queue-based bulk collection is appropriate because prospect mining is asynchronous;
- pay-as-you-go pricing is materially cheaper than per-search subscription providers at scale.

Official references as of 2026-09-02:

- https://docs.dataforseo.com/v3/serp-google-organic-overview/
- https://docs.dataforseo.com/v3/serp-google-ads_advertisers-overview/
- https://dataforseo.com/pricing/serp/google-ads-search-serp-api
- https://dataforseo.com/pricing/serp/google-ads-advertisers-serp-api

## V1 endpoints/roles

### Google Ads Search SERP

Primary answer to:

> Which advertisers are showing for this high-intent keyword in this geography now?

Store each result as an `AdObservation`, not as a permanent claim that the company always advertises.

### Google Organic SERP / advanced SERP

Use when the system needs the whole search page structure, including paid elements, local elements, organic results, and local-services elements supported by the response schema.

Useful for:

- comparing advertiser vs organic visibility;
- detecting local-services result blocks;
- identifying company domains;
- discovery gap filling.

### Google Ads Advertisers / Transparency-derived data

Use as confirmation/context after a business has been identified.

It does not replace live high-intent SERP observation.

## Cost posture

As of 2026-09-02, DataForSEO publishes a Standard Queue base price of roughly $0.0006 per Google Ads Search SERP task and similar base pricing for Google Ads Advertisers requests, with higher prices for faster priority/live modes.

This suggests an architecture where bulk mining uses Standard Queue, while rare urgent refreshes may use Priority/Live.

Do not hard-code these prices into application logic. Keep provider pricing/configuration in administration/config.

## Why asynchronous is preferred

A prospect list does not need to be generated in six seconds.

The miner should:

1. enqueue thousands of inexpensive searches;
2. collect them asynchronously;
3. deduplicate advertisers;
4. perform deeper research only on unique candidates.

This keeps cost far below running premium live searches for every request.

---

# 3. SECONDARY GOOGLE PROVIDER — SERPAPI

## Recommended role

Use SerpApi as:

- fallback SERP provider;
- targeted validation source;
- debugging source;
- Local Services Ads / local sponsored result parser where it provides richer or simpler structured data;
- development accelerator when a specific Google result block is easier to consume through SerpApi.

Official references:

- https://serpapi.com/google-ads-api
- https://serpapi.com/google-ads-local-results
- https://serpapi.com/google-local-services-api
- https://serpapi.com/pricing

## Strength

SerpApi exposes clear objects such as `local_ads` for sponsored local businesses, including fields that may contain:

- title;
- service area;
- hours;
- phone;
- rating;
- business type.

This makes it attractive for Local Services Ads validation.

## Cost posture

As of 2026-09-02, published SerpApi plans are subscription/search-quota based and are substantially more expensive per search than DataForSEO bulk Standard Queue pricing.

Therefore:

- do not make SerpApi the only bulk source by default;
- use it strategically where its result parsing adds value;
- keep it behind the same provider interface so it can replace DataForSEO if reliability/business terms justify doing so.

---

# 4. GOOGLE PLACES API — GAP FILLER, NOT ADVERTISER DETECTOR

Official Google Text Search (New) can search categories/businesses with geographic bias/restriction.

Reference:

- https://developers.google.com/maps/documentation/places/web-service/text-search

Useful roles:

- find businesses missed by advertiser searches;
- resolve business identity;
- obtain a Google Place ID;
- cover non-advertisers when campaign strategy expands beyond active advertisers.

Important design constraints:

- Text Search does not establish current paid-ad activity;
- identical requests are not guaranteed to return identical result sets;
- Text Search has practical result limits, so search-cell decomposition is still required;
- Places data is subject to Google Maps Platform policies and caching/storage rules.

Architecture rule:

Use Google Place ID as a durable source identifier where allowed, then independently obtain durable prospect facts from the company's website/licensed/public sources.

Do not make Google Places content the permanent canonical YAD business database without confirming field-specific retention rights.

---

# 5. FIRST-PARTY WEBSITE — PRIMARY DURABLE INTELLIGENCE SOURCE

Once a domain is resolved, the company's own public website should be one of the most important sources.

Research should collect:

- company identity;
- phone;
- locations/service area;
- services;
- hours/24-7;
- financing/offers;
- contact/quote/booking flows;
- leadership/decision-maker clues;
- analytics/ad tags;
- call tracking;
- CRM/field-service frontend signals;
- chat/booking/forms;
- campaign landing pages.

The website is where the system transitions from:

> “This company appeared in an ad.”

to:

> “Here is the business process worth asking about.”

Direct site crawling should obey robots/terms and reasonable request rates.

No fake form submissions.

---

# 6. CONTACT / DECISION-MAKER ENRICHMENT — APOLLO OR LICENSED EQUIVALENT

YAD already uses Apollo in lead-generation workflows, so design a provider adapter around a licensed contact source rather than hard-coding Apollo-specific fields everywhere.

Provider purpose:

- owner/founder;
- president;
- GM;
- operations manager;
- marketing manager;
- office manager;
- other vertical-specific stakeholders;
- business email/phone when included under the provider license.

Important:

- company identity should exist independently of the contact provider;
- provider records should carry source/license metadata;
- do not overwrite a prospect's direct public website facts with lower-confidence third-party data silently.

---

# 7. GOOGLE ADS TRANSPARENCY CONFIRMATION

The architecture should support two methods:

1. direct/manual browser verification where appropriate;
2. provider API derived from Ads Transparency, such as DataForSEO's Google Ads Advertisers API.

Purpose:

- confirm advertiser identity;
- see advertising evidence not captured in one sampled live SERP;
- strengthen current advertiser confidence.

Do not use transparency evidence to infer:

- spend;
- ROAS;
- profitability;
- lead volume.

---

# 8. META AD EVIDENCE

Meta should remain a secondary qualifier in V1.

Preferred provider hierarchy:

1. officially supported Meta API for the relevant ad class/region if available;
2. reviewed licensed ad-intelligence provider;
3. browser-assisted human review;
4. unknown.

Do not build the core mining supply chain around an assumption that an unrestricted API exists for all U.S. commercial local-business ads.

If Meta cannot be checked automatically, store:

`meta_ad_status = UNKNOWN`

and continue.

A missing Meta signal must never block a strong Google advertiser from becoming Tier A/B.

---

# 9. PUBLIC LICENSE / BUSINESS REGISTRY ADAPTERS

Some verticals benefit from government/public registries.

Examples:

- contractor licenses;
- professional licenses;
- state business entity records;
- healthcare provider/public facility registries where appropriate.

Use cases:

- independent identity verification;
- exclude obvious non-operating entities;
- classification;
- location verification;
- legal business name.

Do not add a registry merely because it exists. Every adapter must improve identity, fit, or contactability enough to justify maintenance.

---

# 10. OPTIONAL TECHNOLOGY-INTELLIGENCE PROVIDERS

V1 should begin with first-party detection rules on the website HTML/scripts/network references.

Optional future providers:

- BuiltWith;
- Wappalyzer or licensed equivalent;
- dedicated domain technology APIs.

Use these only if they materially improve detection accuracy/cost.

Even a high-confidence technology provider does not prove workflow configuration.

`ServiceTitan detected` is still different from `every lead is automatically worked in ServiceTitan`.

---

# 11. PHONE / LINE-TYPE ENRICHMENT

This belongs immediately before compliance/calling, not early advertiser mining.

Provider abstraction may use:

- Twilio Lookup;
- another telecom lookup provider.

Purpose:

- line type;
- carrier/number intelligence where policy requires it;
- normalization/validation.

Do not spend line-type lookup money on thousands of Tier D prospects that will never be called.

---

# 12. PROVIDER ROUTING MATRIX

| Need | Preferred V1 source | Fallback | Persist? |
|---|---|---|---|
| U.S. geography | Census | configured geography dataset | Yes |
| Google search advertisers | DataForSEO Ads Search SERP | SerpApi Google Ads | Observation + source metadata |
| Local Services Ads | DataForSEO full/advanced SERP where supported | SerpApi local ads/LSA | Observation + source metadata |
| Google advertiser confirmation | DataForSEO Ads Advertisers | manual Ads Transparency review | Evidence snapshot/minimal fields |
| Non-ad business discovery | Google Places / SERP local results | licensed directory/public registry | Follow source-specific retention rules |
| Durable company facts | Company website | licensed business source | Yes |
| Website technology | first-party detector | tech provider | Yes as observed evidence |
| Decision maker | company website + Apollo | licensed equivalent | Per license |
| Meta active ads | approved Meta/provider method | manual review | Observation/minimal evidence |
| Business/license verification | public registry | none | Yes where public terms permit |
| Line type | telecom lookup | alternate telecom provider | Minimal compliance record |

---

# 13. PROVIDER FAILOVER RULE

No provider outage should cause the AI to invent a fact.

Example:

DataForSEO unavailable:

- switch queued Google search jobs to configured fallback if budget allows;
- otherwise mark ad research incomplete;
- do not mark prospect “not advertising.”

Apollo unavailable:

- company can still be researched/scored;
- decision-maker remains unknown;
- human/phone agent can ask for the correct role.

Meta unavailable:

- leave Meta unknown;
- do not penalize as a confirmed negative.

---

# 14. COST CONTROL POLICY

The system must track:

- provider cost per task;
- cost per unique business discovered;
- cost per research-complete prospect;
- cost per Tier A/B prospect;
- eventually cost per qualified conversation and meeting.

Use cheap bulk discovery before expensive enrichment.

Suggested V1 order:

1. paid SERP search;
2. dedupe advertiser/domain;
3. website crawl;
4. preliminary score;
5. deeper advertiser/contact/system enrichment only for plausible targets.

Every mining job gets a hard budget ceiling.

---

# 15. INITIAL ARCHITECTURAL DECISION

For advertiser-first HVAC mining, Claude should prototype this path first:

`Census geography`

-> `DataForSEO Standard Queue Google Ads/Search SERPs`

-> `advertiser/domain dedupe`

-> `company website research`

-> `canonical YAD scoring`

-> `targeted Google Transparency validation where useful`

-> `Apollo/website decision-maker enrichment`

-> `optional Meta evidence`

-> `ranked human sales queue`

Only after this supply chain is proven should Claude connect eligible prospects to Twilio.
