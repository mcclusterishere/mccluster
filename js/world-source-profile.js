/* A MISSION SOURCE'S PAGE IN THE WORLD (owner, 2026-11-19: a profile of Project Drawdown "on our website, not leaving our
   website", crediting it for the environment missions). docs/control-plane/WORLD-MISSION-SOURCES.md is the record; every
   decision there is a default adopted pending Matthew's confirmation.

   What it is: a page McCluster Corp makes and keeps about the source a catalog of missions was written from. It is not the
   source's account: nobody signs in as the source and the source posts nothing. It is drawn in type only, from public reads:
   no mark, picture, monogram or badge of the source, and never a figure under its name. The words that say who made the page
   and who does not run it are this file's own; the name, the role line and the facts are the owner's data
   (public.mission_catalog_sources, supabase/pending/20261119140000_mission_catalog_sources_v1.sql), and the page refuses to
   draw a source whose name, role line or facts use a word of js/mission-source-words.js.

   Inert until a shown row answers: with no shown row (the SQL not applied, a draft, a hidden page) there is no door anywhere
   and ?source=<slug> says "That page is not available." on the feed's status line.

   The pure parts are exported for node --test (scripts/test/world-source-profile.test.mjs); the page parts (the sheet, the
   door, the address) run only in the World (mnet.html loads this after js/mnet.js and js/mission-source-words.js, and
   js/mnet.js calls window.MCC_SOURCE_PROFILE.mission() and .landing()).

   The reads, each through the World's own sbRest (the publishable key for a guest, the session for a member; RLS is the wall
   and every read repeats its filter):
   - the shown sources (state=eq.shown), then their organizations by the ids those rows name, and nothing else: an
     organization row no shown source names is never drawn (D9);
   - the open missions of one catalog (status=eq.open, with status selected and checked again here: the house owner's session
     sees drafts through RLS and must see exactly what a guest sees);
   - this site's own grouping of a catalog's missions, data/missions/<catalog>-areas.json (slug to area, no mission text);
   - for the house owner only, with &preview=1, the owner's route /v1/mission-sources (drafts included).
   Nothing is recorded: no analytics call. */
(function (root, factory) {
  var node = typeof module === 'object' && module && module.exports;
  var api = factory(root,
    node ? require('./mission-source-words.js') : null,
    node ? require('./world-mission-posts.js') : null);
  if (node) module.exports = api;
  else root.MCC_SOURCE_PROFILE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, WORDS_NODE, POSTS_NODE) {
  'use strict';

  /* ---------- the rules of what is drawn ---------- */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* production's slug check on network_organizations */
  var SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
  /* the catalog key (action_mission_details.catalog; mission_catalog_sources_catalog_check) */
  var CATALOG = /^[a-z][a-z0-9_-]{1,39}$/;
  var AREA_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
  var DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  var CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
  var MISSION_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
  /* the World's own hosts: there the World is the root, elsewhere it is mnet.html */
  var WORLD_HOST = /^(?:www\.)?(?:mccluster\.org|humanuprise\.com)$/i;
  /* a shared page link always names the company's World, whatever host it was copied on (js/tabbar.js, WORLD_ORIGIN) */
  var SHARE_ORIGIN = 'https://mccluster.org/';
  /* an installation without the table answers the first read with 404 (PGRST205); remembered for the session */
  var ABSENT_KEY = 'mcc.missionSources.absent';
  /* the day this site read the Drawdown Explorer for the catalog: data/missions/drawdown/solutions-catalog.json, "generated"
     (held equal by the unit test; that folder is not published, so the date lives here) */
  var CITATION_DAY = '2026-11-17';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ALL = 'all';
  var OTHER_KEY = 'other-missions';
  var PER_GROUP = 6;

  /* ---------- the page's own words (docs/control-plane/WORLD-MISSION-SOURCES.md; typographic apostrophes) ---------- */
  var TEXT = Object.freeze({
    kicker: 'Mission source',
    share: 'Share this page',
    copied: 'Copied',
    copyPrompt: 'Copy the page link',
    close: 'Close',
    back: 'All areas',
    about: 'About this page',
    change: 'Ask for a change',
    searchLabel: 'Search these missions',
    searchWaiting: 'Search these missions',
    areas: 'Areas',
    groupedNote: 'Grouped by this site',
    allMissions: 'All missions',
    allUnder: 'Every area, easiest first',
    allNote: 'Every area, grouped by this site.',
    field: 'Field',
    allFields: 'All fields',
    clearSearch: 'Clear the search',
    nextArea: 'Next area',
    otherMissions: 'Other missions',
    doorLine: 'Every mission written from its solutions',
    unavailable: 'That page is not available.',
    couldNotLoad: 'That page could not load right now.',
    missionsFailed: 'These missions could not load right now.',
    tryAgain: 'Try again',
    noneOpen: 'None of these missions is open right now.',
    areasFailed: 'The areas could not load, so every mission is in one list, easiest first.',
    previewDraft: 'Preview. This page is not public yet; only you can see it.',
    previewHidden: 'Preview. This page is hidden; only you can see it.',
    previewSignIn: 'Sign in as the house owner to preview this page.',
    newTab: ' (opens in a new tab)'
  });

  /* The words written for one catalog's source. A catalog without its own words is never drawn: the sentences that say who
     made the page and who does not run it name the source, and they are reviewed for that source alone (a second catalog is
     phase 2, with its own words). The source's name and slug must equal the ones these words were written for. */
  var KITS = Object.freeze({
    drawdown: Object.freeze({
      catalog: 'drawdown',
      slug: 'project-drawdown',
      name: 'Project Drawdown',
      trustLead: 'Made by McCluster Corp, which runs this platform.',
      trustRest: 'Project Drawdown does not run or pay for this page and has not endorsed this platform.',
      changeNote: Object.freeze([
        'Project Drawdown, a creator named in a credit, or anyone acting for them can ask McCluster Corp to correct or remove anything on this page or in these missions’ credits.',
        'Write to McCluster Corp through its company page; its address is at the foot of that page. Say which page and what to correct or remove.'
      ]),
      changeLink: 'McCluster Corp’s company page',
      changeHref: 'https://mccluster.org/company',
      aboutRows: Object.freeze([
        Object.freeze({ id: 'A1', term: 'What this page is', text: 'A page McCluster Corp keeps about the source of some of the missions on this platform. It is not Project Drawdown’s account: no one signs in as Project Drawdown, and nothing here is posted by it.' }),
        Object.freeze({ id: 'A2', term: 'Made by', text: 'McCluster Corp, from Project Drawdown’s public pages and the research it publishes under CC BY 4.0.' }),
        Object.freeze({ id: 'A3', term: 'Who runs it', text: 'McCluster Corp. Project Drawdown does not run this page, post on it, answer through it or pay for it. It is not a sponsor or partner of this platform, and this page is not a paid placement.' }),
        Object.freeze({ id: 'A4', term: 'The missions', text: 'Written by McCluster Corp from Project Drawdown’s climate solutions. Project Drawdown did not write or post them.' }),
        Object.freeze({ id: 'NR', term: 'Ratings', text: 'A mission here is not a rating or a recommendation by Project Drawdown. Project Drawdown rates solutions on its own pages; this page shows none of its ratings.' }),
        Object.freeze({ id: 'A5', term: 'Facts', text: '' }),
        Object.freeze({ id: 'A6', term: 'Areas', text: 'The areas are this site’s own grouping of the missions, not Project Drawdown’s sectors.' }),
        Object.freeze({ id: 'A7', term: 'On this platform since', text: '' })
      ]),
      factsRead: 'Read from Project Drawdown’s own pages on ',
      sourceWord: 'Source: ',
      areaNote: 'Grouped by this site; not Project Drawdown’s sectors.',
      credit: Object.freeze({
        heading: 'Credit',
        written: 'Every mission here was written by McCluster Corp from Project Drawdown’s climate solutions; the wording is original. Each mission’s full credit opens with it.',
        ratings: 'A mission here is not a rating or a recommendation by Project Drawdown. Project Drawdown rates solutions on its own pages; this page shows none of its ratings.',
        quote: [' quote a short summary from drawdown.org (© Project Drawdown, used with permission), always as a quotation with its credit beneath it.', ' quotes a short summary from drawdown.org (© Project Drawdown, used with permission), always as a quotation with its credit beneath it.'],
        licence: [' cite a Project Drawdown solution assessment published on Zenodo under CC BY 4.0, naming its creators, record, DOI and licence', ' cites a Project Drawdown solution assessment published on Zenodo under CC BY 4.0, naming its creators, record, DOI and licence'],
        both: [' of them also quote a summary.', ' of them also quotes a summary.'],
        nameOnly: [' name the solution and link to its page in the Drawdown Explorer.', ' names the solution and links to its page in the Drawdown Explorer.'],
        noImage: 'No Project Drawdown logo or image is used.',
        trademark: 'Project Drawdown® is a registered trademark of Project Drawdown, named here only to identify the source of these missions.',
        citedAs: 'Cited as Project Drawdown asks, dated the day this site read the Drawdown Explorer',
        citeWho: 'Project Drawdown.',
        citeTitle: 'The Drawdown Explorer',
        citeAddress: 'http://drawdown.org/explorer',
        citeHref: 'https://drawdown.org/explorer',
        links: Object.freeze([
          Object.freeze({ text: 'Drawdown Explorer', href: 'https://drawdown.org/explorer' }),
          Object.freeze({ text: 'The assessments on Zenodo', href: 'https://zenodo.org/communities/pdexplorer' }),
          Object.freeze({ text: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' })
        ]),
        inMission: 'Every mission’s full credit is in the mission itself.',
        askLead: 'To ask for a change, write to McCluster Corp through its ',
        askLink: 'company page',
        askHref: 'https://mccluster.org/company'
      })
    })
  });
  function kitFor(catalog) { return typeof catalog === 'string' && Object.prototype.hasOwnProperty.call(KITS, catalog) ? KITS[catalog] : null; }

  /* ---------- helpers ---------- */
  function words() { return WORDS_NODE || root.MCC_SOURCE_WORDS || null; }
  function posts() { return POSTS_NODE || root.MCC_MISSION_POSTS || null; }
  /* the shared deny list; without it nothing is drawn (fail closed) */
  function denied(text) { var w = words(); return !w || typeof w.denied !== 'function' ? true : w.denied(text); }
  function line(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
  function oneLine(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max && !CONTROL.test(v) && !!v.trim(); }
  function https(v) {
    if (typeof v !== 'string' || !v.trim()) return '';
    try { var u = new URL(v.trim()); return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  function day(v) {
    var m = DAY.exec(String(v || ''));
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? m[0] : '';
  }
  function domainLabel(domain) {
    var p = posts();
    if (p && typeof p.domainLabel === 'function') return p.domainLabel(domain);
    return typeof domain === 'string' ? domain.replace(/[_-]+/g, ' ').trim() : '';
  }
  function missionsWord(n) { return n === 1 ? 'mission' : 'missions'; }
  function countMissions(n) { return n + ' ' + missionsWord(n); }
  function countAreas(n) { return n + ' ' + (n === 1 ? 'area' : 'areas'); }

  /* ---------- the address ---------- */
  /* ?source=<slug>, with &area=<key> and (the house owner only) &preview=1. A ?mission= in the same address wins: the source
     is then ignored. null when there is nothing to do; { valid:false } for a slug the page will not ask about. */
  function parseAddress(search) {
    var q;
    try { q = new URLSearchParams(search || ''); } catch (e) { return null; }
    if (!q.has('source') || q.get('mission')) return null;
    var slug = q.get('source') || '', area = q.get('area') || '';
    return { valid: SLUG.test(slug), slug: slug, area: area === ALL || AREA_KEY.test(area) ? area : '', preview: q.get('preview') === '1' };
  }
  /* an area's key in the address: "Food & farming" -> food-farming */
  function areaKey(name) {
    return String(name || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function worldPath(hostname) { return WORLD_HOST.test(String(hostname || '')) ? '/' : '/mnet.html'; }
  /* the page's own address on this host */
  function sourceHref(hostname, slug, area, preview) {
    var q = new URLSearchParams();
    q.set('source', slug);
    if (area) q.set('area', area);
    if (preview) q.set('preview', '1');
    return worldPath(hostname) + '?' + q.toString();
  }
  /* the World's address with the page's keys taken away, everything else kept */
  function restHref(hostname, search) {
    var q;
    try { q = new URLSearchParams(search || ''); } catch (e) { q = new URLSearchParams(); }
    ['source', 'area', 'preview'].forEach(function (k) { q.delete(k); });
    var rest = q.toString();
    return worldPath(hostname) + (rest ? '?' + rest : '');
  }
  function shareLink(slug) { return SLUG.test(String(slug || '')) ? SHARE_ORIGIN + '?source=' + encodeURIComponent(slug) : ''; }
  /* a history state without the page's key (a state that held only it becomes null) */
  function withoutSource(state) {
    if (!state || typeof state !== 'object') return null;
    var rest = Object.assign({}, state);
    delete rest.mccSource;
    return Object.keys(rest).length ? rest : null;
  }

  /* ---------- what the page accepts ---------- */
  /* the facts under a source: { label, value, source } strings with an https source, at most six; the source shown as host
     and path */
  function cleanFacts(facts) {
    if (!Array.isArray(facts)) return [];
    var out = [];
    facts.slice(0, 6).forEach(function (f) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return;
      if (!oneLine(f.label, 40) || !oneLine(f.value, 160) || typeof f.source !== 'string') return;
      var href = https(f.source);
      if (!href) return;
      var u = new URL(href);
      out.push({ label: f.label.trim(), value: f.value.trim(), href: href, where: u.host + (u.pathname === '/' ? '' : u.pathname) });
    });
    return out;
  }
  /* one shown source and its organization, or null (no door, "That page is not available."): the organization must be the one
     the link names, the catalog must have its own words, the name 1 to 120 characters and the role line 1 to 160, each on one
     line, and no word of the deny list in the name, the role line or any fact */
  function cleanSource(link, org) {
    if (!link || typeof link !== 'object' || !org || typeof org !== 'object') return null;
    var id = String(org.id || '');
    if (!UUID.test(id) || id.toLowerCase() !== String(link.organization_id || '').toLowerCase()) return null;
    return sourceOf(link, org);
  }
  /* the same rules for a row whose organization comes with it (the owner's route) */
  function sourceOf(link, org) {
    if (!link || typeof link !== 'object' || !org || typeof org !== 'object') return null;
    var kit = CATALOG.test(String(link.catalog || '')) ? kitFor(link.catalog) : null;
    if (!kit) return null;
    if (typeof org.slug !== 'string' || !SLUG.test(org.slug)) return null;
    if (!oneLine(org.name, 120) || !oneLine(link.role_line, 160)) return null;
    var raw = Array.isArray(link.facts) ? link.facts : [];
    if (denied(org.name) || denied(link.role_line)) return null;
    for (var i = 0; i < raw.length; i += 1) {
      var f = raw[i] || {};
      if ((typeof f.label === 'string' && denied(f.label)) || (typeof f.value === 'string' && denied(f.value))) return null;
    }
    var name = org.name.trim();
    if (name !== kit.name || org.slug !== kit.slug) return null;
    var shown = typeof link.shown_at === 'string' ? day(link.shown_at.slice(0, 10)) : '';
    return {
      catalog: link.catalog, slug: org.slug, name: name, role: link.role_line.trim(), facts: cleanFacts(raw),
      factsReadOn: day(link.facts_read_on), shownOn: shown
    };
  }
  /* the organizations' ids the shown links name, for the one organizations read */
  function linkIds(links) {
    var seen = {}, out = [];
    (Array.isArray(links) ? links : []).forEach(function (l) {
      var id = l && String(l.organization_id || '').toLowerCase();
      if (id && UUID.test(id) && !seen[id]) { seen[id] = true; out.push(id); }
    });
    return out;
  }
  /* the shown links paired with their organizations; an organization no link named is dropped, whatever the read returned */
  function pairSources(links, orgs) {
    var named = {}, byId = {}, out = [];
    linkIds(links).forEach(function (id) { named[id] = true; });
    (Array.isArray(orgs) ? orgs : []).forEach(function (o) {
      var id = o && String(o.id || '').toLowerCase();
      if (id && named[id] && !byId[id]) byId[id] = o;
    });
    (Array.isArray(links) ? links : []).forEach(function (l) {
      var o = l && byId[String(l.organization_id || '').toLowerCase()], s = o ? cleanSource(l, o) : null;
      if (s && !out.some(function (x) { return x.catalog === s.catalog || x.slug === s.slug; })) out.push(s);
    });
    return out;
  }
  /* the open missions of one catalog, as the missions read returns them: status "open" (checked here too), a mission id, a
     title, and the details row of this catalog, embedded as an object or as a one-element array */
  function cleanMissions(rows, catalog) {
    var seen = {}, out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || typeof r !== 'object' || r.status !== 'open' || r.kind === 'clip') return;
      var id = String(r.id || '');
      if (!UUID.test(id) || seen[id.toLowerCase()]) return;
      var title = line(r.title, 160);
      if (!title) return;
      var d = r.action_mission_details;
      if (Array.isArray(d)) d = d.length === 1 ? d[0] : null;
      if (!d || typeof d !== 'object' || d.catalog !== catalog) return;
      var difficulty = Number(r.difficulty), points = Number(r.base_points);
      seen[id.toLowerCase()] = true;
      out.push({
        id: id, title: title, description: line(r.description, 4000), domain: line(r.domain, 40),
        slug: typeof d.slug === 'string' && MISSION_SLUG.test(d.slug) ? d.slug : '',
        difficulty: Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : null,
        points: Number.isInteger(points) && points >= 0 && points <= 100000 ? points : null,
        quote: typeof d.about_credit === 'string' && !!d.about_credit.trim(),
        licence: typeof d.license_name === 'string' && !!d.license_name.trim()
      });
    });
    return out;
  }
  /* this site's grouping of a catalog (data/missions/<catalog>-areas.json), or null */
  function readAreaMap(json, catalog) {
    if (!json || typeof json !== 'object' || json.schema !== 'mission-areas/v1' || json.catalog !== catalog) return null;
    if (!Array.isArray(json.areas) || !json.areas.length || json.areas.length > 40) return null;
    if (!json.areas.every(function (a) { return oneLine(a, 40) && !denied(a); })) return null;
    if (!json.slugs || typeof json.slugs !== 'object' || Array.isArray(json.slugs)) return null;
    var slugs = {};
    Object.keys(json.slugs).forEach(function (k) {
      var i = json.slugs[k];
      if (MISSION_SLUG.test(k) && Number.isInteger(i) && i >= 0 && i < json.areas.length) slugs[k] = i;
    });
    return { areas: json.areas.slice(), slugs: slugs };
  }

  /* ---------- what the page computes ---------- */
  /* easiest first, then A to Z */
  function sortMissions(list) {
    return (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
      var da = a.difficulty === null ? 99 : a.difficulty, db = b.difficulty === null ? 99 : b.difficulty;
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }
  /* the areas that have an open mission, most missions first then by name, each easiest first with its count and its first two
     titles; a mission the map does not place goes to "Other missions", last */
  function groupMissions(missions, map) {
    var groups = {}, other = [], areas = map && Array.isArray(map.areas) ? map.areas : [];
    (Array.isArray(missions) ? missions : []).forEach(function (m) {
      var i = map && map.slugs && Object.prototype.hasOwnProperty.call(map.slugs, m.slug) ? map.slugs[m.slug] : -1;
      if (Number.isInteger(i) && i >= 0 && i < areas.length) (groups[i] = groups[i] || []).push(m);
      else other.push(m);
    });
    var out = Object.keys(groups).map(function (i) {
      var list = sortMissions(groups[i]);
      return { key: areaKey(areas[i]), name: areas[i], count: list.length, missions: list, sample: list.slice(0, 2).map(function (m) { return m.title; }), other: false };
    });
    out.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'en'); });
    if (other.length) {
      var rest = sortMissions(other);
      out.push({ key: OTHER_KEY, name: TEXT.otherMissions, count: rest.length, missions: rest, sample: rest.slice(0, 2).map(function (m) { return m.title; }), other: true });
    }
    return out;
  }
  /* how the missions credit the source: quote = with a quotation, licence = citing a CC BY assessment, both, and name only */
  function creditCounts(missions) {
    var c = { quote: 0, licence: 0, both: 0, nameOnly: 0, total: 0 };
    (Array.isArray(missions) ? missions : []).forEach(function (m) {
      c.total += 1;
      if (m.quote) c.quote += 1;
      if (m.licence) c.licence += 1;
      if (m.quote && m.licence) c.both += 1;
      if (!m.quote && !m.licence) c.nameOnly += 1;
    });
    return c;
  }
  /* the feed's own rule for a mission (js/mnet.js, feedMatches): its title, description and field, in words too */
  function searchMissions(missions, query) {
    var q = String(query || '').trim().toLocaleLowerCase(), list = Array.isArray(missions) ? missions : [];
    if (!q) return list.slice();
    return list.filter(function (m) {
      return [m.title, m.description, m.domain, domainLabel(m.domain)].join(' ').toLocaleLowerCase().indexOf(q) !== -1;
    });
  }
  /* the words to mark in a text: [{ text, mark }]; nothing is marked where lower-casing changes the text's length */
  function highlight(text, query) {
    var s = String(text || ''), q = String(query || '').trim().toLocaleLowerCase();
    if (!q) return [{ text: s, mark: false }];
    var low = s.toLocaleLowerCase();
    if (low.length !== s.length) return [{ text: s, mark: false }];
    var out = [], at = 0, i;
    while ((i = low.indexOf(q, at)) !== -1) {
      if (i > at) out.push({ text: s.slice(at, i), mark: false });
      out.push({ text: s.slice(i, i + q.length), mark: true });
      at = i + q.length;
    }
    if (at < s.length || !out.length) out.push({ text: s.slice(at), mark: false });
    return out;
  }
  /* the field chips of a list: All fields first, then each field in words with its count, most first */
  function fieldChips(missions) {
    var counts = {}, list = Array.isArray(missions) ? missions : [];
    list.forEach(function (m) { var l = domainLabel(m.domain); if (l) counts[m.domain] = (counts[m.domain] || 0) + 1; });
    var chips = Object.keys(counts).map(function (d) { return { domain: d, label: domainLabel(d), count: counts[d] }; });
    chips.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'en'); });
    return [{ domain: '', label: TEXT.allFields, count: list.length }].concat(chips);
  }
  /* the list's polite line: how many, where, and what was searched */
  function statusLine(o) {
    var n = Number(o && o.count) || 0, field = o && o.field ? o.field + ' ' : '', q = o && o.query ? String(o.query).trim() : '';
    var many = n + ' ' + field + missionsWord(n), verb = n === 1 ? 'matches' : 'match';
    if (q) {
      if (!n) return 'No mission here matches “' + q + '”.';
      if (o.areaName) return many + ' in ' + o.areaName + ' ' + verb + ' “' + q + '”.';
      return many + ' ' + verb + ' “' + q + '”, in ' + countAreas(Number(o.areas) || 0) + '.';
    }
    if (o && o.areaName) return many + ' in ' + o.areaName + ', easiest first.';
    return many + ' in ' + countAreas(Number(o && o.areas) || 0) + ', easiest first.';
  }
  /* the search field's placeholder */
  function placeholder(total, areaName) {
    if (areaName) return 'Search ' + areaName;
    return total > 0 ? 'Search ' + countMissions(total) : TEXT.searchWaiting;
  }
  /* the line under the name: the first fact's value only ("501(c)(3) nonprofit"); the rest are in About */
  function factsLine(source) { return source && source.facts && source.facts.length ? source.facts[0].value : ''; }
  /* an area row's accessible name: "Buildings, 21 missions" */
  function areaLabel(name, n) { return name + ', ' + countMissions(n); }
  /* a row's line under its title: the field in words, the difficulty, the points */
  function rowMeta(m) {
    var p = posts(), meta = p && typeof p.metaLine === 'function' ? p.metaLine(m) : '';
    return [domainLabel(m.domain), meta].filter(Boolean).join(' · ');
  }
  /* a calendar date (never new Date("YYYY-MM-DD"), which is UTC midnight and the day before west of Greenwich) */
  function calendarDate(value, locale) {
    var d = day(value);
    if (!d) return '';
    var m = DAY.exec(d);
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  /* the citation the source asks for, dated the day this site read it: "(2026, November 17)" */
  function citationDate(value) {
    var d = day(value);
    if (!d) return '';
    var m = DAY.exec(d);
    return m[1] + ', ' + MONTHS[+m[2] - 1] + ' ' + (+m[3]);
  }
  /* which lines of the credit are drawn: every line that needs no count while the missions are read (or could not be), the
     counted lines only above zero, and with no mission open only the lines about the source itself */
  function creditPlan(counts) {
    var tail = ['C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11'];
    if (!counts) return ['C1', 'C2', 'NR'].concat(tail);
    if (!counts.total) return ['C1'].concat(tail);
    var plan = ['C1', 'C2', 'NR'];
    if (counts.quote) plan.push('C3');
    if (counts.licence) plan.push('C4');
    if (counts.nameOnly) plan.push('C5');
    return plan.concat(tail);
  }
  /* a counted credit line as pieces: { num } then { text } */
  function creditPieces(kit, id, counts) {
    var c = kit.credit, one = function (pair, n) { return pair[n === 1 ? 1 : 0]; };
    if (id === 'C3') return [{ num: counts.quote }, { text: one(c.quote, counts.quote) }];
    if (id === 'C5') return [{ num: counts.nameOnly }, { text: one(c.nameOnly, counts.nameOnly) }];
    if (id === 'C4') {
      var pieces = [{ num: counts.licence }, { text: one(c.licence, counts.licence) }];
      if (counts.both) return pieces.concat([{ text: '; ' }, { num: counts.both }, { text: one(c.both, counts.both) }]);
      return pieces.concat([{ text: '.' }]);
    }
    return [];
  }
  function piecesText(pieces) { return pieces.map(function (p) { return p.num !== undefined ? String(p.num) : p.text; }).join(''); }

  /* ---------- the reads (each with the World's sbRest; RLS is the wall and the filter is repeated) ---------- */
  function readShownSources(sbRest) {
    return sbRest("mission_catalog_sources?state=eq.shown&select=catalog,organization_id,role_line,facts,facts_read_on,shown_at&limit=20");
  }
  function readOrganizations(sbRest, ids) {
    return sbRest("network_organizations?id=in.(" + ids.join(",") + ")&select=id,slug,name,website_url,organization_type");
  }
  function readMissions(sbRest, catalog) {
    return sbRest("action_missions?status=eq.open&select=id,title,description,domain,kind,difficulty,base_points,status,action_mission_details!inner(slug,catalog,license_name,about_credit,source_url)&action_mission_details.catalog=eq." + catalog + "&limit=500");
  }
  function readAreas(fetchImpl, catalog) {
    return fetchImpl("data/missions/" + catalog + "-areas.json", { credentials: "same-origin" });
  }
  function readOwnerState(api) { return api("/v1/mission-sources"); }
  /* the table is not there (an installation without it): 404 with PGRST205 or 42P01 */
  function tableAbsent(e) { return !!(e && e.status === 404 && e.data && (e.data.code === 'PGRST205' || e.data.code === '42P01')); }
  function storageGet(storage, key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } }
  function storageSet(storage, key, value) { try { if (storage) storage.setItem(key, value); } catch (e) { /* private window */ } }
  /* the shown sources, read once: { status: 'ok', sources } | { status: 'absent' } | { status: 'failed' }. Never rejects. An
     absent table is remembered for the session (nothing more is asked) */
  function loadSources(deps) {
    if (storageGet(deps.storage, ABSENT_KEY) === '1') return Promise.resolve({ status: 'absent', sources: [] });
    return Promise.resolve().then(function () { return readShownSources(deps.sbRest); }).then(function (links) {
      var ids = linkIds(links);
      if (!ids.length) return { status: 'ok', sources: [] };
      return readOrganizations(deps.sbRest, ids).then(function (orgs) {
        return { status: 'ok', sources: pairSources(links, orgs) };
      });
    }).catch(function (e) {
      if (tableAbsent(e)) { storageSet(deps.storage, ABSENT_KEY, '1'); return { status: 'absent', sources: [] }; }
      return { status: 'failed', sources: [] };
    });
  }
  /* the house owner's preview from the owner's route: { state, source } | { error: 'signin' | 'unavailable' | 'none' } */
  function previewFrom(answer, slug) {
    if (!answer || answer.ok !== true) return { error: 'unavailable' };
    if (answer.store === 'unavailable') return { error: 'unavailable' };
    if (answer.store !== 'applied' || !Array.isArray(answer.sources)) return { error: 'none' };
    var row = null;
    answer.sources.forEach(function (s) { if (!row && s && s.organization && s.organization.slug === slug) row = s; });
    if (!row || ['draft', 'shown', 'hidden'].indexOf(row.state) === -1) return { error: 'none' };
    var source = sourceOf(row, row.organization);
    return source ? { state: row.state, source: source } : { error: 'none' };
  }
  function previewError(e) {
    var s = e && e.status;
    if (s === 401) return 'signin';
    if (s === 403) return 'none';
    return 'unavailable';
  }

  return {
    TEXT: TEXT, KITS: KITS, SHARE_ORIGIN: SHARE_ORIGIN, CITATION_DAY: CITATION_DAY, ABSENT_KEY: ABSENT_KEY, PER_GROUP: PER_GROUP,
    kitFor: kitFor, parseAddress: parseAddress, areaKey: areaKey, worldPath: worldPath, sourceHref: sourceHref, restHref: restHref,
    shareLink: shareLink, withoutSource: withoutSource, cleanFacts: cleanFacts, cleanSource: cleanSource, sourceOf: sourceOf, linkIds: linkIds,
    pairSources: pairSources, cleanMissions: cleanMissions, readAreaMap: readAreaMap, sortMissions: sortMissions,
    groupMissions: groupMissions, creditCounts: creditCounts, searchMissions: searchMissions, highlight: highlight,
    fieldChips: fieldChips, statusLine: statusLine, placeholder: placeholder, factsLine: factsLine, areaLabel: areaLabel, rowMeta: rowMeta,
    countMissions: countMissions, countAreas: countAreas, calendarDate: calendarDate, citationDate: citationDate,
    creditPlan: creditPlan, creditPieces: creditPieces, piecesText: piecesText,
    readShownSources: readShownSources, readOrganizations: readOrganizations, readMissions: readMissions, readAreas: readAreas,
    readOwnerState: readOwnerState, tableAbsent: tableAbsent, loadSources: loadSources, previewFrom: previewFrom, previewError: previewError
  };
});
