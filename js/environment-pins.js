/* Environmental observations share the existing Cesium viewer. This module never
   fetches Halo, requests a location or accepts member/assignment information. */
(function (root) {
  'use strict';
  const LIMIT = 600;
  function normalize(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).slice(0, LIMIT).flatMap(row => {
      if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,299}$/.test(row.id) || seen.has(row.id)) return [];
      if (typeof row.lat !== 'number' || typeof row.lon !== 'number' || !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180) return [];
      seen.add(row.id);
      return [{ id: row.id, lat: row.lat, lon: row.lon, title: String(row.title || 'Environmental observation').slice(0, 160), stale: row.stale === true }];
    });
  }
  function create(getViewer, getCesium, tell) {
    let rows = [], pins = [], on = false, selected = '';
    function draw() {
      const viewer = getViewer(), C = getCesium();
      if (!viewer || !C) return;
      pins.forEach(pin => viewer.entities.remove(pin)); pins = [];
      if (!on) return;
      pins = rows.map(row => viewer.entities.add({
        position: C.Cartesian3.fromDegrees(row.lon, row.lat, 3000),
        point: { pixelSize: row.id === selected ? 17 : 11, color: C.Color.fromCssColorString(row.stale ? '#a1abb6' : '#76dfb5'), outlineColor: C.Color.fromCssColorString('#10251e'), outlineWidth: 3 },
        label: { text: row.title, font: '600 12px system-ui,sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -24), distanceDisplayCondition: new C.DistanceDisplayCondition(0, row.id === selected ? 25000000 : 1000000) },
        properties: { environmentEventId: row.id }
      }));
      viewer.scene.requestRender?.();
    }
    return {
      set(data) { on = data.on === true; rows = normalize(data.items); selected = rows.some(row => row.id === data.selected) ? data.selected : ''; draw(); },
      draw,
      destroy() { on=false;rows=[];selected='';draw(); },
      focus(id) {
        const viewer = getViewer(), C = getCesium(), row = on && rows.find(row => row.id === id);
        if (!viewer || !C || !row) return;
        selected = row.id; draw();
        viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(row.lon, row.lat, 1300000), duration: root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1 });
      },
      pick(picked) {
        const id = picked?.id?.properties?.environmentEventId?.getValue?.();
        if (!on || !rows.some(row => row.id === id)) return false;
        selected = id; draw(); tell({ type: 'hu:environment-selected', id }); return true;
      }
    };
  }
  root.MCC_ENVIRONMENT_PINS = Object.freeze({ normalize, create });
})(window);
