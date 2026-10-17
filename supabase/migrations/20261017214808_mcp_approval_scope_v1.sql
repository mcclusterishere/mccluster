-- SECURITY P0: stage before deploying the matching inbox Edge Function.
-- Canonical mcp_approvals remain readable under the existing org RLS policy,
-- but browser roles must not rewrite a proposed tool/arguments/state.
-- This is a forward-only pending migration until reviewed and promoted.
begin;

revoke update on table public.mcp_approvals from public, anon, authenticated;
drop policy if exists mcp_approvals_decide on public.mcp_approvals;

create or replace function public.mcp_decide_scoped(
  p_id uuid, p_org_id uuid, p_approve boolean, p_by uuid
) returns public.mcp_approvals
language plpgsql security definer set search_path to ''
as $function$
declare decided public.mcp_approvals%rowtype;
begin
  if p_id is null or p_org_id is null or p_approve is null or p_by is null then
    raise exception 'Approval decision requires canonical IDs and intent' using errcode = '22023';
  end if;

  -- The validated org is part of the atomic update, not a check after
  -- the approval has already been consumed by a privileged RPC.
  update public.mcp_approvals a
     set state = case when p_approve then 'approved' else 'denied' end,
         decided_by = p_by,
         decided_at = now()
   where a.id = p_id
     and a.org_id = p_org_id
     and a.state = 'pending'
     and a.expires_at > now()
  returning a.* into decided;
  return decided;
end;
$function$;

revoke all on function public.mcp_decide_scoped(uuid,uuid,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.mcp_decide_scoped(uuid,uuid,boolean,uuid) to service_role;

-- Keep the legacy service-only mcp_decide RPC operational until the Edge
-- Function is deployed. Revoke its service_role permission in a later
-- reconciled migration after proving no canonical caller still uses it.
commit;
