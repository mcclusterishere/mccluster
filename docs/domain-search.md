# domain-search: typing the address before buying it

The domain and hosting card said **Get the address** and then took $66 for
an address nobody had looked up. A buyer could pay the first month of
hosting for a name registered in 1998 and find out afterwards. This is
what replaced that.

## The shape

Type a name into the card → the registries are asked → each ending comes
back free or taken, with its price → pick one → the button carries it into
checkout.

```
sites.html  ──►  js/offers.js          the box, the results, the button
                      │
                      ▼  POST {name}
        supabase/functions/domain-check
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
  domain_tlds   domain_lookups   rdap.org ──► the registry that holds the TLD
  what we sell   the 6h cache     RFC 7480: 404 free, 200 taken
```

Nothing here is a registrar. RDAP is the registries' own read-only
protocol — free, open, no account, no key.

## The four answers, and why the third one exists

| Registry says | The card says | The button |
| --- | --- | --- |
| 404 | Available, `$33/yr` | `pay.html?offer=…&for=name.com` |
| 200 | Taken, struck out, disabled | the plain checkout, no name on it |
| anything else | "Couldn't check that one just now" | the plain checkout, no name on it |
| 404, ending we quote rather than sell | the ending's own sentence, **no price** | `onboard.html?…&domain=name.io` |

The third row is the one that matters. A 429 from a rate limit, a timeout,
a 500 — none of those mean the name is free, and reading them as free sells
somebody an address that belongs to a bank. `readRdap()` returns three
values, not two, and `available` is `boolean | null` all the way down to the
column type. `supabase/tests/domain.test.mjs` asserts it for eight different
non-answers.

## Where the money lives

`public.domain_tlds` — one row per ending, `sellable` and `price_usd`.
A check constraint refuses a sellable row with no price.

The card offers a one-tap purchase **only when the registry price equals
the ledger's own domain figure** (`offers.json` → runway →
`pricing.start.components[domain].amount`, $33). If those two ever
disagree, the name is still shown as available and still routes to the
questions — it just never becomes a button. A card that shows one number
and charges another is the exact fault the buy cards were rebuilt to remove.

Adding an ending is an `INSERT`, not a deploy.

```sql
insert into public.domain_tlds (tld, sellable, price_usd, note)
values ('church', false, null, 'Available. Priced with you.');
```

## What holds it up under load

- **Cache.** Every answer is kept 6 hours (2 minutes for a non-answer, so a
  registry's bad moment does not make a name unanswerable all afternoon).
  A hundred people typing the same obvious name is one lookup.
- **Retry.** One retry, 700 ms apart, and only on a non-answer. A 200 or a
  404 is the registry speaking and is never retried.
- **Fan-out cap.** A bare name checks at most 4 endings. A named ending
  checks 1.
- **Throttle.** `domain_rate_take()` — a fixed one-minute window, 40 per
  caller, counted **before** the lookup. Keyed on a salted hash of the IP,
  never the IP and never the name searched: this table exists to stop abuse,
  and a log of who searched what from where is a different, worse thing to
  be holding.

## The gap this does not close

**Nothing is registered automatically.** There is no registrar account and
no registrar API in this build. The search tells you a name was free at the
moment it was asked; the desk registers it by hand after the payment lands,
and the chosen name rides to Stripe on the checkout's `for=` note so it is
on the session, the receipt and the dashboard.

The card says this out loud rather than letting a buyer assume otherwise:

> Checking an address does not hold it. This one gets registered in your
> name once the payment lands.

**Open question for the owner:** what happens in the gap. If a name goes
between checkout and registration, the buyer picked something they cannot
have. Refund the domain line, credit it to hosting, or pick again — that is
a policy call, not a code one, and no promise about it is written anywhere
in the repo until it is made.

## Running the tests

```
node --experimental-strip-types supabase/tests/domain.test.mjs   # 32, no network
node scripts/sites-buy-smoke.mjs                                 # 128, registry stubbed
```

The registry is stubbed in the browser test on purpose. What is under test
is what the **card** does with an answer; a test that needed the real
internet to say "taken" would be testing whether google.com is still
registered.
