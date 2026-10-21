# Replay-safe analytics ingestion — October 19, 2026

Status: review-only source changes; deployment and production acceptance pending.

## Why

The October 19 audit (issue #538) found 15 canceled PostgREST `events` inserts among SQLSTATE 57014 database cancellations. The first-party browser tracker sent a batch to the Worker, fell back to the Supabase Edge Function if the first request failed, and silently discarded the batch after that. If the first insert committed but its acknowledgement was lost, a fallback could insert the same logical events twice. `events` and `events_lean` had matching IDs for successfully accepted records, but that did not prove end-to-end delivery.

## Implemented transport contract

1. Each individual `MCC_TRACK` and embeddable-SDK event gets a cryptographically generated, version-4 per-event UUID at enqueue time. The client keeps the same batch JSON (including IDs) across retries.
2. The existing `collect` Edge Function accepts only valid UUIDv4 IDs. Older clients receive fresh server-generated UUIDs, retaining backwards compatibility. This identifier is *not* a device, session or account identity.
3. The collector writes to the existing `public.events.id` primary key using PostgREST `on_conflict=id` and `Prefer: resolution=ignore-duplicates,return=representation` with `select=id`. The response is a count of actually inserted IDs and the total number of valid incoming events; no event rows or sensitive metadata are returned to the browser.
4. Transient backend errors and transport failures receive one 180ms retry at the Edge Function, preserving the same IDs. Invalid/unauthorized requests do not loop; persistent failures return a non-2xx status. The first-party page keeps the Worker → Edge fallback, and retries once more while it remains active and privacy permission remains valid. The tenant SDK similarly retries once on an active page.
5. The collector enforces `GPC/DNT` redaction on every attempt. A cookieless property's session identifier is now cleared at the server boundary even if an older client sends one; the SDK no longer mints session IDs in cookieless mode.

## Deliberate limits

- This is **at-most-once storage for repeat deliveries of a given stable event ID**, not a guarantee of event delivery if a browser is forcibly killed before a request is sent. A durable offline outbox would retain visitor event metadata beyond this page's memory and requires a separate privacy/data-minimization review.
- Legacy trackers that do not send an event ID receive a fresh ID on each request; their cross-request duplicate attempts cannot be recognized retroactively. A client-side release and cache refresh should precede claims of complete replay protection.
- A request whose first attempt committed but returned an error may receive a successful replay receipt with `written: 0`: the record already exists. The `received` field is **not** the number inserted.
- No RLS, canonical migration, schema, retention policy, device fingerprint, storage key, or personal-data enrichment was added.
- No authenticated-production load test or browser-signed-in acceptance is claimed before deployment. The collector receives synthetic integration tests for idempotency, 57014 retry, ambiguous commits, persistent failure, DNT and cookieless treatment.

## Release and acceptance

- Run root collector and transport tests plus the site/browser suite.
- Merge verified source first, then deploy the **exact reviewed file** to the existing production `collect` Edge Function with `verify_jwt=false` (anonymous traffic), verifying function readback matches the reviewed commit.
- Verify current first-party and tenant SDK assets are published before synthetic end-to-end requests, and that `events.id` and `events_lean.id` continue to reconcile.
- Compare PostgREST insert 5xx, SQLSTATE 57014, and accepted event receipts after the release against an equivalent traffic window. Retry or dedup counts cannot be inferred from raw row totals alone.
- Remaining performance bottlenecks and historic taxonomy gaps belong to #538 and #539 respectively, not to a fabricated “everything connected” status.
