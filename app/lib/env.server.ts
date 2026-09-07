import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  
  SHOPIFY_API_KEY: z.string().min(1, "SHOPIFY_API_KEY (client id) is required"),
  SHOPIFY_API_SECRET: z
    .string()
    .min(1, "SHOPIFY_API_SECRET (client secret) is required"),
  SHOPIFY_APP_URL: z.string().min(1, "SHOPIFY_APP_URL is required"),
  SCOPES: z.string().default("read_products"),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => v.startsWith("postgres"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    }),

  // App
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(25),

  // Embedding — vector 768 chiều.
  EMBEDDING_PROVIDER: z.enum(["fake", "gemini", "ollama"]).default("fake"),
  EMBEDDING_DIMENSION: z.coerce
    .number()
    .int()
    .refine((value) => value === 768, "EMBEDDING_DIMENSION must be 768")
    .default(768),
  EMBEDDING_VERSION: z.coerce.number().int().min(1).default(1),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  EMBEDDING_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(5),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("bge-m3"),
  EVAL_SHOP_DOMAIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;


export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(
      `\n${lines.join("\n")}\n`,
    );
  }
  return result.data;
}

let cached: Env | undefined;


export function getEnv(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}
