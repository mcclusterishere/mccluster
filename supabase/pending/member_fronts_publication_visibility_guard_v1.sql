-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- PENDING visibility correction; prerequisite is the recorded shared-revision directory.
-- Reapply restores only save admission paused by the matching recovery file.
-- Known function bodies and exact ACL/comment state are required in either direction.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $reviewed_functions$
declare expected jsonb; actual record; function_oid oid;
begin
  for expected in select value from jsonb_array_elements('[{"signature":"member_fronts_private.save(jsonb,integer,boolean,boolean)","name":"member_fronts_private.save","hashes":["57d6843a757e4aaf72260ffa1b903b8b43b9bab11cc566e6b39dab227015f3aa","b561c9eeb3115dbe57736ad6748de78c69e1160a08ca1a9b8a34bc057b0d0dc9"],"language":"plpgsql","definer":true,"volatility":"v","search_path":"search_path=\"\"","args":["p_config","p_expected_revision","p_publish","p_globe_opt_in"],"default_count":0,"defaults":"","returns":"jsonb"},{"signature":"public.member_front_save(jsonb,integer,boolean,boolean)","name":"public.member_front_save","hashes":["313fb3d456caf0deb0826c899bdfbd9fabac50c9e4a55cc29880db1df5e008ea"],"language":"sql","definer":false,"volatility":"v","search_path":"search_path=\"\"","args":["p_config","p_expected_revision","p_publish","p_globe_opt_in"],"default_count":0,"defaults":"","returns":"jsonb"}]'::jsonb) loop
    function_oid:=to_regprocedure(expected->>'signature');
    if function_oid is null then
      if coalesce((expected->>'allow_absent')::boolean,false) then continue; end if;
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_CHANGED: missing reviewed function '||(expected->>'signature');
    end if;
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=function_oid;
    if not (expected->'hashes' ? encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex'))
      or actual.lanname<>expected->>'language' or actual.prosecdef is distinct from (expected->>'definer')::boolean
      or actual.provolatile::text<>expected->>'volatility' or actual.proparallel<>'u'
      or actual.proconfig is distinct from array[expected->>'search_path']
      or to_jsonb(coalesce(actual.proargnames,'{}'::text[])) is distinct from expected->'args'
      or actual.pronargdefaults<>(expected->>'default_count')::integer
      or coalesce(pg_get_expr(actual.proargdefaults,0),'')<>expected->>'defaults'
      or actual.prorettype<>(expected->>'returns')::regtype or actual.proretset
      or actual.prokind<>'f' or actual.proisstrict or actual.proleakproof
      or pg_get_userbyid(actual.proowner)<>'postgres' then
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_CHANGED: reviewed function changed '||(expected->>'signature');
    end if;
  end loop;

end $reviewed_functions$;
do $save_admission$
declare function_oid oid; api_grants integer; mode text; observed text; comment_value text;
begin
  foreach function_oid in array array['public.member_front_save(jsonb,integer,boolean,boolean)'::regprocedure,'member_fronts_private.save(jsonb,integer,boolean,boolean)'::regprocedure] loop
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=function_oid and (a.grantor<>'postgres'::regrole or a.grantee not in('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
        or a.privilege_type<>'EXECUTE' or (a.grantee<>'postgres'::regrole and a.is_grantable))) then
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: unreviewed execute grant';
    end if;
    select count(*) into api_grants from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=function_oid and a.grantee in('authenticated'::regrole,'service_role'::regrole) and a.privilege_type='EXECUTE';
    if api_grants not in(0,2) then raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: partial admission'; end if;
    observed:=case when api_grants=2 then 'active' else 'paused' end;
    if mode is not null and mode<>observed then raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: entry points differ'; end if;
    mode:=observed;
  end loop;
  comment_value:=obj_description('public.member_front_save(jsonb,integer,boolean,boolean)'::regprocedure,'pg_proc');
  if (mode='active' and comment_value is not null) or (mode='paused' and comment_value is distinct from 'mccluster-member-front-visibility-recovery/1: save-paused') then
    raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: unrelated comment or ACL change';
  end if;
  if mode='paused' and not exists(select 1 from pg_proc where oid='member_fronts_private.save(jsonb,integer,boolean,boolean)'::regprocedure and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b561c9eeb3115dbe57736ad6748de78c69e1160a08ca1a9b8a34bc057b0d0dc9') then
    raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: paused state lacks the visibility guard';
  end if;
end $save_admission$;

create or replace function member_fronts_private.save(p_config jsonb,p_expected_revision integer,p_publish boolean,p_globe_opt_in boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i jsonb:=member_fronts_private.identity();u uuid;m uuid;f public.member_fronts%rowtype;rev integer;ref text;object_path text;profile_visibility text;
begin
 if not(i->>'ok')::boolean then return i; end if;
 u:=(i->>'auth_user_id')::uuid;m:=(i->>'m_uid')::uuid;
 if p_expected_revision is null or p_expected_revision<0 or p_publish is null or p_globe_opt_in is null or not member_fronts_private.config_valid(p_config,u) then return jsonb_build_object('ok',false,'code','invalid_config','error','Use valid page settings and an expected revision.'); end if;
 perform member_fronts_private.lock_media(u);
 perform member_fronts_private.lock_page(m);
 select * into f from public.member_fronts where m_uid=m for update;rev:=coalesce(f.revision,0);
 if f.auth_user_id is not null and f.auth_user_id<>u then return jsonb_build_object('ok',false,'code','forbidden','error','This linked identity has a different page owner.'); end if;
 if p_expected_revision<>rev then return jsonb_build_object('ok',false,'code','revision_conflict','error','This page changed. Reload before saving.','current_revision',rev); end if;
 if rev=2147483647 then return jsonb_build_object('ok',false,'code','revision_limit','error','This page needs operator attention.'); end if;
 if p_publish and f.removed_at is not null then return jsonb_build_object('ok',false,'code','removed','error','This page was taken down and cannot be published.'); end if;
 -- The public reader already requires a public profile. Refuse publication
 -- before any page change instead of returning success for an invisible page.
 -- Hold this profile row until the save finishes so a visibility change cannot
 -- race the eligibility decision; draft-only saves still need no public profile.
 if p_publish then
  select visibility into profile_visibility from public.network_profiles where m_uid=m for share;
  if not found then return jsonb_build_object('ok',false,'code','profile_required','error','Complete your profile before publishing your front page.'); end if;
  if profile_visibility is distinct from 'public' then return jsonb_build_object('ok',false,'code','profile_not_public','error','Make your profile public before publishing your front page.'); end if;
 end if;
 for ref in select * from member_fronts_private.media_refs(p_config) loop
  object_path:=substring(ref from length('https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/')+1);
  if not exists(select 1 from storage.objects o where o.bucket_id='front-media' and (o.name=object_path or (right(object_path,1)='/' and left(o.name,length(object_path))=object_path))) then
   return jsonb_build_object('ok',false,'code','media_missing','error','An uploaded page asset is missing. Upload it again before saving.');
  end if;
 end loop;
 insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at,published_revision,revision,globe_opt_in,globe_consented_at)
 values(m,u,i->>'handle',p_config,case when p_publish then p_config end,case when p_publish then now() end,case when p_publish then rev+1 end,rev+1,p_globe_opt_in,case when p_globe_opt_in then now() end)
 on conflict(m_uid) do update set handle=excluded.handle,draft=excluded.draft,
 published=case when p_publish then excluded.published else member_fronts.published end,
 published_at=case when p_publish then excluded.published_at else member_fronts.published_at end,
 published_revision=case when p_publish then excluded.published_revision else member_fronts.published_revision end,
 revision=excluded.revision,updated_at=now(),globe_opt_in=excluded.globe_opt_in,
 globe_consented_at=case when excluded.globe_opt_in then coalesce(member_fronts.globe_consented_at,now()) end;
 return member_fronts_private.self_result(i);
end $$;
grant execute on function public.member_front_save(jsonb,integer,boolean,boolean),member_fronts_private.save(jsonb,integer,boolean,boolean) to authenticated,service_role;
comment on function public.member_front_save(jsonb,integer,boolean,boolean) is null;
notify pgrst,'reload schema';
