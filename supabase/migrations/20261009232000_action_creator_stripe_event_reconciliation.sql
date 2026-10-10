create or replace function public.action_creator_record_stripe_event(p_event_id text,p_transfer_id text,p_kind text,p_amount_cents bigint)
returns boolean language plpgsql security invoker set search_path=public as $$
declare p public.action_creator_payout_intents%rowtype;
begin
 if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
 if p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_transfer_id !~ '^tr_[A-Za-z0-9]+$' or p_kind not in ('transfer.reversed','payout.paid','payout.failed') then raise exception 'invalid event'; end if;
 select * into p from public.action_creator_payout_intents where stripe_transfer_id=p_transfer_id for update;
 if not found then return false; end if;
 insert into public.action_creator_payout_events(payout_intent_id,org_id,event_key,event_type,amount_cents)
 values(p.id,p.org_id,p_event_id,p_kind,p_amount_cents) on conflict(event_key) do nothing;
 if not found then return false; end if;
 if p_kind='transfer.reversed' then
   if p.state='transferred' and p_amount_cents >= p.amount_cents then
     update public.action_creator_payout_intents set state='reversed',updated_at=now() where id=p.id;
   end if;
 end if;
 return true;
end $$;
revoke all on function public.action_creator_record_stripe_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.action_creator_record_stripe_event(text,text,text,bigint) to service_role;