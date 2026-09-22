# The house mail server

McCluster sends its own mail. No Resend, no SendGrid, no per-message
bill and nobody else's terms of service between the house and the people
who signed up to hear from it.

This is the runbook. It is in order on purpose: several of the steps fail
if the one before it has not landed, and two of them fail *silently*,
which is the whole difficulty with running mail.

---

## What this is, and the one thing it is not

**It is:** a send-only relay on the OVH VPS (`15.204.235.103`). Postfix
takes an authenticated message on port 587 and delivers it outward on 25.
OpenDKIM signs it. Supabase Auth is the caller.

**It is not a mailbox.** `mccluster.org`'s MX points at Google Workspace
and that is where `matthew@mccluster.org` is *read*. Sending as an address
and receiving for it are separate jobs, and only the first one lives here.

> **Never point an MX record at `mail.mccluster.org`.** It does not accept
> incoming mail. Doing so silently discards everything sent to the domain,
> and mail that bounced during the gap does not come back. `verify-mail.sh`
> checks this on every run for exactly that reason.

---

## Why the order matters

Two failures here produce no error anywhere:

1. **Port 25 blocked.** Postfix accepts the message, answers `250 OK`,
   queues it, and never delivers it. Supabase sees success. The website
   sees success. The listener sees nothing.
2. **Bad or missing authentication.** The message is delivered and Gmail
   files it in spam. Nobody is told. Signup confirmations that land in
   spam look exactly like traffic that stopped converting.

So nothing gets pointed at this server until `verify-mail.sh` passes.

---

## Step 1 — DNS, in Cloudflare

All of these are **DNS only (grey cloud)**. Mail cannot be proxied; an
orange cloud here breaks it.

| Type | Name | Value |
|---|---|---|
| A | `mail` | `15.204.235.103` |
| TXT | `@` | *(edit the existing SPF — see below)* |
| TXT | `mail._domainkey` | *(printed by the bootstrap script in step 4)* |

**SPF — edit, do not replace.** The current record is:

```
v=spf1 include:_spf.google.com include:spf.titan.email include:_spf.wpcloud.com ~all
```

Add `ip4:15.204.235.103`, keeping everything already there — Workspace
still sends the owner's ordinary mail, and dropping that include breaks
it instead:

```
v=spf1 ip4:15.204.235.103 include:_spf.google.com include:spf.titan.email include:_spf.wpcloud.com ~all
```

DMARC already exists at `p=none`. Leave it there while the IP warms up;
tighten it once the reports are clean.

## Step 2 — Reverse DNS

Receivers check that the sending IP's PTR resolves forward back to the
same IP, and a generic `vps-af4e71d9.vps.ovh.us` is read as a spam signal.
OVH will not accept a reverse that does not forward-confirm, which is why
the A record in step 1 comes first.

Set `15.204.235.103` → `mail.mccluster.org` from the OVH side.

## Step 3 — Open outbound port 25

OVH blocks it by default on new VPS instances. This is a **support
request**, not a setting on the box, and it is the longest-lead item
here — start it before anything else if you can.

## Step 4 — Build the server

```sh
scp scripts/mail/bootstrap-mail-server.sh root@15.204.235.103:/tmp/
ssh root@15.204.235.103 'bash /tmp/bootstrap-mail-server.sh'
```

It refuses to run if step 1 has not landed, warns loudly about steps 2
and 3, and prints two things at the end:

- the **DKIM TXT record** to add in Cloudflare;
- the **SMTP password** for Supabase, shown **once**. Only a hash is kept
  on the server, so losing it means re-running the script for a new one.

## Step 5 — Verify

```sh
ssh root@15.204.235.103 'bash /tmp/verify-mail.sh'
```

Run it **on the VPS** — the port 25 and open-relay checks are about that
host, and the script says so rather than guessing when run elsewhere.

It must print **Ready**. A partial pass is not a pass.

## Step 6 — One real message, by hand

Before anything automated depends on it, send one message to a Gmail
address and confirm it lands in the **inbox**, not spam. Open the
message, `Show original`, and check all three say `PASS`:

```
SPF: PASS   DKIM: PASS   DMARC: PASS
```

## Step 7 — Cut Supabase over

Authentication → Emails → SMTP Settings:

| Field | Value |
|---|---|
| Host | `mail.mccluster.org` |
| Port | `587` |
| Username | `supabase@mccluster.org` |
| Password | *(from step 4)* |
| Sender email | `matthew@mccluster.org` |
| Sender name | Matthew McCluster |

Then raise **Authentication → Rate Limits → emails sent**. It is pinned
low because of the built-in sender; that is the limit that caused the
outage on 2026-09-22.

---

## Warming up

A new IP has no reputation. Roughly 9 signups a day is low volume, which
cuts both ways: Gmail leans more on *domain* reputation than IP for small
senders, so clean authentication carries most of the weight — but there is
also never enough volume to build much IP reputation either way.

Order things so the low-stakes mail goes first:

1. **Signup confirmations only**, for about a week. Watch that people are
   actually confirming — a confirmation rate that falls off a cliff means
   spam-foldering, and it is the only signal you get.
2. **Then the fan list.** Marketing mail to a cold IP is the riskier of
   the two, and by then the domain has a delivery history.

## Rolling back

Google Workspace stays authorised in SPF throughout, so the way back is
one screen: put Workspace's SMTP details into the same Supabase settings
and signups recover immediately. Nothing about this server has to be torn
down first.

## Keeping it alive

- Certificate renews via certbot; the deploy hook reloads Postfix. An
  expired certificate means every receiver refuses STARTTLS.
- Check `mail.log` for deferrals, and the queue with `postqueue -p`.
- `verify-mail.sh` after any DNS change, always.
