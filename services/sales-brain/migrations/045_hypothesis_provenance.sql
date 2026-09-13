-- Which declared hypothesis produced a row, in the profile's own words.
--
-- Nothing in the product ever wrote `opportunity_hypotheses`. The table was built
-- for a deterministic generator -- `generated_by` defaults to 'deterministic' -- and
-- every consumer was built too: the Account page's "Why reach out", its suggested
-- first question, and the Call Pack the agent speaks from. Only the producer was
-- missing, so every real prospect had no hypothesis and only seeded demo companies
-- had one.
--
-- These two columns make a generated row traceable to the `leak_hypotheses` entry it
-- came from. `source_category` matters for a second reason: eight categories the
-- canonical profiles use are not in this table's check constraint, and four of those
-- are new concepts rather than spellings of an existing value. Storing the profile's
-- own category verbatim means a row can be filed under 'other' without losing what
-- its author actually called it, and the vocabulary can be reconciled later without
-- re-deriving anything.
alter table opportunity_hypotheses
  add column if not exists source_hypothesis_id text,
  add column if not exists source_category text;

create index if not exists opportunity_hypotheses_source_idx
  on opportunity_hypotheses(account_id, source_hypothesis_id) where is_current;
