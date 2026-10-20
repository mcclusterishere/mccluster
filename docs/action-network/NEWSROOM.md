# The newsroom: your posts as news

Owner, 2026-10-20: "I would like to see about getting my admin's posts as their
own news worth posts and getting them published on GDELT."

## How it works

1. **You tick it.** In the World's composer, the house owner sees one more line
   while writing: "Also publish to the newsroom". Nobody else sees it.
   - The post must be Public.
   - Its first line is the article's headline when it is short (110 characters
     or fewer) and more follows. Otherwise the opening is cut at a word.
   The morning brief's "Publish as my post" (`brief.html`) has the same line
   for the house owner, ticked: the brief goes out as an article with the
   headlines it cites as its sources, marked as drafted with McCluster AI.
2. **The Worker checks it.** `POST /v1/mnet/posts` (`workers/mccluster/src/platform-api.js`)
   accepts the newsroom mark only when the author is the house owner, as the
   database defines it (`mnet_admin_m_uids()`: the primary identity of the
   owner's account). Anyone else asking gets a 403 and nothing is written. A
   scheduled post is checked again when it goes out.
3. **It is an article on McCluster Corp's site.** `https://mccluster.org/news/<headline>-<post id>`
   is rendered on the server by `workers/mccluster/src/company-site/news.js`:
   - the headline, date, byline and story, as plain text, never markup;
   - `NewsArticle` structured data, with McCluster Corp as publisher and
     Matthew McCluster as author, both by their stable `@id`s;
   - the sources, when a morning brief is published as an article, as https
     links only;
   - a line saying so when the article was drafted with McCluster AI.
4. **Crawlers can find it.**
   - `/news/` lists the latest articles.
   - `/news/feed.xml` is the RSS feed.
   - `/news/sitemap.xml` lists every article, and the last two days' carry
     Google News' tags. `robots.txt` names it.
5. **Edits and deletions follow the post.** Editing the post edits the article.
   Deleting it, making it private, or the desk taking it down answers
   410 Gone, so search engines drop it.
6. **GDELT never brings it back.** The World's GDELT ingest skips
   `mccluster.org` and `humanuprise.com` (`BLOCKED_DOMAINS` in
   `workers/mccluster/src/world-news-discovery.js`), so an article is not shown
   twice: once as your post and once as "outside news".

The switch is `NEWSROOM_ENABLED` in `workers/mccluster/wrangler.toml`. With
`"false"`, `/news/*` goes back to redirecting to matthew.mccluster.org.

## Getting into Google News and GDELT (owner steps)

None of these can be done from the code. They need your accounts.

1. **Google Search Console.**
   - Add `mccluster.org` as a domain property. It verifies by a DNS TXT
     record in Cloudflare.
   - Submit `https://mccluster.org/news/sitemap.xml`.
2. **Google News Publisher Center** (`publishercenter.google.com`).
   - Add the publication "McCluster Corp" with the site `mccluster.org`.
   - Add a section pointing at `https://mccluster.org/news/` or the RSS feed.

   Google News picks up articles on its own once the site is known. The
   Publisher Center makes the publication and its name explicit.
3. **GDELT.** GDELT has no form or API for adding a source. It crawls news
   sites it knows and grows its source list over time.
   - The direct route is to write to the GDELT Project (its contact is on
     `gdeltproject.org`; Kalev Leetaru runs it).
   - Ask that `mccluster.org/news/` be added as a source, and give the RSS feed
     and the news sitemap.
   - Being in Google News also helps, since GDELT watches what news
     aggregators carry.
4. **Publish steadily.** Indexes trust a source that publishes original news
   regularly, with a real byline and dates. Your 7am brief, edited in your own
   words and ticked for the newsroom, is exactly that.

What is still open:

- There is no 1200×630 share card for the company. Articles share with the M
  mark, unaltered. A card would come from the owner, never drawn by an agent.
- Google's article rich results prefer a large image.
- Region leaders do not publish to the newsroom. Only the house owner does,
  as asked. Widening that is one line in `newsroomMetadata()` plus a check.
