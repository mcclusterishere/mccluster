-- ============================================================
-- The booking funnel the Worker speaks, and the four words the table
-- would accept, were different vocabularies. They shared exactly one
-- word: 'new'.
--
--   leads_status_check : new, replied, booked, closed
--   BOOKING_STATES     : new, needs-reply, qualified, date-proposed,
--                        confirmed, completed, archived, declined
--
-- So PATCH /v1/clients/<slug>/inquiries/<id> — the only way a client
-- moves a quote request along — failed with a 23514 check violation for
-- every status but 'new', for every client tenant on the plane. Found by
-- walking Level 3's desk: the dropdown wrote 'qualified' and the row
-- refused it.
--
-- Widen to the UNION rather than swapping one list for the other. The
-- four originals are not dead: admin.html and crm.html both read and
-- write 'booked' and 'closed', and existing rows carry them. Dropping
-- those to make the constraint tidy would break the operator desk to fix
-- the client desk.
-- ============================================================

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (
  status = any (array[
    -- the operator desk's original vocabulary, still written by
    -- admin.html and crm.html
    'new', 'replied', 'booked', 'closed',
    -- the client booking funnel the Worker exposes
    'needs-reply', 'qualified', 'date-proposed', 'confirmed',
    'completed', 'archived', 'declined'
  ])
);
