import type { GenerationResult } from "../domain/draft";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Moscow",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Markdown-представление, удобное для копирования в CMS или письмо менеджеру. */
export function renderMarkdown(result: GenerationResult): string {
  const { product, draft, quality, meta } = result;
  const lines: string[] = [];

  lines.push(`# ${product.name}`);
  lines.push("");
  lines.push(`**Производитель:** ${product.manufacturer || "данных нет"}`);
  lines.push("");

  lines.push("## SEO-заголовок");
  lines.push("");
  lines.push(draft.seoTitle);
  lines.push("");
  lines.push(`_${quality.titleLength} / ${quality.titleLimit} символов_`);
  lines.push("");

  lines.push("## SEO-описание");
  lines.push("");
  lines.push(draft.seoDescription);
  lines.push("");
  lines.push(
    `_${quality.descriptionLength} символов (требуется ${quality.descriptionRange.min}–${quality.descriptionRange.max})_`,
  );
  lines.push("");

  lines.push("## Ключевые характеристики");
  lines.push("");
  lines.push("| Параметр | Значение |");
  lines.push("| --- | --- |");

  if (draft.keySpecs.length === 0) {
    lines.push("| данных нет | данных нет |");
  } else {
    for (const spec of draft.keySpecs) {
      lines.push(`| ${escapeCell(spec.name)} | ${escapeCell(spec.value)} |`);
    }
  }
  lines.push("");

  lines.push("## Поисковые запросы");
  lines.push("");
  for (const query of draft.searchQueries) {
    lines.push(`- ${query}`);
  }
  lines.push("");

  lines.push("## Коммерческий блок");
  lines.push("");
  lines.push(`**Кому подходит:** ${draft.commercialBlock.suitableFor}`);
  lines.push("");
  lines.push("**Задачи:**");
  lines.push("");
  for (const task of draft.commercialBlock.tasks) {
    lines.push(`- ${task}`);
  }
  lines.push("");

  lines.push("## Недостающие данные и уточнения");
  lines.push("");
  if (draft.missingData.length === 0) {
    lines.push("- Нет: все необходимые поля заполнены.");
  } else {
    for (const item of draft.missingData) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");

  if (quality.warnings.length > 0) {
    lines.push("## Замечания автопроверки");
    lines.push("");
    for (const warning of quality.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `_Черновик сгенерирован: ${formatDate(meta.generatedAt)} · ${meta.provider}/${meta.model} · попыток: ${meta.attempts} · ${meta.elapsedMs} мс._`,
  );
  lines.push(
    "_Перед публикацией проверьте технические значения и коммерческие формулировки у ответственного менеджера._",
  );

  return lines.join("\n");
}
