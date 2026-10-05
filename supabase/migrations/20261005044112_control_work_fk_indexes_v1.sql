create index if not exists work_orders_lead_id_idx
  on public.work_orders (lead_id) where lead_id is not null;
create index if not exists work_orders_company_id_idx
  on public.work_orders (company_id) where company_id is not null;
create index if not exists work_bookings_lead_id_idx
  on public.work_bookings (lead_id) where lead_id is not null;
create index if not exists work_bookings_company_id_idx
  on public.work_bookings (company_id) where company_id is not null;
