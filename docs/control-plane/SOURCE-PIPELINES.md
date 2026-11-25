# Source pipelines: Gmail, Google Calendar and Stripe into Supabase

Status: **draft, not live.** The SQL is pending (`supabase/pending/20261125010000_ai_context_source_pipelines_v1.sql`),
nothing is scheduled, and no credentials are configured. The default run is a dry run into memory.

## What it is

Three pull pipelines in OVH Core (`core/src/pipelines/`) that copy **metadata only** from the owner's Gmail,
Google Calendar and Stripe into the house organization in Supabase, through the existing universal ingestion
contract (`ops_ingest_connectors`, `ops_ingest_runs`, `ops_ingest_records`) plus one typed, owner-only table per
source in `ai_context`.

| Source | Connector | Table | Upstream call | Cursor |
|---|---|---|---|---|
| Gmail | `google.gmail` | `ai_context.source_messages` | `users.messages.list` + `get?format=metadata` (scope `gmail.metadata`) | high-water `internalDate`, plus page token while a backlog is walked |
| Calendar | `google.calendar` | `ai_context.source_calendar_events` | `events.list` with `fields=` mask and `syncToken` (scope `calendar.events.readonly`) | `nextSyncToken`; a 410 restarts with a bounded window |
| Stripe | `stripe.api` | `ai_context.source_payments` | `GET /v1/{charges,refunds,invoices,customers}` with a restricted `rk_` key | `created` high-water mark per object type |

Existing payment authority is untouched: `commerce_*` Stripe reconcilers and webhooks stay canonical for money.
`ai_context.source_payments` is a read-only observation for context and entity matching.

## What is stored, and what never is

| Kept | Never stored |
|---|---|
| Gmail: message and thread ids, time, labels, direction (in/out/self), keyed hashes and domains of counterparties, attachment count, a redacted subject only if `GMAIL_INGEST_INCLUDE_SUBJECT=1` | bodies, snippets, attachments, raw addresses, display names. Spam, trash and drafts are skipped. |
| Calendar: event id, keyed calendar id, status, start/end, all-day, redacted title, organizer-is-me, attendee count and keyed hashes, has-conference, has-location | descriptions, location text, conference links, raw attendee addresses |
| Stripe: object id and type, time, status, amounts, currency, livemode, customer id, related id (payment intent, charge, subscription), keyed email hash, allow-listed metadata keys | card details, names, phones, addresses, descriptions, all other metadata |

Defense in depth:
1. The normalizers build each record from an explicit field list and redact free text (addresses, links, phone numbers, 4+ digit runs such as one-time codes).
2. The database rejects any record carrying a field outside `ai_context.source_allowed_keys` (a test keeps the JS and SQL lists equal).
3. Email addresses become HMAC-SHA256 hashes with `MCCLUSTER_PII_HASH_KEY`. The same person yields the same hash in all three sources, so a Stripe customer, an email sender and a calendar attendee can be matched without storing the address.

## Guarantees

- **Owner only.** Every RPC requires the house organization and an `org_members` owner as the actor. Tables have RLS on, no policies and no grants (not even `service_role`); only the four `SECURITY DEFINER` RPCs reach them, and only `service_role` may execute those.
- **Idempotent.** Unique per org + account + external id; a record whose content hash did not change is a no-op. Replays write nothing.
- **Audit.** Each batch is one `ops_ingest_runs` row (actor, account, mode, cursor before/after, inserted/updated/unchanged/rejected, rejection reasons by id). Each accepted change is one content-addressed `ops_ingest_records` row.
- **Cursor safety.** The cursor rides on the final batch of a pass and advances only when the batch is recorded; a batch where every record was rejected does not move it.
- **Retention.** `ops_ai_source_prune` deletes projected rows older than the connector's `retention_policy.days` (Gmail 400, Calendar 730, Stripe 2555).
- **Least privilege upstream.** Gmail uses the metadata scope (Google refuses bodies), Calendar uses events read-only, Stripe refuses a full `sk_` key unless `STRIPE_INGEST_ALLOW_SECRET_KEY=1`.

## Running it

```bash
cd core
npm run test:pipelines                                   # unit + contract tests, no network
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js npm run test:pipelines   # adds the real-SQL end to end
MCCLUSTER_PII_HASH_KEY=$(openssl rand -hex 32) npm run pipelines:dry -- --source stripe --fixture test/fixtures/source-pipelines/stripe.json
# Live pull, dry write (needs credentials, prints counts only):
npm run pipelines:dry -- --source gmail
# Live pull and write (needs the pending SQL applied and owner approval):
node src/pipelines/cli.mjs --source gmail --write
```

Output is counts and run ids only, never record contents.

## Turning it on (owner steps)

1. Approve and apply `supabase/pending/20261125010000_ai_context_source_pipelines_v1.sql` (rollback alongside).
2. On the OVH Core host, set in `core.env`: `MCCLUSTER_PII_HASH_KEY`, `MCCLUSTER_OWNER_PROFILE_ID`, and per source the variables in `core/core.env.example`.
3. Google: create an OAuth client in a McCluster Corp Google Cloud project, enable the Gmail and Calendar APIs, and mint one refresh token per source with only its scope.
4. Stripe: create a restricted key with Read on Charges, Refunds, Invoices and Customers.
5. Schedule `node src/pipelines/cli.mjs --source <s> --write` (for example every 15 minutes for Gmail and Calendar, hourly for Stripe). Not scheduled by this change.

## Not in this change

- No job type is registered in `runner.mjs` and no systemd timer is added; scheduling is an explicit later step.
- No graph view or entity-alias writes yet; the keyed hashes are the join key that work will use.
- No push/webhook path; Stripe webhooks keep flowing to the existing commerce reconcilers.
