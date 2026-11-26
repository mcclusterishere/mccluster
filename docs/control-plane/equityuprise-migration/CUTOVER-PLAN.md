# equityuprise.com cutover plan (needs Matthew's go-ahead at every step marked OWNER)

Nothing below has been done. Expected downtime: **zero**. The site today is a WordPress.com Coming Soon
placeholder with no mail, so the worst case during the switch is a few minutes of the placeholder or a certificate
warning on a page nobody depends on.

## 0. Before anything (no live change)

1. OWNER: approve this plan and pick the interim answer for equityuprise.com between steps 3 and 6:
   - **A (recommended, matches the record):** a door. Every path answers 301 to the same path on
     https://mccluster.org until stage F. Uses Worker `mccluster` and `proposed/doors-f0.json`.
   - **B:** serve the staged front door (staging/site) from a small Cloudflare Pages project until stage F.
2. Merge-ready PR for the chosen option (doors entries applied with `node tools/build-site-hosts.mjs --write`, the
   pinned header measurements updated in the same change). Merge only on OWNER approval.

## 1. Add the zone in Cloudflare (OWNER, about 5 minutes, no effect on visitors)

Cloudflare dashboard, the account that holds mccluster.org: Add a site, `equityuprise.com`, Free plan.
Cloudflare's scan should find the records below; make sure the zone holds exactly these, **DNS only (grey cloud)**,
so the zone answers the same as WordPress.com does today:

| Type | Name | Content | Proxy | TTL |
| --- | --- | --- | --- | --- |
| A | equityuprise.com | 192.0.78.24 | DNS only | Auto |
| A | equityuprise.com | 192.0.78.25 | DNS only | Auto |
| CNAME | www | equityuprise.com | DNS only | Auto |

There are **no MX, SPF, DKIM, DMARC or other TXT records to recreate** (DISCOVERY.md). Add these two so nobody can
send mail as the domain while it has none (safe, and removable the day mail is set up):

| Type | Name | Content |
| --- | --- | --- |
| TXT | equityuprise.com | `v=spf1 -all` |
| TXT | _dmarc | `v=DMARC1; p=reject; adkim=s; aspf=s` |

Note the two Cloudflare nameservers it assigns (for example `xxx.ns.cloudflare.com`). Then create a scoped API token
for the build box only if you want it to verify and do step 4 for you: Zone DNS Edit and Workers Routes Edit,
limited to equityuprise.com. Never paste it in chat; put it in the vault.

## 2. Point the nameservers at Cloudflare (OWNER, WordPress.com sign-in)

WordPress.com: Upgrades, Domains, equityuprise.com, Name servers and DNS, turn off "Use WordPress.com name servers",
enter the two Cloudflare nameservers, save. DNSSEC is off today, so there is no DS record to remove first.
The registration stays at WordPress.com (renews 2027-01-31). Moving the registration to Cloudflare Registrar is
optional and separate (unlock and an authorization code from the same screen).

Propagation: the old SOA minimum is 300 s; NS caches at the .com level can hold up to 48 h. Because step 1 made both
providers answer identically, visitors see no difference during that window. The build box checks the switch with
`dns.google/resolve?name=equityuprise.com&type=NS` and Cloudflare marks the zone Active.

## 3. Turn on the new answer (OWNER go-ahead; one change, instantly reversible)

Option A:
1. Worker `mccluster`, Settings, Domains and Routes: add routes `equityuprise.com/*` and `www.equityuprise.com/*`
   (zone equityuprise.com). Requires the merged doors PR from step 0 to be deployed first.
2. Replace the two A records with proxied placeholders so traffic reaches the Worker:
   `AAAA equityuprise.com 100::` (Proxied) and `CNAME www equityuprise.com` (Proxied); delete the 192.0.78.x A records.
3. SSL/TLS mode Full (strict); Always Use HTTPS on. Cloudflare issues the edge certificate within minutes of the
   records being proxied.

Option B: create a Pages project from the staged site, add equityuprise.com and www as custom domains (Cloudflare
creates the proxied records), then delete the 192.0.78.x A records.

Check: `curl -sI https://equityuprise.com/onboard.html?x=1` answers 301 to `https://mccluster.org/onboard.html?x=1`
(A) or 200 with the staged page (B); www answers the same.

## 4. Clean up WordPress.com (OWNER, any time after step 3 is stable for a week)

Keep the domain registration. Optionally delete or keep private the two Coming Soon sites
(equityuprisedotcom.wordpress.com and equityuprise.wordpress.com) and cancel any paid plan that is only hosting
them. Nothing on them needs exporting (one default About page and one Hello World post each), but a Tools, Export,
Export All file can be kept for the record before deleting.

## 5. Stage F: equityuprise.com becomes the platform (later, its own approval)

As SPEC-PLATFORM 2.10 and the record's `edge.stages` F say: F1 the new platform serves everything (old one still
serving), F2 canonicals, sitemaps and structured data move, F3 mccluster.org answers 301s for platform pages and
keeps /company and /news/ as McCluster Corp's tenant. Provider lists to update at F1, all OWNER settings:
Supabase Auth Site URL and redirect list, the API CORS list (generated), the analytics collector's first-party
hosts (generated), Google Search Console property for equityuprise.com, Stripe return URLs (generated returns
already follow the request). Sign-in asks once more on the new site (cross-site storage).

## Rollback

| From | Undo | Time |
| --- | --- | --- |
| Step 1 | delete the zone in Cloudflare | instant, no visitor effect |
| Step 2 | WordPress.com: turn "Use WordPress.com name servers" back on (its records were never deleted) | minutes to hours of propagation; both answers identical meanwhile |
| Step 3 | delete the Worker routes (A) or custom domains (B) and restore the two DNS-only A records 192.0.78.24/25 | under a minute |
| Stage F | flip `platform.origin` back and redeploy; routes off (SPEC-PLATFORM 4) | one deploy |

## What Matthew provides or approves

1. Approval of this plan and option A or B.
2. Cloudflare: his sign-in to add the zone (or a scoped token in the vault for the build box).
3. WordPress.com: his sign-in to change the nameservers. No WordPress content export is needed.
4. Later approvals: merging and deploying the doors PR, the Worker routes, and stage F.
