# Recast Studio prototype

An isolated McCluster creator-tool prototype. It contains a mobile-first interface and a reusable planning/lifecycle contract. **It does not generate or alter video.** It does not call any provider, upload files, save credentials, spend money, publish content, or connect to production.

The review branch is `codex/recast-studio-20261109` in `mcclusterishere/mccluster`, based on main `578e683088fdd49fb77848733e70dd4f3af039c3`. All additions are confined to `_unfinished/recast-studio/`, which is excluded from the published site by the existing deployment workflow. It intentionally avoids the active media-safety work in Claude PR #793. It must be ported through the existing McCluster media service, not deployed as another backend. Start with [INTEGRATION.md](INTEGRATION.md).

## Run locally

Requires an already-installed Node.js 22 or newer. There are no package dependencies to install.

```sh
cd _unfinished/recast-studio
npm start
# Open http://127.0.0.1:4179 on that same computer.
npm test
npm run check
```

The preview server serves a fixed allowlist of static files, binds loopback, rejects mutation requests and non-local Host headers, and sets a Content Security Policy with `connect-src 'none'`. It is a development preview host, not a production server. Do not expose it through a public tunnel.

## Implemented

- Local-only source video and character-image selection/preview.
- In-point and take-length controls, character label and editorial direction.
- An illustrative provider cost and a per-take ceiling. No live quote or payment.
- Footage, likeness and sharing declarations, explicitly not verified legal consent. Changing the source, reference or provider invalidates relevant planning state.
- A deterministic SHA-256 plan binding tenant, operation, asset IDs, controls and declared permissions. Raw URLs and extraneous secrets are not carried into the sanitized plan.
- Provider-neutral job transitions, including uncertainty reconciliation without automatically resubmitting the same potentially paid job.
- Clearly labeled local job simulation, cancellation and metadata-only plan export. No generated output is invented.
- Disabled self-hosted H3 and Wan candidates. H3 fails closed pending a separate license; Wan has no claimed benchmark or live adapter.

## Verification

On November 9, 2026: **21/21 Node tests passed**, plus JavaScript syntax checks. These include a DOM-double controller test for missing inputs, budgeting, planning, cancellation, simulation, invalidation, provider consent reset, license blocking and reset. They are not browser tests.

Real browser QA was attempted but could not run: the container Chromium process could not open required local sockets, including after the approved sandbox escalation. The managed browser could not reach this workspace's localhost. Therefore layout, actual video decoding, touch interactions, 390/820/1440-pixel overflow, screenshots and iPad Safari behavior are **unverified**. `qa/browser-check.mjs` is a prepared browser test, not a passing result. It requires separately available Playwright/Chromium and synthetic local fixtures. Do not install anything automatically to run it.

With already installed ffmpeg, create synthetic fixtures from inside this directory:

```sh
ffmpeg -y -f lavfi -i color=c=navy:s=320x180:r=24 -t 10 -c:v libx264 -pix_fmt yuv420p qa/source-test.mp4
ffmpeg -y -f lavfi -i color=c=tan:s=180x240 -frames:v 1 qa/reference-test.png
# In another terminal, with npm start running and Playwright already available:
node qa/browser-check.mjs
```

Set `CHROMIUM_EXECUTABLE_PATH` only if using an already installed browser instead of Playwright's configured browser. The script does not disable the browser sandbox. Synthetic media and test output are ignored and are not part of the published branch.

All GPU rendering, likeness quality, temporal consistency, mask accuracy, audio timing, provider cancellation, real cost and production durability remain **untested**.

## Production integration

Read [INTEGRATION.md](INTEGRATION.md) and [RESEARCH.md](RESEARCH.md). The canonical API remains `https://api.mccluster.org`; `media_jobs`, `media_assets`, capability grants, budget reservations and operation claims remain authoritative. There is no new auth system, database, queue authority, billing stack or social publisher here. Browser closure currently stops a simulation; a real accepted job must remain durable in the existing service.

Do not ship source-video URLs directly from a browser to a provider. Resolve canonical asset IDs against authenticated tenant ownership and permissions, generate bounded delivery access, and record the provider transfer authorization server-side. Production policy cannot trust a client checkbox, client cost, plan hash or `ready` state.

No Openjutsu application source or model weights were copied into this prototype. The UI and contract are newly written. Any future reuse of MIT source must retain its copyright and license notice; the MIT license does not cover its model weights or all dependencies.
