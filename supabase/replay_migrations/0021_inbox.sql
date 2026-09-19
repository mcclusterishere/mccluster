-- ============================================================
-- THE INBOX — one thread per person, whatever door they came in.
--
-- The ask was "mini chat mixed with chatfuel mixed with every chatbot,
-- built from scratch in my repo, connected to every social". This is the
-- engine half of that: the part that is the same no matter which platform
-- is on the other end, so adding a channel later is writing an adapter
-- rather than rebuilding anything.
--
-- WHAT THIS DOES NOT PRETEND.
--
-- docs/social-connections.md is the checked account of what each platform
-- permits. The short version, because it shapes this schema:
--
--   * Instagram has NO new-follower webhook and will not give you your
--     follower list — only a count. It also only lets you message someone
--     inside a 24-hour window THEY open by messaging you first.
--   * Threads has no direct-message API at all.
--   * LinkedIn's Messages API is partner-only and requires that a human
--     press send on an editable draft.
--   * X is pay-per-use since Feb 2026 and charges per DM.
--
-- So `channel` below is an enum of doors that might one day open, and
-- `site` — the chat on matthew.mccluster.org itself — is the one that
-- needs nobody's permission and works the day this ships.
--
-- WHERE THE TRUST SITS. Same rule the shake shop used and for the same
-- reason: the browser is not trusted to write anything that matters.
-- A visitor may open a conversation and add their own messages to it.
-- They may NOT write an outbound message, mark one delivered, change a
-- rule, or read anybody else's thread. Staff replies and all channel
-- traffic go through the edge function on the service role.
-- ============================================================

-- ============================================================
-- 1. WHO WORKS THE INBOX
-- ============================================================

create table if not exists public.inbox_staff (
  profile_id uuid primary key references public.eu_profiles(id) on delete cascade,
  added_by   uuid references public.eu_profiles(id) on delete set null,
  at         timestamptz not null default now()
);

comment on table public.inbox_staff is
  'Who may read conversations and reply. Its own list, not the civic editor role: reading a stranger''s direct messages is a different trust level from moderating a public listing.';

create or replace function public.inbox_is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.eu_is_admin()
      or exists (select 1 from public.inbox_staff s where s.profile_id = auth.uid());
$$;

-- ============================================================
-- 2. THE DOORS
--
-- Kept as a check constraint rather than a Postgres enum on purpose:
-- adding a channel should be a one-line migration, not an ALTER TYPE
-- that cannot run inside a transaction with other statements.
-- ============================================================

create table if not exists public.inbox_channels (
  key        text primary key,
  label      text not null,
  -- false until the owner has the tokens AND the platform's approval.
  -- The adapters are written; this is what stops them running.
  enabled    boolean not null default false,
  -- what this door is actually allowed to do, per the platform's own
  -- rules. The flow engine reads this and refuses to schedule an action
  -- the channel cannot legally perform.
  can_read_comments  boolean not null default false,
  can_reply_comments boolean not null default false,
  can_send_dm        boolean not null default false,
  -- Instagram's 24-hour rule, in hours. null = no window limit.
  dm_window_hours    integer,
  -- why a capability is off, in words, so nobody re-litigates it later
  note       text,
  at         timestamptz not null default now()
);

insert into public.inbox_channels (key, label, enabled, can_read_comments, can_reply_comments, can_send_dm, dm_window_hours, note) values
  ('site', 'The website', true, false, false, true, null,
   'The only channel that needs nobody''s permission. A visitor opens the chat on the site; this is the door that works today.'),
  ('instagram', 'Instagram', false, true, true, true, 24,
   'Needs a professional account, a linked Page, business verification and app review for instagram_manage_comments and instagram_manage_messages. NO follower event exists, and the follower list is not readable — only a count. DMs only inside a 24h window the visitor opens.'),
  ('threads', 'Threads', false, true, true, false, null,
   'Reply moderation and webhooks exist. There is no direct-message API at all, so can_send_dm is false as a matter of fact, not of configuration.'),
  ('x', 'X', false, true, true, true, null,
   'Pay-per-use since 2026-02-06; a DM send costs money. The only platform of the four where a new-follower thank-you is achievable, and only by polling the follower list and diffing it.'),
  ('linkedin', 'LinkedIn', false, false, false, false, null,
   'Messages API is partner-only, first-degree connections only, and requires a specific non-automated member action with an editable draft. Automated sending is what the rule forbids. Off by fact.')
on conflict (key) do nothing;

-- ============================================================
-- 3. PEOPLE
--
-- One row per person per channel. The same human on Instagram and on the
-- site is two contacts until something links them, and nothing here
-- guesses: matching a website visitor to an Instagram handle by name is
-- how you send the wrong person somebody else's conversation.
-- ============================================================

create table if not exists public.inbox_contacts (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null references public.inbox_channels(key),
  -- the platform's own id for this person. For 'site' it is the
  -- anonymous visitor key the widget generates and keeps in localStorage.
  external_id  text not null,
  handle       text,
  display_name text,
  avatar_url   text,
  -- set only when the person tells us, never inferred
  email        text,
  -- a signed-in visitor may be linked to their profile
  profile_id   uuid references public.eu_profiles(id) on delete set null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  -- everything the channel told us that has no column of its own
  meta         jsonb not null default '{}'::jsonb,
  unique (channel, external_id)
);

create index if not exists inbox_contacts_channel_idx on public.inbox_contacts (channel, last_seen desc);

-- ============================================================
-- 4. CONVERSATIONS
-- ============================================================

create table if not exists public.inbox_conversations (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.inbox_contacts(id) on delete cascade,
  channel     text not null references public.inbox_channels(key),
  -- 'dm' is a private thread; 'comment' is a public thread under a post,
  -- which matters because a reply to a comment is visible to everybody.
  kind        text not null default 'dm' check (kind in ('dm', 'comment')),
  -- the post/media this comment thread hangs under, when kind = 'comment'
  subject_ref text,
  status      text not null default 'open' check (status in ('open', 'snoozed', 'closed')),
  -- set when a human takes it over from the bot; the flow engine will not
  -- send into a conversation a person has claimed
  claimed_by  uuid references public.eu_profiles(id) on delete set null,
  claimed_at  timestamptz,
  -- when the platform's reply window shuts. null = no window, or unknown.
  window_ends timestamptz,
  last_at     timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists inbox_conv_open_idx on public.inbox_conversations (status, last_at desc);
create index if not exists inbox_conv_contact_idx on public.inbox_conversations (contact_id, last_at desc);

comment on column public.inbox_conversations.window_ends is
  'Instagram will refuse a send after 24h from the visitor''s last message. Stored so the desk can grey out the reply box and say why, instead of letting somebody type a reply that the platform silently drops.';

-- ============================================================
-- 5. MESSAGES
-- ============================================================

create table if not exists public.inbox_messages (
  id          uuid primary key default gen_random_uuid(),
  conv_id     uuid not null references public.inbox_conversations(id) on delete cascade,
  direction   text not null check (direction in ('in', 'out')),
  -- who produced an outbound message: the flow engine, or a person
  author      text not null default 'contact' check (author in ('contact', 'bot', 'staff')),
  staff_id    uuid references public.eu_profiles(id) on delete set null,
  body        text not null,
  -- the platform's id for this message, so a webhook redelivery does not
  -- double-post. Webhooks retry; this is the thing that makes that safe.
  external_id text,
  -- 'queued' -> 'sent' -> 'delivered', or 'failed' with a reason
  state       text not null default 'sent' check (state in ('queued', 'sent', 'delivered', 'failed')),
  error       text,
  meta        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

create unique index if not exists inbox_messages_external_idx
  on public.inbox_messages (conv_id, external_id) where external_id is not null;
create index if not exists inbox_messages_conv_idx on public.inbox_messages (conv_id, at);

-- keep the conversation's clock honest without a round trip
create or replace function public.inbox_touch_conv()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.inbox_conversations
     set last_at = greatest(last_at, new.at)
   where id = new.conv_id;
  return new;
end;
$$;

drop trigger if exists inbox_messages_touch on public.inbox_messages;
create trigger inbox_messages_touch after insert on public.inbox_messages
  for each row execute function public.inbox_touch_conv();

-- ============================================================
-- 6. THE FLOWS — the chatfuel half
--
-- A rule is: when TRIGGER, and every CONDITION holds, do ACTIONS.
-- Deliberately data, not code: the owner changes what the bot says by
-- editing a row, not by waiting for a deploy.
--
--   trigger  {"on":"message_in","match":"any","keywords":["price","cost"]}
--            {"on":"message_in","match":"first"}          first ever message
--            {"on":"comment_in","match":"regex","pattern":"link|where"}
--
--   actions  [{"do":"reply","text":"..."},
--             {"do":"reply","text":"...","delay_seconds":4},
--             {"do":"tag","tag":"asked-about-price"},
--             {"do":"handoff"}]        stop the bot, raise it to a human
--
-- `handoff` exists because the worst thing a bot can do is keep talking
-- to somebody who needs a person.
-- ============================================================

create table if not exists public.inbox_flows (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- null = every channel this flow is legal on
  channel    text references public.inbox_channels(key),
  enabled    boolean not null default true,
  -- lower runs first; the first flow that matches and stops wins
  ordinal    integer not null default 100,
  stop       boolean not null default true,
  trigger    jsonb not null,
  conditions jsonb not null default '[]'::jsonb,
  actions    jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists inbox_flows_run_idx on public.inbox_flows (enabled, ordinal);

-- what a flow did, so "why did it say that" has an answer
create table if not exists public.inbox_flow_runs (
  id       uuid primary key default gen_random_uuid(),
  flow_id  uuid references public.inbox_flows(id) on delete set null,
  conv_id  uuid references public.inbox_conversations(id) on delete cascade,
  matched  boolean not null,
  detail   jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);

create index if not exists inbox_flow_runs_conv_idx on public.inbox_flow_runs (conv_id, at desc);

-- ============================================================
-- 7. TAGS
-- ============================================================

create table if not exists public.inbox_tags (
  contact_id uuid not null references public.inbox_contacts(id) on delete cascade,
  tag        text not null,
  at         timestamptz not null default now(),
  primary key (contact_id, tag)
);

-- ============================================================
-- 8. ROW LEVEL SECURITY
--
-- The default is NO. Every table is denied to everyone and then opened
-- exactly as far as a named case requires. The one thing an anonymous
-- browser can do is read which channels exist and what the bot is
-- allowed to say — everything about actual people is staff-only.
-- ============================================================

alter table public.inbox_staff         enable row level security;
alter table public.inbox_channels      enable row level security;
alter table public.inbox_contacts      enable row level security;
alter table public.inbox_conversations enable row level security;
alter table public.inbox_messages      enable row level security;
alter table public.inbox_flows         enable row level security;
alter table public.inbox_flow_runs     enable row level security;
alter table public.inbox_tags          enable row level security;

-- the channel list is public: the widget asks whether 'site' is enabled
-- before it draws itself, and there is nothing sensitive in the answer
drop policy if exists inbox_channels_read on public.inbox_channels;
create policy inbox_channels_read on public.inbox_channels
  for select using (true);
drop policy if exists inbox_channels_admin on public.inbox_channels;
create policy inbox_channels_admin on public.inbox_channels
  for all using (public.eu_is_admin()) with check (public.eu_is_admin());

drop policy if exists inbox_staff_read on public.inbox_staff;
create policy inbox_staff_read on public.inbox_staff
  for select using (public.inbox_is_staff());
drop policy if exists inbox_staff_admin on public.inbox_staff;
create policy inbox_staff_admin on public.inbox_staff
  for all using (public.eu_is_admin()) with check (public.eu_is_admin());

-- NOBODY reads other people's conversations. Not the anon role, not a
-- signed-in visitor. The desk is staff; the widget is served its own
-- thread by the edge function on the service role, which is not
-- subject to these policies.
drop policy if exists inbox_contacts_staff on public.inbox_contacts;
create policy inbox_contacts_staff on public.inbox_contacts
  for all using (public.inbox_is_staff()) with check (public.inbox_is_staff());

drop policy if exists inbox_conv_staff on public.inbox_conversations;
create policy inbox_conv_staff on public.inbox_conversations
  for all using (public.inbox_is_staff()) with check (public.inbox_is_staff());

drop policy if exists inbox_messages_staff on public.inbox_messages;
create policy inbox_messages_staff on public.inbox_messages
  for all using (public.inbox_is_staff()) with check (public.inbox_is_staff());

drop policy if exists inbox_tags_staff on public.inbox_tags;
create policy inbox_tags_staff on public.inbox_tags
  for all using (public.inbox_is_staff()) with check (public.inbox_is_staff());

drop policy if exists inbox_flow_runs_staff on public.inbox_flow_runs;
create policy inbox_flow_runs_staff on public.inbox_flow_runs
  for select using (public.inbox_is_staff());

-- flows are readable by staff and writable only by an admin: what the
-- bot says in public under the owner's name is an editorial decision
drop policy if exists inbox_flows_read on public.inbox_flows;
create policy inbox_flows_read on public.inbox_flows
  for select using (public.inbox_is_staff());
drop policy if exists inbox_flows_admin on public.inbox_flows;
create policy inbox_flows_admin on public.inbox_flows
  for all using (public.eu_is_admin()) with check (public.eu_is_admin());

-- ============================================================
-- 9. GRANTS
--
-- Production grants anon/authenticated ALL on new public tables by
-- default, so RLS is the only real wall — but a grant nobody needs is a
-- grant that can be left behind when a policy is loosened later. These
-- are cut to what each role actually has a case for.
-- ============================================================

revoke all on public.inbox_staff, public.inbox_contacts, public.inbox_conversations,
              public.inbox_messages, public.inbox_flows, public.inbox_flow_runs,
              public.inbox_tags
  from anon, authenticated;

grant select on public.inbox_channels to anon, authenticated;
grant insert, update, delete on public.inbox_channels to authenticated;

grant select, insert, update, delete on public.inbox_staff, public.inbox_contacts,
      public.inbox_conversations, public.inbox_messages, public.inbox_flows,
      public.inbox_tags to authenticated;
grant select on public.inbox_flow_runs to authenticated;

-- a trigger function is not an API — same finding as 0020
revoke all on function public.inbox_touch_conv() from public, anon, authenticated;

-- ============================================================
-- 10. THE STARTING FLOWS
--
-- Written for the site widget, because that is the channel that works
-- today. They are rows: change the words without a deploy.
--
-- Note what is NOT here: a "thank you for following" flow. There is no
-- follower trigger, on any channel, because no platform of the four
-- gives us the event. Seeding a rule that can never fire would be a
-- promise the schema cannot keep.
-- ============================================================

insert into public.inbox_flows (name, channel, ordinal, stop, trigger, conditions, actions) values
  ('Greet a first-time visitor', 'site', 10, true,
   '{"on":"message_in","match":"first"}'::jsonb,
   '[]'::jsonb,
   '[{"do":"reply","text":"Hey — this is Matthew''s desk. A person reads everything here; if I''m around I''ll answer myself."},
     {"do":"reply","delay_seconds":2,"text":"What are you here for? The music, a website build, or the Uprise work?"}]'::jsonb),

  ('Point at the music', 'site', 20, true,
   '{"on":"message_in","match":"any","keywords":["music","song","album","track","listen","record","here","prim3"]}'::jsonb,
   '[]'::jsonb,
   '[{"do":"tag","tag":"music"},
     {"do":"reply","text":"The whole catalogue is one room: https://matthew.mccluster.org/album.html — 17 tracks, every one with its own film."}]'::jsonb),

  ('Somebody wants a website', 'site', 30, true,
   '{"on":"message_in","match":"any","keywords":["website","site","web","build","design","hosting","domain"]}'::jsonb,
   '[]'::jsonb,
   '[{"do":"tag","tag":"sites-lead"},
     {"do":"reply","text":"That''s McCluster Sites: https://matthew.mccluster.org/sites.html — the build is free, $66 to go live, then $33 a month."},
     {"do":"handoff"}]'::jsonb),

  ('Anything about money goes to a person', 'site', 40, true,
   '{"on":"message_in","match":"any","keywords":["price","cost","quote","invoice","refund","charge","pay","how much"]}'::jsonb,
   '[]'::jsonb,
   '[{"do":"tag","tag":"money"},
     {"do":"reply","text":"Let me get Matthew on this rather than quote you wrong — he answers these himself."},
     {"do":"handoff"}]'::jsonb)
on conflict do nothing;

-- ============================================================
-- 11. THE DESK VIEW
--
-- What the inbox room lists. A view rather than a join in the client, so
-- the desk cannot accidentally ask for a column RLS is protecting.
-- ============================================================

create or replace view public.inbox_threads as
  select c.id,
         c.channel,
         c.kind,
         c.status,
         c.claimed_by,
         c.window_ends,
         c.last_at,
         c.created_at,
         k.handle,
         k.display_name,
         k.avatar_url,
         (select m.body from public.inbox_messages m
           where m.conv_id = c.id order by m.at desc limit 1) as last_body,
         (select m.direction from public.inbox_messages m
           where m.conv_id = c.id order by m.at desc limit 1) as last_direction,
         (select count(*) from public.inbox_messages m where m.conv_id = c.id) as message_count
    from public.inbox_conversations c
    join public.inbox_contacts k on k.id = c.contact_id;

-- A VIEW DOES NOT RUN AS THE CALLER BY DEFAULT, and this one shipped
-- assuming it did.
--
-- Postgres reads a view's underlying tables as the VIEW'S OWNER unless
-- security_invoker is on, so the caller's RLS never applies. Verified
-- against the live project: as `anon`,
--
--     select count(*), max(last_body) from public.inbox_threads
--
-- returned the seeded conversation AND its full message body. Every
-- thread and every last message was readable by anyone holding the
-- publishable key, which is to say by anyone at all.
--
-- The RLS on inbox_conversations and inbox_contacts was correct the whole
-- time. The view walked around it. It was caught by seeding a row and
-- looking at it as anon — not by reading the SQL, where it looked fine.
--
-- Both belts, because this one is other people's private messages.
alter view public.inbox_threads set (security_invoker = on);

revoke all on public.inbox_threads from anon;
grant select on public.inbox_threads to authenticated;

comment on view public.inbox_threads is
  'The desk list. security_invoker = on, so it reads as the CALLER and the RLS on inbox_conversations and inbox_contacts still applies. Without that flag a view reads as its owner and silently bypasses every policy underneath it.';
