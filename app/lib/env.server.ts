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
  SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(50),
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
