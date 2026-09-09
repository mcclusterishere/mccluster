# Equity Uprise Policy OS — deployment state

Last verified 2026-09-09 against project `zmnhbrjyhxzhkxmhkexs`.

## What is live

All 8 Policy OS migrations are applied and all six edge functions are
deployed. 23 tables, RLS enabled on every one, at least one policy each,
and no INSERT/UPDATE/DELETE granted to `anon` or `authenticated` —
mutations go through the functions, which is the design.

| Function | verify_jwt | Guard | Anonymous probe |
|---|---|---|---|
| `eu-intake` | off | Turnstile (public form) | 503 |
| `eu-calendar` | off | Turnstile + booking-token capability; `confirm` needs a user + `calendar.schedule` | 503 / 400 |
| `eu-publish` | on | `verifyCaller` + `publication.publish` | 401 |
| `eu-workspace` | on | `verifyCaller` + `research.write` | 401 |
| `eu-worker` | off | `EU_WORKER_SECRET` header | 401 |
| `eu-google-workspace` | off | Pub/Sub ID token on `/push`, `EU_GOOGLE_WORKSPACE_SECRET` elsewhere | 401 |

`verify_jwt` is off where a function has a legitimate public path or is
called by a machine with its own secret. Each of those implements its own
authentication, which is why the gateway check is not the one holding the
door. Every one was probed with the publishable key after deploying; all
ten probes refused, and no row was written.

## What is not live, and why

Nothing can complete a real transaction yet, because none of these
secrets are set. There is no MCP tool that can set them — they must be
added in the Supabase dashboard under Edge Functions → Secrets.

**To make the fellowship form work at all — pick one:**

- `TURNSTILE_SECRET_KEY` — the real answer. Provision a Turnstile widget
  at Cloudflare, put the secret here and the site key in the form.
- `EU_INTAKE_UNPROTECTED=true` — demo only. Accepts public submissions
  with no bot check and logs a warning on every request. Unset it before
  launch; `eu_stakeholders` and `eu_fellowship_applications` are
  otherwise open to automated mass-insert.

**For interview booking** (`eu-calendar` availability/confirm):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. The
refresh token needs calendar scope on the account whose availability is
being published. A connector authorised in a chat session does not carry
over — the Worker needs its own token.

**For the job runner:** `EU_WORKER_SECRET`, plus a schedule that POSTs to
`eu-worker` with `x-eu-worker-secret`. Nothing invokes it today.

**For Gmail ingest:** `EU_GOOGLE_WORKSPACE_SECRET`, `GMAIL_PUBSUB_TOPIC`,
`GMAIL_PUBSUB_AUDIENCE`, `GMAIL_PUBSUB_SERVICE_ACCOUNT`, plus the Google
OAuth trio above.

**Optional:** `PDF_RENDER_ENDPOINT`/`PDF_RENDER_SECRET` (PDF output is
skipped without them), `CROSSREF_*` (DOI deposit), `OPENALEX_MAILTO`.

## Known gap: publish → render never runs

`eu-publish` queues the render job with `capability: "publication.publish"`,
which `control_capabilities` grades **high**. `eu-worker`'s `authorized()`
requires, for high-risk work, both an `approval_id` **and** a
`payload.request_hash`. The render job's payload carries
`{publication_id, version_label, content_hash}` and no `request_hash`, so
the job can never be authorised and parks in `waiting-approval` forever.

This fails closed, so it is not urgent and nothing runs unapproved — but
the publish pipeline cannot currently complete. It needs a decision
rather than a guess:

1. Treat rendering as a consequence of the already-approved publish and
   give the render job a medium-risk capability of its own
   (e.g. `publication.render`), or
2. Carry the `request_hash` that `publish()` already computes into the
   render job's payload so the existing approval covers it.

Option 2 keeps one approval bound to one content hash end to end and is
the smaller change. Both are one-liners; neither should be picked
without saying which model is intended.

A second, lower-severity note in the same function: `authorized()` reads
`risk` as `caps?.[0]?.risk ?? "low"`, so a job naming a capability that
does not exist in `control_capabilities` is treated as low risk and runs
without approval. Only service-side code creates job rows and `eu_jobs`
has no client write grant, so this is not reachable from outside — but
the safer default for an unrecognised capability is high, not low.
