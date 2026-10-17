\set ON_ERROR_STOP on
insert into m_people values('11111111-1111-4111-8111-111111111111','active'),('22222222-2222-4222-8222-222222222222','active');
insert into orgs values('11111111-1111-4111-8111-111111111111');
insert into creator_site_access(owner_m_uid,org_id,basis,source_reference,expires_at,enabled,preparation_budget_microusd)
values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','pilot','isolated-test',now()+interval '1 hour',true,100000);
set role service_role;
select public.studio_save_v2('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',0,
 (select definition from creator_site_template_versions where template_key='motion-portfolio' and version=1));
do $$ begin
 begin perform public.studio_save_v2('22222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,
 (select definition from creator_site_template_versions where template_key='motion-portfolio' and version=1));raise exception 'cross-owner save succeeded';exception when serialization_failure then null;end;
 begin perform public.studio_save_v2('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,
 (select definition from creator_site_template_versions where template_key='motion-portfolio' and version=1));raise exception 'stale save succeeded';exception when serialization_failure then null;end;
end $$;
select public.studio_publish_v2('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',1);
do $$ begin if (select count(*) from creator_site_revisions)<>1 then raise exception 'revision missing';end if;end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$ begin if (select count(*) from creator_site_drafts)<>0 then raise exception 'cross-owner draft read';end if;
 begin perform public.studio_publish_v2('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',1);raise exception 'browser called private writer';exception when insufficient_privilege then null;end;
 begin update creator_site_drafts set owner_m_uid='22222222-2222-4222-8222-222222222222';raise exception 'browser reassigned owner';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ begin if (select count(*) from creator_site_drafts)<>1 then raise exception 'owner cannot read draft';end if;end $$;
reset role;set role anon;
do $$ begin begin perform count(*) from creator_site_drafts;raise exception 'anonymous read';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'Studio PostgreSQL role/revision checks passed' as result;
