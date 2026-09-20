-- Close two social-network edge cases found by the production audit:
-- message-request recipients must explicitly accept before replying, and
-- network-profile visibility actually means followers rather than public.

create or replace function public.mnet_send_message(p_conversation_id uuid,p_body text,p_media jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_me uuid; v_id uuid; v_state text;
begin
  v_me:=public.current_m_uid();
  if v_me is null then raise exception 'identity_missing'; end if;
  select member_state into v_state from public.network_conversation_members
   where conversation_id=p_conversation_id and m_uid=v_me and member_state<>'left';
  if v_state is null then raise exception 'conversation_forbidden'; end if;
  if v_state='requested' then raise exception 'accept_required'; end if;
  if coalesce(char_length(trim(p_body)),0)=0 and coalesce(jsonb_array_length(coalesce(p_media,'[]'::jsonb)),0)=0 then
    raise exception 'message_required';
  end if;
  if char_length(coalesce(p_body,''))>20000 then raise exception 'message_too_long'; end if;
  if exists(
    select 1
    from public.network_conversation_members other
    where other.conversation_id=p_conversation_id and other.m_uid<>v_me and public.mnet_is_blocked_pair(v_me,other.m_uid)
  ) then raise exception 'blocked'; end if;
  insert into public.network_messages(conversation_id,sender_m_uid,body,media)
  values(p_conversation_id,v_me,trim(coalesce(p_body,'')),coalesce(p_media,'[]'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mnet_send_message(uuid,text,jsonb) from public,anon;
grant execute on function public.mnet_send_message(uuid,text,jsonb) to authenticated,service_role;

drop policy if exists network_profiles_read on public.network_profiles;
create policy network_profiles_read on public.network_profiles
for select to public using (
  m_uid=public.current_m_uid()
  or (
    not public.mnet_is_blocked_pair(public.current_m_uid(),network_profiles.m_uid)
    and (
      visibility='public'
      or (
        visibility='network'
        and exists(
          select 1 from public.network_follows f
          where f.follower_m_uid=public.current_m_uid()
            and f.followed_m_uid=network_profiles.m_uid
            and f.status='following'
        )
      )
    )
  )
);
