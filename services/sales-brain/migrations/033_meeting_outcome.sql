-- 033_meeting_outcome.sql — recording what happened at a meeting.
--
-- attended_state existed from 011 and nothing ever wrote it, so the Completed tab was
-- permanently empty and the funnel's attended stage was permanently zero: a number
-- that could only ever be zero, printed beside numbers that could not.
--
-- The outcome is still never inferred from the clock. A meeting whose time has passed
-- has not been attended; it has only passed, and only a person who was there can say
-- which. This activity type is what a person saying so looks like.
--
-- Deliberately not added to the activity types prospect_inventory counts as contact:
-- recording an outcome is not another attempt to reach the prospect.

alter table activities drop constraint if exists activities_activity_type_check;
alter table activities add constraint activities_activity_type_check
  check (activity_type in ('DISCOVERED','RESEARCHED','SCORE_CHANGED','CONTACT_ENRICHED',
                           'CLAIMED','RELEASED','REASSIGNED','CALL_ATTEMPT','VOICEMAIL',
                           'EMAIL_SENT','EMAIL_REPLY','FIELD_VISIT','CALLBACK_REQUESTED',
                           'MEETING_SCHEDULED','MEETING_BOOKING_FAILED','MEETING_OUTCOME',
                           'DNC','WRONG_ENDPOINT','NOTE','OPPORTUNITY_CREATED','IMPORTED'));
