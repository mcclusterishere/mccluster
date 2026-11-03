# News ↔ Halo map pairing

Owner, 2026-11-03: "The headline about a satellite and other headlines about
specific items, events or data that exists on the Hitman's Halo map should be
considered as paired data and a lot of data needs pairing automatically. Can
the box handle that too?"

Yes. McCluster Core on the OVH box pairs every newly imported headline with
the Halo map items it is about, every 15 minutes, and keeps the pairs for a
week. Deterministic matching does nearly all of it; the box's fast local model
only answers yes/no on the ambiguous few.

## What runs where

| Piece | Where |
| --- | --- |
| News | `media_news_articles` (GDELT, ingested by Worker `mccluster`), read by `imported_at` since the last finished job |
| Map items | The Halo layers served by Worker `mccluster`, read by Core with a Core-signed GET (below). Nothing about the items is stored except the snapshot on each pair. |
| Matching | `core/src/world/news-pairing.mjs` (pure functions, `core/test/world-news-pairing.test.mjs`) |
| Job | `world_news_pairing` (`core/src/executors/world-news-pairing.mjs`), one job per tick, priority 4 (the PRIM3 news desk is 5) |
| Schedule | `mccluster-core-world-news-pairing.timer`, every 15 minutes, `core/src/seed-world-news-pairing.mjs` (queues one job only when none is queued or running; prunes pairs older than 7 days) |
| Storage | `public.world_news_pairs` (`supabase/migrations/20261103012656_world_news_pairs_v1.sql`): one row per (article, layer, item), RLS on, no client policies, `on delete cascade` with the article, `world_news_pairs_prune()` for service_role only |
| Read | `GET /v1/world/news-pairs?layer=&entity_key=` (news about this item) or `?article_id=` (map items for this headline), Worker `mccluster`, house owner only, `private, no-store` (`workers/mccluster/src/world-news-pairs.js`) |

## Core reads the map as the house owner, narrowly

The Halo layers are owner-only (`workers/mccluster/src/world-release.js`) and
Core holds no user session. Core already signs its media calls with the key it
shares with the Worker (`CORE_EDGE_SIGNING_KEY`, `signCoreRequest()` in
`core/src/broker-edge-auth.mjs`, verified by
`workers/mccluster/src/media/core-signature.js`). The same signature now also
opens these GET routes, and only these:

`/v1/world/layers/{quakes, cyclones, natural, fires, perimeters, launches, satellites, vessels, weather}`

`workers/mccluster/src/world-core-reads.js` handles every request that
announces the Core protocol, first in both Worker entries. It refuses (never
downgrades to anonymous): any other path (military, flights, tides, Halo
operations, CCTV, geocode, pairs, everything else) with 403; any method other
than GET; a query string (the signature does not cover one); a bad, stale,
replayed or Worker→Core signature; a layer the owner withdrew
(`WORLD_GLOBE_WITHDRAWN`); and anything but exactly one house owner. POST
`/v1/media/mcp` keeps its own Core path unchanged. Tests:
`workers/mccluster/test/world-core-reads.test.mjs`.

Core's reads ride the Worker's Cache API like the owner's globe, so providers
see no extra traffic beyond one request per layer window per Cloudflare
location (Launch Library's anonymous limit of 15 calls an hour is safe behind
its 30-minute window). Provider terms are in the header of
`workers/mccluster/src/world-halo-layers.js` and `world-layers.js`: USGS and
NOAA (NHC, NWS) are public domain, NASA FIRMS and EONET are NASA open data
(acknowledgement requested), NIFC WFIGS is U.S. Government open data,
CelesTrak asks for citation, The Space Devs encourage credit, AISStream.io is
under its terms of service. Pairs store only the item's key, name, position
and time, never a provider's full record.

## What pairs, and how strongly

Score bands: **strong ≥ 0.75** pairs automatically; **weak 0.45–0.75** goes to
the local model; below 0.45 is dropped. At most one item per layer per
article (a headline about "a Falcon 9 launch" is not about every Falcon 9), at
most three pairs per article.

An article's point is where GDELT says the article **mentions** a place, not a
verified location of the event. A country-level point (GDELT location type 1,
or the headline-country rule) is a centroid, so geo evidence from it alone is
never strong.

| Layer | By name | By place and time |
| --- | --- | --- |
| satellites | ISS ("International Space Station", or "ISS" beside a space word), Tiangong/Tianhe/"Chinese space station", Hubble: strong. Any other catalogue name (e.g. "NOAA 18", needs a space word): weak. Station modules, rocket bodies, debris: never. | none (orbital elements only) |
| cyclones | NHC storm name beside a storm word ("Hurricane Melissa"): strong. A bare first name never pairs. | storm word and within 800 km of the storm: weak |
| quakes | the USGS place town ("Quake rattles Hachinohe") beside a quake word, quake 48 h before to 1 h after the article: strong | quake word, M ≥ 2.5, within 400 km, same window: 0.55, +0.15 precise place within 150 km, +0.1 M ≥ 5 |
| natural (EONET) | event name beside its kind word ("Mount Etna erupts"): strong; generic names ("Lake Fire"): weak | kind word and within 300 km, event observed within 14 days: weak |
| perimeters (NIFC) | "<incident> Fire" ("Palisades Fire"): strong; generic incident names: weak | wildfire word and within 50 km of the perimeter's centroid |
| fires (FIRMS) | none | wildfire word and within 50 km of a cluster of hotspots (0.25° cells, at least 3 hotspots or 50 MW): 0.5, +0.15 precise place, +0.1 at least 20 hotspots |
| launches | mission name ("Artemis II"): strong. Rocket name beside a launch word ("Falcon 9 … scrubbed"): weak, nearest launch in time | launch word, pad within 100 km, launch within 72 h: weak |
| vessels | only a ship word **and** the exact multi-word AIS name ("container ship Ever Given"): strong with two distinctive words, else weak. Single-word names never pair. | none |
| weather (NWS) | none | Warning/Emergency alerts of a matching kind (tornado, flood, snow, heat, wind, storm, dust, fire, cyclone), precise place within 100 km: weak |

"Fire" means wildfire: the matcher uses wildfire vocabulary (wildfire,
bushfire, forest/grass/brush fire, blaze, fire crews, containment), so
"ceasefire", "fired", "fire sale", "open fire" and "under fire" never pair.
Military aircraft and flights are not paired: news does not name callsigns.

Name matching is whole-word on normalized text (diacritics and punctuation
removed), from a phrase index built once per job, with a stoplist so generic
words (fire, storm, lake, river, north, satellite, months…) never pair alone.

## The model's part

Weak candidates are grouped by (headline text, item), so syndicated copies of
one story share one question, sorted by score, and asked 12 at a time to the
box's fast local model (the one the PRIM3 news desk uses, falling back to the
default local model) with a JSON Schema
(`{"pairs":[{"n":1,"same":true,"why":"..."}]}`), temperature 0, priority -45
(below the PRIM3 news desk's -40). Headlines are untrusted data in the prompt.
Only `same: true` is stored, as `method = 'model'`, with the deterministic
reason and the model's short "why". Default 2 calls a job
(`WORLD_NEWS_PAIRING_MODEL_CALLS`, 0–8, or `input.model_calls`). Weak
questions beyond the budget are counted as `unreviewed` and not stored; a
model failure leaves the strong pairs written and records the error.

## Capacity, from the box's numbers

Box: 8 vCPU, no GPU, local generation about 8–10 tokens/s, prompt about
28 tokens/s (docs/prim3/NEWS-DESK.md).

- **Deterministic matching** is not the limit. A synthetic worst case (3,000
  articles whose every title carries topic words, against 20,000 items: 25,000
  FIRMS hotspots clustered, 8,000 ships, 2,000 quakes, 1,500 alerts, 500
  events) took 0.25 s to index and 2.9 s to match on one core of a
  development machine; real headlines mostly fail the topic-word gate first.
  A tick's 1,000–1,700 new articles fit inside the 3,000-article cap.
- **One model call** of 12 questions is about 1,250 prompt tokens (~45 s) and
  about 270 generated tokens (~30 s): roughly **75 s**.
- **Default budget**, 2 calls a tick: about 2.5 min of the box per 15 minutes
  (~17%), 24 questions a tick, about **2,300 questions a day**. Raise
  `WORLD_NEWS_PAIRING_MODEL_CALLS` to review more, at the cost of the news
  desk and the owner's chat (the runner is serial: the owner's chat waits
  behind at most one job, ~2.5 min at the default).

## Limits, honestly

- Each tick reads at most 3,000 articles, newest first; if more arrived, the
  older ones are skipped and the job says `articles_capped: true`. The cursor
  never looks back more than 24 hours (first run: 30 minutes).
- A layer that does not answer (provider down, key not configured) is a
  receipt in the job output, and that layer is not paired for that window.
  When no layer answers the job fails and the cursor does not move.
- The map changes: an item that left its layer (a storm that dissipated, a
  ship that went quiet) keeps the snapshot on its pairs until they are pruned.
- FIRMS cluster keys are a 0.25° cell and a UTC day, so one long fire spans
  more than one key over days.
- Pairs are matches, not verified facts: every one carries `method`, `score`
  and `reason`, and the read route says so.

## Before it runs

1. The migration is applied to production as `20261103012656`
   (`world_news_pairs_v1`), recorded in `supabase/production-ledger.json`, the
   drift contract and the 2026-11-03 production schema evidence.
2. Deploy Worker `mccluster` (the Core read gate and the pairs route).
3. Promote Core through `deploy/ovh-production`; the deploy installs and
   enables `mccluster-core-world-news-pairing.timer`.
