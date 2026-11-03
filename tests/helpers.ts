import type { AppConfig } from "../src/config";
import type { ProductDraft } from "../src/domain/draft";
import type { NormalizedProduct } from "../src/domain/product";
import type { LlmClient, LlmJsonRequest, LlmJsonResponse } from "../src/llm/types";

export const testConfig: AppConfig = {
  provider: "gemini",
  geminiApiKey: "test-key",
  geminiModel: "gemini-3.8-flash",
  geminiApiBase: "https://example.test/v1beta",
  port: 3000,
  requestTimeoutMs: 5_000,
  maxRetries: 0,
  temperature: 0.3,
  maxOutputTokens: 4_096,
};

export function makeProduct(
  overrides: Partial<NormalizedProduct> = {},
): NormalizedProduct {
  return {
    name: "Манометр показывающий DM 02",
    manufacturer: "Манотомь",
    specs: {
      "диапазон измерений": "0–1,6 МПа",
      "класс точности": "1,5",
      присоединение: "G1/2",
      "диаметр корпуса": "100 мм",
    },
    description: "Прибор предназначен для измерения избыточного давления.",
    missingFields: [],
    inputWarnings: [],
    ...overrides,
  };
}

export function makeDescription(length = 950): string {
  const phrase =
    "Прибор предназначен для измерения избыточного давления в трубопроводах и сосудах. ";
  return phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length).trim();
}

export function makeDraft(
  product: NormalizedProduct,
  overrides: Partial<ProductDraft> = {},
): ProductDraft {
  return {
    seoTitle: `${product.name} — ${product.manufacturer}`.slice(0, 70),
    seoDescription: makeDescription(950),
    keySpecs: Object.entries(product.specs).map(([name, value]) => ({ name, value })),
    searchQueries: [
      "манометр dm 02 купить",
      "манометр dm 02 характеристики",
      "манометр манотомь цена",
    ],
    commercialBlock: {
      suitableFor: "Подходит для задач, где требуется измерение избыточного давления.",
      tasks: ["Измерение избыточного давления"],
    },
    missingData: product.missingFields,
    ...overrides,
  };
}

export class StubLlmClient implements LlmClient {
  readonly provider = "stub";
  readonly model = "stub-model";
  calls = 0;
  readonly requests: LlmJsonRequest[] = [];
  private readonly responses: Array<ProductDraft | string | Error>;

  constructor(responses: Array<ProductDraft | string | Error>) {
    this.responses = [...responses];
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.calls += 1;
    this.requests.push(request);

    const next = this.responses.length > 1 ? this.responses.shift() : this.responses[0];
    if (next instanceof Error) throw next;

    return {
      text: typeof next === "string" ? next : JSON.stringify(next),
      model: this.model,
    };
  }
}
