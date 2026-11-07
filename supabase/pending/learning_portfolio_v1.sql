-- REVIEW ONLY. Not applied. Same data plane, no client table access.
create table if not exists public.learning_portfolio (
 key text primary key check (key = 'matthew'),
 revision integer not null default 0,
 draft jsonb not null,
 published jsonb,
 published_at timestamptz,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.learning_portfolio enable row level security;
revoke all on public.learning_portfolio from public, anon, authenticated;
grant all on public.learning_portfolio to service_role;
create or replace function public.learning_portfolio_write(p_revision integer,p_actor uuid,p_action text,p_draft jsonb,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.learning_portfolio;
begin
 if p_action not in ('save','publish','unpublish') then raise exception 'invalid action'; end if;
 -- Defense in depth: same house-owner membership as the Worker, never an admin label.
 if not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id
   where o.slug='mccluster' and m.profile_id=p_actor and m.role='owner') then raise exception 'owner required'; end if;
 insert into public.learning_portfolio(key,draft,updated_by) values('matthew',p_draft,p_actor) on conflict do nothing;
 select * into r from public.learning_portfolio where key='matthew' for update;
 if r.revision<>p_revision then return null; end if;
 update public.learning_portfolio set
   draft=case when p_action='save' then p_draft else draft end,
   published=case when p_action='publish' then p_snapshot when p_action='unpublish' then null else published end,
   published_at=case when p_action='publish' then now() when p_action='unpublish' then null else published_at end,
   revision=revision+1,updated_by=p_actor,updated_at=now()
 where key='matthew' returning * into r;
 return jsonb_build_object('revision',r.revision,'published_at',r.published_at);
end $$;
revoke all on function public.learning_portfolio_write(integer,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.learning_portfolio_write(integer,uuid,text,jsonb,jsonb) to service_role;
