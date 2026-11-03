import { describe, expect, it, vi } from "vitest";
import { GeminiClient } from "../src/llm/gemini";
import { AppError } from "../src/errors";
import { DRAFT_JSON_SCHEMA } from "../src/prompts/productCard";
import { testConfig } from "./helpers";

function client(fetchImpl: typeof fetch, overrides: Partial<typeof testConfig> = {}) {
  return new GeminiClient({
    ...testConfig,
    ...overrides,
    fetchImpl,
  });
}

const request = {
  system: "system",
  prompt: "prompt",
  schema: DRAFT_JSON_SCHEMA,
};

function okResponse(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("GeminiClient", () => {
  it("требует API-ключ", () => {
    expect(
      () =>
        new GeminiClient({
          ...testConfig,
          geminiApiKey: undefined,
        }),
    ).toThrow(AppError);
  });

  it("возвращает текст и usage", async () => {
    const fetchMock = vi.fn(async () => okResponse('{"ok":true}'));

    const response = await client(fetchMock as typeof fetch).generateJson(request);

    expect(response.text).toBe('{"ok":true}');
    expect(response.model).toBe("gemini-3.8-flash");
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(url).not.toContain("test-key");
  });

  it("повторяет запрос при 503", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }),
      )
      .mockResolvedValueOnce(okResponse('{"ok":true}'));

    const response = await client(fetchMock as typeof fetch, { maxRetries: 1 }).generateJson(
      request,
    );

    expect(response.text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("не повторяет запрос при 400", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }),
    );

    await expect(
      client(fetchMock as typeof fetch, { maxRetries: 2 }).generateJson(request),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "LLM_HTTP_ERROR",
      message: "bad request",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("обрабатывает блокировку запроса", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }),
        { status: 200 },
      ),
    );

    await expect(
      client(fetchMock as typeof fetch).generateJson(request),
    ).rejects.toMatchObject({ code: "LLM_BLOCKED" });
  });

  it("обрабатывает пустой ответ", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }),
        { status: 200 },
      ),
    );

    await expect(
      client(fetchMock as typeof fetch).generateJson(request),
    ).rejects.toMatchObject({ code: "LLM_EMPTY_RESPONSE" });
  });
});
