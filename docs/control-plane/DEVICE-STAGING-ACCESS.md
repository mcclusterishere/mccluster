# Device staging through an Access-protected hostname

How a second device (a Mac) reaches the device-jobs staging
(`scripts/staging/device-jobs/README.md`) when it is not on the machine that
runs it. The owner chose this path: a hostname in front of the loopback staging
gateway, protected by Cloudflare Access. The staging itself does not change. It
still listens on `127.0.0.1` only, its database is still in memory, and it still
has nothing to do with production.

Status, said plainly: the scripts and the node agent path are proven against a
loopback fixture that imitates an Access block (a 302 to a login path, a 403, a
login page) and an Access pass that requires the two service-token headers
(`core/test/device-staging-access.test.mjs`). No real hostname, tunnel or Access
application was created or contacted by that proof, and no Mac has run a job.
The owner steps below are the part only the owner can do.

Placeholders used here, never real values: `<staging-hostname>`,
`<port-base>`, `<run-dir>`, `<org-id>`, `<display-name>`, `<implementation>`,
`<model>`, `<device-public-ip>`.

## What changes and what does not

| | Loopback mode (unchanged) | Hostname mode (new) |
| --- | --- | --- |
| How the device names the staging | `--run-dir <run-dir>` or `--compute-url https://127.0.0.1:<port-base + 1>` | `--compute-url https://<staging-hostname>` |
| TLS trust | `--ca <file>`: the staging's own `ca-cert.pem`, pinned | `--trust system`: the public certificate the edge presents |
| Outer gate | none; the listener is loopback only | Cloudflare Access (service token or IP bypass) |
| Gateway's own checks | enrolment token, node signature on every request, admin token | the same, behind the outer gate |

Exactly one of `--trust system` and `--ca <file>` is chosen (with `--run-dir`
and neither flag, the run directory's CA is the pin, as before). No flag and no
environment variable turns certificate verification off. The scripts refuse
`compute.mccluster.org` and `core.mccluster.org` outright: they are staging
tools and exit with a usage error before anything is resolved or sent.

## Owner steps

1. **Name the hostname.** The owner picks `<staging-hostname>` on a zone the
   owner controls. It must not be a production host. Nothing in this repository
   chooses or records it.

2. **Start the staging** on whichever host runs it, exactly as the README says
   (`serve.mjs --run-dir <run-dir> --port-base <port-base>`). The gateway is
   `http://127.0.0.1:<port-base>`; nothing is rebound and no port is opened to
   the network.

3. **One ingress rule.** In the Cloudflare Tunnel that runs on that same host
   (the connector dials out; there is no inbound port), add one public
   hostname: `<staging-hostname>` to service `http://127.0.0.1:<port-base>`,
   the loopback staging gateway. The edge terminates TLS with a public
   certificate; the hop from the connector to the gateway never leaves the
   host.

4. **One Access application** (self-hosted) for `<staging-hostname>`, with one
   of these policies and no other:
   - **Service token.** Create a service token. Add a policy whose action is
     *Service Auth* and which includes that token. The token's two values go
     to the device by a private channel the owner chooses.
   - **IP bypass.** Add a policy whose action is *Bypass* and which includes
     `<device-public-ip>`. The device then sends no token.

5. **Hand the device three things** by a private channel: the hostname, the
   `<org-id>` from `<run-dir>/staging.json`, and `<run-dir>/enroll.token` (a
   secret for this run only). With a service token, also its two values. The
   admin token and the receipt signing key never leave the staging host.

Nothing else changes: no DNS record beyond the one the tunnel hostname creates,
no Worker route, no Supabase change, no production host, no firewall rule, no
change to `serve.mjs` or to the gateway.

## On the Mac

Requirements: macOS, Node 20 or newer, Ollama running with the agreed model
pulled (`ollama pull <model>`), and a checkout of the branch the staging runs.
No `sudo`, no inbound port, nothing installed by these scripts.

The Access service token is read only from two environment variables,
`MCCLUSTER_ACCESS_CLIENT_ID` and `MCCLUSTER_ACCESS_CLIENT_SECRET` (both or
neither). They are sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`
on every request to the staging host and nowhere else, are never logged, are
never written to disk by the scripts or the agent, and are stripped from any
error text. The enrolment token is read from `MCCLUSTER_NODE_ENROLL_TOKEN` or
from the file named by `--enroll-token-file`, and is never printed. Neither is
ever a command-line value.

The command, from the repository root (with an IP bypass, leave the first two
lines out):

```bash
MCCLUSTER_ACCESS_CLIENT_ID="$(cat ~/mccluster-staging/access-client-id)" \
MCCLUSTER_ACCESS_CLIENT_SECRET="$(cat ~/mccluster-staging/access-client-secret)" \
node scripts/staging/device-jobs/enroll-device.mjs \
  --compute-url https://<staging-hostname> --trust system --org <org-id> \
  --enroll-token-file ~/mccluster-staging/enroll.token \
  --state-dir ~/mccluster-staging/device --name <display-name> \
  --implementation <implementation> --model <model>
```

For example `--implementation qwen3.8b.local --model qwen3:8b`. The three
files under `~/mccluster-staging/` are the ones the owner handed over; keep
them `chmod 600` and out of Git and chat.

What it does, in order: checks the path (below); confirms the model is
installed in the local Ollama and reads its digest and the engine version;
starts the repository's Ollama adapter on a free loopback port; starts the
node agent with a fresh identity in the state directory; prints one
`device_enrolled` line; and stays up, polling for work, until Ctrl-C or until
a file named `stop` appears in the state directory. The node's signature is
unaffected by the Access headers: it covers the method, the path, the node id,
the timestamp, the nonce and the body digest, and the gateway verifies it on
every request exactly as before.

### Preflight

The enrolment runs this first and stops if it fails. To run it alone, add
`--preflight` (the device flags, the org and the token are then not needed):

```bash
node scripts/staging/device-jobs/enroll-device.mjs --preflight \
  --compute-url https://<staging-hostname> --trust system
```

It prints one `staging_preflight` JSON line and exits:

| Exit | `verdict` | Meaning |
| --- | --- | --- |
| 0 | `ready` | the name resolves, TLS verifies, and `/health` answers as `mccluster-compute-gateway` with protocol `mccluster-compute/1` |
| 3 | `blocked-by-access` | an Access login page, a redirect or a 403 answered instead of the gateway |
| 1 | `dns-failed`, `tls-failed`, `unreachable`, `not-the-compute-gateway` | named in the line, each with its `fix` |

"Blocked by Access" comes with the exact fix: allow this device, either by a
service token (the owner's Service Auth policy includes it and the device sets
the two environment variables) or by an IP bypass for the device's public
address. The line also says whether a service token was sent, which separates
"no token" from "a token Access did not accept". `submit-job.mjs --preflight`
is the same check.

## What comes back

On the Mac: the `device_enrolled` line (node id, platform, arch, model digest,
engine version, `trust`, and `access_service_token` as a boolean) and the
agent's log in the state directory.

The receipt comes back to whoever submits. On the staging host the owner runs,
unchanged:

```bash
node scripts/staging/device-jobs/submit-job.mjs --run-dir <run-dir> \
  --implementation <implementation> --out <out-dir>
```

`<out-dir>` then holds `job.json`, `result.json`, `receipt.json` and
`verify.json`. The receipt is signed by the staging Core key and carries the
Mac's completion signature; it names the Mac's node id and key fingerprint,
`platform: darwin`, its `arch`, its `hardware_mode` with the engine reading, the
model, the model digest and the engine version, all bound when the completion
was accepted, so a later read returns the same bytes. `verify.json` reports
`ok` (signatures, hashes, the lease) and, separately, `hardware_proof` and
`compute_mode`. Its `limits` field says what kind of evidence this is:
node-reported, under the node's signature, not third-party attestation.

## Revoke

- **The device's way in:** delete the service token in Access, or remove the
  device's address from the bypass policy. The device's next request is
  answered by Access, not by the gateway, and its agent stops being served.
- **The enrolment token:** it belongs to one run of `serve.mjs`. Stopping the
  staging (a file named `stop` in `<run-dir>`) ends that token, the database
  and every identity enrolled against it. The staging gateway has no separate
  revoke route; in staging, ending the run is the revocation.
- **On the Mac:** Ctrl-C the command (or create `stop` in the state
  directory). A lease that is running gets its drain period to finish and
  commit. Then delete the state directory and the handed-over files.

## Teardown

1. Mac: stop the command; `rm -rf ~/mccluster-staging`.
2. Owner: delete the Access application and the service token; remove the
   public hostname from the tunnel (and the DNS record it created).
3. Staging host: create `stop` in `<run-dir>`, then delete the run directory.

After that nothing remains: the hostname does not resolve to anything, the
tokens are dead, and the staging is gone with its in-memory database.

## Limits

- `--trust system` verifies against the Node runtime's public roots and, where
  the Node version can read it, the operating system's trust store. The edge
  certificate of a public hostname chains to both.
- With `--ca <file>`, the scripts' own requests trust that file alone. The
  node agent receives it as an additional root (`NODE_EXTRA_CA_CERTS`), which
  is how it has always been started in loopback mode.
- Access is the outer gate only. Whoever passes it still needs the enrolment
  token to enrol and the admin token to submit, and every node request is
  still verified against the node's enrolled key.
- An Access service token that expires or is deleted while the agent runs
  shows in the agent's log as failed requests; run the preflight to see the
  named reason.
