-- ============================================================
-- 0022 — THE OUTBOUND HALF
--
-- 0021 built the inbox: people, conversations, messages, flows. It could
-- decide what to say. It could not say it anywhere but this website, because
-- nothing carried a decision out to a platform.
--
-- This adds the three things that were missing:
--   1. somewhere to keep each channel's credentials, by NAME not by value
--   2. a queue, so a send is attempted, retried and auditable rather than
--      fired into the dark inside a webhook handler
--   3. follower snapshots, for the one platform where "thank you for the
--      follow" is achievable at all
-- ============================================================

-- ------------------------------------------------------------
-- 1. CREDENTIALS — the names of secrets, never the secrets
--
-- A token in a database row is a token in every backup, every replica and
-- every accidental select. These rows say WHICH function secret to read and
-- which account it belongs to; the secret itself lives in Supabase function
-- secrets and is only ever in memory.
-- ------------------------------------------------------------
create table if not exists public.inbox_credentials (
  channel        text primary key references public.inbox_channels(key) on delete cascade,
  -- e.g. 'META_PAGE_TOKEN'. Read with Deno.env.get(); never stored here.
  token_env      text not null,
  -- the account the token acts as, so a reply cannot be posted as the wrong one
  account_id     text,
  account_label  text,
  -- ids that are US, so our own comments and messages are never answered
  self_ids       text[] not null default '{}',
  connected_at   timestamptz,
  -- what a new follower gets told, per channel. Empty means say nothing: a
  -- thank-you nobody wrote is worse than no thank-you.
  follow_greeting text,
  -- a send that costs money waits for a person unless this is on
  auto_greet     boolean not null default false,
  -- what the last real API call said, so a dead token is visible before a
  -- customer notices the silence
  last_ok_at     timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.inbox_credentials is
  'Which env var holds each channel''s token, and which account it acts as. Never the token itself.';

-- ------------------------------------------------------------
-- 2. THE OUTBOUND QUEUE
--
-- Every attempt to say something off this site lands here first. A row is the
-- record of an intention; `state` is what became of it. Nothing is deleted,
-- because "why did it message that person" is a question that gets asked
-- months later.
-- ------------------------------------------------------------
do $$ begin
  create type public.outbound_state as enum ('queued','sent','failed','refused','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.inbox_outbound (
  id             uuid primary key default gen_random_uuid(),
  conv_id        uuid references public.inbox_conversations(id) on delete set null,
  channel        text not null references public.inbox_channels(key),
  -- comment_reply | private_reply | dm
  as_kind        text not null,
  target_id      text not null,
  body           text not null,
  state          public.outbound_state not null default 'queued',
  -- a refusal is a first-class outcome, not an error: the platform said no and
  -- the reason is worth keeping in the same place as the successes
  refusal        text,
  attempts       int not null default 0,
  last_error     text,
  -- the platform's id for what we posted, so an echo can be recognised
  external_id    text,
  -- true when the send costs money (X charges per DM); a human can require
  -- approval on these without blocking the free ones
  costs_money    boolean not null default false,
  approved_by    uuid references public.inbox_staff(profile_id),
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  -- one send per (channel, target, purpose): the guard against a retrying
  -- webhook thanking the same person four times
  dedupe_key     text
);

create unique index if not exists inbox_outbound_dedupe
  on public.inbox_outbound (dedupe_key) where dedupe_key is not null;
create index if not exists inbox_outbound_pending
  on public.inbox_outbound (state, created_at) where state = 'queued';
create index if not exists inbox_outbound_convo
  on public.inbox_outbound (conv_id, created_at desc);

comment on column public.inbox_outbound.dedupe_key is
  'Unique. A webhook that is delivered twice must not produce two messages.';

-- ------------------------------------------------------------
-- 3. FOLLOWER SNAPSHOTS
--
-- Instagram has no follow event and does not expose the follower list, only a
-- count — so a thank-you on follow cannot be built there at all. X exposes the
-- list, so the only way is to take it periodically and diff it. That is what
-- this holds.
-- ------------------------------------------------------------
create table if not exists public.inbox_followers (
  channel      text not null references public.inbox_channels(key),
  follower_id  text not null,
  handle       text,
  first_seen   timestamptz not null default now(),
  greeted_at   timestamptz,
  primary key (channel, follower_id)
);

create index if not exists inbox_followers_ungreeted
  on public.inbox_followers (channel, first_seen) where greeted_at is null;

comment on table public.inbox_followers is
  'Every follower id we have ever seen, per channel, and whether they were thanked. New = present now and not in here.';

-- ------------------------------------------------------------
-- 4. LOCK IT DOWN
--
-- Same posture as 0021: these tables hold private conversations and the
-- plumbing that sends as the owner. The browser gets nothing. Only the
-- service role, used by the edge function, touches them.
-- ------------------------------------------------------------
alter table public.inbox_credentials enable row level security;
alter table public.inbox_outbound    enable row level security;
alter table public.inbox_followers   enable row level security;

revoke all on public.inbox_credentials from anon, authenticated;
revoke all on public.inbox_outbound    from anon, authenticated;
revoke all on public.inbox_followers   from anon, authenticated;

-- No policy is deliberate. RLS on with zero policies denies everyone except
-- the service role, which bypasses it. Adding a policy here would be adding a
-- way for a browser to read the owner's direct messages.

-- ------------------------------------------------------------
-- 5. SEED
--
-- The channel first, then the credential that references it. The other
-- way round fails on the foreign key, which is how this was found.
-- ------------------------------------------------------------

-- facebook was not a channel in 0021; the Page is where Instagram's
-- permissions hang from, and its own comments are worth answering too
insert into public.inbox_channels (key, label, enabled, can_read_comments, can_reply_comments, can_send_dm, dm_window_hours, note) values
  ('facebook', 'Facebook Page', false, true, true, true, 24,
   'Page comments and Messenger. Needs pages_manage_engagement and pages_messaging. Same 24h window as Instagram; the private reply to a commenter is the exception and has 7 days.')
on conflict (key) do nothing;

insert into public.inbox_credentials (channel, token_env, account_label, follow_greeting) values
  ('instagram', 'META_PAGE_TOKEN',  'the Instagram professional account, through its linked Page',
   null),   -- no follow event and no follower list exist; a greeting here would never fire
  ('facebook',  'META_PAGE_TOKEN',  'the Facebook Page', null),
  ('threads',   'THREADS_TOKEN',    'the Threads profile', null),
  ('x',         'X_BEARER_TOKEN',   'the X account',
   'Thanks for the follow. Everything I make lives here: https://matthew.mccluster.org — the music is at https://matthew.mccluster.org/album.html'),
  ('linkedin',  'LINKEDIN_TOKEN',   'unused: automated sending is not permitted', null)
on conflict (channel) do nothing;

