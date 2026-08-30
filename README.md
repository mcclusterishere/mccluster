# HERE

**Have no fear, McCluster is here.**

The implementation source for **[matthew.mccluster.org](https://matthew.mccluster.org)** —
the album, the studio, and the civic platform behind
[Matthew McCluster](https://matthew.mccluster.org/matthew-mccluster.html) and
McCluster Corp.

> **Cutover pending.** The site is served at `here.mccluster.org` until the
> DNS record for `matthew` exists. The repo is already renamed throughout.
> **Do not merge the rename to `main` before that record resolves** — Pages
> serves one host, read from `CNAME`, and flipping it early takes the site
> down. Ordered runbook: [`docs/domain-cutover.md`](docs/domain-cutover.md).

Matthew McCluster is a creative director, photographer, web designer and
songwriter working out of Bridgeport, Connecticut and Acworth, Georgia. He
founded McCluster Corp and the Equity Uprise civic fellowship, which has
been recognized by the State of Georgia and the City of Bridgeport.
Identity of record: [ORCID 0009-0000-8988-8955](https://orcid.org/0009-0000-8988-8955) ·
[ISNI 0000 0005 2956 3111](https://isni.org/isni/0000000529563111).

## The four branches of the work

| | What it is | Where it lives |
|---|---|---|
| **Music** | *I AM HERE*, a six-song album, plus the lyric films and the catalogue | `index.html`, `album.html`, `films.html`, `catalogue.html` |
| **Media & photography** | Commercial photography, the shot wall, the print shop, the production house | `shots.html`, `gallery.html`, `production.html`, `portfolio.html` |
| **Civic work** | Equity Uprise: the public record, Docket 516, the policy archive, and the fellowship platform | `equity-uprise.html`, `docket-516.html`, `policy.html`, `topics.html`, `fellowships.html` |
| **Studio & IT** | Booking, client sites, the console, and the platform that runs them | `hire.html`, `sites.html`, `console.html`, `supabase/` |

## The record

*I AM HERE* — Who Did The Shoot · Lightroom · Runway Walk · Write a Song ·
Here · Antisocial

## The Equity Uprise platform

A fellowship of fellowships: people say what they care about, and the
platform points them at real programs and helps them apply. Postgres with
Row Level Security is the backend and the wall; the pages are flat HTML
that render before any network call.

- Schema and policies: `supabase/migrations/0017`, `0018`
- Proof: `bash supabase/tests/run-eu-tests.sh` (33 assertions, no network, no account)
- The whole design: [`docs/equity-uprise-platform.md`](docs/equity-uprise-platform.md)

## How the site is built

Flat, server-rendered HTML and CSS with progressive-enhancement JavaScript —
no client-side framework, no build step for the pages themselves, so every
page ships its text fully rendered on the first request. Structured data
(schema.org JSON-LD) describes one Person and one Organization entity with
stable `@id`s across the whole property; see
[`docs/seo-matthew-mccluster.md`](docs/seo-matthew-mccluster.md).

## Deploy

Push to `main` → `.github/workflows/deploy-pages.yml` stamps asset versions
and mirrors to `gh-pages`. In repo **Settings → Pages**, set the source to
the `gh-pages` branch (one-time). Payments ride the Supabase + Stripe rail
(`checkout` edge function).

Release gate: `node scripts/smoke.mjs` walks the key rooms in a real
headless browser at phone and desktop widths and fails on any page error.

## Find Matthew McCluster

[Website](https://matthew.mccluster.org/matthew-mccluster.html) ·
[LinkedIn](https://www.linkedin.com/in/matthew-mccluster-863048248) ·
[Instagram](https://instagram.com/McClusterishere) ·
[YouTube](https://youtube.com/@McClusterishere) ·
[Muso.AI credits](https://credits.muso.ai/profile/c1d1f2fa-1ba4-42d5-a430-20b2c2e77db7)
