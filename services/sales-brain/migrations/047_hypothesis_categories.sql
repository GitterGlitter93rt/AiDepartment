-- The four categories the profiles use and the schema had nowhere to put.
--
-- `intake`, `capacity`, `governance` and `repetitive_admin` describe materially
-- different business problems, and the generator was filing all four as 'other'
-- while keeping the author's word in `source_category`. That is a lossy collapse:
-- analytics, ranking and any future learning could see four different problems only
-- as "other", and a call pack could not tell an intake problem from an admin one.
--
-- Extended rather than replaced, so every row already written stays valid. The
-- reconciliation below promotes the rows that were collapsed, using the author's own
-- category, and touches nothing else: a row that is genuinely 'other' has no
-- source_category naming one of these.
alter table opportunity_hypotheses drop constraint if exists opportunity_hypotheses_category_check;
alter table opportunity_hypotheses add constraint opportunity_hypotheses_category_check
  check (category in (
    'missed_call','after_hours','speed_to_lead','follow_up','unsold_estimate',
    'crm_workflow','attribution','website_conversion','paid_acquisition',
    'reactivation','employee_capacity','reporting','integration',
    'appointment_no_show','customer_communication',
    -- New, and each one a problem a rep would describe differently on a call.
    'intake','capacity','governance','repetitive_admin',
    'other'));

-- Promote what was collapsed. `source_category` was added in 045 precisely so this
-- could be done later without re-deriving anything.
update opportunity_hypotheses
   set category = source_category
 where category = 'other'
   and source_category in ('intake','capacity','governance','repetitive_admin');
