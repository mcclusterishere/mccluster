# sites-economics: what a client actually costs, and what to charge

The question that started this: "what is a fair price for their database use?"

The short answer, from reading this repo's own backend: **stop pricing the
database.** Include it in every lane. It is not the cost. Your time is the
cost, and media is the only thing that can surprise you.

Numbers verified August 2026 against supabase.com/pricing, the GitHub Pages
limits page, resend.com/pricing, and porkbun. Re-check before you bet on
them: this is the kind of page that ages.

## The finding that changes the math

`supabase/migrations/0008_site_requests.sql` runs **one project for every
client**. `site_accounts` and `site_requests` are keyed by `user_id` with
row level security, so a client reads their own row and nothing else. That
is a multi tenant platform, not a project per church.

So the database bill does not grow per client. It is a **fixed** line.

| Line | What it costs | Per client? |
| --- | --- | --- |
| Supabase Pro | $25 a month per organization, includes $10 of compute, which covers one Micro instance | No. Fixed. |
| A bigger instance, when traffic earns it | Small runs about $15 a month of compute, so about $30 a month all in | No. Fixed. |
| GitHub Pages | Free. 1 GB a site, 100 GB a month of bandwidth, soft limits | No |
| Resend, if mail leaves a client's own domain | Free covers 3,000 sends and one domain. Pro is $20 a month and covers ten domains | No. Fixed, until domain eleven. |
| A domain, when you register it for them | About $12 a year, so about $1 a month | Yes, and it is a dollar |

## What that means at your ladder

Hosting is $79.99, Web Management is $149, Management and Social is $400.
Fixed platform cost is about $45 a month once mail is on its own domains.

| Clients | Revenue at the lowest lane | Platform cost | Kept |
| --- | --- | --- | --- |
| 1 | $79.99 | about $46 | about $34 |
| 5 | $400 | about $50 | about $350 |
| 10 | $800 | about $55 | about $745 |
| 25 | $2,000 | about $70 | about $1,930 |

The first client carries the whole platform. Every client after that is
almost pure margin. That is the real argument for the founding seats: the
free build is not generosity, it is how you get past client one fast.

Two things follow from the table. Do not discount below $79.99, because at
one client there is nothing to discount from. And do not fear a client with
a busy site: rows and requests are free at this scale.

## The only two things that can actually cost you

**1. Media.** Supabase egress is 250 GB a month included, then about $0.09
a GB. A church that uploads a year of sermon video to the bucket is the one
client who can turn a $79.99 lane upside down. The rule, and it is a design
rule, not a preference:

- Photos live in the site's own repo and ship over Pages. Free.
- Sermon video lives on YouTube, or on a video host built for it. Never in
  the database bucket.
- The bucket is for small things: a logo, a PDF, an upload a client filed
  through the console.

Follow that and one $25 project carries fifty sites without noticing.

**2. Your hours.** Four requests a month at $149 means you sold about an
hour and a half of attention. That is the number to watch, not gigabytes.
The $29 extra request price and the "requests do not roll over" line in
`data/sites.json` are already the right guardrails. Keep them.

## What to change in the terms

Add a fair use line to `data/sites.json` terms, in plain words:

> Fair use: the plan covers a normal church or small business site. Large
> video libraries, mass email, and heavy storage get quoted on top.

That single sentence is the whole protection. It never comes up with a
normal client and it saves the one outlier conversation.

## The free tier trap

Supabase pauses a free project after about a week without database
activity. A paying client on a free project is a support call waiting to
happen, and it is the kind that costs trust rather than money. Paying
clients belong on the Pro organization. That is what the $25 buys: the
promise that nothing sleeps.

## What the market charges, for the record

Managed church sites cluster at $97 to $99 a month (Nucleus $99, Ministry
Designs $97, ReachRight $97 plus a setup fee). Do it yourself builders sit
at $17 to $39 with no one doing the work. WordPress care plans run $89 to
$359 a month and do not include the build.

Your $149 lane sits under the managed crowd while including a build they
charge two thousand dollars and up for. That is not underpriced. It is
priced to win the first ten, which is exactly the right move while seats
are the story.
