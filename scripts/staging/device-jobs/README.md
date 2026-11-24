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
The output directory receives `proof.json`, `PROOF.md`, the manifest the fixture
node used, and the gateway, agent and executor logs. Tokens and keys are
generated per run and are never written to the proof.

## What it is not

It is not evidence of inference on real hardware: the executor echoes the
prompt and marks its output `fixture: true`. It does not exercise the Worker
edge (`/v1/core/mcp`) or the owner session; that path is covered by the unit
tests of the control tools and the Worker allowlist. It does not prove
multi-session PostgreSQL lock timing: PGlite is single-connection.

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
