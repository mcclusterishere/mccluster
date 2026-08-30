# Moving to matthew.mccluster.org

The repo is ready. **Nothing has moved yet**, and nothing will until you do
step 1.

Read the warning below before anything else. The rest is a checklist.

---

## ⚠ The one way this goes wrong

**Do not merge this branch to `main` before the DNS record exists.**

GitHub Pages serves exactly one custom domain per repository, and it reads
that name from the `CNAME` file. This branch changes `CNAME` to
`matthew.mccluster.org`. The moment that lands on `main`:

- GitHub stops answering for `here.mccluster.org` — not with a redirect, with nothing.
- GitHub starts answering for `matthew.mccluster.org`, which **currently has no DNS record at all**, so nobody can reach it either.

That is the whole site dark, for however long it takes you to notice and
add the record. Do step 1 first and this never happens.

---

## Step 1 — DNS (you, at WordPress.com)

Your apex `mccluster.org` is served by WordPress.com, so that is where the
nameservers point and where the record goes.

1. Log in to WordPress.com → **Upgrades → Domains** (newer accounts:
   **Settings → Domains**).
2. Click **mccluster.org** → **DNS records**.
3. Add a record:

   | Field | Value |
   |---|---|
   | Type | `CNAME` |
   | Name / Host | `matthew` |
   | Points to / Target | `mcclusterishere.github.io` |
   | TTL | leave the default |

   Enter the name as just **`matthew`**, not the full
   `matthew.mccluster.org` — WordPress.com appends the domain for you, and
   typing the whole thing produces `matthew.mccluster.org.mccluster.org`.

4. Save, then wait. Check it with:

   ```
   dig +short matthew.mccluster.org
   ```

   You want to see `mcclusterishere.github.io` and some GitHub addresses.
   Usually minutes; allow up to an hour.

**Leave the existing `here` record exactly as it is.** It already points at
GitHub and step 4 depends on it still doing so.

## Step 2 — Merge, and let it deploy

Once `dig` answers, merge the branch. `deploy-pages.yml` stamps the assets
and mirrors to `gh-pages` as usual.

Then in this repo: **Settings → Pages**. It should show
`matthew.mccluster.org`. Wait for "Certificate issued" — a few minutes to
an hour — then tick **Enforce HTTPS**.

Until that certificate issues you may see a browser warning on
`https://`. That is normal and it resolves itself; don't panic and don't
change anything.

## Step 3 — Two settings outside the repo that break quietly

Neither of these throws an error. They just stop working.

**Supabase → Authentication → URL Configuration**
- **Site URL:** `https://matthew.mccluster.org`
- **Redirect URLs:** add `https://matthew.mccluster.org/**`

  Keep the old `here` entries for now; remove them in a month. Sign-in
  emails send a link back to the Site URL, so if this still says `here`,
  every magic link lands on the old host.

**Stripe → your payment links / webhook return URLs**, if any are hardcoded
to `here.mccluster.org`. The checkout function itself is already updated
(`supabase/functions/checkout/index.ts`), but redeploy it so the change
takes effect:

```
supabase functions deploy checkout
```

## Step 4 — Keep the old address alive

Everything already printed points at `here.mccluster.org`: the NFC card,
the QR codes on garment labels, business cards, links in the proclamation
citations, and every URL Google has indexed. Those have to keep working.

`redirects/` in this repo is a complete, ready-to-push second website that
does nothing but forward. 77 page stubs plus a catch-all that handles any
path — including pages added later.

1. Create a new empty GitHub repo, e.g. `mcclusterishere/here-forwarding`.
2. Copy **the contents** of `redirects/` into it (not the folder itself) and push.
3. That repo: **Settings → Pages → Source: main, / (root)**.
4. Its `CNAME` already says `here.mccluster.org`, so Pages claims the name.
   The DNS record you left alone in step 1 is what makes this work.
5. Wait for the certificate, tick **Enforce HTTPS**.

Regenerate it any time with `node tools/build-redirects.mjs`.

## Step 5 — Tell Google

1. **Search Console → add `matthew.mccluster.org`** as a property and verify it.
2. Use the **Change of Address** tool on the old `here.mccluster.org`
   property, pointing at the new one. This is the single most valuable
   thing in this document for keeping your rankings — it tells Google the
   move is deliberate and permanent.
3. Submit `https://matthew.mccluster.org/sitemap.xml`.
4. Request indexing on `matthew-mccluster.html` specifically.

Then update the profile links from `docs/seo-matthew-mccluster.md` §4 —
LinkedIn, Instagram, YouTube, TikTok, Muso.AI — to the new host.

---

## What the repo already did

591 references across 96 files, plus `CNAME`. Canonicals, `og:url`, all
JSON-LD `@id`s and URLs, `sitemap.xml`, `robots.txt`, the vCard, the
regenerated tap-card QR, every wall page's canonical, the checkout
function's `SITE`, the native shell's `ORIGIN`, the platform env examples
and the Cloudflare worker's allowed-origins list.

Verified after the sweep: zero old-host references remain outside
`docs/here-url-migration-map.csv`, which is deliberately left alone as a
historical record of the pre-rename URL structure — and which describes a
three-way property split that was called off on 2026-07-30. Read it as
history, not as a plan.

## What would be better than all of this

Move DNS to **Cloudflare** (free) and you get:

- A real **301** redirect rule for `here.mccluster.org/*` →
  `matthew.mccluster.org/$1`, replacing the entire `redirects/` repo with
  one rule. Cleaner for SEO than a meta refresh.
- The same for the apex: `mccluster.org/*` → `matthew.mccluster.org/$1`.
- The option of Cloudflare Pages, which — unlike GitHub Pages — holds
  several custom domains on one project, so this whole dance stops being
  necessary next time.

Not required. Worth an hour some weekend.

## Rolling it back

If something goes wrong before step 4 is done, the fastest fix is to put
`here.mccluster.org` back in `CNAME` on `main` and push. Pages will
reclaim the old host within a minute or two, because its DNS record never
moved. Then work out what went wrong without the clock running.
