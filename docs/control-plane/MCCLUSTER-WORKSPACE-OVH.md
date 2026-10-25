# McCluster Workspace — OVH-hosted productivity migration
Status: staged architecture and safety gates; **not deployed**. This project is
**independent of OVH incident #510 and PR release train #509**. Do not use either
as a migration tracker.

## Objective and scope

Replace required Google Workspace workflows with McCluster-owned services
running on OVH infrastructure. The Core runner remains the **control and
observability plane**, not the SMTP/IMAP data plane. Keep authoritative DNS
and any existing production provider intact until acceptance evidence passes.

This is a product migration, not an `MX`-record-only migration. A working
SMTP server does not replace Google Docs, Drive, Calendar, Contacts, Meet,
business identity, or Vault.

## Existing code to reuse

- `scripts/mail/bootstrap-mail-server.sh`: Postfix submission and OpenDKIM;
  standalone, send-only bootstrap. **Not evidence that it is installed.**
- `scripts/mail/bootstrap-mailbox.sh`: Dovecot/IMAP and Rspamd mailbox
  bootstrap. It configures one mailbox; do not use it to provision teams.
- `scripts/mail/multi-tenant/`, `docs/control-plane/MULTI-TENANT-MAIL.md`:
  SQL-backed virtual domains/mailbox planning. Inspect migrations, deployed
  schema, password reset flow, and host configuration before reuse.
- `scripts/mail/verify-mail.sh`: required host-side read-only preflight.
  `send-only` requires external MX; `staged` requires external MX plus a
  working receiving stack; `full` requires exclusively local MX.
  Preflight success alone **never proves delivery or inbox placement**.
- `supabase/functions/eu-google-workspace/index.ts`: Gmail-specific
  Pub/Sub/history ingestion for Policy OS communications. A future
  provider-neutral adapter must preserve authorized org scope, external
  IDs/thread linkage, idempotency, privacy filtering, and outreach events.

## Product parity matrix

| User job | OVH-hosted component | Acceptance requirement |
| --- | --- | --- |
| Send/receive custom-domain mail | Existing Postfix/Dovecot stack **or** evaluated mailcow replacement (choose one), browser mail client | Authenticated submission, inbound MTA, IMAP, aliases, quotas, spam/abuse controls, mobile clients |
| Calendar/contacts | Nextcloud Calendar/Contacts (one canonical CalDAV/CardDAV source), or evaluated SOGo | Shared calendars, invitations/timezones, contacts, iOS sync, migration counts |
| Files/Drive | Nextcloud Files | Mobile sync, versioning, shares, per-user quotas, recoverable deleted files |
| Docs/Sheets/Slides | Nextcloud Office with supported Collabora backend | Concurrent editing, common formats, permission controls, import/export tests |
| Meet/Chat | Nextcloud Talk (TURN/SFU sized separately) | Mobile/desktop calls, invitations, screensharing, room access and stability |
| Forms/tasks/notes | Nextcloud Forms, Tasks, Deck/Notes | Share and export/restore checks |
| Company admin | McCluster Control facade + identity provider | Tenant-scoped provisioning, SSO where supported, MFA, joiner/mover/leaver offboarding |
| AI search/help | Explicitly authorized Core capability endpoint | No unsanctioned mailbox indexing, model/data provenance, audit trail |
| Google Vault/eDiscovery | Separate retention/archive/legal hold design | Retention policies, immutable evidence and tested export; **not yet equivalent** |

Maintain native app UIs at first. McCluster Control can provide a unified
navigation shell once identity/account provisioning is verified. One visual
dashboard does not mean every backend can safely share the same credentials.

## Deployment topology

- `core.mccluster.org`: existing OVH Core and monitoring; **no mail
  service installation on the Core host** during infrastructure recovery.
- A **separately provisioned OVH mail VM with its own static address**:
  Postfix/Dovecot/Rspamd/OpenDKIM (or a selected alternative, not both).
  OS, firewall, data volumes, queue, backups, and upgrade cadence isolated.
- A **separate OVH productivity VM**: Nextcloud All-in-One, Office, Talk,
  Redis/Postgres, separate persistent storage. Backups independent of mail.
- DNS at its existing authoritative provider, never a mail/web reverse
  proxy for SMTP/IMAP. Domains below are **reserved design names**,
  not claims that records exist:
  `mail.mccluster.org`, `workspace.mccluster.org`.
- Prefer a tested authenticated SMTP relay if direct egress to remote MX on
  port 25 is blocked or unreliable. Port **587 is SMTP submission**; using
  port 587 to reach an unconfigured remote MX does not automatically
  replace direct MTA-to-MTA delivery on port 25. Never leave mail queued
  silently after returning successful submission.

## Security and reliability acceptance gates

1. Record a fresh OVH Core baseline separately. Confirm host identity,
   running services, egress restrictions, mail VM isolation, and storage
   capacity. Repo branches/CI are not host-runtime evidence.
2. Inventory each paid Google user, aliases, groups, mailbox bytes,
   calendar count, contacts, Drive bytes, shared permissions, retention
   requirements, and third-party apps using Google sign-in.
3. Verify IP address and reverse DNS matching `mail` FQDN, unproxied A
   record, TLS and renewals, SPF **preserving existing senders**, DKIM,
   DMARC monitoring and gradual policy enforcement; ensure **one SPF TXT
   record**, not two. Verify mail-specific inbound 25, submission 587,
   and IMAPS 993 (or justified alternatives).
4. Check authenticated SMTP submission and rejection of third-party relay
   without auth. Check actual outbound 25 **from the mail VM**, queue
   flushes, bounce visibility, rate limits, spam/virus handling,
   mailbox quotas and account lockout. A public network failure from an
   unrelated checker is `unverified`, not host outage.
5. Establish offsite **encrypted** backups, key custody, retention,
   regular restore drills, monitoring and an incident runbook. A backup
   archive that can be listed but has never been restored is not proven
   recovery. Never log mailbox passwords or private keys in CI artifacts.
6. During **dual-run**, sync mail with a read-only source via IMAP/API,
   compare folder counts and sample message IDs, test tags/labels, and
   export calendars, contacts and Drive formats. Do not delete originals.
7. Deliver real outbound test messages to Gmail and Outlook; inspect
   received SPF, DKIM, DMARC, TLS, spam placement, and replies. Send
   inbound pilot messages directly to the mail VM while production MX
   remains at the old provider.
8. Gate MX switch on an explicit owner-approved cutover checklist:
   delivery + receipt + client login + monitoring + backup restore +
   rollback all proven. On cutover, lower TTL in advance, make the MX
   change, monitor both providers, and perform a second delta import.
   Keep the old subscription active through a tested dual-run window.
9. Replace the Gmail-specific Policy OS bridge with an IMAP/mail-event
   adapter and test event deduplication, external message IDs and org
   permission boundaries before disabling Google watch.
10. Only terminate Google after user inventories, all migration checks,
    archives and required export/security obligations are completed.

## Readiness semantics

`MAIL_MODE=send-only bash scripts/mail/verify-mail.sh`: submission server
checks; production MX **must stay elsewhere**.

`MAIL_MODE=staged bash scripts/mail/verify-mail.sh`: send+receive server
checks while MX still points to Google/another provider. Reports
`STAGING PRECHECK PASSED`, **not a permission to cut over**.

`MAIL_MODE=full bash scripts/mail/verify-mail.sh`: post-cutover
configuration check; MX **must point exclusively** to the designated mail
host. Does not replace real delivery probes and backup restores.

Unverified critical checks fail closed. `p=none` DMARC can remain
a monitoring warning during warming, but unknown egress, IMAP, or relay
safety is not readiness.

## Cost measurement

Compare the **actual** existing monthly Workspace invoice against the
incremental OVH VM(s), storage, backup egress/storage, SMTP relay (if used),
administration/on-call hours, recovery capacity and any software support.
Do not publish account billing records, mailbox contents, or passwords.
Price-to-feature comparisons must match storage and security requirements.

## Out of scope for this stage

No server provisioning; no edits to MX/SPF/DKIM/DMARC; no email deliveries;
no credential access; no new migrations; no Supabase SMTP configuration
change; no Google cancellation; no installation on the running OVH Core;
no interaction with incident #510 or release train #509. Any future
infrastructure work is a separately reviewed deploy with runtime evidence.
