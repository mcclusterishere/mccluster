# Equity League: a separate, paper-only consumer of Halo's evidence

Written 2026-11-24. A design record. **Nothing here is built in this change**, and nothing here is advice about any
security. The owner operates every step himself; no agent places an order.

The owner's private prototype ("Equity League Paper Pilot", a dependency-free loopback Node app reviewed for this note,
not imported into the repository) is the reference for behaviour. This note says how it would sit on the plane.

## Boundaries

| Rule | Detail |
|---|---|
| Separate product | Equity League is its own consumer. The **Environmental Justice League** (`league` module, `eup_league_v1.sql`) and the existing **Finance** surfaces (`workers/mccluster/src/finance/`, `js/halo/finance.js`, the Finance World) are preserved and not renamed, merged or repurposed |
| One intelligence store | It reads **Halo's published evidence contract** and nothing else: no private Halo credential, no second evidence store, no scraping of owner routes |
| Paper only | Alpaca **Paper** only, server-side, **disabled by default**. No live host is selectable, there is no live toggle, and nothing submits an order automatically. Core may schedule ingestion and analysis; it can never submit an intent |
| Public facts only | Roster entries are public professional facts with a source each (issuer filings, exchange listings). No private data about a person |
| Congressional disclosures | Kept **out of trading and out of forecast training** pending a legal-use review. They are not an input to any forecast here |
| No advice | No recommendation to buy, sell or hold; no prizes, deposits or real orders |

## The evidence contract Halo publishes

What a consumer may read, per evidence item: `id`, `source`, `source_record_id`, `revision`, `content_sha256`, `title`,
`url`, `observed_at`, `published_at` with its precision, `available_at`, and the classed statements. This is the shape of
`halo-case/v1` (`js/halo/case-replay.js`). The consumer asks **as of a cutoff** and receives only what was available
then, plus a count of what is withheld. It never receives the owner's proposed decision or anything unreviewed.

The contract does not exist as a route yet. It needs the as-of read and the `published_at` column listed in
`HALO-CASE-FUKUSHIMA-RENESAS.md`, behind an owner-gated handler first.

## The first matchup

One **five-trading-day semiconductor matchup**: two tickers, one start session, a fixed close five sessions later, a
stated benchmark (which of the two outperforms the other over the window).

Order of events, which the store must enforce, not the page:

1. **Halo seals first.** Before any human pick is visible to it, Halo's forecast is written once and never edited: the
   choice, a confidence read as the probability that the chosen ticker outperforms, the rationale, the cutoff, the
   evidence ids eligible at that cutoff, and the **model and data versions**.
2. **Humans pick.** Unassisted picks and assisted picks (made after seeing Halo's sealed forecast) are **stored
   separately** and never pooled.
3. **Resolution** from a recorded price source with its own timestamps, distinct from any replay fixture.
4. **Training is opt-in, after resolution.** Consent is false by default and is asked for per record once the outcome is
   known. Fixture calibration is never reported as predictive performance.

## Before any claim of predictive value

Compare three versions **chronologically**, each sealed before its window opens, on the same matchups:

| Version | Inputs |
|---|---|
| Market-only | Prices and volumes available at the cutoff |
| Filings | Market-only plus issuer filings available at the cutoff |
| Halo-event | Filings plus Halo evidence available at the cutoff |

No look-ahead: every input is filtered by `available_at`. Report calibration and the hit rate per version with the
number of matchups; with a handful of matchups the honest result is "not enough to say". The Fukushima case establishes
no link between that earthquake and any ticker and is not evidence for one.

## Where it would live

- Market reads: the existing `workers/mccluster/src/finance/alpaca.js` (asset, clock and quote reads, quota routing).
  Not a second data plane.
- Paper intents, if the owner wants them: a new owner-only handler with its own reviewed, account-scoped intent store;
  one stable id per intent; a retry reconciles against that id and never resends. Keys in the Worker's secrets, never in
  a page, a chat or a commit.
- Seasons, scoring and the sealed-forecast store: new SQL staged under `supabase/pending/` with a rollback, applied only
  by the owner.
- A module id of its own in the registry when it is built (it is not `league` and not `halo`).

## Not built, and needed first

The published evidence route; the sealed-forecast store with its write-once rule; durable per-owner seasons and
anti-replay; a read-only quote source with source timestamps; corporate-action handling for the price series; owner
auth on every route; browser tests; the legal-use review named above.
