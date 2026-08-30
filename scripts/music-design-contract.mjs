import { readFile } from "node:fs/promises";

const failures = [];
const must = (name, cond) => {
  if (!cond) failures.push(name);
};

const rootPages = [
  ["album.html", "music-room--album"],
  ["films.html", "music-room--films"],
  ["catalogue.html", "music-room--catalogue"],
  ["license.html", "music-room--license"],
];
/* The six per-track pages were folded into the reel on the owner's call:
   each one existed to show a track's film and link to licensing, and
   films.html plays every film while license.html already pre-picked the
   record from ?track=<slug>.

   This block used to assert the full-page shape — its own stage, its story
   material, its audio element. Holding that would be holding the site to a
   decision it has moved past. What still has to be true is narrower and
   more important: the URLs must never 404, they must land on the reel, and
   the licensing door they carried must exist on the thing that replaced
   them. Those are asserted below instead. */
const trackStubs = [
  "tracks/who-did-the-shoot.html",
  "tracks/runway-walk.html",
  "tracks/write-a-song.html",
  "tracks/here.html",
  "tracks/antisocial.html",
  "tracks/lightroom.html",
];
const trackSlugs = ["who-did-the-shoot", "runway-walk", "write-a-song", "here", "antisocial", "lightroom"];

for (const [path, room] of rootPages) {
  const html = await readFile(path, "utf8");
  must(path + " loads the shared music direction", html.includes("css/music-director.css"));
  must(path + " declares its authored room", html.includes(room));
  must(path + " preserves the one app bar", (html.match(/<nav class=\"appbar\"/g) || []).length === 1);
}

for (const path of trackStubs) {
  const html = await readFile(path, "utf8");
  /* it must still exist and it must still go somewhere: an indexed URL that
     404s is worse than one that forwards, and both mechanisms are required
     because the meta refresh is what carries a visitor with scripting off */
  must(path + " forwards to the reel without scripting", /http-equiv="refresh"[^>]*films\.html/.test(html));
  must(path + " forwards to the reel with scripting", html.includes('location.replace("../films.html")'));
  must(path + " stays out of the index", html.includes('name="robots" content="noindex"'));
}

const album = await readFile("album.html", "utf8");
must("album keeps the six-track mount", album.includes('id="tracks"'));
must("album keeps the shared deck", album.includes('id="deck"'));
must("album keeps persistent Music transport hooks", album.includes("MCC_NP_PLAY") && album.includes("MCC_NP_PAUSE"));

const films = await readFile("films.html", "utf8");
must("films keeps one-tap sound intent", films.includes('id="fa"') && films.includes("films_armed"));
must("films keeps swipe cards", films.includes('class="fc"'));
/* the reel absorbed the track pages, so it now owes what they carried: a
   licensing door per record, pre-picking that record on license.html. If
   this ever regresses, six URLs forward to a page that dropped their one
   job — which is exactly the failure the old track-page block guarded. */
must("films carries the licensing door the track pages held",
  films.includes('data-cta="film-license"') && films.includes("license.html?track="));
must("films calls them lyric videos", !/>The films</.test(films));


const license = await readFile("license.html", "utf8");
must("license exposes the brief promise", license.includes('class="lc__briefbar"'));
must("license keeps CRM delivery", license.includes("MCC_CRM.send"));
must("license keeps track preselection", license.includes('get("track")'));

/* BOTH ENDS OF THE LINK, OR NEITHER.

   The first pass checked only that a slug appeared somewhere in films.html
   and called that "can license this record". It cannot: license.html
   pre-picks the track with

     if (pre && $("lcTrack").querySelector('[value="' + pre + '"]')) ...

   which silently does nothing when no option matches. Rename or drop an
   <option> and the door still opens — onto a form with no record chosen —
   while a contract that only reads films.html reports all six fine. That is
   worse than no check, because it is a check that lies.

   So each slug is verified at both ends: the reel emits the link, and the
   form has somewhere for it to land. */
for (const slug of trackSlugs) {
  must("the reel links a licensing door for " + slug, films.includes(': "' + slug + '"'));
  must("the licence form can receive " + slug, license.includes('<option value="' + slug + '">'));
}

const sponsor = await readFile("sponsor.html", "utf8");
must("sponsor remains consolidated into the nonprofit door", sponsor.includes('give.html#sponsor'));

const css = await readFile("css/music-director.css", "utf8");
for (const selector of [
  ".music-room--album",
  ".music-room--track",
  ".music-room--runway",
  ".music-room--write",
  ".music-room--here",
  ".music-room--antisocial",
  ".music-room--lightroom",
  ".music-room--films",
  ".music-room--catalogue",
  ".music-room--license",
  "@media (prefers-reduced-motion: reduce)",
]) must("director stylesheet includes " + selector, css.includes(selector));

if (failures.length) {
  console.error("MUSIC DESIGN CONTRACT FAILED");
  failures.forEach((failure) => console.error(" - " + failure));
  process.exit(1);
}

console.log("MUSIC DESIGN CONTRACT CLEAN");
