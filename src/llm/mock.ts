import type { NormalizedProduct } from "../domain/product";
import type { LlmClient, LlmJsonRequest, LlmJsonResponse } from "./types";

function buildDescription(product: NormalizedProduct): string {
  const manufacturer = product.manufacturer
    ? ` производства ${product.manufacturer}`
    : "";
  const base =
    `${product.name}${manufacturer} — карточка товара для B2B-каталога. ` +
    `В ней собраны только подтверждённые сведения из входных данных.`;

  const entries = Object.entries(product.specs);
  let specs = "";

  if (entries.length > 0) {
    specs = " Ключевые параметры:";
    for (const [name, value] of entries) {
      const next = `${specs} ${name} — ${value};`;
      // Оставляем место для описания, оговорки и блока missingData.
      if (next.length > 420) break;
      specs = next;
    }
    specs = specs.replace(/;$/, ".");
  } else {
    specs = " Технические характеристики во входных данных не указаны.";
  }

  const description = product.description
    ? ` В переданном описании указано: ${product.description}`
    : " Описание или фрагмент технического паспорта во входных данных отсутствует.";
  const disclaimer =
    " Сведения в карточке ограничены входными данными: отсутствующие параметры не додумываются, а отмечаются как «данных нет». " +
    "Это помогает снабженцу и контент-менеджеру быстро понять, какие характеристики подтверждены, а какие нужно запросить у производителя или менеджера перед публикацией.";
  const missing = product.missingFields.length
    ? ` Для точного подбора требуется уточнить: ${product.missingFields.join("; ")}.`
    : "";

  let text = `${base}${specs}${description}${disclaimer}${missing}`;

  if (text.length < 800) {
    text +=
      " Перед заказом рекомендуется проверить актуальность характеристик, комплектацию и условия поставки у менеджера. " +
      "В карточке приведены только те сведения, которые были переданы вместе с товаром; она не заменяет официальный технический паспорт.";
  }

  if (text.length > 1_150) {
    const cut = text.slice(0, 1_150);
    const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = cut.slice(0, lastSentence > 800 ? lastSentence + 1 : 1_150).trim();
  }

  return text;
}

function buildMockDraft(product: NormalizedProduct): Record<string, unknown> {
  const title = `${product.name}${product.manufacturer ? ` — ${product.manufacturer}` : ""}`;

  return {
    seoTitle: title,
    seoDescription: buildDescription(product),
    keySpecs: Object.entries(product.specs).map(([name, value]) => ({ name, value })),
    searchQueries: [
      `${product.name} купить`,
      `${product.name} характеристики`,
      product.manufacturer
        ? `${product.manufacturer} ${product.name}`
        : `${product.name} цена`,
      `${product.name} применение`,
    ],
    commercialBlock: {
      suitableFor: `${product.name}${product.manufacturer ? ` от ${product.manufacturer}` : ""} подходит для задач, где важны подтверждённые в карточке характеристики.`,
      tasks: [
        "Подбор прибора по указанным техническим параметрам",
        "Сравнение с аналогами по подтверждённым характеристикам",
      ],
    },
    missingData: product.missingFields,
  };
}

/**
 * Детерминированный провайдер для тестов и локального просмотра UI без ключа.
 * Не является заменой реальной LLM: текст шаблонный.
 */
export class MockLlmClient implements LlmClient {
  readonly provider = "mock";
  readonly model = "mock";

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const product = request.context?.product;

    if (!product) {
      throw new Error("MockLlmClient требует request.context.product");
    }

    return {
      text: JSON.stringify(buildMockDraft(product)),
      model: this.model,
    };
  }
}
