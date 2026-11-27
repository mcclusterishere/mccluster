/* Public, read-only Sea Ice Index archive. A display layer, not a drift or deformation measurement. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MCC_ARCTIC_ICE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const dir = 'data/environment/arctic-ice/';
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  const stamp = day => Date.parse(day + 'T00:00:00.000Z');
  function valid(day) {
    return typeof day === 'string' && dayPattern.test(day) && Number.isFinite(stamp(day)) &&
      new Date(stamp(day)).toISOString().slice(0,10) === day;
  }
  function daysOf(manifest) {
    if (!Array.isArray(manifest?.frames) || !manifest.frames.length || manifest.frames.length > 1000) throw Error('Archive unavailable');
    const days = manifest.frames.map(f => { if (!valid(f.day) || f.image !== f.day + '.png') throw Error('Invalid frame'); return f.day; });
    if (new Set(days).size !== days.length) throw Error('Duplicate observation');
    return days.sort();
  }
  // #840 uses the last slider position as Live. Only while the archive is open,
  // preserve that endpoint after the last daily mark even with zero event posts.
  function withDays(marks, days) {
    if (!days.length) return marks;
    const dates = days.map(stamp), all = [...new Set([...marks, ...dates])].sort((a,b) => a-b);
    if (all.at(-1) === dates.at(-1)) all.push(all.at(-1) + 1);
    return all;
  }
  function dayAt(days, at) {
    if (!Number.isFinite(at)) return null; // Never silently paint stale data at Live.
    const day = new Date(at).toISOString().slice(0,10);
    return days.includes(day) ? day : null;
  }
  function createPage(w, hooks) {
    const el = id => w.document.getElementById(id), toggle = el('mnIceToggle');
    if (!toggle) return null;
    const status = el('mnIceStatus'), choice = el('mnIceDay'), details = el('mnIceDetails'), preview = el('mnIceImage');
    let days = [], sources = new Map(), active = false, changed = false, pending = 0, day = null, lastSent, mapState = '', oldAt = null;
    const gated = () => w.MCC_FEED_SCOPE?.get?.() === 'equity' && w.document.documentElement.getAttribute('data-we-feed') === 'ready';
    function send(msg) {
      const frame = el('mnWorldFrame');
      if (frame?.contentWindow) frame.contentWindow.postMessage(msg, w.location.origin);
    }
    function paint(at, force) {
      const next = active && gated() ? dayAt(days, at) : null;
      if (next !== day) mapState = '';
      day = next; choice.value = day || '';
      if (active) {
        status.textContent = days.length === 0 ? 'Opening archive…' : day ? day + ' UTC · ' +
          (mapState === 'ready' ? 'displayed on globe.' : mapState === 'failed' ? 'map unavailable. Open the flat image instead.' : 'selected. Flat image available below.') :
          at === null ? 'Live has no verified live ice frame. Choose an archive day.' : 'No ice frame for this UTC date. Nothing is drawn.';
      }
      const raw = el('mnIceSource'), source = sources.get(day);
      raw.hidden = !source; if (source) raw.href = source; else raw.removeAttribute('href');
      preview.hidden = !day;
      if (day) preview.href = dir + day + '.png'; else preview.removeAttribute('href');
      if (day !== lastSent || force) { lastSent = day; send({ type:'hu:environment-arctic-ice', day }); }
    }
    async function toggleLayer() {
      const id = ++pending;
      active = toggle.checked && gated(); details.hidden = !active;
      if (!active) {
        hooks.sync();
        if (changed) hooks.set(oldAt);
        changed = false;
        paint(hooks.at()); return;
      }
      oldAt = hooks.at(); changed = false;
      try {
        if (!days.length) {
          paint(hooks.at());
          const response = await w.fetch(dir + 'manifest.json');
          if (!response.ok) throw Error('Manifest unavailable');
          const manifest = await response.json(), list = daysOf(manifest);
          if (id !== pending || !active) return;
          days = list;
          sources = new Map(manifest.frames.filter(f => typeof f.url === 'string' && /^https:\/\/noaadata\.apps\.nsidc\.org\/NOAA\/G02135\/north\/daily\/geotiff\/./.test(f.url)).map(f => [f.day,f.url]));
          for (const d of list) { const option = w.document.createElement('option'); option.value = d; option.textContent = d + ' UTC'; choice.appendChild(option); }
        }
        hooks.sync();
        if (oldAt === null) { changed = true; hooks.set(stamp(days.at(-1))); }
        paint(hooks.at(), true);
      } catch (_) {
        if (id === pending) { active = false; toggle.checked = false; status.textContent = 'Ice archive unavailable. Switch it on to retry.'; hooks.sync(); }
      }
    }
    toggle.addEventListener('change', toggleLayer);
    choice.addEventListener('change', () => { if (active && days.includes(choice.value)) { changed = true; hooks.set(stamp(choice.value)); } });
    el('mnIceFocus').addEventListener('click', () => { if (active && day && gated()) send({type:'hu:environment-arctic-view'}); });
    return { dates:() => active && gated() ? days : [], paint,
      onState(d) { if (active && day && d.day === day && ['ready','failed'].includes(d.status)) { mapState = d.status; paint(hooks.at()); } },
      onScope() {
        // Dates and layers do not bleed into a different feed scope; re-enter explicitly.
        if (!gated() && active) { toggle.checked = false; void toggleLayer(); }
      } };
  }
  function createGlobe({viewer, Cesium:C, requestRender, tell}) {
    let requested = null, layer = null, generation = 0, state = 'off';
    function clear() { if (layer) { viewer.imageryLayers.remove(layer, true); layer = null; } requestRender('arctic-ice'); }
    async function show(value) {
      const day = valid(value) ? value : null;
      if (day === requested && (state !== 'failed' || !day)) return;
      requested = day; const rev = ++generation; clear(); state = day ? 'loading' : 'off';
      if (!day) return;
      try {
        const provider = await C.SingleTileImageryProvider.fromUrl(dir + day + '.png', {
          rectangle:C.Rectangle.fromDegrees(-180,45,180,90), credit:new C.Credit('NOAA/NSIDC Sea Ice Index v4')
        });
        if (rev !== generation) return;
        layer = viewer.imageryLayers.addImageryProvider(provider); layer.alpha = 0.90;
        layer.magnificationFilter = C.TextureMagnificationFilter.NEAREST;
        layer.minificationFilter = C.TextureMinificationFilter.NEAREST;
        state = 'ready'; requestRender('arctic-ice');
      } catch (_) { if (rev !== generation) return; clear(); state = 'failed'; }
      tell({type:'hu:environment-arctic-state',day,status:state});
    }
    return { show, focus() {
      if (!requested || state === 'off') return;
      viewer.camera.setView({destination:C.Cartesian3.fromDegrees(-25,82,7500000)}); requestRender('arctic-view');
    }, state:() => ({day:requested,status:state}), destroy() { ++generation; requested = null; state = 'off'; clear(); } };
  }
  return {daysOf, withDays, dayAt, createPage, createGlobe};
});
