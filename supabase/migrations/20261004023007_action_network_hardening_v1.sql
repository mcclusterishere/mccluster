-- ACTION NETWORK HARDENING v1
-- Make group membership a real read/write boundary, retire passive
-- like/comment mutations, and stop the unconsumed legacy Mnet outbox.

create policy "action_network_group_read_boundary"
on public.network_posts
as restrictive
for select
to public
using (
  group_id is null
  or (
    public.current_m_uid() is not null
    and exists (
      select 1 from public.network_group_members gm
      where gm.group_id = network_posts.group_id
        and gm.m_uid = public.current_m_uid()
        and gm.state = 'joined'
    )
  )
);

create policy "action_network_post_insert_boundary"
on public.network_posts
as restrictive
for insert
to authenticated
with check (
  reply_to_id is null
  and (
    group_id is null
    or (
      visibility = 'network'
      and exists (
        select 1 from public.network_group_members gm
        where gm.group_id = network_posts.group_id
          and gm.m_uid = public.current_m_uid()
          and gm.state = 'joined'
      )
    )
  )
);

create policy "action_network_post_update_boundary"
on public.network_posts
as restrictive
for update
to authenticated
using (reply_to_id is null)
with check (
  reply_to_id is null
  and (
    group_id is null
    or (
      visibility = 'network'
      and exists (
        select 1 from public.network_group_members gm
        where gm.group_id = network_posts.group_id
          and gm.m_uid = public.current_m_uid()
          and gm.state = 'joined'
      )
    )
  )
);

create policy "action_network_open_group_join_boundary"
on public.network_group_members
as restrictive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.network_groups g
    where g.id = network_group_members.group_id
      and g.visibility = 'open'
  )
);

create policy "action_network_reactions_insert_retired"
on public.network_reactions
as restrictive
for insert
to authenticated
with check (false);

create policy "action_network_reactions_update_retired"
on public.network_reactions
as restrictive
for update
to authenticated
using (false)
with check (false);

create policy "action_network_reactions_delete_retired"
on public.network_reactions
as restrictive
for delete
to authenticated
using (false);

-- Production had these legacy triggers when this migration first ran.
-- Fresh/replay databases may not, so keep the retirement step idempotent.
do $
begin
  begin
    alter table public.network_posts disable trigger mnet_post_outbox_trg;
  exception when undefined_object then
    null;
  end;
  begin
    alter table public.network_reactions disable trigger mnet_reaction_outbox_trg;
  exception when undefined_object then
    null;
  end;
  begin
    alter table public.network_follows disable trigger mnet_follow_outbox_trg;
  exception when undefined_object then
    null;
  end;
end;
$;

update public.network_outbox
set status = 'dead',
    last_error = 'Retired by action_network_hardening_v1: canonical feed and notifications write directly; no outbox consumer exists.'
where status in ('pending','processing','failed');

comment on table public.network_outbox is
  'Legacy Mnet event outbox retired by action_network_hardening_v1. No canonical runtime consumes this queue; feed, notifications, missions, and proof events write directly.';
