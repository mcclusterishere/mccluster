-- Behaviour of supabase/pending/l3_products_asset_path_check_v1.sql on a scratch
-- database. Run by scripts/test-l3-asset-path-check-db.sh after it has created
-- public.l3_products as the replay migration does, seeded seven rows (two plain paths,
-- five that break the rule, slugs legacy-*) and applied the file. Test-only: never
-- run against a real project.
do $t$
declare
  v_org uuid := '90000000-0000-4000-8000-0000000000a1';
  v_path text;
  v_n integer;
  v_valid boolean;
  -- every one of these must be accepted
  v_plain text[] := array[
    'a', '0', 'packs/sound-pack-v1.zip', 'A/b/c.d-e_f', 'v1.2/final.mix.zip',
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-file.zip',
    repeat('a', 1024)
  ];
  -- every one of these must be refused
  v_refused text[] := array[
    '', '/', '/x', 'x/', 'a//b', '.', '..', './x', '../x', '../other-bucket/x', 'a/../../other-bucket/x',
    'a/./b', 'a/../b', 'a/..', 'a..b', '...', '.hidden', 'a/.b', '-x', '_x', 'a/-b',
    ' ', 'a b', ' a', 'a ', '.. /x',
    '%2e%2e/x', '%2E%2E/x', 'a%2fb', 'a%b', 'a?b', 'a#b', 'a\b', '..\x',
    'a:b', 'a;b', 'a&b', 'a=b', 'a+b', 'a,b', 'a@b', 'a''b', 'a"b', 'a(b)', 'a*b', 'a$b', 'a!b', 'a~b',
    'a' || chr(10), chr(10) || 'a', 'packs/sound-pack-v1.zip' || chr(10), '.' || chr(10) || './x',
    'a' || chr(9) || 'b', 'a' || chr(13) || 'b', 'a' || chr(1) || 'b', 'a' || chr(127) || 'b',
    'a' || chr(233), chr(1072), chr(65294) || chr(65294) || '/x', 'a' || chr(8232) || 'b', 'a' || chr(160) || 'b',
    repeat('a', 1025)
  ];
begin
  -- the constraint is there, and not validated
  select convalidated into v_valid from pg_constraint
   where conrelid = 'public.l3_products'::regclass and conname = 'l3_products_asset_path_plain_check';
  if v_valid is null then raise exception 'the constraint was not added'; end if;
  if v_valid then raise exception 'the constraint must be added NOT VALID'; end if;

  -- adding it scanned nothing: the rows that already break the rule are still there
  select count(*) into v_n from public.l3_products where slug like 'legacy-%';
  if v_n <> 7 then raise exception 'expected the 7 seeded rows, found %', v_n; end if;

  -- new rows: plain paths and NULL are accepted
  foreach v_path in array v_plain loop
    insert into public.l3_products(org_id, slug, title, price_cents, asset_path)
    values (v_org, 'ok-' || md5(v_path), 'ok', 100, v_path);
  end loop;
  insert into public.l3_products(org_id, slug, title, price_cents, asset_path) values (v_org, 'ok-draft', 'draft', 100, null);

  -- new rows: everything else is refused, by this constraint
  foreach v_path in array v_refused loop
    begin
      insert into public.l3_products(org_id, slug, title, price_cents, asset_path)
      values (v_org, 'bad-' || md5(v_path), 'bad', 100, v_path);
      raise exception 'accepted a path that is not plain: %', quote_literal(v_path);
    exception when check_violation then
      if sqlerrm not like '%l3_products_asset_path_plain_check%' then raise; end if;
    end;
  end loop;

  -- an existing plain row can be pointed at another plain path, and cannot be pointed at anything else
  update public.l3_products set asset_path = 'packs/sound-pack-v2.zip' where slug = 'legacy-plain-1';
  begin
    update public.l3_products set asset_path = '../other-bucket/x' where slug = 'legacy-plain-1';
    raise exception 'an update to a path that is not plain was accepted';
  exception when check_violation then null;
  end;

  -- NOT VALID, as the file's header warns: a row that already breaks the rule cannot be edited at all...
  begin
    update public.l3_products set price_cents = 200 where slug = 'legacy-dots';
    raise exception 'a row that breaks the rule was edited without correcting its path';
  exception when check_violation then
    if sqlerrm not like '%l3_products_asset_path_plain_check%' then raise; end if;
  end;
  -- ...until its path is corrected in the same statement
  update public.l3_products set price_cents = 200, asset_path = 'packs/corrected.zip' where slug = 'legacy-dots';

  -- VALIDATE fails while any row breaks the rule, down to the last one
  foreach v_path in array array['legacy-space', 'legacy-encoded', 'legacy-inner-dots', 'legacy-long'] loop
    begin
      alter table public.l3_products validate constraint l3_products_asset_path_plain_check;
      raise exception 'VALIDATE passed while % still breaks the rule', v_path;
    exception when check_violation then null;
    end;
    update public.l3_products set asset_path = 'packs/' || v_path || '.zip' where slug = v_path;
  end loop;
  alter table public.l3_products validate constraint l3_products_asset_path_plain_check;
  select convalidated into v_valid from pg_constraint
   where conrelid = 'public.l3_products'::regclass and conname = 'l3_products_asset_path_plain_check';
  if not v_valid then raise exception 'VALIDATE did not mark the constraint valid'; end if;

  -- the table's own older rule is untouched: a published product still needs a file
  begin
    insert into public.l3_products(org_id, slug, title, price_cents, status, asset_path) values (v_org, 'bad-published', 'x', 100, 'published', null);
    raise exception 'a published product without a file was accepted';
  exception when check_violation then null;
  end;
end
$t$;
