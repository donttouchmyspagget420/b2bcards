import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { AppError } from "../src/errors";
import { makeDraft, makeProduct, StubLlmClient, testConfig } from "./helpers";

function appWith(llm: StubLlmClient | null) {
  return createApp({
    config: testConfig,
    llm,
    rootDir: process.cwd(),
  });
}

describe("API", () => {
  it("отдаёт health", async () => {
    const response = await request(appWith(new StubLlmClient([]))).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      provider: "gemini",
      model: "gemini-3.8-flash",
      llmConfigured: true,
    });
  });

  it("генерирует карточку по JSON", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient([makeDraft(product)]);
    const response = await request(appWith(llm)).post("/api/generate").send(product);

    expect(response.status).toBe(200);
    expect(response.body.product.name).toBe(product.name);
    expect(response.body.draft.seoTitle).toContain("DM 02");
    expect(response.body.quality).toBeDefined();
    expect(response.body.meta.provider).toBe("stub");
  });

  it("принимает товар внутри поля product", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient([makeDraft(product)]);
    const response = await request(appWith(llm))
      .post("/api/generate")
      .send({ product });

    expect(response.status).toBe(200);
  });

  it("возвращает Markdown по Accept", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient([makeDraft(product)]);
    const response = await request(appWith(llm))
      .post("/api/generate")
      .set("Accept", "text/markdown")
      .send(product);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.text).toContain("# Манометр показывающий DM 02");
    expect(response.text).toContain("## SEO-заголовок");
  });

  it("дублирует Markdown в JSON при include=markdown", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient([makeDraft(product)]);
    const response = await request(appWith(llm))
      .post("/api/generate?include=markdown")
      .send(product);

    expect(response.status).toBe(200);
    expect(response.body.markdown).toContain("## Ключевые характеристики");
  });

  it("возвращает 400 на некорректный JSON", async () => {
    const response = await request(appWith(new StubLlmClient([])))
      .post("/api/generate")
      .set("Content-Type", "application/json")
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("возвращает 400 без названия", async () => {
    const response = await request(appWith(new StubLlmClient([])))
      .post("/api/generate")
      .send({ manufacturer: "Манотомь" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_INPUT");
    expect(response.body.error.details[0].path).toBe("name");
  });

  it("возвращает 503, если LLM не настроена", async () => {
    const response = await request(appWith(null))
      .post("/api/generate")
      .send({ name: "Прибор" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("LLM_CONFIG");
  });

  it("возвращает ошибку LLM", async () => {
    const llm = new StubLlmClient([new AppError("Gemini недоступен", { statusCode: 502, code: "LLM_HTTP_ERROR" })]);
    const response = await request(appWith(llm))
      .post("/api/generate")
      .send({ name: "Прибор" });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("LLM_HTTP_ERROR");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("возвращает 404 для неизвестного API-метода", async () => {
    const response = await request(appWith(new StubLlmClient([]))).get("/api/unknown");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
