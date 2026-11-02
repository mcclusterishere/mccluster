-- REVIEW-ONLY: not applied to production. Requires music release integrity v1
-- and the existing control_authorize_service authority. No master bytes/paths
-- are changed. Matches music_asset_versions: append-only private versions,
-- service RPCs, existing ops.use authorization and release timestamp checks.
begin;
set local lock_timeout = '5s';
create schema if not exists private;

-- Allowlist every nesting level. Metadata, history and editor annotations
-- never belong in the creator-writable/public playback payload.
create or replace function public.music_lyric_public_payload(p jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare result jsonb := '{}'::jsonb; lines jsonb := '[]'::jsonb;
  line jsonb; clean jsonb; word jsonb; words jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  foreach k in array array['title','artist','language','plain'] loop
    if jsonb_typeof(p->k) = 'string' then result := result || jsonb_build_object(k,p->k); end if;
  end loop;
  if jsonb_typeof(p->'duration_seconds') = 'number' then result := result || jsonb_build_object('duration_seconds',p->'duration_seconds'); end if;
  if jsonb_typeof(p#>'{timed,line}') = 'array' then
    for line in select value from jsonb_array_elements(p#>'{timed,line}') loop
      if jsonb_typeof(line->'content') is distinct from 'string' or jsonb_typeof(line->'begin') is distinct from 'number' then continue; end if;
      clean := jsonb_build_object('content',line->'content','begin',line->'begin');
      if jsonb_typeof(line->'end') = 'number' then clean := clean || jsonb_build_object('end',line->'end'); end if;
      if jsonb_typeof(line->'words') = 'array' then
        words := '[]'::jsonb;
        for word in select value from jsonb_array_elements(line->'words') loop
          if jsonb_typeof(word->'content') = 'string' and jsonb_typeof(word->'begin') = 'number' and jsonb_typeof(word->'end') = 'number' then
            words := words || jsonb_build_array(jsonb_build_object('content',word->'content','begin',word->'begin','end',word->'end'));
          end if;
        end loop;
        clean := clean || jsonb_build_object('words',words);
      end if;
      lines := lines || jsonb_build_array(clean);
    end loop;
    result := result || jsonb_build_object('timed',jsonb_build_object('line',lines),
      'plain',coalesce((select string_agg(x->>'content', E'\n' order by n) from jsonb_array_elements(lines) with ordinality a(x,n)),''));
  end if;
  return result;
end $$;
revoke all on function public.music_lyric_public_payload(jsonb) from public, anon, authenticated, service_role;

create table if not exists private.music_lyric_revisions (
  track_id uuid not null references public.creator_tracks(id) on delete restrict,
  revision bigint not null check (revision >= 0),
  lyrics jsonb not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  saved_by uuid references auth.users(id) on delete restrict,
  saved_at timestamptz not null default clock_timestamp(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  -- Retained for audit only. Never returned by read/export RPCs, never approved.
  untrusted_legacy jsonb,
  primary key (track_id, revision),
  check ((approved_at is null and approved_by is null) or
         (revision > 0 and approved_at is not null and approved_by is not null and saved_by is not null and approved_by = saved_by)),
  check (revision = 0 or (saved_by is not null and untrusted_legacy is null)),
  check (not (lyrics ?| array['_history','_revision','reviewed','reviewed_at','reviewed_by']))
);
alter table private.music_lyric_revisions enable row level security;
alter table private.music_lyric_revisions force row level security;
revoke all on private.music_lyric_revisions from public, anon, authenticated, service_role;
comment on table private.music_lyric_revisions is
  'Immutable lyric revisions. Approval is authorization-bound row metadata, never lyric JSON. RPC-only; no public or creator access. Revision zero and untrusted_legacy are never approvals.';

create or replace function private.music_lyric_revision_immutable()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin raise exception 'lyric_revision_immutable'; end $$;
revoke all on function private.music_lyric_revision_immutable() from public, anon, authenticated, service_role;
drop trigger if exists music_lyric_revision_immutable_trg on private.music_lyric_revisions;
create trigger music_lyric_revision_immutable_trg before update or delete on private.music_lyric_revisions
for each row execute function private.music_lyric_revision_immutable();

-- Preserve old JSON before removing it from every public location. It is NOT
-- imported as trusted approval/history. Affected releases return to review via
-- the existing guard; their old public reviewed_snapshot must also be scrubbed.
insert into private.music_lyric_revisions(track_id,revision,lyrics,content_sha256,untrusted_legacy)
select t.id,0,coalesce(public.music_lyric_public_payload(t.lyrics),'null'::jsonb),
 public.music_review_digest(coalesce(public.music_lyric_public_payload(t.lyrics),'null'::jsonb)),
 jsonb_build_object('lyrics',t.lyrics,'reviewed_snapshot_lyrics',t.reviewed_snapshot->'lyrics')
from public.creator_tracks t
where t.lyrics is distinct from public.music_lyric_public_payload(t.lyrics)
   or (t.reviewed_snapshot ? 'lyrics' and t.reviewed_snapshot->'lyrics' is distinct from coalesce(public.music_lyric_public_payload(t.reviewed_snapshot->'lyrics'),'null'::jsonb))
on conflict do nothing;

-- Trigger runs BEFORE the existing music_track_guard_trg (alphabetic order).
-- The old guard remains unchanged, including content-change downgrade and all
-- master/asset ownership, pin, digest and authorization protections.
create or replace function public.music_lyrics_public_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
 new.lyrics := public.music_lyric_public_payload(new.lyrics);
 if jsonb_typeof(new.reviewed_snapshot) = 'object' and new.reviewed_snapshot ? 'lyrics' then
   new.reviewed_snapshot := jsonb_set(new.reviewed_snapshot,'{lyrics}',coalesce(public.music_lyric_public_payload(new.reviewed_snapshot->'lyrics'),'null'::jsonb));
 end if;
 return new;
end $$;
revoke all on function public.music_lyrics_public_guard() from public, anon, authenticated, service_role;
drop trigger if exists music_lyrics_public_guard_trg on public.creator_tracks;
create trigger music_lyrics_public_guard_trg before insert or update on public.creator_tracks
for each row execute function public.music_lyrics_public_guard();

-- A review-only migration, run by the database owner, not a live API call.
-- Existing release guards recognize the service claim used by prior migrations.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.creator_tracks t set
 lyrics = public.music_lyric_public_payload(t.lyrics),
 reviewed_snapshot = case when t.reviewed_snapshot ? 'lyrics' then
   jsonb_set(t.reviewed_snapshot,'{lyrics}',coalesce(public.music_lyric_public_payload(t.reviewed_snapshot->'lyrics'),'null'::jsonb)) else t.reviewed_snapshot end,
 reviewed_digest = null, reviewed_at = null,
 status = case when t.status in ('approved','published') then 'pending_review' else t.status end,
 rights_status = case when t.rights_status = 'cleared' then 'review' else t.rights_status end,
 published_at = null
where t.lyrics is distinct from public.music_lyric_public_payload(t.lyrics)
   or (t.reviewed_snapshot ? 'lyrics' and t.reviewed_snapshot->'lyrics' is distinct from coalesce(public.music_lyric_public_payload(t.reviewed_snapshot->'lyrics'),'null'::jsonb));

create or replace function private.music_lyric_operator(p_actor uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare org_id uuid; decision jsonb;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then raise exception 'lyric_service_required'; end if;
 select id into org_id from public.orgs where slug='mccluster' limit 1;
 if p_actor is null or org_id is null then raise exception 'lyric_operator_required'; end if;
 decision := public.control_authorize_service(p_actor,org_id,'ops.use',null,null,null,null);
 if (decision->>'allowed') is distinct from 'true' then raise exception 'lyric_operator_required'; end if;
end $$;
revoke all on function private.music_lyric_operator(uuid) from public, anon, authenticated, service_role;

create or replace function public.music_lyrics_get(p_actor uuid,p_track uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare t public.creator_tracks; v private.music_lyric_revisions; doc jsonb; approved jsonb;
begin
 perform private.music_lyric_operator(p_actor);
 select * into t from public.creator_tracks where id=p_track for share;
 if not found then raise exception 'track_not_found'; end if;
 select * into v from private.music_lyric_revisions where track_id=p_track order by revision desc limit 1;
 doc := coalesce(v.lyrics,public.music_lyric_public_payload(t.lyrics),'null'::jsonb);
 select coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'hash',r.content_sha256,'approved_at',r.approved_at,'approved_by',r.approved_by) order by r.revision desc),'[]'::jsonb)
 into approved from private.music_lyric_revisions r where r.track_id=p_track and r.approved_by is not null;
 return jsonb_build_object('track_id',p_track,'revision',coalesce(v.revision,0),
   'hash',coalesce(v.content_sha256,public.music_review_digest(doc)), 'expected_updated_at',t.updated_at,
   'lyrics',case when doc='null'::jsonb then null else doc || jsonb_build_object('reviewed',v.approved_by is not null,'reviewed_by',v.approved_by,'reviewed_at',v.approved_at) end,
   'approved_versions',approved);
end $$;
revoke all on function public.music_lyrics_get(uuid,uuid) from public, anon, authenticated;
grant execute on function public.music_lyrics_get(uuid,uuid) to service_role;

create or replace function public.music_lyrics_save(p_actor uuid,p_track uuid,p_lyrics jsonb,p_reviewed boolean,
 p_expected_updated_at timestamptz,p_expected_revision bigint,p_expected_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare t public.creator_tracks; v private.music_lyric_revisions; prior jsonb; prior_hash text; next_rev bigint; stamp timestamptz := clock_timestamp();
begin
 perform private.music_lyric_operator(p_actor);
 select * into t from public.creator_tracks where id=p_track for update;
 if not found then raise exception 'track_not_found'; end if;
 select * into v from private.music_lyric_revisions where track_id=p_track order by revision desc limit 1;
 prior := coalesce(v.lyrics,public.music_lyric_public_payload(t.lyrics),'null'::jsonb);
 prior_hash := coalesce(v.content_sha256,public.music_review_digest(prior));
 if p_expected_updated_at is distinct from t.updated_at or p_expected_revision is distinct from coalesce(v.revision,0) or p_expected_hash is distinct from prior_hash then raise exception 'lyric_revision_conflict'; end if;
 if p_lyrics is null or jsonb_typeof(p_lyrics) <> 'object' or jsonb_typeof(p_lyrics#>'{timed,line}') is distinct from 'array' then raise exception 'invalid_lyrics'; end if;
 if jsonb_array_length(p_lyrics#>'{timed,line}') not between 1 and 2000 or octet_length(p_lyrics::text)>600000 then raise exception 'invalid_lyrics'; end if;
 if p_lyrics ?| array['_history','_revision','reviewed','reviewed_at','reviewed_by'] then raise exception 'lyric_authority_is_not_payload'; end if;
 if v.track_id is null then
   insert into private.music_lyric_revisions(track_id,revision,lyrics,content_sha256) values(p_track,0,prior,prior_hash);
 end if;
 next_rev := coalesce(v.revision,0)+1;
 insert into private.music_lyric_revisions(track_id,revision,lyrics,content_sha256,saved_by,approved_by,approved_at)
 values(p_track,next_rev,p_lyrics,public.music_review_digest(p_lyrics),p_actor,case when p_reviewed then p_actor end,case when p_reviewed then stamp end);
 -- Only current playback content crosses into the public row. The existing
 -- release guard downgrades changed published content; old versions stay private.
 if t.lyrics is distinct from public.music_lyric_public_payload(p_lyrics) then
   update public.creator_tracks set lyrics=public.music_lyric_public_payload(p_lyrics) where id=p_track;
 end if;
 return public.music_lyrics_get(p_actor,p_track);
end $$;
revoke all on function public.music_lyrics_save(uuid,uuid,jsonb,boolean,timestamptz,bigint,text) from public, anon, authenticated;
grant execute on function public.music_lyrics_save(uuid,uuid,jsonb,boolean,timestamptz,bigint,text) to service_role;

create or replace function public.music_lyrics_export(p_actor uuid,p_track uuid,p_revision bigint,p_expected_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v private.music_lyric_revisions;
begin
 perform private.music_lyric_operator(p_actor);
 select * into v from private.music_lyric_revisions where track_id=p_track and revision=p_revision;
 if not found then raise exception 'lyric_revision_not_found'; end if;
 if v.approved_by is null or v.revision=0 then raise exception 'lyric_revision_not_approved'; end if;
 if p_expected_hash is distinct from v.content_sha256 or v.content_sha256 is distinct from public.music_review_digest(v.lyrics) then raise exception 'lyric_revision_hash_mismatch'; end if;
 return jsonb_build_object('lyrics',v.lyrics || jsonb_build_object('reviewed',true,'reviewed_by',v.approved_by,'reviewed_at',v.approved_at,
   '_revision',jsonb_build_object('number',v.revision,'sha256',v.content_sha256,'track_id',v.track_id,'hash_format','sha256-pg-jsonb-v1')));
end $$;
revoke all on function public.music_lyrics_export(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.music_lyrics_export(uuid,uuid,bigint,text) to service_role;
commit;
