import type {
  AIProvider, AIRequest, AIResponse, EmbeddingRequest, EmbeddingResponse,
  ModelTier, StreamHandlers,
} from "../types.js";

/* OpenAI adapter — server-side only. The key comes from the
   environment at construction; nothing in this file may be imported
   by client code. Model ids are configuration, not hardcoded product
   names scattered through the app. */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  constructor(
    private apiKey: string,
    private models: Record<ModelTier, string>,
    private baseUrl = "https://api.openai.com/v1",
  ) {
    if (!apiKey) throw new Error("OpenAIProvider requires an API key (server-side env)");
  }

  modelFor(tier: ModelTier): string { return this.models[tier]; }

  async generate(req: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.modelFor(req.model ?? "default"),
        messages: req.messages,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        ...(req.jsonSchema ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    return {
      text: j.choices[0]?.message.content ?? "",
      provider: this.name,
      model: j.model,
      inputTokens: j.usage.prompt_tokens,
      outputTokens: j.usage.completion_tokens,
      cachedTokens: j.usage.prompt_tokens_details?.cached_tokens ?? 0,
      latencyMs: Date.now() - started,
      requestId: req.requestId,
    };
  }

  async stream(req: AIRequest, handlers: StreamHandlers): Promise<void> {
    /* Streaming lands with the first user-facing chat surface; until
       then a buffered response keeps the contract honest. */
    try {
      const res = await this.generate(req);
      handlers.onToken(res.text);
      handlers.onDone(res);
    } catch (err) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: req.input }),
    });
    if (!res.ok) throw new Error(`openai embeddings ${res.status}`);
    const j = (await res.json()) as { data: Array<{ embedding: number[] }>; model: string };
    return { vectors: j.data.map((d) => d.embedding), provider: this.name, model: j.model };
  }
}
