import { describe, expect, it } from "vitest";
import {
  assessDraft,
  decodeDraft,
  reconcileDraft,
  TITLE_LIMIT,
} from "../src/domain/draft";
import { makeDescription, makeDraft, makeProduct } from "./helpers";

describe("decodeDraft", () => {
  it("разбирает JSON в Markdown-обёртке", () => {
    const product = makeProduct();
    const text = `\`\`\`json\n${JSON.stringify(makeDraft(product), null, 2)}\n\`\`\``;
    const draft = decodeDraft(text);

    expect(draft.seoTitle).toContain("DM 02");
  });

  it("падает на невалидном JSON", () => {
    expect(() => decodeDraft("не json")).toThrow(/не найден JSON-объект/);
  });

  it("падает, если не хватает обязательных полей", () => {
    expect(() => decodeDraft(JSON.stringify({ seoTitle: "x" }))).toThrow(/схем/);
  });
});

describe("reconcileDraft", () => {
  it("заменяет выдуманное значение характеристики на «данных нет»", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      keySpecs: [
        { name: "диапазон измерений", value: "0–1,6 МПа" },
        { name: "класс точности", value: "0,25" },
        { name: "степень защиты", value: "IP68" },
      ],
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.keySpecs).toEqual(
      expect.arrayContaining([
        { name: "класс точности", value: "данных нет" },
        { name: "степень защиты", value: "данных нет" },
      ]),
    );
    expect(result.warnings.some((warning) => warning.includes("0,25"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("IP68"))).toBe(true);
  });

  it("добавляет характеристики, которые модель пропустила", () => {
    const product = makeProduct();
    const draft = makeDraft(product, { keySpecs: [] });

    const result = reconcileDraft(draft, product);

    expect(result.draft.keySpecs).toHaveLength(4);
    expect(result.draft.keySpecs.map((spec) => spec.value)).toEqual(
      expect.arrayContaining(["0–1,6 МПа", "1,5", "G1/2", "100 мм"]),
    );
  });

  it("не оставляет «данных нет» для характеристики, которая есть во входе", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      keySpecs: [{ name: "класс точности", value: "данных нет" }],
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.keySpecs).toEqual(
      expect.arrayContaining([{ name: "класс точности", value: "1,5" }]),
    );
  });

  it("дополняет список до трёх запросов", () => {
    const product = makeProduct();
    const draft = makeDraft(product, { searchQueries: [] });

    const result = reconcileDraft(draft, product);

    expect(result.draft.searchQueries.length).toBeGreaterThanOrEqual(3);
    expect(result.draft.searchQueries.length).toBeLessThanOrEqual(5);
    expect(result.warnings.some((warning) => warning.includes("дополнен"))).toBe(true);
  });

  it("сокращает длинный заголовок до лимита", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      seoTitle: "Очень длинный заголовок ".repeat(10),
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.seoTitle.length).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(result.warnings.some((warning) => warning.includes("сокращён"))).toBe(true);
  });

  it("сокращает слишком длинное описание по границе предложения", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      seoDescription: `${makeDescription(1_000)} ${makeDescription(1_000)}`,
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.seoDescription.length).toBeLessThanOrEqual(1_200);
    expect(result.draft.seoDescription.length).toBeGreaterThanOrEqual(800);
  });

  it("дополняет короткое описание безопасной оговоркой", () => {
    const product = makeProduct({
      missingFields: ["Описание слишком короткое для проверки применения"],
    });
    const draft = makeDraft(product, { seoDescription: "Короткое описание прибора." });

    const result = reconcileDraft(draft, product);

    expect(result.draft.seoDescription.length).toBeGreaterThanOrEqual(800);
    expect(result.draft.seoDescription.length).toBeLessThanOrEqual(1200);
    expect(
      result.warnings.some((warning) => warning.includes("дополнено безопасной оговоркой")),
    ).toBe(true);
  });

  it("не принимает склеенное значение, которого нет во входе дословно", () => {
    const product = makeProduct({
      specs: { "напряжение": "24 В", "каналы": "4" },
    });
    const draft = makeDraft(product, {
      keySpecs: [{ name: "параметры", value: "24 В, 4 канала" }],
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.keySpecs).toEqual(
      expect.arrayContaining([{ name: "параметры", value: "данных нет" }]),
    );
  });

  it("восстанавливает регистр и написание технических обозначений", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      seoTitle: "манометр dm 02 — манотомь",
      seoDescription: `${makeDescription(900)} Диапазон 0–1,6 мпа, присоединение g1/2, диаметр 100 мм.`,
    });

    const result = reconcileDraft(draft, product);

    expect(result.draft.seoTitle).toContain("DM 02");
    expect(result.draft.seoTitle).toContain("Манотомь");
    expect(result.draft.seoDescription).toContain("0–1,6 МПа");
    expect(result.draft.seoDescription).toContain("G1/2");
  });

  it("не дублирует missingData, если модель уже назвала отсутствующую характеристику", () => {
    const product = makeProduct();
    const draft = makeDraft(product, {
      keySpecs: [
        ...Object.entries(product.specs).map(([name, value]) => ({ name, value })),
        { name: "диапазон рабочих температур", value: "данных нет" },
      ],
      missingData: ["Диапазон рабочих температур не указан"],
    });

    const result = reconcileDraft(draft, product);

    expect(
      result.draft.missingData.filter((item) =>
        item.toLowerCase().includes("диапазон рабочих температур"),
      ),
    ).toHaveLength(1);
  });

  it("переносит отсутствующие поля в missingData", () => {
    const product = makeProduct({
      manufacturer: "",
      description: "",
      missingFields: [
        "Производитель не указан",
        "Описание или фрагмент технического паспорта отсутствует",
      ],
    });
    const draft = makeDraft(product, { missingData: ["Уточнить класс точности"] });

    const result = reconcileDraft(draft, product);

    expect(result.draft.missingData).toEqual(
      expect.arrayContaining([
        "Производитель не указан",
        "Описание или фрагмент технического паспорта отсутствует",
        "Уточнить класс точности",
      ]),
    );
  });
});

describe("assessDraft", () => {
  it("отмечает карточку как требующую проверки при предупреждениях", () => {
    const product = makeProduct();
    const draft = makeDraft(product);

    const quality = assessDraft(draft, product, ["Ручное замечание"]);

    expect(quality.titleWithinLimit).toBe(true);
    expect(quality.descriptionWithinRange).toBe(true);
    expect(quality.searchQueriesWithinRange).toBe(true);
    expect(quality.needsReview).toBe(true);
  });
});
