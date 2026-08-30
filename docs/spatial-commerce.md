# Spatial commerce: the stage, and what it is waiting for

A viewer for volumetric captures of the product, built to the *Spatial
Commerce Paradigm* blueprint. This records what was built, what was cut,
and the one thing only a camera can supply.

---

## What exists today

`js/shake-viewer.js` — a stage that decides, before fetching anything
heavy, which of three tiers a visitor gets:

| Tier | When | What renders |
| --- | --- | --- |
| `webgpu` | WebGPU adapter granted **and** a capture registered | the splat |
| `flat` | no capture, or no WebGPU | the storefront alone — no stage, no banner, no layout shift |
| `off` | reduced-motion, `Save-Data`, or a 2g connection | nothing fetched at all |

**Today every visitor gets `flat`,** because the manifest is empty.

---

## The thing it is waiting for

**A 3D Gaussian Splat is captured, not authored.** It is trained from
real footage of a real object. No model can generate one, this repo
cannot contain one, and there is no shortcut.

So `data/shake-splats.json` ships with `asset: ""`, and the viewer treats
an empty asset as absent. Nothing renders. The storefront is untouched.

That is a deliberate refusal. The alternative — a spinning stock cup, a
video loop dressed up as volumetric, a generated "shake" — would be a
lie told in the most expensive place on the page, to a customer deciding
whether to trust a stranger with a food order. **An empty stage that
explains itself beats a full one that misleads.**

### How to capture one

You need a phone and about twenty minutes.

1. **Set up.** Real shake, in the cup you actually serve. Matte surface,
   even indirect light — no direct sun, no hard spot. Kill reflections
   you don't want permanently baked into the model.
2. **Film.** One continuous orbit, 360°, slow and steady, at roughly cup
   height. Then a second orbit ~30° higher. 60–90 seconds total. Keep the
   whole cup in frame the entire time and **do not zoom**.
3. **Hold still.** The shake must not move, melt visibly, or change
   between orbits. Condensation running down the glass mid-shoot will
   train into the model as a permanent streak.
4. **Extract frames** — roughly 150–250 evenly spaced.
5. **Train.** Any current 3DGS pipeline; PlayCanvas **SuperSplat** will
   also clean up and compress the result in the browser.
6. **Compress** to `.sog` or `.spz` and drop it in `assets/splats/`.
7. **Register it** in `data/shake-splats.json`: set `slug`, `asset`,
   `bytes`, `captured`. The viewer lights up with no other change.

**Budget: under ~8 MB transferred.** The customer is a student on a phone
at 11pm on campus wifi who wants a shake in under a minute. A capture
that is beautiful and slow loses to a menu that is plain and instant.

---

## What was cut, and why

### The supply-chain twin — removed entirely

The blueprint's Section B specified an explorable digital twin of a
26,000 sq ft facility in Norwich CT, an HPP sterilisation simulation, and
an ingredient sourcing map naming regional suppliers.

**The owner confirmed there are no such partners — the operation is solo.**

So none of it is built, and none of those names appear anywhere in this
repo. Rendering a "digital twin" of a facility that does not exist, or
naming suppliers who supply nothing, is a false provenance claim about
food made to a paying customer. That is not a design decision to weigh;
it is the kind of claim that ends a food brand.

If a real co-packer is ever signed, this section can be built against
that relationship, and every claim on the page should trace to something
showable.

### `navigator.xr` alone — corrected, not adopted

The blueprint calls for one-click AR via the WebXR API for "mobile users
and headset owners". Quest 3 and Pico 4 do expose `navigator.xr` and can
enter `immersive-ar`.

**Safari on iOS has never shipped it.** Apple's web AR path is AR Quick
Look: a `.usdz` file behind `<a rel="ar">`. Feature-detecting on
`navigator.xr` alone would have promised an AR button to iPhone users
that silently does nothing — and iPhones are most of the phones this shop
serves.

`SHKVIEW.arSupport()` therefore reports both independently: `webxr` from
a real `isSessionSupported('immersive-ar')` call, and `quicklook` from
`relList.supports('ar')`. AR ships when there is an asset, and it ships
down both paths or not at all. USDZ is a **separate export** from the
splat, not a conversion of it.

### "Unburdened by legacy code" — declined

The blueprint describes the existing page as legacy to be replaced, and
proposes a React/Shopify checkout overlay.

`shakes.html` is not legacy. It carries a security model that took real
work:

- `shake_orders` has **no insert policy for anyone** — the edge function
  on the service role is the only writer
- every cent is recomputed server-side in
  `supabase/functions/shake-order/price.ts`, under 19 tests covering the
  attacks that matter
- verified against the live endpoint: a cart carrying `price_cents: 1`
  was charged 700

Replacing that with a Shopify overlay would discard the RLS, the edge
function, and the pricing law together.

**So the stage sits on top of the till, not in place of it.** Rendering
and money stay separate problems. `js/shake-viewer.js` cannot price
anything; it has no path to.

---

## Not vendored yet, on purpose

No 3D engine is in this repo. PlayCanvas, Babylon and the rest are real
and appropriate, but vendoring megabytes of renderer to display an empty
manifest repeats the mistake the empty manifest exists to avoid.

`mount()` dynamically imports `./shake-splat-render.js` **only** after
WebGPU is confirmed and an asset is known to exist. That module does not
exist yet; the import fails, is caught, and the tier falls back to
`flat`. Write it in the same commit that lands the first capture.

---

## Both businesses

The owner's plan is campus delivery now, a bottled retail line later.

The stage is keyed on `slug`, matching `shake_products` — so it serves
whatever is being sold without knowing which business it is. A bottled
line will need its own fulfilment model (the campus stop list is wrong
for shipping), but it will not need a different viewer.

---

## Before any of this earns its place

The shop still cannot take an order: **0 delivery stops configured and
`STRIPE_SK` unset.** A capture is worth shooting once there is a shake
sale to attach it to.
