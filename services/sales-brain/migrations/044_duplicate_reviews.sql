-- Candidate duplicates a human has to judge, and the decisions that stick.
--
-- Identity resolution refuses to merge on a weak match, which is right: two roofers
-- on one answering-service number, or two businesses whose listing gives the same
-- Facebook page, are usually two companies and occasionally one. Its own comment says
-- a weak match "must create a review case, never an automatic merge" -- and nothing
-- created one, so the near-misses simply became two Accounts with nothing pointing
-- them out.
--
-- The operations page has counted accounts sharing a normalized name for months.
-- That count cannot be acted on and cannot go down, so it reads as a permanent
-- seven-possible-duplicates and teaches an operator to ignore the panel. What makes a
-- queue finite is a decision that is remembered: "not a duplicate" has to mean the
-- pair never comes back.
create table if not exists duplicate_reviews (
  duplicate_review_id uuid primary key default gen_random_uuid(),
  -- Ordered by account_id so one pair cannot be queued twice from both directions.
  account_a_id      uuid not null references accounts(account_id) on delete cascade,
  account_b_id      uuid not null references accounts(account_id) on delete cascade,
  -- Which near-miss rule proposed them.
  candidate_rule    text not null,
  -- What is alike and what is not, so a person can decide without opening two tabs.
  evidence_for      jsonb not null default '[]'::jsonb,
  evidence_against  jsonb not null default '[]'::jsonb,
  status            text not null default 'OPEN'
    check (status in ('OPEN', 'MERGED', 'NOT_DUPLICATE')),
  decided_by        uuid references users(user_id),
  decided_at        timestamptz,
  decision_note     text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  check (account_a_id < account_b_id)
);

create unique index if not exists duplicate_reviews_pair_idx
  on duplicate_reviews (account_a_id, account_b_id);

-- The open queue, oldest first.
create index if not exists duplicate_reviews_open_idx
  on duplicate_reviews (first_seen_at)
  where status = 'OPEN';
