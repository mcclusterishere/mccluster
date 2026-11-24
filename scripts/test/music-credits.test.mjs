/* WHO IS ON A RECORD, AS STRUCTURE.

   Owner, 2026-11-24 (Matthew McCluster), applied exactly:
   - one McCluster artist;
   - Cyber Security Specialist (PRIM3) is scored and produced by McCluster alone;
   - I AM HERE, Whip Equipped, Heal the 3 and Vaunt are produced by McCluster and Zakir Elhajoui, every track; the two
     Dealer Plates lines that said "Prod. Zakir & McCluster" carry the full names; "guitar by Zakir" stays its own fact;
   - the Equity Uprise album keeps every credit it had, with two producer facts: Environmental Injustice (Brave mix)
     is produced by Zakir Elhajoui and McCluster, the main mix by McCluster; Equity Uprise is its own artist;
   - "Upset" is a Hitman Benji song, not "Hitman Halo";
   - the KKK album names no producer; neither do Benji Chase's two albums;
   - the Audio Engineer EP: Outta Tune, Studio Trapped, Sound Trust Anthem, Trackout, produced by McCluster, Trackout
     co-produced by Tazzy Jay and McCluster;
   - every artist credited on any track, featured artists included, has an entry in the artists selector, and opening
     one shows everything they appear on (Los Fidel: Please Set Me Free).

   data/albums.json holds the structure; js/music-credits.js is the one reading of it, for pages and generators. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import "../../js/music-credits.js";
import { render } from "../../tools/build-music-credits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const C = globalThis.MCC_CREDITS;
const DOC = json("data/albums.json");
const album = (slug) => DOC.albums.find((a) => a.slug === slug);
const track = (slug, title) => album(slug).tracks.find((t) => t.title === title);
const SITE = "https://matthew.mccluster.org";
const PERSON = `${SITE}/#matthew-mccluster`;
const BOTH = ["mccluster", "zakir-elhajoui"];
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => nodes(x, out)); else if (v && typeof v === "object") { out.push(v); Object.values(v).forEach((x) => nodes(x, out)); } return out; };

test("every track has a primary artist, and every credited slug is in the registry", () => {
  const slugs = DOC.artists.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length, "a slug is registered once");
  assert.equal(new Set(DOC.artists.map((a) => a.name)).size, DOC.artists.length, "a name is registered once");
  for (const a of DOC.artists) {
    assert.match(a.slug, /^[a-z0-9-]+$/, a.slug);
    assert.ok(a.name, `${a.slug}: a display name`);
    assert.ok(["person", "act"].includes(a.kind), `${a.slug}: person or act`);
    if (a.page) assert.match(a.page, /^[a-z0-9-]+\.html$/, `${a.slug}: its page is a same-site file`);
  }
  let tracks = 0;
  for (const al of DOC.albums) {
    for (const t of al.tracks) {
      tracks += 1;
      assert.ok(t.credits && Array.isArray(t.credits.primary) && t.credits.primary.length >= 1, `${al.slug} / ${t.title}: at least one primary artist`);
      for (const x of C.credited(t)) assert.ok(slugs.includes(x.slug), `${al.slug} / ${t.title}: "${x.slug}" is in the registry`);
      for (const k of Object.keys(t.credits)) assert.ok(["primary", "lead", "featured", "producers", "produced_as", "roles", "note", "after"].includes(k), `${t.title}: unknown credits field ${k}`);
    }
  }
  assert.equal(tracks, 65);
  /* nobody is registered who is on nothing */
  for (const a of DOC.artists) assert.ok(C.count(DOC, a.slug) >= 1, `${a.name} appears on at least one track`);
});

test("the credit line on the site is the function's output, everywhere it is stored", () => {
  /* the generator writes exactly what is committed */
  assert.equal(render(read("data/albums.json")), read("data/albums.json"), "run node tools/build-music-credits.mjs");
  const cat = json("data/catalogue.json");
  const rows = new Map(cat.tracks.map((t) => [`${t.albumSlug}|${t.title}`, t]));
  for (const al of DOC.albums) {
    for (const t of al.tracks) {
      const line = C.line(DOC, t);
      assert.equal(t.credit, line, `${al.slug} / ${t.title}: data/albums.json credit`);
      const short = C.sub(DOC, t);
      if (short !== null) assert.equal(t.sub, short, `${al.slug} / ${t.title}: data/albums.json sub`);
      const row = rows.get(`${al.slug}|${t.title}`);
      assert.equal(row.credit, line, `${al.slug} / ${t.title}: data/catalogue.json credit`);
      assert.deepEqual(row.credits, t.credits, `${al.slug} / ${t.title}: data/catalogue.json carries the structure`);
      /* the registry page prints the same words (gated titles are never written into it) */
      if (!t.gated && line) {
        const escaped = line.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        assert.ok(read("catalogue.html").includes(`<small>${escaped}</small>`), `${t.title}: catalogue.html prints the line`);
      }
    }
  }
  assert.deepEqual(cat.artists, DOC.artists, "data/catalogue.json carries the registry");
  /* the function reads naturally */
  assert.equal(C.list(["A"]), "A");
  assert.equal(C.list(["A", "B"]), "A & B");
  assert.equal(C.list(["A", "B", "C"]), "A, B & C");
  assert.equal(C.line(DOC, { title: "x" }), "", "a track with no structure has no generated line");
});

test("McCluster is one artist: one slug for artist, feature and producer, tied to the one Person", () => {
  const m = DOC.artists.filter((a) => /mccluster/i.test(a.name));
  assert.equal(m.length, 1, "one McCluster in the registry");
  assert.deepEqual([m[0].slug, m[0].name, m[0].kind, m[0].id], ["mccluster", "McCluster", "person", PERSON]);
  const person = json("data/seo/entity-graph.json").person;
  assert.equal(person["@id"], PERSON, "the existing Person identity");
  assert.ok(person.alternateName.includes("McCluster"), "McCluster is a name of that Person");
  const seen = C.appearances(DOC, "mccluster");
  assert.ok(seen.own.length && seen.featured.length && seen.produced.length, "the same slug as artist, as a feature and as producer");
  assert.ok(seen.featured.some((x) => x.track.title === "Money or the Power"));
  assert.equal(DOC.artists[0].slug, "mccluster", "the house is first");
});

test("owner: Cyber Security Specialist is PRIM3's, scored and produced by McCluster alone", () => {
  const a = album("prim3");
  assert.equal(a.tracks.length, 13);
  for (const t of a.tracks) {
    assert.deepEqual(t.credits.primary, ["prim3"], t.title);
    assert.deepEqual(t.credits.producers, ["mccluster"], `${t.title}: McCluster alone`);
    assert.match(t.credit, /Scored and produced by McCluster$/, t.title);
  }
  assert.equal(DOC.artists.find((x) => x.slug === "prim3").kind, "act", "PRIM3 stays an act");
  assert.equal(DOC.artists.find((x) => x.slug === "prim3").page, "prim3-artist.html", "and keeps its page");
});

test("owner: I AM HERE, Whip Equipped, Heal the 3 and Vaunt are produced by McCluster and Zakir Elhajoui, every track", () => {
  assert.equal(DOC.artists.find((a) => a.slug === "zakir-elhajoui").name, "Zakir Elhajoui", "the surname, spelled exactly");
  for (const [slug, n] of [["here", 6], ["whip-equipped", 11], ["heal-the-3", 2], ["vaunt-ep", 1]]) {
    const a = album(slug);
    assert.equal(a.tracks.length, n, slug);
    for (const t of a.tracks) {
      assert.deepEqual(t.credits.producers, BOTH, `${slug} / ${t.title}`);
      assert.ok(t.credit.includes("Produced by McCluster & Zakir Elhajoui"), `${slug} / ${t.title}: ${t.credit}`);
    }
  }
  /* the two Dealer Plates lines carry the full names */
  for (const title of ["Dealer Plates (A-Side)", "Dealer Plates (B-Side)"]) {
    assert.equal(track("whip-equipped", title).credit, "Produced by McCluster & Zakir Elhajoui");
  }
  assert.doesNotMatch(read("data/albums.json") + read("data/catalogue.json") + read("catalogue.html"), /Prod\. Zakir/, "the short form is gone");
  /* Vaunt: the guitar is its own fact, beside the producers */
  const vaunt = album("vaunt-ep").tracks[0];
  assert.deepEqual(vaunt.credits.roles, [{ role: "guitar", artist: "zakir-elhajoui", as: "Zakir" }]);
  assert.equal(vaunt.credit, "The Vaunt Private Flights jingle · guitar by Zakir · Produced by McCluster & Zakir Elhajoui · from the Vaunt EP (with \"Jet Pass\")");
  /* Heal the 3 stays McCluster × VVS Madè */
  for (const t of album("heal-the-3").tracks) assert.deepEqual(t.credits.primary, ["mccluster", "vvs-made"]);
});

test("owner: the Equity Uprise album is Equity Uprise's own, with every credit it had and two producer facts", () => {
  const eu = DOC.artists.find((a) => a.slug === "equity-uprise");
  assert.deepEqual([eu.name, eu.kind, eu.id], ["Equity Uprise", "act", `${SITE}/catalogue.html#artist-equity-uprise`], "Equity Uprise is its own artist, the act the graph already defines");
  const a = album("equity-uprise");
  assert.equal(a.artist, "Equity Uprise");
  assert.deepEqual(a.tracks.map((t) => t.title), ["Environmental Injustice", "Environmental Injustice (Brave mix)", "Please Set Me Free", "Money or the Power"]);
  for (const t of a.tracks) assert.deepEqual(t.credits.primary, ["equity-uprise"], `${t.title}: not McCluster's track`);
  assert.deepEqual(C.appearances(DOC, "equity-uprise").own.map((x) => x.track.title), a.tracks.map((t) => t.title));
  const main = track("equity-uprise", "Environmental Injustice"), brave = track("equity-uprise", "Environmental Injustice (Brave mix)");
  const free = track("equity-uprise", "Please Set Me Free"), money = track("equity-uprise", "Money or the Power");
  /* the two facts the owner set */
  assert.deepEqual(main.credits.producers, ["mccluster"], "the main mix is produced by McCluster");
  assert.deepEqual(brave.credits.producers, ["zakir-elhajoui", "mccluster"], "the Brave mix, the GA edition, by Zakir Elhajoui and McCluster");
  assert.equal(main.credit, "McCluster ft. Angel Kastro & Ocho · the Equity Uprise anthem · Produced by McCluster");
  assert.equal(brave.credit, "McCluster ft. Angel Kastro & Ocho · the GA edition · Produced by Zakir Elhajoui & McCluster");
  /* every existing credit kept */
  for (const t of [main, brave]) {
    assert.deepEqual(t.credits.lead, ["mccluster"]);
    assert.deepEqual(t.credits.featured, ["angel-kastro", "ocho"]);
  }
  assert.equal(free.credit, "Los Fidel · beat by McCluster");
  assert.deepEqual(free.credits.roles, [{ role: "beat", artist: "mccluster" }]);
  assert.equal(free.credits.producers, undefined, "no producer beyond the stated beat");
  assert.deepEqual(money.credits.featured, ["ocho", "mccluster", "old-jay"]);
  assert.deepEqual(money.credits.producers, ["pax"]);
  assert.match(money.credit, /ft\. Ocho, McCluster & Old Jay · prod\. PAX$/);
  /* "prod. PAX" was in the line under the title in the album's track list, and it still is: the owner keeps every
     credit the row showed. The two producer facts he set are in that line too. */
  assert.match(money.sub, /ft\. Ocho, McCluster & Old Jay · prod\. PAX$/, "the track row keeps prod. PAX");
  assert.match(main.sub, / · Produced by McCluster$/);
  assert.match(brave.sub, / · the GA edition · Produced by Zakir Elhajoui & McCluster$/);
  assert.equal(free.sub, "Los Fidel · beat by McCluster");
});

test("an album's track row says who is on the song and who produced it, each once", () => {
  const row = (slug, title) => C.rowLine(track(slug, title));
  assert.equal(row("equity-uprise", "Money or the Power"), "Equity Uprise ft. Ocho, McCluster & Old Jay · prod. PAX");
  assert.equal(row("equity-uprise", "Environmental Injustice (Brave mix)"), "McCluster ft. Angel Kastro & Ocho · the GA edition · Produced by Zakir Elhajoui & McCluster");
  assert.equal(row("audio-engineer", "Outta Tune"), "Produced by McCluster");
  assert.equal(row("audio-engineer", "Trackout"), "Co-produced by Tazzy Jay & McCluster");
  assert.equal(row("whip-equipped", "Dealer Plates (A-Side)"), "Produced by McCluster & Zakir Elhajoui");
  assert.equal(row("here", "Here"), "the title track · Produced by McCluster & Zakir Elhajoui", "a hand-written subtitle stays, with the producer after it");
  assert.equal(row("prim3", "High Alert"), "PRIM3 · Scored and produced by McCluster");
  assert.equal(row("cia-mind-control", "Pull Up"), "KKK", "no producer is named where none is known");
  assert.equal(row("tinderfessions", "Recipe"), "Benji Chase");
  /* every track with a producer shows that producer in its row */
  for (const al of DOC.albums) for (const t of al.tracks) {
    const producers = (t.credits.producers || []).map((s) => DOC.artists.find((a) => a.slug === s).name);
    for (const name of producers) assert.ok(C.rowLine(t).includes(name), `${al.slug} / ${t.title}: the row names ${name}`);
    if (!producers.length) assert.doesNotMatch(C.rowLine(t), /produced|prod\./i, `${al.slug} / ${t.title}: no producer in the row`);
  }
  assert.equal(C.rowLine({ title: "x", sub: "a creator's cut" }), "a creator's cut", "a track with no credit line keeps its subtitle");
  assert.equal(C.rowLine({ title: "x" }), "");
  const page = read("album.html");
  assert.match(page, /esc\(t\.albName \? \(t\.sub \|\| t\.albName\) : \(window\.MCC_CREDITS \? window\.MCC_CREDITS\.rowLine\(t\) : \(t\.sub \|\| ""\)\)\)/, "the album's own rows print the row line; a playlist row keeps its subtitle or album");
  /* the line wraps in the album room: nothing there cuts it with an ellipsis */
  const rule = /\n    \.tr \.t small \{[^}]*\}/.exec(page)[0];
  assert.doesNotMatch(rule, /nowrap|ellipsis/);
});

test("owner: Upset is a Hitman Benji song", () => {
  const t = track("singles", "Upset");
  assert.deepEqual(t.credits.primary, ["hitman-benji", "raheem", "rahndrx"]);
  assert.equal(t.credit, "Hitman Benji × Raheem × Rahndrx");
  assert.equal(DOC.artists.find((a) => a.slug === "hitman-benji").name, "Hitman Benji");
  for (const f of ["data/albums.json", "data/catalogue.json", "catalogue.html", "llms.txt"]) assert.doesNotMatch(read(f), /Hitman Halo/, `${f}: the old name is gone`);
  assert.doesNotMatch(read("data/prayer-closet.json"), /Hitman Halo × Raheem/, "the credit is not quoted with the old name anywhere");
});

test("owner: Upset is billed to its own artists on every player, never to the house by default", () => {
  const singles = album("singles"), t = track("singles", "Upset");
  assert.equal(singles.artist, undefined, "the Singles shelf has no artist of its own");
  assert.equal(C.billedTo(DOC, t), "Hitman Benji × Raheem × Rahndrx");
  assert.equal(t.artist, "Hitman Benji × Raheem × Rahndrx", "stored on the track by tools/build-music-credits.mjs");
  assert.deepEqual(JSON.parse(JSON.stringify(C.albumBilling(DOC, singles))), { name: "Hitman Benji × Raheem × Rahndrx", slugs: ["hitman-benji", "raheem", "rahndrx"] });
  /* a record the house is a primary artist of keeps the house's billing; an album that names its artist needs none */
  for (const slug of ["here", "whip-equipped", "vaunt-ep", "audio-engineer", "heal-the-3"]) assert.equal(C.albumBilling(DOC, album(slug)), null, slug);
  assert.equal(C.billedTo(DOC, track("heal-the-3", "Deep End")), "", "McCluster is a primary artist of Heal the 3");
  assert.equal(C.billedTo(DOC, { title: "a creator's cut" }), "");
  assert.deepEqual(JSON.parse(JSON.stringify(C.albumBilling(DOC, { tracks: [t, track("cia-mind-control", "Pull Up")] }))), { name: "Various artists", slugs: [] }, "a shelf of different artists' songs is nobody's alone");
  /* track.artist is written only where the album does not already say whose record it is */
  for (const al of DOC.albums) for (const x of al.tracks) {
    const by = C.billedTo(DOC, x);
    assert.equal(x.artist, by && by !== (al.artist || "") ? by : undefined, `${al.slug} / ${x.title}`);
    /* and no record the house is not a primary artist of can fall through to the house */
    if (!x.credits.primary.includes("mccluster")) assert.ok(x.artist || al.artist, `${al.slug} / ${x.title}: billed by name`);
  }
  /* the one player, the album room and its shelf read the track's artist before the album's and the house */
  assert.match(read("js/music-engine.js"), /artist: t\.artist \|\| a\.artist \|\| "Matthew McCluster",/);
  const page = read("album.html");
  assert.equal(page.split('artist: t.artist || a.artist || "" }').length - 1, 2, "a playlist's rows carry the song's own artist");
  assert.match(page, /var billed = window\.MCC_CREDITS\.albumBilling\(data, alb\);\n\s+if \(billed\) \{ head\.artist = billed\.name; head\.billed = billed\.slugs; \}/, "the album heading is the billing its tracks give it");
  assert.match(page, /var firstBy = first\.artist \|\| a\.artist \|\| "";/, "the shelf's taste of a record is billed the same way");
  assert.match(page, /' data-artist="' \+ escAttr\(t\.artist \|\| ""\) \+ '"'/, "the row carries it to the lock screen");
});

test("owner: no producer is named on the KKK album or on Benji Chase's albums", () => {
  for (const [slug, n, by] of [["cia-mind-control", 3, "kkk"], ["tinderfessions", 12, "benji-chase"], ["in-hot-pursuit", 8, "benji-chase"]]) {
    const a = album(slug);
    assert.equal(a.tracks.length, n, slug);
    for (const t of a.tracks) {
      assert.deepEqual(t.credits.primary, [by], `${slug} / ${t.title}`);
      assert.equal(t.credits.producers, undefined, `${slug} / ${t.title}: no producer`);
      assert.equal(t.credits.roles, undefined, `${slug} / ${t.title}: no other role`);
      assert.doesNotMatch(t.credit, /prod|beat|score/i, `${slug} / ${t.title}: ${t.credit}`);
    }
    assert.doesNotMatch(JSON.stringify(a), /McCluster|Zakir|Elhajoui/, `${slug}: nobody else is named`);
  }
  assert.deepEqual(track("tinderfessions", "One Gon' Ride (feat. Jiddy)").credits.featured, ["jiddy"], "the feature its title names");
});

test("owner: the Audio Engineer EP, in order, produced by McCluster, Trackout with Tazzy Jay", () => {
  const a = album("audio-engineer");
  assert.deepEqual(a.tracks.map((t) => t.title), ["Outta Tune", "Studio Trapped", "Sound Trust Anthem", "Trackout"]);
  for (const t of a.tracks) assert.deepEqual(t.credits.primary, ["mccluster"], t.title);
  for (const t of a.tracks.slice(0, 3)) {
    assert.deepEqual(t.credits.producers, ["mccluster"], `${t.title}: McCluster alone`);
    assert.equal(t.credit, "Produced by McCluster");
  }
  assert.deepEqual(a.tracks[3].credits.producers, ["tazzy-jay", "mccluster"]);
  assert.equal(a.tracks[3].credit, "Co-produced by Tazzy Jay & McCluster");
  assert.equal(a.art, "assets/img/audio-engineer-cover.png");
});

test("owner: every credited artist has an entry, and opening one shows everything they appear on", () => {
  const roster = C.roster(DOC);
  assert.equal(roster[0].slug, "mccluster", "McCluster first");
  const credited = new Set();
  for (const al of DOC.albums) for (const t of al.tracks) for (const x of C.credited(t)) credited.add(x.slug);
  assert.deepEqual([...credited].sort(), roster.map((a) => a.slug).sort(), "the roster is exactly everybody credited");
  for (const slug of ["los-fidel", "angel-kastro", "ocho", "old-jay", "pax", "vvs-made", "jiddy", "tazzy-jay", "raheem", "rahndrx", "hitman-benji", "zakir-elhajoui", "equity-uprise", "prim3", "kkk", "benji-chase"]) {
    assert.ok(roster.some((a) => a.slug === slug), `${slug} has an entry`);
  }
  /* the owner's example */
  const fidel = C.appearances(DOC, "los-fidel");
  assert.deepEqual([...fidel.own, ...fidel.featured, ...fidel.produced, ...fidel.other].map((x) => [x.album.slug, x.track.title]), [["equity-uprise", "Please Set Me Free"]]);
  assert.equal(roster.find((a) => a.slug === "los-fidel").href, "artist.html?artist=los-fidel");
  /* opening an artist shows everything they appear on. An artist's own page is opened directly only when it lists
     everything: PRIM3's does (all thirteen PRIM3 songs, on the one record that names that page); the house does not
     list the Equity Uprise records McCluster features on, so McCluster opens the artist view like everybody else */
  const prim3 = DOC.artists.find((a) => a.slug === "prim3"), house = DOC.artists.find((a) => a.slug === "mccluster");
  assert.equal(C.pageListsAll(DOC, prim3), true);
  assert.equal(roster.find((a) => a.slug === "prim3").href, "prim3-artist.html");
  const prim3Page = read("prim3-artist.html");
  for (const x of C.appearances(DOC, "prim3").own) assert.ok(prim3Page.includes(x.track.title.replace(/&/g, "&amp;")), `prim3-artist.html lists ${x.track.title}`);
  assert.equal(C.count(DOC, "prim3"), C.appearances(DOC, "prim3").own.length, "PRIM3 is on nothing but its own record");
  assert.equal(C.pageListsAll(DOC, house), false, "index.html does not list what McCluster features on or produced for others");
  assert.equal(roster.find((a) => a.slug === "mccluster").href, "artist.html?artist=mccluster");
  assert.equal(C.href(house), "artist.html?artist=mccluster", "with no catalogue to check, the artist view");
  for (const a of roster) if (a.slug !== "prim3") assert.equal(a.href, `artist.html?artist=${a.slug}`, a.slug);
  assert.equal(C.pageListsAll({ artists: [], albums: [{ slug: "x", artist_page: "p.html", tracks: [{ title: "a", credits: { primary: ["z"] } }] }, { slug: "y", tracks: [{ title: "b", credits: { primary: ["q"], featured: ["z"] } }] }] }, { slug: "z", page: "p.html" }), false, "one feature elsewhere and the page no longer lists everything");
  /* Ocho is on three records, and all three are found */
  assert.deepEqual(C.appearances(DOC, "ocho").featured.map((x) => x.track.title), ["Environmental Injustice", "Environmental Injustice (Brave mix)", "Money or the Power"]);
  /* Zakir Elhajoui: 6 + 11 + 2 + 1 produced with McCluster, the Brave mix, and the guitar on Vaunt */
  const z = C.appearances(DOC, "zakir-elhajoui");
  assert.equal(z.produced.length, 21);
  assert.deepEqual(z.other.map((x) => [x.track.title, x.role]), [["Vaunt (Acoustic)", "guitar"]]);
  assert.equal(C.count(DOC, "zakir-elhajoui"), 21);
});

/* js/music-community.js in a page that is only as real as the row needs */
async function artistsRow(profiles) {
  const els = {};
  const escText = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const make = () => { const e = { className: "", innerHTML: "", setAttribute() {}, querySelector: () => null, insertBefore(n) { if (n.id) els[n.id] = n; }, appendChild(n) { if (n.id) els[n.id] = n; } };
    Object.defineProperty(e, "textContent", { set(v) { e.innerHTML = escText(v); } }); return e; };
  const ls = make();
  const document = {
    body: { classList: { contains: (c) => c === "music-room--listen" } },
    createElement: make,
    querySelector: (q) => (q === ".ls" ? ls : null),
    getElementById: (id) => { if (id === "artistsRow") return els.artistsWrap ? (els.artistsRow || (els.artistsRow = make())) : null; return els[id] || null; }
  };
  const fetch = async (url) => {
    const u = String(url);
    if (u === "data/albums.json") return { ok: true, json: async () => DOC };
    if (u.includes("music_creator_profiles")) return { ok: true, json: async () => profiles };
    if (u.includes("creator_tracks")) return { ok: true, json: async () => [] };
    throw new Error("unexpected request " + u);
  };
  const window = { document, fetch, MCC_CREDITS: C };
  vm.runInNewContext(read("js/music-community.js"), { window, fetch, document, Promise, encodeURIComponent, String, Object, Error, Array, setTimeout });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const html = els.artistsRow.innerHTML;
  artistsRow.fold = window.MCC_ARTISTS_ROW.fold;
  artistsRow.html = html;
  return [...html.matchAll(/<a class="artist[^"]*" href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
    href: m[1].replace(/&amp;/g, "&"), name: /<b>(.*?)<\/b>/.exec(m[2])[1], small: /<small>(.*?)<\/small>/.exec(m[2])[1],
    img: /<img/.test(m[2]), initial: (/artist__pic--initial[^>]*>(.*?)<\/span>/.exec(m[2]) || [])[1] || ""
  }));
}

test("the Artists row: McCluster first, everybody credited, a profile merged by handle, nobody twice", async () => {
  const AVATAR = "https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/11111111-1111-4111-8111-111111111111/benji.jpg";
  const cards = await artistsRow([
    { m_uid: "a", handle: "mccluster", artist_name: "McCluster", avatar_url: "", verification_state: "verified" },
    { m_uid: "b", handle: "benjichase", artist_name: "Benji Chase", avatar_url: AVATAR, verification_state: "none" },
    { m_uid: "c", handle: "newvoice", artist_name: "New Voice", avatar_url: "", verification_state: "none" },
    { m_uid: "d", handle: "ocho", artist_name: "", avatar_url: "", verification_state: "none" }
  ]);
  const names = cards.map((c) => c.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `no name twice: ${names.join(", ")}`);
  assert.deepEqual(cards[0], { href: "artist.html?artist=mccluster", name: "McCluster", small: "@mccluster", img: true, initial: "" }, "McCluster first, once, the M as supplied, opening everything he appears on");
  const roster = C.roster(DOC).filter((a) => a.slug !== "mccluster");
  /* every catalogue artist is in the row, in the registry's order, before the creators the catalogue does not know */
  assert.deepEqual(cards.slice(1, 1 + roster.length).map((c) => c.name), roster.map((a) => (a.slug === "ocho" ? "@ocho" : a.name)));
  assert.deepEqual(cards.slice(1 + roster.length).map((c) => c.name), ["New Voice"]);
  /* an artist with no profile: the artist view, their initial, how much they are on */
  const fidel = cards.find((c) => c.name === "Los Fidel");
  assert.deepEqual(fidel, { href: "artist.html?artist=los-fidel", name: "Los Fidel", small: "1 track", img: false, initial: "L" });
  assert.equal(cards.find((c) => c.name === "Zakir Elhajoui").small, "21 tracks");
  assert.equal(cards.find((c) => c.name === "Equity Uprise").href, "artist.html?artist=equity-uprise");
  assert.equal(cards.find((c) => c.name === "PRIM3").href, "prim3-artist.html", "an act with its own page opens it");
  /* an artist with a profile: their own page and picture, once (handle benjichase is slug benji-chase; handle ocho is slug ocho) */
  const benji = cards.filter((c) => /benji chase/i.test(c.name));
  assert.deepEqual(benji, [{ href: "music-creator.html?handle=benjichase", name: "Benji Chase", small: "@benjichase", img: true, initial: "" }]);
  assert.equal(cards.filter((c) => /ocho/i.test(c.name)).length, 1);
  /* nothing is drawn for anybody: a picture is a stored avatar or the supplied M, else a letter */
  for (const c of cards) assert.ok(c.img || /^[A-Z0-9@]$/.test(c.initial), `${c.name}: an avatar or an initial`);
  /* with no directory at all the catalogue's artists are still listed */
  const alone = await artistsRow([]);
  assert.deepEqual(alone.map((c) => c.name), ["McCluster", ...roster.map((a) => a.name)]);
  /* the row is the same horizontal rail, phone first; with room it wraps, so no artist is off the edge for a mouse */
  const css = read("css/music-room.css");
  assert.match(css, /\.artists__row \{ display: flex; gap: 0\.9rem; overflow-x: auto;/);
  assert.match(css, /@media \(min-width: 600px\) \{ \.artists__row \{ gap: 1\.1rem; flex-wrap: wrap; overflow-x: visible; row-gap: 1rem; \}/);
  assert.doesNotMatch(css.slice(css.indexOf(".artists__row")), /@media \(max-width/);
  /* a search narrows the row by name: every card carries the name it is found by, and a hidden card is gone */
  assert.match(css, /\.artist\[hidden\] \{ display: none; \}/);
  assert.match(artistsRow.html, /<a class="artist" href="artist\.html\?artist=los-fidel" data-name="Los Fidel">/);
  assert.match(artistsRow.html, /<a class="artist artist--house" href="artist\.html\?artist=mccluster" data-name="McCluster" aria-label="McCluster">/);
  const fold = artistsRow.fold;
  assert.equal(fold("VVS Madè"), fold("vvs made"), "an accent is not a different letter");
  assert.equal(fold("  Los   FIDEL "), "los fidel");
  const community = read("js/music-community.js");
  assert.match(community, /searchBox\.addEventListener\("input", narrowArtists\);/);
  assert.match(community, /wrap\.hidden = words\.length > 0 && shown === 0;/, "a search that names no artist takes the row out of the way");
  assert.match(read("listen.html"), /js\/music-credits\.js\?v=__STAMP__"><\/script>\n  <script src="js\/listen\.js/, "the credits reader loads before the room");
});

test("the artist view renders an artist's appearances, grouped by role, playable, linked to the album", () => {
  const window = { MCC_CREDITS: C };
  vm.runInNewContext(read("js/music-artist.js"), { window, globalThis: window, URLSearchParams, encodeURIComponent, String, Number, Math });
  /* values made in the vm's realm: compare them as plain data */
  const V = { view: (doc, slug) => JSON.parse(JSON.stringify(window.MCC_ARTIST_VIEW.view(doc, slug))) };
  const fidel = V.view(DOC, "los-fidel");
  assert.equal(fidel.name, "Los Fidel");
  assert.equal(fidel.initial, "L");
  assert.equal(fidel.summary, "Artist · on 1 track in the McCluster catalogue");
  assert.deepEqual(fidel.sections.map((s) => [s.key, s.title, s.count]), [["featured", "Featured on", 1]]);
  const html = fidel.sections[0].html;
  assert.match(html, /<a class="row" href="album\.html\?album=equity-uprise&amp;t=Please%20Set%20Me%20Free"/, "the row opens its album at the song");
  assert.match(html, /<button class="music-inline-play" type="button" aria-label="Play Please Set Me Free" aria-pressed="false" data-music-play data-album="equity-uprise" data-track="Please Set Me Free">/, "the row plays through the one player");
  assert.match(html, /<small>Docket 516R &middot; Los Fidel · beat by McCluster<\/small>/, "the album and the generated credit line");
  assert.match(html, /<span class="d">3:23<\/span>/);
  const eu = V.view(DOC, "equity-uprise");
  assert.equal(eu.summary, "Act · on 4 tracks in the McCluster catalogue");
  assert.deepEqual(eu.sections.map((s) => [s.key, s.count]), [["own", 4]]);
  const z = V.view(DOC, "zakir-elhajoui");
  assert.deepEqual(z.sections.map((s) => [s.title, s.count]), [["Produced", 21], ["Also credited", 1]]);
  const m = V.view(DOC, "mccluster");
  assert.deepEqual(m.sections.map((s) => s.key), ["own", "featured", "produced"]);
  assert.equal(m.page, "index.html", "the house keeps its page, and the view links to it");
  assert.equal(V.view(DOC, "prim3").page, "prim3-artist.html");
  assert.equal(V.view(DOC, "nobody"), null, "an unknown slug renders nothing");
  /* a name is text: nothing in the registry reaches the page as markup */
  const hostile = { artists: [{ slug: "x", name: "<img src=x onerror=1>", kind: "person" }], albums: [{ slug: "a", name: "A<b>", art: "a.jpg", tracks: [{ title: "T<i>", seconds: 61, credits: { primary: ["x"] } }] }] };
  assert.doesNotMatch(V.view(hostile, "x").sections[0].html, /<img|<b>|<i>/);
  /* the page itself */
  const page = read("artist.html");
  assert.doesNotMatch(page, /<link rel="canonical"/, "one template for every artist: no address that would fold them all into one");
  assert.equal((page.match(/<h1\b/g) || []).length, 1);
  for (const id of ["artistPic", "artistName", "artistSummary", "artistOwn", "artistSections"]) assert.ok(page.includes(`id="${id}"`), id);
  const order = ["js/now-playing.js", "js/music-engine.js", "js/music-credits.js", "js/music-artist.js"].map((f) => page.indexOf(`<script src="${f}?v=__STAMP__">`));
  assert.ok(order.every((i) => i > 0) && order.join() === [...order].sort((a, b) => a - b).join(), "the player, then the credits reader, then the view");
  assert.match(page, /<span class="artist__pic artist__pic--initial av__pic" id="artistPic" aria-hidden="true"><\/span>/, "an initial, never a drawn mark");
  assert.doesNotMatch(page, /<img[^>]*id="artistPic"|<svg[^>]*artist/i);
  /* mobile first (AGENTS.md rule 14) */
  assert.doesNotMatch(page, /@media \(max-width/, "min-width queries only");
  for (const g of page.matchAll(/grid-template-columns:([^;]+);/g)) assert.doesNotMatch(g[1].replace(/minmax\([^)]*\)/g, ""), /\b1fr/, `no bare 1fr: ${g[1]}`);
  assert.doesNotMatch(page, /user-scalable=no|maximum-scale=1/);
  /* a creator's own page keeps its page and gains one line to the same list, matched as the Artists row merges */
  const who = (handle, name) => { const a = window.MCC_ARTIST_VIEW.artistFor(DOC, handle, name); return a ? a.slug : null; };
  assert.equal(who("hitman-benji", ""), "hitman-benji");
  assert.equal(who("benjichase", ""), "benji-chase", "a handle is its slug without the punctuation");
  assert.equal(who("bc.official", "Benji Chase"), "benji-chase", "or the same name");
  assert.equal(who("royce.r01", "Royce"), null, "a creator the catalogue does not credit gets no line");
  assert.equal(who("", ""), null);
  const creator = read("music-creator.html");
  /* a creator's own front page lists everything the catalogue credits them on, on the page itself */
  assert.match(creator, /<section class="ap-singles ap-cat" id="apCatalogue" aria-labelledby="apCatalogueTitle" hidden><\/section>/);
  const rows = window.MCC_ARTIST_VIEW.creatorRows(DOC, "hitman-benji");
  assert.equal((rows.match(/<li class="ap-track">/g) || []).length, 1);
  assert.match(rows, /<a href="album\.html\?album=singles&amp;t=Upset" data-cta="creator-catalogue-track">Upset<\/a>/);
  assert.match(rows, /<small>Singles &middot; Hitman Benji × Raheem × Rahndrx<\/small>/);
  assert.match(rows, /<button class="creator-play" type="button" data-music-play data-album="singles" data-track="Upset" aria-label="Play Upset" aria-pressed="false">/);
  const ocho = window.MCC_ARTIST_VIEW.creatorRows(DOC, "ocho");
  assert.equal((ocho.match(/<li class="ap-track">/g) || []).length, C.count(DOC, "ocho"), "every track, once");
  const zakir = window.MCC_ARTIST_VIEW.creatorRows(DOC, "zakir-elhajoui");
  assert.equal((zakir.match(/<li class="ap-track">/g) || []).length, 21, "Vaunt is listed once though he is on it twice");
  assert.doesNotMatch(window.MCC_ARTIST_VIEW.creatorRows(hostile, "x"), /<img src=x|<b>A|<i>/, "names are text there too");
  assert.match(read("js/music-artist.js"), /'<ol class="ap-tracks">' \+ creatorRows\(albums, a\.slug\) \+ "<\/ol>"/);
  assert.match(read("css/music-artist.css"), /\.ap-track img\.ap-track__cover\{object-fit:contain;background:none\}/, "a record's cover is shown whole there");
  /* in the artist view the credit wraps: it is the reason the artist is on the page */
  assert.match(page, /main\.ls \.tr \.t small \{ white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere;/);
  const at = (f) => creator.indexOf(`<script src="${f}?v=__STAMP__">`);
  assert.ok(at("js/music-engine.js") > 0 && at("js/music-engine.js") < at("js/music-credits.js") && at("js/music-credits.js") < at("js/music-artist.js"), "the player, the credits reader, then the line");
  /* the same bar as the listening room, no new global navigation */
  const bar = (h) => /<nav class="appbar"[\s\S]*?<\/nav>/.exec(h)[0];
  assert.equal(bar(page), bar(read("listen.html")));
});

test("search finds a track by any credited artist's name", () => {
  const js = read("js/listen.js");
  assert.match(js, /people: root\.MCC_CREDITS \? root\.MCC_CREDITS\.names\(albums, t\)\.join\(" "\) : ""/);
  /* the search's own key, run as written: accents and case do not matter */
  const key = vm.runInNewContext("(" + /function key\(s\) \{[\s\S]*?\n  \}/.exec(js)[0] + ")", { String });
  assert.equal(key("VVS Madè"), "vvs made");
  assert.equal(key("VVS Made"), key("vvs madè"));
  assert.ok(key(C.names(DOC, track("heal-the-3", "Deep End")).join(" ")).includes(key("VVS Made")), "VVS Made finds Deep End");
  assert.equal(key("Mr. Lock Changer (Remix)"), "mr lock changer remix");
  assert.match(js, /key\(t\.title \+ " " \+ t\.album \+ " " \+ t\.credit \+ " " \+ t\.sub\) \+ " " \+ key\(t\.people\)/);
  const names = (slug, title) => C.names(DOC, track(slug, title));
  assert.deepEqual(names("vaunt-ep", "Vaunt (Acoustic)"), ["McCluster", "Zakir Elhajoui", "Zakir"], "the full name, though the line says guitar by Zakir");
  assert.deepEqual(names("equity-uprise", "Please Set Me Free"), ["Equity Uprise", "Los Fidel", "McCluster"]);
  assert.deepEqual(names("equity-uprise", "Money or the Power"), ["Equity Uprise", "Ocho", "McCluster", "Old Jay", "PAX"]);
  assert.ok(names("tinderfessions", "One Gon' Ride (feat. Jiddy)").includes("Jiddy"));
  assert.ok(names("audio-engineer", "Trackout").includes("Tazzy Jay"));
});

test("\"written & performed by Matthew McCluster\" stands only under records that are all his own", () => {
  const own = (slug) => C.houseOnly(album(slug).tracks);
  for (const slug of ["here", "whip-equipped", "vaunt-ep", "audio-engineer"]) assert.equal(own(slug), true, slug);
  for (const slug of ["prim3", "equity-uprise", "cia-mind-control", "tinderfessions", "in-hot-pursuit", "singles", "heal-the-3"]) assert.equal(own(slug), false, slug);
  assert.equal(C.houseOnly([]), false);
  assert.equal(C.houseOnly([{ title: "a creator's cut" }]), false, "a track with no structure makes no claim");
  const page = read("album.html");
  assert.match(page, /<span id="albWritten" hidden>Every track written &amp; performed by Matthew McCluster · <\/span>QT6KV catalogue\./, "hidden until the record is known to be his");
  assert.match(page, /written\.hidden = !\(window\.MCC_CREDITS && window\.MCC_CREDITS\.houseOnly\(queue\)\);/);
  assert.match(page, /\(ARTIST === HOUSE \? "Written & performed by " \+ ARTIST \+ " · QT6KV" : ARTIST\)/, "no such claim for another act's track");
  /* a song with no film shows its cover in the now sheet whole: supplied artwork is scaled, never cropped */
  assert.match(page, /\.now__film\.is-cover \{ object-fit: contain; \}/);
  assert.match(page, /nowFilm\.classList\.toggle\("is-cover", !src\);/);
  assert.ok(page.indexOf('js/music-credits.js?v=__STAMP__') > 0);
  for (const f of ["listen.html", "catalogue.html", "llms.txt"]) assert.doesNotMatch(read(f), /unless credited otherwise/, `${f}: the blanket line is gone`);
  for (const f of ["listen.html", "catalogue.html"]) assert.match(read(f), /McCluster&rsquo;s own records are written &amp; performed by Matthew McCluster; every other record names its artist\./);
  /* and every record that is not his does name its artist in the line a list shows */
  for (const al of DOC.albums) for (const t of al.tracks) {
    if (t.credits.primary.length === 1 && t.credits.primary[0] === "mccluster" && !t.credits.lead) continue;
    assert.ok(t.credit, `${al.slug} / ${t.title}: a record that is not McCluster's alone says whose it is`);
  }
});

test("the catalogue graph carries the structured credits with the identities it already had", () => {
  const graph = nodes(ld(read("catalogue.html")));
  const rec = (name) => graph.find((n) => n["@type"] === "MusicRecording" && n.name === name);
  const who = (v) => [].concat(v || []).map((x) => x["@id"] || x.name);
  assert.deepEqual(who(rec("Environmental Injustice").producer), [PERSON]);
  assert.deepEqual(who(rec("Environmental Injustice (Brave mix)").producer), ["Zakir Elhajoui", PERSON]);
  assert.deepEqual(who(rec("Dealer Plates (A-Side)").producer), [PERSON, "Zakir Elhajoui"]);
  assert.deepEqual(who(rec("Who Did The Shoot").byArtist), [PERSON]);
  assert.deepEqual(who(rec("Upset").byArtist), ["Hitman Benji", "Raheem", "Rahndrx"]);
  assert.ok(!JSON.stringify(rec("Upset")).includes(PERSON), "no role is claimed for Matthew on Upset");
  assert.deepEqual(who(rec("Vaunt (Acoustic)").contributor), ["Zakir Elhajoui"], "the guitar is a contribution");
  /* no new identity: the only @ids credited are the three the site already defined */
  const ids = new Set();
  for (const r of graph.filter((n) => n["@type"] === "MusicRecording" || n["@type"] === "MusicAlbum")) {
    for (const k of ["byArtist", "contributor", "producer"]) for (const x of [].concat(r[k] || [])) if (x["@id"]) ids.add(x["@id"]);
  }
  assert.deepEqual([...ids].sort(), [PERSON, `${SITE}/catalogue.html#artist-equity-uprise`, `${SITE}/prim3-artist.html#prim3-artist`].sort());
  assert.equal(graph.filter((n) => n["@type"] === "Person" && n.name === "Zakir Elhajoui" && n["@id"]).length, 0, "Zakir Elhajoui is a name, not an invented @id");
  assert.ok(!graph.some((n) => n.name === "Zakir"), "the short name is not a node");
  /* albums: by and produced by, only where every track agrees */
  const alb = (slug) => graph.find((n) => n["@id"] === `${SITE}/catalogue.html#album-${slug}`);
  assert.deepEqual(who(alb("whip-equipped").producer), [PERSON, "Zakir Elhajoui"]);
  assert.deepEqual(who(alb("tinderfessions").byArtist), ["Benji Chase"]);
  assert.equal(alb("tinderfessions").producer, undefined);
  assert.equal(alb("equity-uprise").producer, undefined, "Docket 516R has no one producer");
  assert.equal(alb("audio-engineer").producer, undefined, "Trackout has a co-producer, so the EP names none as a whole");
  const kkk = alb("cia-mind-control");
  assert.ok(!kkk.byArtist && !kkk.producer && !kkk.track, "CIA Mind Control stays out of the graph's credits");
});

test("staged SQL: the plane's three catalog rows that said something else take the owner's words", () => {
  /* never applied here: supabase/pending, with a rollback and a PROMOTION-ORDER row */
  const sql = read("supabase/pending/20261124130000_music_catalog_owner_credits.sql"), back = read("supabase/pending/20261124130000_music_catalog_owner_credits.rollback.sql");
  const upset = track("singles", "Upset"), main = track("equity-uprise", "Environmental Injustice"), brave = track("equity-uprise", "Environmental Injustice (Brave mix)");
  assert.ok(sql.includes(`set artist_name='${upset.artist}', updated_at=now()\n where catalog_key='singles:upset' and artist_name='McCluster';`), "Upset names its own artists");
  assert.ok(sql.includes(`set credit_line='${main.credit}', updated_at=now()\n where catalog_key='equity-uprise:environmental-injustice' and credit_line='McCluster ft. Angel Kastro & Ocho';`));
  assert.ok(sql.includes(`set credit_line='${brave.credit}', updated_at=now()\n where catalog_key='equity-uprise:environmental-injustice-brave-mix' and credit_line='McCluster ft. Angel Kastro & Ocho · the GA edition';`));
  /* each guard is the word the 2026-10-03 seed wrote, so the update finds the row it means to change */
  const seed = read("supabase/migrations/20261003233747_action_network_live_governance_v1.sql");
  assert.ok(seed.includes("('singles:upset','singles','Singles','Upset','McCluster',"));
  assert.ok(seed.includes("'Environmental Injustice','Equity Uprise','McCluster ft. Angel Kastro & Ocho','assets/"));
  assert.ok(seed.includes("'Environmental Injustice (Brave mix)','Equity Uprise','McCluster ft. Angel Kastro & Ocho · the GA edition','assets/"));
  const code = (text) => text.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.equal((code(sql).match(/\bupdate public\.music_catalog_objects\b/g) || []).length, 3, "three rows, nothing else");
  assert.doesNotMatch(code(sql) + code(back), /\b(insert|delete|drop|alter|create|truncate|grant)\b/i, "words only: no row added or removed, no schema");
  for (const words of [upset.artist, main.credit, brave.credit]) assert.ok(back.includes(`='${words}';`), "the rollback is guarded by the words this file wrote");
  assert.match(read("supabase/pending/PROMOTION-ORDER.md"), /## 19\. Music catalog rows: the owner's credit rules of 2026-11-24[\s\S]*20261124130000_music_catalog_owner_credits\.sql/);
});
