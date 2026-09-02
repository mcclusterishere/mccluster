# The store: Shopify + TapStitch

The site side is already built and tested. This is the half that needs
your account and your card, written so it can be done in one sitting.

## Why it is not "connect TapStitch to mccluster.org"

TapStitch does not connect to a hand-coded site. Its integrations are all
storefront platforms — Shopify, TikTok Shop, Etsy, Wix, Squarespace,
WooCommerce, Shoplazza, BigCommerce — and its API is the pipe *between*
one of those and their factory, not a widget you drop into a page. There
is no public order API for custom sites, no hosted storefront, and no
shareable checkout link.

So the shape is: **Shopify holds the products and takes the money.
TapStitch watches Shopify, makes the garment, ships it, and pushes the
tracking number back.** mccluster.org sends people to the product page
and stays the place the story is told.

## What it costs

- Shopify Basic, about $29–39/month (annual billing is cheaper).
- TapStitch is free to install; you pay per item only when one sells.
- Shopify takes a card-processing cut per order on top.

That subscription is the real decision. Until it is paying for itself,
the Square path below still works and costs nothing.

## The setup, in order

1. **Create the Shopify store.** Any plan that allows apps. Name it
   whatever the checkout should say to a buyer.
2. **Install TapStitch** from the Shopify App Store and connect it. Two
   clicks; it asks for permission to read orders and write products.
3. **Build each drop in TapStitch**, not in Shopify — pick the garment,
   upload the artwork per placement, set the size range. The files are
   already in this repo:
   - front / back: `assets/img/closet/<slug>/`
   - the per-placement list, with method and production notes, is each
     drop's `placements` array in `data/prayer-closet.json`
4. **Push to Shopify** from TapStitch. It creates the product with one
   variant per size. Set your retail price there — Shopify owns the
   price, and nothing in this repo should ever restate it.
5. **Copy the product URL** (`.../products/<handle>`).
6. **Paste it into the ledger.** In `data/prayer-closet.json`, on that
   drop's `preorder` block:
   ```json
   "shopify": "https://your-store.myshopify.com/products/heav-yeah-set",
   "deposit": 333
   ```
   That is the whole change. No deploy of code, no template edit.
7. **Point the domain** (optional): a `store.mccluster.org` subdomain on
   the Shopify store keeps the checkout on your name.

## What happens on the site the moment you paste that link

Verified in a browser, not assumed:

- The drop's rail card flips from its quiet status to **Preorder open**.
- The Acquire room replaces first-claim capture with a live checkout
  button reading **Preorder through the store →**.
- The deposit chip reads `$333 · preorder · through the store`.
- The sizing term describes the checkout that is actually open. It used
  to promise *"chosen by email right after checkout"*, which was true of
  a bare payment link and of nothing else. The live Square links now
  carry size and colorway as custom fields, and Shopify takes size as a
  variant, so the line reads **"size & colorway: both chosen at
  checkout."** A site that promises a step which no longer happens is
  worse than one that says nothing.

`shopify` outranks `square` on each option, so switching over is one
paste and never a delete. The Square links stay underneath as fallback.

## Two prices, one drop

The drop sells as a hoodie ($66) or a full set ($120), so `preorder`
carries an `options` list rather than a single link — each entry with its
own price and its own `square`/`shopify` pair. **One option can move to
Shopify while the other stays on Square.** A drop with no `options` falls
back to the single `preorder.square` shape.

Square caps a payment link at **two custom fields, 50 characters each**,
which is why the set's link asks one combined "Sizes: hoodie / joggers"
question instead of two separate ones. On Shopify this stops being a
constraint — sizes become real variants.

## The order flow once it is live

1. Buyer taps through from the Closet and checks out on Shopify.
2. TapStitch picks the order up automatically and starts production.
3. Tracking is pushed back to Shopify; the buyer is emailed by Shopify.
4. You do nothing per order. That is the whole point of the subscription.

## If you want to start earning before the subscription

Fill in `square` instead of `shopify` on a drop — a payment link from
Square Dashboard → Payment Links. The room goes live the same way; the
difference is that sizes come back by email and you place the TapStitch
order by hand. Drop 001 has been running exactly like this. Moving it to
the store later is step 6 above and nothing else.

## Files this touches

| What | Where |
|---|---|
| Which checkout carries a drop | `data/prayer-closet.json` → `drops[].preorder` |
| The one function that decides | `js/closet.js` → `checkoutOf()` |
| The rail's "Preorder open" chip | `prayer-closet.html` → `preOpen()` |
| Artwork and mockups | `assets/img/closet/<slug>/` |
| Placements, methods, production notes | `data/prayer-closet.json` → `drops[].placements` |
