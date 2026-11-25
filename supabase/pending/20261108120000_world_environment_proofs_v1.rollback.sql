-- REVIEW ONLY: suspend the environmental proof API/publication extension.
-- Run only with explicit production release/recovery approval, in the same
-- canonical database, after the forward migration. Never run automatically.
-- This is NOT unpublishing: preserve all canonical posts/proofs/points and the
-- environment_proof_consent / environment_proof_published receipt columns.
-- Generic canonical proof/review/feed functions remain unchanged and available
-- under their pre-existing grants. Their existing generic sharing still works.
begin;
-- Stop only environmental enrichment; canonical verification and card creation
-- are not disabled by this feature rollback.
drop trigger if exists world_environment_proof_publish_on_verify_trg
 on public.action_mission_assignments;
-- Remove direct invocation of this extension, including inherited PUBLIC access.
-- Keep definitions and receipts to preserve evidence and permit reviewed recovery.
revoke all on function
 public.world_environment_proof_read(uuid),
 public.world_environment_proof_submit(uuid,text,text,text,boolean,boolean),
 public.world_environment_proof_share(uuid,boolean,boolean),
 public.world_environment_proofs(),
 public.world_environment_proof_review(uuid,text,text,text),
 public.world_environment_proof_revision(public.action_proofs),
 public.world_environment_proof_snapshot(uuid),
 public.world_environment_proof_post_body(jsonb),
 public.world_environment_proof_is_published(uuid),
 public.world_environment_proof_publish(uuid),
 public.world_environment_proof_publish_on_verify()
 from public,anon,authenticated,service_role;
commit;
-- Recovery requires separate approval: verify retained schema/receipts, recreate
-- ONLY the trigger from the reviewed forward file, and restore ONLY its five
-- authenticated wrapper EXECUTE grants. Do not rerun the whole forward file:
-- its ADD COLUMN statements deliberately fail if the extension already exists.
-- Do not bulk publish missed work. Members can explicitly retry sharing after
-- service restoration. Historical receipts are not new consent or permission.
