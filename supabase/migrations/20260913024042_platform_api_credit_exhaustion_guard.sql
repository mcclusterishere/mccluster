alter table public.api_keys drop constraint if exists api_keys_status_check;
alter table public.api_keys add constraint api_keys_status_check check (status in ('active','revoked','exhausted'));

create or replace function public.api_key_credit_state_refresh()
returns trigger language plpgsql security definer set search_path=public as $$
declare bal bigint;
begin
  select coalesce(sum(delta),0)::bigint into bal from public.api_credit_ledger where consumer_id=new.consumer_id;
  if bal <= 0 then
    update public.api_keys set status='exhausted' where consumer_id=new.consumer_id and status='active';
  elsif new.delta > 0 then
    update public.api_keys set status='active' where consumer_id=new.consumer_id and status='exhausted' and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function public.api_key_credit_state_refresh() from public,anon,authenticated;
drop trigger if exists api_credit_state_refresh_trg on public.api_credit_ledger;
create trigger api_credit_state_refresh_trg after insert on public.api_credit_ledger for each row execute function public.api_key_credit_state_refresh();
