-- The conditions under which there is no sale here, in the vertical's own words.
--
-- Every profile declares `no_sale_conditions` -- a roofing company that demands
-- guaranteed sales, a prospect whose primary goal is replacing staff, a
-- communication plan that would not be compliant -- and nothing read the section.
-- The call brain already knows how to stop: the state machine records NOT_A_FIT and
-- a grader checks the exit was respectful. What it never had was the list of what
-- counts as no sale in this trade.
--
-- Stored on the pack rather than read live at call time, for the same reason
-- `prohibited_claims` is: a pack is the immutable record of what the agent was
-- allowed to say, and a profile edited afterwards must not change what a past call
-- is judged against.
alter table call_packs
  add column if not exists no_sale_conditions jsonb not null default '[]'::jsonb;
