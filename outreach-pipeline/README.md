# Mentor outreach pipeline

Daily research for Matthew's mentor outreach campaign (PRI-23). It finds Brad Feld caliber people, verifies them,
researches what they did recently, writes one letter per person, and puts every letter in a **review queue**.
**It never sends.** Letters go out only after Matthew approves them in chat, from `mattmccluster@gmail.com`.

## What one run does

1. **Discovery.** Category queries over web and news (`src/discovery.mjs`): venture GPs, founders with major exits,
   and operators with leverage. The search provider is pluggable (`OUTREACH_SEARCH_PROVIDER` = `brave`, `serper`,
   `fixture`, `none`). Names come from an LLM extractor when one is configured, else a heuristic over titles and snippets.
   People on the hold list or already contacted (seeded from the campaign files) are skipped.
2. **Verification** (`src/verify.mjs`).
   * Email: the exact address string must appear in content fetched from a stored URL. No guessing, no name
     patterns, no `name at domain dot com` decoding, no data broker or people search sites, no generic inboxes.
   * Wealth, frames A and B only: a page from Forbes, Bloomberg, sec.gov (disclosed pay or holdings) or a named news
     outlet (reported exit) that names the person and states a figure of at least $1M within 400 characters of their name.
     The URL, excerpt and page hash are stored. Frame C has no floor but needs a sourced role.
3. **Research** (`src/research.mjs`): 2025 and 2026 activity, each hook kept with its URL, only when the fetched page
   names the person and carries the year.
4. **Letter** (`src/compose.mjs`): written fresh from that person's facts by the configured model, with the frame's rules.
   Every letter must pass: no dash characters at all (em, en, minus, and hyphens outside emails and URLs, subject too),
   the frame's structure (A says he is a student and asks for a conversation; B is one observation and exactly one
   question, no pitch, no self description; C is one small ask or intro), it must use a sourced hook, and the
   similarity guard. A failing letter is retried with the reasons up to 3 times, then dropped.
5. **Similarity guard** (`src/similarity.mjs`): each letter is compared with every earlier draft and sent letter
   (the seeded November batch plus everything in the store). Rejects any shared sentence, any shared 7 word run, word
   3 shingle Jaccard above 0.08, character trigram cosine above 0.85, embedding cosine above 0.93 (when configured),
   the same opening, or a near identical subject. Greeting and signature lines are ignored. Calibrated so the 13 hand
   vetted November letters all pass pairwise (their worst pair: Jaccard 0.016, char cosine 0.74).
6. **Queue**: status `pending_review`, with the email page, wealth source and hooks attached. Queue size per day is
   bounded by the caps below.

Frames: **A** student interview request ($1M floor), **B** observation plus one question ($1M floor), **C** power
frame for people with leverage (no floor). A person with a verified wealth signal goes to whichever of their eligible
frames has the most room left; anyone without one can only be C.

## Caps

150 a day from `mattmccluster@gmail.com`, 50 per frame, on the America/New_York calendar day. Env can lower them and
never raise them (`src/config.mjs` clamps). The run sizes the queue to the room left (open drafts and today's sends
count), `record-send` and the gated send refuse past the caps, and the database trigger enforces the same numbers.

## Review (how Matthew approves)

```
node bin/outreach.mjs review export            # plain text of every pending letter with its sources, to paste into chat
node bin/outreach.mjs review approve <id> --by matthew
node bin/outreach.mjs review reject <id> --by matthew --reason "not this one"
node bin/outreach.mjs review edit <id> --subject "..." --body-file letter.txt   # re-checked, back to pending_review
```

Approval re-runs the dash, frame and similarity checks. After Matthew says send in chat, the letter is sent the way the
campaign already sends (the Gmail connector, exactly as approved, once), then recorded:

```
node bin/outreach.mjs record-send <id> --message-id <gmail id> --by matthew
node bin/outreach.mjs record-reply --from person@example.com --at 2026-11-25T08:33:00-05:00 --message-id <gmail id>
node bin/outreach.mjs stats                    # sent, replied, reply rate per frame
node bin/outreach.mjs caps                     # room left today
```

There is no `send` command. `src/send.mjs` has `sendApprovedDraft`, which refuses unless the caller passes
`approved: true` and `confirmedBy`, `OUTREACH_SEND_ENABLED=true`, the row is `approved` with `approved_by` and
`approved_at`, the caps hold and the address was never sent. Nothing scheduled imports it; a test walks the import
graph of the pipeline and the Core executor to prove that.

## Run it locally

```
cd outreach-pipeline
npm test                                       # offline, fixtures only; any real network call fails the tests
node bin/outreach.mjs run --fixture            # end to end on synthetic people, local store under outreach-data/fixture
node bin/outreach.mjs seed-history             # import /workspace/hnw-outreach (batch 1 letters, sends, replies) into the store
OUTREACH_SEARCH_PROVIDER=brave OUTREACH_SEARCH_API_KEY=... OUTREACH_LLM_URL=... OUTREACH_LLM_MODEL=... node bin/outreach.mjs run
```

Local state lives in `outreach-data/` (git ignored, mode 600). The campaign files with real names and addresses stay on
the box (`OUTREACH_HISTORY_DIR`, default `/workspace/hnw-outreach`) and are never committed; the repo is public.
`test/migration-pglite.test.mjs` applies the pending migration to an in memory PGlite database when
`OUTREACH_PGLITE_MODULE` points at `@electric-sql/pglite/dist/index.js` (skipped otherwise).

## On the Core runner (OVH)

* Job type `mentor_outreach_research` (`core/src/executors/mentor-outreach-research.mjs`), registered in
  `core/src/runner.mjs`, excluded from chat dispatch (`core/src/dispatch/routes.mjs`). It loads this folder from
  `OUTREACH_PIPELINE_DIR` (or beside `core/`), writes to the `outreach_*` tables through Core's PostgREST helper, and
  returns `sent: 0`. Off unless `OUTREACH_PIPELINE_ENABLED=true`.
* Schedule: `core/src/seed-mentor-outreach.mjs` queues one job per New York day (target `outreach:YYYY-MM-DD`), run by
  `core/systemd/mccluster-core-mentor-outreach.timer` at 06:15 America/New_York. The deploy script installs units but
  does not enable this timer (it is not in its enable list), the same as the weather timer.
* Tables: `supabase/pending/20261125090000_mentor_outreach_pipeline_v1.sql` (+ rollback). Pending, not applied.

### To turn it on (each step is Matthew's call)

1. Approve and apply the pending migration (`mentor_outreach_pipeline_v1`).
2. Put this folder on the node: `scripts/deploy-ovh-core.sh` only syncs `core/`, so either add `outreach-pipeline/`
   to the deploy or set `OUTREACH_PIPELINE_DIR` to a checkout the `mccluster-core` user can read.
3. Add to `/etc/mccluster/core.env`: `OUTREACH_PIPELINE_ENABLED=true`, `OUTREACH_SEARCH_PROVIDER` and
   `OUTREACH_SEARCH_API_KEY`, `OUTREACH_LLM_URL` and `OUTREACH_LLM_MODEL` (and key), optionally the embedding vars.
4. Seed history into Supabase once: `OUTREACH_STORE=supabase node bin/outreach.mjs seed-history`.
5. `systemctl enable --now mccluster-core-mentor-outreach.timer`.

Without a server: run `node bin/outreach.mjs run` from cron once a day with the same env and `OUTREACH_STORE=local`.
