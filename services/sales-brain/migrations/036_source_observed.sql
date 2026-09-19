-- 036_source_observed.sql — a company can be found twice by different means.
--
-- upsertAccount wrote its DISCOVERED provenance activity only in the branch that
-- creates an Account. A company already in inventory from the Apollo purchased
-- import, then found independently by the discovery provider, recorded nothing
-- durable about that second sighting: it survived only in search_observations, which
-- is transient retention and gets swept.
--
-- The second source fact matters. "We bought this name and a provider also finds them
-- advertising in that market" is a stronger prospect than either fact alone, and an
-- operator asking where a company came from deserves both answers.
--
-- Deliberately NOT reusing DISCOVERED: the "discovered by miner today" KPI counts
-- DISCOVERED activities, and reusing it here would re-inflate the exact number that
-- was fixed by counting provenance in the first place.
--
-- Deliberately NOT added to the activity types prospect_inventory counts as contact:
-- observing a company in a search is not an attempt to reach them.

alter table activities drop constraint if exists activities_activity_type_check;
alter table activities add constraint activities_activity_type_check
  check (activity_type in ('DISCOVERED','RESEARCHED','SCORE_CHANGED','CONTACT_ENRICHED',
                           'CLAIMED','RELEASED','REASSIGNED','CALL_ATTEMPT','VOICEMAIL',
                           'EMAIL_SENT','EMAIL_REPLY','FIELD_VISIT','CALLBACK_REQUESTED',
                           'MEETING_SCHEDULED','MEETING_BOOKING_FAILED','MEETING_OUTCOME',
                           'SOURCE_OBSERVED',
                           'DNC','WRONG_ENDPOINT','NOTE','OPPORTUNITY_CREATED','IMPORTED'));

-- The lookup that stops one company being re-observed a thousand times by the same
-- source in a day.
create index if not exists activities_source_observed_idx
  on activities (account_id, source_system, occurred_at desc)
  where activity_type = 'SOURCE_OBSERVED';
