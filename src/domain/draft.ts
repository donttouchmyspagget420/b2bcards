import { z } from "zod";
import type { LlmUsage } from "../llm/types";
import type { NormalizedProduct } from "./product";

export const TITLE_LIMIT = 70;
export const DESCRIPTION_MIN = 800;
export const DESCRIPTION_MAX = 1_200;
export const QUERIES_MIN = 3;
export const QUERIES_MAX = 5;

export const MISSING_VALUE = "данных нет";

const DraftSchema = z.object({
  seoTitle: z.string().min(1).max(400),
  seoDescription: z.string().min(1).max(8_000),
  keySpecs: z
    .array(
      z.object({
        name: z.string().min(1).max(240),
        value: z.string().min(1).max(600),
      }),
    )
    .max(80),
  searchQueries: z.array(z.string().min(1).max(240)).max(20),
  commercialBlock: z.object({
    suitableFor: z.string().min(1).max(4_000),
    tasks: z.array(z.string().min(1).max(800)).max(20),
  }),
  missingData: z.array(z.string().min(1).max(800)).max(40).optional(),
});

export interface KeySpec {
  name: string;
  value: string;
}

export interface CommercialBlock {
  suitableFor: string;
  tasks: string[];
}

export interface ProductDraft {
  seoTitle: string;
  seoDescription: string;
  keySpecs: KeySpec[];
  searchQueries: string[];
  commercialBlock: CommercialBlock;
  missingData: string[];
}

export interface QualityReport {
  titleLength: number;
  titleLimit: number;
  titleWithinLimit: boolean;
  descriptionLength: number;
  descriptionRange: { min: number; max: number };
  descriptionWithinRange: boolean;
  searchQueriesCount: number;
  searchQueriesRange: { min: number; max: number };
  searchQueriesWithinRange: boolean;
  specsCount: number;
  specsWithMissingValues: number;
  missingData: string[];
  warnings: string[];
  needsReview: boolean;
}

export interface GenerationMeta {
  provider: string;
  model: string;
  attempts: number;
  elapsedMs: number;
  generatedAt: string;
  usage?: LlmUsage;
  /** Какие замечания автопроверки привели к повторному запросу. */
  repairs?: string[];
}

export interface GenerationResult {
  product: {
    name: string;
    manufacturer: string;
    specs: Record<string, string>;
    description: string;
  };
  draft: ProductDraft;
  quality: QualityReport;
  meta: GenerationMeta;
}

const MISSING_MARKERS = new Set([
  "данных нет",
  "нет данных",
  "не указано",
  "не указан",
  "не указана",
  "отсутствует",
  "отсутствуют",
  "н/д",
  "нд",
  "нет",
  "-",
  "—",
  "–",
]);

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;

export function canonical(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(DASHES, "-")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([,;:/])\s*/g, "$1");
}

export function isMissingValue(value: string): boolean {
  return MISSING_MARKERS.has(canonical(value));
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Модель иногда переводит обозначения в нижний регистр («0–1,6 мпа», «g1/2»,
 * «dm 02»). Возвращаем исходное написание, чтобы технические значения в тексте
 * совпадали с входными данными.
 */
function restoreExactTerms(text: string, product: NormalizedProduct): string {
  const nameTokens = [product.name, product.manufacturer]
    .flatMap((value) => value.split(/\s+/))
    .filter(
      (token) =>
        token.length >= 2 &&
        (/[0-9]/.test(token) || /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9./-]+$/.test(token)),
    );

  const terms = uniqueStrings([
    product.name,
    product.manufacturer,
    ...nameTokens,
    ...Object.values(product.specs),
  ])
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length);

  let result = text;

  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    result = result.replace(pattern, term);
  }

  return result;
}

function normalizeDraft(draft: z.infer<typeof DraftSchema>): ProductDraft {
  return {
    seoTitle: cleanLine(draft.seoTitle),
    seoDescription: cleanLine(draft.seoDescription),
    keySpecs: draft.keySpecs
      .map((spec) => ({ name: cleanLine(spec.name), value: cleanLine(spec.value) }))
      .filter((spec) => spec.name && spec.value),
    searchQueries: draft.searchQueries.map(cleanLine).filter(Boolean),
    commercialBlock: {
      suitableFor: cleanLine(draft.commercialBlock.suitableFor),
      tasks: draft.commercialBlock.tasks.map(cleanLine).filter(Boolean),
    },
    missingData: (draft.missingData ?? []).map(cleanLine).filter(Boolean),
  };
}

export function decodeDraft(text: string): ProductDraft {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("В ответе модели не найден JSON-объект");
  }

  const raw = JSON.parse(withoutFence.slice(start, end + 1));
  const parsed = DraftSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "draft"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Ответ модели не соответствует схеме: ${details}`);
  }

  return normalizeDraft(parsed.data);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = canonical(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function truncateTitle(title: string): string {
  if (title.length <= TITLE_LIMIT) return title;

  const slice = title.slice(0, TITLE_LIMIT + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > TITLE_LIMIT * 0.55 ? slice.slice(0, lastSpace) : title.slice(0, TITLE_LIMIT);

  return cut.replace(/[\s,;:.!?–—-]+$/g, "").trim();
}

function truncateDescription(description: string, warnings: string[]): string {
  if (description.length <= DESCRIPTION_MAX) return description;

  const slice = description.slice(0, DESCRIPTION_MAX + 1);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  const lastSpace = slice.lastIndexOf(" ");
  const cutAt = sentenceEnd >= DESCRIPTION_MIN ? sentenceEnd + 1 : lastSpace;

  warnings.push(
    `SEO-описание было длиннее ${DESCRIPTION_MAX} символов и сокращено автоматически.`,
  );

  return description.slice(0, cutAt > 0 ? cutAt : DESCRIPTION_MAX).trim();
}

function padShortDescription(
  description: string,
  product: NormalizedProduct,
  unresolvedSpecs: string[],
  warnings: string[],
): string {
  if (description.length >= DESCRIPTION_MIN) return description;

  const items = uniqueStrings([...product.missingFields, ...unresolvedSpecs]).slice(0, 6);
  const safeSentences = [
    items.length > 0
      ? `Для точного подбора перед заказом рекомендуется уточнить у производителя или менеджера: ${items.join("; ")}.`
      : "Перед заказом рекомендуется уточнить актуальные характеристики и условия поставки у менеджера.",
    "В карточке приведены только подтверждённые сведения из переданных данных; она не заменяет официальный технический паспорт.",
    "Перед публикацией или оформлением заказа проверьте актуальность характеристик, комплектацию и условия поставки.",
    "Если для вашей задачи важны параметры, которых нет в карточке, запросите их у поставщика: они не были добавлены автоматически.",
    "Указанные значения приведены в том виде, в котором они переданы в исходных данных, без пересчёта единиц и округления.",
    "Для сравнения с аналогами используйте подтверждённые характеристики и уточняйте совместимость с конкретным оборудованием.",
    "Карточка носит информационный характер и не является публичной офертой; окончательные параметры фиксируются в договоре или спецификации.",
    "Перед вводом в эксплуатацию сверьтесь с руководством производителя и убедитесь, что условия монтажа соответствуют требованиям вашего объекта.",
  ];

  let padded = description;

  for (const sentence of safeSentences) {
    if (padded.length >= DESCRIPTION_MIN) break;
    if (!padded.includes(sentence)) {
      padded = `${padded} ${sentence}`.trim();
    }
  }

  if (padded.length > DESCRIPTION_MAX) {
    padded = truncateDescription(padded, warnings);
  }

  warnings.push(
    "SEO-описание было короче 800 символов и дополнено безопасной оговоркой без новых технических фактов.",
  );

  return padded;
}

function buildQueryFallbacks(product: NormalizedProduct): string[] {
  const candidates = [
    `${product.name} купить`,
    `${product.name} характеристики`,
    product.manufacturer
      ? `${product.name} ${product.manufacturer}`
      : `${product.name} цена`,
    `${product.name} цена`,
  ];

  return uniqueStrings(candidates);
}

function isGroundedValue(
  value: string,
  sourceValues: string[],
  sourceDescription: string,
): boolean {
  if (isMissingValue(value)) return true;

  const valueKey = canonical(value);
  if (!valueKey) return false;

  if (sourceValues.some((source) => source === valueKey)) return true;
  if (sourceDescription.includes(valueKey)) return true;

  // Значение должно быть дословным. Склеенные значения вроде «24 В, 4 канала»
  // намеренно не считаются подтверждёнными: их нельзя проверить однозначно.
  return false;
}

function stemWord(word: string): string {
  return word
    .replace(
      /(иями|ями|ами|ией|ов|ев|ий|ый|ая|ое|ые|ой|ей|ую|юю|ах|ях|ам|ям|ом|ем|ы|и|а|я|у|ю|е|о|ь)$/u,
      "",
    )
    .slice(0, 5);
}

/** Грубое сравнение «упоминает ли текст характеристику» без морфологии. */
function mentionsSpec(entry: string, name: string): boolean {
  const entryWords = canonical(entry)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stemWord);
  const nameWords = canonical(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stemWord);

  if (nameWords.length === 0) return false;

  return nameWords.every((word) =>
    entryWords.some((entryWord) => entryWord.startsWith(word) || word.startsWith(entryWord)),
  );
}

function mergeMissingData(
  draft: ProductDraft,
  product: NormalizedProduct,
  unresolvedSpecs: string[],
): string[] {
  const providedKeys = new Set(Object.keys(product.specs).map(canonical));
  const base = uniqueStrings([...product.missingFields, ...draft.missingData]).filter(
    (entry) => {
      const key = canonical(entry);
      // Модель иногда пишет в missingData уже известную характеристику.
      return !providedKeys.has(key);
    },
  );

  // Не дублируем «Уточнить характеристику: X», если модель уже написала про X.
  const extra = unresolvedSpecs
    .filter((name) => !base.some((entry) => mentionsSpec(entry, name)))
    .map((name) => `Уточнить характеристику: ${name}`);

  return uniqueStrings([...base, ...extra]).slice(0, 20);
}

/**
 * Детерминированно приводит ответ модели к требованиям задания:
 * - не даёт выдумать значения характеристик;
 * - возвращает все характеристики из входа;
 * - добивает 3–5 запросов, если модель вернула меньше;
 * - ограничивает длины заголовка и описания.
 */
export function reconcileDraft(
  draft: ProductDraft,
  product: NormalizedProduct,
): { draft: ProductDraft; warnings: string[] } {
  const warnings: string[] = [...product.inputWarnings];
  const sourceValues = Object.values(product.specs).map(canonical);
  const sourceDescription = canonical(product.description);
  const seenSpecs = new Set<string>();
  const keySpecs: KeySpec[] = [];
  const unresolvedSpecs: string[] = [];
  const providedNames = new Set(Object.keys(product.specs).map(canonical));

  for (const spec of draft.keySpecs) {
    const key = `${canonical(spec.name)}::${canonical(spec.value)}`;
    if (seenSpecs.has(key)) continue;
    seenSpecs.add(key);

    if (isMissingValue(spec.value)) {
      // Не оставляем «данных нет» для характеристики, которая есть во входе.
      if (providedNames.has(canonical(spec.name))) {
        warnings.push(
          `Модель пометила «${spec.name}» как отсутствующую, хотя значение есть во входных данных.`,
        );
        continue;
      }

      keySpecs.push({ name: spec.name, value: MISSING_VALUE });
      unresolvedSpecs.push(spec.name);
      continue;
    }

    if (!isGroundedValue(spec.value, sourceValues, sourceDescription)) {
      warnings.push(
        `Значение «${spec.value}» для «${spec.name}» не найдено во входных данных и заменено на «${MISSING_VALUE}».`,
      );
      keySpecs.push({ name: spec.name, value: MISSING_VALUE });
      unresolvedSpecs.push(spec.name);
      continue;
    }

    keySpecs.push({ name: spec.name, value: spec.value });
  }

  // Гарантируем, что все переданные характеристики попали в результат.
  const representedValues = new Set(keySpecs.map((spec) => canonical(spec.value)));
  for (const [name, value] of Object.entries(product.specs)) {
    if (!representedValues.has(canonical(value))) {
      keySpecs.push({ name, value });
      representedValues.add(canonical(value));
      warnings.push(`Характеристика «${name}» добавлена из входных данных.`);
    }
  }

  let searchQueries = uniqueStrings(draft.searchQueries);
  if (searchQueries.length > QUERIES_MAX) {
    searchQueries = searchQueries.slice(0, QUERIES_MAX);
    warnings.push(
      `Список поисковых запросов сокращён до ${QUERIES_MAX}: модель вернула больше запросов, чем требуется.`,
    );
  }

  if (searchQueries.length < QUERIES_MIN) {
    const before = searchQueries.length;
    searchQueries = uniqueStrings([...searchQueries, ...buildQueryFallbacks(product)]).slice(
      0,
      QUERIES_MAX,
    );
    warnings.push(
      `Список поисковых запросов дополнен шаблонными запросами (${before} → ${searchQueries.length}).`,
    );
  }

  let seoTitle = restoreExactTerms(cleanLine(draft.seoTitle), product);
  if (seoTitle.length > TITLE_LIMIT) {
    seoTitle = truncateTitle(seoTitle);
    warnings.push(`SEO-заголовок сокращён до ${TITLE_LIMIT} символов.`);
  }

  const trimmedDescription = truncateDescription(
    restoreExactTerms(cleanLine(draft.seoDescription), product),
    warnings,
  );
  const seoDescription = padShortDescription(
    trimmedDescription,
    product,
    unresolvedSpecs,
    warnings,
  );

  const tasks = uniqueStrings(draft.commercialBlock.tasks);
  const commercialBlock: CommercialBlock = {
    suitableFor:
      draft.commercialBlock.suitableFor ||
      "Требует уточнения: во входных данных недостаточно сведений о применении.",
    tasks:
      tasks.length > 0
        ? tasks
        : ["Требует уточнения: во входных данных нет сведений о задачах применения"],
  };

  if (!draft.commercialBlock.suitableFor || tasks.length === 0) {
    warnings.push("Коммерческий блок требует ручной проверки: во входных данных мало сведений.");
  }

  return {
    draft: {
      seoTitle,
      seoDescription,
      keySpecs,
      searchQueries,
      commercialBlock,
      missingData: mergeMissingData(draft, product, unresolvedSpecs),
    },
    warnings: uniqueStrings(warnings),
  };
}

export function collectRepairIssues(
  draft: ProductDraft,
  product: NormalizedProduct,
): string[] {
  const issues: string[] = [];

  if (draft.seoTitle.length > TITLE_LIMIT) {
    issues.push(
      `SEO-заголовок длиной ${draft.seoTitle.length} символов; нужно не более ${TITLE_LIMIT}.`,
    );
  }

  if (draft.seoDescription.length < DESCRIPTION_MIN) {
    issues.push(
      `SEO-описание длиной ${draft.seoDescription.length} символов; нужно от ${DESCRIPTION_MIN} до ${DESCRIPTION_MAX}.`,
    );
  }

  if (draft.seoDescription.length > DESCRIPTION_MAX) {
    issues.push(
      `SEO-описание длиной ${draft.seoDescription.length} символов; нужно от ${DESCRIPTION_MIN} до ${DESCRIPTION_MAX}.`,
    );
  }

  if (draft.searchQueries.length < QUERIES_MIN || draft.searchQueries.length > QUERIES_MAX) {
    issues.push(
      `Поисковых запросов ${draft.searchQueries.length}; нужно от ${QUERIES_MIN} до ${QUERIES_MAX}.`,
    );
  }

  const sourceValues = Object.values(product.specs).map(canonical);
  const sourceDescription = canonical(product.description);

  for (const spec of draft.keySpecs) {
    if (!isGroundedValue(spec.value, sourceValues, sourceDescription)) {
      issues.push(
        `Значение «${spec.value}» для «${spec.name}» отсутствует во входных данных. Замени его на «${MISSING_VALUE}» или удали характеристику.`,
      );
    }
  }

  return issues;
}

export function assessDraft(
  draft: ProductDraft,
  product: NormalizedProduct,
  warnings: string[],
): QualityReport {
  const allWarnings = uniqueStrings([...warnings, ...product.inputWarnings]);
  const specsWithMissingValues = draft.keySpecs.filter((spec) =>
    isMissingValue(spec.value),
  ).length;

  return {
    titleLength: draft.seoTitle.length,
    titleLimit: TITLE_LIMIT,
    titleWithinLimit: draft.seoTitle.length > 0 && draft.seoTitle.length <= TITLE_LIMIT,
    descriptionLength: draft.seoDescription.length,
    descriptionRange: { min: DESCRIPTION_MIN, max: DESCRIPTION_MAX },
    descriptionWithinRange:
      draft.seoDescription.length >= DESCRIPTION_MIN &&
      draft.seoDescription.length <= DESCRIPTION_MAX,
    searchQueriesCount: draft.searchQueries.length,
    searchQueriesRange: { min: QUERIES_MIN, max: QUERIES_MAX },
    searchQueriesWithinRange:
      draft.searchQueries.length >= QUERIES_MIN &&
      draft.searchQueries.length <= QUERIES_MAX,
    specsCount: draft.keySpecs.length,
    specsWithMissingValues,
    missingData: draft.missingData,
    warnings: allWarnings,
    needsReview:
      allWarnings.length > 0 ||
      draft.missingData.length > 0 ||
      specsWithMissingValues > 0 ||
      draft.seoTitle.length > TITLE_LIMIT ||
      draft.seoDescription.length < DESCRIPTION_MIN ||
      draft.seoDescription.length > DESCRIPTION_MAX,
  };
}
