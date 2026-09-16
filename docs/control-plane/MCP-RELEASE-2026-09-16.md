# MCP continuity release — 16 September 2026

This release extends `969cf1df2f77d4ad2ba756f568602e44754cae94` from current
`main` at `c87ceaaa734358eb4e17cdcb1a22446e7bf62ffa`. It includes Claude's four
continuity commits; do not merge the superseded `fcc3177` alone.

## What changed

- All resume collections validate their actual row shape, including the recent
  jobs and objectives helpers that bypassed the earlier `rows()` guard. Invalid
  JSON *values* in the deploy manifest/catalog are rejected even when JSON
  syntax is valid. Invalid inner health rows preserve independent source state.
- `workers/mccluster-mcp` owns the single stateless MCP implementation. The API
  Worker keeps compatibility imports and an optional `MCP_EDGE` service-binding
  proxy. Unrelated media changes cannot redeploy the dedicated service.
- Both bearer and signing credentials are mandatory before remote dispatch.
  Owner-query HTTP errors fail closed, conflicting MCP method headers are
  refused, and OAuth continues to identify the existing authorized resource.
- Owned static preview publication is reconciled onto the continuity branch,
  with isolated builds, atomic publishing, exact commit provenance, idempotence,
  TTL expiry, quotas, private-file exclusions, and symlink/path protection.
- Worker promotion requires a readable rollback target. Wrangler 4.131.1 emits
  deployments oldest first; the new parser sorts timestamps and restores the
  complete traffic allocation. Upload tags are unique per workflow attempt.
- A read-only trigger inventory/plan tool and explicit digest-gated apply path
  precede any proposal to disconnect Workers Builds. No build settings were changed.
- Core rollback restores systemd units and the constrained build-start rule as
  well as source. The deploy script verifies the supplied SHA matches the checkout.
- Worker dependencies have a committed lockfile and install before deployment.
  The fal client tests now run instead of being dismissed as environment failures.

## Verification commands

```sh
npm ci --prefix workers/mccluster --ignore-scripts --no-audit --no-fund
npm run check --prefix core
npm test --prefix core
npm test --prefix workers/mccluster
npm test --prefix workers/mccluster-mcp
node --test scripts/test/*.test.mjs
python3 -m unittest discover -s scripts/test -p 'test_*.py'
npx --yes wrangler@4.131.1 versions upload --dry-run --config workers/mccluster/wrangler.toml
npx --yes wrangler@4.131.1 versions upload --dry-run --config workers/mccluster-mcp/wrangler.toml
```

The independent resume tests are run against the original handoff before the
fix and against the release afterward. Preview integration uses a real local
Git repository, exact commit checkout, file publication and an HTTP server.
Security cases include invalid metadata, expired previews, symlinked parent
directories, hidden files, credentials, unsupported methods and size limits.

The new `MCP Continuity and Preview` PR workflow executes these checks on GitHub.
Existing migration/security/architecture gates remain required; local success
does not authorize merging around a failed required check.

Local results on the release tree: **455/455 JavaScript tests**, **7/7 Python
tests**, Core syntax checks, and both actual Worker bundles pass. Of the 24
independent resume regressions, **23 fail on `969cf1d` and all 24 pass with the
fix**; the remaining test is the healthy-empty control. The Worker suite includes
all fal client tests after installing the locked dependencies.

Wrangler's local HTTP emulator could not start in this environment:
`uv_interface_addresses` returned system error 1. Worker compilation and
handler tests passed, but no local workerd HTTP acceptance is claimed. The
static preview integration did run against a real Node HTTP server.

## Public production observations before activation

On 16 September, the public API health endpoint answered 200, but the MCP
contract probe failed all five assertions: metadata and MCP returned 404, and
`deployment_sha` was `unknown`. `https://core.mccluster.org/health` answered 200
with `service: mccluster-core-tool-broker`. That confirms tunnel reachability;
it does **not** verify owner authorization, tools/list, core.resume, the deployed
Core SHA, or signed tool execution.

An unknown Worker SHA is missing provenance, not proof of a particular deployer.
Cloudflare deployment history is needed to identify the last deployment path.

## Activation order and remaining evidence

1. Review and merge only after the current-head required PR checks are green.
   The existing Worker release then uses guard → capture traffic → upload →
   promote → verify, with verified rollback on failure. The API Worker retains
   `HereTenantAgent`, all existing routes and its normal workload bindings.
2. Provision the four isolated transport secrets in the production environment:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORE_BROKER_TOKEN`, and
   `CORE_EDGE_SIGNING_KEY`. The latter two match the existing broker. Run the
   isolated deployment workflow with `bootstrap=true` once; it refuses an
   already-existing Worker. Subsequent releases require a rollback target.
3. Prove the public contract at both hosts. With a legitimate owner session,
   verify tools/list and core.resume, then verify non-owner and replay rejection.
   Never paste credentials into Git or public workflow artifacts.
4. After proving the isolated endpoint, activate the compatibility binding:

   ```toml
   [[services]]
   binding = "MCP_EDGE"
   service = "mccluster-mcp"
   ```

   Add it to `workers/mccluster/wrangler.toml` in a reviewed activation change.
   It is deliberately absent until the target service exists. OAuth resource
   identity remains `https://api.mccluster.org/v1/core/mcp` during this migration;
   the new host is a transport address, not an unreviewed audience migration.
5. Promote the exact tested source through `deploy/ovh-production`. Verify the
   deployed manifest, broker and gateway on OVH. Node/npm must be installed at
   `/usr/bin/node` and `/usr/bin/npm`; the existing Core units use that contract.
   Verify the restricted build unit and Polkit rule with a harmless npm fixture.
   This environment can test static previews but cannot prove host systemd behavior.
6. Route the preview tunnel to `127.0.0.1:4799`, then explicitly enable
   `MCCLUSTER_PREVIEW_ENABLED=1` with the correct HTTPS public base. Static sites
   need relative or prefix-aware asset URLs. No dynamic SSR deployment is claimed.
7. Run the trigger snapshot workflow. Review actual routes/domains/crons and
   exposure settings, express them explicitly in Wrangler, and inspect the plan.
   Apply requires the current 64-character review digest and checks for drift
   again after the dry run. Only after exact parity and sole deploy ownership are
   verified should the owner consider disabling Workers Builds.

Cloudflare secrets, domain provisioning, trigger parity, OVH deployment, the
isolated build service, authenticated production MCP and production previews
remain unverified until those provider/host actions succeed. The implementation
and local tests must not be presented as proof that these actions occurred.
