# McCluster Compute Gateway

## Purpose

McCluster Compute turns external AI, media, 3D, GPU, and McCluster-native capabilities into one cost-aware execution plane behind `https://api.mccluster.org`.

McCluster remains the canonical ecosystem/control plane. Compute is a service plane beneath it. Mnet remains the social/network product plane.

## Customer unit

The universal customer billing unit is **McCluster Credits**, not LLM tokens.

Current list-value convention:

- 1,000 credits = $1.00 list value
- 1 credit = $0.001 list value

Provider-native units remain intact internally: tokens, images, seconds of video/audio, GPU seconds, 3D jobs, storage, bandwidth, API calls, and workflow runs.

The compute ledger stores real upstream cost in **micro-USD** independently from customer credits so pricing can change without losing cost accounting fidelity.

## Request lifecycle

1. Authenticate an `mcc_live_*` API key.
2. Validate compute scopes.
3. Normalize task/capability and customer policy.
4. Select an eligible route using enabled providers/models only.
5. Reject stale/unverified provider prices when the capability guard requires it.
6. Estimate upstream cost.
7. Apply the greater of model target margin and capability minimum margin.
8. Convert retail micro-USD to McCluster Credits.
9. Atomically reserve credits before any expensive upstream execution.
10. Execute the provider adapter.
11. Record actual provider usage/cost, latency, retries, model, provider, app, API key, and request ID.
12. Settle the reservation, refund unused reserved credits, or charge an allowed overage.
13. Preserve immutable cost events for margin analysis and provider reconciliation.

Failed/cancelled/rejected jobs release their reservation under the current Phase 1 policy. Provider-specific retry/failure billing can be added later where an upstream vendor still charges McCluster for failed work.

## Canonical tables

- `compute_providers`: provider registry and commercial/reseller status.
- `compute_models`: normalized model/capability catalog with current price snapshot.
- `compute_model_price_history`: immutable price snapshots and source provenance.
- `compute_routes`: model routing rules.
- `compute_route_decisions`: why a route was chosen.
- `compute_requests`: request-level execution record.
- `compute_credit_reservations`: pre-execution credit hold.
- `compute_cost_ledger`: real cost / retail / refund / retry / adjustment events.
- `compute_provider_health`: measured latency/reliability windows.
- `compute_price_guards`: floor margins, stale-price policy, and subsidy limits.

Existing `api_credit_ledger` remains the canonical customer credit balance.

## Price floor law

McCluster must not intentionally sell a brokered provider call below its configured floor merely because a public-facing price book is stale.

A route is commercially executable only when all of these are true:

- provider status is `available`;
- model is explicitly enabled;
- current provider pricing is verified and not stale under `compute_price_guards`;
- reseller/OEM rights are cleared, or a permitted BYOK path is used;
- required server-side credentials are configured;
- the customer has enough available credits to reserve the job.

Public price research does **not** itself authorize resale. Benchmark models may exist in the catalog disabled for economics testing.

## Routing policy

Routing is a policy problem, not simply `lowest price wins`.

Inputs may include:

- capability/task
- quality floor
- max retail cost
- max latency
- data-retention/privacy policy
- provider allow/deny list
- geography
- model context requirement
- customer contract
- route health
- measured eval score

The router should ultimately optimize quality, reliability, latency, privacy, and cost together.

## API surface

Phase 1 gateway routes:

- `GET /v1/compute/catalog`
- `GET /v1/compute/balance`
- `POST /v1/compute/estimate`
- `POST /v1/compute/run`
- `POST /v1/ai/route`
- `GET /v1/compute/requests/:requestId`

`/v1/ai/route` is the higher-level intelligent entry point; provider-specific compatibility endpoints can be layered on later.

## Adapter law

Provider adapters may translate request/response formats, but they may not bypass:

- API-key authorization
- scope checks
- route eligibility
- price verification
- credit reservation
- request IDs / idempotency
- cost accounting
- settlement
- auditing

Provider secrets stay server-side and never appear in browser or satellite repositories.

## Dark launch status

The initial benchmark catalog includes public-price snapshots for representative OpenAI, Anthropic, Fireworks, and fal routes, but the third-party models are deliberately disabled. That lets McCluster test economics without accidentally exposing unreviewed commercial resale paths.

To activate a third-party route:

1. verify current official/contract price;
2. record price provenance;
3. confirm resale/OEM/BYOK terms;
4. configure provider base URL and secret;
5. enable the model;
6. add at least one `compute_routes` row;
7. run settlement/margin tests;
8. monitor real provider reconciliation before broad access.

## Build sequence

1. Compute/cost ledger foundation — implemented.
2. Cost-aware routing and stale-price guards — implemented.
3. API gateway endpoints and reservation/settlement contract — scaffolded in Worker source.
4. Provider-specific cost reconciliation adapters.
5. OpenAI-compatible McCluster responses interface.
6. Media/image/video/audio/3D async job adapters.
7. Provider health scoring and eval-driven routing.
8. Automated official-price monitoring with approval gates.
9. Stripe credit purchase/subscription/overage automation.
10. Self-hosted/open-weight inference once measured utilization justifies it.
