# Device jobs: cloud staging

A disposable, loopback-only staging environment for the device job contract
(`docs/control-plane/DEVICE-JOBS-CONTRACT.md`). It runs the real Core compute
gateway and the real node agent from this repository against a PGlite database
loaded with the repository's own compute SQL, behind a PostgREST subset shim
and a self-signed TLS ingress. A fixture executor stands where a device's
Ollama adapter would. Nothing reaches the canonical Supabase project, the OVH
Core, Cloudflare or any real device.

What it proves, in order:

1. the gateway publishes its receipt key and refuses admin calls without the admin token;
2. a wrong enrolment token and an unknown node key are refused;
3. the real node agent enrols over TLS, derives `hardware_mode` by code and advertises `ai.chat/fixture.echo.local`;
4. cross-organization submission is refused;
5. submission is idempotent per `Idempotency-Key`, a different body under the same key is a 409, and a capability with no live node is refused;
6. the node leases, runs and completes the job; the result and the signed receipt read back and verify offline, including the node's own completion signature;
7. duplicate results: a replayed nonce is refused, re-completing with the same payload is accepted idempotently, a different payload is refused, a late failure cannot undo the commit, a forged lease token is refused;
   then the device facts bound at that completion: the node heartbeats a different inventory and replays its completion, and the receipt read afterwards is byte-identical to the first;
8. an injected executor failure fails the lease, the task requeues with backoff and the second attempt completes (the receipt names attempt 2);
9. with `--full`, a hard kill of the agent mid-task lets the lease expire server-side and a restarted agent reclaims and completes;
10. a revoked node is refused on its next signed request (`NODE_REVOKED`) and leaves the fabric;
11. the pending attestation SQL rolls back to exactly nothing and re-applies cleanly.

## Run it

```bash
npm install --prefix /tmp/mccluster-pglite --no-audit --no-fund @electric-sql/pglite@0.5.17
```

```bash
PGLITE_MODULE_PATH=/tmp/mccluster-pglite/node_modules/@electric-sql/pglite/dist/index.js \
  node scripts/staging/device-jobs/run.mjs --out /tmp/device-jobs-proof
```

Add `--full` for the hard-disconnect case (about two and a half minutes more).
Add `--port-base <n>` to pin the gateway, the TLS ingress and the executor to
`n`, `n+1` and `n+2` (for example to stay clear of a real-device staging that
is running on the same machine); without it they are picked at random.
The output directory receives `proof.json`, `PROOF.md`, the manifest the fixture
node used, and the gateway, agent and executor logs. Tokens and keys are
generated per run and are never written to the proof.

## What it is not

It is not evidence of inference on real hardware: the executor echoes the
prompt and marks its output `fixture: true`. It does not exercise the Worker
edge (`/v1/core/mcp`) or the owner session; that path is covered by the unit
tests of the control tools and the Worker allowlist. It does not prove
multi-session PostgreSQL lock timing: PGlite is single-connection.

## Real-device mode: one real job per physical device

The fixture harness above is unchanged. Three more scripts keep the same
private staging running so real devices take real jobs. Still loopback only,
still disposable (the database is in memory), still nothing to do with
production.

What `verify.json` claims, and on what. `ok` is the conjunction of `checks`
(signatures, hashes, the lease, the idempotent replay). `hardware_proof` is
separate and needs every entry of `hardware_checks` as well; it rests on
positive evidence, not on the absence of a fixture label:

- the device facts in the receipt were bound when the Core accepted the
  completion (`execution.device_facts.bound`), not read from the node later;
- the executor is the repository's Ollama adapter: the node advertised
  `backend: ollama` with the model, the model digest and the engine version it
  enrolled with (`enroll-device.mjs` publishes them as `features.model_digest`
  and `features.runtime_version`), and the result carries the same
  `usage.model_digest` and `usage.ollama_version`;
- an engine reading exists (`hardware_evidence.engine`, the adapter's
  `GET /api/ps`), names the same model and digest as `execution.model`, and was
  taken inside the lease window or within `engine_reading_bound_ms` of it
  (60 000 ms, stated in the file);
- the compute mode is one the reading supports: `gpu-verified` with the model
  in VRAM is the only GPU proof (`compute_mode.gpu_proof`); a `cpu-only`
  device whose engine held the model with no VRAM is reported as
  `compute_mode.proven: "cpu"`; `gpu-present-unverified` and `unknown` prove
  no mode and `hardware_proof` is false.

A stand-in executor (`--executor-url`) is never hardware proof, with or
without its `fixture` label. And the limit, which `verify.json` states in
`limits`: all of this is node-reported evidence under the node's signature,
not third-party attestation. A short job that finishes before the node has
published a reading with the model loaded fails the engine checks honestly;
run it again with the model warm.

1. Start the staging on the machine that hosts it. `openssl` must be on PATH
   or named by `OPENSSL_BIN`.

   ```bash
   PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
     node scripts/staging/device-jobs/serve.mjs --run-dir <run dir> [--port-base 47800] [--org <uuid>]
   ```

   It prints one JSON line (URLs and file names, no secret values), writes
   `<run dir>/staging.json`, and stays up until SIGINT, until stdin closes
   (`--no-stdin` turns that off for a detached process), or until a file named
   `stop` appears in the run directory. The gateway is `--port-base`, the TLS
   ingress `+1`, the PostgREST shim `+2`. The run directory holds
   `admin.token`, `enroll.token`, `receipt-signing-key.pem`,
   `receipt-key.public.pem`, `tls-key.pem` and `ca-cert.pem`: keep it out of
   Git and out of chat.

2. Enrol the device that hosts the staging (the model must already be
   installed in its Ollama):

   ```bash
   node scripts/staging/device-jobs/enroll-device.mjs --run-dir <run dir> --state-dir <state dir> \
     --name <display name> --implementation qwen3-vl.4b.local --model qwen3-vl:4b
   ```

   It starts the real Ollama adapter on a free loopback port with that one
   mapping, then the real node agent with a fresh identity in the state
   directory, prints one `device_enrolled` line and stays up (stop: SIGINT, or
   a file named `stop` in the state directory). Stopping asks the node agent
   through its own stop file (`MCCLUSTER_NODE_STOP_FILE`, `node-agent.stop` in
   the state directory) on every platform: the agent stops claiming, a lease
   it is running gets its grace period (30 s) to finish and commit, and only
   then does it exit. A signal is the fallback only; on Windows a SIGTERM
   terminates the process with the lease still held.

3. Submit and verify:

   ```bash
   node scripts/staging/device-jobs/submit-job.mjs --run-dir <run dir> \
     --implementation qwen3-vl.4b.local --out <out dir> [--expect-hardware-mode gpu-verified]
   ```

   Exit 0 only when every check in `<out dir>/verify.json` is true. The job
   records its submitter as `client.name: submit-job-cli` unless
   `--client-name` says otherwise. The receipt it writes does not change on a
   later read: the Core builds it from the snapshot bound at completion.

4. The routing fence, for an implementation no enrolled device advertises:

   ```bash
   node scripts/staging/device-jobs/submit-job.mjs --run-dir <run dir> \
     --implementation qwen3.8b.local --out <out dir> --expect-refusal
   ```

   It looks the refused submit up by its own `Idempotency-Key`
   (`GET /v1/compute/jobs?idempotency_key=…`, an exact lookup, not a count of
   a page) and cancels its probe job when the bound has passed
   (`POST /v1/compute/jobs/:id/cancel`, which cancels a queued job only). A
   gateway started before those two routes existed fails those two checks.

### A second device (a Mac)

**Through an Access-protected hostname (the owner's chosen path):** see
`docs/control-plane/DEVICE-STAGING-ACCESS.md` for the owner steps, the single
command, the preflight, revocation and teardown. In short, on the Mac:

```bash
MCCLUSTER_ACCESS_CLIENT_ID="$(cat ~/mccluster-staging/access-client-id)" \
MCCLUSTER_ACCESS_CLIENT_SECRET="$(cat ~/mccluster-staging/access-client-secret)" \
node scripts/staging/device-jobs/enroll-device.mjs \
  --compute-url https://<staging-hostname> --trust system --org <org-id> \
  --enroll-token-file ~/mccluster-staging/enroll.token \
  --state-dir ~/mccluster-staging/device --name <display-name> \
  --implementation qwen3.8b.local --model qwen3:8b
```

Trust is exactly one of `--trust system` (a public-CA hostname) or `--ca <file>`
(a pinned CA); nothing turns verification off. The Access service token is read
only from those two environment variables, the enrolment token only from
`MCCLUSTER_NODE_ENROLL_TOKEN` or `--enroll-token-file`; neither is logged or
written. `--preflight` checks DNS, TLS, `/health` and an Access block and exits
(0 ready, 3 blocked by Access, 1 otherwise). The production hosts are refused.
Proven against a loopback fixture that imitates Access; no Mac has run yet.

**Through a private forward to the loopback ingress (pinned CA):** the same
script. On the Mac, from a checkout of this branch, with Node 20 or newer and
the model pulled into its own Ollama:

```bash
MCCLUSTER_NODE_ENROLL_TOKEN="$(cat enroll.token)" \
  node scripts/staging/device-jobs/enroll-device.mjs \
    --compute-url https://127.0.0.1:47801 --org <org_id from staging.json> --ca ./ca-cert.pem \
    --state-dir ~/mccluster-staging-device --name <display name> \
    --implementation qwen3.8b.local --model qwen3:8b
```

Two files travel to the Mac by a private channel the owner chooses:
`ca-cert.pem` (public) and `enroll.token` (a secret for this run only).

**Open dependency: how the Mac reaches the ingress.** The ingress listens on
the host's `127.0.0.1` only and its certificate names `IP:127.0.0.1` only.
Nothing here opens a port to the network. The command above therefore assumes
a private forward that makes the host's ingress port appear on the Mac's own
loopback, for example an SSH local forward the owner runs from the Mac
(`ssh -N -L 47801:127.0.0.1:47801 <the host, by whatever private address the owner uses>`)
or a reverse forward from the host. Which private path exists between Prime
and the Shiloh Macs (SSH, a private overlay network) is not known to this
repository and is not set up by it. If the path presents the ingress under a
name instead of the Mac's loopback, start `serve.mjs` with
`--tls-san DNS:<that name>` so the certificate matches; the listener stays on
loopback either way. Until the owner provides that path, no Mac job has run
and none is claimed.

Once the Mac is enrolled, the owner's machine submits to it with the same
`submit-job.mjs --implementation qwen3.8b.local --out <out dir>`; the receipt
then names the Mac's node id, platform `darwin`, its own `hardware_mode` with
its engine evidence, and the digest of the model its Ollama ran.

## The real Mac or Windows handoff

The same agent, the same gateway routes. On the device, with the enrolment
token the owner issued and the Core's public compute URL:

```bash
MCCLUSTER_COMPUTE_URL=https://compute.mccluster.org \
MCCLUSTER_ORG_ID=<house org id> \
MCCLUSTER_NODE_NAME=<device name> \
MCCLUSTER_NODE_ENROLL_TOKEN=<one-time token> \
MCCLUSTER_NODE_MANIFEST=/etc/mccluster-node/capabilities.json \
  node core/src/compute/node-agent.mjs
```

The manifest is one of `core/node-manifests/` with the Ollama adapter
(`core/src/compute/ollama-adapter.mjs`) as the loopback executor. From the
admin side the job then goes through the same `POST /v1/compute/jobs`
(or the owner tool `core.compute.job.submit`), and the receipt reports the real
node's `hardware_mode` and platform, and the status view carries its measured rate, instead of the fixture's.
