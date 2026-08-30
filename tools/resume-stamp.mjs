/* WHAT COUNTS AS "THE RÉSUMÉ", in one place.
 *
 * Both the builder and the checker need to agree on this, and they must
 * agree for the right reason: the stamp hashes the résumé's visible TEXT,
 * not its HTML. Renaming a class or moving a stylesheet is not a change to
 * a career, and a checker that cried stale on every markup edit would be
 * ignored inside a week.
 *
 * It lives alone, with no imports, so verifying costs nothing. The checker
 * used to pull this from build-resume.mjs and inherited Playwright through
 * it — which meant asking "is my PDF current?" required a browser.
 */
export function resumeTextFrom(html) {
  const body = html.slice(html.indexOf("<body"));
  const main = body.slice(body.indexOf("<main"), body.indexOf("</main>"));
  return main
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    /* the download row is a control, not content: adding a button must
       not invalidate the PDF that button points at */
    .replace(/<div class="rsm-get"[\s\S]*?<\/div>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function stampOf(html) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(resumeTextFrom(html)).digest("hex").slice(0, 16);
}
