\set ON_ERROR_STOP on
insert into m_people values('11111111-1111-4111-8111-111111111111','active'),('22222222-2222-4222-8222-222222222222','active');
insert into orgs(id,slug,name) values('11111111-1111-4111-8111-111111111111','studio-test-org','Studio test org');
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
-- The same grant's owner can republish the same immutable revision idempotently.
select public.studio_publish_v2('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',1);
do $$ begin if (select count(*) from public.creator_site_revisions)<>1 then raise exception 'idempotent republish duplicated revision';end if;end $$;

-- A different owner with a valid grant in the same org must NOT replace the
-- first owner's existing published revision, even when writes are serialized.
insert into public.creator_site_access(owner_m_uid,org_id,basis,source_reference,expires_at,enabled)
 values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','pilot','isolated-test',now()+interval '1 hour',true);
select public.studio_save_v2('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',0,
 (select definition from public.creator_site_template_versions where template_key='motion-portfolio' and version=1));
do $$ begin
 begin
  perform public.studio_publish_v2('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1);
  raise exception 'cross-owner publication takeover succeeded';
 exception when insufficient_privilege then null; end;
 if (select owner_m_uid from public.creator_site_revisions where id=(select studio_revision_id from public.creator_published_sites where org_id='11111111-1111-4111-8111-111111111111'))<>'11111111-1111-4111-8111-111111111111'::uuid
 then raise exception 'cross-owner publication replaced prior revision';end if;
end $$;

-- A legacy site with no Studio revision likewise requires a reviewed handoff.
insert into public.orgs(id,slug,name) values('33333333-3333-4333-8333-333333333333','legacy-test-org','Legacy site owner');
insert into public.creator_published_sites(org_id,slug,title)
 values('33333333-3333-4333-8333-333333333333','legacy-owned-site','Do not overwrite');
update public.creator_site_access set org_id='33333333-3333-4333-8333-333333333333'
 where owner_m_uid='22222222-2222-4222-8222-222222222222';
do $$ begin
 begin
  perform public.studio_publish_v2('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1);
  raise exception 'legacy publication overwritten';
 exception when insufficient_privilege then null; end;
 if (select title from public.creator_published_sites where org_id='33333333-3333-4333-8333-333333333333')<>'Do not overwrite'
 then raise exception 'legacy site was changed';end if;
end $$;

-- Compare against production media_jobs: result AND error are NOT NULL.
-- Exercise both the success and failure pathways of the real service RPCs.
select public.studio_register_upload_v2('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',2048,'native_video','{}'::jsonb);
select public.studio_queue_v2('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','hash-success','ticket-success','https://api.mccluster.org');
select public.studio_finish_v2('44444444-4444-4444-8444-444444444444','hash-success','{"files":[{"name":"video.mp4"}]}'::jsonb,null);
do $$ begin
 if not exists (select 1 from public.media_jobs j join public.creator_site_media_state a on a.job_id=j.id
  where a.asset_id='44444444-4444-4444-8444-444444444444' and a.state='ready' and
   j.status='completed' and j.error='{}'::jsonb and a.ticket_hash is null and a.ticket_expires_at is null)
 then raise exception 'success receipt failed to settle under production NOT NULL contract';end if;
end $$;

select public.studio_register_upload_v2('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555',2048,'native_video','{}'::jsonb);
select public.studio_queue_v2('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','hash-failed','ticket-failed','https://api.mccluster.org');
select public.studio_finish_v2('55555555-5555-4555-8555-555555555555','hash-failed',null,'synthetic processor failure');
do $$ begin
 if not exists (select 1 from public.media_jobs j join public.creator_site_media_state a on a.job_id=j.id
  where a.asset_id='55555555-5555-4555-8555-555555555555' and a.state='failed' and j.status='failed'
   and j.result='{}'::jsonb and j.error->>'message'='synthetic processor failure'
   and a.ticket_hash is null and a.ticket_expires_at is null)
 then raise exception 'failure receipt is missing or invalid';end if;
end $$;
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
