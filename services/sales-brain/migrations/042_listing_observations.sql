-- What a business listing knows that a search result does not.
--
-- A SERP row says who ranked and who paid. A Maps-style listing says who exists: a
-- category, a street address, a rating and a review count, under an id that means the
-- same business tomorrow. Those last two were reported as "nothing collects this" by
-- the research fact model, which was true and is the gap this closes.
--
-- Null is not zero. A provider that returns no rating has not told us the business has
-- none, and a column that cannot tell those apart would put a false zero in front of a
-- rep.
alter table search_observations add column if not exists category text;
alter table search_observations add column if not exists rating numeric(2,1);
alter table search_observations add column if not exists review_count integer;

-- Listings are collected per category and place, and read back per Account.
create index if not exists search_observations_listing_idx
  on search_observations (account_id, observed_at desc)
  where source_type = 'listings';
