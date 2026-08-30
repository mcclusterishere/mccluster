# THE MISSION FUND: six albums, six programs, a million each

Everything the house takes in runs under **McCluster Corp**, a
Connecticut-registered charitable organization, while the registration
is live. This doc is the operating manual for the fund: the clock, the
meters, the split, and the parts only you can arm.

## The clock (the part that runs itself)

The registration runs through **September 30, 2026**. `js/cause.js`
carries that date, and every money surface asks it before speaking:

- **While live:** the counter's total reads "Your contribution today,"
  the sale copy carries the charity line, pay.html carries it too, and
  give.html shows the open fund with meters and Give buttons.
- **The moment it lapses:** all of that retires itself: plain sales
  copy, meters frozen, Give buttons gone, give.html shows the closed
  sign. **A lapsed license never solicits.** No deploy, no touch,
  nothing to remember on the day.
- **Renewing?** File the CT renewal before Sept 30, then move `EXPIRES`
  in js/cause.js (and `charity.expires` in data/cause.json), and the fund
  reopens on the next page load.

House language rule (already in payments.js, kept everywhere):
**support / contribution wording only, no tax language on the site.**

## The meters ($1,000,000 per album)

`data/cause.json` holds one fund per album (HERE, Heal the 3, Equity
Uprise, PRIM3, Vaunt EP, Whip Equipped), each with a **$1M goal**, its
programs, its Square link, and a `raised` figure. give.html paints the
public meters from it.

- **`raised` is updated by hand** (edit the JSON, push) until the
  Square webhook is built. The meter never invents a number.
- **Square-side goal:** set the same $1M goal on each Square fundraising
  link in the Square Dashboard; their hosted page can show its own
  progress; either way, give.html is the meter of record on your site.
- **Per-album links:** today every fund routes to the live mission-fund
  link (`square.link/u/MBVeuzoo`) with a `?src=fund-<album>` tag so
  giving is attributable per album from day one. When you create a real
  per-album donation link in Square, paste it into that fund's `link`
  in data/cause.json and you're done.
- **Programs:** HERE carries the three you named: Videography,
  Photography, Fashion & runway. Vaunt EP and Whip Equipped say
  "Program to be named" until you name them; edit the JSON.

## The split: 33% reserve · 67% back into the programs

The stated policy, printed on every fund card:

> **33% of every dollar** goes to the **program reserve, held in
> Bitcoin**. **67% is reinvested directly into the programs.** 100% of
> it works.

What "automatically" takes to be true. The honest wiring order:

1. **Today (manual, 10 min/week):** Square balance deposits to the
   McCluster Corp bank account. Once a week, move 33% of that week's
   donations to the reserve: a recurring buy on a custodial exchange
   with a corporate/nonprofit account (Coinbase, River, Swan; River
   and Swan do auto-buy standing orders well). Log each buy.
2. **Semi-automatic:** a standing daily/weekly auto-buy sized to the
   fund's run-rate; adjust monthly against the actual 33%.
3. **Fully automatic (build later):** Square webhook (`payment.updated`)
   → edge function → ledger row per donation with its 33/67 split →
   exchange API executes the buy. Real keys, real custody decisions.
   Worth doing only once the fund has real volume.

Reserve discipline, whichever stage: **corporate account, not
personal**. The reserve is program money; cold-storage withdrawal
policy once it's meaningful; every buy logged (date, USD in, BTC out)
so the 33% is provable at a glance.

## The Equity Uprise business note (your call, on the record)

Your instinct from the voice note: the Equity Uprise committee should
run its own company: a **Wyoming entity with a registered agent**
(Wyoming: no state income tax, strong LLC privacy, cheap agents,
~$100/yr), operated day-to-day with heavy AI tooling, reinvesting its
67% as the for-profit engine beside the nonprofit.

That's a structure decision, not a website feature. It needs a real
formation filing, an EIN, a bank account, and clean books between the
charity and the company (money crossing that line needs paper). When
you're ready to file, the desk can draft the operating agreement
outline and the AI-ops runbook; nothing on the site blocks on it.

## The one date that matters

**September 30, 2026.** File the CT charitable registration renewal
before it, or let the site do what it's built to do and go quiet on
solicitation at midnight.
