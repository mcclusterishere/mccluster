/* THE GOLDEN DISCOUNT, RE-DERIVED FROM THE RESEARCH EVERY TIME.
 *
 *     node --experimental-strip-types scripts/golden-check.mjs
 *
 * The claim is "at least a third below what this work costs around here",
 * and it is going in an advertisement. An advertised discount that stopped
 * being true because somebody edited a number six months later is not a
 * stale comment, it is a false advertisement — so the arithmetic runs in
 * CI rather than living in a commit message.
 *
 * For every line data/market-rates.json says it governs:
 *
 *     ceiling = median × (100 − percent_off) / 100
 *     the ledger price must be at or under the ceiling
 *
 * It is a CEILING, not a target. A price already below it passes, and is
 * never raised to meet it — raising the cheap end to hit a discount number
 * exactly would put the price up on exactly the people the discount exists
 * to reach.
 *
 * Exits non-zero on the first line that is over, and says by how much.
 */
import { readFile } from "fs/promises";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));

const market = await readJson("data/market-rates.json");
const ledger = await readJson("data/offers.json");

const gold = market.golden_discount;
if (!gold || typeof gold.percent_off !== "number") {
  console.error("data/market-rates.json has no golden_discount.percent_off");
  process.exit(1);
}
const KEEP = (100 - gold.percent_off) / 100;

const offer = (id) => (ledger.offers || []).filter((o) => o.id === id)[0];
const money = (n) => "$" + Number(n).toFixed(2).replace(/\.00$/, "")
  .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/* what the ledger currently charges for the thing a band describes */
function priceOf(g) {
  if (!g) return null;
  if (g.kind === "free") return { amount: 0, what: "not charged" };
  if (g.kind === "runway_recurring") {
    const p = (offer("runway") || {}).pricing || {};
    return p.recurring ? { amount: p.recurring.amount, what: "per month" } : null;
  }
  if (g.kind === "offer_m") {
    const p = ((offer(g.offer) || {}).pricing || {}).m || {};
    return p.amount != null ? { amount: p.amount, what: "per month" } : null;
  }
  if (g.kind === "rate_line") {
    const m = ((offer(g.offer) || {}).pricing || {}).m || {};
    const line = (m.rate_lines || []).filter((r) => r.id === g.line)[0];
    return line ? { amount: line.amount, what: line.label, line } : null;
  }
  return null;
}

let over = 0, checked = 0, atCeiling = 0, missing = 0;
const rows = [];

for (const r of market.rates || []) {
  if (!r.governs) continue;
  const p = priceOf(r.governs);
  if (!p) {
    console.error(`  MISSING  ${r.id} → no ledger line at ${JSON.stringify(r.governs)}`);
    missing++;
    continue;
  }
  checked++;
  const ceiling = Math.round(r.typical * KEEP * 100) / 100;
  const ok = p.amount <= ceiling + 0.005;          // cents, not floats
  const marked = !!(p.line && p.line.priced_by);
  const at = Math.abs(p.amount - ceiling) < 0.005;
  if (at) atCeiling++;

  rows.push([
    ok ? "ok  " : "OVER",
    r.id,
    money(p.amount),
    money(r.typical),
    money(ceiling),
    ok ? (at ? "at the ceiling" : `${Math.round((1 - p.amount / r.typical) * 100)}% under`)
       : `${money(p.amount - ceiling)} too high`,
  ]);

  if (!ok) over++;

  /* A LINE MOVED BY THE RULE HAS TO SAY SO. Provenance is what makes a
     price auditable a year from now: without it, $938 is a number
     somebody typed, and nobody can tell whether it is still right. */
  if (at && !marked && r.governs.kind === "rate_line") {
    console.error(`  UNMARKED ${r.id} sits exactly at the ceiling but carries no priced_by`);
    over++;
  }
  if (marked && !at) {
    console.error(`  STALE    ${r.id} is marked priced_by "${p.line.priced_by}" but is no longer at the ceiling`);
    over++;
  }
}

const w = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
console.log(`\n${gold.percent_off}% below the median, as a ${gold.rule}. Medians checked ${market.checked}.\n`);
console.log("       " + "line".padEnd(w) + "      now    median   ceiling");
for (const [flag, id, now, median, ceiling, note] of rows) {
  console.log(`  ${flag} ${id.padEnd(w)} ${now.padStart(8)} ${median.padStart(9)} ${ceiling.padStart(9)}   ${note}`);
}

console.log(
  `\n${checked} lines checked, ${atCeiling} sitting at the ceiling, ` +
  `${checked - atCeiling - over} comfortably under.`);

if (missing) console.log(`${missing} band(s) govern nothing — a rate with no ledger line is research nobody uses.`);

if (over) {
  console.error(`\nFAILED: ${over} problem(s). The advertised claim is not true as the ledger stands.\n`);
  process.exit(1);
}
console.log(`\nThe claim holds: ${JSON.stringify(gold.the_claim_this_supports)}\n`);
