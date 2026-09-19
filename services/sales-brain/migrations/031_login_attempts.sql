-- 031_login_attempts.sql — rate limiting the sign-in form.
--
-- The portal is about to sit behind a public hostname. Until now the sign-in form
-- would accept an unlimited number of guesses at a password, as fast as the machine
-- could hash them, and the only trace was a log line.
--
-- Attempts are durable rather than in-process memory: two API workers behind a proxy
-- must count the same attempts, and a restart must not clear a lockout.

create table login_attempts (
  attempt_id       bigserial primary key,
  email_normalized text not null,
  ip               text,
  succeeded        boolean not null,
  attempted_at     timestamptz not null default now()
);

-- The two lookups the check makes: recent failures for this address, and recent
-- failures from this source.
create index login_attempts_email_idx on login_attempts(email_normalized, attempted_at desc)
  where not succeeded;
create index login_attempts_ip_idx on login_attempts(ip, attempted_at desc)
  where not succeeded;
