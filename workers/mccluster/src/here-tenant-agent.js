import { DurableObject } from "cloudflare:workers";

// Live Worker mccluster already has Durable Objects of this class.
// Cloudflare error 10064 if this class is missing from the uploaded script.
// Do not rename. Do not delete. Do not delete-class.
export class HereTenantAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch() {
    return Response.json({
      ok: true,
      service: "here-tenant-agent",
      worker: "mccluster",
      stub: true
    });
  }
}
