# Moving to Cloudflare

Three separate decisions get called "moving to Cloudflare". They are not
the same move and they do not carry the same risk.

| | Verdict | Why |
| --- | --- | --- |
| **DNS** → Cloudflare | **Do it.** | Free, faster, better tooling than WordPress.com. Unlocks the rest. |
| **Hosting** → Cloudflare Pages | Later, optional | Would replace the 79 redirect stubs in `redirects/` with one `_redirects` file. GitHub Pages works fine today. |
| **Database** → Cloudflare D1 | **No.** | D1 is SQLite with no row-level security, no auth, no PostgREST. Every wall in `supabase/migrations/` would have to be rebuilt by hand in application code. Keep Supabase. Cloudflare in front of Supabase is a normal, good setup. |

---

## The one thing that can actually go wrong

**`mccluster.org` receives email through Google Workspace.** Five MX
records. If they do not arrive intact on the other side, mail to this
domain stops — quietly, with senders getting bounces you never see.

That is the whole risk of this migration. Everything else is recoverable
in minutes.

So this is not a retype-nineteen-records job. `dns/mccluster.org.zone` in
this repo is the entire live zone in the BIND format Cloudflare's importer
reads. Upload the file; do not hand-enter records.

**And do not trust a capture you have not checked.** The first version of
that file was built by querying public DNS for record names guessed from
the SPF line, and it missed five records — both WordPress.com DKIM CNAMEs,
the Titan DKIM key, the domain-connect record, and the GitHub Pages
verification challenge. A resolver only answers questions you know to ask;
the registrar's control panel is the authority. The file was rebuilt
against that panel and every line now verifies:

```bash
python3 tools/verify-dns-zone.py     # 19 records checked, 0 mismatched
```

Run it before the cutover and again after. Cloudflare's own signup scan is
built the same fallible way the first draft was — check it against the
file rather than the other way round.

---

## The move

**1. Add the site to Cloudflare.** Free plan. It scans the existing zone
   on signup.

**2. Import the zone file instead of trusting the scan.**
   DNS → Records → **Import DNS records** → upload `dns/mccluster.org.zone`.
   Cloudflare's scan is good but not guaranteed complete; the file is
   what is actually there.

**3. Set every record to DNS-only (grey cloud) for the first pass.**
   Proxying (orange cloud) while GitHub Pages also terminates TLS can
   produce a redirect loop. Get it resolving plainly first. You can turn
   proxying on later, one record at a time.

**4. Check the record list against the file before you switch anything.**
   Count them: 2 A, 5 MX, 7 TXT, 5 CNAME. **Nineteen.**

**5. Change the nameservers at WordPress.com** to the two Cloudflare
   gives you. This is the only irreversible-feeling step, and it is
   reversible — the old nameservers are `ns1.wordpress.com`,
   `ns2.wordpress.com`, `ns3.wordpress.com`. Write them down.

**6. Wait.** Usually under an hour. Up to 24.

**7. Verify, in this order:**
   - `matthew.mccluster.org` loads the site
   - `here.mccluster.org` loads the site
   - `mccluster.org` still loads the WordPress site
   - **send yourself an email at the domain, and reply to it**

Step 7's last line is the one that matters. Do not call the migration
done until a real message has gone both ways.

---

## Rollback

Put the WordPress.com nameservers back:

```
ns1.wordpress.com
ns2.wordpress.com
ns3.wordpress.com
```

The zone still exists at WordPress.com until you delete it there, so
reverting the nameservers reverts everything. Do not delete the
WordPress.com DNS zone for at least a week after a successful cutover.

---

## What the zone actually contains

Captured live, 2026-08-18:

| Host | Type | Points at | What it is |
| --- | --- | --- | --- |
| `@` | A ×2 | 192.0.78.174, .194 | The WordPress.com site at the apex |
| `@` | MX ×5 | `*.aspmx.l.google.com` | **Google Workspace email** |
| `@` | TXT | `v=spf1 …google …titan …wpcloud` | Who may send as this domain |
| `@` | TXT ×2 | `google-site-verification=…` | Search Console verification |
| `_dmarc` | TXT | `v=DMARC1;p=none` | DMARC, in monitor mode |
| `titan1._domainkey` | TXT | `v=DKIM1; k=rsa; p=…` | **DKIM for Titan** |
| `wpcloud1._domainkey` | CNAME | `…wpcloud.com` | DKIM for WordPress.com |
| `wpcloud2._domainkey` | CNAME | `…wpcloud.com` | DKIM for WordPress.com |
| `_github-pages-challenge-mcclusterishere.here` | TXT | `adf7dc15…` | GitHub Pages verification, **for `here` only** |
| `_domainconnect` | TXT | `public-api.wordpress.com/…` | WordPress.com's own management hook |
| `www` | CNAME | `mccluster.org` | Follows the apex |
| `matthew` | CNAME | `mcclusterishere.github.io` | **The site.** Canonical. |
| `here` | CNAME | `mcclusterishere.github.io` | The old name, kept alive |

---

## Three things found while capturing this

**DKIM exists, but not for the system your mail actually arrives
through.** Three senders are authorised by SPF — Google, Titan, and
WPCloud — and two of them are signed: `titan1._domainkey` publishes a
Titan key, and `wpcloud1/2._domainkey` delegate to WordPress.com. The MX
records point at **Google**, and there is no Google DKIM selector
published. So the sender most likely to be yours is the one signing
nothing. Fix separately: turn DKIM on in the Google Workspace admin
console and publish the selector it gives you.

**GitHub Pages verification covers `here`, not `matthew`.** The only
challenge record is `_github-pages-challenge-mcclusterishere.here`, a
leftover from before the rename. Nothing is broken — both hostnames serve
fine — but `matthew.mccluster.org` has no takeover protection, meaning
another GitHub account could in principle claim that hostname if the
CNAME were ever left dangling. Adding one is a few clicks in the repo's
Pages settings.

**DMARC is `p=none`.** Monitor-only — it asks receivers to report, and to
do nothing. Fine as a starting point, and worth tightening to
`p=quarantine` once Google DKIM is on and you have looked at a few
reports. Do not tighten it before then: with Google unsigned, you would
be asking receivers to enforce a policy your own mail cannot satisfy.

---

## About the registration

The domain is **registered** at WordPress.com. Moving DNS does not move
that — you still renew there. Transferring the registration to Cloudflare
is a separate job, and ICANN blocks transfers for 60 days after any
registration or prior transfer. Check that date before planning around
it. There is no urgency: DNS at Cloudflare with registration elsewhere is
a completely normal arrangement.
