import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type Config } from "./config.js";
import { registerThreeDRoutes } from "./three-d/routes.js";

export const API_VERSION = "v1";

function allowedOrigins(cfg: Config): Set<string> {
  return new Set(
    cfg.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function buildServer(cfg: Config = loadConfig()): FastifyInstance {
  const app = Fastify({
    logger: cfg.NODE_ENV !== "test",
    /* Stripe webhook signatures need the raw body; keep the door open
       for a raw-body content-type parser on the webhook routes.
       Asset Lab accepts reference images as base64 data URLs, so allow
       enough room for a 20 MB provider upload plus encoding overhead. */
    bodyLimit: 28 * 1024 * 1024,
  });

  const corsOrigins = allowedOrigins(cfg);

  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "Content-Type,X-Asset-Lab-Token");
      reply.header("access-control-max-age", "86400");
    }

    if (req.method === "OPTIONS") {
      if (!origin || !corsOrigins.has(origin)) {
        return reply.code(403).send({ ok: false, error: "Origin not allowed" });
      }
      return reply.code(204).send();
    }
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-app-env", cfg.APP_ENV);
  });

  /* the platform's pulse — Railway health checks hit this */
  app.get("/healthz", async () => ({ ok: true, env: cfg.APP_ENV }));

  app.get(`/api/${API_VERSION}/status`, async () => ({
    service: "here-api",
    version: API_VERSION,
    env: cfg.APP_ENV,
    time: new Date().toISOString(),
  }));

  /* Provider-neutral 3D generation starts with Tripo. Provider secrets
     remain server-side; the browser receives task state and output URLs. */
  registerThreeDRoutes(app, cfg, API_VERSION);

  /* Webhook routes land here in Phase 3 with raw-body signature
     verification, event persistence, immediate ack, async processing:
       POST /api/v1/webhooks/stripe
       POST /api/v1/webhooks/shopify
     No fulfillment logic ever runs inside the webhook request. */

  return app;
}
