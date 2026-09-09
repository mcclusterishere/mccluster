import { DurableObject } from "cloudflare:workers";

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
    this.aisStatus = 'idle';
    this.aisError = null;
    this.aisConnectedAt = null;
    this.aisLastMessageAt = null;
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

  async ensureAis() {
    if (!this.env.AISSTREAM_API_KEY) {
      this.aisStatus = 'unconfigured';
      return false;
    }
    if (this.aisSocket && ['open', 'connecting'].includes(this.aisStatus)) return true;
    if (this.aisConnecting) return this.aisConnecting;

    this.aisConnecting = (async () => {
      this.aisStatus = 'connecting';
      this.aisError = null;
      try {
        const response = await fetch('https://stream.aisstream.io/v0/stream', {
          headers: { Upgrade: 'websocket' }
        });
        const socket = response.webSocket;
        if (!socket) throw new Error(`AISStream rejected websocket upgrade (${response.status})`);
        socket.accept();
        this.aisSocket = socket;
        this.aisStatus = 'open';
        this.aisConnectedAt = new Date().toISOString();

        const boundingBoxes = parseJson(this.env.AISSTREAM_BOUNDING_BOXES, AIS_DEFAULT_BOXES);
        const messageTypes = parseMessageTypes(this.env.AISSTREAM_MESSAGE_TYPES);
        socket.send(JSON.stringify({
          APIKey: this.env.AISSTREAM_API_KEY,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: messageTypes
        }));

        socket.addEventListener('message', (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}'));
            const vessel = vesselFromMessage(payload);
            if (!vessel) return;
            this.aisLastMessageAt = vessel.updated_at;
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
              JSON.stringify(vessel.raw),
              vessel.updated_at
            );

            const count = Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ais_vessels`).toArray()[0]?.n || 0);
            if (count > AIS_MAX_ROWS) {
              const overflow = count - AIS_MAX_ROWS;
              this.ctx.storage.sql.exec(
                `DELETE FROM ais_vessels WHERE mmsi IN (SELECT mmsi FROM ais_vessels ORDER BY updated_at ASC LIMIT ?)`,
                overflow
              );
            }
          } catch {
            // One malformed AIS frame must never kill the feed.
          }
        });

        const recycle = async (status, error = null) => {
          if (this.aisSocket !== socket) return;
          this.aisSocket = null;
          this.aisStatus = status;
          this.aisError = error ? String(error).slice(0, 300) : null;
          await this.ctx.storage.setAlarm(Date.now() + 30000).catch(() => {});
        };
        socket.addEventListener('close', () => { void recycle('closed'); });
        socket.addEventListener('error', () => { void recycle('error', 'AISStream websocket error'); });
        return true;
      } catch (error) {
        this.aisSocket = null;
        this.aisStatus = /401|403|auth/i.test(String(error?.message || error)) ? 'auth-failed' : 'error';
        this.aisError = String(error?.message || error).slice(0, 300);
        await this.ctx.storage.setAlarm(Date.now() + 60000).catch(() => {});
        return false;
      } finally {
        this.aisConnecting = null;
      }
    })();
    return this.aisConnecting;
  }

  async alarm() {
    if (this.env.AISSTREAM_API_KEY) await this.ensureAis();
  }

  aisSnapshot() {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec(
      `SELECT mmsi, ship_name, latitude, longitude, sog, cog, heading, nav_status, message_type, updated_at
         FROM ais_vessels
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT ?`,
      AIS_MAX_ROWS
    ).toArray();
    const lastMs = this.aisLastMessageAt ? Date.parse(this.aisLastMessageAt) : 0;
    const stale = Boolean(lastMs && now - lastMs > AIS_STALE_MS);
    return {
      configured: Boolean(this.env.AISSTREAM_API_KEY),
      status: stale && this.aisStatus === 'open' ? 'stale' : this.aisStatus,
      error: this.aisError,
      connected_at: this.aisConnectedAt,
      last_message_at: this.aisLastMessageAt,
      rows
    };
  }

  async fetch(request) {
    const now = new Date().toISOString();
    const url = new URL(request.url);

    if (url.pathname === '/internal/geo/ais/snapshot' && request.method === 'GET') {
      if (this.env.AISSTREAM_API_KEY && !['open', 'connecting'].includes(this.aisStatus)) {
        this.ctx.waitUntil(this.ensureAis());
      }
      return Response.json(this.aisSnapshot());
    }

    if (url.pathname === '/internal/geo/ais/restart' && request.method === 'POST') {
      try { this.aisSocket?.close(1000, 'operator restart'); } catch {}
      this.aisSocket = null;
      this.aisStatus = 'idle';
      await this.ensureAis();
      return Response.json(this.aisSnapshot());
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
