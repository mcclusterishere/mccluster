import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED = new Set([
  "https://matthew.mccluster.org",
  "https://mccluster.org",
  "https://mcclusterishere.github.io",
  "http://localhost:4173",
  "http://localhost:5173"
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED.has(origin) ? origin : "https://matthew.mccluster.org",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,apikey,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(req: Request, body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), ...extra, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function relay(req: Request, upstream: string | URL, init: RequestInit = {}, cache = "public, max-age=30") {
  const r = await fetch(upstream, { ...init, signal: AbortSignal.timeout(25000) });
  const headers = new Headers(cors(req));
  const ct = r.headers.get("content-type"); if (ct) headers.set("content-type", ct);
  headers.set("cache-control", cache);
  return new Response(r.body, { status: r.status, headers });
}

function qWithoutPath(url: URL) {
  const q = new URLSearchParams(url.searchParams);
  q.delete("path");
  return q;
}

function missing(req: Request, key: string) {
  return json(req, { error: "key_required", binding: key }, 503);
}

let openSkyToken = "";
let openSkyExp = 0;
async function openSkyAuth() {
  const id = Deno.env.get("OPENSKY_CLIENT_ID") || "";
  const secret = Deno.env.get("OPENSKY_CLIENT_SECRET") || "";
  if (!id || !secret) return "";
  if (openSkyToken && Date.now() < openSkyExp - 30000) return openSkyToken;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret });
  const r = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) return "";
  const d = await r.json();
  openSkyToken = d.access_token || "";
  openSkyExp = Date.now() + Number(d.expires_in || 300) * 1000;
  return openSkyToken;
}

function parseFirms(csv: string) {
  const lines = csv.trim().split(/\r?\n/); if (lines.length < 2) return [];
  const h = lines[0].split(",").map(v => v.trim().toLowerCase());
  const ix: Record<string,number> = {}; h.forEach((v,i)=>ix[v]=i);
  return lines.slice(1).flatMap(line => {
    const p = line.split(","); const lat = Number(p[ix.latitude]), lon = Number(p[ix.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [{ lat, lon, frp: Number(p[ix.frp]) || 0, confidence: p[ix.confidence] || "", brightness: Number(p[ix.bright_ti4]) || 0, brightnessTi5: Number(p[ix.bright_ti5]) || 0, daynight: p[ix.daynight] || "", acqDate: p[ix.acq_date] || "", acqTime: p[ix.acq_time] || "", satellite: p[ix.satellite] || "", instrument: p[ix.instrument] || "" }];
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  const path = (url.searchParams.get("path") || "health").replace(/^\/+/, "");
  const q = qWithoutPath(url);
  try {
    if (path === "health") return json(req, { ok: true, service: "mccluster-gev-proxy", upstream_commit: "759652207fd1279ece97f0f19af566feb9a82146" });

    if (path === "runtime-config") return json(req, {
      googleMapsApiKey: Deno.env.get("GOOGLE_MAPS_API_KEY") || "",
      cesiumIonToken: Deno.env.get("CESIUM_ION_TOKEN") || "",
      configured: {
        google: Boolean(Deno.env.get("GOOGLE_MAPS_API_KEY")),
        cesium: Boolean(Deno.env.get("CESIUM_ION_TOKEN")),
        firms: Boolean(Deno.env.get("FIRMS_MAP_KEY")),
        tomtom: Boolean(Deno.env.get("TOMTOM_API_KEY")),
        opensky: Boolean(Deno.env.get("OPENSKY_CLIENT_ID") && Deno.env.get("OPENSKY_CLIENT_SECRET")),
        openai: Boolean(Deno.env.get("OPENAI_API_KEY"))
      }
    });

    if (path === "setup/status") return json(req, { managed: "supabase-edge-secrets", configured: true });

    if (path === "opensky") {
      const u = new URL("https://opensky-network.org/api/states/all");
      for (const k of ["lamin","lomin","lamax","lomax","icao24","extended"]) if (q.has(k)) u.searchParams.set(k, q.get(k)!);
      const token = await openSkyAuth();
      return relay(req, u, token ? { headers: { authorization: `Bearer ${token}` } } : {}, "public, max-age=8");
    }

    if (path.startsWith("celestrak/")) {
      const group = path.slice(10); if (!/^[a-z0-9-]+$/i.test(group)) return json(req, { error: "invalid_group" }, 400);
      return relay(req, `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`, {}, "public, max-age=900");
    }

    if (path === "adsblol/mil") return relay(req, "https://api.adsb.lol/v2/mil", { headers: { "user-agent": "McCluster-GEV/1.0" } }, "public, max-age=8");

    if (path === "overpass") {
      const body = req.method === "POST" ? await req.text() : undefined;
      return relay(req, "https://overpass-api.de/api/interpreter", { method: req.method === "POST" ? "POST" : "GET", headers: { "content-type": req.headers.get("content-type") || "application/x-www-form-urlencoded", "user-agent": "McCluster-GEV/1.0" }, body }, "public, max-age=300");
    }

    if (path === "terrain/heights") {
      const points = q.get("points") || ""; if (!points || points.length > 20000) return json(req, { error: "invalid_points" }, 400);
      return relay(req, `https://terrain.reearth.land/heights.json?points=${encodeURIComponent(points)}`, {}, "public, max-age=86400");
    }

    if (path === "weather-effects") {
      const lat = Number(q.get("latitude") || q.get("lat")), lon = Number(q.get("longitude") || q.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(req, { error: "coordinates_required" }, 400);
      const u = new URL("https://api.open-meteo.com/v1/forecast");
      u.searchParams.set("latitude", String(lat)); u.searchParams.set("longitude", String(lon));
      u.searchParams.set("current", "temperature_2m,weather_code,cloud_cover,precipitation,rain,showers,snowfall,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m"); u.searchParams.set("timezone", "UTC");
      const r = await fetch(u); const d = await r.json(); const c = d.current || {};
      return json(req, { weather: { temperatureC: c.temperature_2m ?? null, weatherCode: c.weather_code ?? null, cloudCover: c.cloud_cover ?? null, precipitationMm: c.precipitation ?? null, rainMm: c.rain ?? null, showersMm: c.showers ?? null, snowfallCm: c.snowfall ?? null, visibilityM: c.visibility ?? null, windSpeedKmh: c.wind_speed_10m ?? null, windDirectionDeg: c.wind_direction_10m ?? null, windGustKmh: c.wind_gusts_10m ?? null, observedAt: c.time || null, latitude: d.latitude, longitude: d.longitude }, source: "Open-Meteo" }, r.ok ? 200 : r.status);
    }

    if (path === "launches") {
      const u = new URL("https://ll.thespacedevs.com/2.3.0/launches/"); u.searchParams.set("limit", "100"); u.searchParams.set("ordering", "-net");
      const t = Deno.env.get("LL2_API_TOKEN") || "";
      return relay(req, u, t ? { headers: { authorization: `Token ${t}` } } : {}, "public, max-age=900");
    }

    if (path === "firms/status") return json(req, { hasKey: Boolean(Deno.env.get("FIRMS_MAP_KEY")) });
    if (path === "firms") {
      const key = Deno.env.get("FIRMS_MAP_KEY") || ""; if (!key) return missing(req, "FIRMS_MAP_KEY");
      const sources = ["VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"]; const fires: unknown[] = [];
      for (const source of sources) { const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/2`); if (r.ok) fires.push(...parseFirms(await r.text())); }
      return json(req, { fetchedAt: new Date().toISOString(), stale: false, sources, count: fires.length, fires }, 200, { "cache-control": "public, max-age=300" });
    }

    if (path === "tomtom/status") return json(req, { hasKey: Boolean(Deno.env.get("TOMTOM_API_KEY")), configured: Boolean(Deno.env.get("TOMTOM_API_KEY")) });
    const tile = path.match(/^tomtom\/flow\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (tile) {
      const key = Deno.env.get("TOMTOM_API_KEY") || ""; if (!key) return missing(req, "TOMTOM_API_KEY");
      return relay(req, `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${tile[1]}/${tile[2]}/${tile[3]}.pbf?key=${encodeURIComponent(key)}`, {}, "public, max-age=120");
    }

    if (path === "google/text-search" || path === "google/nearby-places") {
      const key = Deno.env.get("GOOGLE_MAPS_API_KEY") || ""; if (!key) return missing(req, "GOOGLE_MAPS_API_KEY");
      if (path === "google/text-search") {
        const u = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json"); u.searchParams.set("query", q.get("q") || q.get("query") || "");
        if (q.get("lat") && q.get("lon")) u.searchParams.set("location", `${q.get("lat")},${q.get("lon")}`); if (q.get("radiusM")) u.searchParams.set("radius", q.get("radiusM")!); u.searchParams.set("key", key);
        return relay(req, u, {}, "no-store");
      }
      const u = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json"); u.searchParams.set("location", `${q.get("lat") || q.get("latitude")},${q.get("lon") || q.get("longitude")}`); u.searchParams.set("radius", q.get("radius") || q.get("radiusM") || "5000"); if (q.get("keyword")) u.searchParams.set("keyword", q.get("keyword")!); u.searchParams.set("key", key);
      return relay(req, u, {}, "no-store");
    }

    if (path === "route") {
      const profile = ["driving","walking","cycling"].includes(q.get("profile") || "") ? q.get("profile")! : "driving";
      const coords = q.get("coords") || ""; if (!coords || !/^-?[\d.]+,-?[\d.]+(?:;-?[\d.]+,-?[\d.]+)+$/.test(coords)) return json(req, { error: "invalid_coords" }, 400);
      return relay(req, `https://router.project-osrm.org/route/v1/${profile}/${encodeURI(coords)}?overview=full&geometries=geojson&steps=false`, {}, "public, max-age=300");
    }

    if (path === "regional-brief") {
      const lat = Number(q.get("latitude") || q.get("lat")), lon = Number(q.get("longitude") || q.get("lon")); if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(req, { error: "coordinates_required" }, 400);
      const [pr, wr] = await Promise.all([
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10`, { headers: { "user-agent": "McCluster-GEV/1.0" } }),
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,cloud_cover,precipitation,visibility,wind_speed_10m,wind_direction_10m&timezone=UTC`)
      ]);
      const place = pr.ok ? await pr.json() : null, wx = wr.ok ? await wr.json() : null;
      return json(req, { place, weather: wx?.current || null, articles: [], sources: ["OpenStreetMap Nominatim","Open-Meteo"] }, 200, { "cache-control": "public, max-age=300" });
    }

    if (path === "radio/stations") return relay(req, "https://de1.api.radio-browser.info/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=750", { headers: { "user-agent": "McCluster-GEV/1.0" } }, "public, max-age=2700");
    if (path.startsWith("radio/click/")) return relay(req, `https://de1.api.radio-browser.info/json/url/${encodeURIComponent(path.slice(12))}`, { method: "GET", headers: { "user-agent": "McCluster-GEV/1.0" } }, "no-store");

    if (path === "ais-live") return json(req, { status: "worker-pending", rows: [], vessels: [], error: Deno.env.get("AISSTREAM_API_KEY") ? "AIS persistent websocket is handled by the McCluster Worker plane" : "AISSTREAM_API_KEY required" });

    if (path === "realtime/token") {
      const key = Deno.env.get("OPENAI_API_KEY") || ""; if (!key) return missing(req, "OPENAI_API_KEY");
      return relay(req, "https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ session: { type: "realtime", model: Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime-2", audio: { output: { voice: Deno.env.get("OPENAI_REALTIME_VOICE") || "marin" } } } }) }, "no-store");
    }

    return json(req, { error: "route_not_implemented", path }, 404);
  } catch (e) {
    return json(req, { error: "broker_error", message: e instanceof Error ? e.message : String(e) }, 502);
  }
});
