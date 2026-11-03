export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_INPUT"
  | "CONFIG_ERROR"
  | "LLM_CONFIG"
  | "LLM_HTTP_ERROR"
  | "LLM_TIMEOUT"
  | "LLM_BLOCKED"
  | "LLM_EMPTY_RESPONSE"
  | "LLM_PARSE_ERROR"
  | "GENERATION_FAILED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: ErrorCode;
      details?: unknown;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
