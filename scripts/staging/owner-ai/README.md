# Isolated owner AI staging page

This is a test-only transport adapter for the actual `control.html`, its actual
`backend.js` account client, and the actual Control Room modules. It creates no
JWTs, model output, devices, conversation records, or MCP responses. The root
staging server owns synthetic login, real SQL, real Core dispatch, and signed
test workers. None of these files is imported by production `control.html`.

## Server composition

After the server verifies its access-code session, serve `/control.html` using
`renderOwnerAiStagingPage()` from `render-page.mjs`. Serve
`/__staging/owner-ai-bootstrap.js` from `BOOTSTRAP_PATH` exported by that module.
Serve the existing repo CSS, JS, images, and reviewed Mac package assets from
their normal paths. Do not expose this server until the gate covers **every**
page, asset and API route. The public access-code form is the sole exception.

Use a random, short-lived, HttpOnly session cookie with `Secure` and
`SameSite=Strict` on the HTTPS tunnel. Require the code in a POST body, never in a
query string. The bootstrap neither knows nor reads this cookie. Return 401 JSON
for unauthenticated APIs, and the access-code form for a page request. Enforce
same-origin checks for mutating browser requests. Use `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, and CSP `connect-src 'self'` to contain the test
environment. Stop the tunnel and server after the walkthrough.

The adapter maps only these exact origins, preserving request paths, methods,
headers and bodies:

| Shipped client origin | Isolated staging destination |
| --- | --- |
| `https://api.mccluster.org` | Same origin, same path and query |
| `https://zmnhbrjyhxzhkxmhkexs.supabase.co` | Same origin, same path and query |

Other external fetches return an honest unavailable response in the adapter.
No production session is used. The staging host has its own browser storage.
All page views show: **Staging: synthetic owner/member identities, simulated
Mac workers and synthetic model output; real SQL, enrollment, signed heartbeats
and leases.**

A separate, collapsed **Test-worker controls** section below that banner lets
the owner paste a real Core enrollment credential from Devices and explicitly
install one simulated Mac worker. It posts once to `POST /__staging/workers`
with the existing fixture bearer and HttpOnly cookie and body
`{display_name,credential}`. The credential input clears before the POST and on
account changes/page exit; it is never stored or included in a URL or command.
The server must require its access-code session plus the owner fixture subject,
validate the enrollment with real Core, then launch the signed test worker.
Return a simple 2xx success or a bounded error, never a private key/credential.
This control is isolated from product code and never installs a physical Mac.

## HTTP contract

| Method and path | Required response or behavior |
| --- | --- |
| `POST /auth/v1/token?grant_type=password` | Accept only `owner@staging.invalid` or `member@staging.invalid` and literal fixture password `staging-fixture`, after the cookie gate. Return the synthetic signed session with `access_token`, `refresh_token`, `expires_in`, and `user:{id,email}`. Core must independently authorize the owner subject. |
| `POST /auth/v1/token?grant_type=refresh_token` | Refresh only an existing gated fixture session, or reject explicitly. |
| `GET /auth/v1/user` | Return the fixture subject resolved from the bearer. |
| `POST /auth/v1/logout` | End the fixture session; actual client clears its two session storage slots. |
| `GET /v1/workspaces/me` | `workspaces:[{org_id,slug:'mccluster',kind:'studio',role:'owner'|'viewer',enabled:true,name:'Equity Upreneurs'}]`, `default_org_id`, and fixture profile. |
| `GET /health`, `/v1/status`, `/v1/core` | Honest isolated Core/DB status. `/v1/status` remains owner-only. |
| `POST /v1/core/mcp` | The existing Core MCP path and actual tool schemas/owner enforcement. Set `CORE_OWNER_AI_WORKSPACE_ENABLED=1` only in the isolated process. |
| `GET/POST /rest/v1/ops_ai_threads` | Actual isolated SQL with org/owner RLS, PostgREST query semantics, and `Prefer:return=representation` support. |
| `GET /rest/v1/ops_ai_messages` | Actual isolated SQL, ordered persisted user and assistant rows, org/owner RLS. |
| Other shell reads | Explicit unavailable or empty fixture sources. Never proxy them to production. |
| `GET /downloads/mccluster-macos-worker.manifest.json`, `.zip`, `.sha256` | Reviewed generated package files, after the same cookie gate. |

The installer’s setup file may use the isolated coordinator’s HTTPS origin. A
real Mac’s outbound worker calls cannot obtain a browser HttpOnly cookie; the
root server must provide a separately protected test-worker transport or keep
the walkthrough on its local signed workers. Do not silently exempt the public
compute enrollment/lease endpoints from the server gate to make this work.

## Click path

Access-code form → Owner test identity → Open owner test session → Home → Ask
McCluster → Devices → Add this device. The normal owner UI handles every later
step. To demonstrate a denied member session, Sign out, select Member test
identity, then Open member test session. That fixture identity must be denied by
the Core and SQL policies as well as by the visible owner-workspace gate.

This adapter provides no physical Mac or distributed-model benchmark evidence.
