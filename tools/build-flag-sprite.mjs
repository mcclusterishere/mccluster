/* THE FLAG ATLAS — every flag the globe draws, in one image, so the Earth asks for one file, not 174.

     node tools/build-flag-sprite.mjs        (after tools/build-world-countries.mjs)

   Each vendored flag (assets/flags/4x3/<a2>.svg, flag-icons, MIT) is drawn whole into a 64 × 48 cell
   by Chromium (Playwright; PLAYWRIGHT_DIR if not resolvable). The flags are 4:3 artwork, so this is a
   proportional scale of the complete flag: nothing cropped, recoloured or added. Writes
   assets/flags/flag-sprite-4x3.webp and assets/flags/flag-sprite-4x3.json ({cell, cols, order}). */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules", "x"))("playwright")); }

const W = 64, H = 48, COLS = 16;
const data = JSON.parse(readFileSync(join(ROOT, "data/geo/world-countries-10m.json"), "utf8"));
const order = data.countries.filter((c) => c.properties.flag).map((c) => c.properties.a2).sort();
const svgs = order.map((a2) => "data:image/svg+xml;base64," + readFileSync(join(ROOT, "assets/flags/4x3", a2.toLowerCase() + ".svg")).toString("base64"));
const browser = await chromium.launch();
const page = await browser.newPage();
const url = await page.evaluate(async ({ svgs, W, H, COLS }) => {
  const rows = Math.ceil(svgs.length / COLS), c = document.createElement("canvas");
  c.width = COLS * W; c.height = rows * H;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  for (let n = 0; n < svgs.length; n++) {
    const img = new Image(); img.src = svgs[n]; await img.decode();
    g.drawImage(img, (n % COLS) * W, Math.floor(n / COLS) * H, W, H);
  }
  return c.toDataURL("image/webp", 0.9);
}, { svgs, W, H, COLS });
await browser.close();
writeFileSync(join(ROOT, "assets/flags/flag-sprite-4x3.webp"), Buffer.from(url.split(",")[1], "base64"));
writeFileSync(join(ROOT, "assets/flags/flag-sprite-4x3.json"), JSON.stringify({ source: "assets/flags/4x3/*.svg (flag-icons 7.5.0, MIT)", generated_by: "tools/build-flag-sprite.mjs", cell: [W, H], cols: COLS, order }) + "\n");
console.log(`${order.length} flags into ${COLS * W} x ${Math.ceil(order.length / COLS) * H}`);
