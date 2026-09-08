# Equity Uprise Policy OS — Backend Runbook

Status: implementation branch `equity-uprise-policy-os`. Production must remain unchanged until preview migrations, smoke tests, RLS/advisors, and Edge Function checks pass.

## Operating rule

Equity Uprise owns the canonical graph and event ledger. Gmail, Calendar, Crossref, ORCID, repositories, government portals, social platforms and DDEX partners are transports/distribution replicas. External receipts return to `eu_events`; external systems never become the source of truth for initiative/research state.

## Backend domains now scaffolded

- canonical M identity reuse (`m_people` / `m_auth_user_links`)
- initiatives / milestones / members
- stakeholders / organizations / relationship pipeline / normalized communications
- existing hardened `out_*` Resend outreach bridge + Gmail History ingestion
- fellowship applications / interview requests / calendar holds
- research projects / membership / sources / claims / evidence / manuscript revisions / review
- immutable event ledger / declarative workflows / durable job queues / retries / leases
- canonical publications / stable IDs / versions / correction lineage / CRediT / ORCID
- HTML / JATS / BibTeX / RIS / CSL JSON / native PDF artifacts
- Crossref deposit + final submission-log callback verification
- Zenodo / OSF mirrors / SSRN submission package
- government targets / dockets / approval-gated Regulations.gov submission
- derivative artifact lineage + bridge into existing McCluster social campaigns
- citation / literature / source-health / RSS / government / stakeholder-site monitors
- music works / recordings / releases / rights splits / DDEX ERN 4.3.2
- Vault-backed runtime scheduling with pg_cron + pg_net
- integration/queue health endpoint for the future Desk

## Deployment order

1. Create a disposable Supabase preview branch from the current `Here` production project.
2. Apply the Policy OS migrations in filename order.
3. Run `supabase/tests/equity_uprise_policy_os_smoke.sql` in one transaction.
4. Run Supabase security and performance advisors and resolve findings before promotion.
5. Deploy the new Edge Functions using `supabase/config.toml` so public/webhook functions keep `verify_jwt=false` and staff surfaces keep `verify_jwt=true`.
6. Configure only the integrations for which credentials have been obtained. Leave every distribution target disabled until its sandbox/verification test succeeds.
7. Set one random `EU_WORKER_SECRET` and one random `EU_GOOGLE_WORKSPACE_SECRET` (minimum 32 random bytes is recommended).
8. Call `eu_runtime_configure_service()` with the Supabase project URL + those internal secrets. The RPC stores them in Supabase Vault and retains only Vault UUIDs in the runtime table.
9. Call `eu_cron_install_service()` to install core/external/DDEX workers, monitors, Gmail watch renewal and Gmail safety sync.
10. Enable each `eu_distribution_targets` row only after its provider-specific verification passes.

## Edge Functions

### Anonymous / webhook / internal-auth

- `eu-intake` — stakeholder + fellowship public intake; Turnstile when configured
- `eu-calendar` — sanitized availability and secure booking-token flow; staff confirmation internally authorized
- `eu-google-workspace` — Gmail Pub/Sub callback, History API sync, watch renewal
- `eu-worker` — internal publication renderer + Crossref/OpenAlex jobs
- `eu-external-worker` — Zenodo, OSF, ORCID, Regulations.gov, SSRN, native PDF fallback
- `eu-ddex-worker` — DDEX ERN generation/validation/partner delivery
- `eu-monitor` — leased recurring monitors
- `eu-orcid-oauth` — authenticated OAuth start + anonymous one-time callback
- `eu-crossref-callback` — Crossref final submission-log receipt

### User JWT + capability authorization

- `eu-workspace` — fellow/research collaboration mutations
- `eu-publish` — readiness, prepare, SHIP publication
- `eu-government` — draft/preflight/submit official policy filings
- `eu-music` — release preflight + approval-gated DDEX delivery
- `eu-derivatives` — lineage-tracked policy communication derivatives / social drafts
- `eu-status` — integration + queue + monitor health
- `eu-control` — approval request / decision / command history

## Secrets inventory

Never place these values in Git, public tables, frontend JS, screenshots or issue text.

### Internal

- `EU_WORKER_SECRET`
- `EU_GOOGLE_WORKSPACE_SECRET`
- `TURNSTILE_SECRET_KEY`
- `CROSSREF_CALLBACK_SECRET`

### Google Workspace

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GMAIL_ACCOUNT_EMAIL`
- `GMAIL_PUBSUB_TOPIC`
- `GMAIL_PUBSUB_AUDIENCE`
- `GMAIL_PUBSUB_SERVICE_ACCOUNT`

### Crossref

- `CROSSREF_LOGIN_ID`
- `CROSSREF_PASSWORD`
- `CROSSREF_PREFIX`
- `CROSSREF_DEPOSITOR_EMAIL`
- optional `CROSSREF_DEPOSIT_URL` for test environment
- `CROSSREF_CALLBACK_SECRET`

### ORCID

- `ORCID_CLIENT_ID`
- `ORCID_CLIENT_SECRET`
- `ORCID_REDIRECT_URI`
- `ORCID_ENV=sandbox` while developing; `production` only after Member API credentials
- optional `ORCID_API_BASE`

Individual contributor access/refresh tokens are stored in Supabase Vault by `eu-orcid-oauth`; do not put them into function-wide environment variables.

### Repositories

- `ZENODO_TOKEN`
- optional `ZENODO_API_BASE=https://sandbox.zenodo.org/api` during sandbox testing
- `OSF_TOKEN`
- optional `OSF_API_BASE`

### Government

- `REGULATIONS_GOV_API_KEY`
- optional `REGULATIONS_GOV_API_BASE` for staging

### DDEX

- `DDEX_DPID`
- recipient-specific `DDEX_RECIPIENT_DPID` only where a single partner is the default
- `DDEX_PARTNER_ENDPOINT` and optional `DDEX_PARTNER_AUTH` once a delivery agreement exists
- optional `DDEX_VALIDATOR_ENDPOINT` / `DDEX_VALIDATOR_SECRET` when a machine validator is available
- `DDEX_REQUIRE_SCHEMA_VALIDATION=true` (default behavior; do not disable in production)

### Existing McCluster outbound

- `RESEND_API_KEY` already powers the hardened `out_*` engine; Equity Uprise reuses it rather than creating another sender.

## External account setup

### Google Cloud

https://console.cloud.google.com/

Create/select a McCluster-owned project. Enable Gmail API, Google Calendar API and Cloud Pub/Sub API. Create OAuth credentials and authorize `matthew@mccluster.org` for the exact scopes used by the backend. Create a Pub/Sub topic for Gmail watch notifications, allow Gmail's publisher service account to publish to it, create a push subscription targeting:

`https://<project-ref>.supabase.co/functions/v1/eu-google-workspace/push`

Configure authenticated push and set the exact audience/service-account values in `GMAIL_PUBSUB_AUDIENCE` and `GMAIL_PUBSUB_SERVICE_ACCOUNT`.

Gmail watches expire; the Policy OS cron renews the watch daily and performs an hourly History API safety sync in addition to Pub/Sub.

### Cloudflare Turnstile

https://dash.cloudflare.com/

Create a Turnstile widget for the Equity Uprise web host. Frontend gets the site key; Edge Function gets only `TURNSTILE_SECRET_KEY`. Public intake must not go live without it.

### Crossref

https://www.crossref.org/membership/
https://www.crossref.org/documentation/register-maintain-records/verify-your-registration/notification-callback-service/

Obtain the Equity Uprise/McCluster DOI prefix/depositor credentials. Develop against Crossref's test/admin environment first. Configure the notification callback URL as:

`https://<project-ref>.supabase.co/functions/v1/eu-crossref-callback?token=<CROSSREF_CALLBACK_SECRET>`

Crossref's initial HTTP acceptance only means queued. `eu-crossref-callback` reads the final diagnostic and only then marks the Crossref record/delivery published.

### ORCID

https://orcid.org/developer-tools
https://info.orcid.org/documentation/integration-guide/registering-a-public-api-client/

Use sandbox credentials first. The callback is:

`https://<project-ref>.supabase.co/functions/v1/eu-orcid-oauth?action=callback`

Each author/fellow grants permission individually. Production work-write access requires appropriate ORCID Member API credentials; the backend never assumes one contributor's authorization for another.

### Zenodo

https://developers.zenodo.org/
https://sandbox.zenodo.org/

Create a sandbox token first, then production token. Use deposit write/action scopes. Equity Uprise keeps its Crossref DOI when one already exists rather than minting a second DOI for the same version.

### OSF

https://developer.osf.io/
https://osf.io/settings/tokens/

Create a token/OAuth integration for node creation and file storage. The adapter creates an OSF project and uploads the canonical publication artifact through the OSF storage provider.

### Regulations.gov

https://open.gsa.gov/api/regulationsgov/

Request an API key and separately obtain authorization for the Comment API. The backend supports submission keys + attachment upload URLs + final comment submission. Keep the distribution target disabled until the entity/API account is approved for POST comments.

### DDEX

https://ddex.net/implementation/
https://kb.ddex.net/reference-material/standards-specifications/
https://ddex-validator.ddex.net/

Obtain the DDEX Implementation Licence and DPID. The backend generates ERN 4.3.2. A DPID/valid XML does not create a DSP connection: obtain a delivery agreement/endpoint with the recipient. Keep schema validation required before automated partner delivery.

### Merlin

https://merlinnetwork.org/becoming-a-member/

Merlin is a later commercial/rights relationship, not the transport layer. Approach after the catalog has controlled rights, professional DDEX delivery, QC and reporting.

### Future email sovereignty

Current transport is Gmail for mailbox history + Resend for hardened campaign delivery. The Policy OS normalizes both, so transport can later move without changing CRM state. Amazon SES is the leading next transport candidate:

https://aws.amazon.com/ses/

The design goal is ownership of domain, canonical mail/relationship records, automation and archive—not coupling the institution to one SMTP vendor.

## Runtime scheduling

After deployment and secrets are set, configure the Vault-backed scheduler (service role / trusted operator only):

```sql
select public.eu_runtime_configure_service(
  (select id from public.orgs where slug='mccluster'),
  'https://<project-ref>.supabase.co',
  '<same EU_WORKER_SECRET as Edge Functions>',
  '<same EU_GOOGLE_WORKSPACE_SECRET as Edge Function>'
);
select public.eu_cron_install_service();
```

Installed cadence:

- core publication/Crossref/OpenAlex worker: every minute
- external repository/government worker: every minute
- DDEX worker: every minute
- monitors: every ten minutes (individual monitor `next_run_at` controls true cadence)
- Gmail watch renewal: daily
- Gmail History safety sync: hourly

## Approval model

Green/internal observation actions may run autonomously. High-risk capabilities remain approval-gated in the existing McCluster control plane:

- publication publishing/distribution
- official government submissions
- external calendar creation
- external integration/credential changes
- DDEX/music delivery
- existing social publishing/campaign sends retain their own control-plane gates

A high-risk request is cryptographically bound to resource + request hash. Editing the material after approval changes the hash and invalidates that approval.

## Pre-production acceptance

Do not merge/promote until all are true:

- GitHub `Equity Uprise Policy OS` SQL parse job passes
- GitHub Edge Function Deno check passes
- disposable Supabase preview branch migrates cleanly
- transactional smoke test passes
- Supabase security advisor has no unresolved Policy OS critical findings
- Supabase performance advisor findings reviewed
- anonymous intake cannot read back submissions/PII
- fellows can edit only assigned/member research workspaces
- applicant booking tokens cannot read calendar contents
- stale/duplicate slot confirmation loses the free/busy race safely
- publication SHIP fails with unsupported factual claims/open reviews
- Crossref test deposit reaches a successful final submission log
- ORCID sandbox work write succeeds for a consenting test identity
- Zenodo sandbox + OSF test mirror succeed
- Regulations.gov staging/account capability is verified before POST is enabled
- DDEX ERN passes current schema/profile validation before partner automation is enabled
- disabled/unconfigured external targets fail closed, not silently succeed
