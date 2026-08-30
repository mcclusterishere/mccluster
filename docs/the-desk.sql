-- ============================================================
-- THE DESK — CRM + outreach engine.
-- Run after the vault SQL. Safe to re-run.
--
-- Design law: the desk shows ONE next action, never a list of 200.
-- Everything here exists to answer a single question well —
-- "who do I talk to next, and what do I say?" — and the answer is a
-- row the database computes, not a queue the owner has to triage.
-- ============================================================

-- ---------- people and houses ----------
create table if not exists public.crm_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  role        text,                       -- 'photo editor', 'comms director', 'chapter president'
  org         text,
  org_kind    text,                       -- press | county | nonprofit | brand | venue | agency
  city        text,
  site        text,
  social      text,
  -- where they came from
  origin      text default 'manual'
              check (origin in ('manual','lead','event','press','referral','import')),
  lead_id     uuid,                       -- the leads row that became this contact
  event_id    text,                       -- the shoot they were at
  -- the pipeline
  stage       text not null default 'new'
              check (stage in ('new','researching','contacted','replied','meeting','proposal','won','lost','nurture')),
  value       numeric,                    -- what the relationship is worth, best estimate
  heat        int default 0,              -- 0-100, computed from signals
  owner_note  text,
  next_at     date,                       -- when to touch them again
  last_touch  timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists crm_contacts_stage on public.crm_contacts (stage);
create index if not exists crm_contacts_next  on public.crm_contacts (next_at);
create unique index if not exists crm_contacts_email on public.crm_contacts (lower(email)) where email is not null;

-- ---------- every touch, in and out ----------
create table if not exists public.crm_touches (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references public.crm_contacts(id) on delete cascade,
  direction   text not null check (direction in ('out','in')),
  channel     text not null default 'email'
              check (channel in ('email','call','text','dm','in-person','note')),
  subject     text,
  body        text,
  template_id text,
  sent_at     timestamptz default now(),
  opened_at   timestamptz,
  replied_at  timestamptz,
  provider_id text,                       -- the id the email service gave back
  status      text default 'sent'
              check (status in ('draft','queued','sent','failed','bounced'))
);
create index if not exists crm_touches_contact on public.crm_touches (contact_id, sent_at desc);

-- ---------- what the front of the house noticed ----------
-- Subtle by design: no forms, no popups. The site records what a visitor
-- actually did, and when they eventually leave a name it all joins up.
create table if not exists public.crm_signals (
  id          uuid primary key default gen_random_uuid(),
  visitor     text not null,              -- anonymous device id
  contact_id  uuid references public.crm_contacts(id) on delete set null,
  kind        text not null,              -- wall_view | print_open | rate_view | film_play | return_visit | deep_read
  detail      text,                       -- which wall, which print, which page
  weight      int default 1,              -- how much this predicts intent
  at          timestamptz default now()
);
create index if not exists crm_signals_visitor on public.crm_signals (visitor, at desc);
create index if not exists crm_signals_contact on public.crm_signals (contact_id);

-- ---------- what to say ----------
create table if not exists public.crm_templates (
  id          text primary key,
  label       text not null,
  purpose     text,                       -- when to reach for it
  subject     text not null,
  body        text not null,              -- {{name}} {{org}} {{event}} {{wall}} {{me}}
  stage_from  text,                       -- suggested when contact is at this stage
  stage_to    text,                       -- move them here after sending
  wait_days   int default 4,              -- how long before the follow-up is due
  created_at  timestamptz default now()
);

-- ---------- sequences: a template chain, not a spam cannon ----------
create table if not exists public.crm_sequences (
  id          text primary key,
  label       text not null,
  steps       text[] not null,            -- ordered template ids
  gap_days    int[] not null,             -- days to wait before each step
  note        text
);
alter table public.crm_contacts
  add column if not exists sequence_id text references public.crm_sequences(id),
  add column if not exists sequence_step int default 0;

-- ---------- RLS: owner only, everywhere ----------
do $$
declare t text;
begin
  foreach t in array array['crm_contacts','crm_touches','crm_templates','crm_sequences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_owner_all on public.%I', t);
    execute format(
      'create policy crm_owner_all on public.%I for all
         using ((auth.jwt() ->> ''email'') = ''matthew@mccluster.org'')
         with check ((auth.jwt() ->> ''email'') = ''matthew@mccluster.org'')', t);
  end loop;
end $$;

-- signals are written by anonymous visitors and read only by the owner
alter table public.crm_signals enable row level security;
drop policy if exists crm_signal_insert on public.crm_signals;
create policy crm_signal_insert on public.crm_signals for insert to anon, authenticated
  with check (true);
drop policy if exists crm_signal_read on public.crm_signals;
create policy crm_signal_read on public.crm_signals for select
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

-- ============================================================
-- HEAT — how interested is this person, on the evidence
-- ============================================================
create or replace function public.crm_heat(c public.crm_contacts)
returns int language sql stable as $$
  select least(100, coalesce((
    select sum(s.weight) * 6 from public.crm_signals s where s.contact_id = c.id
  ), 0) + case c.stage
      when 'replied'  then 40
      when 'meeting'  then 60
      when 'proposal' then 75
      when 'contacted' then 15
      else 0 end
    + case when c.last_touch > now() - interval '7 days' then 10 else 0 end);
$$;

-- ============================================================
-- THE ONE THING TO DO NEXT
-- One row out. Not a queue, not a list — the single best move,
-- with the reason attached so the desk can say WHY.
-- ============================================================
create or replace view public.crm_next_move as
with scored as (
  select c.*,
    public.crm_heat(c) as heat_now,
    case
      when c.stage = 'replied'                                   then 100
      when c.stage = 'proposal' and c.next_at <= current_date     then 95
      when c.stage = 'meeting'  and c.next_at <= current_date     then 90
      when c.next_at is not null and c.next_at <= current_date    then 80
      when c.stage = 'new'      and c.email is not null           then 60
      when c.stage = 'contacted'
           and c.last_touch < now() - interval '5 days'           then 55
      when c.stage = 'nurture'  and c.next_at <= current_date     then 30
      else 0 end as urgency,
    case
      when c.stage = 'replied'  then 'They replied. Answer before the thread goes cold.'
      when c.stage = 'proposal' then 'A proposal is out and the follow-up is due.'
      when c.stage = 'meeting'  then 'A meeting is on the record and needs its next step.'
      when c.stage = 'new'      then 'Never contacted. First touch is the whole job.'
      when c.stage = 'contacted' then 'Sent, no answer, five days gone. One follow-up beats silence.'
      else 'Scheduled for today.' end as why
  from public.crm_contacts c
  where c.stage not in ('won','lost')
)
select * from scored where urgency > 0
order by urgency desc, heat_now desc, next_at nulls last
limit 50;

-- the shape of the pipeline, for the strip across the top
create or replace view public.crm_pipeline as
  select stage, count(*) as n, coalesce(sum(value), 0) as worth
  from public.crm_contacts
  where stage not in ('lost')
  group by stage;

-- ============================================================
-- THE STARTER TEMPLATES — written for THIS business
-- ============================================================
insert into public.crm_templates (id, label, purpose, subject, body, stage_from, stage_to, wait_days) values
('press-cold','Photo editor — cold',
 'A local outlet that covered an event you also shot. The strongest cold open you have.',
 'Photographs from {{event}} — {{org}}',
 E'Hi {{name}},\n\nI photographed {{event}} and saw {{org}} covered it.\n\nI keep a full set — captioned in wire format, credited and ready to run:\n{{wall}}\n\nIf they are useful, they are available now, and I am usually at these before anyone calls me. Happy to be on your list for the next one.\n\nMatthew McCluster\nMcCluster Corp · {{me}}',
 'new','contacted',5),

('client-recap','Client — after the shoot',
 'Sent the day the wall goes up. Turns one job into the next one.',
 'Your photographs from {{event}} are up',
 E'Hi {{name}},\n\nThe set from {{event}} is ready:\n{{wall}}\n\nEverything is captioned, credited and sized for press or social — use whatever you need. If you want the full-resolution files or prints for the office, just say the word.\n\nOne thing that helps us both: if the photographs go on your site or in a release, a credit link back to the page above means anyone searching {{org}} finds the coverage too.\n\nMatthew McCluster\nMcCluster Corp · {{me}}',
 'won','nurture',30),

('org-cold','Organisation — cold',
 'A nonprofit, chapter or county office that runs events you are not shooting yet.',
 'Covering {{org}} the way {{event}} was covered',
 E'Hi {{name}},\n\nI am a photographer and filmmaker in metro Atlanta. Most of my work is civic — groundbreakings, programmes, chapter events — shot for the organisation rather than for a wire.\n\nA recent one, so you can see the standard rather than take my word:\n{{wall}}\n\nIf {{org}} has something coming up, I would like to be the one who covers it. Same day turnaround on selects, full set within the week, everything captioned and credited.\n\nMatthew McCluster\nMcCluster Corp · {{me}}',
 'new','contacted',6),

('follow-1','Follow-up — one nudge',
 'Five days of silence. One short nudge, never two.',
 'Re: {{subject_prev}}',
 E'Hi {{name}},\n\nBumping this once in case it landed at a bad moment. The set is still here if it is useful:\n{{wall}}\n\nEither way, no hard feelings — I will stay out of your inbox.\n\nMatthew',
 'contacted','nurture',0),

('warm-signal','Warm — they were on the site',
 'Fires when someone has been reading walls and rate pages. They already want it.',
 'Saw you were looking at the work',
 E'Hi {{name}},\n\nYou have been through a few of the walls — thank you for the time.\n\nIf there is something coming up you are weighing a photographer for, I am happy to talk through it with no pitch attached. Rates and lanes are here: {{me}}/hire.html\n\nMatthew McCluster\nMcCluster Corp',
 'new','contacted',4)
on conflict (id) do update set
  label = excluded.label, purpose = excluded.purpose, subject = excluded.subject,
  body = excluded.body, stage_from = excluded.stage_from, stage_to = excluded.stage_to;

insert into public.crm_sequences (id, label, steps, gap_days, note) values
('press-run','Photo editor run', array['press-cold','follow-1'], array[0,5],
 'Two touches, then stop. A photo editor who has not answered twice is not interested this month — put them in nurture and send the next event instead.'),
('org-run','Organisation run', array['org-cold','follow-1'], array[0,6],
 'Same discipline. Two touches maximum.')
on conflict (id) do nothing;

select 'desk ready' as status,
  (select count(*) from public.crm_contacts)  as contacts,
  (select count(*) from public.crm_templates) as templates;
