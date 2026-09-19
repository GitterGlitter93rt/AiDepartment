-- 014_opportunity_problem_length.sql
-- A stated problem is a sentence, not a word. The schema now agrees with the domain
-- rule: "interested" cleared the previous ten-character bar.
alter table opportunities drop constraint if exists opportunities_problem_required;
alter table opportunities add constraint opportunities_problem_required
  check (length(btrim(problem_summary)) >= 20);
