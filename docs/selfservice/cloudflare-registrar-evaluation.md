# Cloudflare Registrar provider evaluation

Checked 2026-10-26 using current official documentation and the connected Cloudflare OpenAPI **search** tool. No account mutation, contact creation, registration, payment, credential creation, legal acceptance or sandbox registration was performed.

**Decision:** do not enable a Cloudflare provider factory for the current complete customer purchase/renewal lifecycle. Cloudflare now documents considerably more than the legacy domain-information endpoint, including a sandbox. However, the documented API does not fulfill the manual funded-renewal and registrant-verification contracts used by this implementation. This is a capability/integration conclusion, not a claim that Cloudflare prohibits reselling.

## Supported surfaces

| Customer need | Official API evidence | Meaning for this implementation |
| --- | --- | --- |
| Availability and registration price | POST `/accounts/{account_id}/registrar/domain-check` returns domain registrability, pricing and unsupported/premium reasons; it is read-only despite POST. | Suitable source for a fresh pre-purchase check. Search suggestions alone are insufficient. |
| Registration with customer contact | POST `.../registrar/registrations` accepts inline `contacts.registrant`, years, privacy mode and explicit `auto_renew:false`. Per-TLD schema comes from `.../registrar/extensions/{extension}`. | Initial registration is documented. Never omit customer contact and silently substitute Matthew's default. |
| Durable registration progress | POST may return 201 or 202; `.../registration-status` reports terminal and action-required/blocked states. Domain name is documented as the natural registration idempotency key. | Needs a Cloudflare-specific async workflow adapter; 202 must never be treated as a failed purchase or blindly resubmitted. |
| Account ownership/status/expiry | GET `.../registrar/registrations/{domain_name}` is the canonical read of an account-owned registration. | This is materially stronger than legacy `/registrar/domains/{domain_name}`. It must be matched to our immutable customer order. |
| Testing | Explicit `/accounts/{account_id}/registrar-sandbox/` paths expose search, check, registrations, status, updates and extension metadata. | A documented sandbox exists. Its account access and behavior were not exercised. No registration request was sent. |

Sources: [Registrar API guide](https://developers.cloudflare.com/registrar/registrar-api/), [registration API](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/create/), [sandbox reference](https://developers.cloudflare.com/api/resources/registrar_sandbox/), and matching resolved connector OpenAPI paths.

## Blocking gaps for the current complete provider interface

1. **Funded manual renewal:** the exhaustive `/registrar` and `/registrar-sandbox` path scan contains no manual renewal operation. PATCH registration supports only `auto_renew`. That setting authorizes a future charge against the Cloudflare account payment method; it cannot honestly implement `renew({domain,years})` for a customer's one-time funded renewal order. Do not disguise toggling auto-renew as completed renewal.
2. **Customer contact lifecycle:** registration accepts inline PII, but the contact schema says address-book entries are managed only in the dashboard. No standalone provider contact-create/read endpoint is exposed. Our current service stores a verified provider contact ID rather than the customer's raw postal/phone details. A Cloudflare registration-only integration would need a separately reviewed inline-contact storage/retention model, not an invented `contact_id` response.
3. **Registrant matching after purchase:** canonical registration GET has `domain_name`, `status`, `created_at`, `expires_at`, `auto_renew`, `privacy_mode`, and `locked`. It does not expose contact fields/IDs. It proves the account registration state, but does not independently satisfy our current `registrant_matches` check. No speculative interpretation of legacy `supported_tld` or a requested name can fill that gap.

These facts were checked directly in resolved OpenAPI request/response schemas for registration POST, GET and PATCH. Public references: [Registrar API](https://developers.cloudflare.com/api/resources/registrar/), [renewal guidance](https://developers.cloudflare.com/registrar/account-options/renew-domains/), [contact updates](https://developers.cloudflare.com/registrar/account-options/domain-contact-updates/).

## Additional deployment gates

The live registration API charges the account's default payment method and completed purchases cannot be refunded by the registrar. It requires account billing setup, Registrar token permissions and registration agreement setup. The schema documents a 500-domain account limit. These are not configured or accepted by this evaluation. Cloudflare Registrar requires Cloudflare nameservers; registrant email verification and later contact changes may require customer email action. [Registration reference](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/create/), [Registrar FAQ](https://developers.cloudflare.com/registrar/faq/).

The legacy domains list documentation marks that API deprecated with a 2026-09-27 end-of-life date. Connector exposure of old paths does not establish current functional support or ownership. [Legacy list reference](https://developers.cloudflare.com/api/go/resources/registrar/subresources/domains/methods/list/).

A missing zone for a particular domain is a separate hosting configuration fact, not proof of availability, registration ownership or reseller readiness. This evaluation did not infer those properties from the parent's account observations.

**Remaining action:** keep domain sales disabled and retain the NameSilo verification gate unless a complete provider contract is verified, or explicitly scope a separate Cloudflare registration-only product with honest renewal limitations and reviewed inline-contact handling. No runtime factory, environment flags or permissions were added by this investigation.

## Subsequent bounded implementation

A separate registration-only sandbox adapter and durable attempt bridge now exist; see `cloudflare-registration-adapter.md`. This supersedes only the earlier statement that no factory was added. The full legacy purchase/renewal interface remains unsupported and customer purchasing remains disabled.
