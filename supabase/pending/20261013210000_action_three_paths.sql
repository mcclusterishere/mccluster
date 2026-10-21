-- PENDING ONLY: PR #426 proposal, not recorded in the production migration ledger.
-- Reconcile with the current mission catalog and apply through the production ledger workflow before promotion.
-- Three user-facing action paths share the existing mission and proof lifecycle.
-- Keep kind='civic'/'clip' for existing financial and verification boundaries.
alter table public.action_missions add column if not exists action_path text;
alter table public.action_missions add constraint action_missions_action_path_check
  check (action_path is null or action_path in ('create','amplify','show_up'));
comment on column public.action_missions.action_path is
  'User-facing participation path; orthogonal to commercial mission kind and domain.';
update public.action_missions set action_path =
  case when kind='clip' then 'amplify'
       when domain='creative' then 'create'
       when domain in ('community','mutual_aid','advocacy') then 'show_up'
       else null end
where action_path is null;
-- Remove joke mission from discovery without deleting the existing assignment or proof.
update public.action_missions set status='closed', updated_at=now()
where id='6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04' and status='open';
