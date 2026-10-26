-- Recovered selectively from PR493 head9ad0503. Project publication uses project_tiles_v1; no legacy publishing or proposed usage prices activated.
-- Website Studio v2. PENDING: not applied to production.
-- Additive to canonical identity/media/compute/publication stores. Service-only
-- mutations; API actor comes from verified Auth + active primary M identity.
begin;
create table if not exists public.creator_site_template_versions (
 template_key text not null, version integer not null check(version>0),
 status text not null check(status in ('development','active','retired')),
 definition jsonb not null, guidance jsonb not null, primary key(template_key,version));
create table if not exists public.creator_site_access (
 owner_m_uid uuid primary key references public.m_people(id),
 org_id uuid not null references public.orgs(id),
 basis text not null check(basis in ('pilot','paid','cohort')), source_reference text not null,
 expires_at timestamptz not null, enabled boolean not null default false,
 preparation_budget_microusd bigint not null default 0 check(preparation_budget_microusd>=0),
 updated_at timestamptz not null default now());
-- Existing subscriptions/cohort claims are NOT changed or granted by the client.
-- Reviewed entitlement reconciliation supplies this narrow access projection.
create table if not exists public.creator_site_drafts (
 id uuid primary key default gen_random_uuid(), owner_m_uid uuid not null references public.m_people(id),
 template_key text not null, template_version integer not null, revision integer not null default 1,
 document jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(template_key,template_version) references public.creator_site_template_versions(template_key,version),
 check(revision>0), check(octet_length(document::text)<=32768),
 check(coalesce(document->>'schema_version'='website-studio/v1',false)),
 check(coalesce(document->>'template_key'=template_key,false)),
 check(coalesce(document->'template_version'=to_jsonb(template_version),false)),
 check(coalesce(jsonb_typeof(document->'tiles')='array',false)),
 check(coalesce(jsonb_array_length(document->'tiles')=3,false)));
create index if not exists creator_site_drafts_owner_idx on public.creator_site_drafts(owner_m_uid,updated_at desc);
create table if not exists public.creator_site_revisions (
 id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.creator_site_drafts(id),
 owner_m_uid uuid not null references public.m_people(id), draft_revision integer not null, document jsonb not null,
 created_at timestamptz not null default now(), unique(draft_id,draft_revision));
-- Publication pointers attach to managed_projects in project_tiles_v1.sql.
create table if not exists public.creator_site_media_state (
 asset_id uuid primary key references public.media_assets(id), owner_m_uid uuid not null references public.m_people(id),
 state text not null check(state in ('awaiting_upload','queued','processing','ready','failed','withdrawn')),
 expected_bytes bigint not null check(expected_bytes between 1 and 67108864),
 source_path text not null unique, kind text not null check(kind in ('music','native_video','transition','immersive360')),
 settings jsonb not null, job_id uuid references public.media_jobs(id),
 ticket_hash text, ticket_expires_at timestamptz, output_manifest jsonb,
 public_approved boolean not null default false, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists creator_site_media_owner_idx on public.creator_site_media_state(owner_m_uid,created_at desc);
create table if not exists public.creator_site_events (
 id bigint generated always as identity primary key, owner_m_uid uuid not null,
 event text not null, reference_id uuid not null, revision integer,
 occurred_at timestamptz not null default now());
-- No anonymous draft access, no authenticated DML, no security-definer escape.
do $$ declare t text; begin
 foreach t in array array['creator_site_template_versions','creator_site_access','creator_site_drafts','creator_site_revisions','creator_site_media_state','creator_site_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.creator_site_events_id_seq to service_role;
grant select on public.creator_site_drafts to authenticated;
drop policy if exists studio_owner_read on public.creator_site_drafts;
create policy studio_owner_read on public.creator_site_drafts for select to authenticated
 using(owner_m_uid=(select public.current_m_uid()));

create or replace function public.studio_save_v2(p_actor uuid,p_id uuid,p_expected integer,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.creator_site_drafts; begin
 if p_actor is null or p_id is null or p_expected is null or p_expected<0 or p_document is null then raise exception 'invalid request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('studio-owner:'||p_actor,0));
 if not exists(select 1 from public.m_people where id=p_actor and status='active') then raise exception 'identity unavailable' using errcode='42501';end if;
 if p_expected=0 then
  if (select count(*) from public.creator_site_drafts where owner_m_uid=p_actor)>=3 then raise exception 'draft quota exceeded' using errcode='54000';end if;
  if not exists(select 1 from public.creator_site_template_versions where template_key=p_document->>'template_key' and version=(p_document->>'template_version')::integer and status='active') then raise exception 'template unavailable' using errcode='22023';end if;
  insert into public.creator_site_drafts(id,owner_m_uid,template_key,template_version,document)
   values(p_id,p_actor,p_document->>'template_key',(p_document->>'template_version')::integer,p_document) returning * into r;
 else
  update public.creator_site_drafts set document=p_document,revision=revision+1,updated_at=now()
   where id=p_id and owner_m_uid=p_actor and revision=p_expected returning * into r;
  if not found then raise exception 'draft unavailable or changed' using errcode='40001';end if;
 end if;
 insert into public.creator_site_events(owner_m_uid,event,reference_id,revision) values(p_actor,'draft.saved',r.id,r.revision);
 return to_jsonb(r);
end $$;

create or replace function public.studio_register_upload_v2(p_actor uuid,p_id uuid,p_bytes bigint,p_kind text,p_settings jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare n integer; p text; begin
 perform pg_advisory_xact_lock(hashtextextended('studio-owner:'||p_actor,0));
 if p_actor is null or p_id is null or p_bytes is null or p_bytes<1 or p_bytes>67108864 then raise exception 'invalid upload' using errcode='22023';end if;
 select count(*) into n from public.creator_site_media_state where owner_m_uid=p_actor and created_at>now()-interval '1 day';
 if n>=8 then raise exception 'daily upload quota reached' using errcode='54000';end if;
 if (select coalesce(sum(expected_bytes),0) from public.creator_site_media_state where owner_m_uid=p_actor and state<>'withdrawn')+p_bytes>1073741824 then raise exception 'media allowance reached' using errcode='54000';end if;
 p:='studio/'||p_actor||'/'||p_id||'/original';
 insert into public.media_assets(id,asset_type,role,storage_path,metadata) values(p_id,p_kind,'website_studio_source',p,jsonb_build_object('owner_m_uid',p_actor));
 insert into public.creator_site_media_state(asset_id,owner_m_uid,state,expected_bytes,source_path,kind,settings)
 values(p_id,p_actor,'awaiting_upload',p_bytes,p,p_kind,p_settings);
 return jsonb_build_object('asset_id',p_id,'path',p);
end $$;

-- Called once after upload existence/size verification. Canonical budgeted
-- media jobs and compute tasks are used, not a second processing queue.
create or replace function public.studio_queue_v2(p_actor uuid,p_id uuid,p_auth_uid uuid,p_ticket_hash text,p_ticket text,p_origin text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.creator_site_media_state; g public.creator_site_access; j public.media_jobs; begin
 select * into a from public.creator_site_media_state where asset_id=p_id and owner_m_uid=p_actor for update;
 if not found then raise exception 'asset unavailable' using errcode='42501';end if;
 if a.state in ('queued','processing','ready') then return jsonb_build_object('asset_id',a.asset_id,'state',a.state,'job_id',a.job_id);end if;
 if a.state not in ('awaiting_upload','failed') then raise exception 'asset unavailable' using errcode='42501';end if;
 select * into g from public.creator_site_access where owner_m_uid=p_actor and enabled and expires_at>now() for update;
 if not found or g.preparation_budget_microusd<10000 then raise exception 'preparation access not active' using errcode='42501';end if;
 -- Lock grants so reservations cannot exceed the explicitly sponsored budget.
 update public.creator_site_access set preparation_budget_microusd=preparation_budget_microusd-10000 where owner_m_uid=p_actor and preparation_budget_microusd>=10000;
 if not found then raise exception 'preparation budget exhausted' using errcode='54000';end if;
 select * into j from public.media_create_budgeted_job_v2(g.org_id,p_auth_uid,'native','studio-native-1','media.prepare','',
 jsonb_build_object('asset_id',p_id),jsonb_build_object('studio',true),10000,1,jsonb_build_object('model','sponsored_ceiling_v1'),jsonb_build_object('max_microusd',10000));
 update public.creator_site_media_state set state='queued',job_id=j.id,ticket_hash=p_ticket_hash,ticket_expires_at=now()+interval '1 hour',error=null,updated_at=now() where asset_id=p_id;
 perform public.compute_enqueue_task(g.org_id,'media.prepare','studio-native-1',
 jsonb_build_object('asset_id',p_id,'ticket',p_ticket,'origin',p_origin),'{"cpu_only":true}'::jsonb,0,now(),1,
 jsonb_build_object('media_job_id',j.id,'private_credentials',true),'studio:'||j.id);
 return jsonb_build_object('asset_id',p_id,'state','queued','job_id',j.id);
end $$;

create or replace function public.studio_finish_v2(p_id uuid,p_ticket_hash text,p_manifest jsonb,p_error text default null)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.creator_site_media_state; begin
 select * into a from public.creator_site_media_state where asset_id=p_id for update;
 if not found or a.ticket_hash is distinct from p_ticket_hash or a.ticket_expires_at<=now() or a.state not in ('queued','processing') then raise exception 'job capability expired' using errcode='42501';end if;
 update public.creator_site_media_state set state=case when p_error is null then 'ready' else 'failed' end,
 output_manifest=case when p_error is null then p_manifest else null end,error=left(p_error,300),ticket_hash=null,ticket_expires_at=null,updated_at=now() where asset_id=p_id;
 update public.media_jobs set status=case when p_error is null then 'completed' else 'failed' end,
 result=coalesce(p_manifest,'{}'::jsonb),error=case when p_error is not null then jsonb_build_object('message',left(p_error,300)) else '{}'::jsonb end,completed_at=now(),updated_at=now() where id=a.job_id;
 insert into public.creator_site_events(owner_m_uid,event,reference_id) values(a.owner_m_uid,case when p_error is null then 'media.ready' else 'media.failed' end,p_id);
 -- Measured actual cost must arrive from the existing Core cost reconciler.
 -- Do not declare the reserved ceiling an actual cost or zero out reservation.
 return true;
end $$;

do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('studio_save_v2','studio_register_upload_v2','studio_queue_v2','studio_finish_v2') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;

insert into public.creator_site_template_versions(template_key,version,status,definition,guidance) values('motion-portfolio',1,'active','{"schema_version": "website-studio/v1", "template_key": "motion-portfolio", "template_version": 1, "title": "Your website", "mode": "standard", "tiles": [{"id": "tile-1", "kind": "music", "headline": "Listen to my work", "body": "", "source_ref": null, "transition": null, "playback": "manual", "action": null}, {"id": "tile-2", "kind": "native_video", "headline": "Watch my work", "body": "", "source_ref": null, "transition": null, "playback": "manual", "action": null}, {"id": "tile-3", "kind": "immersive360", "headline": "Explore my space", "body": "", "source_ref": null, "transition": null, "playback": "manual", "action": null}]}'::jsonb,'{"version": 1, "transition": {"recommended_selected_seconds": [4, 8], "suggested_selected_seconds": 6, "headline": "One clear movement is enough", "help": "Choose a short reveal, camera move or moment of your work. Check the phone crop. Add wording in the editor, not inside the footage. A scroll transition does not need to loop.", "export_recipe": "MP4 with H.264 video, 1080p, 24 or 30 fps is the proposed pilot recipe. Server inspection and conversion must be implemented before claiming uploader support.", "support_status": "Pilot preparation is implemented for validated SDR media. Availability requires enabled processing and an approved allowance."}, "framing": {"desktop": "1920 x 1080 is a useful landscape starting point.", "phone": "An optional 1080 x 1920 portrait version can preserve a different composition. Otherwise approve the crop.", "limits": "The editor must show actual dimensions, rotation, selected duration and upload/processing limits from server policy."}, "music": {"help": "Choose your recording or upload through the existing music flow. Selling uses an approved offer, payment confirmation and download entitlement. Do not expose a paid master as the public player source."}, "native_video": {"help": "Choose your existing native video post, or upload through the native publishing flow. Pinning references that post; it does not silently make a private or removed post public."}, "immersive360": {"help": "Use a real 360 panorama or supported 360 video. An ordinary flat clip does not become a 360 scene. The visitor chooses Enter and can exit at any time.", "maximum_per_site": 1, "production_offer": "A separately scoped capture/production service can supply an experience; no fee or vendor is activated here."}, "playback": {"help": "Automatic start can be requested only after the visitor enables sound and the browser permits playback. Always retain a Play button. Transition motion never scrubs song audio."}, "modes": {"standard": "Three ordinary content tiles.", "cinematic": "Each configured transition precedes its content tile. Reduced motion omits the transitions, not the content."}, "account": {"help": "The real demo is public. Using and saving the template requires a free M Account. Profile identity and branded website publishing remain distinct. Preserve selected template and draft through sign-in.", "pricing_status": "Free hosting limits, $5 social access and $33 tool bundles are proposals, not active billing plans."}}'::jsonb) on conflict do nothing;

commit;
