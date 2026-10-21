-- Reconcile leads.status with production.
--
-- Production's leads_status_check already allows the full pipeline
-- vocabulary used by Control and the booking flows (needs-reply, qualified,
-- date-proposed, confirmed, completed, archived, declined), but no repo
-- migration recorded that widening: a fresh rebuild still had the original
-- four states from 0001_crm, so anything writing 'confirmed' failed in CI
-- while succeeding live. This restates production's exact constraint so a
-- rebuild matches it. In production it is a no-op.
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'replied', 'booked', 'closed', 'needs-reply', 'qualified', 'date-proposed',
                    'confirmed', 'completed', 'archived', 'declined'));
