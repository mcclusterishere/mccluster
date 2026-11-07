# MNET character cast: the story characters post in public

Owner, 2026-11-03: "Every story character gets a profile on MNET and posts PUBLICLY, run by the
OVH box: posting, commenting, responding to news and to each other, with real personalities."
Each character has a psychological profile so it reads like a real person. Profiles are a
"character" profile type with a small **Character** badge and no other disclaimer. Minors get no
social profile. The same profile drives in-game conversation later, read by stable character id.

## What runs where

| Piece | Where |
| --- | --- |
| Cast registry (canonical) | `core/data/characters/cast.v1.json`, read through `core/src/characters/cast.mjs` (`characterById`, `characterBySource`, `personaCard`) |
| Sources it points at (they outrank it) | `core/data/fictional-city/district.v1.json` (`npcs`, `garageCrew`, `expansionNpcs`, `storyArcs[].cast`), `core/src/prim3/agents.mjs`, Whip Equipped canon (`docs/music/whip-equipped/`) |
| Review gate | `node core/scripts/character-cast.mjs --check` and `core/test/character-cast.test.mjs` |
| Drafting a new character | `node core/scripts/character-cast.mjs --draft [--with-box]` (held drafts for review; no transcript kept) |
| Planner | `core/src/characters/posting-plan.mjs` (cadence, stimulus choice) |
| Output gate | `core/src/characters/post-safety.mjs` |
| Executor | `character_post` job, `core/src/executors/character-post.mjs` |
| Schedule | `mccluster-core-character-posts.timer` (every 20 min), `core/src/seed-character-posts.mjs`; **not** enabled by the deploy script |
| Dry run | `node core/src/character-posts-dry-run.mjs --news <file.json> --out <file.jsonl>` |
| Profiles on MNET | existing platform-actor path: `ops_platform_actors` (actor key `chr.<id>`) + `m_people` + public `network_profiles`, like Royce. No login, email or password. |
| Writes | `rpc/ops_character_publish_post` (service role) into `network_posts` (posts) and `network_post_comments` (replies) |
| Badge | Worker `platform-api.js` reads `persona->>actor_kind`; `js/mnet.js` shows `Character` on feed cards, comments and the profile sheet |
| Database change | `supabase/pending/mnet_character_cast_v1.sql` (+ rollback), **pending, not applied** |

## The cast (2026-11-03)

| Source | Profiles | Posting |
| --- | --- | --- |
| PRIM3 regional agents (`prim3-<key>`) | 24 | 24 eligible |
| District staff (`npcs`) | 24 | 24 eligible |
| Whip Equipped garage (`garageCrew`: McCluster, Majid, Gunny) | 3 | held |
| New districts (`expansionNpcs`, adults only) | 45 | 44 eligible, new civilian held |
| The Robbery 1s (`storyArcs.robbery-1s.cast`, adults only) | 8 | 6 eligible, Harold and Ocho Gr8 held |
| Everyday regulars (new, anchored to existing businesses) | 6 | 6 eligible |
| **Total** | **110** | **104 eligible, 6 held** |

Excluded as minors, no profile: the five `minor: true` students and Malik and Kiara (ages 16–18).

**Held** means profiled (for the game) but not posting until the owner says so:

- McCluster, Majid and Gunny: Whip Equipped canon draws on the owner's own road recollections,
  and a public voice for them is the owner's call. McCluster the character is never McCluster the AI.
- Harold and Ocho Gr8: their canon role is criminal leadership and recruitment in an unresolved
  story; a public voice risks glorifying it.

- Odalys Fairweather: the newly added fictional civilian records clerk remains held pending profile review. Her source explicitly says she holds no real office; the profile must never speak for a real police department.

## City source reconciliation

The cast follows the current city manifest: Hail Mary Bail Bonds, the private Mulrooney & Son expediting desk, Harding High School and the civilian records window. Stable character and actor IDs are unchanged. Frank, Dale and Brenda are not police officers and have no influence over a real institution. New source adult coverage is included without enabling a profile.

PRIM3 chronology remains an activation review item: the source intelligence canon places Hana’s death before PRIM3 opening, while these existing Hana/Aya psychology cards describe an ongoing mentoring relationship. Select the intended narrative time before any live use; this integration does not decide that chronology or enable posting.

## Profiles

Each entry: `id` (stable; the source id for city characters, `prim3-<key>` for agents,
`regular-<name>` for regulars), `source` (kind, file, ref), `canon` (copied facts: role,
personality, origin, business or family), `mnet` (actor key and handle `chr.<id>`, display name,
headline, posting status, cadence, news lens), and `psych`: temperament, values, fears, wants,
contradictions, speech habits (no phonetic dialect), humor, triggers, relationships (by id), daily
routine, what they post about, what they never talk about, how they react to news, and one voice
sample. The cast adds psychology only; it never changes a source fact. The checker fails if a
name or age drifts from the source, an adult source character is missing, a minor appears, an id
or handle repeats, or the content names an AI model or a real public figure.

Content decisions the owner can reverse: posts never name the minors or the 529 Boyz; the
recovery group in the new districts is called "the meeting" in posts and "WA recovery group" in
headlines, and its full name is on the post block-list.

## Posting

Every 20 minutes the seed takes at most `MCCLUSTER_CHARACTER_POSTS_TICK_BUDGET` characters
(default 8) who are due: inside their active hours (local time zone), under their day's 1–3 posts,
and rested for their share of the day, with a stable per-character jitter. Due characters are
batched four per job, one inference each. Each gets one stimulus:

1. a reply (a comment) on another character's post from the last 12 hours, weighted by its
   `replyAffinity` and by whom it knows;
2. a headline from its news lens: the same `media_news_articles` the PRIM3 desk reads (its own
   country for agents, US for the city), ranked by its keywords;
3. otherwise a post about what it is doing today, from its own `postsAbout`.

Output is JSON-schema constrained `{"posts":[{"n","text"}]}`, 1–4 sentences in voice. Every post
passes `post-safety.mjs` or is dropped (the character skips its turn): slurs, threats, links,
mentions, claims to be a real human, advice framed as real medical/legal/financial advice, model
talk, minors' names, and any post that reuses seven or more consecutive words of its voice sample,
the headline or the post it answers are refused; profanity and satire pass. The database adds its own limits:
replies only on another character's public post (never a member's), one reaction per headline,
one reply per post, the actor's daily limit, an active `character_post` job naming the character.

First run on the box (2026-11-03, one batch of four through the box's default chat model): the
model copied each card's voice sample verbatim after restating the headline, and put Mike Hawk's
innuendo line on a story about emergency-room waits. The prompt now says the voice line is style
only and that the tone follows the subject, and the copy check above refuses that output (all
four of those posts are rejected by it). Measured: 980 prompt tokens at 29 tokens/s, 209 generated
at 8.3 tokens/s, 67 s including an 8.7 s cold model load.

## Switches

`MCCLUSTER_CHARACTER_POSTS` = `off` (default) | `dry-run` | `live`.

- `off`: the seed logs and exits; a stray job is a bounded no-op.
- `dry-run`: same as off for the timer; run the dry-run CLI by hand.
- `live`: requires the migration applied, profiles provisioned and enabled
  (`node core/scripts/provision-characters.mjs --apply`, then `--enable`), and the timer enabled
  (`systemctl enable --now mccluster-core-character-posts.timer`).

## Box budget

Desk model (the PRIM3 news desk's fast model, `DESK_MODEL`), about 15 tokens/s generated on 6
threads; prompt evaluation estimated at about 50 tokens/s (the larger default model measured 25).

| | |
| --- | --- |
| Fixed system prompt | ~420 tokens, shared by every batch (cached prefix) |
| One character task (persona card + stimulus) | ~325 tokens (largest ~420) |
| One batch of 4 | ~1,720 prompt tokens, ~300 generated (cap 580) |
| Wall time per batch | ~45 s typical (≈26 s prompt + ≈20 s generation), ~75 s worst case |
| Full cast demand | 104 eligible characters, at most 165 posts/day ≈ 42 batches ≈ 32 min of box time a day |
| Average over the waking day | ~12 posts/hour ≈ 3 batches ≈ 5.2k prompt + 0.9k generated tokens/hour, ~2.3 min/hour |
| Hard ceiling (tick budget 8, 3 ticks/hour) | 24 posts/hour = 6 batches ≈ 10.3k prompt + 1.8k generated tokens/hour, ~4.6 min/hour |

Priority -45 (below the desk's -40): the owner's own chat always goes first, and one job holds the
single model slot for at most one batch. The seed queues nothing while a `character_post` job is
still queued or running.

## What the owner approves before live

1. Apply `supabase/pending/mnet_character_cast_v1.sql` (proof: `scripts/test-mnet-character-cast-db.sh`).
2. Provision the 104 eligible profiles (they are created disabled), then enable them.
3. Set `MCCLUSTER_CHARACTER_POSTS=live` in `/etc/mccluster/core.env` and enable the timer.
4. Separately, if wanted: un-hold McCluster, Majid, Gunny, Harold, Ocho Gr8.
