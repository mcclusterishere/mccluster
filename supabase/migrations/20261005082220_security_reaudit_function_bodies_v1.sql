-- Item 8 security re-audit (2026-10-05): two function bodies.

-- eu_log ran as its owner, so any signed-in account could write arbitrary
-- rows into eu_audit even though the table's own insert policy admits
-- staff only. As SECURITY INVOKER the eu_audit_write policy decides: the
-- staff desk keeps logging, everyone else is refused.
alter function public.eu_log(text, text, text, jsonb) security invoker;

-- eu_match_fellowships(p_profile) read the interests, region and spoken
-- topics of whatever profile id it was handed and echoed the overlap in
-- `reasons`, including for private profiles. The profile now has to be the
-- caller's own, a public active profile, or a service-role request (the
-- eu-converse agent matching on behalf of its conversation). Anything else
-- matches on p_extra alone. The rest of the body is unchanged.
create or replace function public.eu_match_fellowships(
  p_profile uuid default null::uuid,
  p_limit integer default 12,
  p_extra text[] default '{}'::text[]
)
returns table(fellowship_id uuid, slug text, title text, org text, summary text, url text, deadline date, score numeric, reasons text[])
language sql
stable security definer
set search_path to 'public'
as $function$
  with target as (
    select case
      when p_profile is null or p_profile = auth.uid() then auth.uid()
      when auth.role() = 'service_role' then p_profile
      when exists (
        select 1 from public.eu_profiles v
        where v.id = p_profile and v.visibility = 'public' and v.status = 'active'
      ) then p_profile
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

