import { z } from "zod";
import { AppError } from "../errors";

const MAX_SPECS = 40;
const MAX_SPEC_KEY_LENGTH = 120;
const MAX_SPEC_VALUE_LENGTH = 500;

const RawProductSchema = z.object({
  name: z
    .string({
      required_error: "Поле name обязательно",
      invalid_type_error: "Поле name должно быть строкой",
    })
    .trim()
    .min(1, "Название товара не может быть пустым")
    .max(200, "Название товара длиннее 200 символов"),
  manufacturer: z
    .string({ invalid_type_error: "Поле manufacturer должно быть строкой" })
    .trim()
    .max(300, "Название производителя длиннее 300 символов")
    .nullish()
    .transform((value) => value ?? ""),
  specs: z
    .record(
      z.string().max(MAX_SPEC_KEY_LENGTH, "Название характеристики слишком длинное"),
      z
        .union([z.string(), z.number(), z.boolean()], {
          errorMap: () => ({
            message: "Значение характеристики должно быть строкой, числом или boolean",
          }),
        })
        .transform((value) => String(value)),
    )
    .nullish()
    .transform((value) => value ?? {}),
  description: z
    .string({ invalid_type_error: "Поле description должно быть строкой" })
    .trim()
    .max(20_000, "Описание длиннее 20 000 символов")
    .nullish()
    .transform((value) => value ?? ""),
});

export interface ProductInput {
  name: string;
  manufacturer: string;
  specs: Record<string, string>;
  description: string;
}

export interface NormalizedProduct extends ProductInput {
  /** Поля, которых не хватает во входных данных. Считаются детерминированно. */
  missingFields: string[];
  /** Технические замечания к входным данным (не ошибки). */
  inputWarnings: string[];
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Приводит входной JSON к предсказуемому виду:
 * - проверяет типы и обязательные поля;
 * - обрезает пробелы;
 * - выбрасывает пустые характеристики;
 * - считает отсутствующие поля без участия LLM.
 */
export function normalizeProduct(input: unknown): NormalizedProduct {
  const parsed = RawProductSchema.safeParse(input);

  if (!parsed.success) {
    throw new AppError("Некорректные входные данные товара", {
      statusCode: 400,
      code: "INVALID_INPUT",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "product",
        message: issue.message,
      })),
    });
  }

  const inputWarnings: string[] = [];
  const specs: Record<string, string> = {};
  const entries = Object.entries(parsed.data.specs);

  if (entries.length > MAX_SPECS) {
    inputWarnings.push(
      `Передано ${entries.length} характеристик; обработаны первые ${MAX_SPECS}.`,
    );
  }

  for (const [rawKey, rawValue] of entries.slice(0, MAX_SPECS)) {
    const key = cleanText(rawKey);
    const value = cleanText(rawValue);

    if (!key) {
      inputWarnings.push("Характеристика с пустым названием пропущена.");
      continue;
    }

    if (!value) {
      inputWarnings.push(`Характеристика «${key}» пропущена: значение пустое.`);
      continue;
    }

    if (value.length > MAX_SPEC_VALUE_LENGTH) {
      inputWarnings.push(
        `Значение характеристики «${key}» обрезано до ${MAX_SPEC_VALUE_LENGTH} символов.`,
      );
      specs[key] = value.slice(0, MAX_SPEC_VALUE_LENGTH).trim();
      continue;
    }

    specs[key] = value;
  }

  const manufacturer = cleanText(parsed.data.manufacturer);
  const description = cleanText(parsed.data.description);
  const missingFields: string[] = [];

  if (!manufacturer) {
    missingFields.push("Производитель не указан");
  }

  if (Object.keys(specs).length === 0) {
    missingFields.push("Технические характеристики не указаны");
  }

  if (!description) {
    missingFields.push("Описание или фрагмент технического паспорта отсутствует");
  } else if (description.length < 120) {
    missingFields.push(
      "Описание слишком короткое для проверки применения — требуется фрагмент техпаспорта",
    );
  }

  return {
    name: cleanText(parsed.data.name),
    manufacturer,
    specs,
    description,
    missingFields,
    inputWarnings,
  };
}
