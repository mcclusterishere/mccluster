-- ============================================================
-- THE GATES — a lane stays LOCKED until the catalog proves it qualifies.
-- Run AFTER docs/the-vault-targets.sql. Safe to re-run.
--
-- The rule the owner asked for: no lane opens on a feeling. Every
-- premium and wire application has a bar, the bar is written down as a
-- row, and the database counts your own catalog against it. Nothing is
-- "ready" because you think it is — it is ready when the count says so.
--
-- Three kinds of gate:
--   COUNT     — you need N captures matching a filter
--   FLAG      — a fact about the house (releases on file, bylines, a
--               portfolio URL that resolves)
--   CONFLICT  — a lane that CANNOT coexist with another. Exclusivity is
--               not a hurdle you clear, it is a door that closes others.
-- ============================================================

alter table public.vault_targets
  add column if not exists exclusive     boolean default false,
  add column if not exists min_portfolio int,
  add column if not exists wants         text,      -- what the reviewer is actually looking for
  add column if not exists avoid         text,      -- what they are oversupplied on
  add column if not exists applied_at    date,
  add column if not exists outcome       text
    check (outcome in ('none','applied','waitlist','accepted','declined'));

update public.vault_targets set outcome = 'none' where outcome is null;

-- ---------- the gate rows ----------
create table if not exists public.vault_gates (
  id          uuid primary key default gen_random_uuid(),
  target_id   text not null references public.vault_targets(id) on delete cascade,
  kind        text not null check (kind in ('count','flag','conflict')),
  label       text not null,               -- shown on the desk
  detail      text,                        -- why this bar exists
  need        int default 1,               -- COUNT: how many. FLAG: 1.
  -- COUNT filters, all optional and ANDed
  f_status    text,                        -- 'reviewed' | 'published'
  f_kind      text,                        -- 'photo' | 'video'
  f_release   boolean,                     -- release_clear must equal this
  f_event     text,                        -- a specific event id
  f_since     interval,                    -- shot within this window
  -- FLAG: which house fact must be true
  f_house     text,                        -- 'has_releases' | 'has_bylines' | 'has_portfolio' | 'has_copyright'
  -- CONFLICT: which other target makes this impossible
  f_conflict  text references public.vault_targets(id) on delete cascade,
  created_at  timestamptz default now()
);
create index if not exists vault_gates_target on public.vault_gates (target_id);

alter table public.vault_gates enable row level security;
drop policy if exists vault_owner_all on public.vault_gates;
create policy vault_owner_all on public.vault_gates for all
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

-- ---------- credentials, entered from the desk ----------
-- The owner asked to hold everything inside the system. This is that store.
-- READ THE SECURITY NOTE in docs/the-vault-gates.md before filling it:
-- RLS keeps every other signed-in user out, but the service_role key and
-- anyone with database access can read these. Use secret_ref instead of
-- password for anything you would be sick to lose.
create table if not exists public.vault_credentials (
  target_id   text primary key references public.vault_targets(id) on delete cascade,
  host        text,
  port        int,
  protocol    text check (protocol in ('sftp','ftp','ftps','https','none')),
  username    text,
  password    text,                       -- see the note above
  secret_ref  text,                       -- e.g. 'ADOBE_SFTP_PASS' — the safer path
  remote_dir  text default '/',
  contributor_url text,
  account_email   text,
  notes       text,
  verified_at timestamptz,
  updated_at  timestamptz default now()
);
alter table public.vault_credentials enable row level security;
drop policy if exists vault_owner_all on public.vault_credentials;
create policy vault_owner_all on public.vault_credentials for all
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

-- ---------- house facts the flags read ----------
alter table public.vault_house
  add column if not exists bylines      int default 0,      -- published credits to date
  add column if not exists portfolio_url text default 'https://matthew.mccluster.org/walls.html',
  add column if not exists copyright_filed boolean default false;

-- ============================================================
-- WHAT EACH PREMIUM HOUSE IS ACTUALLY LOOKING FOR
-- ============================================================
update public.vault_targets set
  exclusive = true, min_portfolio = 25,
  wants = 'Originality, creativity, consistency and exciting ideas — they say outright you do not need years of industry experience. A coherent point of view across 25+ images matters more than technical polish on any one.',
  avoid = 'They are ALREADY well-represented in landscape, nature, wildlife and weddings. Applicants working OUTSIDE those areas are more likely to get in — which is exactly where authentic Black civic and community life sits.'
where id = 'stocksy';

update public.vault_targets set
  min_portfolio = 50,
  wants = 'Talent, creativity and ambition — a special look, a distinct choice of topics, a personal style that is visibly yours. 100% real people, no synthetic faces. Royalties run 40-60%.',
  avoid = 'Generic stock looks. JPG/PNG submissions must be under 6 MB each.'
where id = 'westend61';

update public.vault_targets set
  min_portfolio = 50,
  wants = 'Authentic lifestyle — real people in real situations, diverse and un-staged. They are building the collection that microstock is worst at.',
  avoid = 'Anything that reads as posed stock. Model-released work is essential here — this is a commercial lane.'
where id = 'cavan';

update public.vault_targets set
  min_portfolio = 30,
  wants = 'Editorial and portrait representation — they take on ASSIGNMENT photographers, so they are assessing whether they can send you to a job tomorrow. Published bylines carry more weight than volume.',
  avoid = 'Pure stock portfolios with no editorial narrative.'
where id = 'redux';

update public.vault_targets set
  min_portfolio = 40,
  wants = 'Premium commercial imagery with a distinct authored feel. Invitation-based — usually extended to strong existing Shutterstock contributors.',
  avoid = 'Applying cold. Build the Shutterstock account first and let them come.'
where id = 'offset';

-- ============================================================
-- THE GATES THEMSELVES
-- ============================================================
delete from public.vault_gates;

-- ---- Stocksy: the exclusivity door ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_release, f_conflict, f_house) values
 ('stocksy','count','25 reviewed, release-clear frames',
  'Their stated minimum is 25 images. Release-clear because a commercial premium agency cannot license a face without paper.',
  25,'reviewed',true,null,null),
 ('stocksy','count','A coherent body — 40+ reviewed frames total',
  'They buy a point of view, not a sampler. Depth is what reads as coherent.',
  40,'reviewed',null,null,null),
 ('stocksy','conflict','EXCLUSIVITY: cannot coexist with microstock',
  'Stocksy requires image AND video exclusivity — anything you put there cannot be licensed through any other agency. Onboarding Adobe Stock closes this door for those files, and vice versa. This is a fork in the road, not a checklist item.',
  1,null,null,'adobe-stock',null),
 ('stocksy','flag','Model releases on file',
  'A commercial premium lane. Every identifiable face needs paper.',
  1,null,null,null,'has_releases');

-- ---- Westend61 ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_release, f_house) values
 ('westend61','count','50 reviewed, release-clear frames',
  'A curated agency reviewing whether your style holds across a body of work.',
  50,'reviewed',true,null),
 ('westend61','flag','Model releases on file',
  '100% real people is their stated position — which means real releases.',
  1,null,null,'has_releases');

-- ---- Cavan ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_release, f_house) values
 ('cavan','count','50 reviewed, release-clear lifestyle frames',
  'Authentic lifestyle is the whole brief, and it is commercial — releases required.',
  50,'reviewed',true,null),
 ('cavan','flag','Model releases on file',
  'Non-negotiable for this lane.',1,null,null,'has_releases');

-- ---- Redux: bylines matter more than volume ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_house) values
 ('redux','count','30 reviewed editorial frames',
  'Enough to show you can carry a story, not just a frame.',30,'reviewed',null),
 ('redux','flag','Published bylines on the record',
  'They represent ASSIGNMENT photographers. The question they are answering is whether they could send you on a job tomorrow — and a published credit answers it better than a portfolio does.',
  1,null,'has_bylines'),
 ('redux','flag','Portfolio URL that resolves',
  'matthew.mccluster.org/walls.html — built for exactly this submission.',
  1,null,'has_portfolio');

-- ---- Offset ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_release, f_conflict) values
 ('offset','count','40 reviewed, release-clear frames',
  'Premium tier. Invitation usually follows a strong Shutterstock record.',
  40,'reviewed',true,null);
insert into public.vault_gates (target_id, kind, label, detail, need, f_conflict) values
 ('offset','conflict','Shutterstock account should come FIRST',
  'Offset invitations typically go to established Shutterstock contributors. Applying cold wastes the shot.',
  1,null);

-- ---- The wires: bylines and a portfolio, not volume ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_house)
select t.id,'count','20 reviewed editorial frames',
  'A wire wants to see you can cover an event start to finish, cleanly captioned.',20,'reviewed',null
from public.vault_targets t where t.lane = 'editorial' and t.rail <> 'manual';

insert into public.vault_gates (target_id, kind, label, detail, need, f_house)
select t.id,'flag','Portfolio URL that resolves',
  'Send them matthew.mccluster.org/walls.html — the wall pages carry the client, the date, the caption and the press citations already.',
  1,'has_portfolio'
from public.vault_targets t where t.lane = 'editorial' and t.rail <> 'manual';

insert into public.vault_gates (target_id, kind, label, detail, need, f_house) values
 ('ap-images','flag','Published bylines on the record',
  'The hardest door on the list. Walk in with wire credits already earned.',1,'has_bylines'),
 ('getty-editorial','flag','Published bylines on the record',
  'Getty Editorial assesses track record, not just pictures.',1,'has_bylines');

-- ---- Microstock: the honest bar is low, and that is the point ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_status, f_release)
select t.id,'count','10 reviewed, release-clear frames for the entry test',
  'Adobe, Shutterstock and Alamy gate entry on a small quality test. Ten clean, sharp, logo-free frames clears it.',
  10,'reviewed',true
from public.vault_targets t where t.lane = 'microstock';

-- ---- Copyright first, everywhere ----
insert into public.vault_gates (target_id, kind, label, detail, need, f_house)
select t.id,'flag','Backlog registered with the Copyright Office',
  'Register BEFORE you distribute. Timely registration is what unlocks statutory damages; once a file is out on twenty agencies you have lost the cheapest protection you will ever buy.',
  1,'has_copyright'
from public.vault_targets t where t.lane in ('microstock','premium');

-- ============================================================
-- THE READINESS ENGINE — counts your catalog against every gate
-- ============================================================
create or replace function public.gate_met(g public.vault_gates)
returns boolean language plpgsql stable as $$
declare have int;
begin
  -- A lane with NO gates is not a locked lane. The readiness view LEFT
  -- JOINs, so an ungated target arrives here as an all-null row; without
  -- this line it would fall through every branch, return false, and show
  -- the aggregators and the local-press lane as permanently locked.
  if g.id is null then return true; end if;

  if g.kind = 'count' then
    select count(*) into have from public.vault_assets a
     where (g.f_status  is null or a.status = g.f_status)
       and (g.f_kind    is null or a.kind = g.f_kind)
       and (g.f_release is null or a.release_clear = g.f_release)
       and (g.f_event   is null or a.event_id = g.f_event)
       and (g.f_since   is null or a.shot_at > now() - g.f_since);
    return have >= g.need;

  elsif g.kind = 'flag' then
    if g.f_house = 'has_releases' then
      return exists (select 1 from public.vault_releases
                      where status = 'signed' and covers_commercial);
    elsif g.f_house = 'has_bylines' then
      return coalesce((select bylines from public.vault_house where id = 1), 0) > 0;
    elsif g.f_house = 'has_portfolio' then
      return coalesce((select portfolio_url from public.vault_house where id = 1), '') <> '';
    elsif g.f_house = 'has_copyright' then
      return coalesce((select copyright_filed from public.vault_house where id = 1), false)
             or exists (select 1 from public.vault_filings where status = 'registered');
    end if;
    return false;

  elsif g.kind = 'conflict' then
    -- a conflict is MET (i.e. not blocking) while the conflicting lane is
    -- not yet onboarded. Once it is, this door is shut.
    if g.f_conflict is null then return true; end if;
    return not coalesce((select onboarded from public.vault_targets
                          where id = g.f_conflict), false);
  end if;
  return false;
end $$;

create or replace function public.gate_progress(g public.vault_gates)
returns int language plpgsql stable as $$
declare have int;
begin
  if g.kind <> 'count' then
    return case when public.gate_met(g) then 100 else 0 end;
  end if;
  select count(*) into have from public.vault_assets a
   where (g.f_status  is null or a.status = g.f_status)
     and (g.f_kind    is null or a.kind = g.f_kind)
     and (g.f_release is null or a.release_clear = g.f_release)
     and (g.f_event   is null or a.event_id = g.f_event)
     and (g.f_since   is null or a.shot_at > now() - g.f_since);
  return least(100, (have * 100) / greatest(g.need, 1));
end $$;

-- every gate, with live status
create or replace view public.vault_gate_status as
  select g.id, g.target_id, t.label as target, t.lane, g.kind, g.label, g.detail,
         g.need, g.f_conflict,
         public.gate_met(g)      as met,
         public.gate_progress(g) as pct
  from public.vault_gates g
  join public.vault_targets t on t.id = g.target_id;

-- THE LOCK: a lane is open only when every one of its gates is met
create or replace view public.vault_lane_readiness as
  select t.id, t.label, t.lane, t.rail, t.takes, t.priority, t.onboarded,
         t.exclusive, t.min_portfolio, t.wants, t.avoid, t.outcome,
         (t.cut_low * 100)::int || '-' || (t.cut_high * 100)::int || '%' as your_cut,
         t.needs_release, t.needs,
         count(g.*)                                   as gates,
         count(g.*) filter (where public.gate_met(g))  as gates_met,
         coalesce(bool_and(public.gate_met(g)), true)  as unlocked,
         coalesce(avg(public.gate_progress(g))::int, 100) as pct,
         (select c.host is not null from public.vault_credentials c
           where c.target_id = t.id)                   as has_credentials
  from public.vault_targets t
  left join public.vault_gates g on g.target_id = t.id
  group by t.id;

select 'gates armed' as status,
  (select count(*) from public.vault_gates) as gates,
  (select count(*) from public.vault_lane_readiness where unlocked) as unlocked_now,
  (select count(*) from public.vault_lane_readiness where not unlocked) as locked_now;
