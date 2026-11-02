# Remaining backend and owner gates

No activation is implied by local tests. No module prices or trial promises are added.

| Gate | Concrete decision or evidence needed |
|---|---|
| Trial policy | Approve verification-time start, calendar month versus 720 hours, proposed once-per-org eligibility, evidence freshness and exact included app/capability snapshot. Sandbox eligibility remains explicit. |
| Paid compatibility | Inventory current supported Stripe price IDs and map each to the exact existing app/capabilities. Review legacy paid customers before module mode; no arbitrary paid subscription grants every module. Prices and automatic paid conversion remain unset. |
| Revocation policy | Confirm safety-disable authority and operational procedure. Consumer disable means legacy compatibility; safety_disabled is the kill switch. Existing snapshot promises survive ordinary mapping edits; cancellation/app/global safety still gate future actions. |
| Registrar and purchase | Authenticated registrant/ownership and actual-charge readbacks, bounded provider charge authorization, idempotent registration reconciliation, refund completion, annual expiry/renewal/transfer evidence. Payment success or DNS proof is insufficient. Existing live registrar restriction stays. |
| Domain hosting | Resolve domain-first purchase versus existing active-plan gate, hosting/resource economics, DNS/TLS/apex support and scheduled verification refresh. Annual registration does not promise unlimited hosting. |
| Social runtime | Real multi-account OAuth/provider validation, cancellation/retry/readback UX, lock-conflict handling and uncertain external outcome recovery. Local SQL/token proof is not a provider delivery test. |
| Unintegrated consumers | World delivery still paid-gated; signed uploads only preflight-gated. Shop, music/media/compute, analytics, LMS, PRIM3/game and actors lack adoption of the new trial contract. See CONSUMER-LEDGER.md; retain existing permissions, quotas and holds. |
| Release | Verify exact actual schema/dependencies and grants, review SQL hashes/backup/containment and coordinated Worker/UI versions, then obtain separate production approval. Local source, merged source, deployed source and functional verification remain distinct. |

## Status reason contract

For authorized owners, capability.entitlement_reason describes entitlement separately from provider/connection readiness. When denied, capability.reason equals that entitlement reason: expired, cancelled, safety_disabled, module_disabled, trial_disabled, registration_blocked, not_granted, pending or unentitled. legacy_paid_required means the explicitly selected legacy consumer requires an active paid plan. An active trial that excludes the app/capability reports module_not_included; a paid mapping without the capability reports module_capability_unavailable. Missing/malformed module reason reports module_authorization_unavailable.

Eligible access can retain included_trial, mapped_paid_subscription or legacy_paid in entitlement_reason while reason reports provider_unavailable or owned_connection_required. A ready eligible connection has reason=null. The feature-off compatibility response retains active_owned_workspace_required for unpaid status. Missing organization ownership returns HTTP 403 before entitlement lookup; it never returns that other organization's trial state. Authentication failure remains HTTP 401. UI must not infer ownership from a trial status or convert authorization errors into another tenant's reason.

Registrar clarification: see [the dated official-source amendment](../20261102-domain/REGISTRAR-EVIDENCE-AMENDMENT.md). Production API availability and inline contacts are established; billing readiness, settled-charge/registrant readback and permission for our exact managed resale/ownership model are separate gates. Existing live guards remain.
