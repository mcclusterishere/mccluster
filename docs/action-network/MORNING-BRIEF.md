# The morning brief

Owner, 2026-10-20: "For admin i want all US news summarized so admin can
publish a 'summary of yesterday's events and how they may impact today's
markets, future or whatever' live every morning around 7am EST during my
workout. Each region leader will be doing this so make a summary of each
country's news for the day."

## How it runs

1. **00:20 New York time.** Yesterday is over. The Worker's five-minute cron
   (`seedMorningBriefs` in `workers/mccluster/src/news-briefs.js`) reads
   yesterday's World headlines (`media_news_articles`, from GDELT, kept a week)
   and groups them by the country they mention. Syndicated copies count as one
   story. Each country is sampled to at most 80 headlines, evenly across the
   day.
2. **One Core job per country** is queued in `ops_agent_jobs` (`local_analysis`,
   `target_type = news_brief`, `target_id = <day>:<ISO>`), in this order:
   - the United States, at priority 95;
   - then the countries in `NEWS_BRIEF_COUNTRIES` (85);
   - then each region leader's countries (80);
   - then up to `NEWS_BRIEF_AUTO_MAX` (10) of the busiest others with at least
     `NEWS_BRIEF_MIN_HEADLINES` (15) headlines (40).

   The US job's existence marks the night done.
3. **McCluster Core writes each brief** with its existing `local_analysis`
   executor, on the self-hosted model (capability `ai.chat`).
   - The model sees only the numbered headlines (titles, outlets, tone), never
     a link.
   - It cites the headlines as [n] and treats them as untrusted text.
   - It words "what it may mean today" as possibilities and never advises
     anyone to buy, sell or hold.

   The brief is that job's output. There is no new table, no second memory and
   no paid model.
4. **About 7:00 New York time.** Open `brief.html` (also linked from Control →
   News context). Yesterday's US brief is first. It has four sections, each
   point linked to its headlines:
   - Yesterday in brief;
   - What happened;
   - What it may mean today;
   - Still uncertain.

   - **Read it live.** Full screen, large words, an even scroll you can speed
     up or slow down, and the screen kept awake. The citation marks are
     dropped so it reads aloud cleanly.
   - **Publish as my post.** Opens the brief as an editable post (2,000
     characters at most). It goes on the World feed under your name only when
     you tap Publish.
   - **Write it again**, or **Write this brief** for any country that wasn't
     queued. It runs on demand from that day's headlines and takes a few
     minutes.

Headlines only: no article text is fetched or copied, and every source links
out to its publisher. The brief is a draft by McCluster AI; a person reads it
before saying it or posting it. Nothing here is financial advice.

## Region leaders

The house owner grants a region leader a country by their M handle, in the
"Region leaders" section of `brief.html`. A leader sees, asks for, reads live
and publishes the briefs of their countries only, and their countries are
queued every night. This needs
`supabase/pending/20261020170000_news_region_leads.sql` applied (rollback
beside it). Until then the briefs are the house owner's alone.

## Switches

`workers/mccluster/wrangler.toml`:

- `NEWS_BRIEFS_ENABLED`: the nightly queue. It is `"true"`. Reading and asking
  for a brief work for the house owner either way.
- `NEWS_BRIEF_COUNTRIES`: countries always briefed after the US (comma-separated ISO codes).
- `NEWS_BRIEF_AUTO_MAX`
- `NEWS_BRIEF_MIN_HEADLINES`

The briefs depend on two things already running:

- **GDELT ingest** (`WORLD_NEWS_INGEST_ENABLED`) fills the headlines.
- **McCluster Core's runner on the VPS** writes the briefs. If Core is not
  running, a brief shows "being written" until it is.

## Speed and quality

The self-hosted model takes a few minutes per country, so the US is queued
first and finishes long before 7am. The other countries follow through the
early morning.

If the US brief should read sharper, the `ai.chat` binding can point at a
stronger model without changing this code. That is a cost decision for the
owner.
