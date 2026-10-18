# Analytics ingestion repair — 2026-10-17

Production audit found a disabled USGS collector despite the evidence canon being applied, an unprovisioned spatial schema, and a connected Instagram account with zero registered posts and a rejected access token.

This repair enables the existing private USGS collector and writes its normalized events through the existing spatial store before advancing the evidence checkpoint. An archive error leaves the cursor unchanged for an idempotent retry. Source entitlements are read strictly; a read failure or disabled grant cannot fall back to permission. No public globe layers are enabled. Attribution remains in stored provenance.

The forward migration reconciles the five existing spatial replay migrations without altering historical files and explicitly closes browser-role table and function privileges. Social discovery uses the existing cron and canonical channel credential resolver. Each leased account imports at most one 50-item page per tick; duplicate imports preserve campaign and publishing links. Successful pages checkpoint their cursor. Failures back off for an hour. No media is published by discovery.

Insight snapshots distinguish an actual zero from an unavailable measurement. Total provider failure does not create a snapshot or advance the successful-sync timestamp. Unsupported and unrequested metrics stay null; incomplete automatic measurements do not generate synthetic optimization scores. Historical imported posts receive one initial measurement; recent posts retain their refresh cadence. Existing manual-writer defaults remain compatible.

Account follower/media counts are retained with their measurement timestamp. Discovery and insights emit structured observability records. Coverage now separates spatial entities, events and observations and includes imported publishing posts.

Validation includes mocked provider failure/partial measurement tests, archive checkpoint ordering, fail-closed entitlements, and database-role tests for private access, leases, historical imports, null versus zero and idempotency. Deployment and live record verification are recorded in the associated pull request. Instagram cannot deliver live measurements until its rejected credential is reconnected through the canonical channel configuration.
