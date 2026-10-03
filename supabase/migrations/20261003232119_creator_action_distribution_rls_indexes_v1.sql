-- Creator/action cleanup: separate write policies from read so owners do
-- not accumulate two permissive SELECT policies, and cover every new FK used
-- by joins/deletes.
drop policy if exists social_content_items_write on public.social_content_items;

create policy social_content_items_insert on public.social_content_items
  for insert to authenticated
  with check (private.is_org_owner(org_id));

create policy social_content_items_update on public.social_content_items
  for update to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));

create policy social_content_items_delete on public.social_content_items
  for delete to authenticated
  using (private.is_org_owner(org_id));

create index if not exists social_content_mission_idx
  on public.social_content_items(action_mission_id)
  where action_mission_id is not null;
create index if not exists social_content_publisher_idx
  on public.social_content_items(publisher_m_uid)
  where publisher_m_uid is not null;
create index if not exists social_content_created_by_idx
  on public.social_content_items(created_by)
  where created_by is not null;
create index if not exists social_content_source_asset_idx
  on public.social_content_items(source_asset_id)
  where source_asset_id is not null;

comment on function public.join_action_mission_attributed(uuid,uuid,text) is
  'Authenticated member command. SECURITY DEFINER is intentional: it delegates to the canonical server-authoritative mission join, validates the content-to-mission relation, and only writes attribution onto the caller own assignment.';

comment on function public.action_offer_cards(uuid[]) is
  'Authenticated read projection for mission offers attached to already-visible network post ids. SECURITY DEFINER is intentional so ordinary network members can see the bounded public mission card without gaining direct access to the operator-owned social_content_items table.';
