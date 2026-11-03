import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config";
import { config as defaultConfig } from "./config";
import { AppError, isAppError } from "./errors";
import { normalizeProduct } from "./domain/product";
import { generateProductCard } from "./services/productCard";
import { createLlmClient } from "./llm/factory";
import type { LlmClient } from "./llm/types";
import { renderMarkdown } from "./render/markdown";

export interface CreateAppOptions {
  config?: AppConfig;
  /** Явная подстановка клиента нужна в тестах. `null` — намеренно без LLM. */
  llm?: LlmClient | null;
  rootDir?: string;
}

function wantsMarkdown(accept: string | undefined, format: unknown): boolean {
  return (
    format === "markdown" ||
    format === "md" ||
    Boolean(accept?.toLowerCase().includes("text/markdown"))
  );
}

export function createApp(options: CreateAppOptions = {}) {
  const appConfig = options.config ?? defaultConfig;
  const rootDir = options.rootDir ?? process.cwd();
  const app = express();

  let llm: LlmClient | null;
  let llmInitError: unknown;

  if (options.llm !== undefined) {
    llm = options.llm;
  } else {
    try {
      llm = createLlmClient(appConfig);
    } catch (error) {
      llm = null;
      llmInitError = error;
    }
  }

  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-Id", res.locals.requestId);
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.use("/samples", express.static(path.join(rootDir, "samples"), { index: false }));
  app.use(express.static(path.join(rootDir, "public"), { index: "index.html" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      provider: appConfig.provider,
      model: appConfig.provider === "mock" ? "mock" : appConfig.geminiModel,
      llmConfigured: Boolean(llm),
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/generate", async (req, res, next) => {
    try {
      if (!llm) {
        if (isAppError(llmInitError)) throw llmInitError;

        throw new AppError(
          "LLM не настроена. Укажите GEMINI_API_KEY в .env или включите LLM_PROVIDER=mock.",
          { statusCode: 503, code: "LLM_CONFIG" },
        );
      }

      if (
        req.body &&
        typeof req.body === "object" &&
        !Array.isArray(req.body) &&
        "product" in req.body
      ) {
        req.body = (req.body as { product: unknown }).product;
      }

      const product = normalizeProduct(req.body);
      const result = await generateProductCard(product, llm);

      if (wantsMarkdown(req.header("accept"), req.query.format)) {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.send(renderMarkdown(result));
        return;
      }

      if (req.query.include === "markdown") {
        res.json({ ...result, markdown: renderMarkdown(result) });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Метод API не найден",
      },
    });
  });

  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;

      const bodyParserType =
        error && typeof error === "object" && "type" in error
          ? String((error as { type?: unknown }).type)
          : "";

      if (bodyParserType === "entity.too.large") {
        res.status(413).json({
          error: {
            code: "INVALID_INPUT",
            message: "Тело запроса больше 1 МБ",
            requestId: res.locals.requestId,
          },
        });
        return;
      }

      if (
        bodyParserType === "entity.parse.failed" ||
        (error instanceof SyntaxError && "body" in error)
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_JSON",
            message: "Тело запроса не является корректным JSON",
            requestId: res.locals.requestId,
          },
        });
        return;
      }

      if (isAppError(error)) {
        res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            requestId: res.locals.requestId,
          },
        });
        return;
      }

      console.error(`[${res.locals.requestId}]`, error);
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Внутренняя ошибка сервиса",
          requestId: res.locals.requestId,
        },
      });
    },
  );

  return app;
}
