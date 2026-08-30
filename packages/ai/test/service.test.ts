import { describe, it, expect } from "vitest";
import { AIService, MemoryUsageSink, BudgetExceededError, AllProvidersFailedError } from "../src/service.js";
import { MockAIProvider } from "../src/providers/mock.js";
import type { AIProvider, AIRequest, AIServiceConfig } from "../src/types.js";

function cfg(over: Partial<AIServiceConfig> = {}): AIServiceConfig {
  return {
    primaryProvider: "mock",
    maxOutputTokens: 512,
    dailyUserBudgetUsd: 1,
    monthlyPlatformBudgetUsd: 100,
    timeoutMs: 2_000,
    maxRetries: 2,
    breakerThreshold: 3,
    breakerCooldownMs: 60_000,
    costPerMTokUsd: { input: 3, output: 15 },
    ...over,
  };
}
function req(over: Partial<AIRequest> = {}): AIRequest {
  return {
    userId: "u1",
    requestId: "r-" + Math.random().toString(36).slice(2),
    purpose: "test",
    promptVersion: "v1",
    messages: [{ role: "user", content: "hello" }],
    ...over,
  };
}
const providers = (...ps: AIProvider[]) => new Map(ps.map((p) => [p.name, p]));

describe("AIService", () => {
  it("routes to the primary provider and records usage", async () => {
    const sink = new MemoryUsageSink();
    const svc = new AIService(providers(new MockAIProvider()), cfg(), sink);
    const res = await svc.generate(req());
    expect(res.provider).toBe("mock");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]).toMatchObject({ status: "ok", purpose: "test", promptVersion: "v1" });
  });

  it("retries transient failures with backoff", async () => {
    const svc = new AIService(
      providers(new MockAIProvider({ failTimes: 2 })), cfg(), new MemoryUsageSink());
    const res = await svc.generate(req());
    expect(res.text).toContain("mock:test");
  });

  it("falls back to the secondary provider when the primary dies", async () => {
    const dead: AIProvider = {
      name: "dead",
      modelFor: () => "dead",
      generate: async () => { throw new Error("hard down"); },
      stream: async () => { throw new Error("hard down"); },
    };
    const svc = new AIService(
      providers(dead, new MockAIProvider()),
      cfg({ primaryProvider: "dead", fallbackProvider: "mock", maxRetries: 0 }),
      new MemoryUsageSink());
    const res = await svc.generate(req());
    expect(res.provider).toBe("mock");
  });

  it("denies when the user budget is spent", async () => {
    const sink = new MemoryUsageSink();
    sink.rows.push({
      requestId: "old", userId: "u1", provider: "mock", model: "m", promptVersion: "v1",
      purpose: "test", inputTokens: 0, cachedTokens: 0, outputTokens: 0,
      estimatedCostUsd: 5, latencyMs: 1, status: "ok", createdAt: new Date().toISOString(),
    });
    const svc = new AIService(providers(new MockAIProvider()), cfg({ dailyUserBudgetUsd: 1 }), sink);
    await expect(svc.generate(req())).rejects.toThrow(BudgetExceededError);
    expect(sink.rows.at(-1)?.status).toBe("budget_denied");
  });

  it("opens the circuit after repeated failures and reports total loss", async () => {
    const always: AIProvider = {
      name: "flaky",
      modelFor: () => "flaky",
      generate: async () => { throw new Error("boom"); },
      stream: async () => { throw new Error("boom"); },
    };
    const c = cfg({ primaryProvider: "flaky", maxRetries: 0, breakerThreshold: 2 });
    const svc = new AIService(providers(always), c, new MemoryUsageSink());
    await expect(svc.generate(req())).rejects.toThrow(AllProvidersFailedError);
    await expect(svc.generate(req())).rejects.toThrow(AllProvidersFailedError);
    // breaker now open: the provider isn't even attempted
    const e = await svc.generate(req()).catch((x) => x as AllProvidersFailedError);
    expect(e).toBeInstanceOf(AllProvidersFailedError);
    expect(String(e.causes[0])).toContain("circuit open");
  });

  it("never retries an invalid request", async () => {
    let calls = 0;
    const invalid: AIProvider = {
      name: "strict",
      modelFor: () => "strict",
      generate: async () => { calls += 1; throw new Error("invalid request: schema mismatch"); },
      stream: async () => { throw new Error("invalid"); },
    };
    const svc = new AIService(
      providers(invalid), cfg({ primaryProvider: "strict", maxRetries: 3 }), new MemoryUsageSink());
    await expect(svc.generate(req())).rejects.toThrow(AllProvidersFailedError);
    expect(calls).toBe(1);
  });

  it("caps output tokens at the platform maximum", async () => {
    let seen = 0;
    const svc = new AIService(
      providers(new MockAIProvider({ reply: () => "ok" })),
      cfg({ maxOutputTokens: 100 }), new MemoryUsageSink());
    const probe: AIProvider = {
      name: "probe",
      modelFor: () => "p",
      generate: async (r) => { seen = r.maxOutputTokens ?? 0; return new MockAIProvider().generate(r); },
      stream: async () => {},
    };
    const svc2 = new AIService(providers(probe), cfg({ primaryProvider: "probe", maxOutputTokens: 100 }), new MemoryUsageSink());
    await svc2.generate(req({ maxOutputTokens: 9999 }));
    expect(seen).toBe(100);
    void svc;
  });
});
