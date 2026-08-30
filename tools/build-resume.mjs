/* ============================================================
   BUILD THE RÉSUMÉ PDF.

   Renders matthew-mccluster.html — the actual page, through the actual
   print stylesheet — to assets/resume/matthew-mccluster-resume.pdf.

   WHY IT RENDERS THE PAGE INSTEAD OF BUILDING A DOCUMENT.
   A résumé kept in two places is a résumé that is wrong in one of them.
   The moment the PDF is authored separately, the day comes when the site
   says a job ended in 2026 and the file somebody is reading in an
   interview says 2023. So there is one source — the page — and the file
   is a rendering of it.

   THE STAMP IS THE POINT.
   A generated binary in a repo rots silently: somebody edits the career
   list, ships it, and the PDF keeps serving last month's history with no
   diff to notice. So this writes a .stamp beside the PDF holding a hash
   of the résumé's own TEXT (not the HTML — a class rename is not a
   change to a career). tools/verify-resume.mjs recomputes it and fails
   when they disagree, and that check runs in the release gate.

     node tools/build-resume.mjs           build it
     node tools/verify-resume.mjs          is it current?

   Needs the same Playwright the smoke suite uses; honours PW_MODULE and
   PW_CHROME for the same reason.
   ============================================================ */
import { createRequire } from "module";
import { spawn } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import http from "http";
import path from "path";
import { stampOf } from "./resume-stamp.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "playwright");

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, "");
const PORT = 8934;
const B = `http://127.0.0.1:${PORT}/`;
const PAGE = "matthew-mccluster.html";
const OUT_DIR = path.join(ROOT, "assets", "resume");
const OUT = path.join(OUT_DIR, "matthew-mccluster-resume.pdf");
const STAMP = OUT + ".stamp";

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const ping = (n) => http.get(B, () => resolve()).on("error", () =>
      n <= 0 ? reject(new Error("server never came up")) : setTimeout(() => ping(n - 1), 200));
    ping(tries);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  try {
    await waitForServer();
    const browser = await chromium.launch({
      args: ["--no-sandbox"],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
    });
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
    await page.goto(B + PAGE, { waitUntil: "networkidle", timeout: 30000 });
    /* the bar and masthead are injected by script; let them land so the
       print sheet is hiding something real rather than racing it */
    await page.waitForTimeout(900);
    if (errs.length) throw new Error("the page errored, refusing to print it: " + errs.join(" | "));

    await page.emulateMedia({ media: "print" });
    mkdirSync(OUT_DIR, { recursive: true });
    await page.pdf({
      path: OUT,
      format: "Letter",
      printBackground: false,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    await browser.close();

    const html = readFileSync(path.join(ROOT, PAGE), "utf8");
    const stamp = await stampOf(html);
    writeFileSync(STAMP, stamp + "\n");

    const kb = (readFileSync(OUT).length / 1024).toFixed(0);
    console.log(`wrote assets/resume/matthew-mccluster-resume.pdf (${kb} KB)`);
    console.log(`stamp ${stamp}`);

    /* BOTH FORMATS, ONE COMMAND, ONE STAMP. Building them separately is how
       a repo ends up serving a PDF from this week and a Word file from last
       month — and the Word one is the copy a recruiter pastes into a portal.
       They share the stamp because they share a source. */
    await import("./build-resume-docx.mjs");
    if (!existsSync(OUT)) process.exit(1);
  } finally {
    server.kill();
  }
}
