# The house mail server

McCluster sends and receives its own mail. No Resend, no Google
Workspace, no per-message bill, and nobody else holding the mailbox.

This is the runbook. It is in order on purpose: several steps fail if the
one before has not landed, and two of them fail *silently*, which is the
whole difficulty with running mail.

---

## Two halves, built in two passes

| | Script | What it does |
|---|---|---|
| **Sending** | `bootstrap-mail-server.sh` | Postfix on 587 → delivers outward on 25, signed by OpenDKIM |
| **Receiving** | `bootstrap-mailbox.sh` | Postfix accepts on 25 → Dovecot stores it → IMAP on 993, rspamd filters |

Build sending first and let it prove itself. Receiving is the half where a
mistake costs mail that does not come back, and there is no reason to take
both risks on the same day.

`verify-mail.sh` needs to know which half exists:

```sh
MAIL_MODE=send-only ./verify-mail.sh   # sending only; MX must stay elsewhere
MAIL_MODE=full      ./verify-mail.sh   # both; MX should point here
```

It defaults to `send-only`, because claiming a host receives mail when it
does not is how mail disappears.

---

## What is genuinely yours, and what cannot be

Worth being straight about, since the point of this is independence:

**Yours after this:** the sending path, the mailbox, the spam filtering,
the storage, the backups. No third party sees the mail or can close the
account.

**Not yours, and not fixable by building more:**

- **The registrar.** `mccluster.org` is a lease from ICANN's system.
  Nobody self-hosts that.
- **Whether Gmail trusts you.** Receivers decide what lands in the inbox.
  You can satisfy every requirement — SPF, DKIM, DMARC, forward-confirmed
  reverse DNS, a clean complaint rate — and satisfying them is exactly
  what this build does. You cannot overrule the verdict.
- **DNS, currently.** `mccluster.org` is on Cloudflare. That is a real
  dependency and it *is* removable: authoritative nameservers on this VPS.
  It is also how you lose the entire domain if the box goes down, so most
  people who run their own mail still do not run their own DNS. Worth
  doing deliberately, later, and not at the same time as this.

**Not yours, still:** the VPS is OVH's hardware. Owning the software stack
on rented metal is the normal meaning of self-hosting.

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

## Taking over the mailbox

This is the irreversible half. Read it before touching the MX.

### The failure to avoid

Flip the MX first and new mail starts arriving here while **eighteen years
of archive stays stranded** inside the Workspace account you are trying to
stop paying for. Cancel that account and the archive goes with it. So the
mail moves **first**, and the MX moves last.

### Step A — build the receiving half

```sh
scp scripts/mail/bootstrap-mailbox.sh scripts/mail/backup-mail.sh root@15.204.235.103:/tmp/
ssh root@15.204.235.103 'bash /tmp/bootstrap-mailbox.sh'
```

It prints an IMAP password, once. That is now **also** the SMTP password —
Dovecot owns authentication for both, so there is one credential instead of
two stores that drift. **Supabase's SMTP password changes with it.**

### Step B — copy the archive across, while both still work

`imapsync` reads Google and writes here. Nothing is deleted from Google,
so this is safe to run repeatedly and safe to abandon.

```sh
imapsync \
  --host1 imap.gmail.com --port1 993 --ssl1 \
  --user1 matthew@mccluster.org --password1 '<google app password>' \
  --host2 mail.mccluster.org --port2 993 --ssl2 \
  --user2 matthew@mccluster.org --password2 '<from step A>'
```

Run it **twice**: once for the bulk, again after the MX flip to sweep up
whatever landed at Google in between. The second pass is quick and it is
the one people skip.

### Step C — prove it receives, before anything depends on it

With the MX still on Google, send a message straight past DNS to the new
box and confirm it lands:

```sh
swaks --server mail.mccluster.org --to matthew@mccluster.org \
      --from you@somewhere-else.com --tls
```

Then `MAIL_MODE=full ./verify-mail.sh` on the VPS. It must say **Ready**.

### Step D — flip the MX

In Cloudflare, replace the five Google MX records with one:

| Type | Name | Priority | Value |
|---|---|---|---|
| MX | `@` | 10 | `mail.mccluster.org` |

Grey cloud. Mail cannot be proxied.

Mail already in flight goes to Google for a few hours while DNS caches
expire — that is what step B's second pass collects. **Do not cancel
Workspace for at least a fortnight**, so there is somewhere to look if
something was missed.

### Step E — keep the backups honest

`bootstrap-mailbox.sh` installs a 6-hourly backup with a week of
generations, and each one is read back before the oldest is rotated out.

**Set an offsite target.** OVH's own backup keeps a single restore point,
and a copy on the same disk survives a mistake but not the disk:

```sh
systemctl edit mccluster-mail-backup.service
# [Service]
# Environment=BACKUP_REMOTE=<somewhere that is not this machine>
```

Until you do, the script says so in its output every run.

---

## Rolling back

**Sending:** Google Workspace stays authorised in SPF throughout, so the
way back is one screen in Supabase. Nothing has to be torn down.

**Receiving:** put the five Google MX records back. Mail resumes flowing
there within the TTL. Anything delivered here meanwhile is in the Maildir
and in the backups, and `imapsync` runs in the other direction to return
it. This is why Workspace stays alive for a fortnight after the flip.

## Keeping it alive

- Certificate renews via certbot; the deploy hook reloads Postfix. An
  expired certificate means every receiver refuses STARTTLS.
- Check `mail.log` for deferrals, and the queue with `postqueue -p`.
- `verify-mail.sh` after any DNS change, always.
