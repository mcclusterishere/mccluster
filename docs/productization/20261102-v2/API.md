# Exact local v2 contracts

Read returns `{ok,revision,protected,snapshot,history:null}`. History additionally returns up to 50 newest immutable entries `{revision,snapshot,actor,operation,restored_from,at}`. Reads do not enroll or mutate. Absent new personal/Control content is revision 0/null snapshot; foreign or absent projects fail closed.

## Control

Authenticated caller token: POST `/rest/v1/rpc/site_content_v2` with `p_page`, `p_slot`, `p_action` (default read), `p_expected` (default null), `p_data` (JSONB, default null), `p_restore` (bigint, default null).

Actions: read, history, save, restore, reset. Save data: `{value:"serialized actual renderer config",kind:"text",original:"",fragile:false}`. Use the existing renderer's validated schema; no new scene schema is introduced. Restore sends current expected revision and target restore revision, null data. It restores value/kind/original/fragile while recording a new timestamp and actor. Reset removes the override to reveal shipped defaults. Both preserve audit and private versions. SQL rechecks non-null auth.uid and mnet_is_admin; anon/service roles cannot execute this caller RPC.

PT409 means stale/missing expected revision or protected legacy write, mapped by PostgREST to HTTP 409. 42501 denies authority; P0002 means absent historical revision. Invalid content/constraint failures roll back content and audit together.

## Owned websites

The caller supplies only its bearer token; the existing Worker keeps service credentials private. EDITOR_V2_ENABLED must be true. All responses are private/no-store.

| Method/path | Contract |
|---|---|
| GET /v2/projects/{slug}/edit | Current owned state/version |
| GET /v2/projects/{slug}/history | Private history |
| POST /v2/projects/{slug}/edit | `{expected_revision,config,publish?:true}` |
| POST /v2/projects/{slug}/restore | `{expected_revision,restore_revision}`; draft only |
| POST /v2/projects/{slug}/unpublish | `{expected_revision}` |
| GET /v2/fronts/me/edit or /history | Personal front state/history |
| POST /v2/fronts/me/edit, /restore, /unpublish | Same bodies as projects |
| GET /v2/fronts/{handle}/edit or /history | House-owner moderation read |
| POST /v2/fronts/{handle}/takedown | House owner; `{expected_revision,reason}` |

No new project provisioning/removal endpoint. Existing project creation precedes editing; personal creation is a revision-0 save. Linked M identity alone does not grant another auth owner's front history. Tile projects keep their existing APIs.

Service-only `editor_owned_v2(p_actor uuid,p_kind text,p_key text,p_action text,p_expected bigint,p_data jsonb,p_restore bigint)` repeats active primary identity and owner authorization after Worker Auth verification. Browser roles cannot invoke it. SQL locks/checks public profile state when publishing. The adapter validates bounded streamed bodies and the existing owned-media config, and rejects unknown fields. Restore is revalidated against current media ownership, then SQL uses its immutable snapshot. HTTP restore is limited to the 50 returned revisions; older versions need a separately reviewed operator workflow.

HTTP: 401 session; 403 authority/private/removed; 404 foreign/absent; 409 stale; 400 invalid; 413 size; 503 disabled/schema/unavailability. Preserve local drafts on error. After a lost response, read back before retry; do not silently replay with a new expected token. A repeat of an already committed expected token conflicts instead of duplicating history. No automatic idempotency receipt or automatic merge is claimed.

Legacy unenrolled records remain writable. First v2 mutation protects the record; there is no browser unprotect endpoint. Blind old saves/unpublishes then conflict. Existing unconditional front moderation clears publication without altering identity/draft and advances revision. Its actor may be null if the old service request carries no user claim; audit labels legacy_takedown rather than inventing attribution. V2 moderation records the verified actor.
