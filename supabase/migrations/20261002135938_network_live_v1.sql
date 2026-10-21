-- Live on the Action Network. Matthew and accepted fellows can broadcast;
-- everyone can watch. Video runs through Cloudflare Stream (WebRTC: WHIP in,
-- WHEP out). The Worker creates one Stream live input per broadcast and deletes
-- it when the broadcast ends, so a publish URL is never reused. The publish
-- URL is a credential and is never stored here; only the public playback URL is.
create table if not exists public.network_live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_m_uid uuid not null,
  host_user_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  status text not null default 'starting' check (status in ('starting', 'live', 'ended')),
  cf_input_uid text,
  whep_url text,
  post_id uuid references public.network_posts(id) on delete set null,
  started_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text,
  created_at timestamptz not null default now()
);
create index if not exists network_live_sessions_live_idx on public.network_live_sessions (last_seen_at desc) where status = 'live';
create index if not exists network_live_sessions_host_idx on public.network_live_sessions (host_user_id, created_at desc);
create index if not exists network_live_sessions_post_idx on public.network_live_sessions (post_id) where post_id is not null;
alter table public.network_live_sessions enable row level security;
revoke all on table public.network_live_sessions from public, anon, authenticated;
grant all on table public.network_live_sessions to service_role;
-- Viewers read only the public columns, and only broadcasts that are on air:
-- live, with a heartbeat from the broadcaster in the last two minutes.
grant select (id, host_m_uid, title, status, whep_url, post_id, started_at, last_seen_at) on public.network_live_sessions to anon, authenticated;
create policy "anyone sees broadcasts that are on air" on public.network_live_sessions
  for select to anon, authenticated
  using (status = 'live' and last_seen_at > now() - interval '2 minutes');

-- Who may go live: the owner desk, or an accepted fellow.
create or replace function public.live_can_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    (select public.eu_is_admin())
    or exists (select 1 from public.action_fellowship_applications f
               where f.user_id = auth.uid() and f.status = 'accepted')
  );
$$;
revoke all on function public.live_can_host() from public, anon;
grant execute on function public.live_can_host() to authenticated;
