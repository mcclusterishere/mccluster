-- Rejected proof is feedback, not a terminal state.
-- Preserve every admin review before a member replaces rejected evidence,
-- notify the member atomically with the review, and allow corrected proof
-- on the same assignment without weakening the verified/points invariants.

create table public.action_proof_review_history (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.action_proofs(id) on delete cascade,
  assignment_id uuid not null references public.action_mission_assignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_uid uuid references public.m_people(id) on delete set null,
  decision text not null check (decision in ('verified','rejected')),
  review_note text,
  proof_type text not null check (proof_type in ('video','photo','link','text','artifact')),
  proof_url text,
  statement text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null
);

create index action_proof_review_history_assignment_idx
  on public.action_proof_review_history(assignment_id, reviewed_at desc);
create index action_proof_review_history_user_idx
  on public.action_proof_review_history(user_id, reviewed_at desc);

alter table public.action_proof_review_history enable row level security;
revoke all on public.action_proof_review_history from public, anon, authenticated;
grant all on public.action_proof_review_history to service_role;
grant select on public.action_proof_review_history to authenticated;

create policy "members read own proof review history"
  on public.action_proof_review_history
  for select to authenticated
  using (user_id=(select auth.uid()) or (select public.eu_is_admin()));

create or replace function public.action_archive_proof_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m_uid uuid;
  v_mission_id uuid;
  v_title text;
begin
  if old.status <> 'pending'
     or new.status not in ('verified','rejected')
     or new.reviewed_at is null then
    return new;
  end if;

  insert into public.action_proof_review_history(
    proof_id, assignment_id, user_id, reviewer_uid, decision, review_note,
    proof_type, proof_url, statement, metadata, reviewed_at
  ) values (
    new.id, new.assignment_id, new.user_id, new.reviewer_uid, new.status, new.review_note,
    old.proof_type, old.proof_url, old.statement, old.metadata, new.reviewed_at
  );

  select a.m_uid, a.mission_id, m.title
    into v_m_uid, v_mission_id, v_title
  from public.action_mission_assignments a
  join public.action_missions m on m.id=a.mission_id
  where a.id=new.assignment_id;

  if v_m_uid is not null then
    insert into public.network_notifications(
      recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata
    ) values (
      v_m_uid, null, 'action_proof_review', 'action_mission', v_mission_id::text,
      case when new.status='verified'
        then 'Verified: '||coalesce(v_title,'Mission')
        else 'Proof needs another try: '||coalesce(v_title,'Mission')
      end,
      jsonb_strip_nulls(jsonb_build_object(
        'assignment_id', new.assignment_id,
        'proof_id', new.id,
        'mission_id', v_mission_id,
        'decision', new.status,
        'review_note', new.review_note
      ))
    );
  end if;

  return new;
end;
$$;

revoke all on function public.action_archive_proof_review() from public, anon, authenticated;
grant execute on function public.action_archive_proof_review() to service_role;

drop trigger if exists action_proof_review_archive on public.action_proofs;
create trigger action_proof_review_archive
after update of status on public.action_proofs
for each row
when (old.status='pending' and new.status in ('verified','rejected'))
execute function public.action_archive_proof_review();

create or replace function public.submit_action_proof(
  p_assignment_id uuid,
  p_proof_type text,
  p_proof_url text default null,
  p_statement text default '',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_assignment public.action_mission_assignments%rowtype;
 v_mission public.action_missions%rowtype;
 v_existing public.action_proofs%rowtype;
 v_url text := nullif(btrim(coalesce(p_proof_url, '')), '');
 v_statement text := btrim(coalesce(p_statement, ''));
 v_meta jsonb := '{}'::jsonb;
 v_media_type text;
 v_poster_type text;
 v_proof_id uuid;
begin
 if v_user is null then raise exception 'sign in to submit proof'; end if;
 if p_proof_type not in ('video','photo','link','text','artifact') then raise exception 'unknown proof type'; end if;
 if v_url is not null and (v_url !~* '^https://' or char_length(v_url) > 2000) then raise exception 'proof links must be https'; end if;
 if char_length(v_statement) > 4000 then raise exception 'keep the statement under 4,000 characters'; end if;
 if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then raise exception 'invalid proof details'; end if;

 if p_metadata ? 'asset_id' then
   if (p_metadata->>'asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid upload'; end if;
   select a.media_type into v_media_type
   from public.network_media_assets a
   where a.id=(p_metadata->>'asset_id')::uuid
     and a.owner_m_uid=public.current_m_uid()
     and a.status in ('ready','staged');
   if v_media_type is null then raise exception 'that upload is not yours or is not ready'; end if;
   v_meta:=jsonb_build_object('asset_id',p_metadata->>'asset_id','media_type',v_media_type);
 end if;

 if p_metadata ? 'poster_asset_id' then
   if not (v_meta ? 'asset_id') or v_media_type <> 'video' then raise exception 'a poster belongs to a video proof'; end if;
   if (p_metadata->>'poster_asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid poster'; end if;
   if p_metadata->>'poster_asset_id'=p_metadata->>'asset_id' then raise exception 'poster must be a separate image'; end if;
   select a.media_type into v_poster_type
   from public.network_media_assets a
   where a.id=(p_metadata->>'poster_asset_id')::uuid
     and a.owner_m_uid=public.current_m_uid()
     and a.status in ('ready','staged');
   if v_poster_type <> 'image' then raise exception 'poster must be your ready image'; end if;
   v_meta:=v_meta||jsonb_build_object('poster_asset_id',p_metadata->>'poster_asset_id');
 end if;

 if v_url is null and v_meta='{}'::jsonb and char_length(v_statement)<20 then
   raise exception 'add an upload or a link, or describe what you did in at least 20 characters';
 end if;

 select * into v_assignment
 from public.action_mission_assignments
 where id=p_assignment_id
 for update;
 if not found or v_assignment.user_id<>v_user then raise exception 'assignment not found'; end if;
 if v_assignment.status not in ('joined','in_progress','submitted','rejected') then
   raise exception 'this mission is not taking proof';
 end if;
 select * into v_mission from public.action_missions where id=v_assignment.mission_id;
 if v_mission.status not in ('open','paused') then raise exception 'this mission is closed'; end if;

 if v_url is not null and exists (
   select 1 from public.action_proofs p
   where lower(p.proof_url)=lower(v_url)
     and p.status<>'rejected'
     and p.assignment_id<>v_assignment.id
 ) then raise exception 'that proof has already been used for another mission'; end if;

 if v_meta ? 'asset_id' and exists (
   select 1 from public.action_proofs p
   where p.metadata->>'asset_id'=v_meta->>'asset_id'
     and p.status<>'rejected'
     and p.assignment_id<>v_assignment.id
 ) then raise exception 'that upload has already been used for another mission'; end if;

 select * into v_existing
 from public.action_proofs
 where assignment_id=v_assignment.id
 for update;

 if found then
   if v_existing.status not in ('pending','rejected') then
     raise exception 'this proof has already been reviewed';
   end if;
   update public.action_proofs
      set proof_type=p_proof_type,
          proof_url=v_url,
          statement=v_statement,
          metadata=v_meta,
          status='pending',
          reviewer_uid=null,
          review_note=null,
          reviewed_at=null,
          created_at=now()
    where id=v_existing.id;
   v_proof_id:=v_existing.id;
 else
   insert into public.action_proofs(
     assignment_id,user_id,proof_type,proof_url,statement,metadata,status
   ) values (
     v_assignment.id,v_user,p_proof_type,v_url,v_statement,v_meta,'pending'
   )
   returning id into v_proof_id;
 end if;

 update public.action_mission_assignments
 set status='submitted', submitted_at=now(), verified_at=null
 where id=v_assignment.id;

 return jsonb_build_object(
   'proof_id',v_proof_id,
   'assignment_id',v_assignment.id,
   'status','submitted',
   'retry',v_assignment.status='rejected'
 );
end;
$$;

revoke all on function public.submit_action_proof(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.submit_action_proof(uuid,text,text,text,jsonb) to authenticated, service_role;
