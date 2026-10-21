# Analytics Step 2: source diagnostics

This extends granular reporting only to house owners. The existing `/v1/analytics/business` route also permits authorized house staff (`ops.use`), who still receive the original aggregate snapshot and `read_errors` but **not** `read_diagnostics`. This is enforced by the route's verified membership role. It does not change whether the dashboard reports `Partial data` or alter any existing metric value.

`snapshot.read_errors` retains its existing string-key contract. New `snapshot.read_diagnostics` attaches a bounded metadata object to each of the business reads: `status`, `elapsed_ms`, and for a failed read `reason` (`timeout`, `authorization`, `missing_source`, `upstream_error`, or `unavailable`), sanitized upstream SQLSTATE/PostgREST `error_code`, actual `upstream_http_status`, and an optional syntactically validated `request_id` from `sb-request-id` (preferred), `x-request-id`, or `cf-ray` headers.

The API deliberately excludes raw SQL, full HTTP response bodies, JWT tokens, messages, request URLs, and any untrusted header values. Unknown or malformed metadata is reported as null, not guessed. A completed nonapplicable time window is labeled `not_applicable`, not failed or zero. Distinguish a successful API response that contains incomplete business subreads from a complete business snapshot.

Control Analytics displays the structured failure code/status/timing alongside existing failed measurement keys in its collapsed detail. Original partial status and all other sources remain intact. Regression tests exercise a 57014 timeout from an upstream 500, request correlation, complete other families, absence of leaked SQL/secrets, skipped vs complete, and the actual client-rendered warning.

**Verification:** exact-head Worker CI plus signed-in production reads at 24h, 7d, and 30d are required before claiming all source issues resolved. Post-deploy provenance must be observed at `/v1/health` and data requests must be checked with owner authorization. Do not disable error reporting merely to turn a warning green.
