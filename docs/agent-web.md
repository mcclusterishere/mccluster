# The agent web

## What this is

The web is picking up a second audience. The first one is people, who
arrive at a page, read it, and leave. The second is agents, which arrive
at a *resource*, take what they need, and act on it somewhere else
entirely. Those two want opposite things from a site: a person wants a
paragraph, an agent wants a schema.

This property now answers both. Nothing about the human side changed.

## The three files

| File | For | What it does |
| --- | --- | --- |
| `llms.txt` | agents | Says what this site is, what its resources are, and how to call them. |
| `robots.txt` | crawlers | Names the AI crawlers explicitly and states a policy. |
| `sitemap.xml` | search | Unchanged. |

`llms.txt` follows the [llmstxt.org](https://llmstxt.org) convention: one
markdown file at the root, written for a machine, that leads with the
most useful thing rather than with a bio.

## The policy today is: read it

That is a decision, and it is the opposite of the obvious move, so here
is the reasoning in full.

Blocking training crawlers only pays if something collects on the other
side of the block. Cloudflare's pay-per-crawl is what turns a refusal
into an `HTTP 402` and a checkout — but **that runs at the edge**, and
this property is not behind Cloudflare. DNS still answers from the old
nameservers (see `docs/cloudflare-cutover.md`).

So a `Disallow` line today would buy exactly nothing: no payment, no
negotiation with the crawler, just less reach for a fellowship directory
whose entire purpose is being found by somebody who needs a fellowship.
You would be paying a real cost for a hypothetical revenue that has no
mechanism to arrive.

The right sequence is:

1. **Be maximally legible.** Done — that is `llms.txt`.
2. **Get behind Cloudflare.** `docs/cloudflare-cutover.md`, one afternoon.
3. **Then decide what a crawl is worth**, with a mechanism that can actually charge for it.

Doing (3) before (2) is just turning the lights off.

## The flip, for when the edge can charge

Once DNS is on Cloudflare and the site is proxied (orange cloud), the
levers exist in the dashboard rather than in this repo:

- **AI Crawl Control** — see which AI crawlers are actually hitting the
  site, and allow or block per bot. Look before you decide; the traffic
  is rarely who you assume.
- **Pay per crawl** — a per-request price, returned as `HTTP 402` to
  crawlers that have not paid, settled by Cloudflare. This is the piece
  that makes a block worth something.
- **x402** — the open payment rail behind it, so an agent can pay a
  request inline instead of signing up for anything.

When that day comes, the change in this repo is small and belongs in
`robots.txt`: move the named crawlers from `Allow: /` to the mix you
actually want, and keep the directory open regardless — being found is
the point of that particular resource.

**Do not flip anything here first.** `robots.txt` and the Cloudflare
dashboard must agree; robots.txt saying "read it" while the edge returns
402 is a site that looks broken to every crawler and explains itself to
none of them.

## What an agent gets

The one resource here with real use to somebody else is the **fellowship
directory**: real civic and policy programs, each carrying its own
verification state, plus `eu_match_fellowships` — a scored matcher that
takes interest tags and returns programs *with the reason each matched*.
Public reads, no account.

`llms.txt` documents all of it, including the two things an agent must
not get wrong:

- **Most listings are `unverified`,** and most carry no deadline at all —
  a `deadline_note` in plain words instead. An agent that invents a
  deadline here does real damage to a person's application.
- **The shop's open/closed is live state, never a schedule.** There are
  no posted hours. An empty array from `shake_open_window` means closed,
  and a cached page saying otherwise is wrong.

Both of those are stated in `llms.txt` in the imperative, because a
caveat an agent has to infer is a caveat it will not apply.

## Keeping it true

An `llms.txt` is a promise made to a machine that acts on it with no
human reading first. A stale one is worse than none: it sends an agent to
a 404, or has it quote a count that changed six weeks ago, and nobody
notices because nobody looks at the file.

So every factual claim in it is checked:

```bash
python3 tools/verify-llms.py --live
```

- every on-site link resolves to a file that exists in the repo
- every stated count matches the data file it describes
- every topic slug named exists, and every topic in the data is named
- every desk it calls closed is actually disallowed in `robots.txt`
- with `--live`: every documented endpoint answers 200, and the matcher
  returns scored rows with `reasons`

The browser-only half — that the files are actually *served*, and that
the AI policy still says what this document claims — runs in
`scripts/smoke.mjs` with the rest of the release gate.

If you change a count, a link, or the directory, run the verifier. It is
faster than finding out from somebody else's agent.
