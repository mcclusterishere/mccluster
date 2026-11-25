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
  /* the site's hosts come from window.MCC_SITE (js/shell-boot.js, the first script on mnet.html; one place,
     data/seo/domain-architecture.json): which hosts are the World's, where a shared link points, where the company page is */
  var SITE = root.MCC_SITE || null;
  /* the World's own hosts: there the World is the root, elsewhere it is mnet.html */
  function worldHost(hostname) { return !!SITE && typeof SITE.isWorldHost === 'function' && SITE.isWorldHost(hostname); }
  /* a shared page link always names the platform's World, whatever host it was copied on (js/tabbar.js, WORLD_ORIGIN) */
  var SHARE_ORIGIN = SITE ? SITE.platform.world_url : '';
  /* McCluster Corp's company page, where its host answers it */
  var COMPANY_PAGE = SITE ? SITE.siteUrl('/company') : '';
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
      changeHref: COMPANY_PAGE,
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
        askHref: COMPANY_PAGE
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
  function worldPath(hostname) { return worldHost(String(hostname || '')) ? '/' : '/mnet.html'; }
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
  function shareLink(slug) { return SHARE_ORIGIN && SLUG.test(String(slug || '')) ? SHARE_ORIGIN + '?source=' + encodeURIComponent(slug) : ''; }
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
  /* the list's polite line: how many, where, and what was searched (areas: null when the areas could not load) */
  function statusLine(o) {
    var n = Number(o && o.count) || 0, field = o && o.field ? o.field + ' ' : '', q = o && o.query ? String(o.query).trim() : '';
    var many = n + ' ' + field + missionsWord(n), verb = n === 1 ? 'matches' : 'match', grouped = !(o && o.areas === null);
    if (q) {
      if (!n) return 'No mission here matches “' + q + '”.';
      if (o.areaName) return many + ' in ' + o.areaName + ' ' + verb + ' “' + q + '”.';
      return many + ' ' + verb + ' “' + q + '”' + (grouped ? ', in ' + countAreas(Number(o.areas) || 0) : '') + '.';
    }
    if (o && o.areaName) return many + ' in ' + o.areaName + ', easiest first.';
    return many + (grouped ? ' in ' + countAreas(Number(o && o.areas) || 0) : '') + ', easiest first.';
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

  /* =====================================================================================================================
     THE PAGE (the World only; nothing below runs in node). A sheet over the World inside <main class="mn">
     (#mnSourceDialog, after the mission dialog), and a door at the foot of each sourced mission's dialog (#mnMissionSource,
     after Join and its status line, outside the mission's detail and credit, so its late arrival moves nothing above it).

     History follows the mission dialog's model (js/mnet.js, RS-6): the door replaces the mission's entry with the page's
     (Back then leaves the way the mission came); a landing on ?source= replaces the landing entry; a mission opened from a
     row pushes its own entry over the page's, so Back closes the mission and then the page; the × and Escape step back over
     an entry the page took from a mission, or put the address back without the page's keys. Focus: the name on open; the
     dialog's own restoration on close (the opener, or the row a mission came from).
     ===================================================================================================================== */
  var doc = root.document || null;
  var page = { sourcesP: null, landed: false, doorFor: '', cache: {}, sheet: null, expectPop: false, moduleClose: false, wired: false, copiedTimer: 0, statusTimer: 0, observer: null };
  function $(id) { return doc ? doc.getElementById(id) : null; }
  function mnet() { return root.MCC_MNET || null; }
  function session() { try { return root.sessionStorage; } catch (e) { return null; } }
  function wide() { try { return !!(root.matchMedia && root.matchMedia('(min-width: 1100px)').matches); } catch (e) { return false; } }
  /* an element from text only: never markup from data */
  function h(tag, attrs, kids) {
    var n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return n;
  }
  /* the World's own line icon (js/mnet.js: ICON, PATH_ART), the only drawn shape on the page */
  function worldIcon(name) {
    var span = h('span', { class: 'mn__source-icon', 'data-world-icon': name, 'aria-hidden': 'true' });
    var m = mnet(), art = m && typeof m.icon === 'function' ? m.icon(name) : '';
    if (art) span.innerHTML = art;
    return span;
  }
  /* a link that leaves for another site: secondary, in a new tab, said so to assistive technology */
  function outLink(text, href, arrow) {
    return h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, [
      text,
      arrow === false ? null : h('span', { class: 'mn__source-out', 'aria-hidden': 'true', text: ' ↗' }),
      h('span', { class: 'sr-only', text: TEXT.newTab })
    ]);
  }
  /* a text with the searched words marked, from text nodes */
  function marked(text, query) {
    var frag = doc.createDocumentFragment();
    highlight(text, query).forEach(function (p) { frag.appendChild(p.mark ? h('mark', { text: p.text }) : doc.createTextNode(p.text)); });
    return frag;
  }
  function sources() {
    if (!page.sourcesP) {
      var m = mnet();
      page.sourcesP = m && typeof m.sbRest === 'function'
        ? loadSources({ sbRest: m.sbRest, storage: session() })
        : Promise.resolve({ status: 'failed', sources: [] });
    }
    return page.sourcesP;
  }
  function notice(text) { var m = mnet(); if (m && typeof m.notice === 'function') m.notice(text); }

  /* ---------- the door in a mission's dialog ---------- */
  function mission(m, d) {
    var door = $('mnMissionSource');
    if (!door) return;
    door.hidden = true;
    door.textContent = '';
    var id = m && m.id ? String(m.id) : '', catalog = d && typeof d.catalog === 'string' ? d.catalog : '';
    page.doorFor = id;
    if (!id || !CATALOG.test(catalog)) return;
    var w = mnet();
    if (!w || (typeof w.missionReturning === 'function' && w.missionReturning())) return;
    sources().then(function (r) {
      var dlg = $('mnMissionDialog'), s = null;
      if (r.status !== 'ok' || page.doorFor !== id || !dlg || !dlg.open) return;
      r.sources.forEach(function (x) { if (!s && x.catalog === catalog) s = x; });
      if (!s) return;
      var b = h('button', { type: 'button', class: 'mn__source-door-button' }, [
        h('span', { class: 'mn__source-door-kicker', text: TEXT.kicker }), ' ',
        h('span', { class: 'mn__source-door-name', text: s.name }), ' ',
        h('span', { class: 'mn__source-door-line', text: TEXT.doorLine }), ' ',
        h('span', { class: 'mn__source-door-go', 'aria-hidden': 'true', text: '›' })
      ]);
      b.addEventListener('click', function () { fromDoor(s); });
      door.textContent = '';
      door.appendChild(b);
      door.hidden = false;
    });
  }
  function fromDoor(s) {
    var sheet = $('mnSourceDialog'), w = mnet();
    if (!sheet || !w) return;
    /* a mission opened from the page's own list: back to the page under it, never a second page */
    if (sheet.open) { w.closeMission(false); return; }
    var hist = root.history, st = hist && hist.state, pushed = !!(st && st.mccMission), next = Object.assign({}, st || {});
    delete next.mccMission;
    next.mccSource = s.slug;
    try { hist.replaceState(next, '', sourceHref(root.location.hostname, s.slug, '', false)); } catch (e) { /* the page still opens */ }
    w.closeMission(true);
    openSheet(s, { entry: pushed ? 'pushed' : 'landed', state: 'shown' });
  }

  /* ---------- the address ---------- */
  function landing() {
    if (page.landed) return;
    page.landed = true;
    var a = parseAddress(root.location ? root.location.search : '');
    if (!a) return;
    if (!a.valid) { notice(TEXT.unavailable); return; }
    if (a.preview) { previewLanding(a); return; }
    sources().then(function (r) {
      var s = null;
      if (r.status === 'failed') { notice(TEXT.couldNotLoad); return; }
      r.sources.forEach(function (x) { if (!s && x.slug === a.slug) s = x; });
      if (!s) { notice(TEXT.unavailable); return; }
      landOn(s, a, 'shown');
    });
  }
  function previewLanding(a) {
    var w = mnet();
    if (!w || typeof w.api !== 'function' || (doc && doc.documentElement.classList.contains('mn-guest'))) { notice(TEXT.previewSignIn); return; }
    readOwnerState(w.api).then(function (answer) {
      var p = previewFrom(answer, a.slug);
      if (p.error === 'unavailable') notice(TEXT.couldNotLoad);
      else if (p.error) notice(TEXT.unavailable);
      else landOn(p.source, a, p.state, true);
    }, function (e) {
      var k = previewError(e);
      notice(k === 'signin' ? TEXT.previewSignIn : k === 'none' ? TEXT.unavailable : TEXT.couldNotLoad);
    });
  }
  /* as a shared ?mission= link lands: the entry is replaced, so Back leaves the way the link came */
  function landOn(s, a, state, preview) {
    var hist = root.history, st = hist && hist.state;
    try { hist.replaceState(Object.assign({}, st || {}, { mccSource: s.slug }), '', root.location.pathname + root.location.search + root.location.hash); } catch (e) { /* the page still opens */ }
    openSheet(s, { entry: 'landed', area: a.area, state: state, preview: !!preview });
  }
  /* the page's own entry carries the area on show */
  function address() {
    var sh = page.sheet, hist = root.history, st = hist && hist.state;
    if (!sh || !st || st.mccSource !== sh.source.slug) return;
    var area = sh.view === 'list' || wide() ? sh.area : '';
    try { hist.replaceState(st, '', sourceHref(root.location.hostname, sh.source.slug, area, sh.previewMode)); } catch (e) { /* the address stays */ }
  }

  /* ---------- the sheet ---------- */
  function openSheet(s, o) {
    var sheet = $('mnSourceDialog'), body = $('mnSourceBody'), kit = kitFor(s.catalog);
    if (!sheet || !body || !kit) return;
    wire(sheet, body);
    var cached = page.cache[s.catalog] || {};
    page.sheet = {
      source: s, kit: kit, entry: o.entry, previewMode: !!o.preview, state: o.state || 'shown',
      view: o.area ? 'list' : 'index', area: o.area || '', fromArea: '', query: '', field: '', searchFromIndex: false,
      missions: cached.missions || null, missionsState: cached.missions ? 'ok' : 'loading',
      map: cached.map || null, mapState: cached.map ? 'ok' : 'loading'
    };
    build(page.sheet, body);
    render();
    if (!sheet.open) sheet.showModal();
    var name = $('mnSourceName');
    if (name) name.focus();
    watchName(sheet);
    if (page.sheet.missionsState === 'loading') readMissionsOnce(page.sheet);
    if (page.sheet.mapState === 'loading') readMapOnce(page.sheet);
  }
  function readMissionsOnce(sh) {
    var w = mnet();
    sh.missionsState = 'loading';
    render();
    Promise.resolve().then(function () { return readMissions(w.sbRest, sh.source.catalog); }).then(function (rows) {
      var list = cleanMissions(rows, sh.source.catalog);
      (page.cache[sh.source.catalog] = page.cache[sh.source.catalog] || {}).missions = list;
      if (page.sheet !== sh) return;
      sh.missions = list;
      sh.missionsState = 'ok';
      render();
    }, function () {
      if (page.sheet !== sh) return;
      sh.missionsState = 'failed';
      render();
    });
  }
  function readMapOnce(sh) {
    Promise.resolve().then(function () { return readAreas(function (u, init) { return root.fetch(u, init); }, sh.source.catalog); }).then(function (res) {
      if (!res || !res.ok) throw new Error('areas');
      return res.json();
    }).then(function (json) {
      var map = readAreaMap(json, sh.source.catalog);
      if (!map) throw new Error('areas');
      (page.cache[sh.source.catalog] = page.cache[sh.source.catalog] || {}).map = map;
      if (page.sheet !== sh) return;
      sh.map = map;
      sh.mapState = 'ok';
      render();
    }).catch(function () {
      if (page.sheet !== sh) return;
      sh.mapState = 'failed';
      render();
    });
  }
  /* the parts that do not change while the page is open, in reading order: the head; the name, its role line, the trust
     note with About and Ask for a change (their notes open in place under it), the facts line; the search; the areas; the
     credit; then the list */
  function build(sh, body) {
    var s = sh.source, kit = sh.kit, hidden = sh.state !== 'shown';
    body.textContent = '';
    var head = h('div', { class: 'mn__source-head' }, [
      h('div', { class: 'mn__source-head-left' }, [
        h('p', { class: 'mn__source-kicker', text: TEXT.kicker }),
        h('p', { class: 'mn__source-headname', 'aria-hidden': 'true', text: TEXT.kicker + ' · ' + s.name }),
        h('button', { type: 'button', class: 'mn__source-back', 'data-act': 'back' }, [h('span', { 'aria-hidden': 'true', class: 'mn__source-back-chev', text: '‹' }), h('span', { text: TEXT.back })])
      ]),
      h('p', { class: 'mn__source-copied', role: 'status' }),
      h('div', { class: 'mn__source-tools' }, [
        hidden ? null : h('button', { type: 'button', class: 'mn__source-tool', 'aria-label': TEXT.share, 'data-act': 'share' }, [worldIcon('share')]),
        h('button', { type: 'button', class: 'mn__source-tool', 'aria-label': TEXT.close, 'data-act': 'close' }, ['×'])
      ])
    ]);
    var facts = factsLine(s);
    var who = h('section', { class: 'mn__source-who' }, [
      h('h2', { id: 'mnSourceName', class: 'mn__source-name', tabindex: '-1', text: s.name }),
      h('p', { class: 'mn__source-role', text: s.role }),
      h('div', { class: 'mn__source-trustbox' }, [
        h('p', { id: 'mnSourceTrust', class: 'mn__source-trust', role: 'note' }, [h('strong', { text: kit.trustLead }), ' ' + kit.trustRest]),
        h('div', { class: 'mn__source-trust-actions' }, [
          h('button', { type: 'button', class: 'mn__source-link', 'aria-expanded': 'false', 'aria-controls': 'mnSourceAbout', 'data-act': 'toggle', text: TEXT.about }),
          h('button', { type: 'button', class: 'mn__source-link', 'aria-expanded': 'false', 'aria-controls': 'mnSourceChange', 'data-act': 'toggle', text: TEXT.change })
        ]),
        h('div', { id: 'mnSourceChange', class: 'mn__source-change', hidden: true }, [
          h('p', { text: kit.changeNote[0] }),
          h('p', { text: kit.changeNote[1] }),
          h('p', null, [outLink(kit.changeLink, kit.changeHref)])
        ]),
        aboutList(kit, s)
      ]),
      facts ? h('p', { class: 'mn__source-facts', text: facts }) : null
    ]);
    var search = h('div', { class: 'mn__source-search', role: 'search' }, [
      h('input', { type: 'search', class: 'mn__source-input', id: 'mnSourceSearch', 'aria-label': TEXT.searchLabel, placeholder: TEXT.searchWaiting, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' })
    ]);
    var index = h('section', { class: 'mn__source-index', 'aria-labelledby': 'mnSourceAreasHead' }, [
      h('div', { class: 'mn__source-section-head' }, [h('h3', { id: 'mnSourceAreasHead', class: 'mn__source-label', text: TEXT.areas }), h('p', { class: 'mn__source-note', text: TEXT.groupedNote })]),
      h('ul', { class: 'mn__source-areas', id: 'mnSourceAreas' }),
      h('div', { class: 'mn__source-state', id: 'mnSourceIndexState' })
    ]);
    var credit = h('section', { class: 'mn__source-credit', id: 'mnSourceCredit', 'aria-labelledby': 'mnSourceCreditHead' });
    var list = h('section', { class: 'mn__source-list', 'aria-labelledby': 'mnSourceListHead' }, [
      h('h3', { id: 'mnSourceListHead', class: 'mn__source-list-title', tabindex: '-1' }),
      h('p', { class: 'mn__source-list-note', id: 'mnSourceListNote' }),
      h('div', { class: 'mn__source-chips', id: 'mnSourceChips', role: 'group', 'aria-label': TEXT.field }),
      h('p', { class: 'mn__source-status', id: 'mnSourceStatus', role: 'status' }),
      h('div', { class: 'mn__source-results', id: 'mnSourceResults' }),
      h('div', { class: 'mn__source-list-foot', id: 'mnSourceListFoot' })
    ]);
    var banner = sh.state === 'draft' ? TEXT.previewDraft : sh.state === 'hidden' ? TEXT.previewHidden : '';
    body.appendChild(head);
    body.appendChild(h('div', { class: 'mn__source-scroll' }, [
      h('div', { class: 'mn__source-left' }, [banner ? h('p', { class: 'mn__source-preview', role: 'status', text: banner }) : null, who, search, index, credit]),
      h('div', { class: 'mn__source-right' }, [list])
    ]));
  }
  /* About this page: what it is, who made it, who runs it, the missions, ratings, the facts with their sources and the day
     they were read, the areas, and since when it is on the platform */
  function aboutList(kit, s) {
    var dl = h('dl', { id: 'mnSourceAbout', class: 'mn__source-about', hidden: true });
    kit.aboutRows.forEach(function (row) {
      var dd = null;
      if (row.id === 'A5') {
        if (!s.facts.length) return;
        dd = h('dd', null, s.facts.map(function (f) {
          return h('p', { class: 'mn__source-fact' }, [h('span', { class: 'mn__source-fact-text', text: f.label + ': ' + f.value }), h('span', { class: 'mn__source-fact-source' }, [kit.sourceWord, outLink(f.where, f.href)])]);
        }).concat(s.factsReadOn ? [h('p', { class: 'mn__source-dated', text: kit.factsRead + calendarDate(s.factsReadOn) + '.' })] : []));
      } else if (row.id === 'A7') {
        if (!s.shownOn) return;
        dd = h('dd', { text: calendarDate(s.shownOn) });
      } else dd = h('dd', { text: row.text });
      dl.appendChild(h('div', { class: 'mn__source-about-row' }, [h('dt', { text: row.term }), dd]));
    });
    return dl;
  }

  /* ---------- what the sheet shows now ---------- */
  function groupsOf(sh) { return sh.missionsState === 'ok' && sh.mapState === 'ok' ? groupMissions(sh.missions, sh.map) : []; }
  function groupFor(sh, key) {
    var g = null;
    groupsOf(sh).forEach(function (x) { if (!g && x.key === key) g = x; });
    return g;
  }
  function loading(sh) { return sh.missionsState === 'loading' || (sh.missionsState === 'ok' && sh.missions.length > 0 && sh.mapState === 'loading'); }
  function render(o) {
    var sh = page.sheet, sheet = $('mnSourceDialog');
    if (!sh || !sheet) return;
    /* an area the address named that this catalog does not have: the index */
    if (sh.area && sh.area !== ALL && !loading(sh) && sh.missionsState === 'ok' && sh.mapState === 'ok' && !groupFor(sh, sh.area)) {
      sh.area = ''; sh.view = 'index'; address();
    }
    if (sh.area && sh.mapState === 'failed') { sh.area = ALL; }
    sheet.setAttribute('data-view', sh.view);
    keepFocus(function () {
      renderIndex(sh);
      renderCredit(sh);
      renderList(sh, o && o.statusDelay);
    });
    var input = $('mnSourceSearch'), area = sh.area && sh.area !== ALL ? groupFor(sh, sh.area) : null;
    if (input) input.setAttribute('placeholder', area && (sh.view === 'list' || wide()) ? placeholder(0, area.name) : placeholder(sh.missionsState === 'ok' ? sh.missions.length : 0, ''));
  }
  /* a re-draw keeps the focus on the control that had it */
  function keepFocus(draw) {
    var a = doc.activeElement, key = '', value = '';
    if (a && a.closest && a.closest('#mnSourceBody')) ['data-area', 'data-field', 'data-mission', 'data-act'].forEach(function (k) { if (!key && a.hasAttribute(k)) { key = k; value = a.getAttribute(k); } });
    draw();
    if (key && !a.isConnected) { var b = byData('#mnSourceBody', key, value); if (b) b.focus(); }
  }
  /* the first element under a container whose data attribute has this value (no selector is built from data) */
  function byData(scope, key, value) {
    var found = null;
    Array.prototype.forEach.call(doc.querySelectorAll(scope + ' [' + key + ']'), function (n) { if (!found && n.getAttribute(key) === value) found = n; });
    return found;
  }
  function skeleton(n) {
    var out = [];
    for (var i = 0; i < n; i += 1) out.push(h('li', { class: 'mn__source-skelrow', 'aria-hidden': 'true' }, [h('div', { class: 'mn__skel' }, [h('div', null, [h('i'), h('i', { class: 'is-short' })])])]));
    return out;
  }
  function failed() {
    return h('div', { class: 'mn__source-failed' }, [h('p', { text: TEXT.missionsFailed }), h('button', { type: 'button', class: 'mn__source-more', 'data-act': 'retry', text: TEXT.tryAgain })]);
  }
  function areaRow(key, name, count, under, current) {
    return h('li', null, [h('button', { type: 'button', class: 'mn__source-area' + (key === ALL ? ' mn__source-area--all' : ''), 'data-area': key, 'aria-label': areaLabel(name, count), 'aria-current': current ? 'true' : null }, [
      h('span', { class: 'mn__source-area-name', text: name }), ' ',
      h('span', { class: 'mn__source-area-count', text: String(count) }), ' ',
      h('span', { class: 'mn__source-chev', 'aria-hidden': 'true', text: '›' }),
      under ? ' ' : null, under ? h('span', { class: 'mn__source-area-sample', text: under }) : null
    ])]);
  }
  function renderIndex(sh) {
    var ul = $('mnSourceAreas'), state = $('mnSourceIndexState');
    if (!ul || !state) return;
    var section = ul.parentNode;
    ul.textContent = '';
    state.textContent = '';
    if (loading(sh)) { section.setAttribute('aria-busy', 'true'); skeleton(3).forEach(function (n) { ul.appendChild(n); }); return; }
    section.removeAttribute('aria-busy');
    if (sh.missionsState === 'failed') { state.appendChild(failed()); return; }
    if (!sh.missions.length) { state.appendChild(h('p', { class: 'mn__source-empty', text: TEXT.noneOpen })); return; }
    var on = wide() || sh.view === 'list', cur = sh.area || ALL;
    ul.appendChild(areaRow(ALL, TEXT.allMissions, sh.missions.length, TEXT.allUnder, on && cur === ALL));
    if (sh.mapState === 'failed') { state.appendChild(h('p', { class: 'mn__source-note mn__source-areas-failed', text: TEXT.areasFailed })); return; }
    groupsOf(sh).forEach(function (g) { ul.appendChild(areaRow(g.key, g.name, g.count, g.sample.join(' · '), on && cur === g.key)); });
  }
  function creditLine(id, kit, counts) {
    var c = kit.credit;
    if (id === 'C1') return h('h3', { id: 'mnSourceCreditHead', class: 'mn__source-label', text: c.heading });
    if (id === 'C2') return h('p', { text: c.written });
    if (id === 'NR') return h('p', { text: c.ratings });
    if (id === 'C3' || id === 'C4' || id === 'C5') {
      return h('p', { class: 'mn__source-counted' }, creditPieces(kit, id, counts).map(function (p) { return p.num !== undefined ? h('b', { class: 'mn__source-num', text: String(p.num) }) : p.text; }));
    }
    if (id === 'C6') return h('p', { text: c.noImage });
    if (id === 'TM') return h('p', { class: 'mn__source-tm', text: c.trademark });
    if (id === 'C7') return h('p', { class: 'mn__source-cite-label', text: c.citedAs });
    if (id === 'C8') return h('p', { class: 'mn__source-cite' }, [c.citeWho + ' (' + citationDate(CITATION_DAY) + '). ', h('cite', { text: c.citeTitle }), '. ', outLink(c.citeAddress, c.citeHref, false), '.']);
    if (id === 'C9') {
      var links = [];
      c.links.forEach(function (l, i) { if (i) links.push(h('span', { class: 'mn__source-dot', 'aria-hidden': 'true', text: '·' })); links.push(outLink(l.text, l.href)); });
      return h('p', { class: 'mn__source-links' }, links);
    }
    if (id === 'C10') return h('p', { text: c.inMission });
    return h('p', null, [c.askLead, outLink(c.askLink, c.askHref)]);
  }
  function renderCredit(sh) {
    var box = $('mnSourceCredit');
    if (!box) return;
    var counts = sh.missionsState === 'ok' ? creditCounts(sh.missions) : null;
    box.textContent = '';
    creditPlan(counts).forEach(function (id) { box.appendChild(creditLine(id, sh.kit, counts)); });
  }
  function missionRow(m, q) {
    var meta = rowMeta(m);
    return h('li', null, [h('button', { type: 'button', class: 'mn__source-row', 'data-mission': m.id, 'aria-label': m.title + (meta ? ', ' + meta : '') }, [
      worldIcon('mission'),
      h('span', { class: 'mn__source-row-text' }, [
        h('span', { class: 'mn__source-row-title' }, [marked(m.title, q)]),
        meta ? h('span', { class: 'mn__source-row-meta', text: meta }) : null,
        m.description ? h('span', { class: 'mn__source-row-desc' }, [marked(m.description, q)]) : null
      ]),
      h('span', { class: 'mn__source-chev', 'aria-hidden': 'true', text: '›' })
    ])]);
  }
  function rowsOf(list, q, cols) {
    var ul = h('ul', { class: 'mn__source-rows' + (cols ? ' mn__source-rows--cols' : '') });
    list.forEach(function (m) { ul.appendChild(missionRow(m, q)); });
    return ul;
  }
  function setStatus(text, delay) {
    var el = $('mnSourceStatus');
    clearTimeout(page.statusTimer);
    if (!el) return;
    if (!delay) { el.textContent = text; return; }
    page.statusTimer = setTimeout(function () { el.textContent = text; }, delay);
  }
  function renderList(sh, statusDelay) {
    var title = $('mnSourceListHead'), note = $('mnSourceListNote'), chips = $('mnSourceChips'), results = $('mnSourceResults'), foot = $('mnSourceListFoot');
    if (!title) return;
    var area = sh.area && sh.area !== ALL ? groupFor(sh, sh.area) : null;
    title.textContent = area ? area.name : TEXT.allMissions;
    note.textContent = area ? sh.kit.areaNote : TEXT.allNote;
    chips.textContent = '';
    results.textContent = '';
    foot.textContent = '';
    if (loading(sh)) { results.setAttribute('aria-busy', 'true'); results.appendChild(h('ul', { class: 'mn__source-rows' }, skeleton(3))); setStatus(''); return; }
    results.removeAttribute('aria-busy');
    if (sh.missionsState === 'failed') { results.appendChild(failed()); setStatus(''); return; }
    var all = sh.missions;
    if (!all.length) { results.appendChild(h('p', { class: 'mn__source-empty', text: TEXT.noneOpen })); setStatus(''); return; }
    var scope = area ? area.missions : all, q = sh.query.trim(), found = searchMissions(scope, q), list = fieldChips(found);
    title.appendChild(doc.createTextNode(' '));
    title.appendChild(h('span', { class: 'mn__source-count', text: String(area ? area.count : all.length) }));
    if (sh.field && !list.some(function (c) { return c.domain === sh.field; })) sh.field = '';
    if (found.length) list.forEach(function (c) {
      chips.appendChild(h('button', { type: 'button', class: 'mn__source-chip', 'data-field': c.domain, 'aria-pressed': c.domain === sh.field ? 'true' : 'false' }, [c.label + ' ', h('b', { text: String(c.count) })]));
    });
    var shown = sh.field ? found.filter(function (m) { return m.domain === sh.field; }) : found, areas = 0;
    if (!shown.length) {
      results.appendChild(h('div', { class: 'mn__source-nomatch' }, [h('button', { type: 'button', class: 'mn__source-more', 'data-act': 'clear', text: TEXT.clearSearch })]));
    } else if (area || sh.mapState !== 'ok') {
      areas = area ? 1 : null;
      results.appendChild(rowsOf(sortMissions(shown), q, true));
    } else {
      groupMissions(shown, sh.map).forEach(function (g) {
        areas += 1;
        var more = !q && g.count > PER_GROUP;
        results.appendChild(h('section', { class: 'mn__source-group', 'aria-label': areaLabel(g.name, g.count) }, [
          h('h4', { class: 'mn__source-group-head' }, [h('span', { text: g.name }), ' ', h('span', { class: 'mn__source-count', text: String(g.count) })]),
          rowsOf(more ? g.missions.slice(0, PER_GROUP) : g.missions, q, true),
          more ? h('button', { type: 'button', class: 'mn__source-more', 'data-area': g.key, text: 'Show all ' + g.count + ' in ' + g.name }) : null
        ]));
      });
    }
    var field = sh.field ? domainLabel(sh.field) : '';
    setStatus(statusLine({ count: shown.length, query: q, areaName: area ? area.name : '', areas: areas, field: field }), statusDelay);
    if (area && !q) {
      var gs = groupsOf(sh), at = -1;
      gs.forEach(function (g, i) { if (g.key === area.key) at = i; });
      var next = at >= 0 ? gs[at + 1] : null;
      if (next) foot.appendChild(h('button', { type: 'button', class: 'mn__source-next', 'data-area': next.key }, [
        h('small', { text: TEXT.nextArea }), ' ', h('strong', { text: next.name }), ' ', h('span', { class: 'mn__source-count', text: String(next.count) })
      ]));
    }
  }

  /* ---------- what a visitor does ---------- */
  function chooseArea(key) {
    var sh = page.sheet;
    if (!sh || (key !== ALL && !groupFor(sh, key))) return;
    if (sh.searchFromIndex) { sh.query = ''; sh.searchFromIndex = false; var input = $('mnSourceSearch'); if (input) input.value = ''; }
    sh.fromArea = key; sh.area = key; sh.view = 'list'; sh.field = '';
    address();
    render();
    var scroller = doc.querySelector('#mnSourceBody .mn__source-scroll'), right = doc.querySelector('#mnSourceBody .mn__source-right');
    if (scroller && !wide()) scroller.scrollTop = 0;
    if (right) right.scrollTop = 0;
    var title = $('mnSourceListHead');
    if (title) title.focus();
  }
  function backToIndex() {
    var sh = page.sheet;
    if (!sh) return;
    var from = sh.fromArea, input = $('mnSourceSearch');
    sh.view = 'index'; sh.area = ''; sh.field = ''; sh.query = ''; sh.searchFromIndex = false;
    if (input) input.value = '';
    address();
    render();
    var row = from ? byData('#mnSourceAreas', 'data-area', from) : null;
    if (row) row.focus();
    else { var name = $('mnSourceName'); if (name) name.focus(); }
  }
  function onSearch() {
    var sh = page.sheet, input = $('mnSourceSearch');
    if (!sh || !input) return;
    sh.query = input.value;
    if (sh.query.trim() && sh.view === 'index' && !wide()) { sh.view = 'list'; sh.area = ''; sh.searchFromIndex = true; }
    else if (!sh.query.trim() && sh.searchFromIndex) { sh.view = 'index'; sh.searchFromIndex = false; }
    render({ statusDelay: 300 });
  }
  function clearSearch() {
    var sh = page.sheet, input = $('mnSourceSearch');
    if (!sh || !input) return;
    input.value = '';
    sh.query = '';
    if (sh.searchFromIndex) { sh.view = 'index'; sh.searchFromIndex = false; }
    render();
    input.focus();
  }
  function share() {
    var sh = page.sheet;
    if (!sh) return;
    var link = shareLink(sh.source.slug), nav = root.navigator;
    if (!link) return;
    var other = function () {
      if (nav && nav.share) nav.share({ title: sh.source.name, url: link }).catch(function () {});
      else root.prompt(TEXT.copyPrompt, link);
    };
    if (!(nav && nav.clipboard && nav.clipboard.writeText)) { other(); return; }
    nav.clipboard.writeText(link).then(function () {
      var said = doc.querySelector('#mnSourceBody .mn__source-copied');
      if (!said) return;
      said.textContent = TEXT.copied;
      clearTimeout(page.copiedTimer);
      page.copiedTimer = setTimeout(function () { if (said.isConnected) said.textContent = ''; }, 2400);
    }, other);
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-act],[data-area],[data-mission],[data-field]') : null;
    var sh = page.sheet;
    if (!t || !sh) return;
    if (t.hasAttribute('data-mission')) { var w = mnet(); if (w && typeof w.openMission === 'function') w.openMission(t.getAttribute('data-mission')); return; }
    if (t.hasAttribute('data-area')) { chooseArea(t.getAttribute('data-area')); return; }
    if (t.hasAttribute('data-field')) { sh.field = t.getAttribute('data-field') || ''; render(); return; }
    var act = t.getAttribute('data-act');
    if (act === 'close') closeSheet();
    else if (act === 'share') share();
    else if (act === 'back') backToIndex();
    else if (act === 'clear') clearSearch();
    else if (act === 'retry') readMissionsOnce(sh);
    else if (act === 'toggle') {
      var panel = $(t.getAttribute('aria-controls')), open = t.getAttribute('aria-expanded') !== 'true';
      if (!panel) return;
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.hidden = !open;
    }
  }
  /* the head says the name once the name has scrolled away */
  function watchName(sheet) {
    if (page.observer) page.observer.disconnect();
    page.observer = null;
    var name = $('mnSourceName');
    sheet.removeAttribute('data-scrolled');
    if (!name || typeof root.IntersectionObserver !== 'function') return;
    page.observer = new root.IntersectionObserver(function (entries) {
      var last = entries[entries.length - 1];
      if (last.isIntersecting) sheet.removeAttribute('data-scrolled'); else sheet.setAttribute('data-scrolled', '');
    });
    page.observer.observe(name);
  }
  /* the × and Escape: an entry the page took from a mission is stepped back over; a landed one is put back without the
     page's keys */
  function closeSheet() {
    var sheet = $('mnSourceDialog'), sh = page.sheet, hist = root.history, st = hist && hist.state, ours = !!(st && st.mccSource);
    if (!sheet) return;
    if (sheet.open) { page.moduleClose = true; sheet.close(); }
    if (!ours) return;
    if (sh && sh.entry === 'pushed') { page.expectPop = true; try { hist.back(); } catch (e) { page.expectPop = false; } return; }
    try { hist.replaceState(withoutSource(st), '', restHref(root.location.hostname, root.location.search)); } catch (e) { /* the address stays */ }
  }
  function afterClose() {
    if (page.observer) page.observer.disconnect();
    page.observer = null;
    clearTimeout(page.statusTimer);
    clearTimeout(page.copiedTimer);
    page.sheet = null;
    var body = $('mnSourceBody'), sheet = $('mnSourceDialog');
    if (body) body.textContent = '';
    if (sheet) { sheet.removeAttribute('data-view'); sheet.removeAttribute('data-scrolled'); }
  }
  function wire(sheet, body) {
    if (page.wired) return;
    page.wired = true;
    body.addEventListener('click', onClick);
    body.addEventListener('input', function (e) { if (e.target && e.target.id === 'mnSourceSearch') onSearch(); });
    sheet.addEventListener('cancel', function (e) {
      var input = $('mnSourceSearch');
      if (input && input.value && e.cancelable) { e.preventDefault(); clearSearch(); return; }
      if (e.cancelable) e.preventDefault();
      closeSheet();
    });
    /* any close that was not the page's own (the sign-in door closes every open dialog; a forced close): the address
       loses the page's keys without walking history */
    sheet.addEventListener('close', function () {
      var mine = page.moduleClose;
      page.moduleClose = false;
      afterClose();
      if (mine) return;
      var hist = root.history, st = hist && hist.state;
      if (st && st.mccSource) { try { hist.replaceState(withoutSource(st), '', restHref(root.location.hostname, root.location.search)); } catch (e) { /* the address stays */ } }
    });
    /* Back: the page's own step is quiet; a step onto an entry without the page closes it; a forward step does not reopen it */
    root.addEventListener('popstate', function (e) {
      var st = e && 'state' in e ? e.state : root.history.state;
      if (page.expectPop) { page.expectPop = false; return; }
      if (sheet.open && !(st && st.mccSource)) { page.moduleClose = true; sheet.close(); }
    });
  }

  return {
    mission: mission, landing: landing,
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
