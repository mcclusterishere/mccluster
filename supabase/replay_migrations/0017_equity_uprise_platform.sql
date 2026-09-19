-- ============================================================
-- EQUITY UPRISE — THE PLATFORM.
--
-- The program page (equity-uprise.html) is a finished public record:
-- documents, a docket, nine fellows, a proclamation. This migration is
-- the part that was never there — the living half. People arrive with
-- something they care about, say it on the record, and leave with a
-- real next step: a fellowship, a program, an organization that will
-- actually take them.
--
-- The shape of the thing, in one line: a fellowship OF fellowships.
-- We collect what a person cares about, and we point them at the
-- rooms where that care turns into work.
--
-- WHY THIS LIVES IN SUPABASE AND NOT IN A NEW SERVER.
-- The plan this was built from called for a separate TypeScript
-- service with its own ORM. This house already has a backend: Postgres
-- with Row Level Security, reached straight over PostgREST from
-- js/backend.js, with Deno edge functions for the few jobs that need a
-- secret. A second backend would mean a second auth system, a second
-- deploy, a second place for a permission bug to live. Everything below
-- is therefore tables and policies — the database IS the API, and the
-- wall is RLS, not a middleware someone forgot to mount.
--
-- NAMING. Every table here is prefixed eu_. The house already owns
-- `campaigns`, `leads`, `engagements` and friends; the movement's
-- tables sit beside them without ever colliding.
--
-- THE FIVE KINDS OF PEOPLE (public.eu_profiles.role):
--   admin   — the owner. Everything, including the kill switches.
--   editor  — a fellow with staff duties. Moderates, edits the
--             directory, reads conversations, helps with profiles.
--             Never: roles, outbound sending, the suppression list,
--             the agent's instructions, deletion.
--   member  — a person with a profile. The default for anyone who joins.
--   host    — someone who RUNS a fellowship or program, and can list
--             it. Self-claimable, because a listing is moderated anyway.
--   client  — an agency client, assigned by the owner, so the same
--             account works across the HERE properties.
--
-- PASTE: Supabase → SQL Editor ("Here" project) → run once, then run
-- 0018 for the seed. Both are idempotent.
-- ============================================================

-- ============================================================
-- 1. PROFILES
--
-- "Publicly viewed, privately controlled by the user" — the owner's
-- words, and the reason this is two tables instead of one.
--
-- eu_profiles carries only what a person means to show. Anything that
-- can be used to REACH someone — email, phone, the consent flags that
-- govern outreach — lives in eu_profile_contact, which no editor and
-- no visitor can read. Row Level Security cannot hide a column; it can
-- only hide a row. So the private columns live in a row of their own.
-- ============================================================

create table if not exists public.eu_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text not null,
  display_name  text not null,
  kind          text not null default 'person'  check (kind in ('person', 'organization')),
  role          text not null default 'member'  check (role in ('admin', 'editor', 'member', 'host', 'client')),
  headline      text not null default '',
  bio           text not null default '',
  location      text not null default '',        -- free text: "Bridgeport, CT"
  region        text not null default '',        -- coarse, matchable: "CT", "New England", "US"
  show_location boolean not null default false,  -- off by default; the person turns it on
  links         jsonb  not null default '[]'::jsonb,   -- [{label, href}]
  interests     text[] not null default '{}',    -- matching tags the person picked
  goals         text not null default '',        -- "what I'm trying to do next", in their words
  open_to       text[] not null default '{}',    -- fellowships | organizing | speaking | hiring | mentoring
  avatar_url    text not null default '',
  visibility    text not null default 'public'  check (visibility in ('public', 'unlisted', 'private')),
  status        text not null default 'active'  check (status in ('active', 'hidden', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.eu_profiles is
  'A person or organization on the platform. Public by default, controlled by its owner. Contact details are deliberately NOT here — see eu_profile_contact.';

-- Handles are URL-safe and case-insensitive: profile.html?p=ashan-voyage.
-- The uniqueness is plain rather than on lower(handle) because the guard
-- trigger lowercases every handle on the way in, so the two are the same
-- wall — and a plain constraint is one an upsert can name in ON CONFLICT,
-- which a functional index is not.
create unique index if not exists eu_profiles_handle on public.eu_profiles (handle);
create index if not exists eu_profiles_role on public.eu_profiles (role);
create index if not exists eu_profiles_interests on public.eu_profiles using gin (interests);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eu_profiles_handle_shape') then
    alter table public.eu_profiles
      add constraint eu_profiles_handle_shape
      check (handle ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,38}$') not valid;
  end if;
end $$;

create table if not exists public.eu_profile_contact (
  id           uuid primary key references public.eu_profiles(id) on delete cascade,
  email        text not null default '',
  phone        text not null default '',
  email_optin  boolean not null default false,
  sms_optin    boolean not null default false,
  contact_note text not null default '',
  updated_at   timestamptz not null default now()
);

comment on table public.eu_profile_contact is
  'How to reach a person, and whether they have said yes to being reached. Readable only by the person and the owner. Editors never see this: reachability is list management, and list management is not an editor power.';

-- ============================================================
-- 2. WHO IS ASKING
--
-- These three helpers are SECURITY DEFINER on purpose. A policy on
-- eu_profiles that has to read eu_profiles to decide would recurse
-- forever; definer rights step around the caller's RLS to answer one
-- narrow question — "what role does this token carry?" — and nothing
-- else. The owner's email is admin before any profile row exists, so
-- the platform is never locked out of itself on day one.
--
-- They sit AFTER the profiles table because a SQL-bodied function is
-- parsed the moment it is created: a helper that reads a table that
-- does not exist yet does not fail later, it fails now.
-- ============================================================

create or replace function public.eu_role()
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then 'visitor'
    when (auth.jwt() ->> 'email') = 'matthew@mccluster.org' then 'admin'
    else coalesce((select p.role from public.eu_profiles p where p.id = auth.uid()), 'visitor')
  end;
$$;

comment on function public.eu_role() is
  'The role carried by the current token. The owner email is admin unconditionally so the platform can never lock its owner out.';

create or replace function public.eu_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.eu_role() = 'admin'; $$;

create or replace function public.eu_is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.eu_role() in ('admin', 'editor'); $$;

-- ---- the role guard ------------------------------------------------
-- A person may create their own profile and may edit it forever. What
-- they may never do is promote themselves. RLS can gate a whole row
-- but cannot say "this column may not change", so the rule lives in a
-- trigger, where it can compare the new row against the old one.
create or replace function public.eu_profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.handle := lower(trim(new.handle));
  new.updated_at := now();

  -- The owner sets any role. So does a caller with no token at all —
  -- that is the SQL editor or the service role, which already hold the
  -- master keys; a guard that quietly downgraded THEIR writes would
  -- turn seeding the first editor into an unexplainable no-op.
  if public.eu_is_admin() or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- self-claimable roles only. 'host' is claimable because a host's
    -- listings are moderated before they are published anyway, so the
    -- claim buys no trust it has not earned.
    if new.role is null or new.role not in ('member', 'host') then
      new.role := 'member';
    end if;
    new.status := 'active';
  else
    new.role := old.role;
    new.status := old.status;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

drop trigger if exists eu_profiles_guard_t on public.eu_profiles;
create trigger eu_profiles_guard_t
  before insert or update on public.eu_profiles
  for each row execute function public.eu_profiles_guard();

alter table public.eu_profiles enable row level security;
alter table public.eu_profile_contact enable row level security;

drop policy if exists eu_profiles_read on public.eu_profiles;
create policy eu_profiles_read on public.eu_profiles
  for select to authenticated
  using (id = auth.uid() or public.eu_is_staff()
         or (visibility = 'public' and status = 'active'));

drop policy if exists eu_profiles_mine_new on public.eu_profiles;
create policy eu_profiles_mine_new on public.eu_profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists eu_profiles_mine_edit on public.eu_profiles;
create policy eu_profiles_mine_edit on public.eu_profiles
  for update to authenticated
  using (id = auth.uid() or public.eu_is_admin())
  with check (id = auth.uid() or public.eu_is_admin());

drop policy if exists eu_profiles_admin_del on public.eu_profiles;
create policy eu_profiles_admin_del on public.eu_profiles
  for delete to authenticated using (public.eu_is_admin());

drop policy if exists eu_contact_self on public.eu_profile_contact;
create policy eu_contact_self on public.eu_profile_contact
  for all to authenticated
  using (id = auth.uid() or public.eu_is_admin())
  with check (id = auth.uid() or public.eu_is_admin());

-- The anonymous door. A signed-out visitor reading a public profile
-- goes through this view, never the table: the view is owned by the
-- database and carries only the columns a stranger is allowed to see.
create or replace view public.eu_profiles_public as
select
  p.id, p.handle, p.display_name, p.kind, p.role, p.headline, p.bio,
  case when p.show_location then p.location else '' end as location,
  p.region, p.links, p.interests, p.goals, p.open_to, p.avatar_url, p.created_at
from public.eu_profiles p
where p.visibility = 'public' and p.status = 'active';

comment on view public.eu_profiles_public is
  'The stranger''s view of a profile. Contact details never appear here, and location is withheld unless the person turned it on.';

-- ============================================================
-- 3. TOPICS
--
-- The three the movement opens with are seeded in 0018. The schema is
-- deliberately data-driven — a fourth topic is a row, never a deploy.
--
-- `dimensions` is the structured half of listening: the two or three
-- axes people actually argue along, each with plainly-worded options
-- that do not flatter one side. `prompts` is the open half: questions
-- that can be answered honestly by people who disagree with each other.
-- ============================================================

create table if not exists public.eu_topics (
  slug         text primary key,
  name         text not null,
  tagline      text not null default '',
  description  text not null default '',        -- neutral framing, read aloud on the page
  context      text not null default '',        -- what is factually going on, no verdict
  dimensions   jsonb not null default '[]'::jsonb,   -- [{key,label,help,options:[{value,label}]}]
  prompts      jsonb not null default '[]'::jsonb,   -- ["…", "…"]
  tags         text[] not null default '{}',    -- matching tags → fellowships
  resources    jsonb not null default '[]'::jsonb,   -- [{label,href,note}]
  status       text not null default 'active' check (status in ('active', 'paused', 'draft')),
  ordinal      int not null default 0,
  updated_at   timestamptz not null default now()
);

comment on table public.eu_topics is
  'What the movement is listening about. Neutral framing is a schema requirement, not a style note: description and dimensions must be answerable by people who disagree.';

alter table public.eu_topics enable row level security;

drop policy if exists eu_topics_read on public.eu_topics;
create policy eu_topics_read on public.eu_topics
  for select to anon, authenticated using (status <> 'draft' or public.eu_is_staff());

-- Editors may correct copy on a topic. They may not add, retire, or
-- re-scope one: the list of things the movement asks about is the
-- movement's posture, and posture is the owner's call.
drop policy if exists eu_topics_edit on public.eu_topics;
create policy eu_topics_edit on public.eu_topics
  for update to authenticated using (public.eu_is_staff()) with check (public.eu_is_staff());

drop policy if exists eu_topics_admin on public.eu_topics;
create policy eu_topics_admin on public.eu_topics
  for insert to authenticated with check (public.eu_is_admin());

drop policy if exists eu_topics_admin_del on public.eu_topics;
create policy eu_topics_admin_del on public.eu_topics
  for delete to authenticated using (public.eu_is_admin());

-- ============================================================
-- 4. PERSPECTIVES — what people actually said
--
-- Insert is open to the world, exactly like the CRM's front door: the
-- whole point is that a stranger with something to say can say it. But
-- the pile is not readable back by the person who dropped into it, and
-- nothing reaches a public page until a human approves it.
--
-- ANONYMITY IS STRUCTURAL. A submission marked anonymous still knows
-- whose it is (people need their own record back, and moderation needs
-- a thread to pull), so the public view drops the identity rather than
-- trusting a flag to be respected downstream.
-- ============================================================

create table if not exists public.eu_perspectives (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.eu_profiles(id) on delete set null,
  topic_slug    text not null references public.eu_topics(slug) on delete cascade,
  body          text not null default '',
  answers       jsonb not null default '{}'::jsonb,   -- {dimension_key: value}
  priority      int not null default 3 check (priority between 1 and 5),
  display_name  text not null default '',    -- what to print, when not anonymous
  region        text not null default '',
  contact_email text not null default '',    -- only if they asked to be followed up with
  anonymous     boolean not null default false,
  consent_public boolean not null default true,
  status        text not null default 'new' check (status in ('new', 'approved', 'hidden', 'spam')),
  source        text not null default 'web' check (source in ('web', 'conversation', 'sms', 'import', 'event')),
  conversation_id uuid,
  moderated_by  uuid references public.eu_profiles(id) on delete set null,
  moderated_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists eu_perspectives_topic on public.eu_perspectives (topic_slug, created_at desc);
create index if not exists eu_perspectives_profile on public.eu_perspectives (profile_id, created_at desc);
create index if not exists eu_perspectives_queue on public.eu_perspectives (status, created_at desc);

alter table public.eu_perspectives enable row level security;

-- the front door: anyone may speak
drop policy if exists eu_perspectives_in on public.eu_perspectives;
create policy eu_perspectives_in on public.eu_perspectives
  for insert to anon, authenticated
  with check (
    status = 'new'
    and (profile_id is null or profile_id = auth.uid())
    and length(body) <= 8000
  );

drop policy if exists eu_perspectives_mine on public.eu_perspectives;
create policy eu_perspectives_mine on public.eu_perspectives
  for select to authenticated
  using (profile_id = auth.uid() or public.eu_is_staff());

-- editors moderate; only the owner erases
drop policy if exists eu_perspectives_moderate on public.eu_perspectives;
create policy eu_perspectives_moderate on public.eu_perspectives
  for update to authenticated using (public.eu_is_staff()) with check (public.eu_is_staff());

drop policy if exists eu_perspectives_del on public.eu_perspectives;
create policy eu_perspectives_del on public.eu_perspectives
  for delete to authenticated using (public.eu_is_admin());

create or replace view public.eu_perspectives_public as
select
  v.id, v.topic_slug, v.body, v.answers, v.priority, v.region, v.created_at,
  case when v.anonymous then '' else v.display_name end as display_name,
  case when v.anonymous then null else v.profile_id end as profile_id,
  case when v.anonymous then null else pr.handle end as handle
from public.eu_perspectives v
left join public.eu_profiles pr
  on pr.id = v.profile_id and pr.visibility = 'public' and pr.status = 'active'
where v.status = 'approved' and v.consent_public;

comment on view public.eu_perspectives_public is
  'Approved, consented perspectives with the identity removed at the source when the person asked for anonymity. The wall is this WHERE clause, not a flag some page is trusted to check.';

-- ============================================================
-- 5. CONVERSATIONS
--
-- The conversational half of intake. Every write here goes through the
-- eu-converse edge function on the service role, because the agent's
-- instructions and the model key are secrets and because a conversation
-- half-owned by an anonymous browser is not a thing RLS can reason
-- about. What RLS does guarantee: a signed-in person can read their own
-- threads, staff can read all of them, and nobody else reads anything.
--
-- `status = 'human'` is the escalation. When a person asks for a human,
-- or the agent hits a wall, the thread stops being answered by the
-- model and shows up in the desk queue with assigned_to set.
-- ============================================================

create table if not exists public.eu_conversations (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.eu_profiles(id) on delete set null,
  anon_key    text not null default '',        -- browser-held id for signed-out threads
  topic_slug  text references public.eu_topics(slug) on delete set null,
  channel     text not null default 'web' check (channel in ('web', 'sms', 'email')),
  status      text not null default 'open' check (status in ('open', 'human', 'closed')),
  assigned_to uuid references public.eu_profiles(id) on delete set null,
  signals     jsonb not null default '{}'::jsonb,  -- what the agent heard: interests, goals, region
  summary     text not null default '',
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);

create index if not exists eu_conversations_queue on public.eu_conversations (status, last_at desc);
create index if not exists eu_conversations_profile on public.eu_conversations (profile_id, last_at desc);
create index if not exists eu_conversations_anon on public.eu_conversations (anon_key);

create table if not exists public.eu_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.eu_conversations(id) on delete cascade,
  role            text not null check (role in ('person', 'agent', 'human', 'system')),
  body            text not null,
  author_id       uuid references public.eu_profiles(id) on delete set null,
  meta            jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);

create index if not exists eu_messages_thread on public.eu_messages (conversation_id, at);

alter table public.eu_conversations enable row level security;
alter table public.eu_messages enable row level security;

drop policy if exists eu_conversations_read on public.eu_conversations;
create policy eu_conversations_read on public.eu_conversations
  for select to authenticated
  using (profile_id = auth.uid() or public.eu_is_staff());

drop policy if exists eu_conversations_work on public.eu_conversations;
create policy eu_conversations_work on public.eu_conversations
  for update to authenticated using (public.eu_is_staff()) with check (public.eu_is_staff());

drop policy if exists eu_conversations_del on public.eu_conversations;
create policy eu_conversations_del on public.eu_conversations
  for delete to authenticated using (public.eu_is_admin());

drop policy if exists eu_messages_read on public.eu_messages;
create policy eu_messages_read on public.eu_messages
  for select to authenticated
  using (
    public.eu_is_staff()
    or exists (select 1 from public.eu_conversations c
               where c.id = conversation_id and c.profile_id = auth.uid())
  );

-- a human taking over types into the thread as themselves
drop policy if exists eu_messages_human on public.eu_messages;
create policy eu_messages_human on public.eu_messages
  for insert to authenticated
  with check (public.eu_is_staff() and role = 'human' and author_id = auth.uid());

-- ============================================================
-- 6. THE FELLOWSHIP DIRECTORY
--
-- The reason the platform exists. Three ways a listing gets here:
--   directory — harvested from a public directory (ProFellow and the
--               like); source_name and source_url say where from.
--   host      — a host profile listed their own program.
--   staff     — the desk added it by hand.
--
-- NOTHING IS TRUE UNTIL SOMEBODY CHECKED IT. `verification` starts at
-- 'unverified' and a deadline that has not been confirmed at the source
-- stays null with the wording kept in deadline_note. A directory that
-- invents deadlines is worse than no directory: it makes people miss
-- real ones.
-- ============================================================

create table if not exists public.eu_fellowship_sources (
  id       text primary key,
  name     text not null,
  url      text not null default '',
  note     text not null default '',
  kind     text not null default 'directory' check (kind in ('directory', 'funder', 'university', 'government', 'community')),
  active   boolean not null default true,
  last_swept timestamptz
);

comment on table public.eu_fellowship_sources is
  'Where listings come from. Sweeping is manual for now: the desk works a source, adds what it finds, and stamps last_swept. Automate later, honestly, and only where the terms allow it.';

create table if not exists public.eu_fellowships (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,
  title         text not null,
  org           text not null default '',
  org_profile_id uuid references public.eu_profiles(id) on delete set null,
  summary       text not null default '',
  description   text not null default '',
  url           text not null default '',
  apply_url     text not null default '',
  focus_tags    text[] not null default '{}',
  topic_slugs   text[] not null default '{}',
  audience      text[] not null default '{}',   -- students | early-career | mid-career | any
  location      text not null default '',
  region        text not null default '',
  remote        boolean not null default false,
  stipend       text not null default '',       -- as written by the program, never inferred
  duration      text not null default '',
  deadline      date,
  deadline_note text not null default '',
  eligibility   text not null default '',
  cost          text not null default 'free',
  source        text not null default 'staff' check (source in ('directory', 'host', 'staff')),
  source_id     text references public.eu_fellowship_sources(id) on delete set null,
  source_url    text not null default '',
  verification  text not null default 'unverified' check (verification in ('unverified', 'link-checked', 'verified')),
  verified_at   timestamptz,
  status        text not null default 'pending' check (status in ('draft', 'pending', 'published', 'archived')),
  created_by    uuid references public.eu_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- plain, not lower(slug), for the same reason as handles above: the
-- touch trigger normalizes, and the seed upserts on this constraint
create unique index if not exists eu_fellowships_slug on public.eu_fellowships (slug);
create index if not exists eu_fellowships_status on public.eu_fellowships (status, deadline nulls last);
create index if not exists eu_fellowships_tags on public.eu_fellowships using gin (focus_tags);
create index if not exists eu_fellowships_topics on public.eu_fellowships using gin (topic_slugs);

create or replace function public.eu_fellowships_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.slug := lower(trim(new.slug));
  return new;
end;
$$;

drop trigger if exists eu_fellowships_touch_t on public.eu_fellowships;
create trigger eu_fellowships_touch_t
  before insert or update on public.eu_fellowships
  for each row execute function public.eu_fellowships_touch();

alter table public.eu_fellowships enable row level security;
alter table public.eu_fellowship_sources enable row level security;

drop policy if exists eu_fellowships_read on public.eu_fellowships;
create policy eu_fellowships_read on public.eu_fellowships
  for select to anon, authenticated
  using (status = 'published' or public.eu_is_staff() or created_by = auth.uid() or org_profile_id = auth.uid());

-- A host lists their own program. It arrives pending, never published:
-- self-publishing a listing on somebody else's platform is exactly the
-- hole a directory cannot afford.
drop policy if exists eu_fellowships_host_add on public.eu_fellowships;
create policy eu_fellowships_host_add on public.eu_fellowships
  for insert to authenticated
  with check (
    public.eu_is_staff()
    or (public.eu_role() in ('host', 'member') and created_by = auth.uid()
        and status = 'pending' and source = 'host')
  );

drop policy if exists eu_fellowships_edit on public.eu_fellowships;
create policy eu_fellowships_edit on public.eu_fellowships
  for update to authenticated
  using (public.eu_is_staff() or created_by = auth.uid() or org_profile_id = auth.uid())
  with check (public.eu_is_staff() or created_by = auth.uid() or org_profile_id = auth.uid());

drop policy if exists eu_fellowships_del on public.eu_fellowships;
create policy eu_fellowships_del on public.eu_fellowships
  for delete to authenticated using (public.eu_is_admin());

drop policy if exists eu_sources_read on public.eu_fellowship_sources;
create policy eu_sources_read on public.eu_fellowship_sources
  for select to anon, authenticated using (true);

drop policy if exists eu_sources_admin on public.eu_fellowship_sources;
create policy eu_sources_admin on public.eu_fellowship_sources
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

-- A host editing their own listing must not be able to publish it, and
-- must not be able to launder an unverified claim into a verified one.
-- Same reasoning as the role guard: RLS gates rows, triggers gate columns.
create or replace function public.eu_fellowships_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- Staff, and the service role doing a directory import (no token),
  -- write what they mean to write.
  if public.eu_is_staff() or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.status := old.status;
    new.verification := old.verification;
    new.verified_at := old.verified_at;
    new.source := old.source;
    new.source_id := old.source_id;
  else
    -- A listing from outside the desk lands in the queue no matter what
    -- the client sent. Coerced rather than rejected: an honest host who
    -- posts the form should never see an error for a field they were
    -- never allowed to set in the first place.
    new.status := 'pending';
    new.source := 'host';
    new.verification := 'unverified';
    new.verified_at := null;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists eu_fellowships_guard_t on public.eu_fellowships;
create trigger eu_fellowships_guard_t
  before insert or update on public.eu_fellowships
  for each row execute function public.eu_fellowships_guard();

-- ============================================================
-- 7. WHAT A PERSON DOES WITH THE DIRECTORY
--
-- Saves and an application tracker. The tracker is the "help them
-- execute" half of the promise: a list of fellowships is a bookmark
-- folder, a list with a stage and a deadline is a plan.
-- ============================================================

create table if not exists public.eu_saves (
  profile_id    uuid not null references public.eu_profiles(id) on delete cascade,
  fellowship_id uuid not null references public.eu_fellowships(id) on delete cascade,
  at            timestamptz not null default now(),
  primary key (profile_id, fellowship_id)
);

create table if not exists public.eu_applications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.eu_profiles(id) on delete cascade,
  fellowship_id uuid references public.eu_fellowships(id) on delete set null,
  title         text not null default '',       -- kept even if the listing is archived
  stage         text not null default 'interested'
                check (stage in ('interested', 'drafting', 'submitted', 'interview', 'accepted', 'declined', 'withdrawn')),
  due_on        date,
  notes         text not null default '',
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists eu_applications_mine on public.eu_applications (profile_id, updated_at desc);

alter table public.eu_saves enable row level security;
alter table public.eu_applications enable row level security;

drop policy if exists eu_saves_mine on public.eu_saves;
create policy eu_saves_mine on public.eu_saves
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- An application tracker is a private thing. Editors help with profiles
-- and listings; they do not read somebody's half-written applications.
drop policy if exists eu_applications_mine on public.eu_applications;
create policy eu_applications_mine on public.eu_applications
  for all to authenticated
  using (profile_id = auth.uid() or public.eu_is_admin())
  with check (profile_id = auth.uid() or public.eu_is_admin());

-- ============================================================
-- 8. THE MATCH
--
-- Scored in SQL, on purpose. Matching is a join over tags the database
-- already holds; sending it out to a model would be slower, dearer, and
-- unable to explain itself. Every score comes back with `reasons`, so
-- the page can say WHY a program was suggested instead of asking a
-- person to trust a number.
--
-- The signal is three things stacked:
--   what the person said they care about  (eu_profiles.interests)
--   what they actually spoke on           (topics they filed under)
--   where they are                        (region, softly)
-- ============================================================

create or replace function public.eu_match_fellowships(
  p_profile uuid default null,
  p_limit   int  default 12,
  p_extra   text[] default '{}'
)
returns table (
  fellowship_id uuid,
  slug          text,
  title         text,
  org           text,
  summary       text,
  url           text,
  deadline      date,
  score         numeric,
  reasons       text[]
)
language sql stable security definer set search_path = public
as $$
  with target as (
    select coalesce(p_profile, auth.uid()) as id
  ),
  me as (
    select
      coalesce(p.interests, '{}'::text[]) as interests,
      coalesce(nullif(p.region, ''), '')  as region
    from public.eu_profiles p, target
    where p.id = target.id
  ),
  spoken as (
    select coalesce(array_agg(distinct v.topic_slug), '{}'::text[]) as topics
    from public.eu_perspectives v, target
    where v.profile_id = target.id
  ),
  spoken_tags as (
    select coalesce(array_agg(distinct tg), '{}'::text[]) as tags
    from public.eu_topics t, spoken
    cross join lateral unnest(t.tags) tg
    where t.slug = any (spoken.topics)
  ),
  want as (
    select
      coalesce((select interests from me), '{}'::text[])
        || coalesce((select tags from spoken_tags), '{}'::text[])
        || coalesce(p_extra, '{}'::text[])                 as tags,
      coalesce((select topics from spoken), '{}'::text[])   as topics,
      coalesce((select region from me), '')                 as region
  ),
  scored as (
    select
      f.*,
      array(select unnest(f.focus_tags) intersect select unnest(w.tags)) as hit_tags,
      array(select unnest(f.topic_slugs) intersect select unnest(w.topics)) as hit_topics,
      (w.region <> '' and f.region = w.region) as hit_region,
      (f.deadline is null or f.deadline >= current_date) as open_now
    from public.eu_fellowships f, want w
    where f.status = 'published'
  )
  select
    s.id, s.slug, s.title, s.org, s.summary, s.url, s.deadline,
    round(
      (cardinality(s.hit_tags) * 3.0)
      + (cardinality(s.hit_topics) * 2.5)
      + (case when s.hit_region then 1.5 else 0 end)
      + (case when s.open_now then 1.0 else -2.0 end)
      + (case when s.remote then 0.4 else 0 end)
      + (case when s.verification = 'verified' then 0.6
              when s.verification = 'link-checked' then 0.3 else 0 end)
    , 2) as score,
    (
      select array_remove(array[
        case when cardinality(s.hit_tags) > 0
             then 'Matches what you care about: ' || array_to_string(s.hit_tags, ', ') end,
        case when cardinality(s.hit_topics) > 0
             then 'Works on a topic you spoke on' end,
        case when s.hit_region then 'Runs where you are' end,
        case when s.deadline is not null and s.deadline >= current_date
             then 'Deadline ' || to_char(s.deadline, 'Mon DD, YYYY') end,
        case when s.deadline is null and s.deadline_note <> '' then s.deadline_note end
      ], null)
    ) as reasons
  from scored s
  where cardinality(s.hit_tags) > 0 or cardinality(s.hit_topics) > 0 or s.hit_region
  order by score desc, s.deadline nulls last, s.title
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

comment on function public.eu_match_fellowships(uuid, int, text[]) is
  'Scored fellowship recommendations for a profile, with reasons. p_extra lets a signed-out visitor get matched from tags they picked on the page without an account.';

-- ============================================================
-- 9. OUTREACH — built, and deliberately not armed
--
-- No provider is chosen yet, so nothing here sends anything. What it
-- does is make sending SAFE when a provider is picked: every message
-- has to name the campaign it belongs to, every recipient has to have
-- said yes, and the suppression list is checked in the database rather
-- than in whatever script happens to be running.
--
-- Sending is an admin power. An editor can draft a campaign and can see
-- what went out; an editor cannot press send and cannot touch the
-- suppression list. Those are the two ways an outreach system hurts
-- people, so those are the two the degraded role does not get.
-- ============================================================

create table if not exists public.eu_suppressions (
  id        uuid primary key default gen_random_uuid(),
  channel   text not null check (channel in ('email', 'sms')),
  address   text not null,
  reason    text not null default 'opt-out',
  at        timestamptz not null default now()
);

create unique index if not exists eu_suppressions_addr on public.eu_suppressions (channel, lower(address));

create table if not exists public.eu_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  channel     text not null default 'email' check (channel in ('email', 'sms')),
  topic_slug  text references public.eu_topics(slug) on delete set null,
  body        text not null default '',
  audience    jsonb not null default '{}'::jsonb,   -- the query that picks recipients
  status      text not null default 'draft' check (status in ('draft', 'ready', 'sending', 'sent', 'stopped')),
  provider    text not null default 'none',
  created_by  uuid references public.eu_profiles(id) on delete set null,
  approved_by uuid references public.eu_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.eu_campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.eu_campaigns(id) on delete cascade,
  profile_id  uuid references public.eu_profiles(id) on delete set null,
  address     text not null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed', 'replied')),
  error       text not null default '',
  sent_at     timestamptz,
  unique (campaign_id, address)
);

alter table public.eu_suppressions enable row level security;
alter table public.eu_campaigns enable row level security;
alter table public.eu_campaign_recipients enable row level security;

drop policy if exists eu_suppress_admin on public.eu_suppressions;
create policy eu_suppress_admin on public.eu_suppressions
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

drop policy if exists eu_campaigns_read on public.eu_campaigns;
create policy eu_campaigns_read on public.eu_campaigns
  for select to authenticated using (public.eu_is_staff());

drop policy if exists eu_campaigns_draft on public.eu_campaigns;
create policy eu_campaigns_draft on public.eu_campaigns
  for insert to authenticated
  with check (public.eu_is_admin() or (public.eu_is_staff() and status = 'draft' and created_by = auth.uid()));

drop policy if exists eu_campaigns_work on public.eu_campaigns;
create policy eu_campaigns_work on public.eu_campaigns
  for update to authenticated
  using (public.eu_is_admin() or (public.eu_is_staff() and status = 'draft'))
  with check (public.eu_is_admin() or (public.eu_is_staff() and status = 'draft'));

drop policy if exists eu_campaigns_del on public.eu_campaigns;
create policy eu_campaigns_del on public.eu_campaigns
  for delete to authenticated using (public.eu_is_admin());

drop policy if exists eu_recipients_read on public.eu_campaign_recipients;
create policy eu_recipients_read on public.eu_campaign_recipients
  for select to authenticated using (public.eu_is_staff());

drop policy if exists eu_recipients_admin on public.eu_campaign_recipients;
create policy eu_recipients_admin on public.eu_campaign_recipients
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

-- The approval gate, in the database. An editor can move a campaign as
-- far as their own draft and no further; 'ready' and everything past it
-- needs the owner's hand. Written as a trigger because the transition
-- rule is about the PAIR of states, which a policy cannot see.
create or replace function public.eu_campaigns_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.eu_is_admin() or auth.uid() is null then
    if tg_op = 'UPDATE' and new.status = 'ready' and old.status = 'draft' then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'only the owner moves a campaign out of draft';
  end if;
  new.approved_by := null;
  new.approved_at := null;
  return new;
end;
$$;

drop trigger if exists eu_campaigns_guard_t on public.eu_campaigns;
create trigger eu_campaigns_guard_t
  before insert or update on public.eu_campaigns
  for each row execute function public.eu_campaigns_guard();

-- ============================================================
-- 10. THE AUDIT LOG
--
-- Append-only by construction: there is no update policy and no delete
-- policy on this table, for anyone, including the owner. A log that its
-- most powerful user can quietly edit is a log that proves nothing.
-- ============================================================

create table if not exists public.eu_audit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor_id  uuid,
  actor     text not null default '',
  action    text not null,
  entity    text not null default '',
  entity_id text not null default '',
  detail    jsonb not null default '{}'::jsonb
);

create index if not exists eu_audit_at on public.eu_audit (at desc);
create index if not exists eu_audit_entity on public.eu_audit (entity, entity_id);

alter table public.eu_audit enable row level security;

drop policy if exists eu_audit_read on public.eu_audit;
create policy eu_audit_read on public.eu_audit
  for select to authenticated using (public.eu_is_staff());

drop policy if exists eu_audit_write on public.eu_audit;
create policy eu_audit_write on public.eu_audit
  for insert to authenticated with check (public.eu_is_staff());

create or replace function public.eu_log(
  p_action text, p_entity text default '', p_entity_id text default '', p_detail jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.eu_audit (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'system'), p_action, p_entity, p_entity_id, p_detail);
$$;

-- Moderation is the one thing that logs itself. Everything else is
-- called explicitly; this one is a trigger because "who approved this"
-- must not depend on a page remembering to say so.
create or replace function public.eu_perspectives_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.moderated_by := auth.uid();
    new.moderated_at := now();
    insert into public.eu_audit (actor_id, actor, action, entity, entity_id, detail)
    values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'system'), 'perspective.' || new.status,
            'eu_perspectives', new.id::text, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists eu_perspectives_audit_t on public.eu_perspectives;
create trigger eu_perspectives_audit_t
  before update on public.eu_perspectives
  for each row execute function public.eu_perspectives_audit();

-- ============================================================
-- 11. THE COUNTERS
--
-- The numbers the public pages print. A view, so the page can never
-- show a figure the database does not stand behind.
-- ============================================================

create or replace view public.eu_counts as
select
  (select count(*) from public.eu_profiles where visibility = 'public' and status = 'active') as profiles,
  (select count(*) from public.eu_perspectives where status = 'approved') as perspectives,
  (select count(*) from public.eu_fellowships where status = 'published') as fellowships,
  (select count(*) from public.eu_topics where status = 'active') as topics;

-- ============================================================
-- 12. GRANTS
--
-- RLS decides which ROWS. These decide which TABLES are reachable at
-- all. Anonymous visitors can read the public record and drop a
-- perspective through the front door; they cannot read a profile table,
-- a conversation, or a campaign under any policy, because they were
-- never granted the table.
-- ============================================================

grant select on public.eu_topics, public.eu_fellowships, public.eu_fellowship_sources to anon, authenticated;
grant select on public.eu_profiles_public, public.eu_perspectives_public, public.eu_counts to anon, authenticated;
grant insert on public.eu_perspectives to anon, authenticated;

grant select, insert, update on public.eu_profiles to authenticated;
grant select, insert, update on public.eu_profile_contact to authenticated;
grant select, update on public.eu_perspectives to authenticated;
grant select, update on public.eu_conversations to authenticated;
grant select, insert on public.eu_messages to authenticated;
grant select, insert, update on public.eu_fellowships to authenticated;
grant select, insert, update, delete on public.eu_saves to authenticated;
grant select, insert, update, delete on public.eu_applications to authenticated;
grant select, insert, update on public.eu_campaigns to authenticated;
grant select on public.eu_campaign_recipients to authenticated;
grant select, insert on public.eu_audit to authenticated;
grant delete on public.eu_profiles, public.eu_perspectives, public.eu_fellowships,
      public.eu_conversations, public.eu_campaigns to authenticated;
grant all on public.eu_suppressions to authenticated;
grant usage, select on sequence public.eu_audit_id_seq to authenticated;

grant execute on function public.eu_match_fellowships(uuid, int, text[]) to anon, authenticated;
grant execute on function public.eu_role(), public.eu_is_admin(), public.eu_is_staff() to anon, authenticated;
grant execute on function public.eu_log(text, text, text, jsonb) to authenticated;

-- ============================================================
-- SELF-CHECK — expect rls_on = 14 and tables = 14. Any gap between the
-- two columns is a table somebody added without a wall behind it.
-- ============================================================
select
  count(*) filter (where c.relrowsecurity) as rls_on,
  count(*) as tables
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'eu\_%';
