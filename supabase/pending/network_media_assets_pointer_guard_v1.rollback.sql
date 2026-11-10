-- Rollback of network_media_assets_pointer_guard_v1.sql.
--
-- Puts public.network_media_assets and the mnet-media Storage policies back to
-- what production held before the guard (docs/control-plane/evidence/
-- production-schema-snapshot-2026-11-03.json; the test compares the restored
-- policy expressions, constraints, columns and grants with that evidence, hash
-- for hash): members write their own rows and their own objects again. That
-- REOPENS what the guard closed: a member can repoint, re-create or re-status a
-- reviewed upload's row and overwrite or delete its bytes. Use it to back out a
-- broken apply, not as a steady state.
--
-- It restores production's state, not "whatever was there": the three owner
-- policies and the three Storage policies are written exactly as
-- supabase/migrations/20260920071811_mnet_real_network_v1.sql wrote them, and
-- authenticated gets INSERT, UPDATE and DELETE back (not TRUNCATE, REFERENCES
-- or TRIGGER, which production does not hold). So it does nothing at all on a
-- database the guard is not applied to: it must not rewrite the grants and
-- policies of a database that was never guarded, or that was already rolled
-- back. Safe to run twice.
--
-- What it keeps: public.network_media_asset_owner_moves when it holds any row,
-- with its append-only triggers. That table is the only record of which uploads
-- followed an identity merge; the owner_m_uid values it explains stay as they
-- are. An empty table is dropped, so apply -> rollback with no merge in between
-- leaves nothing behind.
begin;
set local lock_timeout = '5s';

do $rollback$
declare
  v_rows boolean := false;
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.network_media_assets'::regclass
                    and t.tgname in ('network_media_assets_guard_trg', 'network_media_assets_guard_truncate_trg'))
     and not exists (select 1 from pg_constraint k
                      where k.conrelid = 'public.network_media_assets'::regclass
                        and k.conname = 'network_media_assets_canonical_upload_check')
     and to_regprocedure('public.network_media_assets_guard()') is null then
    raise notice 'network_media_assets_pointer_guard_v1 is not applied here: nothing was rolled back';
    return;
  end if;

  lock table public.network_media_assets in access exclusive mode;
  drop trigger if exists network_media_assets_guard_trg on public.network_media_assets;
  drop trigger if exists network_media_assets_guard_truncate_trg on public.network_media_assets;
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

  -- The record of owner moves: dropped when empty; kept, still append-only,
  -- still closed to every API role, when it has rows.
  if to_regclass('public.network_media_asset_owner_moves') is not null then
    execute 'select exists (select 1 from public.network_media_asset_owner_moves)' into v_rows;
  end if;
  if v_rows then
    raise notice 'network_media_asset_owner_moves has rows and was kept, append-only: it is the record of uploads that followed an identity merge';
  else
    drop table if exists public.network_media_asset_owner_moves;
    drop function if exists public.network_media_asset_owner_moves_append_only();
  end if;
end $rollback$;

commit;
