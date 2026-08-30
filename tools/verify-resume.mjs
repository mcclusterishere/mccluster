/* Is the downloadable résumé still the résumé on the page?
 *
 * A generated binary in a repo rots quietly. Somebody edits the career
 * list, ships it, and the PDF a recruiter downloads keeps serving last
 * month's history — with no diff anywhere to notice, because the PDF's
 * diff is unreadable and nobody opens it.
 *
 * So the build stamps a hash of the résumé's own TEXT beside the file,
 * and this recomputes it. Markup changes are deliberately invisible
 * here: renaming a class is not a change to a career, and a rebuild
 * every time a stylesheet moves would train everybody to ignore this.
 *
 *   node tools/verify-resume.mjs
 *
 * Exits non-zero when the PDF is missing or stale, so the release gate
 * can refuse to ship a résumé that lies.
 */
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { stampOf } from "./resume-stamp.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, "");
const PAGE = path.join(ROOT, "matthew-mccluster.html");
const PDF = path.join(ROOT, "assets", "resume", "matthew-mccluster-resume.pdf");
const DOCX = path.join(ROOT, "assets", "resume", "matthew-mccluster-resume.docx");
const STAMP = PDF + ".stamp";

const fails = [];
const check = (label, ok, why = "") => {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (ok ? "" : `\n         ${why}`));
  if (!ok) fails.push(label);
};

check("the PDF exists", existsSync(PDF),
  "run: node tools/build-resume.mjs");

if (existsSync(PDF)) {
  const bytes = statSync(PDF).size;
  /* a PDF that renders nothing still weighs a few hundred bytes */
  check(`the PDF has content (${(bytes / 1024).toFixed(0)} KB)`, bytes > 8000,
    "suspiciously small — did the print stylesheet hide the whole document?");
}

check("the DOCX exists", existsSync(DOCX), "run: node tools/build-resume.mjs");

if (existsSync(DOCX)) {
  /* A .docx is a ZIP. Reading the career straight out of it is the only
     check that means anything: a file that opens but says 2022 is worse
     than no file, because somebody pastes it into a portal without looking. */
  const { execFileSync } = await import("node:child_process");
  let text = "";
  try {
    text = execFileSync("python3", ["-c", `
import zipfile,re,sys
x=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8')
print(re.sub(r'<[^>]+>','',x))`, DOCX], { encoding: "utf8" });
  } catch (e) { /* reported by the checks below */ }

  check("the DOCX is a readable Word file", text.length > 500,
    "could not read word/document.xml out of it");
  check("the DOCX carries the career, not just a header",
    /Infrastructure Engineer/.test(text) && /Robert Half/.test(text));

  /* the page is the source; every role on it must survive into the file */
  const page = readFileSync(PAGE, "utf8");
  const onPage = [...page.matchAll(/<span class="yr">([^<]+)<\/span>/g)].map((m) => m[1].trim());
  const missing = onPage.filter((y) => !text.toUpperCase().includes(y.toUpperCase()));
  check(`every date on the page reached the DOCX (${onPage.length} roles)`,
    missing.length === 0, `missing from the file: ${missing.join(", ")}`);
}

check("the stamp exists", existsSync(STAMP), "run: node tools/build-resume.mjs");

if (existsSync(STAMP) && existsSync(PAGE)) {
  const want = await stampOf(readFileSync(PAGE, "utf8"));
  const got = readFileSync(STAMP, "utf8").trim();
  check("the PDF matches the résumé on the page", want === got,
    `page is ${want}, PDF was built from ${got} — the page changed since the last build.\n` +
    `         run: node tools/build-resume.mjs`);
}

/* the page must actually offer the file, or building it changed nothing */
if (existsSync(PAGE)) {
  const html = readFileSync(PAGE, "utf8");
  check("the page links the PDF with a download attribute",
    /href="assets\/resume\/matthew-mccluster-resume\.pdf"/.test(html) && /\bdownload=/.test(html),
    "the file exists but nothing on the page offers it");
  check("the page links the DOCX with a download attribute",
    /href="assets\/resume\/matthew-mccluster-resume\.docx"[\s\S]{0,120}download=/.test(html),
    "the Word file exists but nothing on the page offers it");
  check("the page loads the print stylesheet",
    /css\/resume-print\.css/.test(html),
    "without it, Cmd+P prints the dark coat onto white paper");
}

console.log(`\n${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
