import { describe, expect, it } from "vitest";
import { normalizeProduct } from "../src/domain/product";
import { AppError } from "../src/errors";

describe("normalizeProduct", () => {
  it("приводит числовые и boolean-значения характеристик к строкам", () => {
    const product = normalizeProduct({
      name: "  Прибор  ",
      manufacturer: "  Завод ",
      specs: { "класс точности": 1.5, "наличие поверки": true },
      description: "  Описание прибора.  ",
    });

    expect(product.name).toBe("Прибор");
    expect(product.manufacturer).toBe("Завод");
    expect(product.specs).toEqual({
      "класс точности": "1.5",
      "наличие поверки": "true",
    });
    expect(product.description).toBe("Описание прибора.");
  });

  it("считает отсутствующие поля без участия LLM", () => {
    const product = normalizeProduct({ name: "Прибор" });

    expect(product.missingFields).toEqual(
      expect.arrayContaining([
        "Производитель не указан",
        "Технические характеристики не указаны",
        "Описание или фрагмент технического паспорта отсутствует",
      ]),
    );
  });

  it("отклоняет пустое название", () => {
    expect(() => normalizeProduct({ name: "   " })).toThrow(AppError);
  });

  it("отклоняет нестроковое название", () => {
    expect(() => normalizeProduct({ name: 123 })).toThrow(AppError);
  });

  it("отклоняет массив вместо объекта", () => {
    expect(() => normalizeProduct([{ name: "Прибор" }])).toThrow(AppError);
  });

  it("выбрасывает характеристики с пустыми значениями и пишет предупреждение", () => {
    const product = normalizeProduct({
      name: "Прибор",
      specs: {
        "диапазон измерений": "0–1 МПа",
        "класс точности": "   ",
        "": "значение без названия",
      },
    });

    expect(product.specs).toEqual({ "диапазон измерений": "0–1 МПа" });
    expect(product.inputWarnings).toEqual(
      expect.arrayContaining([
        "Характеристика с пустым названием пропущена.",
        "Характеристика «класс точности» пропущена: значение пустое.",
      ]),
    );
  });
});
