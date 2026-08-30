import type {
  AIProvider, AIRequest, AIResponse, ModelTier, StreamHandlers,
} from "../types.js";

/* Deterministic provider for tests and offline development.
   Tests must never contact a paid API — this is how. */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  constructor(
    private opts: {
      reply?: (req: AIRequest) => string;
      failTimes?: number;      // fail the first N calls (retry/breaker tests)
      latencyMs?: number;
    } = {},
  ) {}
  private calls = 0;

  modelFor(tier: ModelTier): string { return `mock-${tier}`; }

  async generate(req: AIRequest): Promise<AIResponse> {
    this.calls += 1;
    if (this.opts.failTimes && this.calls <= this.opts.failTimes) {
      throw new Error(`mock transient failure ${this.calls}`);
    }
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const text = this.opts.reply
      ? this.opts.reply(req)
      : `mock:${req.purpose}:${req.messages[req.messages.length - 1]?.content ?? ""}`;
    return {
      text,
      provider: this.name,
      model: this.modelFor(req.model ?? "default"),
      inputTokens: req.messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0),
      outputTokens: Math.ceil(text.length / 4),
      cachedTokens: 0,
      latencyMs: this.opts.latencyMs ?? 1,
      requestId: req.requestId,
    };
  }

  async stream(req: AIRequest, handlers: StreamHandlers): Promise<void> {
    try {
      const res = await this.generate(req);
      for (const word of res.text.split(" ")) handlers.onToken(word + " ");
      handlers.onDone(res);
    } catch (err) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
