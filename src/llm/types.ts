import type { NormalizedProduct } from "../domain/product";

export interface LlmJsonRequest {
  system: string;
  prompt: string;
  schema: unknown;
  /** Контекст для mock-провайдера и логирования; Gemini его не получает. */
  context?: {
    product: NormalizedProduct;
  };
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmJsonResponse {
  text: string;
  model: string;
  usage?: LlmUsage;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse>;
}
