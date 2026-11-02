-- LIVE CONTENT — the site becomes editable without a deploy.
--
-- 83 static HTML files on GitHub Pages. Changing a headline meant an
-- edit, a commit, a push and a build: minutes, a laptop, and git. That
-- is why the back end felt weak -- the owner could see everything and
-- change nothing.
--
-- Overrides live in a row and the page applies them on load. The HTML in
-- git stays the ORIGINAL and is never rewritten, which is what makes
-- every edit reversible: deleting the row restores the shipped copy
-- exactly, with no diff to unpick.
--
-- WHY A SLOT KEY AND NOT A CSS SELECTOR. ".hero > div:nth-child(3) p"
-- breaks the moment anything above it moves, and breaks SILENTLY -- the
-- override stops applying and the old copy returns with nobody told. A
-- slot key is written into the markup once and survives rearrangement.
-- Untagged elements stay editable, keyed by a generated structural path,
-- and those rows are marked fragile so the editor can say so.

create table if not exists public.site_content (
  id          uuid primary key default gen_random_uuid(),
  page        text not null,
  slot        text not null,
  kind        text not null default 'text',
  value       text not null default '',
  original    text not null default '',
  fragile     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_via text not null default 'editor',
  constraint site_content_kind_ck check (kind in ('text','html','attr','hidden','order')),
  constraint site_content_page_ck check (page ~ '^[a-z0-9._/-]{1,120}$'),
  constraint site_content_size_ck check (length(value) <= 20000)
);
create unique index if not exists site_content_page_slot on public.site_content(page, slot);
create index if not exists site_content_page_idx on public.site_content(page) where value <> '';

comment on table public.site_content is
  'Copy overrides applied at load. The HTML in git stays original, so deleting a row restores the shipped text exactly.';

-- Every change is kept. An LLM with write access to the website needs an
-- undo that does not depend on the LLM being right.
create table if not exists public.site_content_history (
  id          bigserial primary key,
  content_id  uuid,
  page        text not null,
  slot        text not null,
  was         text not null default '',
  became      text not null default '',
  at          timestamptz not null default now(),
  by_user     uuid,
  via         text not null default 'editor'
);
create index if not exists site_content_history_page on public.site_content_history(page, at desc);

create or replace function public.site_content_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  insert into public.site_content_history(content_id, page, slot, was, became, by_user, via)
  values (coalesce(new.id, old.id), coalesce(new.page, old.page), coalesce(new.slot, old.slot),
          coalesce(old.value, ''), coalesce(new.value, ''), auth.uid(),
          coalesce(new.updated_via, 'editor'));
  return coalesce(new, old);
end $fn$;

drop trigger if exists site_content_audit_t on public.site_content;
create trigger site_content_audit_t
  after insert or update or delete on public.site_content
  for each row execute function public.site_content_audit();

-- Read is public, because the overrides ARE the page: a visitor who
-- could not read them would see the pre-edit copy. Write is admin only.
alter table public.site_content enable row level security;
alter table public.site_content_history enable row level security;

drop policy if exists site_content_read on public.site_content;
create policy site_content_read on public.site_content
  for select to anon, authenticated using (true);

drop policy if exists site_content_write on public.site_content;
create policy site_content_write on public.site_content
  for all to authenticated
  using (public.mnet_is_admin()) with check (public.mnet_is_admin());

drop policy if exists site_content_history_read on public.site_content_history;
create policy site_content_history_read on public.site_content_history
  for select to authenticated using (public.mnet_is_admin());

revoke all on public.site_content, public.site_content_history from public, anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
grant select on public.site_content_history to authenticated;

-- The write path is one function so the editor and the model on the VPS
-- take the same audited route and neither can skip the admin check.
-- (Superseded by 20260922100615, which adds the service_role path.)
