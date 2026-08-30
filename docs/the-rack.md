# THE RACK: merch.html, printed by Tapstitch

The clothing side of the shop. Same house, same checkout, same desk the
print orders already land on.

    https://matthew.mccluster.org/merch.html

## How the money works

Tapstitch is **pay per order**, no subscription. Every order costs the
house three things, and all three ride inside the price:

    landed  = garment blank + print placement + shipping
    retail  = round( landed × markup )   → nearest $5, floored at $25

Shipping is **inside the price on purpose**. The buyer sees one number and
free delivery, and the house never eats postage. That is the mistake that turns a
merch line into a charity. Tapstitch bills $5.50 for the first item in an
order and $2.00 for each additional one, so a two-piece order clears *more*
than this model assumes, never less.

Everything lives in `data/merch.json > pricing`:

| input | now | what it is |
|---|---|---|
| `printCost` | $5.00 | one print placement |
| `shipping` | $5.50 | first item, US |
| `markup` | 2.0 | multiple of landed cost |
| `roundTo` | 5 | retail rounds to this |
| `floor` | 25 | never sell below this |
| `setSaving` | 10 | knocked off a two-piece set |

Change any one of them and the whole rack reprices itself.

## The rack today

| Piece | Blank | Landed | Retail | Keeps | Margin |
|---|---|---|---|---|---|
| Essential tee | $5.99 | $16.49 | **$35** | $18.51 | 53% |
| Heavyweight tee | $9.99 | $20.49 | **$40** | $19.51 | 49% |
| Oversized hoodie | $14.92 | $25.42 | **$50** | $24.58 | 49% |
| Heavyweight hoodie | $22.99 | $33.49 | **$65** | $31.51 | 48% |
| Long sleeve | $13.00* | $23.50 | **$45** | $21.50 | 48% |
| Crewneck | $19.00* | $29.50 | **$60** | $30.50 | 51% |
| Button-up shirt | $21.00* | $31.50 | **$65** | $33.50 | 52% |
| Denim shirt | $26.00* | $36.50 | **$75** | $38.50 | 51% |
| Work jacket | $34.00* | $44.50 | **$90** | $45.50 | 51% |
| Pleated trousers | $24.00* | $34.50 | **$70** | $35.50 | 51% |
| Jeans | $29.00* | $39.50 | **$80** | $40.50 | 51% |
| Heavyweight sweatpant | $20.00* | $30.50 | **$60** | $29.50 | 49% |

\* **estimates. Confirm these eight inside your Tapstitch account.** They
carry `"verified": false` in the JSON. The four verified blanks came off
Tapstitch's published catalogue on 2026-07-28; cost moves with fabric, cut
and destination, so re-check every one before a real launch. Nothing on the
cut-and-sew side (shirts, trousers, jeans, jackets) is confirmed yet; those
are the six that most need your eyes.

## The sets

A set is a top and a bottom bought as one thing: one price, one parcel, a
size chosen for each piece. The saving comes out of the **shipping line**,
not the margin. Tapstitch bills $5.50 for the first item in an order and
about $2.00 for the second, so two pieces in one parcel genuinely cost the
house less than two separate orders. That's the $10.

| Set | Pieces | Separately | As a set | Keeps | Margin |
|---|---|---|---|---|---|
| The Set | Button-up + pleated trouser | $135 | **$125** | $64.50 | 52% |
| The Denim Set | Denim shirt + jeans | $155 | **$145** | $74.50 | 51% |
| The Crew Set | Work jacket + sweatpant | $150 | **$140** | $70.50 | 50% |

Set prices are **not** typed in anywhere. `MCC_PRICE.setPrice()` reads the
two pieces off the rack, adds them, takes `setSaving` off and rounds, so
correcting a blank cost fixes the piece and the set in the same edit.

A set order lands on the desk as one ticket tagged **set**, naming both
pieces and the size each:

    THE RACK · the-suit · SET · Button-up shirt XL + Pleated trousers S · Black ($125) · SHIP TO: …

## Why Tapstitch and not a blanks printer

Their differentiator is **cut-and-sew with white-label finishing**, which is
the difference between a merch table and a clothing line:

- **Custom woven or printed neck labels**: the buyer never sees Tapstitch's
  name in the collar, only ours.
- **Hang tags and greeting cards**: the unboxing belongs to the house.
- **Acid and snow wash**: faded and lived-in; you cannot fake it with ink.
- **Puff print**: raised and tactile instead of flat.
- **Embroidery**: carries a one-time digitisation fee per design.
- **100+ fashion-grade garments**, including the jeans, formal trousers and
  jackets the sets are built from, plus heavyweight specs (250 GSM
  snow-washed tees, 350 GSM fleece, 380 GSM sweatshirts).

## Owner homework

1. **Confirm the eight unverified blanks** (long sleeve, crewneck,
   button-up, denim shirt, work jacket, trousers, jeans, sweatpant) and fix
   them in `data/merch.json`. Prices and set prices recompute on their own.
   The six cut-and-sew pieces are the ones most likely to move; a set is two
   wrong guesses stacked, so check those before the sets go live.
2. **Order a sample of every piece you plan to sell.** Print-on-demand
   quality swings between garments at the same provider. A bad hoodie
   carrying your emblem costs more than the margin does.
3. **Upload the artwork to Tapstitch** and pull their product mockups into
   `assets/img/merch/`, then point each drop's `art` at the mockup. Right
   now the art is the mark on a black tile. Clean, but a garment photo is
   what actually sells.
4. **Embroidery costs extra.** Tapstitch charges a one-time digitisation
   fee (~$2.99) per embroidered design. The button-up and the trousers are
   authored as embroidered pieces, so put that fee in their blanks once you
   know it.
5. **Set up the neck label and hang tag** before the first order ships.
   That is the whole reason this rack is on Tapstitch rather than a blanks
   printer, and it is a one-time job.

## How an order flows

Buyer picks piece (or set) → size → colour → address. It lands on
**admin.html** in the **Merch** lane, parsed into a ticket (piece, size,
colour, drop, shipping address; a set names both pieces and is tagged
**set**), with the money folded into the same revenue tile as prints. You
invoice, then place the order with Tapstitch and they make and ship it.

Automating that last step (order lands → Tapstitch order created) is the
same work as the print rail in `docs/print-shop.md`: it needs card
checkout first, then a provider API call on `paid`.

## Sources

- <https://www.tapstitch.com/>
- <https://traksource.com/tapstitch-review/>
- <https://ecommerce-platforms.com/articles/tapstitch-review>
