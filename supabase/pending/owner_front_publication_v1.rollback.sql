-- Proposal only: separately reviewed database rollback after callers are reverted.
-- Keep published content, audit history, private drafts and revision sequence intact.
begin;
drop function if exists public.owner_front_publish_v1(text,jsonb);
drop function if exists public.owner_front_draft_save_v1(text,text,jsonb);
drop function if exists public.owner_front_draft_discard_v1(text);
drop function if exists public.owner_front_snapshot_v1();
drop function if exists public.owner_front_validate_v1(jsonb);
commit;
