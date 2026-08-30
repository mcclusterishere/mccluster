import type {
  AIProvider, AIRequest, AIResponse, AIServiceConfig, AIUsageRecord, UsageSink,
} from "./types.js";

/* AIService — the only door the application knocks on.
   Every request walks the brief's corridor in order:
   policy → budget → route → timeout → retry/backoff → circuit
   breaker → fallback provider → usage row. */

export class BudgetExceededError extends Error {
  constructor(scope: "user" | "platform") { super(`AI budget exceeded (${scope})`); }
}
export class AllProvidersFailedError extends Error {
  constructor(public causes: Error[]) { super("All AI providers failed"); }
}

interface Breaker { failures: number; openedAt: number | null; }

export class AIService {
  private breakers = new Map<string, Breaker>();

  constructor(
    private providers: Map<string, AIProvider>,
    private cfg: AIServiceConfig,
    private usage: UsageSink,
    private now: () => number = Date.now,
  ) {}

  async generate(req: AIRequest): Promise<AIResponse> {
    /* budgets before any vendor is touched */
    const [userSpend, platformSpend] = await Promise.all([
      this.usage.userSpendTodayUsd(req.userId),
      this.usage.platformSpendThisMonthUsd(),
    ]);
    if (platformSpend >= this.cfg.monthlyPlatformBudgetUsd) {
      await this.record(req, null, 0, "budget_denied", "platform_budget");
      throw new BudgetExceededError("platform");
    }
    if (userSpend >= this.cfg.dailyUserBudgetUsd) {
      await this.record(req, null, 0, "budget_denied", "user_budget");
      throw new BudgetExceededError("user");
    }

    const order = [this.cfg.primaryProvider, this.cfg.fallbackProvider]
      .filter((n): n is string => !!n && this.providers.has(n));
    const causes: Error[] = [];

    for (const name of order) {
      if (this.circuitOpen(name)) { causes.push(new Error(`${name}: circuit open`)); continue; }
      const provider = this.providers.get(name)!;
      const started = this.now();
      try {
        const res = await this.attempt(provider, req);
        this.closeCircuit(name);
        await this.record(req, res, this.now() - started, "ok");
        return res;
      } catch (err) {
        this.tripCircuit(name);
        causes.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    await this.record(req, null, 0, "error", "all_providers_failed");
    throw new AllProvidersFailedError(causes);
  }

  /* retry with exponential backoff inside one provider; a request that
     failed validation is not retried (unsafe/invalid ≠ transient) */
  private async attempt(provider: AIProvider, req: AIRequest): Promise<AIResponse> {
    const capped: AIRequest = {
      ...req,
      maxOutputTokens: Math.min(req.maxOutputTokens ?? this.cfg.maxOutputTokens, this.cfg.maxOutputTokens),
    };
    let lastErr: Error | null = null;
    for (let i = 0; i <= this.cfg.maxRetries; i++) {
      try {
        return await this.withTimeout(provider.generate(capped), this.cfg.timeoutMs);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (/invalid|schema|policy/i.test(lastErr.message)) throw lastErr; // never retry bad requests
        if (i < this.cfg.maxRetries) await sleep(2 ** i * 250);
      }
    }
    throw lastErr ?? new Error("unreachable");
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  private breaker(name: string): Breaker {
    let b = this.breakers.get(name);
    if (!b) { b = { failures: 0, openedAt: null }; this.breakers.set(name, b); }
    return b;
  }
  private circuitOpen(name: string): boolean {
    const b = this.breaker(name);
    if (b.openedAt === null) return false;
    if (this.now() - b.openedAt >= this.cfg.breakerCooldownMs) { b.openedAt = null; b.failures = 0; return false; } // half-open
    return true;
  }
  private tripCircuit(name: string): void {
    const b = this.breaker(name);
    b.failures += 1;
    if (b.failures >= this.cfg.breakerThreshold) b.openedAt = this.now();
  }
  private closeCircuit(name: string): void {
    this.breakers.set(name, { failures: 0, openedAt: null });
  }

  private estimateCost(res: AIResponse | null): number {
    if (!res) return 0;
    const { input, output } = this.cfg.costPerMTokUsd;
    return (res.inputTokens / 1e6) * input + (res.outputTokens / 1e6) * output;
  }

  private async record(
    req: AIRequest, res: AIResponse | null, latencyMs: number,
    status: AIUsageRecord["status"], errorCode?: string,
  ): Promise<void> {
    const row: AIUsageRecord = {
      requestId: req.requestId,
      userId: req.userId,
      provider: res?.provider ?? "",
      model: res?.model ?? "",
      promptVersion: req.promptVersion,
      purpose: req.purpose,
      inputTokens: res?.inputTokens ?? 0,
      cachedTokens: res?.cachedTokens ?? 0,
      outputTokens: res?.outputTokens ?? 0,
      estimatedCostUsd: this.estimateCost(res),
      latencyMs: res?.latencyMs ?? latencyMs,
      status,
      createdAt: new Date(this.now()).toISOString(),
    };
    if (req.threadId !== undefined) row.threadId = req.threadId;
    if (errorCode !== undefined) row.errorCode = errorCode;
    await this.usage.record(row);
  }
}

/* In-memory sink — tests and local dev. Production implements
   UsageSink over the ai_usage table. */
export class MemoryUsageSink implements UsageSink {
  rows: AIUsageRecord[] = [];
  async record(row: AIUsageRecord): Promise<void> { this.rows.push(row); }
  async userSpendTodayUsd(userId: string): Promise<number> {
    return this.rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.estimatedCostUsd, 0);
  }
  async platformSpendThisMonthUsd(): Promise<number> {
    return this.rows.reduce((s, r) => s + r.estimatedCostUsd, 0);
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AIServiceConfig {
  return {
    primaryProvider: env.AI_PRIMARY_PROVIDER ?? "mock",
    ...(env.AI_FALLBACK_PROVIDER ? { fallbackProvider: env.AI_FALLBACK_PROVIDER } : {}),
    maxOutputTokens: Number(env.AI_MAX_OUTPUT_TOKENS ?? 2048),
    dailyUserBudgetUsd: Number(env.AI_DAILY_USER_BUDGET ?? 1),
    monthlyPlatformBudgetUsd: Number(env.AI_MONTHLY_PLATFORM_BUDGET ?? 200),
    timeoutMs: Number(env.AI_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(env.AI_MAX_RETRIES ?? 2),
    breakerThreshold: Number(env.AI_BREAKER_THRESHOLD ?? 3),
    breakerCooldownMs: Number(env.AI_BREAKER_COOLDOWN_MS ?? 60_000),
    costPerMTokUsd: { input: 3, output: 15 },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
