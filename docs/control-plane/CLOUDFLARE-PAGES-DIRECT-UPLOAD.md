# McCluster public website → Cloudflare Pages Direct Upload

Status: **staged cutover only**. The existing site stays on GitHub Pages until a full, reviewed Pages deployment is verified. The only new Pages project is **mccluster-web** (Direct Upload, no Git integration). Do not change DNS, repository visibility, or the canonical API Worker as part of staging.

## Authority and boundaries

| Surface | Current | Target |
| --- | --- | --- |
| `matthew.mccluster.org` personal website | GitHub Pages `gh-pages` | Cloudflare Pages `mccluster-web` |
| `api.mccluster.org` | Worker `mccluster` | **Unchanged** |
| `mccluster.org` company / World host | Existing Cloudflare rules / Worker `mccluster` | **Unchanged** |
| Supabase data plane | `zmnhbrjyhxzhkxmhkexs` | **Unchanged** |
| Source of truth | Public `mcclusterishere/mccluster` | Private repository, then optional OVH primary Git remote |
| Static release builder | `.github/workflows/deploy-pages.yml` | Independently operated, pinned OVH build/release runner |

**Production uploads must not be initiated by GitHub Actions.** Cloudflare Pages is a Direct Upload project: a private release runner hands Cloudflare a reviewed directory using a scoped token. GitHub may continue running test workflows temporarily but need not be in the publishing path.

## What the legacy public export really contained (October 19 audit)

The `gh-pages` tree contained 3,060 files / ~307 MB. Largest single file ~17.3 MB, within Cloudflare's Free asset limit (25 MiB and 20,000 files). Unfortunately the old publish workflow only removed some internals. It left `core/`, `platform/`, `native/`, `.mcp.json`, `dns/`, and other engineering source in the published tree. Those are **not** approved frontend assets.

This **does not prove a secret was leaked**. It proves the packaging boundary is insufficient. Changing GitHub visibility without fixing the published web artifact would not fix that problem.

## Stage a clean public-only release

1. Produce a complete, built **static public export** on a trusted machine. The existing `gh-pages` output can be used temporarily as an input to test parity, but `main` is never an acceptable input and must be refused.
2. Run `scripts/stage-cloudflare-pages.mjs`. It permits only known public routes/assets (including the album's `data/environments.json`), excludes Site 0 authoring geometry under `assets/3d/prim3-site0/`, refuses symlinks, scans **all** accepted text assets including large bundles for obvious key patterns, enforces Cloudflare file limits, and generates `mccluster-release.json` with the exact source SHA and a content-manifest hash.
3. Examine the operator-only exclusion report, automatically saved to `<output-directory>.excluded.json` **outside the public artifact**, compare critical public routes and ensure all required frontend assets are retained. The report is a sorted inventory of excluded paths and must never be uploaded. **The allowlist still needs human review** whenever new asset types or paths are added.
4. Test the package before any domain or repository settings change.

For an independently generated export, use the source commit it was built from:

```bash
SOURCE_SHA="$(git -C /srv/mccluster/source rev-parse HEAD)"
node /srv/mccluster/source/scripts/stage-cloudflare-pages.mjs \
  --input /srv/mccluster/releases/public-export \
  --output /srv/mccluster/releases/pages-dist-new \
  --commit "$SOURCE_SHA"
```

The output directory must be new/empty. Rebuild from the approved source if you need to retry staging. The public export should be produced by the *same published frontend build process* before its legacy `git push gh-pages` step; do not skip generated 3D assets, stamped URLs, sitemap validation or client UI smoke tests.

## Direct deploy from OVH or another controlled release machine

Supply the Cloudflare account identifier and a narrowly scoped **Cloudflare Pages: Edit** API token on the runner. Keep the token outside any web root, Git repository, artifact, or shell trace. Pin an audited Wrangler CLI version in the runner image and reference its executable using `WRANGLER_BIN`.

```bash
export PAGES_PUBLIC_EXPORT=/srv/mccluster/releases/public-export
export PAGES_RELEASE_DIR=/srv/mccluster/releases/pages-dist-NEW
export MC_SOURCE_SHA="$(git -C /srv/mccluster/source rev-parse HEAD)"
export CLOUDFLARE_ACCOUNT_ID="<account identifier>"
# CLOUDFLARE_API_TOKEN is supplied by a root-only secret injection mechanism,
# never typed in the command line, saved in shell history or committed to Git.
export WRANGLER_BIN=/usr/local/bin/wrangler
export PAGES_PROJECT_NAME=mccluster-web

bash /srv/mccluster/source/scripts/deploy-cloudflare-pages.sh
node /srv/mccluster/source/scripts/smoke-cloudflare-pages.mjs \
  --url https://mccluster-web.pages.dev --commit "$MC_SOURCE_SHA"
```

The project is created once, as a Direct Upload project whose **production branch is `main`**: `wrangler pages project create mccluster-web --production-branch=main`. The deploy script refuses to upload when the project is missing, because a release sent with `--branch=main` to a project whose production branch is something else becomes a preview deployment and `mccluster-web.pages.dev` never serves it.

Use `PAGES_STAGE_ONLY=1` to stage without uploading (with a separate empty release directory). There is no connected GitHub integration and no Pages custom domain yet. The script never calls GitHub.

## Acceptance before the domain cutover

- The deployed Pages release manifest reports the approved exact source SHA.
- Index, music/album (including `data/environments.json`), Equity Uprise social pages, Travel, frontend JS and media all load correctly, with phone and desktop browser tests.
- Direct GETs to `/.mcp.json`, `/core/src/*`, `/platform/config/*`, `/dns/*`, the internal schema inventory, and `/assets/3d/prim3-site0/*` return 403/404, not a source file or a successful SPA fallback.
- Sign-in, cross-domain handoff, Stripe returns and service-worker caching still behave correctly. **Do not** alter OAuth redirect allowlists until the canonical hostname actually changes (it is not changing in this cutover).
- Worker `mccluster` and Supabase remain their own separately verified release surfaces.
- DNS plan covers only `matthew.mccluster.org`, not `mccluster.org` or `api.mccluster.org`. Email MX, DKIM and SPF must remain untouched.
- Browser smoke passes on `mccluster-web.pages.dev` before adding `matthew.mccluster.org` as a custom domain and changing the relevant DNS record.
- Keep GitHub Pages enabled as a known-good rollback until after Cloudflare's custom-domain certificate, HTTPS, redirects and full frontend acceptance pass.

Only then change the `matthew` host's DNS/Pages domain assignment. For rollback, restore the previous GitHub Pages CNAME and verified GitHub Pages configuration; do **not** touch company or API hostnames.

## Make the source private *after* website cutover

GitHub Free's Pages hosting for repositories requires public visibility; making `mcclusterishere/mccluster` private prematurely can unpublish the current site. The repository owner must perform the visibility change from GitHub Settings → General → Danger Zone → Change repository visibility, or migrate primary Git to an access-controlled OVH server once a release process and backups are proven.

Private source protects newly fetched Git access, **not** copies already made while public, and not JS/JSON intentionally shipped to website visitors. Audit previous commits for actual secrets and revoke/rotate exposed credentials where necessary. Preserve encrypted backups, restricted deploy keys, and tested rollback before making OVH the only Git authority. A private GitHub repository as an offsite backup is optional and is not a hosting dependency.

## Release guards

- Do not copy `main` wholesale to Pages. Do not deploy `workers/`, `supabase/`, `core/`, `platform/`, `native/`, `PRIM3/`, `dns/`, `*.sql`, secrets, or authoring instructions.
- `scripts/test/cloudflare-pages-stage.test.mjs` and `.github/workflows/cloudflare-pages-export-ci.yml` test that private paths cannot pass through staging; the CI has **no Cloudflare token** and performs **no upload**.
- No live DNS changes, Worker changes, new backend or additional database are permitted as part of this release.
