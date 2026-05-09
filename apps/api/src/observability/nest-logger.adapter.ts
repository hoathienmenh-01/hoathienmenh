/**
 * Phase 17.3 — NestJS LoggerService adapter to route through Pino.
 *
 * NestJS `Logger` mặc định in stdout dạng text với màu. Adapter này
 * map các method (`log/error/warn/debug/verbose/fatal`) → Pino levels
 * để toàn bộ log trong app dùng JSON structured + redact.
 *
 * Usage trong main.ts:
 *   const app = await NestFactory.create(AppModule, { bufferLogs: true });
 *   app.useLogger(new PinoNestLogger(getLogger()));
 *
 * `bufferLogs: true` để Nest buffer log trước khi adapter active, tránh
 * mất log bootstrap.
 */
import type { LoggerService, LogLevel } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(this.toPayload(message, optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(this.toPayload(message, optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(this.toPayload(message, optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(this.toPayload(message, optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(this.toPayload(message, optionalParams));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.fatal(this.toPayload(message, optionalParams));
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Pino level set qua env LOG_LEVEL ở init time. No-op để tương thích
    // interface — Nest CLI có thể call setLogLevels() khi parse `--debug`.
  }

  /**
   * Nest convention: cuối args thường là context string (e.g. "AppModule").
   * Một số call có error stack ở giữa. Adapter chuẩn hoá thành:
   *   { context, msg, stack? }
   */
  private toPayload(
    message: unknown,
    optional: unknown[],
  ): { context?: string; msg: string; stack?: string } {
    const last = optional.length > 0 ? optional[optional.length - 1] : undefined;
    const context =
      typeof last === 'string' && optional.length > 0
        ? (last as string)
        : undefined;

    let stack: string | undefined;
    if (optional.length >= 2) {
      const maybeStack = optional[0];
      if (typeof maybeStack === 'string' && maybeStack.includes('\n')) {
        stack = maybeStack;
      }
    }

    const msg =
      typeof message === 'string' ? message : safeStringify(message);

    return {
      ...(context !== undefined ? { context } : {}),
      ...(stack !== undefined ? { stack } : {}),
      msg,
    };
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
