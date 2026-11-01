# Story, production and music engine audit — 2026-11-01

Scope: source inspection in the authorized local checkout. Base `e80cb0a137683393f19ba251f9beb9e66577ce64`; public repository `mcclusterishere/mccluster`. No production database, paid model, live authenticated UI, deployment or publication was exercised. Read access and normal Git fetch succeeded in this environment. Prior unpublished local commits `a0302894` and `1fdef132` are not present in this checkout; their behavior is not treated as implemented here.

## Existing engines, with actual entry points

| Surface | Inspected source | Existing behavior / persistence | Gap for daily production |
| --- | --- | --- | --- |
| Control → Create → Projects | `js/control-room-v2.js`, `js/control-room/media.js` | Creative cards read `social_campaigns`, variants and publish jobs. Generator calls `/v1/media/models`, `/generate`, `/bakeoff`, `/jobs/:id`. | Prompt-only controls exclude models needing references. No scene/script/canon editor is mounted. |
| Existing media backend | `workers/mccluster/src/media/{router,fal,input-contract,recommend,pricing,orchestrator}.js`, `entry.js` | fal queue/status/results/webhooks, validated model input, budget reservations, stored `media_jobs` and `media_assets`, comparison requests. Non-fal generation has no installed adapter. | UI does not expose the full input contract, cost-before-submit or versioned scene/take workflow. Existing bakeoff is not an editing timeline. |
| Existing creative schema | `supabase/replay_migrations/0041_media_harness_core.sql` | `media_entities`, `media_entity_refs`, `media_workflows.config`, `media_workflow_nodes` already exist in the reconstructed schema. RLS; Worker mutation boundary. | No mounted workflow editor or HTTP workflow CRUD found in inspected main. Runtime table presence is not verified. |
| Control → Work → Projects / Deliverables | `js/control-room/work-records.js`, `workers/mccluster/src/work.js` | `/v1/work/*` writes existing `work_projects`, `work_deliverables`, tasks; organization checks and `control_audit` history. | Summary/note fields are capped at 4,000 characters. A full script cannot safely be stuffed into those fields. Link production plans to these records; preserve their manual authoring. |
| Existing job graph | `core/src/objective-dag-store.mjs`, `core/src/runner.mjs` | Existing `ops_agent_jobs` execution and dependencies. | Reuse when execution is added; do not create another queue. |
| Control → Create → Front page | `js/control-room/front-page.js`, `js/main.js`, `js/live-content.js` | Real `index.html` iframe, bounded preview handshake, `site_content` slot `index.html/@front`, set/revert and content history. Copy remains editable with `js/site-editor.js`. | Preserve this editor. Saving here changes public content, so private scripts cannot use its public storage. |
| Existing creator project landing engine | `front.html`, `js/front-projects.js`, `js/front-member.js`, `js/front-studio.js` | Vaunt repo-managed project plus the separate member draft/publish workflow; shared media and 360 presentation. | No verified general show/episode publication record. Do not let a story inherit unrelated Vaunt media by default. |
| Existing timed visual sequence | `data/reels/antisocial.json`, `data/reels/antisocial.shotlist.json` | Authored time/bar/scene associations, clip lengths, existing versus missing shots. | Existing manual sequence must be preserved; historical price notes are not current provider quotes. |
| PRIM3 course engine | `workers/mccluster/src/prim3/index.js`, `js/prim3.js`, `docs/prim3/SONG-CONCEPT-CROSSWALK.json` | Reads `mcclusterishere/Prim3/learning/course/course-feed.json`; 21 episode/song units expand to 63 lesson modules plus 3 foundations. | Course identity is not release status. Reuse explicit source associations; unknown soundtrack slots remain unassigned. |
| Canon source workspace | `docs/stories/README.md` | Native episode working copy, exact returned source-text snapshots, dated canon decisions and reveal matrix. | Local branch only. Neither remote Git nor production AI can retrieve unpublished local content. |

The existing universe schema names Higgsfield for planned hero transitions. That is a production intention, not evidence of an installed Higgsfield adapter. The existing fal adapter should be exposed more usefully before deciding whether a second provider adds value. No paid generation, provider purchase, credential change or model installation is authorized by this audit.

## Relevant branch work inspected

| Branch / PR | Fetched head | Reuse / caution |
| --- | --- | --- |
| [#684](https://github.com/mcclusterishere/mccluster/pull/684), `feature/whip-equipped-tracks-lyrics` | `21c92673103d1b179ddef051602ff87a7a101a17` | `js/control-room/lyrics-review.js` exports `CR.lyricsReview`; existing timed-line editor. Shelf corrections download JSON; uploads save via `operator-lyrics-save`. Do not create a second editor. Save is not yet version/hash guarded. |
| [#685](https://github.com/mcclusterishere/mccluster/pull/685), `feature/whip-equipped-stems` | `bdb8a94501c794630d0e7c1ca88bdfbfe2d4a9ad` | Stacked on #684. Existing private stems panel and Core separation; do not assume SQL/runtime deployed. |
| [#686](https://github.com/mcclusterishere/mccluster/pull/686), `feature/control-room-consolidation` | `86a90f7199d84b65a22eae67cb30b5c8a3347cd3` | Broad navigation consolidation; not a safe blind merge for a narrow story task. Its module expectations differ from the lyrics branch. |
| [#687](https://github.com/mcclusterishere/mccluster/pull/687), `feature/prim3-album` | `a2a32da12e39bf33fbaa639f188fda024ab0f26a` | Stacked on #684, adds PRIM3 recordings and machine-timed lyric files. Timed does not mean listened to and approved. |

All four PRs were open and unmerged when rechecked. The fetched `feature/character-studio-mvp-20261019` source includes `character-studio.js` UI and `/v1/house-agents/owner/characters/preview` / `/characters` handlers. Its compiler produces hooks/visual briefs with empty canon references, canon unapproved, and media generation disabled. The pending `20261019211500_character_studio_v1.sql` is not runtime evidence. The production reference library does not create or alter these agent personas.

## Bounded integration order

1. Finish the local indexed story checkpoint and source/build checks.
2. Extend the current Projects workflow using existing private media-workflow storage linked to existing Work projects. Keep editable script, canon reference, scene prompts/reference assets, soundtrack assignments and revision identity together. Preserve manual input and recoverable saved revisions.
3. Expose only model inputs the installed registry supports; show a quote before any explicit generation. Reuse the existing media job lifecycle, compare takes and per-scene regeneration. A plan or model selection never submits a paid job automatically.
4. Reconcile and mount the existing lyric editor narrowly; corrections must save/reload with revision identity and stale-write checks. Exports must identify the selected reviewed revision, and masters remain unchanged.
5. Reuse public-safe episode associations and the existing landing engine. No manuscript text or reveals in public bundles. Unknown/release-unverified mappings stay drafts. Preview is separate from public save.

This is the implementation order, not a claim those integrations are complete. Tests must distinguish mocked local proof from real persistence/provider/deployment evidence. Payments and booking remain outside this work.

## Subsequent local checkpoints

Domain repair: `docs/domain-quote-flow.md`. Production studio: `PRODUCTION-STUDIO-CHECKPOINT-20261101.md`. Lyrics and episode associations: `MUSIC-STORY-CHECKPOINT-20261101.md`. These describe implemented source/mock proof after the baseline inventory above; they do not assert a live deployment.
