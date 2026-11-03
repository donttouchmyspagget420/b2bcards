import type { AppConfig } from "../config";
import { AppError } from "../errors";
import { GeminiClient } from "./gemini";
import { MockLlmClient } from "./mock";
import type { LlmClient } from "./types";

export function createLlmClient(
  config: AppConfig,
  options: { fetchImpl?: typeof fetch } = {},
): LlmClient {
  if (config.provider === "mock") {
    return new MockLlmClient();
  }

  if (!config.geminiApiKey) {
    throw new AppError(
      "GEMINI_API_KEY не задан. Добавьте ключ Google AI Studio в .env или включите LLM_PROVIDER=mock.",
      { statusCode: 503, code: "LLM_CONFIG" },
    );
  }

  return new GeminiClient({ ...config, fetchImpl: options.fetchImpl });
}
