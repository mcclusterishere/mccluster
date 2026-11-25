-- Pending. Keep the returned rollback_receipt with the release evidence.
-- The source catalogue bills the track to Equity Uprise. Its database row stores the shorter credit line.
with target(slug, roles) as (values
  ('docket-516r-scar-stories', array['Featured performer','Producer']),
  ('docket-516r-money-or-the-power', array['Producer'])
), locked as materialized (
  select w.project_slug, w.slug, w.public_data->'credits' as credits, t.roles
    from public.action_archive_works w join target t on t.slug = w.slug
   where w.project_slug = 'docket-516r-2025' and jsonb_typeof(w.public_data->'credits') = 'array'
   order by w.slug for update of w
), renamed as (
  select l.*, (select jsonb_agg(case
      when credit->>'participant_slug' = 'paxton-cobb' and credit->>'role' = any(l.roles)
           and credit->>'display_name' = 'PAX'
      then jsonb_set(credit, '{display_name}', to_jsonb('Pax Tha Collector'::text))
      else credit end order by position)
    from jsonb_array_elements(l.credits) with ordinality c(credit, position)) as new_credits
  from locked l
), archive_changes as (
  update public.action_archive_works w
     set public_data = jsonb_set(w.public_data, '{credits}', r.new_credits)
    from renamed r
   where w.project_slug = r.project_slug and w.slug = r.slug and r.new_credits <> r.credits
  returning w.slug, r.credits as before, r.new_credits as after
), catalog_change as (
  update public.music_catalog_objects
     set credit_line='ft. Ocho, McCluster & Old Jay · prod. Pax Tha Collector', updated_at=now()
   where catalog_key='equity-uprise:money-or-the-power' and credit_line='ft. Ocho, McCluster & Old Jay · prod. PAX'
  returning catalog_key
)
select jsonb_build_object(
  'catalog_changed', exists (select from catalog_change),
  'works', coalesce((select jsonb_agg(to_jsonb(a) order by a.slug) from archive_changes a), '[]'::jsonb)
) as rollback_receipt;
