-- Use the forward application's rollback_receipt in this session:
-- SELECT set_config('mccluster.pax_stage_name_receipt', <receipt JSON as text>, false);
-- A missing receipt raises an error. Never reverse a previously correct display name.
with receipt as materialized (
  select current_setting('mccluster.pax_stage_name_receipt')::jsonb as data
), catalog_restore as (
  update public.music_catalog_objects
     set credit_line='ft. Ocho, McCluster & Old Jay · prod. PAX', updated_at=now()
    from receipt
   where receipt.data->'catalog_changed' = 'true'::jsonb
     and catalog_key='equity-uprise:money-or-the-power' and credit_line='ft. Ocho, McCluster & Old Jay · prod. Pax Tha Collector'
  returning catalog_key
), archived as (
  select work.* from receipt,
    jsonb_to_recordset(receipt.data->'works') as work(slug text, before jsonb, after jsonb)
)
update public.action_archive_works w
   set public_data = jsonb_set(w.public_data, '{credits}', a.before)
  from archived a
 where w.project_slug = 'docket-516r-2025' and w.slug = a.slug
   and w.slug in ('docket-516r-scar-stories','docket-516r-money-or-the-power')
   and w.public_data->'credits' = a.after and a.before <> a.after;
