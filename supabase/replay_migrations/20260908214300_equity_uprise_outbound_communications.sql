-- Project hardened `out_*` sends into the canonical Policy OS communication
-- timeline as well as the event ledger. Provider callbacks remain in out_events;
-- this layer only normalizes policy-relevant recipients.

create or replace function private.eu_out_event_communication_bridge()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare
  r public.out_recipients%rowtype;
  c public.out_contacts%rowtype;
  campaign public.out_campaigns%rowtype;
  stakeholder public.eu_stakeholders%rowtype;
  link public.eu_stakeholder_links%rowtype;
  comm_id uuid;
  dir text:='out';
begin
  if new.recipient_id is null then return new; end if;
  select * into r from public.out_recipients where id=new.recipient_id;
  if r.id is null or r.contact_id is null then return new; end if;
  select * into c from public.out_contacts where id=r.contact_id;
  select * into stakeholder from public.eu_stakeholders where org_id=new.org_id and out_contact_id=c.id limit 1;
  if stakeholder.id is null then return new; end if;
  select * into link from public.eu_stakeholder_links where stakeholder_id=stakeholder.id order by updated_at desc limit 1;
  if link.id is null then return new; end if;
  select * into campaign from public.out_campaigns where id=r.campaign_id;

  -- One communication row per outbound recipient/provider message. Delivery,
  -- click, bounce, etc. update classification instead of creating copies.
  select id into comm_id from public.eu_communications
   where org_id=new.org_id and provider='resend' and out_recipient_id=r.id limit 1;
  if comm_id is null and lower(new.type)='sent' then
    insert into public.eu_communications(
      org_id,initiative_id,stakeholder_id,stakeholder_link_id,channel,provider,direction,
      external_message_id,out_recipient_id,from_address,to_addresses,subject,body_excerpt,
      classification,occurred_at,raw_ref
    ) values(
      new.org_id,link.initiative_id,stakeholder.id,link.id,'email','resend',dir,
      coalesce(r.provider_id,''),r.id,
      coalesce((select from_email from public.out_sender_identities where id=campaign.sender_id),''),
      jsonb_build_array(r.address),coalesce(campaign.subject,''),left(coalesce(campaign.body_text,''),8000),
      jsonb_build_object('delivery_state','sent','campaign_id',campaign.id,'campaign_name',campaign.name),
      new.at,jsonb_build_object('out_event_id',new.id,'out_recipient_id',r.id,'campaign_id',campaign.id,'provider_id',r.provider_id)
    ) returning id into comm_id;
  elsif comm_id is not null then
    update public.eu_communications set classification=classification||jsonb_build_object(
      'delivery_state',lower(new.type),'last_provider_event_at',new.at,'last_provider_event_id',new.id,
      'provider_detail',coalesce(new.detail,'{}'::jsonb)
    ) where id=comm_id;
  end if;
  return new;
end;$fn$;
revoke all on function private.eu_out_event_communication_bridge() from public,anon,authenticated;

drop trigger if exists eu_out_events_communication_bridge on public.out_events;
create trigger eu_out_events_communication_bridge after insert on public.out_events
for each row execute function private.eu_out_event_communication_bridge();
