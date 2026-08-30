/* ============================================================
   Payment links: ONE register for the cause.
   Everything outside the three main offerings (the Limited Offer,
   web builds, and photo/video day bookings) is a SUGGESTED
   contribution through the nonprofit's live mission-fund link.
   One link, one ledger, every button live. `suggest` is the
   suggested amount shown on the button; givers set their own.
   ============================================================ */

var MCC_DONATE = "https://square.link/u/MBVeuzoo?src=sheet";

window.PAYMENTS = {
  "whodidtheshoot": {
    title: "Who Did The Shoot",
    page: "song-who-did-the-shoot.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "antisocial": {
    title: "Antisocial",
    page: "song-antisocial.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "environmental-injustice": {
    title: "Environmental Injustice",
    page: "song-environmental-injustice.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "gotwifi": {
    title: "Got WiFi",
    page: "song-got-wifi.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "vaunt": {
    title: "Vaunt (Acoustic)",
    page: "song-vaunt.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "dealerplates": {
    title: "Dealer Plates (A-Side)",
    page: "song-dealer-plates.html",
    link: MCC_DONATE,
    suggest: "$3",
  },
  "subscribe": {
    title: "Back the catalogue",
    link: MCC_DONATE,
    label: "Back the catalogue \u00b7 any amount",
  },
  // The $20 identifier walkthrough (Square payment link). After purchase,
  // send buyers the unlisted walkthrough page.
  "idguide": {
    title: "Identifier Resource Pack",
    link: MCC_DONATE,
    label: "Give what's fair \u00b7 get the pack",
  },
  // The mission fund: live Square link (nonprofit). Hero, footer, and
  // the Equity Uprise pages all point here. Support / contribution
  // language only, no tax wording on the site or in the Square copy.
  "donate": {
    title: "Support the Mission",
    link: "https://square.link/u/MBVeuzoo?src=sheet",
  },
  // Square Appointments booking page for the paid inquiry call:
  // Dashboard → Appointments → create a paid "Inquiry Call" service with
  // prepayment required, then paste the online booking URL here.
  "bookcall": {
    title: "Book a Paid Call",
    link: "",
  },
};

/* ============================================================
   THE SINGLE-SELLER RAIL. The marketplace kit is gone.

   What used to live here: Stripe Connect Express onboarding
   (connectOnboard), provider ID verification (verifyId), destination
   charges to provider accounts (payDeal), payee rail resolution
   (rail), and the 10% seller-vs-buyer spread (RATE / quote / net).
   All of it removed from the customer-facing application per the
   single-operator model: McCluster is the only seller, and every
   charge starts from a controlled offering.

   Checkout now runs offering-first: the browser names a slug, the
   checkout edge function reads the offerings table for the
   authoritative price, seller, and provider (see
   supabase/migrations/0007_offerings.sql and
   supabase/functions/checkout). No publishable key ships here;
   Stripe-hosted checkout needs none, and the old pk_test never
   belonged in production.
   ============================================================ */
window.MCC_STRIPE = { HOUSE: { "mccluster": 1, "equity-uprise": 1 } };
