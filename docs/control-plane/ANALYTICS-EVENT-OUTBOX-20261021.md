# Analytics P0 delivery recovery — browser outbox v1

The existing writer already accepts stable client-minted UUID v4 event IDs, uses PostgREST `on_conflict=id` with `resolution=ignore-duplicates`, and performs two bounded retries. The remaining risk was clearing its **in-memory** queue before delivery completed, with nothing retained after network failure.

## Repair

The existing `js/analytics.js` loader now writes a **minimal** per-event recovery envelope to same-origin localStorage before network submission, but only when the current privacy policy was acknowledged, the page is not an owner preview, and GPC/DNT are not asserted. It retains only v4 event ID, event name, filename-only path, creation time, empty properties, null referrer. It never writes arbitrary event props, URL queries, referrers, network identity, access tokens, precise location, device or session IDs to the retry shelf.

On successful verified collector receipt it removes the envelope. On retries the original event ID is reused, preserving the server's unique-ID deduplication guarantee. Recovered events intentionally omit **Authorization**, device/session IDs and detailed props, rather than attributing historical actions to a different account or newly minted session. In-progress normal deliveries retain full in-memory first-party event data. Retention is at most six hours and 72 unsent minimal events; recovery sends at most twelve per attempt and is attempted on next load, focus, online, and at bounded foreground intervals. Independent per-event keys prevent whole-array lost updates across browser tabs; duplicate cross-tab attempts are permitted because the server safely deduplicates by UUID.

When privacy acknowledgment is withdrawn or not present, all pending envelopes are purged; no new persistence is allowed with GPC/DNT. The sender still obeys the existing server-side GPC/DNT minimization of aggregate events. A storage event listening for acknowledgment removal clears in-memory and persistent queues across active same-origin tabs.

## Limits and observability

Browser storage may be unavailable, quota-exhausted or full; the old best-effort immediate send remains operational but **durability cannot be guaranteed** in those cases. The queue deliberately rejects new durable entries at its cap rather than evicting older unacknowledged messages; a local, non-transmitted dropped counter exposes that fact. This is not a server-issued receipt log or a guarantee against browser shutdown before the JavaScript runs. The per-event recovery envelope discards attribution fields to minimize privacy risk. Never claim zero unobserved loss from matching `events` and `events_lean` row counts alone.

## Acceptance

Run `node --test scripts/test/analytics-outbox.test.mjs`, all repo CI and privacy/browser regression suites. Confirm active consent, withdrawal purge, GPC/DNT, cross-tab separate keys, and idempotent retry under network 500 then recovery. Monitor actual 57014 insert cancellations, collector response receipt rates, raw/lean record IDs, and database pressure. No new schema, RLS, production secrets or changes to unrelated apps.
