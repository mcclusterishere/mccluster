# The shake run

A food delivery shop built into the house, serving one campus:
**Southern Connecticut State University, New Haven.** Not the city, not
the county — the buildings on that campus that somebody has agreed to
walk to.

This document is the operator's copy. If you are the person making and
carrying shakes, everything you need is in **"Opening night"** below.
The rest is for whoever maintains the code.

---

## The rooms

| Page | Who it's for | What it does |
| --- | --- | --- |
| `shakes.html` | anyone | The shop. Sign, menu, cart, checkout, order tracking. |
| `shake-desk.html` | crew | Open and close the run, work the queue, manage stops and prices. `noindex`, and in `robots.txt`. |

The shop took the **fifth tab** in the bar on 2026-08-17. Prayer Closet
and the Inner Room are still one hold away in that same wing, and HITMAN
moved into the map drawer — see *What moved* at the bottom.

---

## The one rule

**Nothing the browser sends is a price.**

The database has **no insert policy on `shake_orders` for anyone**, not
even a signed-in user. The only writer is the edge function running on
the service role. It reads the menu out of `shake_products` and does the
arithmetic itself. A browser cannot create an order at all, so a browser
cannot create a cheap one.

The running total drawn on `shakes.html` is a **preview** computed from
the same menu, so the number on the button matches the number Stripe
charges. If the two ever disagree, the edge function is right and the
page is the bug.

The arithmetic lives on its own in `supabase/functions/shake-order/price.ts`
— no network, no Deno, no Stripe — precisely so it can be tested:

```bash
node --experimental-strip-types supabase/tests/price.test.mjs
```

Nineteen assertions, half of them about what a tampered cart cannot do:
invent a product, invent an option, skip a required one, buy something
sold out, order zero or a thousand, send a price of its own.

---

## Opening night

Do these once, in this order.

**1. Add the buildings you deliver to.**
`shake-desk.html` → *Buildings you deliver to*.

Nothing was seeded here on purpose. A customer can only ever pick a
building from this list — there is no box to type an address into — so
the list is the whole safety model. Add the names people actually use,
not the ones on the campus map, and add a note where the door is not
obvious ("meet at the north entrance").

Until at least one building exists, **nobody can check out.** The
storefront says so.

**2. Check the menu and the prices.**
`shake-desk.html` → *The menu*. Four placeholder items are seeded with
placeholder prices. Set the real ones. "Sold out" hides an item from the
storefront and refuses it at checkout; it never touches orders already
placed, which carry the price they were sold at.

**3. Open a run.**
`shake-desk.html` → *The run*. Set a closing time, a maximum number of
orders, and a delivery fee. Press **Open the run**.

The shop is open only while a window says open **and** the clock is
inside it. Both halves matter: you can close early when you run out of
bananas, and the clock closes it for you when you forget.

**4. Work the queue.**
Paid orders appear in *The queue*, oldest first. Each ticket advances one
step at a time: **Start making → Out the door → Delivered.** Every change
writes a row in `shake_order_events` — where an order got to is a record,
not a memory. The customer's page updates on its own.

The queue refreshes every 30 seconds while the tab is visible and stops
when it isn't, so a phone in your pocket isn't dialling out all night.

**5. Close.**
**Close it now** stops new orders immediately. Orders already paid for
stay in the queue — closing the shop never cancels somebody's shake.

---

## Who sees what

`shake_is_crew()` decides, in the database. It is deliberately **not** the
Equity Uprise `editor` role: civic moderation and a list of which room a
customer is in at 9pm are different trust levels, and the test suite
asserts exactly that ("an Equity Uprise editor cannot see a customer
address").

To put somebody on the crew, from the Supabase SQL editor:

```sql
insert into public.shake_crew (profile_id)
select id from public.eu_profiles where handle = 'their-handle';
```

The owner (`eu_is_admin()`) is always crew and does not need a row.

A customer with no account still gets to ask "where is my shake". That is
the **claim token** — a random string the edge function minted, kept in
their browser, and the only thing the `track` action answers to. It opens
one order and nothing else. It is not a login.

---

## Deploying it

**Already done, 2026-08-18**, against project `zmnhbrjyhxzhkxmhkexs` ("Here"):

- migrations `0017`, `0018`, `0019`, `0020` applied
- `shake-order` and `eu-converse` deployed, both with JWT verification off
  at the gateway (a customer does not need an account to buy a shake, and
  a signed-out visitor has to be able to talk)

The live function was then attacked on purpose. Every one of these was
refused by the deployed endpoint, not by a local test:

| what was tried | what came back |
| --- | --- |
| a cart carrying its own `price_cents: 1` | charged 700 — the sent price was ignored entirely |
| `"size": "free"` | `"free" isn't an option for The House Shake` |
| a product that does not exist | `we don't sell "free-shake"` |
| no size at all | `pick a size for The House Shake` |
| quantity 1000, and quantity -5 | `odd quantity` |
| buying while the shop is shut | `The shop is closed right now.` |
| an invented claim token | `no such order` |

**One secret is still yours to set**, because it is yours and nobody else
should ever hold it:

```bash
supabase secrets set STRIPE_SK=sk_live_...        # the till
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # the listening desk
```

Until `STRIPE_SK` is set, the menu, the quote and the tracking all work —
only taking payment fails. The shop is not broken without it, it just
cannot charge.

JWT verification is **off at the gateway** because a customer does not
need an account to buy a shake. A signed-in buyer is still resolved
inside the function against GoTrue — never by decoding the token, since
an unverified `sub` is a suggestion — so their order attaches to their
profile.

Verify against a throwaway Postgres before anything goes near the live
project:

```bash
bash supabase/tests/run-eu-tests.sh    # migrations 0017-0020 + 39 assertions
node --experimental-strip-types supabase/tests/price.test.mjs
node scripts/smoke.mjs                 # the release gate, 364 assertions
```

### A gap worth knowing about

The local test cluster creates `anon` and `authenticated` with narrow
grants. **Production does not** — Supabase grants those roles ALL
privileges on every table in `public` by default, so the narrower grants
in these migrations are additive and largely decorative. RLS, not the
grant, is what actually holds.

That is a real difference between the test rig and the live database, so
the privacy claims were re-proven **against production** rather than
inferred: as `anon` and as a signed-in non-crew stranger, on the live
project, writing an order failed, reading orders returned nothing,
reading contact rows returned nothing, minting a profile failed, and
repricing the menu failed — while the menu, the topics and the fellowship
directory all read normally. If you change a policy, re-run that check on
the live database, not only locally.

---

## The files

```
supabase/migrations/0019_shake_delivery.sql   6 tables, all RLS, + shake_open_window
supabase/migrations/0020_harden_function_surface.sql  trigger fns off the public RPC surface
supabase/functions/shake-order/index.ts       the only writer of an order
supabase/functions/shake-order/price.ts       pure pricing, tested
supabase/tests/price.test.mjs                 19 pricing assertions
js/shakes.js                                  the data layer (borrows MCC_SUPA)
shakes.html / shake-desk.html                 the two rooms
css/shakes.css                                sign, menu, cart, rail, tickets
data/shakes.json                              the static menu mirror
```

**The menu falls back** to `data/shakes.json` so the shop window paints
before the database answers. **The open/closed state never falls back.**
"Are we open" has exactly one honest answer and it is the live one; no
answer means closed, because a shop that guesses "open" takes orders
nobody is going to walk.

---

## What moved, and where it went

Three things changed position when the shop took the fifth tab. All three
are still reachable; the smoke suite has an assertion for each.

- **Prayer Closet** and **the Inner Room** are slots two and three of the
  fifth wing. Hold the tab.
- **The current drop** lost its wing slot. It is the lead card on
  `prayer-closet.html` and is named in the map drawer.
- **HITMAN** had no other door in the entire house — `js/theme.js` used to
  rewrite the fifth tab into it after boot, and that override is retired.
  It is now a room in the map drawer under *The house*. Deleting that line
  orphans the page.

The fifth tab wears a **drawn cup**, not the halo mark. Putting the
Prayer Closet's halo over a milkshake would have been the wrong claim to
make with that mark.
