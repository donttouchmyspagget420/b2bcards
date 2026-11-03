import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { generateProductCard } from "../src/services/productCard";
import { makeDraft, makeProduct, StubLlmClient } from "./helpers";

describe("generateProductCard", () => {
  it("возвращает готовый результат с первой попытки", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient([makeDraft(product)]);

    const result = await generateProductCard(product, llm);

    expect(result.meta.attempts).toBe(1);
    expect(result.draft.seoTitle).toContain("DM 02");
    expect(result.quality.needsReview).toBe(false);
    expect(llm.calls).toBe(1);
  });

  it("просит модель исправить слишком длинный заголовок", async () => {
    const product = makeProduct();
    const bad = makeDraft(product, { seoTitle: "Слишком длинный заголовок ".repeat(8) });
    const good = makeDraft(product);
    const llm = new StubLlmClient([bad, good]);

    const result = await generateProductCard(product, llm);

    expect(llm.calls).toBe(2);
    expect(result.meta.attempts).toBe(2);
    expect(result.draft.seoTitle.length).toBeLessThanOrEqual(70);
    expect(
      result.meta.repairs?.some((note) => note.includes("Запрошено исправление")),
    ).toBe(true);
    expect(llm.requests[1]?.prompt).toContain("Предыдущий ответ не прошёл");
  });

  it("просит исправить выдуманную характеристику", async () => {
    const product = makeProduct();
    const bad = makeDraft(product, {
      keySpecs: [{ name: "класс точности", value: "0,1" }],
    });
    const good = makeDraft(product);
    const llm = new StubLlmClient([bad, good]);

    const result = await generateProductCard(product, llm);

    expect(llm.calls).toBe(2);
    expect(llm.requests[1]?.prompt).toContain("0,1");
    expect(result.draft.keySpecs).toEqual(
      expect.arrayContaining([{ name: "класс точности", value: "1,5" }]),
    );
  });

  it("повторяет запрос после невалидного JSON", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient(["не json", makeDraft(product)]);

    const result = await generateProductCard(product, llm);

    expect(llm.calls).toBe(2);
    expect(result.meta.attempts).toBe(2);
    expect(
      result.meta.repairs?.some((note) => note.includes("не удалось разобрать")),
    ).toBe(true);
  });

  it("возвращает первый вариант, если повторная попытка упала", async () => {
    const product = makeProduct();
    const bad = makeDraft(product, { seoTitle: "Слишком длинный заголовок ".repeat(8) });
    const llm = new StubLlmClient([bad, new AppError("upstream", { statusCode: 502 })]);

    const result = await generateProductCard(product, llm);

    expect(result.draft.seoTitle.length).toBeLessThanOrEqual(70);
    expect(result.quality.warnings.some((warning) => warning.includes("Повторная попытка"))).toBe(
      true,
    );
  });

  it("падает, если ни одна попытка не дала валидный JSON", async () => {
    const product = makeProduct();
    const llm = new StubLlmClient(["не json", "тоже не json"]);

    await expect(generateProductCard(product, llm)).rejects.toMatchObject({
      code: "GENERATION_FAILED",
      statusCode: 502,
    });
  });
});
