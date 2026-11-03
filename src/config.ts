import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(["gemini", "mock"]).default("gemini"),
  GEMINI_API_KEY: z.string().trim().optional(),
  // Google AI Studio examples часто используют GOOGLE_API_KEY.
  GOOGLE_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.8-flash"),
  GEMINI_API_BASE: z
    .string()
    .trim()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta"),
  PORT: z.coerce.number().int().positive().default(3000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(65_536).default(4_096),
});

export type LlmProvider = "gemini" | "mock";

export interface AppConfig {
  provider: LlmProvider;
  geminiApiKey?: string;
  geminiModel: string;
  geminiApiBase: string;
  port: number;
  requestTimeoutMs: number;
  maxRetries: number;
  temperature: number;
  maxOutputTokens: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Некорректная конфигурация окружения: ${details}`);
  }

  const value = parsed.data;

  return {
    provider: value.LLM_PROVIDER,
    geminiApiKey: value.GEMINI_API_KEY || value.GOOGLE_API_KEY || undefined,
    geminiModel: value.GEMINI_MODEL,
    geminiApiBase: value.GEMINI_API_BASE.replace(/\/+$/, ""),
    port: value.PORT,
    requestTimeoutMs: value.REQUEST_TIMEOUT_MS,
    maxRetries: value.MAX_RETRIES,
    temperature: value.TEMPERATURE,
    maxOutputTokens: value.MAX_OUTPUT_TOKENS,
  };
}

export const config = loadConfig();
