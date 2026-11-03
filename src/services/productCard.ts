import { AppError, isAppError } from "../errors";
import {
  assessDraft,
  collectRepairIssues,
  decodeDraft,
  reconcileDraft,
} from "../domain/draft";
import type {
  GenerationMeta,
  GenerationResult,
  ProductDraft,
} from "../domain/draft";
import type { NormalizedProduct } from "../domain/product";
import {
  buildProductCardPrompt,
  buildRepairPrompt,
  DRAFT_JSON_SCHEMA,
} from "../prompts/productCard";
import type { LlmClient, LlmUsage } from "../llm/types";

export interface GenerateProductCardOptions {
  /** Сколько раз разрешено попросить модель исправить ответ. По умолчанию 1. */
  maxRepairAttempts?: number;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Основной сценарий: промпт → Gemini → разбор и проверка → детерминированная
 * нормализация → отчёт о качестве.
 */
export async function generateProductCard(
  product: NormalizedProduct,
  llm: LlmClient,
  options: GenerateProductCardOptions = {},
): Promise<GenerationResult> {
  const startedAt = Date.now();
  const maxRepairAttempts = Math.max(0, options.maxRepairAttempts ?? 1);
  const maxAttempts = 1 + maxRepairAttempts;
  const { system, prompt } = buildProductCardPrompt(product);

  let currentPrompt = prompt;
  let draft: ProductDraft | undefined;
  let attempts = 0;
  let usage: LlmUsage | undefined;
  const attemptWarnings: string[] = [];
  const repairNotes: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;

    let response;

    try {
      response = await llm.generateJson({
        system,
        prompt: currentPrompt,
        schema: DRAFT_JSON_SCHEMA,
        context: { product },
      });
      usage = response.usage ?? usage;
    } catch (error) {
      if (!draft) throw error;

      attemptWarnings.push(
        `Повторная попытка получить исправленный ответ не удалась: ${asErrorMessage(error)}. Возвращён предыдущий вариант.`,
      );
      break;
    }

    let parsed: ProductDraft;

    try {
      parsed = decodeDraft(response.text);
    } catch (error) {
      const message = `Ответ модели не удалось разобрать: ${asErrorMessage(error)}.`;

      if (attempt < maxAttempts) {
        repairNotes.push(message);
        currentPrompt = `${prompt}\n\nПредыдущая попытка вернула невалидный ответ (${asErrorMessage(
          error,
        )}). Верни только валидный JSON строго по схеме, без Markdown и пояснений.`;
        continue;
      }

      attemptWarnings.push(message);
      break;
    }

    const issues = collectRepairIssues(parsed, product);

    if (issues.length === 0) {
      draft = parsed;
      break;
    }

    draft = parsed;

    if (attempt < maxAttempts) {
      repairNotes.push(`Запрошено исправление: ${issues.join(" ")}`);
      currentPrompt = buildRepairPrompt(product, parsed, issues);
      continue;
    }

    attemptWarnings.push(
      `Ответ модели не удалось полностью привести к требованиям: ${issues.join(" ")}`,
    );
  }

  if (!draft) {
    throw new AppError(
      "Не удалось получить корректный черновик карточки от модели. Проверьте ключ, модель и входные данные.",
      {
        statusCode: 502,
        code: "GENERATION_FAILED",
        details: { attempts, warnings: attemptWarnings },
      },
    );
  }

  const { draft: reconciledDraft, warnings } = reconcileDraft(draft, product);
  const quality = assessDraft(reconciledDraft, product, [
    ...attemptWarnings,
    ...warnings,
  ]);

  const meta: GenerationMeta = {
    provider: llm.provider,
    model: llm.model,
    attempts,
    elapsedMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
    usage,
    ...(repairNotes.length > 0 ? { repairs: repairNotes } : {}),
  };

  return {
    product: {
      name: product.name,
      manufacturer: product.manufacturer,
      specs: product.specs,
      description: product.description,
    },
    draft: reconciledDraft,
    quality,
    meta,
  };
}

export function describeError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Внутренняя ошибка сервиса",
  };
}
