-- l3_products_asset_path_check_v1: the table refuses a product file pointer that is
-- not a plain object path.
--
-- CANDIDATE, NOT APPLIED. Nothing in production has run this file. It waits for the
-- owner's decision (supabase/pending/README.md; PROMOTION-ORDER.md, group 3).
--
-- public.l3_products.asset_path names a product's file inside the private bucket
-- l3-product-files. Today it is plain text: no CHECK, no trigger. The download
-- function (supabase/functions/l3-download) refuses anything that is not a plain
-- relative object path before it signs
-- (supabase/functions/_shared/storage-object-path.ts). This file makes the table
-- refuse it at write time as well, for every writer and any later reader, and is
-- deliberately narrower than the function:
--
--   * names separated by "/", each starting with a letter or digit and made only of
--     A-Z a-z 0-9 . _ -  (so: no empty segment, no "." or ".." segment, no leading or
--     trailing "/", no space, no "%", "?", "#", backslash or control character)
--   * no ".." anywhere
--   * ASCII only, at most 1024 bytes
--   * NULL stays allowed: a draft has no file, and the table's existing CHECK already
--     requires one before a product is published
--
-- THE CHARACTER SET IS A PROPOSAL. It is the alphabet this plane's own upload routes
-- produce ([A-Za-z0-9._-]). It has not been compared with what the Level 3 storefront
-- writes, nor with production rows. If the storefront keeps original file names
-- (spaces, brackets), widen the alphabet BEFORE applying: in the CHECK and in count 1
-- below alike (the pattern is written once in each), and in the copy
-- scripts/test/l3-asset-path-check.test.mjs pins. Stay inside what the function
-- accepts, so the table never admits a path the function then refuses: a name may
-- contain a space but may not start or end with one, so a space cannot simply be
-- added to the class. The last case of that test fails if the table would admit such
-- a path.
--
-- BEFORE THE FUNCTION CHANGE IS DEPLOYED (this is about l3-download, not about this
-- file; it matters whether or not the CHECK is ever applied). Once deployed, the
-- function answers asset_missing for a product whose path is not a plain object path.
-- This read-only count says how many products that is today, by the function's own
-- rule, which is wider than the CHECK's alphabet (it accepts spaces inside a name,
-- brackets, accents). It should be 0. A product it counts stops downloading until its
-- path is corrected; read those rows with the same WHERE clause and decide first.
--
-- >>> function count (read-only)
--   select count(*) from public.l3_products
--    where asset_path is not null and asset_path <> ''
--      and (asset_path ~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029\\%?#]'
--        or asset_path ~ '(^|/)( |\.{0,2}(/|$))| (/|$)');
-- <<< function count
--
-- NOT VALID, on purpose. Adding it takes a brief lock and does not scan the table. It
-- is enforced from then on for every INSERT and for every UPDATE of a row, including
-- an UPDATE that does not touch asset_path. A row that already breaks the rule is
-- therefore left as it is, but cannot be edited at all (not its price, not its
-- status) until its asset_path is corrected in the same statement. So:
--
-- 1. Before applying, run this read-only count (count 1: the rows the CHECK would
--    refuse). It must be 0; otherwise correct those rows, or widen the rule, first.
--
-- >>> count (read-only)
--   select count(*) from public.l3_products
--    where asset_path is not null
--      and not (octet_length(asset_path) <= 1024
--          and octet_length(asset_path) = char_length(asset_path)
--          and asset_path ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
--          and position('..' in asset_path) = 0);
-- <<< count
--
--    To read the rows it counts, select id, slug, status, asset_path with the same
--    WHERE clause.
--
-- 2. Apply this one file under its own name (README, "To promote one"). Never run the
--    whole of supabase/pending.
--
-- 3. Run the count again (0), then validate, as its own statement. VALIDATE scans the
--    table without blocking writes and fails if any row breaks the rule:
--
--      alter table public.l3_products validate constraint l3_products_asset_path_plain_check;
--
-- Callers: none change; l3-download behaves the same with or without this file.
-- Rollback: l3_products_asset_path_check_v1.rollback.sql.
-- Test: bash scripts/test-l3-asset-path-check-db.sh (a scratch Postgres 16) and
-- node --test scripts/test/l3-asset-path-check.test.mjs (offline).
set local lock_timeout = '5s';

do $c$ begin
  alter table public.l3_products add constraint l3_products_asset_path_plain_check
    check (
      asset_path is null
      or (octet_length(asset_path) <= 1024
          and octet_length(asset_path) = char_length(asset_path)
          and asset_path ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
          and position('..' in asset_path) = 0)
    ) not valid;
exception when duplicate_object then null; end $c$;

comment on constraint l3_products_asset_path_plain_check on public.l3_products is
  'asset_path is NULL or a plain relative object path in l3-product-files: names of [A-Za-z0-9._-] separated by "/", each starting with a letter or digit, no "..", ASCII, at most 1024 bytes. Added NOT VALID (supabase/pending/l3_products_asset_path_check_v1.sql).';
