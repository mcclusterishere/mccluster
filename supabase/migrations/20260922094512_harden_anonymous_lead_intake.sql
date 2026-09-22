-- THE ONE DOOR ANYONE COULD WALK THROUGH.
--
-- Audit finding: public.leads carried
--   policy leads_in  INSERT  to {anon, authenticated}  with check (true)
--
-- Literally `true`. Anyone on the internet could insert any number of
-- rows of any size, claiming any pipeline status, forever. Nothing else
-- in this database is open like that: every other {public} policy gates
-- on is_org_member(), current_m_uid() or auth.uid(), all null for an
-- anonymous caller. This was the single exception.
--
-- Not a data LEAK -- leads cannot be read back without being the owner.
-- A write amplifier: a spam sink filling the CRM the front desk works
-- from, and a bill, since storage is metered.
--
-- eu_perspectives already had the right shape for anonymous intake and
-- is the model: accept the insert, constrain what a stranger may assert.
--
-- Verified against the live policy after applying: a genuine lead is
-- accepted; a forged status, a 50KB note and a junk address are refused.

drop policy if exists leads_in on public.leads;

create policy leads_in on public.leads
  for insert to anon, authenticated
  with check (
    -- A stranger does not get to decide where their lead lands. 'new' is
    -- the only status the front door can produce; moving it along is the
    -- desk's job.
    status = 'new'

    -- Ceilings. Without these one request could carry megabytes into a
    -- table nobody can read back to notice.
    and length(coalesce(name, ''))     between 1 and 200
    and length(coalesce(email, ''))    between 3 and 320   -- RFC 5321 max
    and length(coalesce(want, ''))     <= 2000
    and length(coalesce(note, ''))     <= 8000
    and length(coalesce(page, ''))     <= 500
    and length(coalesce(source, ''))   <= 120
    and length(coalesce(medium, ''))   <= 120
    and length(coalesce(campaign, '')) <= 200
    and length(coalesce(gclid, ''))    <= 200

    -- Something shaped like an address, so the pipeline is not full of
    -- rows nobody could ever reply to.
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

comment on policy leads_in on public.leads is
  'Anonymous intake, constrained. Was `with check (true)`: unbounded anonymous writes of any size and any status.';
