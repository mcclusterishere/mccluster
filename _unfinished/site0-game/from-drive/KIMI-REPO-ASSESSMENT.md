# Repository Assessment — `mcclusterishere/Here`
### With a Branch Development Plan

**Assessment date:** 2026-08-15
**Source:** GitHub MCP API (live repository data)
**Repo:** https://github.com/mcclusterishere/Here — *"Have no fear, McCluster is here"*

---

## 1. Executive Summary

`Here` is the McCluster brand headquarters: a static HTML platform (~70 pages) combining
the **I AM HERE** six-song album world, the marketing agency (hire / portfolio / pay), a
print shop, Uprise World (a spherical-world web game), client sites, and back-office
consoles — deployed to GitHub Pages at `here.mccluster.org` with a Capacitor Android
shell and Supabase + Stripe payment rails.

**Overall health: the product is alive and actively worked on, but the branch strategy
is the weakest part of the operation.** You have **33 branches**, of which **31 are
agent-generated working branches** from three different AI tools (`claude/*`, `codex/*`,
`agent/*`). Many were never merged, two pairs are exact duplicates, none are protected,
and merged branches are never deleted. The good news: the deploy pipeline itself is
well-built and the security leak guard is live.

---

## 2. What the Repository Contains

| Area | Evidence |
|---|---|
| ~70 HTML pages at root | `index.html` (43 KB), `album.html` (92 KB), `prayer-closet.html` (57 KB), `gallery.html` (50 KB), etc. |
| Deployment | `deploy-pages.yml` mirrors `main` → `gh-pages` with cache-stamping and internals stripping; `CNAME`, `.nojekyll`, `sitemap.xml`, `robots.txt` |
| CI / automation | 11 workflows: CI, site-smoke, platform-smoke, cloudflare-edge-smoke, music-design-contract, vault-ingest, fetch-wall, fetch-cuts, migrate-db, build-android, deploy-pages |
| Mobile | Capacitor 6 (`capacitor.config.json`, `native/`, `build-android.yml`) |
| Backend rails | Supabase (`supabase/`, `pay-now` edge function), Stripe, Cloudflare Workers (`workers/`) |
| Governance docs | `AGENTS.md` (7.5 KB of binding rules), `docs/uprise-world/` bible, roadmap, audit gates, performance budget |
| PWA | `sw.js`, `manifest.json` |

---

## 3. Strengths

1. **Real deployment hygiene.** `deploy-pages.yml` stamps asset versions on every HTML
   file across all page directories (a previous bug where `tracks/` and `closet/` shipped
   literal `__STAMP__` was fixed), strips internals (`docs`, `packages`, `supabase`,
   `.github`, etc.) from the public tree, and **fails the deploy** if a supplier name
   (TapStitch, Printful, Printify, Gelato…) or a cost-bearing ledger key appears in the
   published output. The "supplier leak" flagged in PR #6 is closed — the guard is in
   the current workflow on `main`.
2. **Written governance.** `AGENTS.md` + the Uprise World doc set (audit gate, screenshot
   acceptance criteria, performance budget, roadmap phasing) is far above average for a
   solo operation. Agents are told what *not* to do, which is what keeps them useful.
3. **Active, recent shipping.** Commits on `main` as recent as 2026-08-14; the last big
   integration (PR #21, the sales redesign) consolidated track pages into the reel,
   fixed a live 404, and ran contrast + link sweeps across all 70 pages.
4. **Verification culture.** Recent commits include evidence (which URLs 404'd, link
   crawler coverage going from 59 → 193 targets, console-error checks).

## 4. Risks & Weaknesses

1. **Branch sprawl (critical — detailed in §5).**
2. **No branch protection anywhere.** Even `main` is unprotected: any agent session or
   accidental push can rewrite the production site, since push to `main` *is* the deploy.
3. **Monolithic pages.** `album.html` at 92 KB and several 30–55 KB pages mix structure,
   style, and script in single files. This makes parallel agent edits collide and diffs
   unreadable — which is part of why so many branches can't be merged cleanly.
4. **Multiple parallel "worlds" that never landed.** Three separate Uprise World
   branches, three separate platform-backend branches, and two separate music-system
   branches exist simultaneously. Several closed PRs (#17, #18) were abandoned unmerged
   but their branches still exist.
5. **Issues unused.** Zero open issues; all coordination happens in branch names and PR
   titles. There is no backlog, so duplicate effort (two branches with identical SHAs)
   goes unnoticed.

---

## 5. Branch Audit — the Core Problem

### 5.1 Inventory (33 branches)

| Group | Count | Branches |
|---|---|---|
| Trunk | 1 | `main` (default, **unprotected**) |
| Deploy artifact | 1 | `gh-pages` (force-pushed by workflow — correct) |
| `claude/*` | 12 | gallery-prints-selector, here-material-reskin-v3, mobbin-mcp-integration, music-contract-follows-the-reel, product-integration, redesign-wip, sales-redesign-continue, sales-redesign-integration, sites-demo-slot, uprise-material-spike, uprise-world, web-game-review |
| `codex/*` | 13 | here-revenue-share-offer, hitman-facility-selector-v1, platform-backend-v1, platform-comms-auth-v1, platform-isp-control-plane-v1, prim3-site0-master-v02, sites-revenue-share, uprise-visual-pack, uprise-world-independent-v2, uprise-world-independent-v3, uprise-world-living-sketch, uprise-world-messenger-lab, verify-file-existence-and-report-commit-sha |
| `agent/*` | 6 | cloudflare-r2-agent-v1, distributed-building-backend, music-authored-record-system, music-native-mobile-system, site0-game-staging, 3d-asset-lab |

### 5.2 Specific findings

- **Exact duplicate branches (same SHA, safe to delete one of each):**
  - `codex/uprise-world-independent-v2` = `codex/uprise-world-independent-v3` (`1ea101c0`)
  - `claude/music-contract-follows-the-reel` = `claude/sales-redesign-continue-ltgmt7` (`6bf15544`)
- **Open PRs (4):**
  - #24 `codex/prim3-site0-master-v02` — *draft*, PRIM3 Site 0 3D asset handoff
  - #23 `agent/3d-asset-lab` — *draft*, private 3D Asset Lab
  - #22 `claude/music-contract-follows-the-reel` — point music contract at the reel
  - #8 `codex/verify-file-existence-and-report-commit-sha` — Phase 1 Visual Proof Room (open since Aug 10; per `AGENTS.md`, Uprise World work is gated on the Phase 0 audit — this PR should not merge until that gate is honored)
- **Abandoned but alive:** `agent/music-authored-record-system` and
  `agent/music-native-mobile-system` had PRs #16–#18 closed without merge, yet the
  branches remain. Same pattern for `codex/platform-comms-auth-v1` and
  `codex/platform-isp-control-plane-v1`, which were folded into `platform-backend-v1`
  (PRs #13/#14) — the child branches were never deleted.
- **Merged-but-not-deleted:** `claude/sales-redesign-integration` (merged via PR #21),
  `claude/gallery-prints-selector-8qe16l` (PRs #1–#6), `codex/hitman-facility-selector-v1`
  (its content landed on `main` on Aug 14), `codex/sites-revenue-share`, and others.
- **Branch names carry no state.** You cannot tell from the list what is merged, what is
  parked by design (e.g. `codex/uprise-world-living-sketch`, which `AGENTS.md` explicitly
  defers), and what is dead.

---

## 6. Branch Development Plan — What To Do

### Phase A — Clean up (this week, ~30 minutes)

1. **Delete exact duplicates:** `codex/uprise-world-independent-v3` and
   `claude/sales-redesign-continue-ltgmt7` (identical SHAs — zero risk).
2. **Delete merged branches:** `claude/sales-redesign-integration`,
   `claude/gallery-prints-selector-8qe16l`, `codex/hitman-facility-selector-v1`,
   `codex/sites-revenue-share`, and any other branch whose PR's commits are on `main`.
3. **Decide the fate of the 4 open PRs:** merge, convert to issue + close, or close and
   delete. Drafts older than a week should not stay drafts.
4. **For every closed-unmerged PR branch** (`agent/music-*`, `codex/platform-comms-auth-v1`,
   `codex/platform-isp-control-plane-v1`, etc.): either rebase-and-merge if the work is
   still wanted, or delete the branch and capture the idea as a GitHub Issue so nothing
   is silently lost.
5. **Keep deliberately-parked work, but label it:** rename
   `codex/uprise-world-living-sketch` → `parked/uprise-world-living-sketch` so the
   deferred Living Sketch target survives cleanup without looking active.

Target end state: **main + gh-pages + ≤5 active feature branches + clearly-labeled parked
branches** — down from 33.

### Phase B — Protect the trunk (this week, 10 minutes)

1. **Settings → Branches → add ruleset for `main`:**
   - Require a pull request before merging (you can still self-approve).
   - Require status checks: `ci.yml` and `site-smoke.yml` must pass.
   - Block force pushes and deletions.
   This single change stops "any agent session can rewrite the live site."
2. **Enable "automatically delete head branches"** in repo settings so merged PR branches
   clean themselves up from now on.

### Phase C — Working agreements for agent sessions (ongoing)

These go straight into `AGENTS.md`, which your agents already read:

1. **One task = one branch = one PR.** No branch may serve two sessions; a new session
   starts from fresh `main`, not from another agent's branch.
2. **48-hour rule:** a branch with no PR within 48 hours of its last commit gets a PR
   (even as draft) or gets deleted.
3. **Naming:** keep the tool prefix (it's useful provenance) but add the issue number:
   `claude/26-gallery-print-variants`, `codex/27-vault-ingest-retry`. The issue is the
   source of truth; the branch is disposable.
4. **No stacked agent PRs.** PRs #12–#14 chained `main` → `platform-backend-v1` →
   child branches; when the middle one stalled, all three died together. Agent branches
   always target `main`.
5. **Gated branches are exceptions by name only.** Uprise World has its own audit gates —
   that work stays on explicitly-named branches (`uprise/*`), everything else flows
   through short-lived feature branches.
6. **Monthly branch sweep:** add a scheduled workflow (or a calendar reminder) listing
   branches older than 14 days with no open PR.

### Phase D — Structural moves (when time allows)

1. **Break up the monolith pages** before adding the next big feature: extract shared
   CSS/JS from the 30–90 KB HTML files into `css/` and `js/`. This directly reduces
   cross-branch merge conflicts — the root cause of today's unmergeable parallel work.
2. **Use Issues as the backlog.** Every parked idea from deleted branches becomes an
   issue; agents pick up issues, not stale branches.
3. **Tag releases.** The album world and the agency platform are stable enough that
   `v1.0-album`, `v1.1-sales-redesign` style tags would give you instant rollback points
   independent of `gh-pages` history.

---

## 7. Priority Action List

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | Protect `main` (PR + status checks + no force push) | 10 min | Stops accidental live-site rewrites |
| 2 | Delete 2 duplicate branches (identical SHAs) | 2 min | Zero-risk cleanup |
| 3 | Resolve the 4 open PRs (merge / close / issue) | 30 min | Unblocks the queue |
| 4 | Delete merged + abandoned branches (~20) | 20 min | Branch list becomes readable |
| 5 | Enable auto-delete head branches | 1 min | Prevents recurrence |
| 6 | Add the 6 working agreements to `AGENTS.md` | 15 min | Every future agent session inherits them |
| 7 | Convert parked ideas to Issues; label parked branches | 30 min | No silent loss of work |
| 8 | Extract shared CSS/JS from mega-pages | days | Removes the conflict engine |
| 9 | Tag a `v1.0` release | 5 min | Rollback point |

---

*Assessment generated from live GitHub data (branches, PRs, commits, workflows, key files)
on 2026-08-15. Branch SHAs and PR states reflect that date.*
