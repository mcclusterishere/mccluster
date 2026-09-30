# Artist ecosystems — exploration (first artist: Rashawn Hendricks)

Status: **exploration branch**, `explore/artist-ecosystem-rashawn-hendricks`. Not linked from the house. Migration and edge functions are written and tested locally but **not applied or deployed**.

Not legal advice. The commerce section is a map of where the risk sits so the
owner can take specific questions to a securities/consumer-protection lawyer and
an accountant. It is not a clearance.

## The idea

Every artist gets a front end that feels like their own place, built on the
McCluster back end instead of beside it:

- click an artist → you land in **their** room, branded as them;
- you sign in with the **same M Account** you use everywhere;
- their music plays on the **same engine**; the Music section is the shared
  commercial room where every artist's room meets, and the way back to the house;
- their people are on the **same M Network**;
- later: their merch, their backers, their fans selling for them.

The old Street Credit Bureau idea (the artist's profile is a "stock") is covered
under *Pulse*, below, because the wording there carries most of the legal risk.

## What already exists, and what the room reuses

The platform law already describes this: "A customer application built on
McCluster can feel like its own ecosystem without creating duplicate people"
(`docs/architecture/identity-network.md`). So this is mostly assembly.

| Need | Existing piece | Used by `artist.html` |
| --- | --- | --- |
| One login everywhere | `js/mcc-auth.js`, `m_people`, `platform_profiles.mccluster_id` | yes: Sign in with M, same session |
| Per-artist membership, no second username | `platform_user_apps`, `org_members`, `m_touch_app` | not yet: needs the org/app rows below |
| The artist's catalogue | `music_creator_profiles` + `creator_tracks` (`music-creator.html?handle=`) | yes: same public read |
| Shared player | `js/music-engine.js` (`MCC_MUSIC.registerCreatorTrack`) | yes |
| Social | M Network (`mnet.html`, `network_*` tables) | linked; per-artist feed needs a route |
| Paid things | Stripe Checkout + `music_orders` / `music_entitlements` pattern | not yet |
| Payouts to the artist | Stripe Connect (`docs/connect-saas.sql`) | not yet |
| A "pulse" of the artist | `docs/music-pulse.sql`, `play-counts.sql` | tiles only, honest numbers |

**On "make a username on his side":** the identity law says no. There is one
McCluster ID per person. Entering Rashawn's room records a *membership*
(`org_members` / `platform_user_apps`), not a new account, and it is also the
easiest thing on the database: no sync, no duplicate profiles, one password.
His room can still greet you by your McCluster ID and keep per-room state
(what you backed, your referral link) keyed to your `m_uid`.

## What was built on this branch

- `artist.html?a=<slug>` — the room. Config-driven, mobile-first, verified at
  390px (`scrollWidth === clientWidth`) and 1280px.
- `js/artist-ecosystem.js` / `css/artist-ecosystem.css` — brand, music (shared
  engine), social, shop, backer ledger, store credit, referral link.
- `data/artists/rashawn-hendricks.json` — his config. Instagram:
  `@rahndrx`. Every field he has not supplied is `null` and renders as absent.
  No bio, photo, colour or mark was invented, and no logo is drawn.
- `supabase/migrations/20260930120000_artist_ecosystems_commerce_v1.sql` —
  rooms, products, orders, backer ledger, referral links/attributions, and the
  SECURITY DEFINER functions that do all money math. **Not applied yet.**
  Tested on a local Postgres: applies twice cleanly; referral credit, credit
  spend, abandoned checkout, refund clawback, replayed webhooks, self-referral
  and limited editions all behave; browsers cannot write any of it.
- `supabase/functions/artist-checkout` — new. Direct charge on the artist's
  connected account with an application fee. **Not deployed yet.**
- `supabase/functions/stripe-webhook` — settles/cancels/refunds artist orders
  and accepts an optional `STRIPE_CONNECT_WEBHOOK_SECRET`.
- `scripts/test/artist-ecosystem.test.mjs` — locks the money rules in.

## The Stripe marketplace configuration

McCluster Corp is the Stripe **platform**. Each artist is a **connected
account**. This is the same model `org-connect-onboard` + `l3-checkout`
already run for Level 3 Media, so nothing new is invented.

```
fan ──Checkout──► DIRECT CHARGE on Rashawn's connected account
                     │  Rashawn = merchant of record: his name on the card
                     │  statement, his sales tax, his refunds and disputes
                     └─ application_fee_amount ──► McCluster Corp (platform fee)
```

Why direct charges and not destination charges or "separate charges and
transfers": with those two, the **charity** is the merchant of record and the
whole sale passes through its books before it is paid out. With direct charges
the charity's books only ever show its fee. That is the cleanest line for a
501(c)(3), and it is why referral rewards are store credit (a discount on the
artist's own account) rather than cash the charity would have to pay out.

Money per $40.00 sale, default settings (`platform_fee_bps` 1000, editable per
room, capped at 30% by the schema):

| | |
| --- | --- |
| Fan pays | $40.00 (minus any store credit they choose to spend) |
| McCluster platform fee | $4.00 |
| Stripe processing | taken from Rashawn's side of a direct charge |
| Rashawn keeps | the rest, paid out by Stripe on his schedule |
| Referrer (if any) | $4.00 store credit in Rashawn's room (`referral_credit_bps` 1000) |

### One-time setup in the McCluster Stripe dashboard (owner)

1. **Connect → Settings**: platform profile set to *marketplace*; business
   name McCluster Corp. Branding (icon, colour) from the supplied M artwork.
2. **Connect → Onboarding options**: Express accounts, US, capabilities
   `card_payments` + `transfers` (what `org-connect-onboard` already requests).
3. **Developers → Webhooks → Add endpoint** pointing at the existing
   `stripe-webhook` function, with **"Listen to events on Connected
   accounts"** turned on. Events: `checkout.session.completed`,
   `checkout.session.expired`, `payment_intent.payment_failed`,
   `charge.refunded`, `account.updated`. Copy its signing secret into the
   Supabase secret `STRIPE_CONNECT_WEBHOOK_SECRET`. Without this, artist
   orders are charged but never marked paid.
4. Optional, per artist: Stripe Tax on the artist's account, then set
   `config.stripe_tax = true` on their `artist_ecosystems` row.

### Going live for Rashawn (in order)

1. Owner approves and applies the migration; deploy `artist-checkout` and the
   updated `stripe-webhook`.
2. Rashawn creates or uses his M Account.
3. Operator creates his org and makes him owner (`orgs`, `org_members` role
   `owner`), then inserts his `artist_ecosystems` row (status `draft`).
4. Rashawn runs payout setup (`org-connect-onboard` with his `org_id`). Stripe
   collects his identity, bank and tax details. The checkout refuses to sell
   until that account reads `ready`.
5. Add his products (`artist_products`, status `live`), flip the room to
   `live`. The shop, ledger and referral links light up.
6. Test end-to-end in Stripe test mode first: buy, abandon, refund, referral.

## Found while building: signed-out creator profiles are broken in production

A signed-out read of `music_creator_profiles` returns
`42501 permission denied for function current_m_uid`. The read policy is
`status='active' or m_uid=public.current_m_uid()`, and the live database no
longer lets `anon` execute `current_m_uid()` even though
`20260913034132_harden_security_definer_execution_surface.sql` grants it. That
means the existing `music-creator.html?handle=…` shows "Creator not found" to
every signed-out visitor today, and this room would too. Fix on `main`, not
here: either restore `grant execute on function public.current_m_uid() to anon`
or split the policy into an `anon` policy (`status='active'`) and an
`authenticated` one. Same check applies to `creator_tracks`.

Also worth a look on `main`: `music-checkout` charges on the **platform**
account and only records a `creator_net_cents` figure, so for music licences the
charity is currently the merchant of record for creators' sales. The artist
rooms avoid that; music licensing should probably move to the same
direct-charge pattern.

## The commerce ideas, ranked by how safe they are right now

The goal stated: legal **now**, **free** (no paid registrations or
certifications), fans can **track what they put in and what they got**, and
fans can **sell for the artist**.

### Green — do these

1. **Rewards backing (Kickstarter-style), not investment crowdfunding.**
   Fans pay now for merch/music to be made; they receive the items plus
   non-financial perks (numbered backer wall, early access, credits in the
   liner notes). No registration is needed because nothing financial is
   promised back. *Investment* crowdfunding (Reg CF) requires a registered
   funding portal or broker-dealer, which is exactly the paid gatekeeping you
   want to avoid.
2. **A backer ledger.** "You have put in $X across N drops; you received A, B,
   C; you are backer #214 of drop 3." That is order history with pride, and it
   is what the fans actually want from "tracking their investment". Call it a
   ledger or your backing, never a position, stake, portfolio or holdings.
3. **Numbered, limited, provenance-tracked pieces.** Treating each item as an
   artwork (edition 17/100, certificate, who owned it) is fine. Scarcity is
   fine. Promising what it will be worth is the problem (see red).
4. **Single-level referral commission.** A fan shares their link; when a real
   customer buys, the fan earns a set commission or store credit. This is the
   ordinary affiliate program. Requirements: the fan discloses it
   ("I get paid if you buy") under the FTC Endorsement Guides; no fee to join;
   no inventory the fan must buy; pay only on real sales to end customers.
5. **"Bring me a customer, get a better price next time"** — your studio-time
   move — as a referral reward in store credit. Fine.

### Yellow — possible, needs design and a lawyer's eye

6. **Fan storefronts with the fan's own price (the $30 → $60 idea).** Make it
   honest and it works: the fan has a shop ("@fan's shop"), sets a price, the
   artist receives the base price, the fan keeps the spread. The customer sees
   one clear price in a shop that is plainly the fan's.
   What makes it risky is the version where a **cookie hides the $30 price**
   from people the fan referred so they can only ever see $60. Personalised
   hidden pricing driven by tracking invites deceptive-practice claims under
   the FTC Act and Connecticut's CUTPA, plus cookie-consent problems. Keep
   the artist's own shop publicly at $30; the fan's shop is a separate shop.
   Who collects sales tax depends on whether the fan or the platform is the
   seller of record (platforms that facilitate third-party sales are generally
   treated as "marketplace facilitators" for sales tax).
7. **Two levels ("the homie gets half of what you mark up").** Commission on
   your recruit's sales is where multi-level-marketing scrutiny starts. It is
   legal only while pay comes from real retail sales to outside customers, not
   from recruiting and not from people buying stock to qualify. Cap it at two
   levels, never pay for sign-ups, never require a purchase to participate,
   and publish what fans actually earn.
8. **Fan-to-fan resale marketplace.** Reselling what you bought is your
   right. Running the marketplace means holding and moving other people's money
   (use Stripe Connect so Stripe is the regulated party), sales tax as a
   facilitator, and fraud/chargebacks. More importantly, a platform-run
   marketplace plus artist hype about rising prices is how collectibles turn
   into securities (next section). Defer until 1–5 are running.

### Red — not without a securities lawyer and real money for compliance

9. **Calling it an investment, "being vested", or the artist as a stock.**
   The test US regulators apply (the *Howey* test) asks: did people put in
   money, into a common enterprise, expecting profit from someone else's
   efforts? Merch sold as "your investment in Rashawn" with a tracked value
   that rises as he blows up answers yes to all three. In 2023 the SEC treated
   NFT collectibles sold that way (Impact Theory, Stoner Cats) as unregistered
   securities. The words matter, and so do the mechanics.
10. **A house buyback price** — especially a schedule where the buyback value
    moves as retail price rises. A guaranteed cash buyback turns the item into
    something with a redeemable financial value, i.e. an instrument. It also
    creates an unfunded liability: if 500 people ask for their buyback on the
    same day, the house owes it. If some trade-in is wanted, make it **store
    credit only**, flat, not advertised as a return, and not tied to price.
11. **Anything that looks like shares, units, dividends, revenue share or an
    "IPO".** Revenue sharing with fans is a security. Full stop.

### The charity question

McCluster Corp is a Connecticut public charity. Running a for-profit artist's
merch sales, affiliate commissions, or a resale market through the charity
raises private-benefit and unrelated-business-income questions. Rashawn's sales
should settle to **his** Stripe Connect account (his entity), with any platform
fee going to whichever McCluster entity the accountant says should earn it.
Ask before money moves.

## Pulse, not stock

The Street Credit Bureau front-profile-as-stock is a great visual. Keep the
visual, drop the instrument: a **Pulse** strip with real numbers (releases,
plays, backers, next drop). No share count, no price per unit, nothing to buy
or sell, no arrow implying returns. `docs/music-pulse.sql` and the play-count
tables already hold most of it. The room shows `–` rather than a number it
cannot back.

## Still out of scope

Cash referral payouts, fan storefronts at their own price, multi-level
commissions, a fan resale market, any buyback. Each is in yellow or red above
and needs a lawyer and the accountant before code. Before any cash moves to
fans, the accountant decides whether the charity may pay them at all.
