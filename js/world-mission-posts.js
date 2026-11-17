/* MISSIONS AS POSTS IN THE WORLD FEED (owner, 2026-11-17: "the missions should low key just be placed in the newsfeed instead
   of having that Tinder swipe tab ... having the missions as like just another post in the newsfeed, not a big, large post, just
   the same size post as all the other [posts]"; "whenever you click on a country, when you click on America, you should be able to
   say, see X amount of news, X amount of missions"). docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, targets 3, 5, 6 and 9.

   The pure parts, read by the World page (js/mnet.js draws the posts and the dialog) and by node --test
   (scripts/test/world-mission-posts.test.mjs). Nothing here touches the page, the network or storage.
   - interleave: Everything puts one mission after every three other items, newest mission first, each mission at most once;
     when the other items run out the remaining missions carry on, up to the page size.
   - placeMissions / missionCount: a place's missions are the open missions pinned in it plus the open missions with no pin at
     all (they can be done anywhere).
   - parseCredit / creditLinks / sourceLine: a sourced mission's credit, shown in full in its dialog, with its links, and as a
     compact source line on its post (data/missions/drawdown/README.md, "How to display a mission").
   - cleanMission / cleanDetails / detailsAbsent: what the page accepts from the database, and how it knows the details table is
     not there yet (it is pending SQL: supabase/pending/20261117100100_action_mission_details.sql). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MCC_MISSION_POSTS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* one mission after every EVERY other items; a page of the feed is PAGE items, as the posts' own read is */
  const EVERY = 3, PAGE = 20;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  /* an https address with no credentials in it, else nothing (the page passes every link through its own safe URL helper too) */
  function https(v) {
    if (typeof v !== 'string' || !v.trim()) return '';
    try { const u = new URL(v.trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }

  /* ---------- what the page accepts ---------- */
  /* an open mission row from action_missions, or null. Clip campaigns are paid work and live in the Clips tab, never in the feed */
  function cleanMission(row) {
    if (!row || typeof row !== 'object' || !UUID.test(String(row.id || ''))) return null;
    if (row.kind === 'clip' || (row.status !== undefined && row.status !== 'open')) return null;
    const title = line(row.title, 160);
    if (!title) return null;
    const difficulty = Number(row.difficulty), points = Number(row.base_points), created = typeof row.created_at === 'string' ? row.created_at : '';
    return {
      missionPost: true, id: String(row.id), title,
      description: typeof row.description === 'string' ? row.description.trim().slice(0, 4000) : '',
      domain: line(row.domain, 40), kind: line(row.kind, 20), category: line(row.discovery_category, 20),
      difficulty: Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : null,
      points: Number.isInteger(points) && points >= 0 && points <= 100000 ? points : null,
      created_at: Number.isFinite(Date.parse(created)) ? created : ''
    };
  }
  /* newest first; a mission without a date keeps its place after the dated ones; the same mission twice is one */
  function newestFirst(list) {
    const seen = new Set(), rows = [];
    (Array.isArray(list) ? list : []).forEach((m, i) => { if (m && m.id && !seen.has(m.id)) { seen.add(m.id); rows.push({ m, i, t: Date.parse(m.created_at) }); } });
    rows.sort((a, b) => {
      const at = Number.isFinite(a.t), bt = Number.isFinite(b.t);
      if (at && bt && a.t !== b.t) return b.t - a.t;
      if (at !== bt) return at ? -1 : 1;
      return a.i - b.i;
    });
    return rows.map((r) => r.m);
  }
  /* one action_mission_details row, or null: the credit is required; a quotation only with its credit; a licence only with its
     address; every address https; the DOI only as a https://doi.org/10.… address */
  function cleanDetails(row) {
    if (!row || typeof row !== 'object' || !UUID.test(String(row.mission_id || ''))) return null;
    const credit = line(row.credit_line, 1000);
    if (!credit) return null;
    const about = line(row.about, 1200), aboutCredit = line(row.about_credit, 300);
    const license = line(row.license_name, 100), licenseUrl = https(row.license_url), doi = https(row.doi);
    return {
      mission_id: String(row.mission_id), catalog: line(row.catalog, 40), credit_line: credit,
      proof_hint: line(row.proof_hint, 500), safety_note: line(row.safety_note, 500),
      about: about && aboutCredit ? about : '', about_credit: about && aboutCredit ? aboutCredit : '',
      source_url: https(row.source_url), license_name: license && licenseUrl ? license : '', license_url: license && licenseUrl ? licenseUrl : '',
      doi: /^https:\/\/doi\.org\/10\.\d{4,9}\//.test(doi) ? doi : ''
    };
  }
  /* the details table is not in this database yet: PostgREST answers 404 with PGRST205 for a table it does not know (42P01 from
     Postgres itself). The page then remembers that for the session and asks no more. */
  function detailsAbsent(status, body) {
    const code = body && typeof body === 'object' ? String(body.code || '') : '';
    return status === 404 || code === 'PGRST205' || code === '42P01';
  }

  /* ---------- the one stream ---------- */
  /* others: the feed as it already is (posts and news, interleaved); missions: newest first. One mission after every `every`
     others; when the others run out, the remaining missions carry on until the list holds `pageSize` items; each mission once. */
  function interleave(others, missions, opts) {
    const every = opts && opts.every > 0 ? Math.floor(opts.every) : EVERY, size = opts && opts.pageSize > 0 ? Math.floor(opts.pageSize) : PAGE;
    const list = Array.isArray(others) ? others : [], seen = new Set(), pool = [], out = [];
    (Array.isArray(missions) ? missions : []).forEach((m) => { if (m && m.id && !seen.has(m.id)) { seen.add(m.id); pool.push(m); } });
    let at = 0;
    list.forEach((item, k) => { out.push(item); if ((k + 1) % every === 0 && at < pool.length) out.push(pool[at++]); });
    while (at < pool.length && out.length < size) out.push(pool[at++]);
    return out;
  }

  /* ---------- a place's missions ---------- */
  const idSet = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).filter((k) => v[k]) : []));
  /* open: the open missions; pins: every mission with a public pin anywhere (the globe's pins); here: the missions pinned in the
     picked place (the globe says which: js/world-countries.js, missionIdsIn). A place's missions are the ones pinned in it and
     the ones pinned nowhere, in the order given. */
  function placeMissions(open, pins, here) {
    const everywhere = idSet(pins), mine = idSet(here);
    return (Array.isArray(open) ? open : []).filter((m) => m && (mine.has(m.id) || !everywhere.has(m.id)));
  }
  /* how many, or null when that is not known yet: the missions have not loaded, the pins have not, or the globe did not say which
     are pinned here while some mission is pinned somewhere. Never a made-up zero. */
  function missionCount(open, pins, here) {
    if (!Array.isArray(open) || pins === null || pins === undefined) return null;
    if (!Array.isArray(here) && !(here instanceof Set) && idSet(pins).size) return null;
    return placeMissions(open, pins, here || []).length;
  }

  /* ---------- the post's words ---------- */
  const KINDS = { civic: 'Civic mission', clip: 'Clip campaign' };
  const DOMAINS = { music: 'Music', advocacy: 'Advocacy', community: 'Community', business: 'Business', research: 'Research', education: 'Education', mutual_aid: 'Mutual aid', creative: 'Creative', other: '' };
  function kindLabel(kind) { return KINDS[kind] || 'Mission'; }
  function domainLabel(domain) {
    if (!domain) return '';
    if (Object.prototype.hasOwnProperty.call(DOMAINS, domain)) return DOMAINS[domain];
    const s = String(domain).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  /* where a post names its author: what kind of mission it is and its field, never the brand */
  function headLine(m) { const d = domainLabel(m && m.domain); return kindLabel(m && m.kind) + (d ? ' · ' + d : ''); }
  /* where a post names the handle: how hard it is and what it is worth */
  function metaLine(m) {
    const parts = [];
    if (m && m.difficulty) parts.push('Difficulty ' + m.difficulty);
    if (m && m.points !== null && m.points !== undefined) parts.push(Number(m.points).toLocaleString('en-US') + (m.points === 1 ? ' point' : ' points'));
    return parts.join(' · ');
  }

  /* ---------- the credit ---------- */
  const CATALOGS = { drawdown: 'Project Drawdown' };
  /* who the source is: the catalog's own name, else the name the credit line gives ("… from Project Drawdown (https://…)"), else
     the source address's host */
  function sourceLabel(d) {
    if (!d) return '';
    if (Object.prototype.hasOwnProperty.call(CATALOGS, d.catalog)) return CATALOGS[d.catalog];
    const from = /\bfrom ([A-Z][^(),;:]{1,60}?)\s*\(\s*https?:\/\//.exec(d.credit_line || '');
    if (from) return from[1].trim();
    try { return d.source_url ? new URL(d.source_url).hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; }
  }
  /* the compact line on a post: the source, and the licence when the mission carries one */
  function sourceLine(d) {
    const who = sourceLabel(d);
    return who ? 'Source: ' + who + (d.license_name ? ' · ' + d.license_name : '') : '';
  }
  const opens = (s, c) => s.split(c).length - 1;
  /* the credit line as text and links, in order: every http(s) address in it, without the sentence's own punctuation after it
     or a closing bracket the address did not open */
  function parseCredit(text) {
    const s = typeof text === 'string' ? text.slice(0, 1000) : '', out = [], re = /https?:\/\/[^\s<>"'`]+/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      let url = m[0];
      for (;;) {
        if (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
        else if (/\)$/.test(url) && opens(url, '(') < opens(url, ')')) url = url.slice(0, -1);
        else if (/\]$/.test(url) && opens(url, '[') < opens(url, ']')) url = url.slice(0, -1);
        else break;
      }
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      if (url.length > 8) out.push({ url }); else out.push({ text: url });
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }
  const bare = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  /* the source, DOI and licence addresses the credit line does not already carry, to show after it */
  function creditLinks(d) {
    if (!d) return [];
    const inText = new Set(parseCredit(d.credit_line).filter((p) => p.url).map((p) => bare(p.url))), out = [];
    [['Source', d.source_url], ['DOI', d.doi], [d.license_name || 'Licence', d.license_url]].forEach(([label, url]) => {
      if (url && !inText.has(bare(url)) && !out.some((x) => bare(x.url) === bare(url))) out.push({ label, url });
    });
    return out;
  }

  /* ---------- sharing ---------- */
  /* a mission's address on the page's own origin and path (mccluster.org/?mission=…, or mnet.html?mission=… on Matthew's site):
     a shared link opens that mission's dialog over the World, for a guest as for a member */
  function missionLink(loc, id) {
    if (!loc || !UUID.test(String(id || ''))) return '';
    return String(loc.origin || '') + (loc.pathname || '/') + '?mission=' + encodeURIComponent(id);
  }

  return { EVERY, PAGE, cleanMission, newestFirst, cleanDetails, detailsAbsent, interleave, placeMissions, missionCount, kindLabel, domainLabel, headLine, metaLine, sourceLabel, sourceLine, parseCredit, creditLinks, missionLink };
});
