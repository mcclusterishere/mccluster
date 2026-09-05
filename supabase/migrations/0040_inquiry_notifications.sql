-- ============================================================
-- INQUIRY NOTIFICATIONS
--
-- A client's Book form is worth nothing if the client never hears about it.
-- The record already lands in `leads` and the conversation in the `site`
-- inbox channel; this adds the part that reaches a person.
--
-- Two small things are needed, and deliberately no new system:
--
--   1. an `email` channel. `inbox_outbound.channel` is a foreign key onto
--      `inbox_channels`, so an emailed notification cannot be recorded in
--      the audit trail migration 0022 built until email exists as a channel.
--      Every social channel there is disabled and unconfigured; email is the
--      one that has to work on day one, because it is how a client finds out
--      someone wants to hire them.
--
--   2. a documented place to say who to tell.
--
-- What is NOT here: a notifications table, a delivery worker, a second
-- queue. `inbox_outbound` already is the record of every attempt to say
-- something, and reusing it means a client's notifications are auditable
-- in the same place as everything else the house sends.
-- ============================================================

-- `label` is NOT NULL with no default, and `can_send_dm` gates whether the
-- channel may originate a message at all. Both are required: without the
-- first this insert fails outright, without the second the channel exists
-- but is not allowed to send.
insert into public.inbox_channels (key, label, enabled, can_send_dm, note)
values ('email', 'Email', true, true,
        'Transactional notifications to a client when their site produces an inquiry. Sent by the Worker, recorded in inbox_outbound.')
on conflict (key) do update set
  enabled = true, label = excluded.label, note = excluded.note;

comment on table public.inbox_outbound is
  'Every attempt to say something outward, including transactional notifications on the email channel. A row is the record of an intention; state is what became of it.';

-- ------------------------------------------------------------
-- WHO GETS TOLD
--
-- Resolved at send time, in this order, and never hardcoded:
--
--   1. every `owner` in org_members, at the email on their McCluster account
--   2. plus orgs.settings->>'notify_email' when set (comma-separated)
--
-- Owners first is the point: a client who signs in already has a verified
-- address and does not have to maintain a second copy of it. notify_email
-- covers the gap before a client has an account, and shared inboxes.
--
-- If neither exists the inquiry is still recorded and still appears in the
-- inbox — it just does not reach anyone, and the API says notified:false
-- rather than implying it was delivered.
-- ------------------------------------------------------------

comment on column public.orgs.settings is
  'Per-org configuration. Recognised keys: notify_email (comma-separated addresses that receive inquiry notifications, in addition to org owners).';

-- Esmer's notify_email is NOT set to Justin's address here. His address is on
-- the client-approval list in the esmer repo (docs/ESMER-DOSSIER.md §13) and
-- has not been supplied, and a migration must never invent one: a plausible
-- address silently routes real bookings into nothing.
--
-- It IS set, as an interim, to the agency address — because the alternative
-- is that an inquiry reaches nobody at all. Applied out of band on
-- 2026-09-05 and recorded here so the repository and the database agree:
--
--   update public.orgs
--      set settings = coalesce(settings,'{}'::jsonb)
--                  || jsonb_build_object('notify_email','matthew@mccluster.org')
--    where slug = 'esmer';
--
-- Hand it over the moment Justin confirms an address, or add him as an org
-- owner and his own account address is used automatically:
--
--   update public.orgs
--      set settings = settings || jsonb_build_object('notify_email','<his address>')
--    where slug = 'esmer';
