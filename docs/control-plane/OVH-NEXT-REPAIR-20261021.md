# OVH incident #510: bounded reflection and truthful health detail

Scope: OVH Core only. Release-train #509 and unrelated PRs are independent.

The repaired 337-entry migration ledger is unchanged. This change does not apply SQL, change repository visibility, access private keys, reset failed jobs, enable communications or promote Halo application code.

## Reflection

Recent-job evidence is now a house-scoped projection excluding repeated host-health records. One skinny health summary is read separately. Selected objective/job fields are allowlisted and the escaped UTF-8 evidence JSON is limited to 6,000 bytes. Input omissions are recorded. The request retains its 90-second ceiling and low priority, disables thinking, requests JSON and limits output to 384 tokens. Diagnostic requests with max_next_jobs=0 cannot enqueue follow-up work even if the model proposes it. Completion results include request bytes, elapsed time and available model/queue usage; transport failure messages include bounded diagnostic codes instead of nested response data.

## Health

The original collector is preserved byte-for-byte as host-health-collect.mjs. The public executor adds a separate paginated failed-job scan with explicit completeness and lower-bound semantics, avoiding starvation by health telemetry. It also provides fixed read-only command/file/HTTP diagnostics under the actual Core service user, including exact local/public HTTP status and observed serving SHA. Transport failure is unverified, not an outage.

health_sections separates infrastructure, workload history and capability readiness. A missing relay is identified as not_configured, while pending work without a relay remains degraded. The aggregate degradation list and overall status are preserved, not painted green.

## Deployment acceptance

Require full exact-head CI and review, normal main-contained production promotion, an actual public runtime response for the promoted SHA and a fresh host-executed snapshot with migration parity. Then run one reflection diagnostic with max_next_jobs=0 and verify completion, request size/timing and zero children. Inspect new Blender and Halo probe evidence before changing packages, units or permissions. Do not infer that these host readiness problems were fixed by this code change alone.
