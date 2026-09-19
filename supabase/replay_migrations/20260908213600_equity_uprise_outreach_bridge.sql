-- Bridge Policy OS relationships into the existing hardened `out_*` outreach
-- engine. Equity Uprise does not create a second sender/suppression pipeline.

create or replace function private.eu_stakeholder_to_out_contact()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_out uuid; v_consent text:='none';
begin
  if nullif(lower(trim(new.email)),'') is null then return new; end if;
  if new.source in ('equity-uprise-intake','equity-uprise-fellowship') then v_consent:='inquired'; end if;
  if coalesce((new.consent->>'email_optin')::boolean,false) then v_consent:='opted_in'; end if;

  select id into v_out from public.out_contacts
   where org_id=new.org_id and lower(email)=lower(new.email) limit 1;
  if v_out is null then
    insert into public.out_contacts(org_id,email,name,title,consent,consent_source,consent_at)
    values(new.org_id,lower(new.email),nullif(new.name,''),nullif(new.title,''),v_consent,
           case when v_consent='none' then null else 'equity-uprise' end,
           case when v_consent='none' then null else now() end)
    returning id into v_out;
  else
    update public.out_contacts set
      name=coalesce(nullif(new.name,''),name),
      title=coalesce(nullif(new.title,''),title),
      consent=case
        when consent='opted_in' then consent
        when v_consent='opted_in' then 'opted_in'
        when consent='inquired' or v_consent='inquired' then 'inquired'
        else 'none' end,
      consent_source=case when v_consent<>'none' then 'equity-uprise' else consent_source end,
      consent_at=case when v_consent<>'none' then coalesce(consent_at,now()) else consent_at end
    where id=v_out;
  end if;
  if new.out_contact_id is distinct from v_out then
    update public.eu_stakeholders set out_contact_id=v_out where id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.eu_stakeholder_to_out_contact() from public,anon,authenticated;

drop trigger if exists eu_stakeholders_out_contact_bridge on public.eu_stakeholders;
create trigger eu_stakeholders_out_contact_bridge
after insert or update of email,name,title,consent on public.eu_stakeholders
for each row when (new.email <> '') execute function private.eu_stakeholder_to_out_contact();

-- Backfill any Policy OS stakeholder that already has an email once this runs.
do $$ declare r record; begin
  for r in select * from public.eu_stakeholders where email<>'' and out_contact_id is null loop
    update public.eu_stakeholders set email=email where id=r.id;
  end loop;
end $$;

-- Outbound provider events become canonical policy events and relationship
-- state automatically where the recipient belongs to a Policy OS stakeholder.
create or replace function private.eu_out_event_bridge()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_contact uuid; v_stakeholder uuid; v_link record; v_event text; v_idem text;
begin
  if new.recipient_id is null then return new; end if;
  select contact_id into v_contact from public.out_recipients where id=new.recipient_id;
  if v_contact is null then return new; end if;
  select id into v_stakeholder from public.eu_stakeholders
    where org_id=new.org_id and out_contact_id=v_contact limit 1;
  if v_stakeholder is null then return new; end if;
  select * into v_link from public.eu_stakeholder_links
    where stakeholder_id=v_stakeholder order by updated_at desc limit 1;
  if v_link.id is null then return new; end if;

  v_event:=case lower(new.type)
    when 'sent' then 'outreach.sent'
    when 'delivered' then 'outreach.delivered'
    when 'opened' then 'outreach.opened'
    when 'clicked' then 'outreach.clicked'
    when 'bounced' then 'outreach.bounced'
    when 'complained' then 'outreach.complained'
    when 'unsubscribed' then 'outreach.unsubscribed'
    else 'outreach.'||lower(regexp_replace(new.type,'[^a-zA-Z0-9_-]+','-','g')) end;
  v_idem:='out-event:'||new.id::text;

  insert into public.eu_events(org_id,initiative_id,event_type,entity_type,entity_id,source_system,source_id,occurred_at,data,idempotency_key)
  values(new.org_id,v_link.initiative_id,v_event,'out_events',new.id::text,'outreach',new.id::text,new.at,
         jsonb_build_object('stakeholder_id',v_stakeholder,'stakeholder_link_id',v_link.id,'recipient_id',new.recipient_id,'address',new.address,'detail',coalesce(new.detail,'{}'::jsonb)),v_idem)
  on conflict(org_id,idempotency_key) where idempotency_key is not null do nothing;

  if new.type='sent' and (v_link.stage_source<>'human' or v_link.stage in ('identified','researching','queued','contacted')) then
    update public.eu_stakeholder_links set stage='contacted',stage_source='system',stage_reason='Outbound provider sent',last_contact_at=new.at where id=v_link.id;
  elsif new.type in ('bounced','complained','unsubscribed') then
    update public.eu_stakeholder_links set next_action='Review outreach delivery problem',next_action_at=now(),stage_reason='Outbound event: '||new.type where id=v_link.id;
  end if;
  return new;
end;
$$;
revoke all on function private.eu_out_event_bridge() from public,anon,authenticated;

drop trigger if exists eu_out_events_bridge on public.out_events;
create trigger eu_out_events_bridge after insert on public.out_events
for each row execute function private.eu_out_event_bridge();
