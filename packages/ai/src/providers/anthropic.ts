import type {
  AIProvider, AIRequest, AIResponse, ModelTier, StreamHandlers,
} from "../types.js";

/* Anthropic adapter — server-side only, same rules as every provider:
   key from the environment, models from configuration, imported by
   nothing outside this package. */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  constructor(
    private apiKey: string,
    private models: Record<ModelTier, string>,
    private baseUrl = "https://api.anthropic.com/v1",
  ) {
    if (!apiKey) throw new Error("AnthropicProvider requires an API key (server-side env)");
  }

  modelFor(tier: ModelTier): string { return this.models[tier]; }

  async generate(req: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const messages = req.messages.filter((m) => m.role !== "system");
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelFor(req.model ?? "default"),
        max_tokens: req.maxOutputTokens ?? 2048,
        ...(system ? { system } : {}),
        messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
    };
    return {
      text: j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
      provider: this.name,
      model: j.model,
      inputTokens: j.usage.input_tokens,
      outputTokens: j.usage.output_tokens,
      cachedTokens: j.usage.cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - started,
      requestId: req.requestId,
    };
  }

  async stream(req: AIRequest, handlers: StreamHandlers): Promise<void> {
    try {
      const res = await this.generate(req);
      handlers.onToken(res.text);
      handlers.onDone(res);
    } catch (err) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
