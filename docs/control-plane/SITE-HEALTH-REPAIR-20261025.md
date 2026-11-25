# Analytics Site health repair — 2026-10-25

## Evidence and limits

Three owner screenshots were identified by the delegating thread: repeated
`ReferenceError: Can't find variable: _AutofillCallbackHandler` with Instagram
context; squeezed iPad session metrics; and a session detail read failure while
the Signed up list remained available. The supported Library materialization
helper returned `download failed` for all three in this executor. Pixel inspection
here was unavailable; investigation used the parent's transcriptions, source,
read-only database evidence, and newly rendered synthetic browser fixtures.

The repository references the callback only in diagnostic classification/tests,
not application behavior. Sentry's maintained source identifies this signature as
an Instagram WebView error:
https://github.com/getsentry/sentry-javascript/blob/develop/packages/core/src/integrations/eventFilters.ts
This supports a *likely injected* classification, not proof that a particular
visitor completed playback, signup or checkout. Campaign `utm_source=ig` alone
is not evidence of WebView execution. No callback shim or error cancellation is added.

Active PRs were checked before edits. #406 adds analytics decision cards and
preserves the forensic module; #408 concerns the evidence graph and #410 the
geographic API. None supplies this repair. Work starts at main `16bf2335`.

## Changes

- Match the exact callback ReferenceError, rather than any message containing
  its name. Script-file/stack evidence keeps the failure actionable. Existing
  explicit site attribution is retained. Historical broad callback attribution
  is corrected at read time; raw records are unchanged. Aggregation includes
  origin in the group key so a site error cannot disappear into an injected group.
- Browser diagnostics remain visible in Journey, with original props behind the
  existing expand control. They no longer get red friction styling or count as
  observed failed steps. Real JS errors, rejections and playback failures remain
  actionable. Historical database friction aggregates are explicitly described
  as recorded signals including browser diagnostics; no stored counts are rewritten.
- Forensic list/detail and header decisions use container width. Metric grids
  across Analytics wrap to minimum readable card widths, including nested panels.
  Numeric tokens do not split into characters. Labels wrap; original fonts and
  branding remain. Every metric is retained.
- Session detail no longer waits for 180-day cross-device visitor history.
  It returns the session and events with `visitor.history_status=not_loaded` and
  null history count/rows. The explicit Load visitor history action requests
  `include_history=1`; loading, failure and retry preserve the current journey.
  Core read failures remain failures, missing sessions remain 404, and detail
  retry, back, close, filter/range changes and newer requests reject stale results.

## Database diagnosis (read-only)

All selected `events` and `platform_profiles` columns exist in production.
`analytics_session_list` has its expected nine arguments including `p_devices`
and `p_sessions`; observed definition MD5 is `48906f9913fb22c82b0e7e25a823f371`.
No missing migration was inferred or applied.

At **2026-10-25 23:05:27.695 UTC**, PostgreSQL logs record SQLSTATE **57014**,
`canceling statement due to statement timeout`, inside `analytics_session_list`.
The PostgREST call names `p_devices` and not `p_sessions`: this is the supplemental
visitor-history call. It previously made the entire session detail request fail.
A bounded read of the latest signup session returned **297 events and one valid
session summary** using the existing `p_sessions` RPC, without returning private
visitor data into this report.

The repair removes history from the critical session read. It does not claim to
optimize the production history RPC: that optional read and the full Visitor
profile can still time out and must show failure/retry. Further query-plan work
requires separate scope/evidence; no index, statement-timeout, permission, schema,
credential, or production configuration changes were made.

## Reproducible checks

- `node --test scripts/test/*.test.mjs`
- `npm ci --prefix workers/mccluster --ignore-scripts` then
  `npm test --prefix workers/mccluster` (offline network harness)
- `scripts/e2e/analytics-tabs.e2e.mjs`: all 11 Analytics chapters and their
  controls at 390, 820, 1024, 1440px; metric checks also constrain each body to 340px.
- `scripts/e2e/site-health.e2e.mjs`: real Control shell, synthetic API fixtures,
  four widths plus 320px nested panes, seven cards, header, raw evidence,
  real failures, history/core read retries, back, and unexpected browser errors.
- Browser scripts use Playwright 1.57.0 and Cesium 1.131.0 via PLAYWRIGHT_DIR,
  CESIUM_DIR and optional CHROMIUM_PATH. CI stores rendered screenshots as artifacts.

No physical iOS/Instagram WebView reproduction, production deployment or merge
was performed. Synthetic Chromium tests establish the site-controlled behavior,
not the state of Meta's injected autofill implementation.
