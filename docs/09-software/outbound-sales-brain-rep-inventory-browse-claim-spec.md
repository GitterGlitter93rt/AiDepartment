# YAD Sales Brain — Rep Inventory Browse / Search / Claim Specification

**Status:** Near-term product authority  
**Implementation owner:** Claude Code on EdgeXpert  
**Primary user:** YAD sales representatives and sales managers  
**Design intent:** Reps browse a continuously researched company inventory, search markets/ZIP codes on demand, and claim Accounts to themselves. Do not make a forced daily queue the primary interaction model.

---

# 1. PRODUCT MODEL

The EdgeXpert runs Market Miner and enrichment workers continuously.

Those workers create and refresh a shared prospect inventory:

`Market Miner`
-> `Canonical Accounts`
-> `Evidence / website / ad research`
-> `Contacts`
-> `YAD fit score`
-> `Advertiser evidence strength`
-> `Research completeness`
-> `Opportunity hypothesis`
-> `UNCLAIMED shared inventory`.

Sales reps consume this inventory through a web application.

The primary rep workflow is:

`Find Prospects`
-> `search/filter existing inventory`
-> `optionally request more mining for a geography`
-> `inspect prospects`
-> `select one or many`
-> `Claim to Me`
-> `My Prospects`
-> `call / email / Smartlead / follow up`
-> `shared Account history`.

The system may still calculate priority/rank, but it should not force reps to work a black-box queue.

---

# 2. EDGE XPERT 24/7 INVENTORY MODEL

EdgeXpert should continuously maintain prospect inventory in approved markets.

Examples:

- Jacksonville HVAC advertisers;
- St. Augustine HVAC advertisers;
- Jacksonville plumbers;
- Jacksonville roofers;
- St. Augustine businesses with no verified website;
- Florida PI law firms;
- other approved campaigns.

Inventory is durable in PostgreSQL. It must not exist only in worker memory or local temporary files.

Each market/campaign stores:

- target geography;
- vertical/profile;
- mining mode;
- desired inventory depth;
- last discovery run;
- last refresh run;
- unique Accounts discovered;
- research-complete Accounts;
- unclaimed Accounts;
- claimed Accounts;
- suppressed Accounts;
- stale Accounts;
- saturation state;
- next refresh/mining action.

If EdgeXpert restarts, workers resume from durable job/state records.

---

# 3. TWO WAYS A REP FINDS PROSPECTS

## A. Browse precompiled inventory

The default and fastest path.

A rep can browse saved markets such as:

- Jacksonville HVAC — Google advertisers;
- St. Augustine HVAC — Google advertisers;
- Jacksonville Roofing — advertiser-first;
- St. Augustine Local Businesses — no verified website.

The app returns already researched Accounts immediately.

## B. Search a geography on demand

The rep can enter:

- ZIP/ZCTA;
- city;
- county;
- state;
- radius;
- industry;
- mining mode.

Example:

> HVAC + 32256 + advertiser-first

The API first searches the existing canonical inventory.

If sufficient fresh inventory exists, return it immediately.

If coverage is incomplete or stale, offer/start a Market Miner job for the missing coverage.

The UI must distinguish:

- `Already Researched`
- `Research Refreshing`
- `New Market Mining`

Do not make the rep wait for mining before showing already available results.

---

# 4. PRIMARY FILTERS

The Find Prospects view should support at minimum:

## Geography

- ZIP/ZCTA;
- city;
- county;
- state;
- radius;
- saved market.

## Vertical

Use the versioned vertical-profile registry.

Initial architecture-ready profiles include HVAC, Plumbing, Roofing, Collision, Hail/PDR, Law, Real Estate, General Contractor/Remodeling, Electrical, Dental, Med Spa, Restoration, and Garage Door.

## Mining / source intent

- advertiser-first;
- advertisers-only;
- full-local-market;
- no-verified-website;
- weak-website;
- imported-list;
- other approved modes.

## Qualification

- Tier A;
- Tier B+;
- Tier C+;
- minimum manual score.

## Advertising

- current Google paid-search evidence;
- current Local Services Ad evidence;
- current Meta evidence;
- cross-channel advertiser;
- advertiser evidence strength.

## Contactability

- phone available;
- verified business phone;
- decision-maker known;
- business email available;
- phone + email;
- no usable contact yet.

## Ownership

- unclaimed only;
- mine;
- claimed by another rep;
- manager assigned.

## Research

- complete;
- good;
- partial;
- stale;
- refreshed within N days.

---

# 5. RESULT ROW / CARD

A rep should be able to understand a result without opening five screens.

Each search result should show:

- company name;
- city/state;
- vertical;
- Tier badge and manual score;
- advertiser-strength badge;
- Google/LSA/Meta icons only when evidence supports them;
- phone availability icon;
- email availability icon;
- best known decision-maker/role;
- one-line `Why This Prospect` summary;
- research freshness;
- ownership state;
- primary action: `Claim` or owner name.

Optional compact fields:

- primary advertised service;
- number of locations;
- 24/7/emergency signal;
- CRM/system signal.

Do not overload the result row with every research fact. Full evidence belongs in the Account detail drawer/page.

---

# 6. CLAIM-TO-ME BEHAVIOR

The core rep action is `Claim to Me`.

Claim means the rep becomes the responsible YAD owner for cold prospecting activity on that Account.

Claim must be atomic.

If Brent and another rep click Claim on the same unclaimed Account at the same time, exactly one succeeds.

The loser receives:

> Already claimed by [Rep Name].

No duplicate ownership is allowed.

## Supported claim actions

- Claim one Account;
- multi-select -> Claim Selected;
- claim top N from current filtered results, subject to configured limits;
- manager assign to rep.

## Claim record

Persist:

- account_id;
- owner_user_id;
- claimed_at;
- claim_source/search context;
- claim_actor;
- previous owner if reassigned;
- ownership_reason;
- audit event.

## Ownership visibility

Other sales reps may see that a company exists and who owns it, subject to RBAC, but they cannot cold-contact it through YAD workflows unless ownership is transferred/released.

---

# 7. PREVENT PROSPECT HOARDING

Claiming cannot become a way to lock hundreds of Accounts forever.

Use configurable management rules rather than hard-coded behavior.

Possible controls:

- maximum active cold-owned Accounts per rep;
- inactivity review after configurable period;
- automatic manager review for claimed Accounts with no activity;
- release uncontacted Accounts back to inventory;
- manager override/reassignment;
- no automatic release when there is a callback, positive reply, active opportunity, meeting, proposal, client relationship, or explicit follow-up commitment.

V1 recommendation:

- show the rep how many active cold-owned Accounts they have;
- warn before bulk claiming beyond manager-configured target;
- do not silently take an active relationship away from a rep.

---

# 8. MY PROSPECTS

Once claimed, the Account appears under `My Prospects`.

This is the rep's working book, not a forced ordered queue.

Rep can filter/sort by:

- newly claimed;
- not yet contacted;
- call available;
- email available;
- both available;
- callbacks due;
- follow-up due;
- positive reply;
- Tier;
- advertiser strength;
- city/ZIP;
- vertical;
- opportunity stage;
- last contact date.

Ranking may recommend what to work first, but reps retain a browsable book of business.

---

# 9. ACCOUNT DETAIL

Opening a company should expose a clean sales dossier.

## Header

- company;
- location;
- website;
- Tier / score;
- ownership;
- relationship status;
- Claim/Release/Reassign control according to RBAC.

## Contact panel

- best POC;
- role;
- phone(s);
- email(s);
- endpoint quality/source;
- one-click copy;
- call action when supported;
- email/Smartlead action when supported.

## Why this company

- primary business hypothesis;
- why it ranks highly;
- current ad evidence;
- advertised service/offer;
- website/funnel observations;
- decision-maker rationale.

## Sales guidance

- primary hook;
- backup hook;
- first question;
- likely objections;
- do-not-claim warnings.

## Evidence

Show supporting evidence and freshness without overwhelming the rep.

## Timeline

Unified history across:

- research refreshes;
- ownership changes;
- calls;
- emails;
- Smartlead;
- replies;
- field visits;
- assessments;
- meetings;
- proposals;
- later Twilio.

---

# 10. ON-DEMAND ZIP SEARCH FLOW

Example rep behavior:

1. Open `Find Prospects`.
2. Select HVAC.
3. Enter `32256`.
4. Select `Advertiser First`.
5. Select `Tier B+`.
6. Select `Unclaimed`.
7. Press Search.

System:

A. Query canonical inventory immediately.

B. Show all matching fresh results.

C. Check territory coverage/saturation metadata.

D. If coverage is incomplete or stale, show:

> 37 researched prospects available. Market Miner can continue researching this ZIP.

E. Authorized user can choose `Research More`.

F. Background job runs on EdgeXpert.

G. New Accounts appear incrementally without requiring a page refresh where practical.

The UI must never imply that a search found every possible business unless coverage rules actually support that conclusion.

---

# 11. PRECOMPILED MARKET LIBRARY

Create a `Markets` view.

Each market card shows:

- market name;
- geography;
- vertical;
- mining mode;
- total Accounts;
- Tier A;
- Tier B;
- unclaimed;
- claimed;
- phone+email available;
- current advertisers;
- research freshness;
- last mined;
- status: Active / Saturated / Refreshing / Paused.

Example cards:

> Jacksonville HVAC Advertisers  
> 186 researched | 72 unclaimed | 41 phone+email | refreshed today

> St. Augustine No-Website Businesses  
> 93 researched | 58 unclaimed | 47 phone | refreshed yesterday

A rep can click a market and immediately browse its Accounts.

---

# 12. MANAGER CONTROLS

Manager can:

- create/activate saved markets;
- set target inventory depth;
- pause mining;
- request research refresh;
- see prospect ownership by rep;
- bulk assign Accounts;
- reassign/release Accounts;
- see unworked claimed inventory;
- set optional per-rep active prospect targets;
- restrict exports;
- view contactability gaps;
- view research/provider health.

The manager should not need SQL or SSH to operate the sales inventory.

---

# 13. EMAIL + CALL AVAILABILITY

A claimed Account can be worked through one or more eligible channels.

Show clear badges:

- `CALL READY`
- `EMAIL READY`
- `CALL + EMAIL`
- `CONTACT RESEARCH NEEDED`
- `CALLBACK`
- `SUPPRESSED`

Channel eligibility depends on endpoint validity, suppression, relationship state, applicable policy, and current campaign rules.

Do not let the UI convert missing contact information into invented contact data.

---

# 14. SMARTLEAD

Smartlead is a downstream execution channel.

A rep/manager may add eligible claimed Contacts to an approved Smartlead campaign according to role/permissions.

The Account remains canonical in YAD.

Smartlead outcomes sync back:

- sent;
- delivered where available;
- bounced;
- reply;
- positive reply;
- unsubscribe;
- campaign state.

A positive reply changes YAD relationship state and should stop contradictory generic outreach.

---

# 15. SALES REP SEARCH IS NOT RAW SCRAPING

When a rep searches a ZIP, the browser must not directly scrape Google or websites.

The browser calls the YAD API.

The API queries durable inventory and, when authorized/needed, schedules Market Miner jobs on EdgeXpert.

Workers perform research through approved provider/site adapters.

This keeps:

- credentials server-side;
- costs controlled;
- deduplication centralized;
- source terms enforceable;
- rep experience fast;
- data shared company-wide.

---

# 16. HARD FAILS

Do not ship if:

- two reps can independently claim the same Account;
- Claim is only frontend state;
- rep can bypass ownership by changing URL/API params;
- DNC/suppressed company can be claimed for cold outreach;
- active client can appear as unclaimed cold inventory;
- active opportunity can be silently reclaimed;
- manager reassignment lacks audit trail;
- bulk claim can lock the entire database accidentally;
- ZIP search creates duplicate Accounts instead of resolving identity;
- a failed/stale research adapter is displayed as a negative business fact;
- reps need local spreadsheets to know what they own.

---

# 17. V1 ACCEPTANCE

With two test reps:

1. Load at least 30 synthetic/research-only Accounts.
2. Both reps search the same ZIP/vertical.
3. Both can browse the same unclaimed inventory.
4. Rep A claims 5.
5. Those 5 immediately show Rep A as owner to Rep B.
6. Rep B cannot claim/contact those 5 through YAD cold workflows.
7. Rep B claims different Accounts.
8. Manager can reassign one with an audit event.
9. Rep A can disposition/callback/email from My Prospects.
10. Ownership/history survive service restart.
11. New mining results enter shared inventory as unclaimed.
12. Search remains fast because it queries the database first rather than waiting for live mining.

---

# 18. CORE PRODUCT RULE

**EdgeXpert builds the inventory; sales reps choose and claim the territory/prospects they want to work.**

Prioritization should help a salesperson decide, not trap the salesperson inside an opaque queue.