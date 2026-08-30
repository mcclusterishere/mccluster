import { z } from "zod";

/* Every variable the service reads, declared once and validated at
   boot — a missing production secret fails the deploy, not a request
   three days later. Server-side only: none of these ever reach a
   client bundle. */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(8080),
  ALLOWED_ORIGINS: z.string().default("https://matthew.mccluster.org"),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  STRIPE_SK: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  /* HERE 3D Asset Lab. Keep provider credentials server-side only. */
  TRIPO_API_KEY: z.string().optional(),
  TRIPO_BASE_URL: z.string().url().default("https://api.tripo3d.ai/v2/openapi"),
  ASSET_LAB_TOKEN: z.string().min(16).optional(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.APP_ENV === "production") {
    /* production refuses to boot half-configured */
    const required: Array<keyof Config> = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
    const missing = required.filter((k) => !cfg[k]);
    if (missing.length) throw new Error(`Production requires: ${missing.join(", ")}`);
  }
  return cfg;
}
