# Domains: where this settled, and what's still true

**Status (2026-07-30, owner's call):** the multi-subdomain split is **off**.
One property, one repo. The album-at-root experiment was built, verified, and
then reverted the same day: the landing page opens on the emblem, the record
lives at `album.html` behind the Music tab, and the album keeps its name,
**I AM HERE**.

What's actually planned instead:

1. **Rename the host** `here.mccluster.org` → `matthew.mccluster.org`.
2. **The apex reaches the site too:** `mccluster.org` → redirect to the
   subdomain (or serve it directly, depending on host).
3. **Hosting likely moves to Cloudflare Pages**: free at this size, and it
   can hold multiple custom domains on one project, which GitHub Pages cannot
   (one `CNAME`, one host, no redirects, no headers).

## Status of the rename (2026-08-17)

**Step 2 is done in the repo. Steps 1, 3 and 4 are the owner's, and step 1
has to happen first.** The repo now says `matthew.mccluster.org`
everywhere — `CNAME`, every canonical and `og:url`, all JSON-LD, the
sitemap, `robots.txt`, `checkout/index.ts`, the native shell origin, the
platform env examples and the Cloudflare worker origin allowlist. 591
references across 96 files.

**Do not merge this to `main` before the DNS record resolves.** GitHub
Pages takes its single host from `CNAME`; the moment it says a name that
does not resolve, the old name stops being served and the new one cannot
be reached yet. That is the site dark, for as long as it takes DNS to
propagate. The full ordered runbook is in
[`docs/domain-cutover.md`](../domain-cutover.md).

## The rename, sequenced (do not reorder)

GitHub Pages serves whichever single host is in `CNAME`. Flip it before DNS
exists and the site goes dark. The safe order:

1. DNS first: create `matthew` CNAME record → `mcclusterishere.github.io`
   (owner does this at the DNS provider; moving DNS to Cloudflare first is
   fine and enables step 4).
2. Repo second: change `CNAME` to `matthew.mccluster.org` and sweep the
   absolute URLs: canonicals, `og:url`, JSON-LD, `sitemap.xml`,
   `robots.txt`'s sitemap line, `supabase/functions/checkout/index.ts`
   (`const SITE`) and the Supabase Auth redirect allowlist. The last two are
   the ones that fail quietly — sign-in links and payment returns break
   without a single error on the page. **Done in the repo; the Supabase
   dashboard half is still the owner's.**
3. Keep the old name alive: `here.mccluster.org` must redirect to
   `matthew.mccluster.org`; printed QR codes on garment labels and every
   link already shared point at it. GitHub Pages cannot redirect a host it no
   longer serves; a Cloudflare redirect rule can, and so can a second tiny
   Pages repo — the payload for that is in [`redirects/`](../../redirects/).
4. Apex: `mccluster.org/*` → `matthew.mccluster.org/$1` redirect rule
   (Cloudflare free tier), or attach both domains to one Cloudflare Pages
   project if hosting has moved by then. Note the apex is currently served
   by WordPress.com, not GitHub, so this is a separate decision from the
   subdomain.

## Still true, for whenever pieces spin out (member pages, the closet)

These constraints were mapped during the split work and survive it:

- **Sessions are `localStorage`** (`js/backend.js:71` `mccdb_session`) and do
  not cross origins. `js/backend.js:293` picks the cloud driver purely on
  that key's presence, so on any second origin a signed-in customer looks
  signed out: the buy gate (`js/counter.js:176`) re-prompts and can mint a
  duplicate account; the owner desks lock out. Fix before any split: an
  HTTP-only cookie on `.mccluster.org` set by an edge function, specced in
  `docs/shared-accounts-architecture.md`. Pages (GitHub or Cloudflare static)
  cannot set cookies; an edge function can.
- **`checkout/index.ts` hardcodes the return host.** Any second selling
  origin needs it request-derived and allowlisted, never echoed unchecked.
- **Member pages** (`name.mccluster.org` per McCluster Corp member) are the
  realistic future driver here. When that day comes: one wildcard DNS record,
  one small app that reads the subdomain and pulls the member's row from
  Supabase, not a static page per person. Member *email*
  (`name@mccluster.org`) is a separate system entirely (an email provider on
  the domain) and needs none of this.
