# Own everything — the setup guide

Written 2026-09-22, while 38 signups an hour were bouncing off a mail
quota. It is in priority order, not ambition order.

---

# 0. RIGHT NOW: stop losing customers

**The situation.** In the 04:00 hour, 38 signup attempts were refused
with `over_email_send_rate_limit` and 2 got through. Supabase is sending
confirmation emails through its own built-in sender, which is rate
limited to roughly a couple an hour and is explicitly not for production.
Every refusal is a person who wanted an account and did not get one.

**The self-hosted mail server does not fix this today.** Outbound port 25
is still blocked on the VPS and that is an OVH support request with a
lead time measured in days. Nothing in this section is a retreat from
owning your own mail — it is scaffolding that comes down the moment the
real thing is ready.

Pick one. **A is the right answer.**

### A. Custom SMTP through the Workspace you already pay for — 10 minutes

Supabase → **Authentication → Emails → SMTP Settings → Enable Custom SMTP**

| Field | Value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | `matthew@mccluster.org` |
| Password | a Google **App Password**, not your login password |
| Sender email | `matthew@mccluster.org` |
| Sender name | Matthew McCluster |

App password: Google Account → Security → 2-Step Verification → App
passwords. Workspace gives ~2,000 recipients/day. You are sending nine.

Then **Authentication → Rate Limits → emails sent** — raise it. It is
pinned low *because* of the built-in sender.

Your SPF already contains `include:_spf.google.com`, so this passes
authentication immediately with no DNS change at all.

### B. Turn off email confirmation — 30 seconds, and it has a real cost

**Authentication → Providers → Email → Confirm email: OFF**

Signups stop sending mail entirely, so nothing can be rate limited.
Instant, free, zero setup.

What it costs, stated plainly:

- Anyone can register using an address they do not own.
- **It silently breaks the mailing-list consent guarantee.** The
  `fan_list_bridge` only enrols a listener whose `email_confirmed_at` is
  set, because with confirmation ON that means they opened the mail.
  With autoconfirm ON, Supabase sets that field for everybody, so the
  check stops meaning anything and unconfirmed addresses would flow onto
  the list. If you use this lever, treat the list as frozen until
  confirmation is back on.

Use B only if you cannot do A in the next ten minutes.

### The two people already stranded

`keananscustoms@gmail.com` (Sept 20) and `vinnce97@gmail.com` (Sept 19)
signed up, never got the mail, never signed in. Once sending works, their
confirmations can be re-sent. They did nothing wrong.

---

# 1. Your own mail server

Already written: `scripts/mail/`. Full detail in
`docs/control-plane/SELF-HOSTED-MAIL.md`. Summary of the order, because
the order is what people get wrong:

1. **Open the OVH support request for outbound port 25.** Longest lead
   item, blocks everything, start it first. Without it Postfix answers
   `250 OK` and delivers nothing — which looks exactly like success.
2. Cloudflare: `A  mail → 15.204.235.103`, **grey cloud**.
3. Reverse DNS `15.204.235.103 → mail.mccluster.org`, OVH side. Must come
   after step 2 — OVH refuses a reverse that does not forward-confirm.
4. `bootstrap-mail-server.sh` — sending.
5. Add the DKIM record it prints. Add `ip4:15.204.235.103` to SPF,
   keeping every existing include.
6. `bootstrap-mailbox.sh` — receiving.
7. `imapsync` the Workspace archive across **before** touching MX.
8. `MAIL_MODE=full verify-mail.sh` must say **Ready**.
9. Flip MX. Keep Workspace alive a fortnight.

---

# 2. Minting addresses for clients

This is the first thing on your list that **is not built yet**, and it is
a genuine extension rather than a config change.

What exists handles one domain and one mailbox, in a flat file. Selling
mailboxes needs:

- **Virtual domains and users in Postgres**, not `/etc/dovecot/private/users`.
  Postfix and Dovecot both read from SQL natively. You already run
  Postgres (Supabase), so the tables belong there:
  `mail_domains`, `mail_users`, `mail_aliases`.
- **Per-domain DKIM keys.** Each client domain signs with its own key, so
  one client's reputation cannot damage another's.
- **Per-client DNS** they must add: MX, SPF, DKIM, DMARC, pointed at your
  server. This is the part clients get wrong and will call you about.
- **Quotas**, or one client fills the disk for everybody.
- **A provisioning API** so minting an address is a row, not an SSH session.

**What this makes you:** an email hosting provider. Your IP's reputation
becomes shared across every client. One client sending spam gets
`mail.mccluster.org` blocklisted and **your own** signup confirmations
stop landing. That is not a reason not to do it — it is a reason to build
abuse controls and per-domain rate limits in from the start, not after.

Ballpark: a day's work on top of what exists.

---

# 3. Separate VPSes for clients

OVH's API provisions VPSes, and this session already reads it (that is how
we found your box's IP, reverse DNS and backup rotation). So this is
automatable: order, wait for install, set reverse DNS, push a bootstrap.

Be aware of what you are signing up for: you become the support desk. When
a client's box is down at 2am, that is yours. Price it accordingly, and
keep client boxes strictly separate from the one running McCluster —
`15.204.235.103` holds your mail, your API and your DNS. No client gets a
shell on it.

---

# 4. Wholesaling domains — the honest version

There are two ways, and only one is realistic now.

**ICANN accreditation.** ~$4,000/year plus per-domain fees, insurance,
escrow, and technical compliance. This is how you become a registrar. It
is not where you start.

**A reseller account** — what you actually want. You get wholesale pricing
and an API, and the registrar handles accreditation, escrow and ICANN.
Options: **OVH** (you are already a customer, and it keeps one vendor),
Namecheap, Tucows/OpenSRS, ResellerClub.

Margins are thin — a few dollars a domain. Domains are not the business;
they are the hook that makes the hosting and email sticky. Price the
bundle, not the domain.

**Before you sell a single one:** reselling domains and hosting means
handling other people's money and personal data. You need terms of
service, an acceptable-use policy, a privacy notice covering client data
(the one at `privacy.html` covers listeners, not customers), and a plan
for what happens to their domains if you stop. Get that in place while
the technical work is happening, not after the first customer.

---

# The order I would actually do it in

1. **Today:** section 0A. Ten minutes, stops the bleeding.
2. **Today:** open the OVH port 25 ticket. Costs nothing, unblocks everything.
3. **This week:** your own mail, sections 1. Prove it with your own mail
   before anyone else's depends on it.
4. **Then:** multi-tenant mail (2). This is the one that earns.
5. **Then:** client VPS (3) and reseller account (4), which are business
   setup more than engineering.

Do not do 2–4 before 1 works. Selling email hosting on an IP whose
deliverability you have not yet proven is selling something you do not
have.
