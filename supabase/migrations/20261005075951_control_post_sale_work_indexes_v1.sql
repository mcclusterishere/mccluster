create trigger work_relationships_touch before update on public.work_relationships for each row execute function public.work_touch_updated_at();
create trigger work_projects_touch before update on public.work_projects for each row execute function public.work_touch_updated_at();
create trigger work_deliverables_touch before update on public.work_deliverables for each row execute function public.work_touch_updated_at();
create trigger work_renewals_touch before update on public.work_renewals for each row execute function public.work_touch_updated_at();
create trigger work_payments_touch before update on public.work_payments for each row execute function public.work_touch_updated_at();

create index if not exists work_relationships_org_state_idx on public.work_relationships (org_id, state, created_at desc);
create index if not exists work_projects_org_state_idx on public.work_projects (org_id, state, due_at);
create index if not exists work_deliverables_org_state_idx on public.work_deliverables (org_id, state, due_at);
create index if not exists work_renewals_org_due_idx on public.work_renewals (org_id, state, renews_at);
create index if not exists work_payments_org_state_idx on public.work_payments (org_id, state, due_at);
create unique index if not exists work_payments_provider_reference_uidx on public.work_payments (org_id, provider, provider_reference) where provider_reference is not null;

create index if not exists work_relationships_company_id_idx on public.work_relationships (company_id) where company_id is not null;
create index if not exists work_relationships_contact_id_idx on public.work_relationships (contact_id) where contact_id is not null;
create index if not exists work_relationships_lead_id_idx on public.work_relationships (lead_id) where lead_id is not null;
create index if not exists work_projects_company_id_idx on public.work_projects (company_id) where company_id is not null;
create index if not exists work_projects_relationship_id_idx on public.work_projects (relationship_id) where relationship_id is not null;
create index if not exists work_projects_lead_id_idx on public.work_projects (lead_id) where lead_id is not null;
create index if not exists work_projects_order_id_idx on public.work_projects (order_id) where order_id is not null;
create index if not exists work_deliverables_project_id_idx on public.work_deliverables (project_id);
create index if not exists work_renewals_company_id_idx on public.work_renewals (company_id) where company_id is not null;
create index if not exists work_renewals_relationship_id_idx on public.work_renewals (relationship_id) where relationship_id is not null;
create index if not exists work_renewals_project_id_idx on public.work_renewals (project_id) where project_id is not null;
create index if not exists work_renewals_order_id_idx on public.work_renewals (order_id) where order_id is not null;
create index if not exists work_payments_company_id_idx on public.work_payments (company_id) where company_id is not null;
create index if not exists work_payments_lead_id_idx on public.work_payments (lead_id) where lead_id is not null;
create index if not exists work_payments_order_id_idx on public.work_payments (order_id) where order_id is not null;
create index if not exists work_payments_project_id_idx on public.work_payments (project_id) where project_id is not null;
create index if not exists work_payments_renewal_id_idx on public.work_payments (renewal_id) where renewal_id is not null;

comment on table public.work_relationships is 'Control - Work relationship between this org and a company / contact / lead (client, partner, sponsor, vendor...). Written only via /v1/work/relationships.';
comment on table public.work_projects is 'Control - Work post-sale service project, linked to company, relationship, lead and originating order. Written only via /v1/work/projects.';
comment on table public.work_deliverables is 'Control - Work deliverable owed on a project, with delivery and approval state. Written only via /v1/work/deliverables.';
comment on table public.work_renewals is 'Control - Work recurring obligation and next renewal decision; may point at site_accounts / api_subscriptions / offerings. Written only via /v1/work/renewals.';
comment on table public.work_payments is 'Control - Work service-payment ledger. owner_recorded unless a provider reconciler verified it; product checkouts keep their own payment truth and public.payments is the Whip tenant ledger. Written only via /v1/work/payments.';
