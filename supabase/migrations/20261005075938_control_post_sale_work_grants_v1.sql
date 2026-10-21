revoke all on table public.work_relationships, public.work_projects, public.work_deliverables, public.work_renewals, public.work_payments from anon, authenticated;
grant select, insert, update, delete on table public.work_relationships, public.work_projects, public.work_deliverables, public.work_renewals, public.work_payments to service_role;
