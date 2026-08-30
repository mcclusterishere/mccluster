# SQUARE CHECKOUT: arming the store's register

You asked whether Square has an API. **It does**, and the house already
banks with Square (the music tips run through `square.link` in
js/payments.js). This function puts the print shop on the same rail:
every order checks out on a Square-hosted page (card, Apple Pay,
Google Pay, Cash App Pay), settles into the **Square balance**, and
deposits to the linked bank on Square's normal schedule (next business
day, or instant for their fee).

The code is at `supabase/functions/square-checkout/index.ts`. Until it
is deployed, nothing is broken: the counter tries Square first, waits
3.5 seconds at most, and falls back to the **live Stripe pay-now rail**
(pay.html → Stripe Checkout → your bank). Deploying this function is
what flips the store from Stripe-fallback to Square-first.

## Arm it (10 minutes)

1. **Get the token.** developer.squareup.com → your application (or
   "+ New application") → **Production** tab → copy the *Production
   Access Token*. While there, note the **Location ID** (Locations tab,
   or Square Dashboard → Account → Locations).
2. **Deploy the function.** Supabase Dashboard → Edge Functions →
   New function → name it exactly `square-checkout` → paste the code →
   Deploy. Turn **JWT verification OFF** (the counter calls it with the
   public anon key, same as pay-now).
3. **Set the secrets.** Edge Functions → square-checkout → Secrets:
   - `SQUARE_ACCESS_TOKEN`: the production token
   - `SQUARE_LOCATION_ID`: the location id
   - `SQUARE_ENV`: leave unset (production). Set `sandbox` only when
     testing with a sandbox token.
4. **Test with a dollar.** Open any frame → place a $15 PNG order →
   checkout should land on a `checkout.square.site` page. Pay it with a
   real card, refund it from the Square Dashboard after.

## What the buyer sees

Order placed in the counter → Square's hosted checkout with the order
name ("PRINT rally-01 · 8×10 print") → pays → lands back on
account.html. The CRM lead was already filed before checkout opened, so
the desk can match the Square payment to the order by name and amount.

## The honest print

- **Fees:** Square online payments run ~2.9% + 30¢ (same neighborhood
  as Stripe). No monthly cost for any of this.
- **Refunds/chargebacks** are worked from the Square Dashboard.
- **Shipping address** is collected by Square at checkout
  (`ask_for_shipping_address: true`) *and* by the counter for prints.
  The two should match; the counter's copy is what the desk ships to.
- The function caps orders at **$5,000**. Raise it in index.ts if the
  shop ever sells above that.
- Keep the access token in Supabase secrets only. It never belongs in
  this repo, and it can be revoked and rotated from the Square app page
  any time.

## Later, if wanted

- **Webhooks:** Square can POST `payment.updated` to another edge
  function to flip `print_orders.status` to `paid` automatically
  (today the desk works from the dashboard + CRM note).
- **Square Customers API:** profiles created on the site could be
  mirrored into Square's customer directory for receipts and
  marketing, one call per signup.
