# Equity Uprise product consumer: local review candidate

Equity Uprise product source is the private `mcclusterishere/Equity-Uprise` repository. McCluster is the first implementation/consumer. This additive patch depends on the local environmental World feature, source commit `b5a7fb137996bd71a6f4b5e3366c61e60733ff80`.

The `vendor/equity-uprise` snapshot is pinned to local product follow-on commit `645d68a740c835271ca185c52e0b31220aab16ad` (based on verified upstream Stage 2 `4ad69a35470427153d46842890b4c6d8f34ac8aa`) with SHA-256 hashes. The stable `js/world-environment.mjs` import now re-exports the product panel. The McCluster adapter supplies the existing API origin/session callback to the product's confined transport. Existing account routes, World layout/styles, branding, globe instance and classic synchronous pin script remain unchanged. No runtime GitHub dependency or private credential is introduced.

The extracted panel fixes inherited stale-identity and unmount races. Transport refuses redirects and malformed or unsuccessful private response envelopes. Existing backend authorization and persistence remain mandatory.

This is not a complete architecture migration. This patch and its dependency are not deployed. Publishing these files to the public McCluster repository requires owner approval; keep the patch local until then. No deployed backend, migration, auth grant, database record, payment or production deployment is changed.

Stage 2 also replaces `workers/mccluster/src/world-environment.js` with the host implementation adapter for the pinned product controller and evidence normalization. Existing bearer verification, owner lookup, provider/cache I/O, REST/RPC calls and privileges stay in this Worker adapter. The explicit constant enabled module policy preserves current behavior. It is not a persisted owner toggle or transactional drain guarantee. SQL/RLS and live settings remain unchanged.

Verify with:

```
node --test scripts/test/world-environment.test.mjs scripts/test/equity-product-consumer.test.mjs
npm test
(cd workers/mccluster && npm test)
```

Then complete browser, role/persistence and release acceptance against the final integrated candidate before sole-merger review. The product PR is private draft https://github.com/mcclusterishere/Equity-Uprise/pull/2. Do not imply that passing local tests is a production release.


## Mission resume follow-on, 2026-11-08

Private Your missions now reloads saved canonical assignments independently of
the public event feed. It includes saved title/requirements, mission status,
source link and historical observation time. Paused, closed, future, expired or
submitted/verified assignments have no new recording setup link. Missing server
availability also fails closed. The pending team RPC returns only the signed-in
person's context and no other participants. No grants, accounts, broadcasts,
proof submissions or production data are changed.

The source change lives in a separate local product branch based on Stage 2, so
it does not duplicate or advance Stage 3 persistent-control extraction. Neither
this follow-on nor the public consumer bridge has been pushed.
