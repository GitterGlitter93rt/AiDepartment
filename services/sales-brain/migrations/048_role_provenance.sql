-- How a contact's role was decided, alongside what it was decided from.
--
-- `role_category` is the machine-level classification and `raw_title` is what the
-- source actually said. Between them there was nothing: a "Managing Partner" became
-- `unknown` and no row could say whether that was because nobody had looked, because
-- the title was unrecognisable, or because a vertical profile forgot to map it.
--
-- The runtime taxonomy stays small on purpose -- the alternative is dozens of
-- industry job titles in a check constraint, and a title is not a category. What was
-- missing is the vertical's own wording and the reason for the classification, so a
-- rep sees "Managing Partner", the system files it under `owner`, and the record says
-- which of those two facts each one is.
alter table contacts
  add column if not exists normalized_title text,
  add column if not exists role_classified_by text
    check (role_classified_by in (
      -- The vertical profile lists this exact title under a role it maps.
      'PROFILE_ROLE_TITLE',
      -- The vertical profile names the role, without listing this exact title.
      'PROFILE_ROLE_CATEGORY',
      -- No profile matched; the generic title patterns did.
      'GENERIC_PATTERN',
      -- Nothing matched. `unknown` is the honest answer, not a fallback.
      'INSUFFICIENT_EVIDENCE'
    ));

comment on column contacts.normalized_title is
  'The vertical profile''s own wording for this role, when a profile recognised the '
  'raw title. Never overwrites raw_title, which stays exactly as the source gave it.';
