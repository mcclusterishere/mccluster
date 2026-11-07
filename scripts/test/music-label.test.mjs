/* PRIM3, ITS OWN ARTIST, ON A LABEL.

   Owner, 2026-11-02: "make PRIM3 the album is actually called Cyber Security
   Specialist. In the artist is PRIM3. PRIM3 needs their own artist page as
   that is its own artist. Separate entity from Matthew McCluster. But
   controlled by Matthew McCluster's account until it gets its own login."
   And: "as an admin, I want to test multiple, or like being a label account
   type shit where I can have multiple artists on my account."

   Without a database: the album and its billing, the act as its own entity
   (never Matthew's @id), its page, the label SQL's shape (the guards it
   replaces are the migrations' bodies with only the label lines changed,
   and its rollback restores them byte for byte), and Control's "Acting as"
   switcher. The SQL's behaviour: scripts/test-music-label-db.sh. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));
const SITE = "https://matthew.mccluster.org";
const PERSON = `${SITE}/#matthew-mccluster`;
const ACT = `${SITE}/prim3-artist.html#prim3-artist`;
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => nodes(x, out)); else if (v && typeof v === "object") { out.push(v); Object.values(v).forEach((x) => nodes(x, out)); } return out; };
const ids = (v) => [].concat(v || []).map((x) => x && x["@id"]);

const PENDING = read("supabase/pending/music_label_artists_v1.sql");
const ROLLBACK = read("supabase/pending/music_label_artists_v1.rollback.sql");
const PLATFORM = read("supabase/migrations/20260920041011_music_creator_platform_v1.sql");
const INTEGRITY = read("supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql");

/* a function's text as a migration wrote it, through its revoke line when it has one */
function fnText(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}()`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = sql.indexOf("end $$;", start) + "end $$;".length;
  return sql.slice(start, end);
}

test("the album is Cyber Security Specialist, billed to PRIM3, at the same slug", () => {
  const p3 = json("data/albums.json").albums.find((a) => a.slug === "prim3");
  assert.equal(p3.name, "Cyber Security Specialist");
  assert.equal(p3.artist, "PRIM3", "the album is billed to PRIM3, not the house artist");
  assert.equal(p3.artist_page, "prim3-artist.html");
  assert.equal(p3.tracks.length, 13);
  const cat = json("data/catalogue.json").tracks.filter((t) => t.albumSlug === "prim3");
  assert.equal(cat.length, 13);
  for (const t of cat) {
    assert.equal(t.album, "Cyber Security Specialist", t.slug);
    assert.ok(t.credit === "PRIM3" || t.slug === "got-wifi", `${t.slug}: credited to PRIM3`);
  }
  /* album.html bills it and links the name to the act's page */
  const album = read("album.html");
  assert.match(album, /artistPage: alb\.artist_page \|\| ""/);
  assert.match(album, /\/\^\[a-z0-9-\]\+\\\.html\$\/\.test\(head\.artistPage/, "only a same-site page name becomes the link");
});

test("every Cyber Security Specialist recording is by the PRIM3 act, never Matthew's @id", () => {
  const graph = nodes(ld(read("catalogue.html")));
  const album = graph.find((n) => n["@id"] === `${SITE}/catalogue.html#album-prim3`);
  assert.equal(album.name, "Cyber Security Specialist");
  assert.deepEqual(ids(album.byArtist), [ACT]);
  const recs = graph.filter((n) => n["@type"] === "MusicRecording" && n.inAlbum && n.inAlbum["@id"] === album["@id"]);
  assert.ok(recs.length >= 1, "Got WiFi? (registered) is in the catalogue graph");
  for (const r of recs) {
    assert.deepEqual(ids(r.byArtist), [ACT], `${r.name}: byArtist PRIM3`);
    assert.ok(!JSON.stringify(r).includes(PERSON), `${r.name}: no credit for Matthew is claimed`);
  }
  const act = graph.find((n) => n["@id"] === ACT && n["@type"] === "MusicGroup");
  assert.equal(act.name, "PRIM3");
  /* the artist page lists all 13, each by the act */
  const page = nodes(ld(read("prim3-artist.html")));
  const pageRecs = page.filter((n) => n["@type"] === "MusicRecording");
  assert.equal(pageRecs.length, 13);
  for (const r of pageRecs) assert.deepEqual(ids(r.byArtist), [ACT], `${r.name}: byArtist PRIM3 on its page`);
  assert.ok(!JSON.stringify(ld(read("prim3-artist.html"))).includes(PERSON), "the act's page credits Matthew as nothing");
});

test("PRIM3 the act is its own entity: defined once in the graph, on its page, not on Matthew's profile", () => {
  const eg = json("data/seo/entity-graph.json");
  const node = eg.music_acts.prim3;
  assert.equal(node["@type"], "MusicGroup");
  assert.equal(node["@id"], ACT);
  assert.notEqual(node["@id"], eg.projects.prim3["@id"], "the act is not the PRIM3 learning product");
  assert.match(node.description, /separate from Matthew McCluster/);
  const onPage = nodes(ld(read("prim3-artist.html"))).find((n) => n["@id"] === ACT && n["@type"] === "MusicGroup");
  assert.deepEqual(onPage, node, "the page says what entity-graph.json says");
  assert.ok(!read("matthew-mccluster.html").includes(ACT), "Matthew's profile graph does not list the act");
  const arch = json("data/seo/domain-architecture.json");
  const e = arch.entities.prim3_artist;
  assert.equal(e.id, ACT);
  assert.equal(e.managed_by, "matthew_mccluster");
  assert.match(e.management, /no content moves|No content moves|no auth link/i);
  assert.ok(arch.url_ownership.company_hosted_on_personal_for_compatibility.includes("/prim3-artist.html"));
  assert.match(read("docs/control-plane/DOMAINS-AND-ENTITIES.md"), /PRIM3 the artist is its own entity/);
  execFileSync("node", ["tools/build-prim3-artist.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("the artist page: the supplied mark whole, the album, the course, and who manages it, said plainly", () => {
  const html = read("prim3-artist.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/matthew\.mccluster\.org\/prim3-artist\.html">/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<img class="p3a__mark" src="assets\/img\/prim3-logo\.png" alt="" width="256" height="256">/, "the supplied artwork, scaled whole");
  assert.doesNotMatch(html, /object-fit:\s*cover|clip-path|<svg[^>]*prim3/i, "never cropped or redrawn");
  assert.match(html, /Managed by Matthew McCluster\./);
  assert.match(html, /href="prim3\.html"/, "links the PRIM3 product");
  assert.match(html, /href="album\.html\?album=prim3"/, "plays the album");
  assert.doesNotMatch(html, /@media \(max-width/, "mobile first: min-width queries only");
  for (const m of html.matchAll(/grid-template-columns:([^;]+);/g)) assert.doesNotMatch(m[1].replace(/minmax\([^)]*\)/g, ""), /\b1fr/, `no bare 1fr: ${m[1]}`);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.ok(json("data/seo/sitemap-pages.json").pages.some((p) => p.url === `${SITE}/prim3-artist.html`));
});

test("the catalog seed bills all 13 rows to PRIM3 under Cyber Security Specialist, keys unchanged", () => {
  const seed = read("supabase/pending/20261031190000_prim3_catalog_objects.sql");
  const rows = [...seed.matchAll(/\('(prim3:[a-z0-9-]+)','prim3','([^']+)','(?:[^']|'')+','([^']+)'/g)];
  assert.equal(rows.length, 13);
  for (const [, key, albumTitle, artist] of rows) {
    assert.equal(albumTitle, "Cyber Security Specialist", key);
    assert.equal(artist, "PRIM3", key);
  }
  assert.match(read("supabase/pending/20261031190000_prim3_catalog_objects.rollback.sql"),
    /set album_title='PRIM3', artist_name='McCluster'[\s\S]*catalog_key='prim3:got-wifi'/, "the rollback gives Got WiFi? its old billing back, and keeps it live");
});

test("the label SQL: one question, music_can_act_for, in every guard and policy; artists need no login", () => {
  assert.match(PENDING, /create table if not exists public\.music_creator_managers/);
  assert.match(PENDING, /role text not null default 'manager' check \(role in \('label_admin','manager'\)\)/);
  assert.match(PENDING, /revoked_at timestamptz,/);
  assert.match(PENDING, /create or replace function public\.music_can_act_for\(p_creator uuid\)/);
  assert.match(PENDING, /m\.revoked_at is null/, "a revoked grant acts for nobody");
  assert.doesNotMatch(PENDING, /insert into auth\.users|create (table|schema) [a-z_.]*auth/i, "no second auth: an artist identity needs no auth record");
  assert.doesNotMatch(PENDING, /m_auth_user_links\s*\(/i, "the file links no login for an artist; only the hand-over function, run by the service role, does");
  /* every creator-table policy that read "= current_m_uid()" now asks music_can_act_for */
  const policies = [...PENDING.matchAll(/alter policy (\w+) on public\.(\w+)\s+([\s\S]*?);\n/g)];
  assert.equal(policies.length, 13);
  for (const [, name, , body] of policies) {
    assert.match(body, /public\.music_can_act_for\((m_uid|creator_m_uid)\)/, name);
    assert.doesNotMatch(body, /= public\.current_m_uid\(\)|= current_m_uid\(\)/, `${name}: no owner-only test left`);
  }
  /* the hand-over changes authentication: the service role only */
  assert.match(PENDING, /revoke all on function public\.music_label_hand_over_login\(uuid, uuid\) from public, anon, authenticated;\ngrant execute on function public\.music_label_hand_over_login\(uuid, uuid\) to service_role;/);
  /* creating an artist on the label: the house owner, in v1 */
  assert.match(PENDING, /music_label_create_artist[\s\S]{0,400}mccluster_is_house_owner\(\)/);
  /* the seed: PRIM3 and Equity Uprise's act, by their graph @ids, with the house owner as label_admin */
  assert.match(PENDING, /'prim3', 'PRIM3'[\s\S]*'https:\/\/matthew\.mccluster\.org\/prim3-artist\.html#prim3-artist'/);
  assert.match(PENDING, /'equity-uprise', 'Equity Uprise'[\s\S]*'https:\/\/matthew\.mccluster\.org\/catalogue\.html#artist-equity-uprise'/);
  assert.match(PENDING, /if v_owner is null then return; end if;/, "an empty replay database is left alone");
  assert.match(PENDING, /already belongs to a person; inspect before provisioning/, "never takes a handle a person holds");
});

test("the guards it replaces are the migrations' bodies with only the label lines changed, and the rollback restores them exactly", () => {
  const originals = {
    music_creator_guard: fnText(PLATFORM, "music_creator_guard"),
    music_track_guard: fnText(INTEGRITY, "music_track_guard"),
    music_license_guard: fnText(INTEGRITY, "music_license_guard")
  };
  for (const [name, text] of Object.entries(originals)) {
    assert.ok(ROLLBACK.includes(text), `the rollback restores ${name} byte for byte`);
    const mine = fnText(PENDING, name);
    const was = text.split("\n"), now = new Set(mine.split("\n"));
    const dropped = was.filter((l) => !now.has(l));
    /* the only lines that go are the owner-only identity tests */
    for (const l of dropped) assert.match(l, /current_m_uid\(\)|v_m <> v_track_m|new\.m_uid <> v_m|new\.uid := auth\.uid\(\)|new\.m_uid := v_m|old\.m_uid <> v_m|new\.creator_m_uid := v_m/, `${name}: unexpected change: ${l.trim()}`);
    assert.match(mine, /music_can_act_for/, `${name} asks the label question`);
  }
  assert.match(ROLLBACK, /drop table if exists public\.music_creator_managers;/);
  assert.match(ROLLBACK, /with check \(\(\(m_uid = \(select current_m_uid\(\)\)\) AND \(uid = \(select auth\.uid\(\)\)\)\)\);/, "the insert policy in production's initplan form");
  /* the DB script compares the rollback with production's hashes */
  const sh = read("scripts/test-music-label-db.sh");
  assert.match(sh, /production-schema-snapshot-2026-10-31\.json/);
  assert.match(sh, /apply supabase\/pending\/music_label_artists_v1\.sql\napply supabase\/pending\/music_label_artists_v1\.sql/, "applied twice");
  assert.match(read(".github/workflows/music-label-db.yml"), /bash scripts\/test-music-label-db\.sh/);
  const callers = json("supabase/pending/live-callers.json").pending_only.music_my_artists;
  assert.deepEqual(callers, { kind: "function", pending: "music_label_artists_v1.sql", callers: ["js/control-room/music-label.js"] });
  assert.match(read("supabase/pending/PROMOTION-ORDER.md"), /`music_label_artists_v1\.sql` \(\+ rollback\)/);
});

test("Control · Sell · Music · Artists: the Acting-as switcher, honest while the backend is pending", () => {
  const nav = read("js/control-room/nav.js");
  assert.match(nav, /v\("artists", "Artists", "slot", \[[^\]]*"Acting as"[^\]]*\], \{ module: "musicLabel" \}\)/);
  assert.match(read("control.html"), /<script src="js\/control-room\/music-label\.js\?v=578e683088fd"><\/script>/);
  const src = read("js/control-room/music-label.js");
  assert.match(src, /The managed-artist backend is pending\./);
  assert.match(src, /rpc\/" \+ name/);
  assert.doesNotMatch(src, /method: "(PATCH|DELETE)"|rest\/v1\/(?!rpc)/, "the switcher writes nothing");
  /* run it against the public catalog */
  const store = {};
  const win = { CR: {}, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  vm.runInNewContext(src, { window: win, localStorage: win.localStorage, document: {}, fetch: () => Promise.reject(new Error("offline")) });
  const M = win.CR.musicLabel;
  M.state.albums = json("data/albums.json").albums;
  /* values made in the vm's realm: compare them as plain data */
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const artists = plain(M._test.staticArtists());
  assert.deepEqual(artists.map((a) => [a.name, a.relation]), [["Matthew McCluster", "self"], ["PRIM3", "managed"], ["Equity Uprise", "managed"]]);
  assert.equal(artists.find((a) => a.name === "PRIM3").page, "prim3-artist.html");
  assert.deepEqual(plain(M._test.albumsFor("PRIM3", false).map((a) => a.slug)), ["prim3"]);
  assert.ok(!M._test.albumsFor("Matthew McCluster", true).some((a) => a.slug === "prim3"), "the house artist's albums leave PRIM3's out");
  const fromDb = plain(M._test.fromBackend([
    { m_uid: "a", handle: "matthew", artist_name: "Matthew McCluster", relation: "self", role: "owner", has_login: true },
    { m_uid: "b", handle: "prim3", artist_name: "PRIM3", relation: "managed", role: "label_admin", has_login: false }
  ]));
  assert.deepEqual(fromDb.map((a) => [a.key, a.relation, a.hasLogin]), [["self", "self", true], ["prim3", "managed", false]]);
});
