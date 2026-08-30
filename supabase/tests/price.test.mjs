/* The pricing tests. Run with:
 *
 *     node --experimental-strip-types supabase/tests/price.test.mjs
 *
 * This imports the REAL module the edge function uses — not a copy — so a
 * change to how a shake is priced either keeps these passing or gets
 * caught here. Pricing is the one piece of this shop where a bug is
 * money, so it is the piece with tests.
 */
import { priceCart } from "../functions/shake-order/price.ts";
import assert from "node:assert/strict";

/* The seeded menu, shaped exactly as the database returns it. */
const MENU = new Map([
  ["house-shake", {
    slug: "house-shake", name: "The House Shake", price_cents: 700, available: true,
    options: [
      { key: "size", label: "Size", required: true, choices: [
        { value: "16", label: "16 oz", delta_cents: 0 },
        { value: "24", label: "24 oz", delta_cents: 200 },
      ] },
      { key: "addin", label: "Add-in", required: false, choices: [
        { value: "none", label: "None", delta_cents: 0 },
        { value: "peanut-butter", label: "Peanut butter", delta_cents: 100 },
      ] },
    ],
  }],
  ["extra-shot", { slug: "extra-shot", name: "Extra protein scoop", price_cents: 150, available: true, options: [] }],
  ["sold-out", { slug: "sold-out", name: "Sold Out Shake", price_cents: 700, available: false, options: [] }],
]);

let passed = 0;
function ok(label, fn) {
  try { fn(); console.log("  ok    " + label); passed++; }
  catch (e) { console.error("  FAIL  " + label + "\n        " + e.message); process.exitCode = 1; }
}
function throws(label, lines, match) {
  ok(label, () => assert.throws(() => priceCart(lines, MENU), match));
}

console.log("\n-- what a shake costs --");

ok("base price with the free size", () => {
  const { subtotal } = priceCart([{ slug: "house-shake", qty: 1, choices: { size: "16" } }], MENU);
  assert.equal(subtotal, 700);
});

ok("the big size adds its delta", () => {
  const { subtotal } = priceCart([{ slug: "house-shake", qty: 1, choices: { size: "24" } }], MENU);
  assert.equal(subtotal, 900);
});

ok("options stack", () => {
  const { subtotal } = priceCart(
    [{ slug: "house-shake", qty: 1, choices: { size: "24", addin: "peanut-butter" } }], MENU);
  assert.equal(subtotal, 1000);
});

ok("quantity multiplies the whole line, options included", () => {
  const { subtotal } = priceCart(
    [{ slug: "house-shake", qty: 3, choices: { size: "24", addin: "peanut-butter" } }], MENU);
  assert.equal(subtotal, 3000);
});

ok("several lines add up", () => {
  const { subtotal, items } = priceCart([
    { slug: "house-shake", qty: 2, choices: { size: "16" } },
    { slug: "extra-shot", qty: 1 },
  ], MENU);
  assert.equal(subtotal, 700 * 2 + 150);
  assert.equal(items.length, 2);
});

ok("the receipt records what was chosen, for the runner to read", () => {
  const { items } = priceCart(
    [{ slug: "house-shake", qty: 1, choices: { size: "24", addin: "peanut-butter" } }], MENU);
  assert.deepEqual(items[0].choices, { size: "24", addin: "peanut-butter" });
  assert.deepEqual(items[0].choice_labels, ["24 oz", "Peanut butter"]);
});

ok("'None' is not printed on the ticket", () => {
  const { items } = priceCart(
    [{ slug: "house-shake", qty: 1, choices: { size: "16", addin: "none" } }], MENU);
  assert.deepEqual(items[0].choice_labels, ["16 oz"]);
});

console.log("\n-- what the browser cannot do --");

throws("invent a product", [{ slug: "free-shake", qty: 1 }], /don't sell/);
throws("invent an option", [{ slug: "house-shake", qty: 1, choices: { size: "gallon" } }], /isn't an option/);
throws("skip a required option", [{ slug: "house-shake", qty: 1 }], /pick a size/);
throws("buy something sold out", [{ slug: "sold-out", qty: 1 }], /sold out/);
throws("order zero", [{ slug: "extra-shot", qty: 0 }], /odd quantity/);
throws("order a negative quantity", [{ slug: "extra-shot", qty: -5 }], /odd quantity/);
throws("order a fractional quantity that floors to zero", [{ slug: "extra-shot", qty: 0.5 }], /odd quantity/);
throws("order a thousand", [{ slug: "extra-shot", qty: 1000 }], /odd quantity/);
throws("send an empty cart", [], /empty cart/);
throws("send a cart of 21 lines", Array(21).fill({ slug: "extra-shot", qty: 1 }), /a lot of shakes/);

ok("a price sent by the browser is ignored entirely", () => {
  const { subtotal } = priceCart(
    [{ slug: "extra-shot", qty: 1, price_cents: 1, each_cents: 1, total: 1 }], MENU);
  assert.equal(subtotal, 150);
});

ok("a delta sent by the browser is ignored entirely", () => {
  const { subtotal } = priceCart(
    [{ slug: "house-shake", qty: 1, choices: { size: "16" }, delta_cents: -600 }], MENU);
  assert.equal(subtotal, 700);
});

console.log(`\n${passed} pricing assertions held.\n`);
