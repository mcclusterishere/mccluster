// ============================================================
// SUPERSEDED — SCHEDULED FOR RETIREMENT, STILL DEPLOYED AND LIVE
//
// docs/here-inventory.md and docs/architecture/current-state.md both
// already record this function as superseded by `checkout`, to be
// retired once `checkout` deployed. `checkout` deployed. This did not
// get retired, and has been serving traffic ever since.
//
// It belongs to the marketplace era of `mcclusterishere/Here`, which
// CLAUDE.md rule 11 says publishes nothing. Its SITE constant still
// points at that dead GitHub Pages origin, so its success and cancel
// redirects land nowhere.
//
// It reads `public.providers`, which holds ZERO rows, and
// `public.payments` also holds zero — no payment has ever completed
// through this path.
//
// This copy exists so that deleting the deployed function is a
// reversible act rather than a loss. Read the retirement note in
// docs/control-plane/AUTHZ.md before changing anything here.
// ============================================================
// PAY-NOW v4 (Here) — creators keep 100%. The buyer's all-in price
// carries the platform's 10% spread; the charge runs on the platform
// account and transfer_data.amount locks the creator's exact rate.
// Stripe's fee comes out of the spread — never the creator's money.
// Server resolves the payee and computes the split; nothing
// client-supplied is trusted but the buyer's all-in amount.
//
// SECURITY NOTE ADDED 2026-09-07, NOT PRESENT IN THE ORIGINAL:
// verify_jwt is FALSE on this function. An anonymous caller can mint a
// Stripe Checkout session on the platform account for any amount, with
// an attacker-chosen product `title` rendered on a Stripe-hosted page.
// That is a usable phishing primitive — a real Stripe URL, showing a
// real business name, asking for an arbitrary sum — and it is reachable
// by anyone who knows the URL. Nothing in either repository calls it.
// Retiring it closes this; see the header above.
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://mcclusterishere.github.io/Here";
const RATE = 0.10; // the all-in spread — must match MCC_STRIPE.RATE in js/payments.js
const HOUSE: Record<string, boolean> = { mccluster: true, "equity-uprise": true };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { slug, amount, title } = await req.json().catch(() => ({}));
  const s = String(slug || "").toLowerCase().trim();
  const gross = Math.max(0, Number(amount) || 0); // the buyer's one all-in number
  if (!s || gross < 1) return json({ error: "bad_request" }, 400);
  const grossCents = Math.round(gross * 100);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: String(title || "Payment").slice(0, 250) },
        unit_amount: grossCents,
      },
      quantity: 1,
    }],
    metadata: { slug: s, kind: "direct" },
    success_url: `${SITE}/pay.html?to=${encodeURIComponent(s)}&done=1`,
    cancel_url: `${SITE}/pay.html?to=${encodeURIComponent(s)}`,
  };

  if (!HOUSE[s]) {
    // a creator: resolve their rail server-side
    const rows = await fetch(
      `${SB}/rest/v1/providers?slug=eq.${encodeURIComponent(s)}&select=stripe_acct,charges_enabled&limit=1`,
      { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
    ).then((r) => r.json()).catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.stripe_acct || row.charges_enabled !== true) {
      return json({ error: "not_live" }, 409); // finishing payout setup
    }
    // the guarantee: the creator's exact rate, un-quoted from the buyer's
    // all-in price server-side — the client never dictates the split
    const netCents = Math.round(grossCents / (1 + RATE));
    params.payment_intent_data = {
      transfer_data: { destination: row.stripe_acct, amount: netCents },
    };
  }

  const session = await stripe.checkout.sessions.create(params);
  return json({ url: session.url });
});
