-- Avoid recursive RLS evaluation on network_conversation_members.
create or replace function public.mnet_is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.network_conversation_members m
    where m.conversation_id=p_conversation_id
      and m.m_uid=public.current_m_uid()
      and m.member_state<>'left'
  );
$$;
revoke all on function public.mnet_is_conversation_member(uuid) from public,anon;
grant execute on function public.mnet_is_conversation_member(uuid) to authenticated,service_role;

drop policy if exists network_conversations_member_read on public.network_conversations;
create policy network_conversations_member_read on public.network_conversations for select to authenticated
using (public.mnet_is_conversation_member(id));

drop policy if exists network_conversation_members_member_read on public.network_conversation_members;
create policy network_conversation_members_member_read on public.network_conversation_members for select to authenticated
using (public.mnet_is_conversation_member(conversation_id));

drop policy if exists network_messages_member_read on public.network_messages;
create policy network_messages_member_read on public.network_messages for select to authenticated
using (deleted_at is null and public.mnet_is_conversation_member(conversation_id));
