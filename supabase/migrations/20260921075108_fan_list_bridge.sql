-- ============================================================
-- THE FAN LIST BRIDGE
--
-- Before this migration, public.fan_profiles.marketing_consent was a
-- boolean that nothing read. A listener could tick "Email me about new
-- records" and be recorded as having consented, and no code anywhere
-- could act on it. Worse, acting on it directly would have been the
-- unlawful thing: a fan row carries no unsubscribe token, so a message
-- sent off the back of that checkbox would have arrived with no working
-- way out — which is the part of CAN-SPAM that actually bites.
--
-- The mailing machinery already exists and is already correct. The
-- outreach engine (out_contacts / out_campaigns / out_recipients /
-- out_suppressions, supabase/functions/outreach + /unsubscribe) carries
-- a per-contact unsub_token, appends a real postal address, sets
-- List-Unsubscribe and List-Unsubscribe-Post, and refuses to send a cold
-- campaign nobody approved. It was simply never connected to the people
-- who listen to the music: it only ever knew inquiries and cold research.
--
-- So this is a bridge, not a second mailing system. Nothing here sends.
-- It moves a consent that already exists onto the rail that can honour it.
--
-- WHY VERIFIED EMAIL IS THE GATE
--   This project runs with mailer_autoconfirm off, so
--   auth.users.email_confirmed_at is only set when the person opens the
--   mail we sent them. An account whose email is confirmed, plus an
--   explicit ticked box recorded against a consent version, is a
--   confirmed opt-in in substance: the address is proven to belong to
--   the person, and the person asked. A fan who ticks the box before
--   confirming is enrolled the moment they confirm, not before.
--
-- THE TWO DIRECTIONS
--   Ticking the box enrols and lifts any earlier suppression for that
--   address, because a suppression left in place would silently drop
--   somebody who just asked to come back.
--   Unticking withdraws consent AND writes a suppression, so a stale row
--   somewhere else cannot resurrect them.
--   Unsubscribing from an email flips the checkbox back, so account.html
--   never shows a ticked box to somebody who has left.
-- ============================================================

-- ------------------------------------------------------------
-- The house. Fan consent belongs to McCluster, not to whichever org a
-- listener might later join.
-- ------------------------------------------------------------
create or replace function public.fan_list_house_org()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $fn$ select id from public.orgs where slug = 'mccluster' limit 1; $fn$;

revoke all on function public.fan_list_house_org() from public, anon, authenticated;

comment on function public.fan_list_house_org() is
  'The org a listener''s marketing consent belongs to. Fan mail is McCluster''s, not any org the listener may later be a member of.';


-- ------------------------------------------------------------
-- Enrol / withdraw. One function, so the trigger on fan_profiles, the
-- trigger on auth.users and the backfill all take exactly the same path:
-- three callers that disagree about what consent means is how a list
-- grows people who never asked for it.
-- ------------------------------------------------------------
create or replace function public.fan_list_sync(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.fan_list_house_org();
  v_email text; v_verified boolean; v_consent boolean; v_at timestamptz; v_name text;
begin
  if v_org is null or p_user_id is null then return; end if;

  select lower(trim(u.email)),
         (f.email_verified_at is not null or u.email_confirmed_at is not null),
         f.marketing_consent, f.marketing_consent_at,
         nullif(trim(coalesce(nullif(f.display_name,''), f.legal_name)),'')
    into v_email, v_verified, v_consent, v_at, v_name
    from public.fan_profiles f join auth.users u on u.id = f.user_id
   where f.user_id = p_user_id;

  if v_email is null or v_email = '' then return; end if;

  -- CONSENTED AND PROVEN. Enrol, and clear the door they may have walked
  -- out of before: an address sitting in out_suppressions is skipped by
  -- the campaign builder forever, so leaving it would make the tick a lie.
  if v_consent and v_verified then
    insert into public.out_contacts (org_id, email, name, consent, consent_source, consent_at)
    values (v_org, v_email, v_name, 'opted_in', 'fan_profile', coalesce(v_at, now()))
    on conflict (org_id, lower(email)) do update
      set consent='opted_in', consent_source='fan_profile',
          consent_at = coalesce(excluded.consent_at, out_contacts.consent_at, now()),
          name = coalesce(excluded.name, out_contacts.name);

    delete from public.out_suppressions where org_id = v_org and address = v_email;

  -- WITHDRAWN. Drop the consent and shut the door, because withdrawal has
  -- to survive any other row that might later claim this address.
  elsif not v_consent then
    update public.out_contacts set consent='none', consent_at=null
     where org_id = v_org and lower(email) = v_email and consent_source = 'fan_profile';

    insert into public.out_suppressions (org_id, address, reason, detail)
    values (v_org, v_email, 'unsubscribed', 'listener unticked marketing consent on account.html')
    on conflict (org_id, address) do nothing;
  end if;

  -- The remaining case is consent = true, email not yet confirmed. That is
  -- deliberately a no-op: the auth.users trigger below enrols them the
  -- moment they open the confirmation mail.
end $fn$;

revoke all on function public.fan_list_sync(uuid) from public, anon, authenticated;

comment on function public.fan_list_sync(uuid) is
  'Reconciles one listener''s marketing consent with out_contacts on the house org. Enrols only a confirmed address; withdrawal also writes a suppression.';


-- ------------------------------------------------------------
-- fan_profiles -> the list.
--
-- AFTER, not BEFORE: fan_profiles_guard() runs BEFORE and is what decides
-- the final value of marketing_consent and stamps marketing_consent_at.
-- Reading the row before that guard has spoken would enrol people against
-- a consent the database had not finished deciding.
-- ------------------------------------------------------------
create or replace function public.fan_list_on_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$ begin perform public.fan_list_sync(new.user_id); return null; end $fn$;

revoke all on function public.fan_list_on_profile() from public, anon, authenticated;

drop trigger if exists zz_fan_list_bridge on public.fan_profiles;
create trigger zz_fan_list_bridge
  after insert or update of marketing_consent, email_verified_at, display_name, legal_name
  on public.fan_profiles for each row execute function public.fan_list_on_profile();


-- ------------------------------------------------------------
-- auth.users -> the list. Somebody who ticks the box during signup is
-- consenting before they have opened the confirmation mail. This is the
-- trigger that lets them in when they finally do, instead of stranding
-- the consent they already gave.
-- ------------------------------------------------------------
create or replace function public.fan_list_on_auth_confirm()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$ begin
  if new.email_confirmed_at is not null then perform public.fan_list_sync(new.id); end if;
  return new; end $fn$;

revoke all on function public.fan_list_on_auth_confirm() from public, anon, authenticated;

drop trigger if exists zz_fan_list_bridge_confirm on auth.users;
create trigger zz_fan_list_bridge_confirm
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.fan_list_on_auth_confirm();


-- ------------------------------------------------------------
-- The list -> fan_profiles. Somebody who hits Unsubscribe in a message
-- has left. If the checkbox on account.html still showed ticked after
-- that, the site would be contradicting the mail, and the next profile
-- save would quietly put them back on the list.
--
-- This cannot loop: fan_list_sync() only inserts a suppression when
-- consent is already false and the insert is idempotent, so the second
-- pass finds nothing to change and stops there.
-- ------------------------------------------------------------
create or replace function public.fan_list_on_suppression()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $fn$ begin
  if new.org_id is distinct from public.fan_list_house_org() then return null; end if;
  update public.fan_profiles f set marketing_consent = false
    from auth.users u
   where u.id = f.user_id and lower(trim(u.email)) = new.address and f.marketing_consent;
  return null; end $fn$;

revoke all on function public.fan_list_on_suppression() from public, anon, authenticated;

drop trigger if exists zz_fan_list_unsubscribe on public.out_suppressions;
create trigger zz_fan_list_unsubscribe
  after insert on public.out_suppressions
  for each row execute function public.fan_list_on_suppression();


-- ------------------------------------------------------------
-- BACKFILL. Every listener who already ticked the box is owed the thing
-- they ticked it for.
-- ------------------------------------------------------------
do $bf$
declare r record;
begin
  if public.fan_list_house_org() is null then
    raise notice 'fan list bridge: no org with slug=mccluster, backfill skipped';
    return;
  end if;
  for r in select user_id from public.fan_profiles where marketing_consent loop
    perform public.fan_list_sync(r.user_id);
  end loop;
end $bf$;
