import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, type LlmProvider } from "../src/config";
import { normalizeProduct } from "../src/domain/product";
import { createLlmClient } from "../src/llm/factory";
import { renderMarkdown } from "../src/render/markdown";
import { generateProductCard } from "../src/services/productCard";

function getProviderArg(): LlmProvider {
  const index = process.argv.indexOf("--provider");
  if (index === -1) return config.provider;

  const value = process.argv[index + 1];
  if (value !== "gemini" && value !== "mock") {
    throw new Error("--provider должен быть gemini или mock");
  }

  return value;
}

async function main(): Promise<void> {
  const provider = getProviderArg();
  const samplesDir = path.resolve(process.cwd(), "samples");
  const examplesDir = path.resolve(process.cwd(), "examples");
  const files = (await readdir(samplesDir))
    .filter((file) => file.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error("В samples/ нет JSON-файлов");
  }

  await mkdir(examplesDir, { recursive: true });
  const llm = createLlmClient({ ...config, provider });

  for (const file of files) {
    const inputPath = path.join(samplesDir, file);
    const raw = await readFile(inputPath, "utf8");
    const product = normalizeProduct(JSON.parse(raw));
    const result = await generateProductCard(product, llm);
    const base = file.replace(/\.json$/, "");

    await writeFile(
      path.join(examplesDir, `${base}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(examplesDir, `${base}.md`),
      `${renderMarkdown(result)}\n`,
      "utf8",
    );

    console.log(
      `✓ ${product.name}: ${result.quality.titleLength} симв. заголовок, ${result.quality.descriptionLength} симв. описание, провайдер ${result.meta.provider}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("Не удалось сгенерировать примеры:", error instanceof Error ? error.message : error);
  console.error(
    "Проверьте GEMINI_API_KEY в .env. Для офлайн-проверки: npm run examples -- --provider mock",
  );
  process.exitCode = 1;
});
