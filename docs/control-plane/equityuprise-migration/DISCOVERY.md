# equityuprise.com: discovery (measured 2026-11-25, 7:22 PM ET)

Phase 1 of moving equityuprise.com off WordPress.com and onto Cloudflare. Read only: nothing at the registrar,
WordPress.com, Cloudflare or DNS was changed. Lookups used public DNS over HTTPS (dns.google) and Verisign RDAP,
because the build box's own resolver answers every name with a placeholder address.

## Registration

| Field | Value |
| --- | --- |
| Registrar | Automattic Inc. (WordPress.com), IANA ID 1531 |
| Registered | 2026-01-31 11:18 AM ET |
| Expires | 2027-01-31 11:18 AM ET |
| Status | clientTransferProhibited (the normal registrar lock) |
| DNSSEC | not signed |

## DNS (authoritative: ns1/ns2/ns3.wordpress.com)

| Name | Type | Value |
| --- | --- | --- |
| equityuprise.com | NS | ns1.wordpress.com, ns2.wordpress.com, ns3.wordpress.com |
| equityuprise.com | SOA | ns1.wordpress.com hostmaster.wordpress.com 2026013103 |
| equityuprise.com | A | 192.0.78.24, 192.0.78.25 (WordPress.com) |
| equityuprise.com | AAAA | none |
| www.equityuprise.com | CNAME | equityuprise.com |
| equityuprise.com | MX | **none** |
| equityuprise.com | TXT (SPF, verification) | **none** |
| _dmarc.equityuprise.com | TXT | none (NXDOMAIN) |
| DKIM selectors tried (google, default, selector1/2, k1/k2, s1/s2, mail, dkim, zoho, resend, mailchimp, sendgrid, wpcom, titan) | TXT/CNAME | none |
| CAA | | none |
| Subdomains tried (mail, app, api, blog, shop, store, members, portal, cdn, dev, staging, email, webmail, autodiscover, smtp, ftp, go, links, fellows, apply, cohort, join, calendar, docs, admin, login) | A/CNAME | none |

**Email: none.** The domain receives and sends no mail today, so a migration cannot break mail. (By contrast,
mccluster.org, already on Cloudflare, has Google Workspace MX plus SPF entries for Google, Titan and WP Cloud; that
zone is not touched here.)

## Hosting

- WordPress.com hosted (not self hosted): `server: nginx`, `host-header: WordPress.com`, a8c CDN headers.
- `https://equityuprise.com/*` answers **301 to `https://equityuprisedotcom.wordpress.com/`**, so the custom domain
  is not even the site's primary address.
- The site (blog ID 252239492) is in **Coming Soon** mode, titled "Site Title", `robots.txt` Disallow all,
  `noindex, nofollow`. Visitors see WordPress.com's "A bright idea, coming soon" page (screenshots/before-*).
- A second, older WordPress.com site exists: `equityuprise.wordpress.com` (blog ID 249240825, created 2025-10-13),
  also Coming Soon and also only default content.

## Public content (both sites)

| Item | Count | Content |
| --- | --- | --- |
| Pages | 1 | WordPress's default "About" sample page (2026-01-31) |
| Posts | 1 | WordPress's default "Hello World!" (2026-01-31) |
| Categories | 1 | Uncategorized |
| Tags, comments | 0 | |
| Media, users | not public (401) | front end shows only WordPress.com stock images |
| Forms | none on the front end | |
| Plugins visible | WordPress.com platform only (Jetpack mu-plugin, Gutenberg core); no third party plugins | |
| Members-only areas | none visible | |

There is no Equity Uprise content on WordPress to migrate. The real Equity Uprise product already lives in this
repository (the World, cohorts, onboarding, the eu_platform_* tenant tables in production). The export of what
exists is kept on the build box at `/workspace/equityuprise-export/` (REST JSON and HTML) for the record.

## Cloudflare readiness

- The build box has no Cloudflare login: `wrangler whoami` says not authenticated; no CLOUDFLARE_* or CF_* variables.
- A Cloudflare account exists: mccluster.org is on Cloudflare nameservers (malcolm, sarah.ns.cloudflare.com) and
  Worker `mccluster` (wrangler.toml, workers/mccluster/wrangler.toml) serves it by host.
- equityuprise.com is **not** a zone in that account yet (its nameservers are WordPress.com's).
- matthew.mccluster.org is a DNS-only CNAME to GitHub Pages (mcclusterishere.github.io).
