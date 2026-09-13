-- 028_account_merge.sql — merging two Accounts that turned out to be one company.
--
-- Two sources discover the same business under different names, or a rep imports a
-- list that spells it differently, and the CRM ends up with two records for one
-- company. Until now there was an account_merges table and nothing that wrote it.
--
-- The merged Account is kept as a tombstone rather than deleted. Its id has been in
-- URLs, in a rep's bookmarks, in an activity payload and possibly in a provider's
-- record of us, and a dead link is a worse answer than a redirect. The tombstone
-- carries a pointer to the survivor and drops out of every working surface.

alter table accounts add column if not exists merged_into_account_id uuid
  references accounts(account_id);
alter table accounts add column if not exists merged_at timestamptz;

create index if not exists accounts_merged_into_idx on accounts (merged_into_account_id)
  where merged_into_account_id is not null;

-- A tombstone cannot be a merge target, and cannot point at itself.
alter table accounts drop constraint if exists accounts_merge_not_self;
alter table accounts add constraint accounts_merge_not_self
  check (merged_into_account_id is null or merged_into_account_id <> account_id);

-- The merge record gains the reason a human gave and the counts of what moved, so a
-- manager can see why two records were considered the same company without reading
-- the timeline of both.
alter table account_merges add column if not exists reason text;
alter table account_merges add column if not exists moved_counts jsonb not null default '{}'::jsonb;

-- account_merges.merged_account_id had no foreign key because the row used to be
-- deleted. It survives now, so the reference can be real.
alter table account_merges drop constraint if exists account_merges_merged_account_fk;
alter table account_merges add constraint account_merges_merged_account_fk
  foreign key (merged_account_id) references accounts(account_id) on delete cascade;

-- The working surface never shows a tombstone: it is not a prospect, it is a
-- redirect.
drop view if exists prospect_inventory;

create view prospect_inventory as
select
  a.account_id,
  a.canonical_name              as company_name,
  a.normalized_name,
  a.canonical_domain,
  a.primary_vertical_profile_id,
  a.manual_score,
  a.manual_tier,
  a.advertiser_strength,
  a.research_completeness,
  a.research_fresh_until,
  a.last_researched_at,
  a.ownership_state,
  a.current_owner_user_id,
  a.relationship_state,
  a.is_suppressed,
  a.claimed_at,
  a.created_at,
  owner.display_name            as owner_display_name,

  loc.city,
  loc.state_region,
  loc.postal_code,
  loc.timezone                  as location_timezone,
  case
    when loc.city is not null and loc.state_region is not null then loc.city || ', ' || loc.state_region
    when loc.city is not null then loc.city
    else coalesce(loc.state_region, 'Location unknown')
  end                           as geography_summary,

  dm.contact_id                 as best_contact_id,
  dm.full_name                  as best_contact_name,
  dm.raw_title                  as best_contact_title,
  dm.role_category              as best_contact_role,
  dm.role_confidence            as best_contact_role_confidence,
  dm.is_role_placeholder        as best_contact_is_role_only,

  ep.phone_count,
  ep.email_count,
  ep.has_direct_phone,
  ep.has_named_email,
  -- Contactability is derived, never invented. Missing endpoints stay missing.
  case
    when ep.phone_count > 0 and ep.email_count > 0 then 'PHONE_AND_EMAIL'
    when ep.phone_count > 0 then 'PHONE'
    when ep.email_count > 0 then 'EMAIL'
    else 'RESEARCH_NEEDED'
  end                           as contactability_summary,

  -- Channel eligibility. Suppression always wins; an open callback surfaces first.
  case
    when a.is_suppressed then 'SUPPRESSED'
    when fu.open_callbacks > 0 then 'CALLBACK'
    when ep.phone_count > 0 and ep.email_count > 0 then 'CALL_AND_EMAIL'
    when ep.phone_count > 0 then 'CALL_READY'
    when ep.email_count > 0 then 'EMAIL_READY'
    else 'CONTACT_RESEARCH_NEEDED'
  end                           as channel_state,

  ads.google_paid,
  ads.google_lsa,
  ads.meta_paid,
  hyp.hypothesis_text           as primary_hypothesis,
  hyp.category                  as primary_hypothesis_category,
  fu.open_callbacks,
  fu.next_followup_due,
  act.last_activity_at,
  act.activity_count
from accounts a
left join users owner on owner.user_id = a.current_owner_user_id

-- Primary location: headquarters if flagged, else the oldest active location.
left join lateral (
  select l.* from locations l
  where l.account_id = a.account_id and l.is_active
  order by l.is_headquarters desc, l.created_at asc
  limit 1
) loc on true

-- Best decision-maker: the lowest priority number among active contacts.
left join lateral (
  select c.* from contacts c
  where c.account_id = a.account_id and c.status = 'ACTIVE'
  order by c.decision_maker_priority asc, c.role_match asc, c.created_at asc
  limit 1
) dm on true

left join lateral (
  select
    count(*) filter (where e.endpoint_type = 'PHONE') as phone_count,
    count(*) filter (where e.endpoint_type = 'EMAIL') as email_count,
    bool_or(e.endpoint_type = 'PHONE' and e.endpoint_role in
      ('DIRECT_BUSINESS_LINE','MOBILE_ASSERTED_BUSINESS','EXTENSION')) as has_direct_phone,
    bool_or(e.endpoint_type = 'EMAIL' and e.endpoint_role = 'DIRECT_PERSON_EMAIL'
      and e.quality_state <> 'GUESSED_UNVERIFIED') as has_named_email
  from contact_endpoints e
  where e.account_id = a.account_id
    and e.is_active and not e.is_suppressed
    and e.quality_state not in ('WRONG_NUMBER','DISCONNECTED','HARD_BOUNCE','SUPPRESSED','GUESSED_UNVERIFIED')
) ep on true

-- Advertising badges come only from evidence that is still live and still fresh.
-- Stale ad evidence must never render as a current-tense claim.
left join lateral (
  select
    bool_or(ev.claim_key = 'active_google_search_ad' and ev.normalized_value = 'yes') as google_paid,
    bool_or(ev.claim_key = 'active_local_service_ad' and ev.normalized_value = 'yes') as google_lsa,
    bool_or(ev.claim_key = 'active_meta_ad'          and ev.normalized_value = 'yes') as meta_paid
  from evidence_records ev
  where ev.account_id = a.account_id
    and ev.contradicted_by_evidence_id is null
    and ev.confidence in ('confirmed','likely')
    and (ev.expires_at is null or ev.expires_at > now())
) ads on true

left join lateral (
  select h.hypothesis_text, h.category
  from opportunity_hypotheses h
  where h.account_id = a.account_id and h.is_current
  order by h.priority asc, h.generated_at desc
  limit 1
) hyp on true

left join lateral (
  select
    count(*) filter (where f.status = 'OPEN' and f.followup_type = 'CALLBACK') as open_callbacks,
    min(f.due_at) filter (where f.status = 'OPEN') as next_followup_due
  from follow_ups f where f.account_id = a.account_id
) fu on true

left join lateral (
  select max(t.occurred_at) as last_activity_at, count(*) as activity_count
  from activities t
  where t.account_id = a.account_id
    and t.activity_type in ('CALL_ATTEMPT','VOICEMAIL','EMAIL_SENT','EMAIL_REPLY',
                            'FIELD_VISIT','MEETING_SCHEDULED','NOTE')
) act on true
where a.merged_into_account_id is null;

comment on view prospect_inventory is
  'Search projection over canonical entities. Read-only: all writes go through the '
  'canonical tables. Merged Accounts are excluded: a tombstone is a redirect, not a '
  'prospect.';
