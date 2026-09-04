# YAD Sales CRM — Page Data & Action Contract

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Define the minimum read models and server actions each CRM page should use so the UI remains consistent, testable and backed by canonical Account state.

---

# 1. RULE

Pages should consume purpose-built read models assembled from the canonical database. They should not rebuild business truth independently in the browser.

A page may cache or optimistically render non-sensitive presentation state, but authoritative results for ownership, DNC, channel eligibility, booking, stage transitions, imports, campaign state and settings writes come from the server.

---

# 2. SHARED READ MODELS

## AccountSummary

Use for tables/cards/search results.

Minimum fields:

- account_id
- display_name
- domain/website if known
- primary_location summary
- vertical
- tier + score
- owner summary
- relationship stage
- advertiser evidence summary
- best contact route summary
- primary hypothesis summary
- research freshness summary
- last touch
- next action
- channel status summary

Do not include raw provider payloads.

## AccountDetailView

Use only on Account Detail/quick drawer variants.

Includes:

- AccountSummary
- locations
- contacts
- endpoint quality/provenance
- evidence facts
- hypotheses
- score breakdown
- channel eligibility
- research freshness
- ownership history summary
- unified activity timeline
- prospect statements
- active tasks
- active opportunity summary
- meetings summary
- communication/campaign state

## TaskView

- task_id
- account/contact
- task_type
- reason
- due_at + timezone
- owner
- source interaction
- status
- allowed actions

## ReplyView

- reply/thread ID
- account/contact
- source channel
- message list
- relationship state
- owner
- opt-out/suppression impact
- recommended next step
- allowed actions

## OpportunityView

- opportunity_id
- account
- owner
- canonical stage
- problem summary
- confirmed workflow
- business-case inputs
- unknowns
- stakeholders
- next step
- meeting status
- source attribution
- value only if legitimate
- stage transition options returned by server

## MeetingView

- booking_id/provider_ref
- account/contact
- host
- event type
- start/end/timezone
- status
- meeting location/join link
- prep brief status/content ref
- source campaign/call
- reschedule/cancel capability

## MarketView

- market_id
- display name
- geography
- vertical
- status
- total researched
- unclaimed ready
- tier counts
- contactability counts
- DM route counts
- freshness
- replenishment summary
- recent research jobs
- rep-visible vs manager-only fields separated

## PilotCandidateView

- account summary
- selected target person/role
- endpoint
- contact route class
- primary hypothesis
- first question
- opener context preview
- research freshness
- immutable Call Pack ref/version
- AI voice eligibility result/reason/evaluated_at
- pilot selection state

## CallReviewView

- call metadata/outcome
- account/contact
- transcript ref/content where authorized
- recording ref where authorized
- state transitions
- tool actions/results
- latency timeline
- Call Pack snapshot
- extracted facts
- readiness decision
- QA score/hard failures
- root cause
- version snapshot

---

# 3. PAGE -> READ MODEL MAPPING

- `/` Overview -> KPI summaries + TaskView[] + AccountSummary[] + ReplyView[] + MarketView[]
- `/find` -> AccountSummary[] + search metadata + AccountQuickDrawer subset
- `/markets` -> MarketView[]
- `/markets/:id` -> MarketView + AccountSummary[] + research activity
- `/prospects` -> AccountSummary[] scoped to owner/permission
- `/accounts/:id` -> AccountDetailView
- `/follow-ups` -> TaskView[]
- `/replies` -> ReplyView[] + selected AccountSummary
- `/opportunities` -> OpportunityView[] compact
- `/opportunities/:id` -> OpportunityView full
- `/meetings` -> MeetingView[]
- `/ai/pilot` -> PilotCandidateView[] + PilotBatch/LiveCall summaries
- `/calls/:id` -> CallReviewView
- `/team` -> rep workload summaries + Account ownership rows
- `/mining` -> ResearchJobView[]
- `/research-health` -> data-quality metrics + exception rows
- `/imports` -> ImportRunView[] + source adapters
- `/campaigns` -> CampaignView[]
- `/analytics` -> AnalyticsReadModel
- `/settings` -> IntegrationStatusView + FeatureModeView + permission-scoped settings metadata

---

# 4. SERVER ACTIONS

All actions return a structured result with at minimum:

- request_id
- status: confirmed | denied | failed | needs_input | pending
- reason/code
- updated resource summary when appropriate
- audit reference for sensitive actions

## Ownership

- claim_account(account_id)
- claim_accounts(account_ids[])
- release_account(account_id, reason)
- assign_account(account_id, user_id, reason)
- reassign_account(account_id, user_id, reason)

Server re-checks current ownership and protected relationship state.

## Prospect/Account

- refresh_account_research(account_id)
- mark_endpoint_wrong(endpoint_id, reason)
- add_or_update_contact(...)
- add_note(account_id, text)
- log_manual_call(...)
- log_disposition(...)

## Follow-Up

- create_followup(account_id, contact_id?, type, due_at, timezone, reason)
- complete_followup(task_id, outcome)
- reschedule_followup(task_id, due_at, timezone, reason)
- cancel_followup(task_id, reason)

## Replies / communication

- create_email_draft(thread/account, template/context)
- send_approved_email(draft_id) only if policy/permission allows
- mark_no_need(account_id, reason)
- apply_optout_or_dnc(scope, source, reason)

## Opportunity

- create_opportunity(account_id, problem_summary, source)
- transition_opportunity(opportunity_id, target_stage, reason/context)
- close_lost(opportunity_id, reason)
- close_won(opportunity_id, approved_fields)

No browser-only drag/drop stage mutation.

## Meetings

- check_strategy_call_availability(...)
- book_strategy_call(...)
- reschedule_booking(...)
- cancel_booking(...)

UI says confirmed only when provider result is confirmed.

## Market/Research

- request_market_research(market/geography/vertical/mode)
- refresh_market(market_id)
- retry_research_job(job_id)
- cancel_research_job(job_id)

Existing inventory remains usable during jobs.

## Imports

- create_import_session(source)
- upload_import_file
- set_import_mapping
- preview_import_normalization
- confirm_import
- retrieve_import_results

Confirm import does not schedule outreach.

## Sales AI Pilot

- add_pilot_candidate(account_id)
- remove_pilot_candidate(account_id)
- run_pilot_preflight(account_id)
- start_next_pilot_call(batch_id, account_id)
- pause_after_current_call(batch_id)
- stop_new_outbound_calls(reason)

Adding candidate never dials.

## Settings

- update_feature_mode(...)
- update_integration_configuration(...)
- test_integration_connection(...)

Secrets are write-only/masked after storage.

---

# 5. ACTION BUTTON RULE

Buttons are rendered from a combination of:

1. page role/permission;
2. server-returned resource capability;
3. current relationship/channel state.

Example:

A rep may own an Account but still receive:

`call_capability = BLOCKED_DNC`

The UI must show the block and not expose an enabled Call action.

The backend still rejects the action if manually invoked.

---

# 6. CONSISTENCY REQUIREMENT

When the same Account appears in Find Prospects, My Prospects, Replies, Opportunities, Meetings, Team or Pilot, all surfaces must resolve identity/owner/relationship state from the same canonical Account read model or compatible projection.

No page-specific shadow truth.

---

# 7. EVENTUAL CONSISTENCY UX

For asynchronous writes/research:

- show `pending` only when server accepted work;
- keep prior confirmed data visible;
- refresh or stream updates when practical;
- never substitute optimistic UI for confirmed ownership/DNC/booking results.

---

# 8. CORE ACCEPTANCE

The browser should be replaceable without losing truth. A malicious or stale client must not be able to:

- steal ownership;
- bypass suppression;
- manufacture a direct decision-maker endpoint;
- mark a booking confirmed;
- promote an opportunity illegally;
- expose provider secrets;
- dial from a blocked Account;
- reset cadence/history by rediscovering the company.
