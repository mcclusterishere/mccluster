# Decision Intelligence + GEV foundation

Built on merged PR #407. GEV is provisionally defined here as **Graph Evidence View**; confirm product naming before public UI. It is not Palantir software and does not claim Palantir interoperability.

## Shipped in this branch
- Deterministic, org-scoped, bounded graph projection of sources, claims and evidence links.
- No cross-org links, invented decision nodes, or raw source content in the graph.
- Unit tests for tenant isolation, scale ceiling, and unverified decision references.

## Next milestones
1. Verify production database roles and pending evidence migration; add a reviewed authenticated, least-privilege API. Do not insert unapplied migrations into the active production ledger.
2. Persist and retrieve sources, claims, links, decision approvals with audit history.
3. Integrate reconciled commerce/Stripe and analytics adapters; immutable input snapshots, currencies and payout reversals.
4. Graph explorer in Control Room with entity search, lineage, provenance and access-controlled drilldowns.
5. Research/economics/risk/critic agents, human approvals, outcome monitoring and forecast calibration.
6. Seek First spatial adapter and governed geospatial layers.

## Security and acceptance
- Test org membership and owner authorization before every sensitive graph query.
- Validate links by org in the database as well as projection code.
- Enforce pagination, maximum graph size, rate limits and privacy-safe redaction.
- No financial causal claims without defensible attribution.
- No AI output may directly execute payouts, publish campaigns or change entitlements.
- Run worker tests, drift guard, migration replay and CI before merge.
