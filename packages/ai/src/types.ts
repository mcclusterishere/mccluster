/* The contract every model vendor is hidden behind. The application
   talks only to AIService; providers are adapters; swapping vendors
   is configuration, never a refactor or an app-store release. */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIRequest {
  /* who and what — required for policy, budgets, and audit */
  userId: string;
  threadId?: string;
  requestId: string;
  purpose: string;             // e.g. "study-companion", "support-triage"
  promptVersion: string;       // prompts are versioned artifacts
  messages: AIMessage[];
  model?: ModelTier;           // tier, not vendor model id
  maxOutputTokens?: number;
  temperature?: number;
  jsonSchema?: object;         // structured output: validated post-hoc
}

export type ModelTier = "default" | "fast" | "reasoning";

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  requestId: string;
}

export interface StreamHandlers {
  onToken(token: string): void;
  onDone(final: AIResponse): void;
  onError(err: Error): void;
}

export interface EmbeddingRequest {
  userId: string;
  requestId: string;
  input: string[];
}
export interface EmbeddingResponse {
  vectors: number[][];
  provider: string;
  model: string;
}

export interface ModerationRequest {
  requestId: string;
  input: string;
}
export interface ModerationResponse {
  flagged: boolean;
  categories: string[];
}

export interface AIProvider {
  readonly name: string;
  /** vendor model id for a tier */
  modelFor(tier: ModelTier): string;
  generate(request: AIRequest): Promise<AIResponse>;
  stream(request: AIRequest, handlers: StreamHandlers): Promise<void>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  moderate?(request: ModerationRequest): Promise<ModerationResponse>;
}

/* one row per request — the audit trail §11 requires.
   Never contains hidden chain-of-thought; we neither request nor
   store it. Never contains prayer entries or note bodies. */
export interface AIUsageRecord {
  requestId: string;
  userId: string;
  threadId?: string;
  provider: string;
  model: string;
  promptVersion: string;
  purpose: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: "ok" | "error" | "budget_denied" | "policy_denied";
  errorCode?: string;
  createdAt: string;
}

export interface UsageSink {
  record(row: AIUsageRecord): Promise<void>;
  /** spend so far, for budget checks */
  userSpendTodayUsd(userId: string): Promise<number>;
  platformSpendThisMonthUsd(): Promise<number>;
}

export interface AIServiceConfig {
  primaryProvider: string;          // AI_PRIMARY_PROVIDER
  fallbackProvider?: string;        // AI_FALLBACK_PROVIDER
  maxOutputTokens: number;          // AI_MAX_OUTPUT_TOKENS
  dailyUserBudgetUsd: number;       // AI_DAILY_USER_BUDGET
  monthlyPlatformBudgetUsd: number; // AI_MONTHLY_PLATFORM_BUDGET
  timeoutMs: number;
  maxRetries: number;
  breakerThreshold: number;         // consecutive failures to open the circuit
  breakerCooldownMs: number;
  costPerMTokUsd: { input: number; output: number }; // rough estimator; refined per model later
}
