-- Rollback of network_media_assets_pointer_guard_v1.sql.
--
-- Puts public.network_media_assets and the mnet-media Storage policies back to
-- what production held before it (docs/control-plane/evidence/
-- production-schema-snapshot-2026-11-03.json; the test compares the restored
-- policy expressions, constraints, columns and grants with that evidence, hash
-- for hash): members write their own rows and their own objects again. That
-- REOPENS what the guard closed: a member can repoint, re-create or re-status a
-- reviewed upload's row and overwrite or delete its bytes. Use it to back out a
-- broken apply, not as a steady state.
--
-- What it keeps: public.network_media_asset_owner_moves when it holds any row.
-- That table is the only record of which uploads followed an identity merge;
-- the owner_m_uid values it explains stay as they are. An empty table is
-- dropped, so apply -> rollback with no merge in between leaves nothing behind.
-- Safe to run twice, and safe on a database the guard was never applied to.
begin;
set local lock_timeout = '5s';

drop trigger if exists network_media_assets_guard_trg on public.network_media_assets;
alter table public.network_media_assets drop constraint if exists network_media_assets_canonical_upload_check;

-- The three owner policies and the grant, exactly as
-- supabase/migrations/20260920071811_mnet_real_network_v1.sql created them.
drop policy if exists network_media_owner_insert on public.network_media_assets;
create policy network_media_owner_insert on public.network_media_assets for insert to authenticated
with check (owner_m_uid=public.current_m_uid());
drop policy if exists network_media_owner_update on public.network_media_assets;
create policy network_media_owner_update on public.network_media_assets for update to authenticated
using (owner_m_uid=public.current_m_uid()) with check (owner_m_uid=public.current_m_uid());
drop policy if exists network_media_owner_delete on public.network_media_assets;
create policy network_media_owner_delete on public.network_media_assets for delete to authenticated
using (owner_m_uid=public.current_m_uid());
grant insert, update, delete on public.network_media_assets to authenticated;

-- The three Storage policies, exactly as the same migration created them.
drop policy if exists "mnet media owner upload" on storage.objects;
create policy "mnet media owner upload" on storage.objects for insert to authenticated
with check (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "mnet media owner update" on storage.objects;
create policy "mnet media owner update" on storage.objects for update to authenticated
using (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "mnet media owner delete" on storage.objects;
create policy "mnet media owner delete" on storage.objects for delete to authenticated
using (bucket_id='mnet-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop function if exists public.network_media_assets_follow_merge(uuid, uuid, text);
drop function if exists public.network_media_assets_guard();
drop function if exists public.network_media_owner_move_recorded(uuid, uuid, uuid);
drop function if exists public.network_media_upload_owned_by(text, text, uuid);
drop function if exists public.network_media_canonical_uploader(text, text);

-- The record of owner moves: dropped when empty, kept (append-only trigger
-- gone with its function, still closed to every API role) when it has rows.
do $r$
declare v_rows boolean;
begin
  if to_regclass('public.network_media_asset_owner_moves') is null then
    return;
  end if;
  execute 'select exists (select 1 from public.network_media_asset_owner_moves)' into v_rows;
  if v_rows then
    execute 'drop trigger if exists network_media_asset_owner_moves_append_only_trg on public.network_media_asset_owner_moves';
    raise notice 'network_media_asset_owner_moves has rows and was kept: it is the record of uploads that followed an identity merge';
  else
    execute 'drop table public.network_media_asset_owner_moves';
  end if;
end $r$;
drop function if exists public.network_media_asset_owner_moves_append_only();

commit;
