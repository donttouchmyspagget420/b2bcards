import { createApp } from "./app";
import { config } from "./config";

const app = createApp({ config });

const server = app.listen(config.port, () => {
  console.log(`AI-карточка товара: http://localhost:${config.port}`);
  console.log(`Провайдер: ${config.provider}, модель: ${config.provider === "mock" ? "mock" : config.geminiModel}`);

  if (config.provider === "gemini" && !config.geminiApiKey) {
    console.warn(
      "GEMINI_API_KEY не задан. Сервер запущен, но генерация вернёт 503. Добавьте ключ в .env или запустите с LLM_PROVIDER=mock.",
    );
  }
});

function shutdown(signal: string): void {
  console.log(`Получен ${signal}, останавливаем сервер...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
