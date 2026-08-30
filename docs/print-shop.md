# THE PRINT SHOP: how it runs today, how it arms

## Live now (no keys needed)

prints.html sells every photo three ways: physical prints (5×7 $15 ·
8×10 $25 · 11×14 $40 · 16×20 $55 · 24×36 $85), PNG personal-use $15,
full-res + print rights $40, RAW + commercial rights $250.

**Pricing is automated** (js/prices.js). Print retail is *derived*,
never hand-typed: `retail = round((labCost + handling) × printMarkup)`,
floored and rounded to a clean number. The inputs live in
data/prints.json > `pricing{}` (printMarkup 2.5 · handling $3 · round $5
· floor $12) and each size carries its `cost`. Change a cost or the
markup and every price recomputes on load: affordable for the buyer,
margin locked to real cost so it can never quietly go underwater.
Digital prices are authored directly (near-zero cost = pure margin).

Today's flow: buyer picks a format, prints collect a shipping address,
the order lands on crm.html structured like
`PRINT SHOP · rally-03 · 16×20 print ($110) · SHIP TO: …`, and the
owner invoices from the desk (Stripe invoice or Square), then:
- prints: place the lab order manually (or wait for the armed rail)
- PNG/full-res: email the file
- RAW: email the file + license note within 24h

## The armed era (three keys, in order)

1. **Migration 0004** (this repo) creates `print_orders` + the private
   `masters` storage bucket; it applies via the migration rail or the
   Supabase connector when either is live.
2. **Stripe checkout**: an edge function creates a Checkout Session
   (shipping address collection ON for prints); stripe-webhook catches
   `checkout.session.completed` → marks the order `paid`.
3. **Prodigi** (print API: prodigi.com, free account, pay per order):
   `PRODIGI_API_KEY` goes in Supabase function secrets. On `paid`
   print orders the webhook posts to Prodigi's order API with the
   print-ready file URL + address; Prodigi prints/ships/webhooks
   tracking back → order shows `shipped` + tracking on the desk.
4. **Digital delivery**: on `paid` digital orders, generate a signed
   expiring URL from the `masters` bucket and email it (Resend
   connector is authorized for this). RAW orders attach the license
   text automatically.

Masters upload: RAW/full-res files go to the `masters` bucket via the
dashboard (Storage → masters) named `<photo-id>.<ext>`, e.g.
`rally-03.dng`, `rally-03.png`. The delivery rail matches on photo id.

Owner-only errands: Prodigi account + API key into function secrets;
upload masters; keep prices honest in data/prints.json.

## Lab cost reference (so prices stay profitable)

8×10 runs about $6 to $9 · 11×14 about $10 to $14 · 16×20 about $14 to $20 · 24×36 about $25 to $35, plus
$5 to $12 shipping. Current ladder clears healthy margin at every size.
