/*
 * HALO HUD — the camera telemetry readout for the admin globe (CesiumJS 1.131).
 *
 * Load it as a classic script after Cesium.js (styles: css/halo-hud.css); it
 * defines window.HaloHud = { mount, math }.
 *
 *   const hud = HaloHud.mount(viewer, hostElement); // appends .halo-hud, shown
 *   hud.show(false); hud.shown();                   // hide / ask
 *   hud.readout();                                  // the current values
 *   hud.destroy();                                  // removes it, restores the camera
 *
 * Every value is computed here from the globe camera and the clock. Nothing is
 * a sensor reading and nothing is classified, so nothing is labelled as such:
 *   - position: the point at the centre of the canvas when the globe is under
 *     it, otherwise the point directly below the camera — as latitude and
 *     longitude in degrees-minutes-seconds and as an MGRS reference truncated
 *     to 10 m (MGRS stops at 84°N and 80°S; the polar UPS grid is not done);
 *   - HAE: the camera's height above the WGS84 ellipsoid (not sea level);
 *   - HDG / PIT: the camera's heading and pitch;
 *   - SUN: the sun's apparent elevation at that point (NOAA solar position
 *     equations, with NOAA's refraction correction);
 *   - GSD est.: camera height × 0.000375 m/px, the rough ground-scale
 *     estimate God's Eye View and Hitman's Halo used — an estimate, labelled so;
 *   - the UTC time.
 * It updates on camera.changed (camera.percentageChanged is lowered to 0.01
 * while the HUD is shown and restored when it is hidden) at most every 200 ms,
 * and once a second for the clock. A hidden HUD listens to nothing.
 */
(function (root) {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function finite(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /* Longitude into [-180, 180]; values already in range are left alone. */
  function normLon(lon) {
    if (lon >= -180 && lon <= 180) return lon;
    return ((lon + 180) % 360 + 360) % 360 - 180;
  }

  /* ── Degrees, minutes, seconds ───────────────────────────────────────── */

  function dmsPart(value, isLat) {
    var tenths = Math.round(Math.abs(value) * 36000); // tenths of an arcsecond
    var d = Math.floor(tenths / 36000);
    var m = Math.floor((tenths % 36000) / 600);
    var s = tenths % 600;
    var hemi = tenths === 0 || value >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
    return pad(d, isLat ? 2 : 3) + '°' + pad(m, 2) + "'" + pad(Math.floor(s / 10), 2) + '.' + (s % 10) + '"' + hemi;
  }

  /** "40°44'54.2"N 073°59'08.5"W" — seconds to a tenth (about 3 m). */
  function dms(lat, lon) {
    if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90) return null;
    return dmsPart(lat, true) + ' ' + dmsPart(normLon(lon), false);
  }

  /* ── MGRS (WGS84, UTM zones incl. Norway 32V and Svalbard 31X–37X) ────── */

  var WGS84_A = 6378137;
  var WGS84_F = 1 / 298.257223563;
  var E2 = WGS84_F * (2 - WGS84_F);
  var K0 = 0.9996;
  var BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  var COLUMN_SETS = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR']; // by zone % 3
  var ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

  function utmZone(lat, lon) {
    var zone = lon === 180 ? 60 : Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32; // Norway
    if (lat >= 72 && lat < 84) {                                   // Svalbard
      if (lon >= 0 && lon < 9) zone = 31;
      else if (lon >= 9 && lon < 21) zone = 33;
      else if (lon >= 21 && lon < 33) zone = 35;
      else if (lon >= 33 && lon < 42) zone = 37;
    }
    return zone;
  }

  /* Transverse Mercator forward (Snyder, USGS Professional Paper 1395). */
  function utm(lat, lon, zone) {
    var lon0 = (zone - 1) * 6 - 180 + 3;
    var phi = lat * D2R;
    var ep2 = E2 / (1 - E2);
    var sin = Math.sin(phi);
    var cos = Math.cos(phi);
    var tan = Math.tan(phi);
    var N = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
    var T = tan * tan;
    var C = ep2 * cos * cos;
    var A = cos * (lon - lon0) * D2R;
    var e4 = E2 * E2;
    var e6 = e4 * E2;
    var M = WGS84_A * (
      (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi -
      (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) +
      (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) -
      (35 * e6 / 3072) * Math.sin(6 * phi)
    );
    var A2 = A * A;
    var A3 = A2 * A;
    var A4 = A3 * A;
    var A5 = A4 * A;
    var A6 = A5 * A;
    var easting = K0 * N * (A + (1 - T + C) * A3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120) + 500000;
    var northing = K0 * (M + N * tan * (A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720));
    if (lat < 0) northing += 10000000;
    return { easting: easting, northing: northing };
  }

  /**
   * MGRS reference, e.g. "18T WL 85628 11322". digits (0–5) per axis: 5 is
   * 1 m, 4 is 10 m, 3 is 100 m. Digits are truncated, never rounded, so the
   * reference names the square that contains the point. Returns null above
   * 84°N or below 80°S (the polar UPS grid is not implemented) and for
   * non-numbers.
   */
  function toMGRS(lat, lon, digits) {
    if (!finite(lat) || !finite(lon)) return null;
    if (lat > 84 || lat < -80) return null;
    digits = digits === undefined ? 5 : Math.floor(Number(digits));
    if (!(digits >= 0)) digits = 5;
    if (digits > 5) digits = 5;
    lon = normLon(lon);
    var zone = utmZone(lat, lon);
    var band = lat >= 72 ? 'X' : BANDS.charAt(Math.floor((lat + 80) / 8));
    var p = utm(lat, lon, zone);
    var e = Math.floor(p.easting);
    var n = Math.floor(p.northing);
    var colIndex = Math.floor(e / 100000) - 1;
    var columns = COLUMN_SETS[zone % 3];
    var column = columns.charAt(((colIndex % 8) + 8) % 8);
    var row = ROW_LETTERS.charAt((Math.floor(n / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20);
    var out = zone + band + ' ' + column + row;
    if (digits === 0) return out;
    var div = Math.pow(10, 5 - digits);
    return out + ' ' + pad(Math.floor((e % 100000) / div), digits) + ' ' + pad(Math.floor((n % 100000) / div), digits);
  }

  /* ── Sun (NOAA solar position equations) ─────────────────────────────── */

  /**
   * Apparent solar elevation in degrees (negative below the horizon) at a
   * UTC instant, for latitude/longitude in degrees, after the NOAA Solar
   * Calculator: Julian century, geometric mean longitude and anomaly,
   * equation of centre, apparent longitude, corrected obliquity,
   * declination, equation of time, true solar time and hour angle, then
   * NOAA's atmospheric refraction correction.
   */
  function sunElevation(date, lat, lon) {
    var ms = date instanceof Date ? date.getTime() : Number(date);
    if (!finite(ms) || !finite(lat) || !finite(lon)) return null;
    var jd = ms / 86400000 + 2440587.5;
    var jc = (jd - 2451545) / 36525;
    var L0 = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
    var M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    var ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    var Mr = M * D2R;
    var centre = Math.sin(Mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
      Math.sin(2 * Mr) * (0.019993 - 0.000101 * jc) +
      Math.sin(3 * Mr) * 0.000289;
    var omega = (125.04 - 1934.136 * jc) * D2R;
    var appLong = L0 + centre - 0.00569 - 0.00478 * Math.sin(omega);
    var meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
    var obliq = (meanObliq + 0.00256 * Math.cos(omega)) * D2R;
    var decl = Math.asin(Math.sin(obliq) * Math.sin(appLong * D2R));
    var y = Math.tan(obliq / 2);
    y *= y;
    var L0r = L0 * D2R;
    var eqTime = 4 * R2D * (
      y * Math.sin(2 * L0r) -
      2 * ecc * Math.sin(Mr) +
      4 * ecc * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * ecc * ecc * Math.sin(2 * Mr)
    ); // minutes
    var minutesUtc = ((ms % 86400000) + 86400000) % 86400000 / 60000;
    var trueSolar = ((minutesUtc + eqTime + 4 * lon) % 1440 + 1440) % 1440;
    var hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;
    var latR = lat * D2R;
    var cosZenith = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle * D2R);
    cosZenith = Math.max(-1, Math.min(1, cosZenith));
    var elevation = 90 - Math.acos(cosZenith) * R2D;
    var refraction = 0;
    if (elevation <= 85) {
      var te = Math.tan(elevation * D2R);
      if (elevation > 5) refraction = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5);
      else if (elevation > -0.575) refraction = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
      else refraction = -20.772 / te;
      refraction /= 3600;
    }
    return elevation + refraction;
  }

  /* ── Ground sample distance (estimate) ───────────────────────────────── */

  /** Metres of ground per screen pixel, roughly: height × 0.000375 (min 0.01). */
  function gsd(altitudeMeters) {
    if (!finite(altitudeMeters)) return null;
    return Math.max(0.01, altitudeMeters * 0.000375);
  }

  /* ── Display formats ─────────────────────────────────────────────────── */

  function formatAltitude(m) {
    if (!finite(m)) return '—';
    if (Math.abs(m) >= 10000) return (m / 1000).toFixed(Math.abs(m) >= 100000 ? 0 : 1) + ' km';
    return Math.round(m) + ' m';
  }

  function formatGsd(g) {
    if (!finite(g)) return '—';
    if (g >= 1000) return (g / 1000).toFixed(1) + ' km/px';
    if (g >= 10) return Math.round(g) + ' m/px';
    return g.toFixed(2) + ' m/px';
  }

  function formatDegrees(d) {
    if (!finite(d)) return '—';
    var r = Math.round(d);
    return (r === 0 ? 0 : r) + '°';
  }

  function formatHeading(d) {
    if (!finite(d)) return '—';
    var r = Math.round(((d % 360) + 360) % 360) % 360;
    return pad(r, 3) + '°';
  }

  function utcParts(date) {
    return {
      date: date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1, 2) + '-' + pad(date.getUTCDate(), 2),
      time: pad(date.getUTCHours(), 2) + ':' + pad(date.getUTCMinutes(), 2) + ':' + pad(date.getUTCSeconds(), 2) + 'Z'
    };
  }

  /* ── The HUD ─────────────────────────────────────────────────────────── */

  var THROTTLE_MS = 200;
  var HUD_PERCENTAGE_CHANGED = 0.01;

  function mount(viewer, host) {
    if (!viewer || !viewer.camera || !viewer.scene) throw new TypeError('HaloHud.mount needs a Cesium Viewer');
    if (!host || typeof host.appendChild !== 'function') throw new TypeError('HaloHud.mount needs a host element');
    var doc = host.ownerDocument || root.document;
    var camera = viewer.camera;
    var scene = viewer.scene;

    function node(tag, className, parent) {
      var el = doc.createElement(tag);
      if (className) el.className = className;
      if (parent) parent.appendChild(el);
      return el;
    }

    /* One labelled value: <span item><span k>LABEL</span><span v>value</span></span>.
       A label marked `wide` is added at tablet width and up (breakpoints add). */
    function field(row, name, label, wide) {
      var item = node('span', 'halo-hud__item halo-hud__item--' + name, row);
      if (label) node('span', 'halo-hud__k' + (wide ? ' halo-hud__more' : ''), item).textContent = label;
      return item;
    }

    var el = node('div', 'halo-hud');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Globe camera readout, computed from the camera view');
    var rowWhere = node('div', 'halo-hud__row halo-hud__row--where', el);
    var rowCamera = node('div', 'halo-hud__row halo-hud__row--camera', el);

    var out = {};
    out.lat = node('span', 'halo-hud__v', field(rowWhere, 'lat'));
    out.lon = node('span', 'halo-hud__v', field(rowWhere, 'lon'));
    out.mgrs = node('span', 'halo-hud__v', field(rowWhere, 'mgrs', 'MGRS', true));
    var utcItem = field(rowWhere, 'utc');
    out.date = node('span', 'halo-hud__v halo-hud__more', utcItem);
    out.time = node('span', 'halo-hud__v', utcItem);
    out.hae = node('span', 'halo-hud__v', field(rowCamera, 'hae', 'HAE'));
    out.hdg = node('span', 'halo-hud__v', field(rowCamera, 'hdg', 'HDG'));
    out.pit = node('span', 'halo-hud__v', field(rowCamera, 'pit', 'PIT'));
    out.sun = node('span', 'halo-hud__v', field(rowCamera, 'sun', 'SUN'));
    out.gsd = node('span', 'halo-hud__v', field(rowCamera, 'gsd', 'GSD est.'));
    host.appendChild(el);

    var visible = false;
    var destroyed = false;
    var lastPaint = 0;
    var trailing = null;
    var clock = null;
    var savedPercentage = null;
    var current = null;

    function pointUnderCamera() {
      var C = root.Cesium;
      var canvas = scene.canvas;
      try {
        var w = canvas && canvas.clientWidth;
        var h = canvas && canvas.clientHeight;
        if (C && scene.globe && w > 0 && h > 0) {
          var ray = camera.getPickRay(new C.Cartesian2(w / 2, h / 2));
          var hit = ray ? scene.globe.pick(ray, scene) : undefined;
          var carto = hit ? C.Cartographic.fromCartesian(hit) : undefined;
          if (carto && finite(carto.latitude) && finite(carto.longitude)) {
            return { lat: carto.latitude * R2D, lon: carto.longitude * R2D, source: 'centre' };
          }
        }
      } catch (e) { /* fall back to the camera's own position */ }
      var own = camera.positionCartographic;
      return { lat: own.latitude * R2D, lon: own.longitude * R2D, source: 'camera' };
    }

    function compute(date) {
      var where = pointUnderCamera();
      var lat = where.lat;
      var lon = normLon(where.lon);
      var alt = camera.positionCartographic.height;
      var heading = finite(camera.heading) ? ((camera.heading * R2D) % 360 + 360) % 360 : null;
      var pitch = finite(camera.pitch) ? camera.pitch * R2D : null;
      var g = gsd(alt);
      var sun = sunElevation(date, lat, lon);
      var mgrs = toMGRS(lat, lon, 4); // 10 m
      var both = dms(lat, lon) || '';
      var split = both.indexOf(' ');
      var utc = utcParts(date);
      return {
        source: where.source,
        lat: lat,
        lon: lon,
        mgrs: mgrs,
        altitudeM: alt,
        headingDeg: heading,
        pitchDeg: pitch,
        gsdM: g,
        sunElevationDeg: sun,
        utc: date.toISOString(),
        text: {
          lat: split > 0 ? both.slice(0, split) : '—',
          lon: split > 0 ? both.slice(split + 1) : '—',
          mgrs: mgrs || 'no MGRS (polar)',
          date: utc.date,
          time: utc.time,
          hae: formatAltitude(alt),
          hdg: formatHeading(heading),
          pit: formatDegrees(pitch),
          sun: formatDegrees(sun),
          gsd: formatGsd(g)
        }
      };
    }

    function paint(r) {
      for (var k in r.text) {
        if (Object.prototype.hasOwnProperty.call(r.text, k) && out[k] && out[k].textContent !== r.text[k]) {
          out[k].textContent = r.text[k];
        }
      }
      el.setAttribute('data-source', r.source);
    }

    function update() {
      if (destroyed) return current;
      trailing = null;
      lastPaint = Date.now();
      current = compute(new Date(lastPaint));
      if (visible) paint(current);
      return current;
    }

    /* camera.changed: paint now if the last paint is 200 ms old, otherwise
       once more when it is (the trailing paint catches where it settled). */
    function onCameraChanged() {
      if (!visible || destroyed) return;
      var wait = THROTTLE_MS - (Date.now() - lastPaint);
      if (wait <= 0) {
        if (trailing !== null) { clearTimeout(trailing); trailing = null; }
        update();
      } else if (trailing === null) {
        trailing = setTimeout(update, wait);
      }
    }

    /* Once a second: the clock, and the sun for the same point. */
    function onClock() {
      if (!visible || destroyed || !current) return;
      var date = new Date();
      var utc = utcParts(date);
      current.utc = date.toISOString();
      current.sunElevationDeg = sunElevation(date, current.lat, current.lon);
      current.text.date = utc.date;
      current.text.time = utc.time;
      current.text.sun = formatDegrees(current.sunElevationDeg);
      paint(current);
    }

    function listen(on) {
      var changed = camera.changed;
      var moveEnd = camera.moveEnd;
      if (on) {
        if (changed && typeof changed.addEventListener === 'function') changed.addEventListener(onCameraChanged);
        if (moveEnd && typeof moveEnd.addEventListener === 'function') moveEnd.addEventListener(onCameraChanged);
        if (savedPercentage === null && finite(camera.percentageChanged)) {
          savedPercentage = camera.percentageChanged;
          if (camera.percentageChanged > HUD_PERCENTAGE_CHANGED) camera.percentageChanged = HUD_PERCENTAGE_CHANGED;
        }
        if (clock === null) clock = setInterval(onClock, 1000);
      } else {
        if (changed && typeof changed.removeEventListener === 'function') changed.removeEventListener(onCameraChanged);
        if (moveEnd && typeof moveEnd.removeEventListener === 'function') moveEnd.removeEventListener(onCameraChanged);
        // Put the host's setting back unless someone has changed it since.
        if (savedPercentage !== null) {
          if (camera.percentageChanged === Math.min(savedPercentage, HUD_PERCENTAGE_CHANGED)) camera.percentageChanged = savedPercentage;
          savedPercentage = null;
        }
        if (clock !== null) { clearInterval(clock); clock = null; }
        if (trailing !== null) { clearTimeout(trailing); trailing = null; }
      }
    }

    function show(on) {
      if (destroyed) return false;
      on = on === undefined ? true : !!on;
      if (on === visible) return visible;
      visible = on;
      el.hidden = !on;
      listen(on);
      if (on) update();
      return visible;
    }

    function shown() {
      return visible;
    }

    /** The values on screen now, freshly computed (works while hidden too). */
    function readout() {
      if (destroyed) return null;
      var r = update();
      var copy = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
      copy.text = {};
      for (var t in r.text) if (Object.prototype.hasOwnProperty.call(r.text, t)) copy.text[t] = r.text[t];
      return copy;
    }

    function destroy() {
      if (destroyed) return;
      listen(false);
      visible = false;
      destroyed = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    show(true);
    return { show: show, shown: shown, readout: readout, destroy: destroy };
  }

  root.HaloHud = {
    mount: mount,
    math: { toMGRS: toMGRS, dms: dms, sunElevation: sunElevation, gsd: gsd }
  };
})(typeof window !== 'undefined' ? window : globalThis);
