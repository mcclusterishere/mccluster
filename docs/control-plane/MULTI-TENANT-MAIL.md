# Selling mailboxes

The single-tenant server keeps one mailbox in a flat file. That is fine
for one address and useless for selling them: every new client would be
an SSH session, and there would be no record of who owns what.

So Postfix and Dovecot now read their lookup tables straight out of
Postgres. **Minting an address is a row.**

## What the mail server can see

Three views — `mail_v_domains`, `mail_v_users`, `mail_v_aliases` — and
nothing else. It connects as a dedicated `mailserver` role with `SELECT`
on those and no rights on any base table.

That is deliberate. A mail server is internet-facing and occasionally has
bad days; it does not get to read `auth.users` or the listener records.
The browser roles are locked out the other way: `anon` and
`authenticated` have **no** access to those views at all, because
`mail_v_users` carries `password_hash`.

## Creating the role (once)

Not in the migration, because a migration in Git must not contain a
password:

```sql
create role mailserver with login password '<generate a long one>';
grant usage on schema public to mailserver;
grant select on public.mail_v_domains, public.mail_v_users, public.mail_v_aliases
  to mailserver;
```

Then put that password into the four config files in
`scripts/mail/multi-tenant/`, replacing `REPLACE_DB_PASSWORD`, and set
`REPLACE_DB_HOST` to the Supabase **pooler** host — per-connection
overhead matters when every IMAP login is a query.

## Minting

```sql
select public.mail_mint_mailbox('clientco.com', 'sales', 'a long passphrase');
-- sales@clientco.com
```

The function is the only way in, so the rules cannot be skipped by
writing the row directly:

- **Admin only.** Verified against production: the same call refuses
  with *"only the house admin may mint mailboxes"* when the caller is not.
- **Minimum 12 characters**, bcrypt via pgcrypto, never stored in clear.
- **Per-domain ceiling.** `max_mailboxes` is enforced here, so a client
  cannot mint until the disk is full.
- **`email` and `maildir` are derived by a trigger**, not supplied. The
  browser cannot claim `sales@someone-elses-domain.com`, and
  `local_part` is shape-checked so `../../etc` cannot become a path.

Reset a password with `mail_set_password(email, password)`.

## Per-domain DKIM

Each domain gets its own selector (`mail_domains.dkim_selector`) and its
own key. **Shared keys mean one client's spam complaint drags every other
client's reputation down with it** — including yours, on the IP your own
signup confirmations ride.

For each new domain: generate a key into
`/etc/opendkim/keys/<domain>/`, add it to `KeyTable` and `SigningTable`,
and give the client the TXT record to publish.

## What the client must add to their DNS

They will get this wrong and call you. Keep it as a copy-paste block:

| Type | Name | Value |
|---|---|---|
| MX | `@` | `mail.mccluster.org` (priority 10) |
| TXT | `@` | `v=spf1 ip4:15.204.235.103 ~all` |
| TXT | `mail._domainkey` | *(from their key)* |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@mccluster.org` |

## The failure mode, stated because it is the cost of this design

Authentication and recipient validation now depend on Postgres being
reachable from the mail host. If it is not:

- IMAP logins fail;
- Postfix **defers** incoming mail rather than rejecting it — senders
  retry for days, so an outage delays mail instead of losing it.

That is the right trade, but it is a trade. Keep an eye on it.

## Before you sell one

Your IP's reputation becomes shared across every client. One of them
sending spam gets `mail.mccluster.org` blocklisted and **your own signup
confirmations stop landing** — the exact failure you spent 22 September
fixing. Build the abuse controls before the first client, not after:

- per-domain outbound rate limits in Postfix;
- a bounce and complaint rate you actually watch;
- an acceptable-use policy you can point at when you suspend someone.
