# Frozen multi-camera capture: gated integration plan

Status (2026-11-12): metadata preflight implemented and unit tested; **no reconstruction endpoint, provider execution, editor, native installer or deployment** is supplied by this change.

## Identified upstream

The likely demo is World Labs Atlas, not a downloadable dynamic-reconstruction model:
- https://www.worldlabs.ai/blog/atlas
- https://github.com/worldlabsai/atlas-camera-studio
- https://docs.atlas.worldlabs.ai/using-video-footage
- https://docs.atlas.worldlabs.ai/terms-of-service

The public camera studio is a client for hosted services. MIT client code does not grant a license to model weights or erase API terms. Current documentation uses selected still images, including synchronized views of one frozen instant. It does not establish direct multi-video input or continuous time-controlled reconstruction. Camera movement may synthesize hidden surfaces; it is not evidentiary ground truth. Three cameras do not guarantee a complete, accurate scene. No local AMD or OVH CPU implementation is verified.

## What exists in McCluster

Reuse `workers/mccluster/src/media/` for authenticated organization-scoped requests, budget/idempotency and asset lineage; `core/src/capabilities/registry.mjs` and `core/capabilities/catalog.json` for provider-independent capabilities; existing Core durable jobs and compute agents for approved extraction/render tasks. Do not add a second backend, asset database or auth layer.

`core/src/media/frozen-capture.mjs` now validates a metadata-only candidate containing distinct camera/asset IDs, content hashes, image dimensions, common capture-clock times and synchronization uncertainty. It rejects direct video inputs, duplicate images, URLs, file paths and source bytes. The bounded 2–16 view range is this preflight's safety limit, **not an upstream guarantee**. Passing metadata validation does not establish asset authorization, actual synchronization or reconstruction quality. Output always explicitly disables execution.

## Owner workflow to implement next

1. Authenticated owner selects a private capture set in Create. Original videos stay immutable in canonical private storage; no source video or credentials in Git, public preview artifacts or browser caches.
2. Probe originals and collect offsets/drift. Show proxies for inspection, but extract original-quality stills at the chosen common instant. A per-file frame number is not proof of synchronized capture. Store hashes and exact extraction provenance, including variable frame-rate timestamps.
3. Resolve each asset under the current organization/session, validate rights and approved provider destination, and run the frozen-capture preflight. Owner explicitly reviews the frame set, missing coverage and costs.
4. Register a disabled Atlas provider binding until account access, API schema, paid/noncommercial restrictions, beta production permission, retention/training/public-sharing choices and budget are reviewed. Never auto-enable on finding a key. Server-side credentials only. Current beta terms must be checked again before activation.
5. If authorized, a single idempotent durable media job submits the approved still set through the documented image-pose stage and renders a reviewed camera path. Poll/cancel/recover through existing job semantics; never resubmit on an unknown outcome without reconciliation.
6. Persist provider/version, input hashes, output lineage and time-limited result copies privately. Distinguish processing failure, unsupported input, missing credential, access denied and quality rejected. Do not label generated unseen detail as measured reconstruction.
7. Owner preview edits the virtual camera, exports video, reloads the saved project, cancels work and recovers from interruption. Add denied-role and cross-org tests before exposing a route. Review quality on real synchronized footage before calling it usable.

## Installed computer app and local execution

The repository already has a standalone browser manifest/service worker, currently branded HERE with an album-oriented start page. That is not a native Windows video editor and is not proof of an installable owner Control experience. An owner Control PWA can reuse the existing authenticated site and supplied icons without installing an engine or moving secrets client-side. Owner entry/session work is coordinated separately; do not replace the existing album app identity silently.

A PWA installation cannot create GPU memory or make hosted Atlas offline. Local proxy preview and extraction could be useful after hardware/software probes; native signed packaging, local file permissions, updates and a GPU executor need separate implementation and approval. No assumption is made that an integrated Radeon supports CUDA research repos. Offline mode must label stale/read-only data, never claim jobs were accepted without a canonical durable receipt.

## Release gates

Provider/schema/license review; authenticated asset ownership; immutable originals; extraction and sync proof; secure provider submission; spending cap; unknown-outcome recovery; private persistence; calibrated camera-path/quality tests; denied-role checks; physical owner-device preview and reload. Until those pass, this is preparation, not online video editing.
