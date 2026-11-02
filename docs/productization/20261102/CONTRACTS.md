# Verified existing contracts and explicit gaps

Historical deployed/candidate baseline below. Additive local v2 contracts are specified in [v2 API](../20261102-v2/API.md); v3 withdrawal/recovery and681 compatibility updates are in [v3 handoff](../20261102-v3/HANDOFF.md). These supersede statements that CAS is not yet locally implemented, but do not change production readiness.

These contracts describe inspected source and live catalog signatures. They do not assert that candidate endpoints are deployed. Candidate source is #681 `5e020833`; main source is `e80cb0a1`. Resolve paths relative to those SHAs, not an older stacked PR.

## House homepage and inline content — existing main

UI: `js/control-room/front-page.js` edits the real renderer in an iframe. Page/slot are `index.html` / `@front`; public `js/live-content.js` reads `site_content`. Preserve the actual scroll/VR scene engine and `js/site-editor.js` for text.

`POST /rest/v1/rpc/site_content_set` parameters, verified from production:

```json
{"p_page":"index.html","p_slot":"@front","p_value":"<serialized validated config>","p_kind":"text","p_original":"","p_fragile":false,"p_via":"control-front-page"}
```

Returns `site_content`: UUID `id`, text `page/slot/kind/value/original/updated_via`, boolean `fragile`, timestamptz `updated_at`, nullable UUID `updated_by`. Authenticated execute is granted, anon execute revoked; function checks `mnet_is_admin()` or service role. Clients must use their own bearer token, never service credentials. Public row reads are intentional; drafts must not be written here as private storage.

The existing homepage stores serialized JSON as kind `text`, not a new `json` enum. The parent catalog review confirms allowed kinds `text/html/attr/hidden/order` and a 20,000-character value limit. `site_accounts.config` is text; do not assume it is a typed versioned scene table. Existing `tenant_domains.tenant_id`, organization IDs, auth-user IDs and M identity IDs are different authorities and must not be substituted for one another.

`POST /rest/v1/rpc/site_content_revert` accepts `p_page`, `p_slot`, returns void, and deletes the override. It means reset to shipped content. History has `id,content_id,page,slot,was,became,at,by_user,via`; authenticated reads require admin policy. No expected revision, arbitrary-version restore, or multi-slot atomic scene commit is provided by these signatures.

Backend prerequisite: add a backwards-compatible, atomic conditional-write contract on this existing store; enforce it at every relevant write boundary, including direct authenticated admin writes if they remain granted. A frontend-only timestamp comparison is insufficient. Existing historical rows must remain intact; create a new audit entry on restore. Keep existing RPC callers compatible during rollout. New signatures are a design task, not a ready API in this packet.

## Ordinary owned websites — candidate #681

Worker authority: `workers/mccluster/src/managed-projects.js`. Supabase Auth verifies the bearer, `m_auth_user_links.is_primary` resolves M identity, and both auth UUID and M UUID scope private operations. Public reads expose published config only after public-profile and removal checks. All responses are private/no-store.

| Request | Accepted body / result | Error and recovery contract |
|---|---|---|
| `GET /v1/projects` | `{ok:true,projects:[{id,slug,name,published_at,updated_at,removed_at,presentation}]}` | 401 signin; 409 profile_required; 503 storage/config unavailable |
| `POST /v1/projects` | `{slug,name}` → 201 full owned projection | Slug 3–40 lowercase/digit/hyphen, name 1–100; protected ownership/publication fields rejected; 409 slug_taken; no upsert takeover |
| `GET /v1/projects/{slug}/edit` | `{id,slug,handle,name,draft,published,published_at,presentation,updated_at,removed,media_prefix,max_bytes,registry_key,profile_visibility,publicly_available,publish_blocker,url,ok}` | Other owner / absent project → 404; do not reveal existence |
| `POST /v1/projects/{slug}/edit` | `{config,publish?:true}` → same projection | Validation 400 invalid_settings with dropped fields; 413 too_large; private profile blocks publish with 409; removed 403; stale saves currently overwrite |
| `GET` / `HEAD /v1/projects/{slug}` | `{ok,slug,handle,name,config,published_at,registry_key,site_modules}` for ordinary front | Private/unpublished/removed → 404; never return draft, owner UUID or audit provenance |
| `DELETE /v1/projects/{slug}/published` | `{ok:true,published:null,removed}` | Unpublishes page; does not delete uploaded public bytes |
| `DELETE /v1/projects/{slug}` | same response with removed true | Soft removal retains slug; not a restore API |

Config schema/validation is `packages/front-config/index.mjs` (`mccluster-front/v1`, cinematic or offers); use it rather than inventing a competing JSON model. Media namespace is `front-media/<auth uid>/projects/<slug>/`. These uploaded bytes are public, even for drafts or after unpublication; private Studio originals have a different contract.

Backend prerequisite: an atomic versioned save/publish/restore over `managed_projects`, rejecting stale versions with 409 and returning current version without leaking another owner. Preserve UUID, slug, owner and M identity. Add request identity or safe readback for lost responses. Store immutable history bound to exact project identity; specify restore-to-draft separately from publish. Test simultaneous edits, stale publish, wrong owner, removed/private state, malicious foreign media, and lost-response retries before promising conflict/recovery UI.

## Modules and addresses — candidate #681

Both endpoints require `CUSTOMER_SITE_OFFER_ENABLED=true` and verified owner context. `?project=<slug>` selects an owned managed project; omission selects personal front `me`.

- `GET|POST /v1/customer-site/modules`: POST `{module:"world"|"world_discovery",enabled:boolean}` only. Returns `{ok,source:{kind,key},modules:[{key,name,required,configurable,capability,description,enabled}],global_membership_unchanged:true}`. `site` is required; hosting is informational/nonconfigurable; advertising cannot be enabled. Storage is `customer_site_modules` with forced RLS and no browser grants. Service-only `customer_site_module_set_v1(uuid,uuid,text,text,text,boolean)` repeats active-account and project checks.
- `GET|POST /v1/customer-site/address`: POST `{slug}` only. Returns `{ok:true,address:null|{slug,url}}`. Addresses are immutable one-per-owned-source; repeat same assignment is idempotent, conflicting assignment is 409. `customer_site_address_assign_v1(uuid,uuid,text,text,text)` is service-only and checks reserved roots. Aliases do not transfer domain ownership. Public alias routing delegates to the existing public renderer and hides private/unpublished sources.

Do not present these two switches as a complete platform module manager. The latter still needs dependencies, version compatibility, server route authorization, disable/drain semantics, settings scope, background jobs and data-retention rules, reusing current capability/Control registries.

## Existing tile Studio — separate from ordinary front

`workers/mccluster/src/project-tiles.js` is already a bridge from #493 into managed projects. It uses existing `creator_site_drafts`, `creator_site_revisions`, registered private media and publication checks. Save requires `expected_revision`; publish requires the exact saved revision and `confirm_public:true`. RPCs `project_tile_save_v1`, `project_tile_publish_v1`, `project_tile_publish_free_v1` perform the mutations. Do not implement a second tile engine or silently route ordinary public front uploads into private Studio semantics. SQL/preparation/executor gates remain separate.

## Private LMS — existing production schema, source owned by another worker

`prim3_course_progress` has key fields `user_id uuid,course_id text,module_id text`; reading timestamp, nullable assessment score, attempts, passed timestamp, `mastery jsonb`, activity/created/updated timestamps. Actual authenticated SELECT/INSERT/UPDATE/DELETE grants are present; own-user SELECT uses `auth.uid()=user_id`; authenticated INSERT/UPDATE/DELETE policies enforce own user, with UPDATE `WITH CHECK` too. RLS is enabled. Anon table grants alone do not bypass its null-UID row predicate or authenticated mutation policies.

This supports personal practice storage, not trusted certification: clients can author their own scores/mastery. The parent catalog review confirms PK `(user_id,course_id,module_id)`, module IDs restricted to `^M[0-9]{2}$`, scores 0–100 and nonnegative attempts. No math-specific migration is justified from this schema evidence alone. Exact LMS payload/course/module IDs must come from the active private branch/archive, not be guessed from the old public LMS branch. Saved problem resume, equivalent fractions, account switch, deletion/privacy and latest 60-card integration need that worker's final source/test evidence.

## Music, domains and provider boundaries

Existing `music_creator_assets` and `music_asset_versions` are present with forced RLS and no direct browser table grants in the inspected catalog. Service role has SELECT only on versions. Do not replace them with mutable URL-only release records. New lyric revision/export contracts remain pending on `9d7a7eed` and are not exposed by this minimum migration set.

Domain and provider signatures must come from the same reviewed extension SHA and its SQL, after the minimum website is ready. Local provider fixture covers leases, known-ID recovery and reserved uncertain claims; it never proves DNS/TLS, actual registration or renewal. Billing/financial flows remain paused; platform commission is an owner decision, not a UI constant to invent.
