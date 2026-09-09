import { DurableObject } from "cloudflare:workers";

// Live Worker mccluster already has Durable Objects of this class.
// Cloudflare error 10064 if this class is missing from the uploaded script.
// Do not rename. Do not delete. Do not delete-class.
export class HereTenantAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tenant_meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      )
    `);
  }

  async fetch(request) {
    const now = new Date().toISOString();
    const url = new URL(request.url);
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
