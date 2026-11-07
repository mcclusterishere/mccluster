\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare s jsonb; d jsonb; p jsonb; first_id text; c jsonb:='{"version":1,"widgets":{"summary":{"configured":false}}}';
begin
 s:=public.owner_widget_snapshot_v1('fixture');assert s->>'revision'='0';
 d:=public.owner_widget_edit_v1('fixture','save','0',null,c);assert d->'value'='null'::jsonb;
 p:=public.owner_widget_edit_v1('fixture','preview','0',d#>>'{draft,revision}',c);assert p->'grants_access'='false'::jsonb;
 begin perform public.owner_widget_edit_v1('fixture','save','0',null,c);raise exception 'stale save accepted';exception when serialization_failure then null;end;
 s:=public.owner_widget_edit_v1('fixture','publish','0',d#>>'{draft,revision}');assert s->'value'=c;first_id:=s->>'revision';
 d:=public.owner_widget_edit_v1('fixture','save',s->>'revision',null,'{"version":1,"widgets":{}}');
 s:=public.owner_widget_edit_v1('fixture','publish',s->>'revision',d#>>'{draft,revision}');
 d:=public.owner_widget_edit_v1('fixture','restore',s->>'revision',null,null,first_id);assert d#>'{draft,config}'=c;assert d#>'{value,widgets}'='{}'::jsonb;
 begin perform public.owner_widget_edit_v1('other','restore','0',null,null,first_id);raise exception 'cross-app restore accepted';exception when invalid_parameter_value then null;end;
 begin perform public.owner_widget_edit_v1('fixture','save',s->>'revision',d#>>'{draft,revision}','{"version":1,"widgets":{"x":{"configured":true}}}');raise exception 'activation accepted';exception when invalid_parameter_value then null;end;
 begin perform public.owner_widget_edit_v1('fixture','save',s->>'revision',d#>>'{draft,revision}','{"version":1,"widgets":{"x":{"configured":false,"plans":{}}}}');raise exception 'plans accepted';exception when invalid_parameter_value then null;end;
 begin perform 1 from public.owner_widget_history;raise exception 'direct table read accepted';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$begin
 begin perform public.owner_widget_snapshot_v1(null);raise exception 'nonowner read accepted';exception when insufficient_privilege then null;end;
 begin perform public.owner_widget_edit_v1('fixture','discard','0',null);raise exception 'nonowner write accepted';exception when insufficient_privilege then null;end;
end $$;
set role anon;
do $$begin
 begin perform public.owner_widget_snapshot_v1(null);raise exception 'anon accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 assert (select settings->>'preserve'='unchanged' from platform_apps where app_key='fixture');
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='owner_widget_drafts'::regclass);
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='owner_widget_history'::regclass);
end $$;
update orgs set enabled=false;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$begin
 begin perform public.owner_widget_snapshot_v1(null);raise exception 'disabled owner accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
update orgs set enabled=true;
\echo 'PASS native owner lifecycle, validation, history, RLS and role boundaries'
