# Module consumer ledger — local v6

This ledger classifies adoption of the new domain-trial entitlement contract, not the security of unrelated existing authorization. Existing owner/admin, quota, review and payment gates continue to apply. No production activation. Source baseline is e55b9be0babca018027d47c8c78ab676b1d624bf; final patch identity is in the portable CHECKPOINT.json.

| Consumer and source | New trial contract status | Boundary / next gate |
|---|---|---|
| Customer Instagram OAuth, ready/enqueue: social/customer.js and customer_social_service_v2 | Locally enforced in the SQL mutation transaction; explicitly configured consumer only | Worker flag and unseeded SQL policy must agree; provider/OAuth still needs separate verification |
| Customer social job inserts/transitions and managed credential release: customer_social_job_gate / customer_social_credential_access | Locally enforced for managed customer connections | Existing in-flight external request cannot be undone by later cancellation; recovery polling/lease cleanup retained |
| Social signed upload issuance | Preflight/ready check only; external Storage operation is not in the SQL transaction | Existing limits and owner checks remain; upload completion does not authorize queue submission |
| World delivery: social/world-delivery.js, world_social_delivery.sql | Unsupported for trial; existing paid-only contract retained plus managed-job consumer guard | Requires reviewed integration of delivery draft/submit/readback authority; current managed queued jobs must pass both gates |
| Operator social accounts / non-customer jobs | Unsupported for this trial contract; existing operator authorization retained | Do not classify operator activity as a paid tenant module or broaden customer access |
| Generic app access / cancellation: platform-module-access.js | Metadata plus service authorization primitive | Each actual execution consumer must integrate; presence in platform_apps is not enforcement |
| Website, profile, front and Tile Studio: editor-versioned.js, project-tiles.js, member-fronts.js | Existing baseline owner controls retained, not trial-gated | Keep own-user/CAS/media controls; no grant of Control admin access |
| Control homepage / Work / operator registry | Existing administrator authority; unsupported as customer trial | Admin rights must not become purchasable through tenant capability booleans |
| World feed/discovery: customer-site-modules.js / customer_site_module_set_v1 | Existing owner preferences, not paid entitlements | Only world and world_discovery configurable; global M membership independent |
| Custom domain order / DNS / hosting: creator-domain-orders.js, creator-domains.js, creator-domain-host.js | Existing paid-plan and provider gates; unsupported trial consumer | Domain-first checkout and annual ownership/hosting separation remain unresolved; do not bypass registrar restrictions |
| Advertising: customer-site-advertising.js | Unsupported/inert | No ads, budget, campaign activation or invented paid plan |
| Shop/store/commerce: creator-store.js, creator-commerce.js, creator-checkout.js | Existing commerce authorization; unsupported module trial | Preserve order/account/session/amount/currency guards; decide specific shop capabilities and mapped SKUs before gating |
| Music/lyrics/stems/releases: music-workspace.js and creator RPCs | Existing owner/review/version guards; unsupported module trial | Preserve private histories and immutable asset ownership; publishing review is not an entitlement shortcut |
| Media/compute/studio production: compute-api and platform-plan routes | Existing resource/provider controls; unsupported module trial | No unbounded free generation; choose reviewed resource limits and atomic job admission |
| Analytics/privacy | Unsupported module trial | Consent and retention remain required regardless of payment; do not paywall privacy controls |
| Private math LMS / PRIM3 progress | Existing personal progress authority; unsupported module trial | Private checkpoint integration separate; scores are not certified assessments |
| PRIM3 story/game / OVH actors | Unsupported module trial | Existing canon, approval and publication holds remain; no autonomous activation |

## Snapshot and revocation semantics

The immutable registration receipt records the included app IDs/capabilities and duration. Removing an app from a later trial-policy module mapping, or changing its capability booleans, does not rewrite already granted promises. New grants follow current configured policy. App identity is checked, not only its key. The social consumer's app binding cannot be silently remapped after configuration, even by disabling/re-enabling the consumer.

Grandfathering does not override safety or explicit revocation: disabled app, global trial-policy disable, consumer safety_disabled, cancelled/expired trial or nonfulfilled/refund-required registration prevents new trial-funded mutations. A separately qualifying paid entitlement can survive trial cancellation; its own app/safety restrictions still apply. All recognized paid SKUs must be explicitly mapped before module mode is considered compatible with existing paid customers. No prices are chosen here.

Consumer enabled=false is a compatibility switch restoring legacy paid-plan behavior, not a safety kill switch. Use explicit safety_disabled to deny future advanced operations including paid customers. No rows are seeded. Policy selection and production activation require separate review.

Expiry and cancellation do not delete accounts, sites, drafts, job receipts or annual registration evidence. Recovery access remains. A job already sent to a provider is an external side effect; local revocation prevents subsequent authorized operations but cannot revoke an in-memory token or retract a request already dispatched. Record/read back uncertain outcomes rather than blindly resubmitting.
