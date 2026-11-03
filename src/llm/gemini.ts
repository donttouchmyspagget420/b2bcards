import { AppError } from "../errors";
import type { AppConfig } from "../config";
import type { LlmClient, LlmJsonRequest, LlmJsonResponse, LlmUsage } from "./types";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapUsage(usage: GeminiApiResponse["usageMetadata"]): LlmUsage | undefined {
  if (!usage) return undefined;

  return {
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message.slice(0, 600);
  }

  return fallback;
}

export class GeminiClient implements LlmClient {
  readonly provider = "gemini";
  readonly model: string;

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    options: Pick<
      AppConfig,
      | "geminiApiKey"
      | "geminiModel"
      | "geminiApiBase"
      | "requestTimeoutMs"
      | "maxRetries"
      | "temperature"
      | "maxOutputTokens"
    > & { fetchImpl?: typeof fetch },
  ) {
    if (!options.geminiApiKey) {
      throw new AppError(
        "GEMINI_API_KEY не задан. Добавьте ключ Google AI Studio в .env или включите LLM_PROVIDER=mock.",
        { statusCode: 503, code: "LLM_CONFIG" },
      );
    }

    this.apiKey = options.geminiApiKey;
    this.model = options.geminiModel;
    this.apiBase = options.geminiApiBase;
    this.timeoutMs = options.requestTimeoutMs;
    this.maxRetries = options.maxRetries;
    this.temperature = options.temperature;
    this.maxOutputTokens = options.maxOutputTokens;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    let lastError: AppError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.callOnce(request);
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError("Не удалось получить ответ от Gemini", {
                statusCode: 502,
                code: "LLM_HTTP_ERROR",
                retryable: true,
                cause: error,
              });

        lastError = appError;

        if (!appError.retryable || attempt >= this.maxRetries) {
          throw appError;
        }

        // 0.5s, 1s, 2s... — небольшая пауза перед повтором.
        await sleep(500 * 2 ** attempt);
      }
    }

    throw (
      lastError ??
      new AppError("Не удалось получить ответ от Gemini", {
        statusCode: 502,
        code: "LLM_HTTP_ERROR",
      })
    );
  }

  private async callOnce(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      systemInstruction: {
        parts: [{ text: request.system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: request.prompt }],
        },
      ],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
      },
    };

    let response: Response;

    try {
      response = await this.fetchImpl(
        `${this.apiBase}/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError(
          `Gemini не ответил за ${this.timeoutMs} мс. Попробуйте ещё раз.`,
          {
            statusCode: 504,
            code: "LLM_TIMEOUT",
            retryable: true,
            cause: error,
          },
        );
      }

      throw new AppError("Сетевая ошибка при обращении к Gemini API", {
        statusCode: 502,
        code: "LLM_HTTP_ERROR",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();
    let payload: GeminiApiResponse | undefined;

    try {
      payload = rawText ? (JSON.parse(rawText) as GeminiApiResponse) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const message = extractErrorMessage(
        payload,
        `Gemini API вернул HTTP ${response.status}`,
      );
      throw new AppError(message, {
        statusCode: 502,
        code: "LLM_HTTP_ERROR",
        retryable: RETRYABLE_STATUSES.has(response.status),
        details: {
          upstreamStatus: response.status,
          upstreamCode: payload?.error?.status,
        },
      });
    }

    if (payload?.promptFeedback?.blockReason) {
      throw new AppError(
        `Gemini заблокировал запрос: ${payload.promptFeedback.blockReason}`,
        {
          statusCode: 422,
          code: "LLM_BLOCKED",
          details: { blockReason: payload.promptFeedback.blockReason },
        },
      );
    }

    const candidate = payload?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();

    if (!text) {
      if (finishReason === "SAFETY" || finishReason === "RECITATION") {
        throw new AppError(`Gemini остановил генерацию: ${finishReason}`, {
          statusCode: 422,
          code: "LLM_BLOCKED",
          details: { finishReason },
        });
      }

      throw new AppError(
        `Gemini вернул пустой ответ${finishReason ? ` (finishReason: ${finishReason})` : ""}`,
        {
          statusCode: 502,
          code: "LLM_EMPTY_RESPONSE",
          retryable: finishReason !== "MAX_TOKENS",
          details: { finishReason },
        },
      );
    }

    return {
      text,
      model: this.model,
      usage: mapUsage(payload?.usageMetadata),
    };
  }
}
