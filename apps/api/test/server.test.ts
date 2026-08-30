import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig({ NODE_ENV: "test", APP_ENV: "local" } as NodeJS.ProcessEnv);

describe("api service", () => {
  it("answers the health check", async () => {
    const app = buildServer(cfg);
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it("serves versioned status", async () => {
    const app = buildServer(cfg);
    const res = await app.inject({ method: "GET", url: "/api/v1/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "here-api", version: "v1" });
    expect(res.headers["x-app-env"]).toBe("local");
    await app.close();
  });

  it("refuses a production boot without required secrets", () => {
    expect(() =>
      loadConfig({ APP_ENV: "production" } as NodeJS.ProcessEnv)
    ).toThrow(/Production requires/);
  });
});
