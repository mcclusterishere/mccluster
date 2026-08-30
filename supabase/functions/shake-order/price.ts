// THE PRICE. Pure, and separate from the request handler on purpose.
//
// This is the only place a cart turns into money. It takes the lines the
// browser asked for and the products as the DATABASE has them, and it
// either returns a total the shop stands behind or it throws. It touches
// no network, no Deno globals and no Stripe, which means it can be run
// under plain node in a test — and pricing is exactly the code you want
// covered by tests rather than by hope.
//
// The rule it enforces everywhere: nothing the browser sends is a price,
// a discount, or a permission. The browser names things; this file looks
// up what they cost.

export type Choice = { value: string; label?: string; delta_cents?: number };
export type OptionGroup = { key: string; label: string; required?: boolean; choices?: Choice[] };
export type Product = {
  slug: string;
  name: string;
  price_cents: number;
  options?: OptionGroup[];
  available?: boolean;
};
export type Line = { slug: string; qty: number; choices?: Record<string, string> };

export type PricedItem = {
  slug: string;
  name: string;
  qty: number;
  each_cents: number;
  choices: Record<string, string>;
  choice_labels: string[];
};

export const MAX_LINES = 20;
export const MAX_QTY = 10;

export function priceCart(lines: Line[], products: Map<string, Product>) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("empty cart");
  if (lines.length > MAX_LINES) throw new Error("that is a lot of shakes — call instead");

  let subtotal = 0;
  const items: PricedItem[] = [];

  for (const line of lines) {
    const p = products.get(String(line.slug));
    if (!p) throw new Error(`we don't sell "${line.slug}"`);
    if (p.available === false) throw new Error(`${p.name} is sold out`);

    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
      throw new Error(`odd quantity for ${p.name}`);
    }

    let each = Number(p.price_cents);
    if (!Number.isFinite(each) || each < 0) throw new Error("pricing error");

    const picked: Record<string, string> = {};
    const labels: string[] = [];

    for (const group of p.options ?? []) {
      const chosen = line.choices?.[group.key];
      if (chosen === undefined || chosen === null || chosen === "") {
        if (group.required) throw new Error(`pick a ${group.label.toLowerCase()} for ${p.name}`);
        continue;
      }
      const choice = (group.choices ?? []).find((c) => c.value === chosen);
      // An option that is not on the menu cannot be bought at any price.
      // This is the line that stops "size": "free" from being a thing.
      if (!choice) throw new Error(`"${chosen}" isn't an option for ${p.name}`);

      const delta = Number(choice.delta_cents ?? 0);
      if (!Number.isFinite(delta)) throw new Error("pricing error");
      each += delta;

      picked[group.key] = choice.value;
      if (choice.label && choice.label !== "None") labels.push(choice.label);
    }

    // A negative line would let a cleverly-shaped cart pay the shop.
    if (each < 0) throw new Error("pricing error");

    subtotal += each * qty;
    items.push({ slug: p.slug, name: p.name, qty, each_cents: each, choices: picked, choice_labels: labels });
  }

  if (subtotal < 0) throw new Error("pricing error");
  return { items, subtotal };
}
