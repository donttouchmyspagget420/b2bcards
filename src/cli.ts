import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, type LlmProvider } from "./config";
import { AppError, isAppError } from "./errors";
import { normalizeProduct } from "./domain/product";
import { generateProductCard } from "./services/productCard";
import { createLlmClient } from "./llm/factory";
import { renderMarkdown } from "./render/markdown";

interface CliOptions {
  input?: string;
  format: "json" | "markdown";
  out?: string;
  provider?: LlmProvider;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { format: "json", help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--input" || arg === "-i") {
      options.input = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      const value = argv[index + 1];
      if (value !== "json" && value !== "markdown" && value !== "md") {
        throw new Error("--format должен быть json или markdown");
      }
      options.format = value === "md" ? "markdown" : value;
      index += 1;
      continue;
    }

    if (arg === "--out" || arg === "-o") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--provider" || arg === "-p") {
      const value = argv[index + 1];
      if (value !== "gemini" && value !== "mock") {
        throw new Error("--provider должен быть gemini или mock");
      }
      options.provider = value;
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && !options.input) {
      options.input = arg;
      continue;
    }

    throw new Error(`Неизвестный аргумент: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`AI-карточка товара — CLI

Использование:
  npm run generate -- --input samples/manotom-dm02.json
  npm run generate -- samples/manotom-dm02.json --format markdown --out examples/manotom-dm02.md
  npm run generate -- samples/manotom-dm02.json --provider mock

Опции:
  -i, --input <file>       JSON-файл с товаром (обязательно)
  -f, --format <json|md>   Формат вывода (по умолчанию json)
  -o, --out <file>         Записать результат в файл
  -p, --provider <name>    gemini или mock
  -h, --help               Показать справку

JSON товара:
{
  "name": "Манометр показывающий DM 02",
  "manufacturer": "Манотомь",
  "specs": { "диапазон измерений": "0–1,6 МПа" },
  "description": "Прибор предназначен для измерения избыточного давления..."
}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.input) {
    throw new Error("Укажите JSON-файл: --input samples/example.json");
  }

  const inputPath = path.resolve(process.cwd(), options.input);
  const raw = await readFile(inputPath, "utf8");

  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new AppError(`Файл ${options.input} не является корректным JSON`, {
      statusCode: 400,
      code: "INVALID_JSON",
      cause: error,
    });
  }

  const product = normalizeProduct(json);
  const llm = createLlmClient({ ...config, provider: options.provider ?? config.provider });
  const result = await generateProductCard(product, llm);
  const output =
    options.format === "markdown" ? renderMarkdown(result) : JSON.stringify(result, null, 2);

  if (options.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    await writeFile(outPath, `${output}\n`, "utf8");
    console.error(`Записано: ${outPath}`);
    return;
  }

  process.stdout.write(`${output}\n`);
}

main().catch((error: unknown) => {
  if (isAppError(error)) {
    console.error(`Ошибка [${error.code}]: ${error.message}`);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  } else {
    console.error("Ошибка:", error instanceof Error ? error.message : error);
  }

  process.exitCode = 1;
});
