# YAD Sales Brain — Sales Portal Product Metrics Specification

**Status:** Product/analytics authority  
**Implementation owner:** Claude Code  
**Purpose:** Measure whether the rep portal improves sales productivity, prospect quality and coordination — not merely whether it generates large lists.

---

# 1. NORTH STAR

The Sales Portal should help YAD produce more **qualified business conversations and opportunities per rep-hour** with less manual research and less duplicate/conflicting outreach.

Do not optimize for raw leads generated, raw dials, or raw emails alone.

---

# 2. CORE FUNNEL

Track the human-assist funnel:

`Prospect available`
→ `Claimed`
→ `First touch`
→ `Decision maker reached / meaningful reply`
→ `Qualified conversation`
→ `Meeting / strategy next step`
→ `Opportunity`
→ `Proposal`
→ `Closed Won / Lost / Disqualified`

Each stage requires explicit evidence/event, not rep intuition alone.

---

# 3. REP PRODUCTIVITY METRICS

Track by rep and period:

- prospects claimed
- claimed but untouched
- first touches
- calls attempted
- emails sent
- decision makers reached
- meaningful conversations
- positive replies
- callbacks requested
- meetings scheduled
- qualified opportunities
- proposals
- wins/losses/disqualifications
- overdue follow-ups

Useful conversion rates:

- first touch / claimed
- DM reached / call attempts
- meaningful conversation / DM reached
- positive reply / emails sent
- meeting / qualified conversation
- opportunity / meeting

Do not use raw activity as the only performance measure.

---

# 4. RESEARCH VALUE METRICS

Measure whether the Prospect Factory is actually useful:

- research-complete rate
- contact-ready rate
- decision-maker-known rate
- rep correction rate
- wrong-number rate
- hard-bounce rate
- public-fact correction rate
- hook/hypothesis usefulness rating if collected
- time from Account open to first touch

High correction/error rates should trigger source/research review.

---

# 5. SOURCE / MARKET METRICS

Compare by discovery source:

- Google advertiser miner
- Google Places/gap fill
- Apollo/import
- rep-created/imported list
- no-website miner
- referral/manual

Track:

- unique Accounts
- Tier A/B yield
- contact-ready yield
- decision-maker yield
- claim rate
- DM reach rate
- meaningful conversation rate
- meeting rate
- opportunity rate
- cost per research-ready Account
- cost per Tier A/B
- cost per usable contact
- eventually cost per meeting/opportunity

This lets YAD objectively compare the salesman's Airtable-style list, Google advertiser miner and Apollo instead of debating which “feels” better.

---

# 6. ADVERTISER SIGNAL METRICS

Track advertiser evidence cohorts separately:

- Google Search only
- LSA only
- Google Search + LSA
- Meta only
- multi-channel
- no current paid-ad evidence / other source

Compare downstream outcomes without inferring spend.

Question to answer:

> Do repeatedly observed high-intent Google advertisers create more qualified conversations for YAD than ordinary local-business lists?

---

# 7. TIER PERFORMANCE

Track canonical Tier A/B/C/D outcomes.

Do not change the manual score based on performance analytics.

Instead measure:

- DM reach by Tier
- qualified conversation by Tier
- meeting by Tier
- opportunity by Tier
- win by Tier

If Tier B outperforms Tier A in a market, investigate why before changing doctrine.

---

# 8. HYPOTHESIS / HOOK METRICS

Track the primary hypothesis/hook category used:

- missed call / after-hours
- speed to lead
- unsold estimate/proposal
- CRM automation
- attribution
- employee capacity
- reactivation
- website/conversion
- reporting
- no-show/scheduling
- other approved category

Measure:

- meaningful conversation rate
- qualification rate
- meeting rate
- objection rate

The Learning Brain may propose changes but V1 must not autonomously rewrite production sales doctrine.

---

# 9. PORTAL ADOPTION METRICS

Track product usability:

- active reps/day/week
- searches per rep
- Saved Markets viewed
- claims per rep
- percentage of claimed Accounts worked within threshold
- average time from claim to first touch
- percentage of interactions recorded in portal
- percentage of sales activity still tracked outside portal if known

Goal: eliminate the need for private spreadsheets, not simply add another screen.

---

# 10. OWNERSHIP / COORDINATION METRICS

Track:

- claim conflicts
- manager reassignments
- stale claims
- Accounts released
- duplicate-contact attempts prevented
- positive-reply conflicts prevented
- DNC blocks
- active-opportunity cold-outreach blocks

A low conflict rate because the system blocks conflicts is positive; a low recorded rate because conflicts happen outside the system is not.

---

# 11. FOLLOW-UP QUALITY

Track:

- requested callbacks completed on time
- overdue callbacks
- positive replies responded to
- meetings missed/rescheduled
- follow-up tasks completed

Requested prospect commitments should receive more weight than generic cold activity.

---

# 12. MANAGER DASHBOARD

Managers should be able to compare:

## Team

- active Accounts
- meaningful conversations
- meetings
- opportunities
- overdue commitments

## Markets

- ready inventory
- claim velocity
- Tier A/B yield
- research cost
- meeting/opportunity yield

## Sources

- Google advertiser miner
- Apollo/import
- other cohorts

## Quality

- wrong phone
- bounce
- rep corrections
- DNC rate

Do not turn the dashboard into a leaderboard of dials.

---

# 13. TIME SAVED — OPTIONAL MEASURE

Where feasible, compare:

- average manual research time before portal
- time to understand Account in portal
- time from market search to first touch

Avoid invented dollar-value claims unless based on real internal data.

---

# 14. EXPERIMENTATION

A/B tests may compare approved variants such as:

- advertiser-first vs generic business lists
- hook A vs hook B
- email personalization variants
- different research-depth thresholds

Experiment must define:

- cohort
- success metric
- stop condition
- sample limitations
- no silent doctrine change.

---

# 15. DATA QUALITY

Analytics events require:

- event_id
- account_id where relevant
- actor/rep
- source/campaign/market
- timestamp
- event type
- relevant version IDs (score/profile/hook/prompt where applicable)

Use idempotency to avoid double-counting retries.

---

# 16. HARD FAILS

Implementation fails if:

- a dial is counted as a meaningful conversation;
- a copied email address is counted as sent;
- opening a prospect card counts as contact;
- source attribution disappears after Account merge;
- duplicate events inflate metrics;
- manual score is overwritten by learned performance score;
- manager sees only raw activity and cannot see quality/conversion.

---

# 17. INITIAL QUESTIONS YAD SHOULD ANSWER

Within first weeks of real rep usage, system should be able to answer:

1. Which source creates the highest qualified-conversation rate?
2. Do Google advertisers outperform generic business lists?
3. Which vertical/market creates the highest meeting rate?
4. Which hook categories work best by vertical?
5. How often is research wrong enough for reps to correct it?
6. Which provider produces the best usable decision-maker contacts?
7. Are reps actually working the Accounts they claim?
8. Are callbacks/positive replies being handled on time?
9. Is the portal reducing duplicate outreach?
10. What should EdgeXpert mine more of next?

---

# 18. CORE RULE

The Sales Brain should learn from real sales outcomes, but the first objective is not “generate more leads.” It is **give reps better prospects, better context and better coordination that produces more qualified opportunities per unit of human effort.**