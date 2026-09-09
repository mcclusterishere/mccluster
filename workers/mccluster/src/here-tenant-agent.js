import { DurableObject } from "cloudflare:workers";

const AIS_ENDPOINT = 'https://stream.aisstream.io/v0/stream';
const AIS_DEFAULT_BOXES = [[[-90, -180], [90, 180]]];
const AIS_DEFAULT_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport'
];
const AIS_MAX_ROWS = 12000;
const AIS_STALE_MS = 120000;
const AIS_ROW_TTL_MS = 3600000;
const AIS_HEARTBEAT_MS = 30000;
const AIS_BACKOFF_MIN_MS = 15000;
const AIS_BACKOFF_MAX_MS = 600000;
const AIS_MAX_PAYLOAD_CHARS = 4000;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseMessageTypes(value) {
  if (!value) return AIS_DEFAULT_TYPES;
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 20);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function vesselFromMessage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const metadata = payload.MetaData || payload.metaData || {};
  const messageRoot = payload.Message || payload.message || {};
  const messageType = payload.MessageType || payload.messageType || Object.keys(messageRoot)[0] || 'unknown';
  const message = messageRoot[messageType] || messageRoot || {};
  const mmsi = Number(metadata.MMSI ?? metadata.mmsi ?? message.UserID ?? message.userId ?? message.MMSI ?? message.mmsi);
  if (!Number.isFinite(mmsi) || mmsi <= 0) return null;

  const latitude = Number(message.Latitude ?? message.latitude ?? metadata.latitude ?? metadata.Latitude);
  const longitude = Number(message.Longitude ?? message.longitude ?? metadata.longitude ?? metadata.Longitude);
  const hasPosition = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const shipName = String(metadata.ShipName ?? metadata.shipName ?? message.Name ?? message.name ?? '').trim() || null;

  return {
    mmsi: String(Math.trunc(mmsi)),
    message_type: String(messageType),
    ship_name: shipName,
    latitude: hasPosition ? latitude : null,
    longitude: hasPosition ? longitude : null,
    sog: Number.isFinite(Number(message.Sog ?? message.SOG ?? message.speedOverGround)) ? Number(message.Sog ?? message.SOG ?? message.speedOverGround) : null,
    cog: Number.isFinite(Number(message.Cog ?? message.COG ?? message.courseOverGround)) ? Number(message.Cog ?? message.COG ?? message.courseOverGround) : null,
    heading: Number.isFinite(Number(message.TrueHeading ?? message.trueHeading ?? message.Heading ?? message.heading)) ? Number(message.TrueHeading ?? message.trueHeading ?? message.Heading ?? message.heading) : null,
    nav_status: message.NavigationalStatus ?? message.navigationalStatus ?? null,
    updated_at: new Date().toISOString(),
    raw: payload
  };
}

function boundedPayload(payload) {
  const serialized = JSON.stringify(payload);
  return serialized.length > AIS_MAX_PAYLOAD_CHARS ? JSON.stringify({ truncated: true, message_type: payload?.MessageType || null }) : serialized;
}

// Live Worker mccluster already has Durable Objects of this class.
// Cloudflare error 10064 if this class is missing from the uploaded script.
// Do not rename. Do not delete. Do not delete-class.
//
// Spatial intelligence reuses this EXISTING class instead of creating a second
// Durable Object class. The geo AIS instance is isolated by idFromName while
// keeping the Worker/DO migration contract unchanged.
export class HereTenantAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.aisSocket = null;
    this.aisConnecting = null;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tenant_meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ais_vessels (
        mmsi TEXT PRIMARY KEY,
        ship_name TEXT,
        latitude REAL,
        longitude REAL,
        sog REAL,
        cog REAL,
        heading REAL,
        nav_status TEXT,
        message_type TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS ais_vessels_updated_idx ON ais_vessels(updated_at DESC)`);
  }

  /*
    Connection state must survive eviction.

    A Durable Object holding an OUTBOUND WebSocket cannot hibernate: if the
    object is evicted the socket dies with it, and the in-memory status goes
    with it. Persisting the state here is what lets a woken object tell the
    difference between "never started" and "was streaming a moment ago", and
    lets the backoff survive a crash loop instead of resetting to zero.
  */
  aisState() {
    const rows = this.ctx.storage.sql.exec(`SELECT k, v FROM tenant_meta WHERE k LIKE 'ais_%'`).toArray();
    const state = Object.fromEntries(rows.map((row) => [row.k.slice(4), row.v]));
    return {
      status: state.status || 'idle',
      error: state.error || null,
      connected_at: state.connected_at || null,
      last_message_at: state.last_message_at || null,
      failures: Number(state.failures || 0)
    };
  }

  setAisState(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      this.ctx.storage.sql.exec(
        `INSERT INTO tenant_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        `ais_${key}`,
        value === null ? '' : String(value)
      );
    }
  }

  backoffMs(failures) {
    const scaled = AIS_BACKOFF_MIN_MS * Math.pow(2, Math.max(0, failures - 1));
    return Math.min(AIS_BACKOFF_MAX_MS, scaled);
  }

  async armAlarm(delayMs) {
    try {
      const existing = await this.ctx.storage.getAlarm();
      const target = Date.now() + delayMs;
      if (existing && existing <= target) return;
      await this.ctx.storage.setAlarm(target);
    } catch {
      // An alarm we could not arm is retried on the next request.
    }
  }

  pruneAis() {
    const cutoff = new Date(Date.now() - AIS_ROW_TTL_MS).toISOString();
    this.ctx.storage.sql.exec(`DELETE FROM ais_vessels WHERE updated_at < ?`, cutoff);
    const count = Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ais_vessels`).toArray()[0]?.n || 0);
    if (count > AIS_MAX_ROWS) {
      this.ctx.storage.sql.exec(
        `DELETE FROM ais_vessels WHERE mmsi IN (SELECT mmsi FROM ais_vessels ORDER BY updated_at ASC LIMIT ?)`,
        count - AIS_MAX_ROWS
      );
    }
  }

  recordVessel(vessel) {
    const previous = this.ctx.storage.sql.exec(
      `SELECT ship_name, latitude, longitude, sog, cog, heading, nav_status FROM ais_vessels WHERE mmsi = ? LIMIT 1`,
      vessel.mmsi
    ).toArray()[0] || {};
    this.ctx.storage.sql.exec(
      `INSERT INTO ais_vessels (mmsi, ship_name, latitude, longitude, sog, cog, heading, nav_status, message_type, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mmsi) DO UPDATE SET
         ship_name = COALESCE(excluded.ship_name, ais_vessels.ship_name),
         latitude = COALESCE(excluded.latitude, ais_vessels.latitude),
         longitude = COALESCE(excluded.longitude, ais_vessels.longitude),
         sog = COALESCE(excluded.sog, ais_vessels.sog),
         cog = COALESCE(excluded.cog, ais_vessels.cog),
         heading = COALESCE(excluded.heading, ais_vessels.heading),
         nav_status = COALESCE(excluded.nav_status, ais_vessels.nav_status),
         message_type = excluded.message_type,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      vessel.mmsi,
      vessel.ship_name || previous.ship_name || null,
      vessel.latitude ?? previous.latitude ?? null,
      vessel.longitude ?? previous.longitude ?? null,
      vessel.sog ?? previous.sog ?? null,
      vessel.cog ?? previous.cog ?? null,
      vessel.heading ?? previous.heading ?? null,
      vessel.nav_status === null || vessel.nav_status === undefined ? (previous.nav_status ?? null) : String(vessel.nav_status),
      vessel.message_type,
      boundedPayload(vessel.raw),
      vessel.updated_at
    );
  }

  async ensureAis() {
    if (!this.env.AISSTREAM_API_KEY) {
      this.setAisState({ status: 'unconfigured', error: null });
      return false;
    }
    if (this.aisSocket) return true;
    if (this.aisConnecting) return this.aisConnecting;

    this.aisConnecting = (async () => {
      this.setAisState({ status: 'connecting', error: null });
      try {
        const response = await fetch(AIS_ENDPOINT, { headers: { Upgrade: 'websocket' } });
        const socket = response.webSocket;
        if (!socket) throw new Error(`AISStream rejected websocket upgrade (${response.status})`);
        socket.accept();
        this.aisSocket = socket;
        this.setAisState({
          status: 'open',
          error: null,
          connected_at: new Date().toISOString(),
          failures: 0
        });

        const boundingBoxes = parseJson(this.env.AISSTREAM_BOUNDING_BOXES, AIS_DEFAULT_BOXES);
        const messageTypes = parseMessageTypes(this.env.AISSTREAM_MESSAGE_TYPES);
        // The key goes up the socket and is never stored, echoed, or logged.
        socket.send(JSON.stringify({
          APIKey: this.env.AISSTREAM_API_KEY,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: messageTypes
        }));

        let sinceLastPrune = 0;
        socket.addEventListener('message', (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}'));
            // AISStream reports subscription problems in-band rather than by
            // closing, so an error frame has to fail the connection itself.
            if (payload?.error || payload?.Error) {
              const message = String(payload.error || payload.Error).slice(0, 300);
              this.setAisState({ status: /api key|auth|invalid/i.test(message) ? 'auth-failed' : 'error', error: message });
              try { socket.close(1011, 'aisstream error frame'); } catch { /* already closing */ }
              return;
            }
            const vessel = vesselFromMessage(payload);
            if (!vessel) return;
            this.recordVessel(vessel);
            this.setAisState({ last_message_at: vessel.updated_at, status: 'open' });
            sinceLastPrune += 1;
            if (sinceLastPrune >= 500) {
              sinceLastPrune = 0;
              this.pruneAis();
            }
          } catch {
            // One malformed AIS frame must never kill the feed.
          }
        });

        const recycle = (status, error = null) => {
          if (this.aisSocket !== socket) return;
          this.aisSocket = null;
          const failures = this.aisState().failures + 1;
          const current = this.aisState().status;
          this.setAisState({
            status: current === 'auth-failed' ? 'auth-failed' : status,
            error: error ? String(error).slice(0, 300) : this.aisState().error,
            failures
          });
          void this.armAlarm(this.backoffMs(failures));
        };
        socket.addEventListener('close', () => { recycle('closed'); });
        socket.addEventListener('error', () => { recycle('error', 'AISStream websocket error'); });

        await this.armAlarm(AIS_HEARTBEAT_MS);
        return true;
      } catch (error) {
        this.aisSocket = null;
        const message = String(error?.message || error);
        const failures = this.aisState().failures + 1;
        this.setAisState({
          status: /401|403|auth/i.test(message) ? 'auth-failed' : 'error',
          error: message.slice(0, 300),
          failures
        });
        await this.armAlarm(this.backoffMs(failures));
        return false;
      } finally {
        this.aisConnecting = null;
      }
    })();
    return this.aisConnecting;
  }

  /*
    The heartbeat. Because the socket cannot outlive an eviction, the alarm is
    what makes the stream persistent rather than merely long-lived: it wakes the
    object, reconnects if the socket is gone, prunes, and re-arms itself.
  */
  async alarm() {
    if (!this.env.AISSTREAM_API_KEY) {
      this.setAisState({ status: 'unconfigured' });
      return;
    }
    this.pruneAis();
    if (!this.aisSocket) await this.ensureAis();
    const { status, failures } = this.aisState();
    await this.armAlarm(status === 'auth-failed' ? AIS_BACKOFF_MAX_MS : Math.max(AIS_HEARTBEAT_MS, this.backoffMs(failures)));
  }

  aisSnapshot({ limit = 1000, bbox = null } = {}) {
    const clauses = ['latitude IS NOT NULL', 'longitude IS NOT NULL'];
    const args = [];
    if (bbox) {
      clauses.push('longitude >= ?', 'latitude >= ?', 'longitude <= ?', 'latitude <= ?');
      args.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    }
    const capped = Math.max(1, Math.min(Number(limit) || 1000, AIS_MAX_ROWS));
    const rows = this.ctx.storage.sql.exec(
      `SELECT mmsi, ship_name, latitude, longitude, sog, cog, heading, nav_status, message_type, updated_at
         FROM ais_vessels
        WHERE ${clauses.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT ?`,
      ...args,
      capped
    ).toArray();

    const state = this.aisState();
    const total = Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ais_vessels`).toArray()[0]?.n || 0);
    const lastMs = state.last_message_at ? Date.parse(state.last_message_at) : 0;
    const stale = Boolean(lastMs && Date.now() - lastMs > AIS_STALE_MS);

    return {
      configured: Boolean(this.env.AISSTREAM_API_KEY),
      status: stale && state.status === 'open' ? 'stale' : state.status,
      stale,
      error: state.error || null,
      failures: state.failures,
      connected_at: state.connected_at || null,
      last_message_at: state.last_message_at || null,
      cached_vessels: total,
      returned: rows.length,
      row_ttl_seconds: AIS_ROW_TTL_MS / 1000,
      rows
    };
  }

  async fetch(request) {
    const now = new Date().toISOString();
    const url = new URL(request.url);

    if (url.pathname === '/internal/geo/ais/snapshot' && request.method === 'GET') {
      if (this.env.AISSTREAM_API_KEY && !this.aisSocket) {
        this.ctx.waitUntil(this.ensureAis());
      }
      const bboxParam = url.searchParams.get('bbox');
      const bbox = bboxParam ? bboxParam.split(',').map(Number) : null;
      return Response.json(this.aisSnapshot({
        limit: url.searchParams.get('limit'),
        bbox: bbox && bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null
      }));
    }

    if (url.pathname === '/internal/geo/ais/restart' && request.method === 'POST') {
      try { this.aisSocket?.close(1000, 'operator restart'); } catch { /* already closed */ }
      this.aisSocket = null;
      this.setAisState({ status: 'idle', error: null, failures: 0 });
      await this.ensureAis();
      return Response.json(this.aisSnapshot({ limit: 1 }));
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('last_seen', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      now
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('last_path', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      url.pathname
    );
    const existing = this.ctx.storage.sql.exec(`SELECT v FROM tenant_meta WHERE k = 'hits'`).toArray();
    const hits = Number(existing[0]?.v || 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('hits', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      String(hits)
    );
    return Response.json({
      ok: true,
      service: "here-tenant-agent",
      worker: "mccluster",
      stub: false,
      last_seen: now,
      hits
    });
  }
}
