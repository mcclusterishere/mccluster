# Atomic social consumer checkpoint — local review only

Extends e55b9be0babca018027d47c8c78ab676b1d624bf (v5). Pending migration: `supabase/pending/customer_social_trial_consumer_v2.sql`. No production application, seed, flags, credentials, provider action, price, paid conversion or deployment. Existing v5 source remains available. This completes a bounded social consumer implementation, not all platform modules.

Read CONSUMER-LEDGER.md for the complete enforcement/metadata/unsupported inventory and snapshot policy. Dependencies: the exact existing customer_social_selfservice.sql, creator_domain_trial_v1.sql, canonical social tables and Vault contract, identity/org/catalog and billing schema. Fixture hashes pin these inputs. The original social service implementation is preserved privately behind wrappers; its paid helper remains unchanged. The new migration supports repeated local application. No production migration/ledger file changed.

## Contracts and compatibility

New private singleton consumer policy is unseeded: enabled=false by default, explicit immutable app_id, safety_disabled=false. No parallel module registry or billing. Worker feature CREATOR_SOCIAL_MODULE_ACCESS_ENABLED remains unset. Legacy caller signature remains available, but rejects advanced operations if database mode has switched to module mode; this prevents silent mixed deployments.

* `customer_social_access_v2(p_org uuid,p_user uuid)` — service-only. Returns `{org_id,mode,eligible,app_key,access}` (access may be absent for legacy/safety state). mode is legacy_paid or module. UI eligibility is advisory; the write rechecks it.
* `customer_social_service_v2(p_action text,p_org uuid,p_user uuid,p_data jsonb,p_mode text)` — service-only. Checks the current policy mode and entitlement under transaction locks before existing OAuth/ready/enqueue mutations. Preserves original response shapes, owner scope, queue key/hash idempotency and connection rules. Status/disconnect recovery does not require paid/trial eligibility.
* Existing `customer_social_job_gate` — checks managed queued/processing admission and real transitions. Customer job association/source cannot be stripped to escape checks. Disconnected known-customer jobs cannot requeue. Same-state status/lease bookkeeping remains possible; it is not a fresh provider authorization.
* `customer_social_token_v2(p_org uuid,p_secret uuid)` — service-only. For managed credentials, verifies entitlement and reads Vault in one transaction; returns `{managed:true,mode,token}`. Wrong org/unentitled denies. Unmanaged operator credential returns `{managed:false,mode:'legacy_paid',token:null}` and keeps the original operator path. No token is returned to browser callers or written into evidence.

Worker uses authoritative mode only when its new flag is true. With the feature off, existing v5/legacy behavior is retained. Module mode accepts qualifying immutable trial snapshot OR explicitly mapped active paid entitlement. Existing active site-plan SKUs must all be reviewed/mapped before enabling module mode; no arbitrary active subscription is silently treated as every module. Policy disabled restores legacy paid behavior; explicit safety_disabled denies advanced work even in that compatibility mode. These switches have different purposes.

## Atomic boundary and recovery

Authorization locks remain held through database mutation or managed token retrieval. Cancellation, app/global policy safety changes and entitlement inputs cannot cross an admitted transaction unnoticed. Admission is evaluated at the operation's server time; this is not a promise that an external request can be recalled at an exact expiry instant.

Native tests reproduced a lock-order conflict between a direct job-row update and disconnect: exactly one transaction aborts with 40P01/55P03, the other commits, and the job is retained. New functions have a five-second lock timeout. Treat these as retryable transaction failures after status/readback; preserve original idempotency keys and never blindly repeat a provider action. Worker returns a generic unavailable error, not raw SQL details. This is a known operational limitation, not an unauthorized successful mutation.

Token retrieval is atomic inside PostgreSQL. Once handed to an in-flight Worker/provider request, a later cancellation cannot recall that token or undo publication. Signed upload issuance is external and only preflight-gated; queued publication still requires SQL admission. World delivery continues requiring both its legacy paid gate and managed-job consumer checks. Other modules remain classified in the ledger.

## Evidence and remaining gates

Local PGlite: 65 SQL/Worker assertions, actual service install/enqueue/idempotency, grants/role denials, trial and mapped paid behavior, expiry/cancel/app/global safety, snapshot grandfathering, immutable mapping, disconnected-job bypass prevention, token read/denial and real Worker admission/status/token handlers. Auth/transport, Vault and fixture people are synthetic; canonical social account/job DDL is pinned. Expiry fixture timestamps are altered only in a rolled-back scratch transaction, not through public RPCs.

Full Worker suite: 1,351 passed, zero failed/skipped. Pending RPC inventory: 3 passed. Native PostgreSQL: duplicate grant, actual mutation/cancel serialization and bounded lock-inversion safe-abort proofs passed. Portable bundle replay is reported separately in the final checkpoint response.

Promotion still needs exact live-schema/dependency verification, policy/app/paid-SKU review, backup/containment plan, coordinated deployment approval and real provider/browser validation. No live registrar proof or hosting economics was resolved. Containment preserves data: safety-disable consumer work and keep status/recovery available; do not drop receipts or delete jobs/sites to roll back. Feature disabled is not equivalent to the safety kill switch.

Status-contract follow-up: capability.reason now reflects the authoritative denied entitlement, with separate capability.entitlement_reason for eligible trials awaiting provider/connection setup. Exact reason and cross-tenant tests are in customer-social.test.mjs. Read REMAINING-GATES.md for the reason mapping and concise policy/provider/consumer checklist. SQL and default-off switches are unchanged.
