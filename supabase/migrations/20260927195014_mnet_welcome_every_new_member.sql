-- MNET: EVERY NEW MEMBER GETS MATTHEW'S WELCOME.
--
-- The welcome shipped on 25 Sep and had sent zero messages by 27 Sep, with
-- 22 new accounts in that time. Two reasons, both measured on production:
--
--   1. It fired only from mnet_complete_surface_profile. Most people never
--      finish an Mnet profile, and the three who did came through
--      mnet_surface_bootstrap, which marks a profile complete without ever
--      calling the welcome.
--   2. The migration was replayed at 12:14 on 25 Sep, and its "everyone
--      already here has been welcomed" stamp ran a second time, marking two
--      brand-new accounts welcomed without a message.
--
-- So the welcome now goes out when the network profile is CREATED, which
-- ensure_network_profile_for_auth_user does for every signup, last among
-- the auth.users triggers (after the identity link and the handle exist).
-- Whatever path a person takes afterwards, they have already been greeted.
-- The profile-save call stays; welcomed_at makes a second send a no-op.
--
-- The message carries the walkthrough address. js/mnet.js renders exactly
-- that address as a "Start the walkthrough" button, and js/mnet-tour.js
-- runs the tour. A welcome that fails for any reason never fails a signup.

create or replace function public.mnet_send_welcome(p_m_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin uuid; v_conv uuid; v_name text; v_body text;
begin
  select a into v_admin from public.mnet_admin_m_uids() as a limit 1;
  -- No desk account means nobody to send it from, and silence beats a
  -- greeting signed by nobody. The desk does not welcome itself.
  if v_admin is null or v_admin = p_m_uid then return; end if;

  if exists (select 1 from public.network_profiles
              where m_uid = p_m_uid and welcomed_at is not null) then
    return;
  end if;

  -- Greet by first name. At signup there is usually no @handle or display
  -- name yet, but the sign-up forms store a name: account.html writes
  -- first_name, Mnet's own form writes name/full_name. Then the @handle,
  -- then the display name, then nothing. The old version returned silently
  -- when a handle was missing, which was one more way to hear nothing.
  select coalesce(
           nullif(btrim(u.raw_user_meta_data->>'first_name'), ''),
           nullif(split_part(btrim(coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', '')), ' ', 1), ''),
           '@' || nullif(btrim(pp.mccluster_id), ''))
    into v_name
    from public.m_auth_user_links l
    join auth.users u on u.id = l.auth_user_id
    left join public.platform_profiles pp on pp.user_id = l.auth_user_id
   where l.m_uid = p_m_uid and l.is_primary = true
   limit 1;
  if v_name is null then
    select nullif(btrim(np.display_name), '') into v_name
      from public.network_profiles np where np.m_uid = p_m_uid;
  end if;

  insert into public.network_conversations(kind, created_by_m_uid)
  values ('direct', v_admin)
  returning id into v_conv;

  -- Both members are active, not "requested": the new member can reply
  -- straight away without accepting anything.
  insert into public.network_conversation_members(conversation_id, m_uid, role)
  values (v_conv, v_admin, 'owner'), (v_conv, p_m_uid, 'member')
  on conflict do nothing;

  v_body :=
    'Hey' || coalesce(' ' || v_name, '') || ', what''s going on? Welcome to McCluster.' || chr(10) || chr(10) ||
    'Glad you''re here. This is where the music, Mnet and the people around it all live in one place.' || chr(10) || chr(10) ||
    'Any questions, comments or concerns, just reply to this message. It comes straight to me and I read every one.' || chr(10) || chr(10) ||
    'Want a quick look around first? Take the walkthrough:' || chr(10) ||
    'https://matthew.mccluster.org/mnet.html?tour=1' || chr(10) || chr(10) ||
    '— Matthew';

  insert into public.network_messages(conversation_id, sender_m_uid, body)
  values (v_conv, v_admin, v_body);

  update public.network_conversations
     set last_message_at = now(), updated_at = now()
   where id = v_conv;

  update public.network_profiles set welcomed_at = now() where m_uid = p_m_uid;
end;
$$;

revoke all on function public.mnet_send_welcome(uuid) from public, anon, authenticated;

comment on function public.mnet_send_welcome(uuid) is
  'Matthew''s welcome, sent once per member when their network profile is created, with the walkthrough link.';

create or replace function public.mnet_welcome_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  begin
    perform public.mnet_send_welcome(new.m_uid);
  exception when others then
    -- Never let a greeting stop somebody from signing up.
    raise warning 'mnet_send_welcome failed for %: %', new.m_uid, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.mnet_welcome_on_profile() from public, anon, authenticated;

-- zzz: after zz_mnet_autofollow_admins, so the new member already follows
-- the desk when the message arrives.
drop trigger if exists zzz_mnet_welcome_on_profile on public.network_profiles;
create trigger zzz_mnet_welcome_on_profile
  after insert on public.network_profiles
  for each row execute function public.mnet_welcome_on_profile();

-- ONE-TIME CATCH-UP, approved by the owner on 27 Sep: everyone who joined
-- since the welcome first shipped (25 Sep) and never received it. The two
-- stamped "welcomed" by the replayed migration without a message are
-- un-stamped first. Guarded on "no conversation with the desk yet", so a
-- replay of this migration can never send anybody a second welcome.
do $$
declare v_admin uuid; r record;
begin
  select a into v_admin from public.mnet_admin_m_uids() as a limit 1;
  if v_admin is null then return; end if;
  for r in
    select np.m_uid
      from public.network_profiles np
      join public.m_auth_user_links l on l.m_uid = np.m_uid and l.is_primary = true
      join auth.users u on u.id = l.auth_user_id
     where u.created_at >= '2026-09-25 04:00:00+00'
       and np.m_uid <> v_admin
       and not exists (
         select 1 from public.network_conversation_members me
           join public.network_conversation_members desk
             on desk.conversation_id = me.conversation_id and desk.m_uid = v_admin
          where me.m_uid = np.m_uid)
     order by u.created_at
  loop
    update public.network_profiles set welcomed_at = null where m_uid = r.m_uid;
    begin
      perform public.mnet_send_welcome(r.m_uid);
    exception when others then
      raise warning 'catch-up welcome failed for %: %', r.m_uid, sqlerrm;
    end;
  end loop;
end $$;
