-- ============================================================
-- TWO SECURITY DEFINER FUNCTIONS THE ANON ROLE COULD CALL
--
-- Found by running Supabase's own security advisors — which, as far as
-- the repo shows, had never been run. Both were verified by direct
-- unauthenticated request against production on 2026-09-08 using only
-- the publishable key, which is in the page source of every site.
-- ============================================================


-- ------------------------------------------------------------
-- 1. eu_log — an anonymous stranger could write your audit log,
--    AS 'system'
--
-- The body is:
--
--   insert into public.eu_audit (actor_id, actor, action, entity, ...)
--   values (auth.uid(), coalesce(auth.jwt() ->> 'email', 'system'), ...)
--
-- For an anonymous caller `auth.uid()` is null and the coalesce falls
-- through to the literal 'system'. So a stranger's forged entries are
-- not merely present in the audit log — they are ATTRIBUTED TO THE
-- PLATFORM ITSELF, and are indistinguishable from real platform action.
--
-- That is the one thing an audit log may never permit. A log that can
-- be written by the people it is meant to hold accountable is not
-- evidence of anything, and its value is destroyed retroactively: once
-- forgery is possible, no earlier row can be trusted either.
--
-- Verified live: an unauthenticated POST to /rest/v1/rpc/eu_log returned
-- 204 and eu_audit went from 0 rows to 1. That probe row is removed
-- below.
--
-- The fix is to revoke the anon grant, not to change the function.
-- `authenticated` keeps it, which is the only caller that was ever
-- meaningful — js/eu-api.js exposes log() among the admin operations,
-- and its rpc() helper attaches the signed-in token when there is one.
-- ------------------------------------------------------------
-- Revoking from `anon` alone does NOTHING: Postgres grants EXECUTE on a
-- new function to PUBLIC by default, and `anon` inherits it from there.
-- The first attempt at this migration did exactly that and the check at
-- the bottom refused it — which is the whole reason that check exists.
-- Revoke the PUBLIC grant, then hand it back to the two roles that
-- should have it.
revoke execute on function public.eu_log(text, text, text, jsonb) from public, anon;
grant  execute on function public.eu_log(text, text, text, jsonb) to authenticated, service_role;

-- Remove the row the verification probe wrote, so the table is back to
-- what it was. Scoped tightly: only a 'probe' action by nobody.
delete from public.eu_audit
 where action = 'probe' and entity = 'probe' and actor_id is null and actor = 'system';


-- ------------------------------------------------------------
-- 2. eu_match_fellowships — p_profile was whoever you named
--
-- The function opens with:
--
--   with target as (select coalesce(p_profile, auth.uid()) as id)
--
-- and then reads that profile's `interests` and `region` from
-- eu_profiles, plus the topics they have spoken on from
-- eu_perspectives. Being SECURITY DEFINER, it does that regardless of
-- RLS, and the anon role may call it.
--
-- It does not return the profile row, which is why this looks safe at a
-- glance. But it returns `reasons`, and one of those reads:
--
--   'Matches what you care about: ' || array_to_string(s.hit_tags, ', ')
--
-- so a caller who knows a profile uuid gets that person's interest tags
-- back as plain text. eu_profiles has zero rows today, so this is not
-- currently exploitable — it is a disclosure that switches on the day
-- the first real person signs up.
--
-- ANON ACCESS IS DELIBERATE AND IS KEPT. js/eu-api.js calls this with
-- p_profile null and p_extra set from tags a signed-out visitor ticked
-- on the page, and the comment there is explicit that no account should
-- be required to get a real answer. Revoking would delete a working
-- public feature to fix a bug that is really about one parameter.
--
-- So the parameter is constrained instead: p_profile is honoured when
-- it is your own id, or when the caller is the service role (the
-- eu-converse edge function passes a specific profile). Anything else
-- falls back to auth.uid() — which for an anonymous visitor is null,
-- giving exactly today's public behaviour: matched on p_extra alone.
-- ------------------------------------------------------------
create or replace function public.eu_match_fellowships(
  p_profile uuid default null::uuid,
  p_limit integer default 12,
  p_extra text[] default '{}'::text[]
)
returns table(
  fellowship_id uuid, slug text, title text, org text, summary text,
  url text, deadline date, score numeric, reasons text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with target as (
    -- The only change from the original. Naming someone else's profile
    -- no longer reads it.
    select case
             when p_profile is not null
                  and (p_profile = auth.uid() or coalesce(auth.role(), '') = 'service_role')
               then p_profile
             else auth.uid()
           end as id
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
$function$;


-- ------------------------------------------------------------
-- 3. out_lower_address — pin the search_path
--
-- A trigger function with no `search_path` set. It is SECURITY INVOKER,
-- so this is hardening rather than a hole: it runs as whoever fired the
-- trigger, and a role with a hostile search_path could shadow `lower`
-- or `trim`. Pinning it costs nothing and removes the question.
-- ------------------------------------------------------------
create or replace function public.out_lower_address()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.address := lower(trim(new.address));
  return new;
end $function$;


-- ------------------------------------------------------------
-- 4. Verify.
-- ------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.eu_log(text, text, text, jsonb)', 'execute') then
    raise exception 'anon can still write the audit log';
  end if;

  -- The public discovery feature must survive the change.
  if not has_function_privilege('anon', 'public.eu_match_fellowships(uuid, integer, text[])', 'execute') then
    raise exception 'anon lost fellowship matching; the signed-out discovery page is now broken';
  end if;

  if exists (select 1 from public.eu_audit where action = 'probe' and actor = 'system' and actor_id is null) then
    raise exception 'verification probe row was not cleaned up';
  end if;
end $$;
