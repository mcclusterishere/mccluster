/* PRIM3 World (owner, 2026-11-02: "a world builder … its own tab … only admin can see as its own app … click on a
   region and find a mission in every single region … from America to every other country that there's a character in").

   This module only loads after the shared owner gate (js/owner-only.mjs) has heard yes from the server; before that the
   page holds only the "Owner only" panel and neither this module nor the mission file is requested. A no at any later
   recheck reloads the page back to that panel. Missions open in the one playable level, prim3-transit.html?mission=<id>&new=1.

   No pins (owner, 2026-11-02): countries with a stationed agent are highlighted, and a tap on a country opens its card,
   which names the PRIM3 agent on assignment there from the one US HQ (the CAST-NATIONS character and role), marks the three featured
   characters, lists the country's mission and holds the empty "News → mission" section for the next build
   (js/prim3-world/hooks.mjs: <section id="pwNews" data-country="XX">, onCountryCard(fn), event 'prim3:country-card').

   The World builder (Edit) keeps drafts in this browser (localStorage) and exports or imports the JSON file. There is no
   database table and no Worker route for it: cloud storage will reuse the Level Forge backend later. */
import { onCountryCard, emitCountryCard } from './hooks.mjs';
import './mission-generator.mjs';
import { DATA_URL, DRAFT_KEY, REGIONS, castOf, missionsIn, findMission, deployHref, validate, missionErrors, blankMission, levelsOf, DIFFICULTIES, parseImport, exportText, uniqueId } from './missions.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const appEl = $('pwApp');

let open = false, shipped = null, doc = null, usingDraft = false, dirty = false;
let ui = { mode: 'globe', region: 'All', sel: null, country: null, countryName: null, placing: false };
let globe = null, globeLoading = null;

/* ---------- data ---------- */
function readDraft() { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && Array.isArray(d.missions) ? d : null; } catch (e) { return null; } }
function writeDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }
function dropDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

async function unlock() {
  open = true;
  appEl.hidden = false; document.body.dataset.pwGate = 'open';
  appEl.innerHTML = '<p class="pw-empty">Loading missions…</p>';
  try {
    const r = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!r.ok) throw Error('missions ' + r.status);
    shipped = await r.json();
  } catch (e) { if (open) appEl.innerHTML = '<p class="pw-empty">The mission file could not load. ' + esc(e.message) + '</p>'; return; }
  if (!open) return;
  const draft = readDraft();
  doc = draft ? draft : structuredClone(shipped); usingDraft = !!draft;
  const want = new URLSearchParams(location.search).get('m');
  if (want && findMission(doc, want)) { ui.sel = want; ui.country = findMission(doc, want).country.code; }
  build();
}

/* ---------- shell ---------- */
function build() {
  appEl.innerHTML = `
    <header class="pw-top">
      <img class="pw-lockup" src="assets/img/prim3-lockup-512.png" alt="PRIM3" width="62" height="44">
      <span class="pw-title"><h1>World</h1><small>Side operations by region · draft · owner</small></span>
      <nav class="pw-modes" aria-label="View">
        <button type="button" class="pw-seg" data-mode="globe">Globe</button>
        <button type="button" class="pw-seg" data-mode="list">List</button>
        <button type="button" class="pw-seg" data-mode="edit">Edit</button>
      </nav>
    </header>
    <div class="pw-filter" role="group" aria-label="Region" id="pwFilter"></div>
    <p class="pw-banner" id="pwBanner" hidden></p>
    <div class="pw-body" id="pwBody">
      <section class="pw-globe" id="pwGlobe" aria-label="Mission globe: drag to rotate, pinch or use the buttons to zoom, tap a country to open its card">
        <p class="pw-hint" id="pwHint">Tap a highlighted country.</p>
        <div class="pw-cam">
          <button type="button" class="pw-ibtn" id="pwIn" aria-label="Zoom in">+</button>
          <button type="button" class="pw-ibtn" id="pwOut" aria-label="Zoom out">−</button>
          <button type="button" class="pw-ibtn" id="pwHome" aria-label="Reset the view"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></button>
        </div>
      </section>
      <section class="pw-list" id="pwList" aria-label="Missions" hidden></section>
      <aside class="pw-side" id="pwSide"></aside>
    </div>`;
  appEl.querySelector('.pw-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('pwFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-region]'); if (b) setRegion(b.dataset.region); });
  $('pwIn').addEventListener('click', () => globe && globe.zoom(1));
  $('pwOut').addEventListener('click', () => globe && globe.zoom(-1));
  $('pwHome').addEventListener('click', () => globe && globe.reset());
  $('pwList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { select(b.dataset.open, { focus: true }); } });
  $('pwSide').addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.placing) { ui.placing = false; renderSide(); } });
  $('pwSide').addEventListener('click', onSide);
  $('pwSide').addEventListener('input', onEditInput);
  $('pwSide').addEventListener('change', onEditInput);
  $('pwBanner').addEventListener('click', (e) => { if (e.target.closest('[data-act="discard"]')) discardDraft(); });
  ensureGlobe();
  render();
}
function ensureGlobe() {
  if (globe || globeLoading) return;
  const host = $('pwGlobe');
  globeLoading = import('./globe.mjs').then(({ createGlobe }) => {
    if (!open || !$('pwGlobe')) return;
    globe = createGlobe(host, { reducedMotion: REDUCED, onCountry });
    globeLoading = null;
    paintGlobe();
    /* A late globe-ready must never rebuild the editor: rebuilding the side panel while the
       owner is typing replaces the field under the caret and the typed briefing is lost (seen
       as the PR #793 tactics job at 1280px, where the slow renderer finished during the fill).
       Only the country list depends on the globe, so refresh those options in place. */
    globe.ready.then(() => { paintGlobe(); const m = findMission(doc, ui.sel); if (m) globe.focus(m.lat, m.lon); document.body.dataset.pwGlobe = 'ready'; if (ui.mode === 'edit') refreshCountryOptions(); })
      .catch((e) => { document.body.dataset.pwGlobe = 'failed'; $('pwHint').textContent = e.message; });
  }).catch((e) => {
    globeLoading = null; document.body.dataset.pwGlobe = 'failed';
    host.insertAdjacentHTML('beforeend', '<p class="pw-noglobe">The globe could not load here. The List view has every mission.</p>');
  });
}

/* ---------- state changes ---------- */
function setMode(mode) {
  if (mode === ui.mode) return;
  ui.mode = mode;
  if (mode === 'edit' && !ui.sel) ui.sel = (missionsIn(doc, ui.region)[0] || doc.missions[0] || {}).id || null;
  render();
  if (mode !== 'list' && globe) { const m = findMission(doc, ui.sel); if (m) globe.focus(m.lat, m.lon); }
}
function setRegion(region) {
  ui.region = region;
  const list = missionsIn(doc, region);
  if (ui.sel && !list.some((m) => m.id === ui.sel) && ui.mode !== 'edit') { ui.sel = null; ui.country = null; }
  render();
  if (globe && list.length && region !== 'All') {
    // look at the middle of the region's missions
    const v = list.reduce((a, m) => { const la = m.lat * Math.PI / 180, lo = m.lon * Math.PI / 180; a.x += Math.cos(la) * Math.cos(lo); a.y += Math.cos(la) * Math.sin(lo); a.z += Math.sin(la); return a; }, { x: 0, y: 0, z: 0 });
    globe.focus(Math.atan2(v.z, Math.hypot(v.x, v.y)) * 180 / Math.PI, Math.atan2(v.y, v.x) * 180 / Math.PI);
  }
}
function select(id, { focus } = {}) {
  const m = findMission(doc, id); if (!m) return;
  ui.sel = id; ui.country = m.country.code; ui.countryName = m.country.name;
  if (ui.mode === 'list') ui.mode = 'globe';
  render();
  if (globe && focus !== false) globe.focus(m.lat, m.lon);
  const side = $('pwSide'); if (side && !matchMedia('(min-width: 1024px)').matches && ui.mode !== 'edit') side.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
}
function onCountry(code, name, ll) {
  if (ui.mode === 'edit' && ui.placing && ll) { place(ll.lat, ll.lon, code, name); return; }
  if (!code) { ui.country = null; ui.countryName = null; if (ui.mode !== 'edit') ui.sel = null; render(); return; }
  ui.country = code; ui.countryName = name;
  if (ui.mode !== 'edit') { const here = doc.missions.find((m) => m.country.code === code); ui.sel = here ? here.id : null; }
  render();
  const side = $('pwSide'); if (side && ui.mode !== 'edit' && !matchMedia('(min-width: 1024px)').matches) side.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
}
/* Edit: with "Set position" armed, the next tap on the globe becomes the selected mission's coordinates (no pin is drawn) */
function place(lat, lon, code, name) {
  const m = findMission(doc, ui.sel); if (!m) return;
  m.lat = Math.round(lat * 10000) / 10000; m.lon = Math.round(lon * 10000) / 10000; dirty = true; ui.placing = false;
  renderSide();
  setStatus(`Position set to ${m.lat}, ${m.lon}${name ? ' (' + name + ')' : ''}.` + (code && code !== m.country.code ? ' That is outside ' + m.country.name + '.' : ''));
  const b = $('pwBanner'); if (b) b.hidden = false;
}

/* ---------- rendering ---------- */
function render() {
  if (!doc) return;
  appEl.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ui.mode)));
  const counts = Object.fromEntries(REGIONS.map((r) => [r, missionsIn(doc, r).length]));
  $('pwFilter').innerHTML = ['All', ...REGIONS].map((r) => `<button type="button" class="pw-chip" data-region="${esc(r)}" aria-pressed="${r === ui.region}">${esc(r)}<small>${r === 'All' ? doc.missions.length : counts[r]}</small></button>`).join('');
  const banner = $('pwBanner');
  banner.hidden = !usingDraft && !dirty;
  banner.innerHTML = (dirty ? 'Unsaved edits in this view.' : 'Showing your browser draft, not the shipped mission file.') + ' <button type="button" class="pw-btn pw-btn--warn" data-act="discard">Discard drafts</button>';
  const list = ui.mode === 'list';
  $('pwGlobe').hidden = list; $('pwList').hidden = !list; $('pwBody').classList.toggle('is-list', list);
  $('pwSide').hidden = list;
  if (list) renderList(); else { renderSide(); paintGlobe(); }
  $('pwHint').textContent = ui.mode === 'edit' ? (ui.placing ? 'Tap the globe where this mission happens.' : 'Type the coordinates, or use Set position and tap the globe.') : 'Tap a highlighted country. Drag to turn, pinch to zoom.';
}
function paintGlobe() {
  if (!globe || !doc) return;
  const inRegion = new Set(missionsIn(doc, ui.region).map((m) => m.country.code));
  const codes = [], dim = [];
  for (const m of doc.missions) (inRegion.has(m.country.code) ? codes : dim).push(m.country.code);
  globe.setHighlight({ codes, dim, featured: doc.missions.filter((m) => m.featured).map((m) => m.country.code), selected: ui.country });
}
function renderList() {
  const groups = (ui.region === 'All' ? REGIONS : [ui.region]).map((r) => [r, missionsIn(doc, r)]);
  $('pwList').innerHTML = groups.map(([r, list]) => `<h2>${esc(r)} · ${list.length}</h2>` + (list.length
    ? `<ul class="pw-items">${list.map((m) => `<li class="pw-item"><button type="button" data-open="${esc(m.id)}"><b>${esc(m.title)}</b><small>${m.featured ? '<span class="is-feat">Featured · </span>' : ''}${esc(m.character.name)} · ${esc(m.country.name)}</small></button><a class="pw-btn pw-btn--go" href="${esc(deployHref(m))}" aria-label="Deploy: ${esc(m.title)}">Deploy</a></li>`).join('')}</ul>`
    : `<p class="pw-empty">No missions in ${esc(r)} yet. No cast nation is there.</p>`)).join('');
}
function renderSide() {
  const side = $('pwSide'); if (!side) return;
  if (ui.mode === 'edit') return renderEditor();
  if (!ui.country) {
    side.innerHTML = `<section class="pw-card"><p class="pw-eye">${castOf(doc).length} agents · ${doc.missions.length} missions · draft</p><h2>Pick a country</h2><p class="pw-empty">Every highlighted country has a PRIM3 agent on assignment there from HQ in the United States, with a side operation drawn from their story. The three amber-edged countries hold the featured characters.</p><p class="pw-note">Side operations are drafts: they create no episodes and change no relationships.</p><div class="pw-row">${doc.missions.filter((x) => x.featured).map((x) => `<button type="button" class="pw-btn pw-btn--go" data-open="${esc(x.id)}">${esc(x.character.name)} · ${esc(x.country.name)}</button>`).join('')}</div></section>`;
    return;
  }
  const code = ui.country;
  const agents = castOf(doc).filter((c) => c.country && c.country.code === code);
  const here = doc.missions.filter((m) => m.country.code === code);
  const name = (agents[0] && agents[0].country.name) || (here[0] && here[0].country.name) || ui.countryName || code;
  const featured = here.some((m) => m.featured);
  side.innerHTML = `<article class="pw-card" id="pwCard" data-country="${esc(code)}" aria-labelledby="pwCardTitle">
    <p class="pw-eye">${featured ? '<b>Featured</b> · ' : ''}Country card · ${esc(code)}</p>
    <h2 id="pwCardTitle">${esc(name)}</h2>
    <section class="pw-agents" aria-label="${code === 'US' ? 'Agent at HQ' : 'Agent on assignment here'}">
      <p class="pw-sub">${code === 'US' ? 'At HQ' : 'Agent on assignment here'}</p>
      ${agents.length ? `<ul class="pw-agent-list">${agents.map((c) => { const fm = here.find((m) => m.character.name === c.name && m.featured); return `<li class="pw-agent"><b>${esc(c.name)}</b>${fm ? ' <span class="pw-feat">Featured character</span>' : ''}<small>${esc(c.role)}${c.main ? (code === 'US' ? ' · HQ, United States' : ' · on assignment from HQ in the United States') : ''}</small></li>`; }).join('')}</ul>` : '<p class="pw-empty">No PRIM3 agent is on assignment here.</p>'}
    </section>
    ${here.map((m) => missionBlock(m)).join('')}
    <section class="pw-news" id="pwNews" data-country="${esc(code)}" aria-label="News to mission">
      <p class="pw-sub">News → mission</p>
      <p class="pw-empty">Review public news and regional geography to build a playable training scenario. Automatic news ingestion is not connected.</p>
    </section>
  </article>`;
  emitCountryCard(code, $('pwNews'), name, { geography: here[0] ? { place: here[0].place, lat: here[0].lat, lon: here[0].lon } : null });
}
function missionBlock(m) {
  const lvl = levelsOf(doc).find((l) => l.id === m.level);
  return `<section class="pw-mission" aria-label="Mission: ${esc(m.title)}">
    <p class="pw-sub">Side operation${m.featured ? ' · <b>featured character</b>' : ''}</p>
    <h3>${esc(m.title)}</h3>
    <p class="pw-who">${esc(m.character.name)}<small>${esc(m.character.role)}${m.place ? ' · ' + esc(m.place) : ''}</small></p>
    <ul class="pw-meta"><li class="is-draft">Side operation · draft</li>${m.needs_owner_review ? '<li class="is-draft">Needs owner review</li>' : ''}<li>${esc(m.region)}</li><li>${esc(m.difficulty)}</li><li>${esc(lvl ? lvl.title : m.level)}</li>${m.episode ? `<li>${esc(m.episode)}</li>` : ''}</ul>
    <p class="pw-brief">${esc(m.briefing)}</p>
    ${m.deployment === 'wildcard-call' ? `<p class="pw-obj pw-wild"><small>Wildcard call</small>${esc(m.character.name)} calls this in from HQ; he is not a deployable unit. The squad (Entry, Recon, Technical) deploys.</p>` : ''}
    <p class="pw-obj"><small>Objective</small>${esc(m.objective)}</p>
    <p class="pw-note">Draws on ${m.sources.length} canon section${m.sources.length === 1 ? '' : 's'} (listed in Edit). A side operation creates no episode and changes no relationships.</p>
    <a class="pw-deploy" data-deploy="${esc(m.id)}" href="${esc(deployHref(m))}">${m.deployment === 'wildcard-call' ? 'Deploy the squad' : 'Deploy'} <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 5l7 7-7 7M12 5l7 7-7 7"/></svg></a>
  </section>`;
}

/* ---------- the World builder ---------- */
const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
function field(id, label, html, span) { return `<label class="pw-field${span ? ' pw-span2' : ''}" id="pwL-${id}"><span>${esc(label)}</span>${html}</label>`; }
function countryOptions(cast) {
  const countries = globe ? globe.countries() : [];
  return (countries.length ? countries : cast.map((c) => c.country)).filter((c, i, a) => a.findIndex((x) => x.code === c.code) === i);
}
const countryOptionsHtml = (list, code) => list.map((c) => opt(c.code, c.name + ' (' + c.code + ')', c.code === code)).join('');
/* Refresh only the country choices once the globe knows them, leaving every other field,
   its value and the focus exactly where the owner left them. */
function refreshCountryOptions() {
  const sel = $('pwF-country'), m = findMission(doc, ui.sel); if (!sel || !m) return;
  const list = countryOptions(castOf(doc)); if (!list.some((c) => c.code === m.country.code)) list.push({ ...m.country });
  sel.innerHTML = countryOptionsHtml(list, m.country.code);
}
function renderEditor() {
  const side = $('pwSide');
  const m = findMission(doc, ui.sel);
  const cast = castOf(doc);
  const countryOpts = countryOptions(cast);
  const head = `<p class="pw-store">Drafts are kept in this browser only (localStorage), then exported as <code>data/prim3/world-missions.json</code>. Nothing here writes to a database or the API; cloud saving will reuse the Level Forge backend later.</p>
    <div class="pw-row">
      ${field('pick', 'Mission', `<select id="pwF-pick">${doc.missions.map((x) => opt(x.id, x.title + ' · ' + x.character.name, x.id === ui.sel)).join('')}</select>`)}
    </div>
    <div class="pw-row"><button type="button" class="pw-btn pw-btn--go" data-act="new">New mission${ui.country ? ' in ' + esc(ui.countryName || ui.country) : ''}</button><button type="button" class="pw-btn" data-act="save">Save draft</button><button type="button" class="pw-btn" data-act="export">Export JSON</button><label class="pw-btn" for="pwImport">Import JSON</label><input type="file" id="pwImport" accept="application/json,.json" class="pw-sr"></div>
    <p class="pw-status" id="pwStatus" role="status"></p>`;
  if (!m) { side.innerHTML = `<section class="pw-card pw-edit">${head}<p class="pw-empty">No mission selected.</p><div id="pwChecks"></div></section>`; renderChecks(); return; }
  side.innerHTML = `<section class="pw-card pw-edit" aria-label="World builder">${head}
    <form class="pw-form" id="pwForm" onsubmit="return false">
      ${field('id', 'Id (unique)', `<input id="pwF-id" value="${esc(m.id)}" autocomplete="off" spellcheck="false">`)}
      ${field('title', 'Title', `<input id="pwF-title" value="${esc(m.title)}">`)}
      ${field('character', 'Character', `<select id="pwF-character">${cast.map((c) => opt(c.name, c.name + ' · ' + c.country.name + (c.main ? '' : ' (legacy)'), c.name === m.character.name)).join('')}${cast.some((c) => c.name === m.character.name) ? '' : opt(m.character.name, m.character.name, true)}</select>`)}
      ${field('role', 'Character role', `<input id="pwF-role" value="${esc(m.character.role)}">`)}
      ${field('country', 'Country', `<select id="pwF-country">${countryOptionsHtml(countryOpts, m.country.code)}</select>`)}
      ${field('region', 'Region', `<select id="pwF-region">${REGIONS.map((r) => opt(r, r, r === m.region)).join('')}</select>`)}
      ${field('place', 'Place', `<input id="pwF-place" value="${esc(m.place || '')}">`)}
      <div class="pw-two">${field('lat', 'Latitude', `<input id="pwF-lat" type="number" step="0.0001" min="-90" max="90" inputmode="decimal" value="${esc(m.lat)}">`)}${field('lon', 'Longitude', `<input id="pwF-lon" type="number" step="0.0001" min="-180" max="180" inputmode="decimal" value="${esc(m.lon)}">`)}</div>
      ${field('level', 'Level', `<select id="pwF-level">${levelsOf(doc).map((l) => opt(l.id, l.title, l.id === m.level)).join('')}</select>`)}
      ${field('difficulty', 'Briefing difficulty (label only)', `<select id="pwF-difficulty">${DIFFICULTIES.map((d) => opt(d, d, d === m.difficulty)).join('')}</select>`)}
      <label class="pw-check pw-span2"><input type="checkbox" id="pwF-featured"${m.featured ? ' checked' : ''}> Featured story mission (amber country edge)</label>
      ${field('briefing', 'Briefing (2–4 sentences)', `<textarea id="pwF-briefing" rows="5">${esc(m.briefing)}</textarea>`, true)}
      ${field('objective', 'Objective', `<textarea id="pwF-objective" rows="2">${esc(m.objective)}</textarea>`, true)}
      ${field('note', 'Canon note', `<textarea id="pwF-note" rows="3">${esc(m.note || '')}</textarea>`, true)}
      ${field('sources', 'Sources: one per line, file # section', `<textarea id="pwF-sources" rows="4" spellcheck="false">${esc(m.sources.map((s) => s.file + ' # ' + s.section).join('\n'))}</textarea>`, true)}
    </form>
    <div class="pw-row"><button type="button" class="pw-btn${ui.placing ? ' pw-btn--go' : ''}" data-act="place" aria-pressed="${ui.placing}">${ui.placing ? 'Tap the globe…' : 'Set position on the globe'}</button><button type="button" class="pw-btn pw-btn--go" data-act="playtest">Save &amp; play test</button><button type="button" class="pw-btn pw-btn--warn" data-act="delete">Delete mission</button></div>
    <p class="pw-store">Play testing starts a fresh local run and replaces the current save for this level. Title and briefing follow your draft; the level supplies combat rules. Difficulty is a briefing label, not a combat modifier.</p>
    <div id="pwChecks"></div>
  </section>`;
  $('pwImport').addEventListener('change', onImport);
  renderChecks();
}
function renderChecks() {
  const host = $('pwChecks'); if (!host || !doc) return;
  const v = validate(doc), mine = ui.sel ? (v.records[ui.sel] || []) : [];
  const others = Object.entries(v.records).filter(([k]) => k !== ui.sel);
  host.innerHTML = `<div class="pw-checks ${v.ok ? 'is-ok' : 'is-bad'}" role="status">${v.ok ? 'All checks pass: every record complete, ids unique, every cast nation has a mission.' : `${v.count} problem${v.count === 1 ? '' : 's'} to fix before export.`}
    ${(mine.length || v.general.length || others.length) ? `<ul>${mine.map((e) => `<li>This mission: ${esc(e)}</li>`).join('')}${v.general.map((e) => `<li>${esc(e)}</li>`).join('')}${others.map(([k, errs]) => `<li>${esc(k)}: ${esc(errs.join(' '))}</li>`).join('')}</ul>` : ''}</div>`;
  const bad = new Set(missionErrors(findMission(doc, ui.sel), doc).map((e) => e.split(' ')[0].toLowerCase()));
  document.querySelectorAll('.pw-field').forEach((f) => f.classList.remove('is-bad'));
  const map = { id: 'id', country: 'country', region: 'region', latitude: 'lat', longitude: 'lon', character: 'character', title: 'title', briefing: 'briefing', objective: 'objective', level: 'level', difficulty: 'difficulty', cite: 'sources', every: 'sources' };
  bad.forEach((k) => { const f = map[k] && $('pwL-' + map[k]); if (f) f.classList.add('is-bad'); });
  const exp = document.querySelector('[data-act="export"]'); if (exp) exp.disabled = !v.ok;
}
function setStatus(t) { const s = $('pwStatus'); if (s) s.textContent = t; }
function onEditInput(e) {
  const t = e.target; if (!t.id || !t.id.startsWith('pwF-') || ui.mode !== 'edit') return;
  if (t.id === 'pwF-pick') { if (e.type === 'change') { ui.sel = t.value; const m = findMission(doc, ui.sel); ui.country = m && m.country.code; render(); if (globe && m) globe.focus(m.lat, m.lon); } return; }
  const m = findMission(doc, ui.sel); if (!m) return;
  const k = t.id.slice(4), val = t.type === 'checkbox' ? t.checked : t.value;
  switch (k) {
    case 'id': { const nid = val.trim(); m.id = nid; ui.sel = nid; break; }
    case 'title': m.title = val; break;
    case 'role': m.character = { ...m.character, role: val }; break;
    case 'character': {
      const c = castOf(doc).find((x) => x.name === val);
      m.character = { name: val, role: c ? c.role : m.character.role };
      if (c && e.type === 'change') { m.country = { ...c.country }; const r = doc.missions.find((x) => x !== m && x.country.code === c.country.code); if (r) m.region = r.region; renderEditor(); }
      break;
    }
    case 'country': { const opt = t.selectedOptions[0]; m.country = { code: val, name: opt ? opt.textContent.replace(/\s*\([A-Z]{2}\)$/, '') : val }; break; }
    case 'region': m.region = val; break;
    case 'place': m.place = val; break;
    case 'lat': case 'lon': { const n = Number(val); m[k] = val === '' || !Number.isFinite(n) ? NaN : n; break; }
    case 'level': m.level = val; break;
    case 'difficulty': m.difficulty = val; break;
    case 'featured': m.featured = !!val; break;
    case 'briefing': m.briefing = val; break;
    case 'objective': m.objective = val; break;
    case 'note': m.note = val; break;
    case 'sources': m.sources = val.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('#'); return i < 0 ? { file: l.trim(), section: '' } : { file: l.slice(0, i).trim(), section: l.slice(i + 1).trim() }; }); break;
    default: return;
  }
  dirty = true;
  const b = $('pwBanner'); if (b) { b.hidden = false; b.firstChild.textContent = 'Unsaved edits in this view. '; }
  renderChecks();
  if (['lat', 'lon', 'country', 'region', 'featured', 'character', 'title', 'id'].includes(k) && e.type === 'change') paintGlobe();
  if ((k === 'lat' || k === 'lon') && e.type === 'change' && globe && Number.isFinite(m.lat) && Number.isFinite(m.lon)) globe.focus(m.lat, m.lon);
}
function onSide(e) {
  const o = e.target.closest('[data-open]'); if (o) { select(o.dataset.open, { focus: true }); return; }
  const b = e.target.closest('[data-act]'); if (!b || ui.mode !== 'edit') return;
  const act = b.dataset.act;
  if (act === 'place') { ui.placing = !ui.placing; render(); if (ui.placing) $('pwGlobe').scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' }); return; }
  if (act === 'new') {
    const cast = castOf(doc);
    const c = (ui.country && cast.find((x) => x.country.code === ui.country)) || cast[0];
    const m = blankMission(doc, c);
    if (ui.country && (!c || c.country.code !== ui.country)) { m.country = { code: ui.country, name: ui.countryName || ui.country }; m.id = uniqueId(doc, ui.country + '-new-mission'); }
    const centre = doc.missions.find((x) => x.country.code === m.country.code);
    if (centre) { m.lat = centre.lat; m.lon = centre.lon; m.region = centre.region; }
    doc.missions.push(m); ui.sel = m.id; dirty = true; render(); setStatus('New mission added. Fill in the fields the checks list.');
    if (globe) globe.focus(m.lat, m.lon);
  } else if (act === 'save') {
    if (writeDraft(doc)) { usingDraft = true; dirty = false; render(); setStatus('Draft saved in this browser.'); } else setStatus('This browser would not store the draft.');
  } else if (act === 'playtest') {
    const m = findMission(doc, ui.sel);
    const problems = missionErrors(m, doc);
    if (m && doc.missions.filter((x) => x.id === m.id).length !== 1) problems.push('Mission Id must be unique.');
    if (problems.length) { setStatus('Fix this mission before play testing: ' + problems.join(' ')); return; }
    if (!writeDraft(doc)) { setStatus('This browser would not store the draft. Play test has not started.'); return; }
    usingDraft = true; dirty = false;
    location.assign(deployHref(m));
  } else if (act === 'delete') {
    const m = findMission(doc, ui.sel); if (!m || !confirm('Delete "' + (m.title || m.id) + '" from the draft?')) return;
    doc.missions = doc.missions.filter((x) => x !== m); ui.sel = (doc.missions[0] || {}).id || null; dirty = true; render(); setStatus('Mission deleted from the draft. Save to keep it that way.');
  } else if (act === 'export') {
    const v = validate(doc); if (!v.ok) { setStatus('Fix the problems listed before exporting.'); return; }
    const url = URL.createObjectURL(new Blob([exportText(doc)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'world-missions.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus('Exported world-missions.json. Commit it to data/prim3/ to ship it.');
  }
}
function onImport(e) {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  f.text().then((raw) => {
    const r = parseImport(raw);
    if (!r.ok) { setStatus(r.error); return; }
    doc = r.doc; dirty = true; ui.sel = (doc.missions[0] || {}).id || null; render();
    setStatus('Imported ' + doc.missions.length + ' missions. Save draft to keep them in this browser.');
  });
}
function discardDraft() {
  if ((usingDraft || dirty) && !confirm('Discard your browser drafts and return to the shipped mission file?')) return;
  dropDraft(); usingDraft = false; dirty = false; doc = structuredClone(shipped);
  if (!findMission(doc, ui.sel)) ui.sel = null;
  render();
}
addEventListener('beforeunload', (e) => { if (open && dirty) { e.preventDefault(); e.returnValue = ''; } });

/* test hooks, like window.__tx on the transit page: read-only views of the state */
window.__pw = { get open() { return open; }, get ui() { return ui; }, get globe() { return globe; }, get doc() { return doc; }, select, setMode, setRegion, openCountry: (code) => onCountry(code, null, null) };
/* for scripts that are not modules; modules import onCountryCard from js/prim3-world/hooks.mjs */
window.PRIM3_WORLD = Object.freeze({ onCountryCard });

unlock();
