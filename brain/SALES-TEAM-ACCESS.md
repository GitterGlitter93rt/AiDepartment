# YAD Sales Team Access — Brain State

**Status:** Architecture defined; implementation owned by Claude Code  
**Updated:** 2026-09-03

## Business requirement

YAD salespeople need direct access to researched people/companies to call and email now. Autonomous Twilio cold calling is a later downstream capability.

Near-term product chain:

`Market Miner`
-> `research/dedupe/score`
-> `decision-maker/contact enrichment`
-> `Sales Team Access`
-> `human calls + direct email + Smartlead`
-> `shared Account memory`
-> `callbacks/meetings/opportunities`
-> `later approved AI voice`.

## Current implementation authority

Start with:

`docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`

Supporting specs:

- `outbound-sales-brain-sales-team-prospect-access-spec.md`
- `outbound-sales-brain-sales-team-rbac-permissions-spec.md`
- `outbound-sales-brain-prospect-worklist-contract.v1.yaml`
- `outbound-sales-brain-sales-team-access-fixtures.v1.yaml`
- `outbound-sales-brain-sales-team-access-mvp-acceptance.md`
- `outbound-sales-brain-sales-team-ui-wireframe-spec.md`
- `outbound-sales-brain-rep-prospect-card-fixtures.v1.yaml`
- `outbound-sales-brain-contact-waterfall-spec.md`
- `outbound-sales-brain-manager-list-request-contract.v1.yaml`
- `outbound-sales-brain-human-assist-workflow.md`
- `outbound-sales-brain-human-assist-daily-brief-spec.md`
- `outbound-sales-brain-smartlead-sync-spec.md`
- `outbound-sales-brain-multichannel-coordination-spec.md`
- `market-miner-lead-import-export-spec.md`

## Rep queues

- Call Now
- Email Now
- Call + Email
- Follow-Up / Callbacks

## What a rep sees

- company
- market/vertical
- Tier/score
- advertiser evidence
- research freshness
- target role / named decision-maker when verified
- phone/email + endpoint quality
- primary hypothesis
- primary/backup hook
- first question
- do-not-claim warnings
- prior contact history
- owner
- next action.

## Contact enrichment doctrine

Find the person/role that owns the business problem, not owner-only.

Waterfall:

1. first-party website/team information
2. licensed business/contact source such as Apollo
3. approved public professional/business evidence
4. verified main business line + correct role route
5. gatekeeper/prospect supplied correction/referral

A verified business number + correct target role is better than a fabricated named contact.

Do not fabricate email patterns/direct numbers.

## Work package example

Manager should be able to request:

> Brent — 50 Jacksonville HVAC Tier A/B advertisers — Call + Email

System resolves inventory, mines/researches shortfall if needed, removes suppression/client/opportunity conflicts, verifies channel endpoints, ranks prospects, previews shortfall, then assigns the package.

Never lower quality criteria silently to fill quota.

## Smartlead

Smartlead remains email execution, not canonical prospect database.

Smartlead events sync back to Account memory:

- send
- bounce
- reply
- unsubscribe
- correct-person referral
- sequence state.

Positive reply should block contradictory generic cold outreach and create human follow-up/ownership.

## Ownership

One canonical Account cannot be unknowingly worked cold by multiple reps simultaneously.

Account leases/ownership, prior touches, callbacks, DNC, opportunities and client status survive:

- source changes
- imports
- vertical changes
- Smartlead
- phone
- field visits
- later Twilio.

## Critical suppression rules

- reps can record DNC immediately
- ordinary reps cannot remove DNC
- suppressed Accounts do not appear in actionable exports/queues
- active clients do not appear in generic cold lists
- active opportunities do not appear in generic cold lists

## First acceptance

After Market Miner produces trustworthy inventory, test with at least two reps and 25–50 approved Jacksonville/St. Augustine HVAC prospects.

Pass only if:

- reps can work call/email lists simultaneously without duplicate ownership
- contact endpoint quality is visible
- prospect prep is fast
- dispositions/callbacks are durable
- DNC works immediately
- Smartlead replies affect canonical Account state
- manager can assign/reassign work
- shared history works
- mobile interface is usable
- no side spreadsheet is required for ownership/history.

## Development rule

ChatGPT designs architecture/specification.

Claude Code implements/tests locally on the EdgeXpert.

Do not re-enable automatic GitHub Actions.

Do not merge without explicit review/request.

Do not let Sales Team Access depend on autonomous Twilio implementation.