/* THE EARTHQUAKE MARKS (event timeline slice S5, 2026-11-19): what makes a quake recognisable before the click (owner: "make
   the actual event the thing you click, recognizable before you click"). Each quake the feed carries is a glyph: a seismograph
   trace (the World's own quake pictogram, the line icon of the quake posts in js/mnet.js; an icon, never anyone's mark) in a dark
   round badge ringed in its depth colour, sized by its magnitude. The largest carry a two-line label beside the glyph, the
   magnitude ("M6.3") over a short place, laid out greedily by magnitude so no two labels overlap, none crosses a glyph, none
   leaves the frame or sits under the page's own controls, and none is drawn behind the Earth or along its limb. The glyph is the
   thing a visitor taps: a tap within 22 CSS px of a glyph's centre (a 44 px target) selects that quake, so a thumb never has to
   find a 6 px dot.

   Nothing here is built per frame. One BillboardCollection holds every glyph and one every label; each image is drawn once per
   colour, size and text and kept. While frames are drawn anyway (the camera moving, an animation under its bounded hold) a cheap
   pass, run only when the camera's view has changed, hides what went behind the Earth and solves the labels again; a parked
   camera costs nothing and asks for no frame. The pure parts (sizes, the short place, the label layout, the tap test, the horizon
   test) carry no Cesium and no clock and are unit-tested on their own (scripts/test/environment-quake-marks.test.mjs). */
(function (root) {
  'use strict';
  const GREY = '#9aa0a6';
  const HIT_RADIUS_PX = 22, LABEL_MIN_MAG = 4.5, LABEL_CANDIDATES = 24, GLYPH_MIN_PX = 14, GLYPH_MAX_PX = 44, MARK_HEIGHT_M = 2000;
  const LABEL_GAP_PX = 6, LIMB_COS = 0.2, REVEAL_MS = 320;
  /* the trace of the World's quake pictogram (js/mnet.js OBS_ICON.quake: M3 12h3l2-5 3 10 3-8 2 5 2-2h3 in a 24-unit box) */
  const TRACE = Object.freeze([[3, 12], [6, 12], [8, 7], [11, 17], [14, 9], [16, 14], [18, 12], [21, 12]].map(p => Object.freeze(p)));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const finite = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- pure ---------- */
  /* the badge's diameter in CSS px: 14 px for M2.5 and below (or no magnitude), 5.5 px more per magnitude unit, 44 px from M8;
     even sizes only, so one drawn image serves every quake of a size and colour */
  function glyphPx(mag) {
    if (!finite(mag)) return GLYPH_MIN_PX;
    return clamp(2 * Math.round((14 + 5.5 * (mag - 2.5)) / 2), GLYPH_MIN_PX, GLYPH_MAX_PX);
  }
  /* the image around the badge: room for its glow and, when selected, its white ring */
  const imagePx = px => Math.ceil(px * 1.6);
  const magText = mag => (finite(mag) ? 'M' + mag.toFixed(1) : null);
  /* a short place from the USGS place line: "20 km NW of Anamizu, Japan" is "Anamizu, Japan"; a line without "of" stays whole */
  function shortPlace(title, max) {
    const n = max || 26;
    const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
    if (!t) return '';
    const m = /\bof\s+(.+)$/i.exec(t);
    const place = (m ? m[1] : t).trim();
    return place.length > n ? place.slice(0, n - 1).trimEnd() + '…' : place;
  }
  const labelPriority = mag => (finite(mag) ? Math.round(mag * 1000) : -1);
  /* how many labels a frame of this size can carry before it reads as clutter: 3 on a phone's globe, up to 14 on a desktop */
  const maxLabels = (width, height) => clamp(Math.round((Math.max(0, width) * Math.max(0, height)) / 56000), 3, 14);
  /* where a label may sit: clear of the page's own controls over the frame. On the World page (measured at 390 x 844 and
     1280 x 800, 2026-11-19) the page's header lies over the frame's top (about 56 px on a phone, 75 px wider), its headline
     over the top left, the music and full-screen buttons at the top right, the frame's legend and credits along its foot and,
     on a wide screen, the app bar at the bottom right. The frame cannot see the page, so these are kept out as a band at the
     top and the foot (safeArea) and three corners (keepOut); a frame shown without them only loses a little room. */
  function safeArea(width, height) {
    const phone = width < 600;
    return { top: phone ? Math.max(60, Math.round(height * 0.12)) : 84, right: 8, bottom: phone ? 72 : 96, left: 8 };
  }
  function keepOut(width, height) {
    const phone = width < 600;
    const out = [{ x: 0, y: 0, w: Math.min(phone ? 240 : 320, width * 0.62), h: phone ? 100 : 156 }, { x: width - (phone ? 116 : 150), y: 0, w: phone ? 116 : 150, h: phone ? 162 : 176 }];
    if (!phone) out.push({ x: width - 220, y: height - 150, w: 220, h: 150 });
    return out;
  }
  const overlaps = (a, b, pad) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  function circleHitsRect(c, r) {
    const nx = clamp(c.x, r.x, r.x + r.w), ny = clamp(c.y, r.y, r.y + r.h);
    return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
  }
  /* the label layout: candidates [{ id, x, y, r, w, h, priority, forced }] in CSS px of the frame (x, y the glyph's centre, r its
     radius); the forced one (the selection) is placed first and always shown; the others by priority, then id, each on the right
     of its glyph, else on its left, else above or below it, only inside the safe area, never over an accepted label or over the
     glyph of a quake as large or larger (a larger quake's label may lie over a smaller one's glyph), never in a kept-out
     corner; at most `max` in all. obstacles: [{ id, x, y, r, priority }]; keepOut: [{ x, y, w, h }]. Answers
     [{ id, side, rect }] in placing order. */
  function layoutLabels(candidates, opts) {
    const o = opts || {}, width = o.width || 0, height = o.height || 0, max = o.max === undefined ? 6 : o.max;
    const safe = o.safe || { top: 0, right: 0, bottom: 0, left: 0 };
    const area = { x: safe.left, y: safe.top, w: width - safe.left - safe.right, h: height - safe.top - safe.bottom };
    const kept = (o.keepOut || []).filter(k => k && finite(k.x) && finite(k.y) && k.w > 0 && k.h > 0);
    const inside = r => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h && !kept.some(k => overlaps(k, r, 0));
    const glyphs = (o.obstacles || []).filter(g => g && finite(g.x) && finite(g.y) && finite(g.r));
    const list = (Array.isArray(candidates) ? candidates : []).filter(c => c && finite(c.x) && finite(c.y) && c.w > 0 && c.h > 0)
      .slice().sort((a, b) => (b.forced === true) - (a.forced === true) || b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const placed = [];
    for (const c of list) {
      if (placed.length >= max && c.forced !== true) break;
      const gap = (c.r || 0) + LABEL_GAP_PX;
      const sides = [['right', { x: c.x + gap, y: c.y - c.h / 2, w: c.w, h: c.h }], ['left', { x: c.x - gap - c.w, y: c.y - c.h / 2, w: c.w, h: c.h }],
        ['above', { x: c.x - c.w / 2, y: c.y - gap - c.h, w: c.w, h: c.h }], ['below', { x: c.x - c.w / 2, y: c.y + gap, w: c.w, h: c.h }]];
      const free = rect => !placed.some(p => overlaps(p.rect, rect, 3)) && !glyphs.some(g => g.id !== c.id && (c.forced !== true && finite(g.priority) && g.priority < c.priority ? false : circleHitsRect(g, rect)));
      let chosen = sides.find(([, rect]) => inside(rect) && free(rect));
      if (!chosen && c.forced === true) {
        /* the selection is always labelled: the side that fits the frame, nudged inside it when neither does */
        const fit = sides.find(([, rect]) => inside(rect)) || sides[c.x > width / 2 ? 1 : 0];
        const rect = Object.assign({}, fit[1]);
        rect.x = clamp(rect.x, area.x, Math.max(area.x, area.x + area.w - rect.w));
        rect.y = clamp(rect.y, area.y, Math.max(area.y, area.y + area.h - rect.h));
        chosen = [fit[0], rect];
      }
      if (chosen) placed.push({ id: c.id, side: chosen[0], rect: chosen[1] });
    }
    return placed;
  }
  /* the tap test: the nearest visible point within `radius` CSS px; on a tie the larger magnitude */
  function nearestWithin(points, x, y, radius) {
    let best = null, bestD = Infinity;
    for (const p of Array.isArray(points) ? points : []) {
      if (!p || p.visible !== true || !finite(p.x) || !finite(p.y)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > radius) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && (p.mag || 0) > ((best && best.mag) || 0))) { best = p; bestD = d; }
    }
    return best ? best.id : null;
  }
  /* the horizon, for a point a little above a sphere through it: seen from c when c.p > p.p (positions in Earth-centred metres) */
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const horizonVisible = (p, c) => dot(p, c) > dot(p, p);
  /* how squarely the point faces the camera: the cosine between its up direction and its line of sight to the camera; labels
     need LIMB_COS (about 78 degrees from straight up), so nothing is lettered sideways along the limb */
  function facing(p, c) {
    const v = { x: c.x - p.x, y: c.y - p.y, z: c.z - p.z }, lp = Math.sqrt(dot(p, p)), lv = Math.sqrt(dot(v, v));
    return lp > 0 && lv > 0 ? dot(p, v) / (lp * lv) : -1;
  }
  const pure = Object.freeze({ glyphPx, imagePx, magText, shortPlace, labelPriority, maxLabels, safeArea, keepOut, layoutLabels, nearestWithin, horizonVisible, facing, TRACE, HIT_RADIUS_PX, LABEL_MIN_MAG, LIMB_COS });

  /* ---------- drawing (once per colour, size and text) ---------- */
  function canvasOf(doc, w, h, dpr) {
    const c = doc.createElement('canvas');
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    return { c, g };
  }
  function drawGlyph(doc, colour, px, selected, dpr) {
    const size = imagePx(px), { c, g } = canvasOf(doc, size, size, dpr), cx = size / 2, r = px / 2;
    /* the glow: the depth colour fading out round the badge, so a mark reads at night and by day */
    const glow = g.createRadialGradient(cx, cx, r * 0.55, cx, cx, size / 2);
    glow.addColorStop(0, colour + (selected ? 'b3' : '80')); glow.addColorStop(1, colour + '00');
    g.fillStyle = glow; g.fillRect(0, 0, size, size);
    if (selected) { g.beginPath(); g.arc(cx, cx, r + 2.2, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke(); }
    g.beginPath(); g.arc(cx, cx, r - 0.9, 0, Math.PI * 2); g.fillStyle = 'rgba(5,10,20,0.88)'; g.fill();
    g.lineWidth = Math.max(1.4, px / 15); g.strokeStyle = colour; g.stroke();
    /* the trace, 18 units wide in its box, drawn across 78 % of the badge */
    const s = (px * 0.78) / 18;
    g.beginPath();
    TRACE.forEach(([x, y], i) => { const X = cx + (x - 12) * s, Y = cx + (y - 12) * s; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.lineWidth = Math.max(1.3, px / 13); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.stroke();
    return { canvas: c, size };
  }
  /* letters spaced by hand (a canvas's letterSpacing is not everywhere yet) */
  function tracked(g, text, x, y, spacing) {
    let at = x;
    for (const ch of text) { g.fillText(ch, at, y); at += g.measureText(ch).width + spacing; }
    return at - x - spacing;
  }
  function trackedWidth(g, text, spacing) { let w = 0; for (const ch of text) w += g.measureText(ch).width + spacing; return Math.max(0, w - spacing); }
  const MAG_FONT = '700 15px Inter, system-ui, sans-serif', PLACE_FONT = '600 10px Inter, system-ui, sans-serif', PLACE_TRACK = 1.1;
  function measureLabel(doc, mag, place) {
    const g = doc.createElement('canvas').getContext('2d');
    g.font = MAG_FONT; const w1 = g.measureText(mag).width;
    g.font = PLACE_FONT; const w2 = place ? trackedWidth(g, place, PLACE_TRACK) : 0;
    return { w: Math.ceil(Math.max(w1, w2) + 8), h: place ? 34 : 21 };
  }
  function drawLabel(doc, mag, place, colour, dpr) {
    const box = measureLabel(doc, mag, place), { c, g } = canvasOf(doc, box.w, box.h, dpr);
    g.textBaseline = 'alphabetic';
    const ink = (font, text, x, y, fill, spacing) => {
      g.font = font; g.lineJoin = 'round';
      g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 4;
      g.strokeStyle = 'rgba(3,6,12,0.9)'; g.lineWidth = 3;
      if (spacing) { let at = x; for (const ch of text) { g.strokeText(ch, at, y); at += g.measureText(ch).width + spacing; } } else g.strokeText(text, x, y);
      g.shadowBlur = 0; g.fillStyle = fill;
      if (spacing) tracked(g, text, x, y, spacing); else g.fillText(text, x, y);
    };
    ink(MAG_FONT, mag, 4, 16, '#ffffff', 0);
    if (place) ink(PLACE_FONT, place, 4, 30, '#d4dde8', PLACE_TRACK);
    /* a hairline in the depth colour under the magnitude ties the label to its glyph's ring */
    g.fillStyle = colour; g.fillRect(4, 19.5, Math.min(22, box.w - 8), 1.5);
    return { canvas: c, w: box.w, h: box.h };
  }

  /* ---------- runtime ---------- */
  function create(options) {
    const o = options || {};
    const viewer = o.viewer, Cesium = o.Cesium, doc = o.document || root.document;
    const add = typeof o.add === 'function' ? o.add : p => viewer.scene.primitives.add(p);
    const remove = typeof o.remove === 'function' ? o.remove : p => { try { viewer.scene.primitives.remove(p); } catch (e) {} return null; };
    const requestRender = typeof o.requestRender === 'function' ? o.requestRender : () => {};
    const motion = typeof o.motionAllowed === 'function' ? o.motionAllowed : () => true;
    const clock = typeof o.now === 'function' ? o.now : () => Date.now();
    const toWindow = Cesium && Cesium.SceneTransforms && (Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates);
    const usable = !!(viewer && Cesium && Cesium.BillboardCollection && doc && typeof doc.createElement === 'function' && toWindow);
    const dpr = () => Math.min(3, Math.max(1, Number(root.devicePixelRatio) || 1));
    let glyphs = null, labels = null, on = false, cutoff = null, selectedId = null, lastView = null, dirty = true, reveal = null, destroyed = false;
    const marks = new Map(), images = new Map();
    let placedLabels = [];
    function image(key, draw) { let v = images.get(key); if (!v) { v = draw(); images.set(key, v); } return v; }
    function glyphImage(colour, px, selected) { const key = `g|${colour}|${px}|${selected ? 1 : 0}`; return { key, img: image(key, () => drawGlyph(doc, colour, px, selected, dpr())) }; }
    function shown(m) { return on && (cutoff === null || !Number.isFinite(m.t) || m.t <= cutoff); }
    function clear() { glyphs = remove(glyphs) || null; labels = remove(labels) || null; marks.clear(); placedLabels = []; }
    /* items: [{ id, pick, lon, lat, mag, colour, title, observed_at, stale }]: built when the feed changes, never per frame */
    function build(items) {
      if (!usable || destroyed) return 0;
      clear();
      const list = (Array.isArray(items) ? items : []).filter(i => i && finite(i.lon) && finite(i.lat));
      if (!list.length) return 0;
      glyphs = new Cesium.BillboardCollection(); labels = new Cesium.BillboardCollection();
      /* the largest last, so a big quake's glyph sits over a small neighbour's */
      const ordered = list.slice().sort((a, b) => (finite(a.mag) ? a.mag : -1) - (finite(b.mag) ? b.mag : -1) || (a.id < b.id ? -1 : 1));
      for (const item of ordered) {
        const colour = item.colour || GREY, px = glyphPx(item.mag), { key, img } = glyphImage(colour, px, false);
        const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, MARK_HEIGHT_M);
        const glyph = glyphs.add({ position, width: img.size, height: img.size, disableDepthTestDistance: Number.POSITIVE_INFINITY, id: item.pick, show: false, color: Cesium.Color.fromAlpha(Cesium.Color.WHITE, item.stale ? 0.6 : 1) });
        glyph.setImage(key, img.canvas);
        marks.set(item.id, { id: item.id, item, colour, px, size: img.size, position, glyph, label: null, labelBox: null, mag: finite(item.mag) ? item.mag : null, t: Date.parse(item.observed_at), screen: null, visible: false, facing: -1 });
      }
      /* label candidates: the largest from M4.5, at most 24, drawn once; the layout decides which show */
      const candidates = [...marks.values()].filter(m => m.mag !== null && m.mag >= LABEL_MIN_MAG).sort((a, b) => b.mag - a.mag || (a.id < b.id ? -1 : 1)).slice(0, LABEL_CANDIDATES);
      for (const m of candidates) makeLabel(m);
      add(glyphs); add(labels);
      dirty = true; layout();
      return marks.size;
    }
    function makeLabel(m) {
      if (m.label || !labels) return;
      const text = magText(m.mag);
      if (!text) return;
      const place = shortPlace(m.item.title).toUpperCase();
      const key = `l|${m.colour}|${text}|${place}`;
      const img = image(key, () => drawLabel(doc, text, place, m.colour, dpr()));
      m.labelBox = { w: img.w, h: img.h };
      m.label = labels.add({ position: m.position, width: img.w, height: img.h, disableDepthTestDistance: Number.POSITIVE_INFINITY, id: m.item.pick, show: false, verticalOrigin: Cesium.VerticalOrigin.CENTER, horizontalOrigin: Cesium.HorizontalOrigin.LEFT, pixelOffset: new Cesium.Cartesian2(0, 0) });
      m.label.setImage(key, img.canvas);
    }
    function viewKey() {
      const c = viewer.camera, p = c.positionWC, d = c.directionWC, u = c.upWC, canvas = viewer.scene.canvas;
      return [p.x, p.y, p.z, d.x, d.y, d.z, u.x, u.y, u.z, canvas.clientWidth, canvas.clientHeight, viewer.scene.mode].map(v => Math.round(v * 1000) / 1000).join(',');
    }
    /* screen positions, the horizon, then the labels; run when the view changed, the data changed or the selection did */
    function layout() {
      if (!glyphs || destroyed) return;
      const scene = viewer.scene, canvas = scene.canvas, width = canvas.clientWidth || 0, height = canvas.clientHeight || 0;
      const cam = viewer.camera.positionWC, threeD = !Cesium.SceneMode || scene.mode === Cesium.SceneMode.SCENE3D;
      lastView = viewKey(); dirty = false;
      const scratch = new Cesium.Cartesian2();
      for (const m of marks.values()) {
        const want = shown(m);
        let visible = want && (!threeD || horizonVisible(m.position, cam)), screen = null;
        if (visible) { const w = toWindow(scene, m.position, scratch); if (w && finite(w.x) && finite(w.y)) screen = { x: w.x, y: w.y }; else visible = false; }
        m.visible = visible; m.screen = screen; m.facing = threeD ? facing(m.position, cam) : 1;
        if (m.glyph.show !== visible) m.glyph.show = visible;
      }
      const candidates = [], obstacles = [];
      for (const m of marks.values()) {
        if (!m.visible || !m.screen) continue;
        obstacles.push({ id: m.id, x: m.screen.x, y: m.screen.y, r: m.px / 2 + 2, priority: labelPriority(m.mag) });
        const forced = m.id === selectedId;
        if (!m.label || (!forced && m.facing < LIMB_COS)) continue;
        candidates.push({ id: m.id, x: m.screen.x, y: m.screen.y, r: m.px / 2 + (forced ? 4 : 1), w: m.labelBox.w, h: m.labelBox.h, priority: labelPriority(m.mag), forced });
      }
      placedLabels = layoutLabels(candidates, { width, height, max: maxLabels(width, height), safe: safeArea(width, height), keepOut: keepOut(width, height), obstacles });
      const placed = new Map(placedLabels.map(p => [p.id, p]));
      for (const m of marks.values()) {
        if (!m.label) continue;
        const p = placed.get(m.id);
        if (!p) { if (m.label.show) m.label.show = false; continue; }
        /* the billboard sits at the glyph; the offset carries it to its rectangle's near edge (the solver's rectangle, so a nudged
           selection label lands where it was placed) */
        const x = p.rect.x - m.screen.x, y = p.rect.y + p.rect.h / 2 - m.screen.y;
        m.label.horizontalOrigin = Cesium.HorizontalOrigin.LEFT;
        m.label.pixelOffset = new Cesium.Cartesian2(Math.round(x), Math.round(y));
        if (!m.label.show) m.label.show = true;
      }
    }
    /* called from the scene's preRender: only a changed view (or data, or selection) costs anything */
    function frame() {
      if (!glyphs || destroyed) return;
      if (dirty || viewKey() !== lastView) layout();
      if (reveal) stepReveal();
    }
    function stepReveal() {
      const m = marks.get(reveal.id);
      if (!m || !m.label) { reveal = null; return; }
      const k = Math.min(1, (clock() - reveal.t0) / REVEAL_MS), eased = k * k * (3 - 2 * k);
      m.label.color = Cesium.Color.fromAlpha(Cesium.Color.WHITE, eased);
      m.label.scale = 0.96 + 0.04 * eased;
      if (k >= 1) reveal = null; else requestRender('mark-reveal');
    }
    /* the selection: the glyph gains a white ring and its label is always shown, revealed over a third of a second */
    function select(id) {
      if (!glyphs) { selectedId = id || null; return; }
      const previous = selectedId ? marks.get(selectedId) : null;
      if (previous) { const { key, img } = glyphImage(previous.colour, previous.px, false); previous.glyph.setImage(key, img.canvas); previous.glyph.width = img.size; previous.glyph.height = img.size; previous.glyph.scale = 1; if (previous.label) { previous.label.color = Cesium.Color.WHITE; previous.label.scale = 1; } }
      selectedId = id && marks.has(id) ? id : null;
      const m = selectedId ? marks.get(selectedId) : null;
      if (m) {
        const { key, img } = glyphImage(m.colour, m.px, true);
        m.glyph.setImage(key, img.canvas); m.glyph.width = img.size; m.glyph.height = img.size; m.glyph.scale = 1.15;
        makeLabel(m);
        if (m.label && motion()) { reveal = { id: m.id, t0: clock() }; m.label.color = Cesium.Color.fromAlpha(Cesium.Color.WHITE, 0); m.label.scale = 0.96; }
        else reveal = null;
      } else reveal = null;
      dirty = true; layout(); requestRender('mark-select');
    }
    function setOn(value) { const next = value === true; if (next === on) return; on = next; dirty = true; layout(); }
    /* the replay: quakes recorded after the current scene are hidden, glyph and label alike */
    function setCutoff(ms) { const next = finite(ms) ? ms : null; if (next === cutoff) return; cutoff = next; dirty = true; layout(); }
    /* a tap at (x, y) CSS px of the frame: the quake whose glyph is nearest within 22 px, among those drawn */
    function hit(x, y) {
      if (!glyphs || !finite(x) || !finite(y)) return null;
      if (dirty || viewKey() !== lastView) layout();
      return nearestWithin([...marks.values()].map(m => ({ id: m.id, x: m.screen ? m.screen.x : NaN, y: m.screen ? m.screen.y : NaN, visible: m.visible, mag: m.mag })), x, y, HIT_RADIUS_PX);
    }
    function screenOf(id) { const m = marks.get(id); if (!m) return null; if (dirty || viewKey() !== lastView) layout(); return m.visible && m.screen ? { x: m.screen.x, y: m.screen.y, px: m.px } : null; }
    function state() {
      const visible = [...marks.values()].filter(m => m.visible);
      const canvas = viewer.scene.canvas;
      return { glyphs: marks.size, visible: visible.length, labels: placedLabels.map(p => p.id), boxes: placedLabels.map(p => ({ id: p.id, side: p.side, x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: p.rect.w, h: p.rect.h })), frame: { width: canvas.clientWidth || 0, height: canvas.clientHeight || 0 }, selected: selectedId, on, cutoff, images: images.size };
    }
    function destroy() { clear(); images.clear(); destroyed = true; }
    return Object.freeze({ build, frame, layout, select, setOn, setCutoff, hit, screenOf, state, destroy, usable: () => usable, has: id => marks.has(id) });
  }
  root.MCC_ENVIRONMENT_QUAKE_MARKS = Object.freeze({ pure, create, HIT_RADIUS_PX });
})(window);
