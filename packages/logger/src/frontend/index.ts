/**
 * Frontend Logger — Console-based logging for browser
 */
import { redactSensitiveData } from '../redact';
import type { Logger, LoggerOptions, LogLevel, LogContext } from '../types';

/**
 * Log level priority (higher = more severe)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * Frontend logger implementation using console API.
 * Supports level filtering, redaction, and context binding.
 */
class FrontendLogger implements Logger {
  private readonly level: LogLevel;
  private readonly redact: boolean;
  private readonly bindings: LogContext;

  constructor(options: LoggerOptions = {}, bindings: LogContext = {}) {
    // Default level: warn in production, debug in development
    const isProd = typeof window !== 'undefined' &&
      typeof process !== 'undefined' &&
      process.env.NODE_ENV === 'production';
    this.level = options.level ?? (isProd ? 'warn' : 'debug');
    this.redact = options.redact ?? isProd;
    this.bindings = bindings;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const mergedContext = { ...this.bindings, ...context };
    const contextStr = Object.keys(mergedContext).length > 0
      ? ` ${JSON.stringify(mergedContext)}`
      : '';
    return `[${level.toUpperCase()}] ${message}${contextStr}`;
  }

  private processContext(context: LogContext): LogContext {
    return this.redact ? (redactSensitiveData(context) as LogContext) : context;
  }

  trace(contextOrMessage: LogContext | string, message?: string): void {
    if (!this.shouldLog('trace')) return;

    if (typeof contextOrMessage === 'string') {
      console.debug(this.formatMessage('trace', contextOrMessage));
    } else {
      const ctx = this.processContext(contextOrMessage);
      console.debug(this.formatMessage('trace', message!, ctx));
    }
  }

  debug(contextOrMessage: LogContext | string, message?: string): void {
    if (!this.shouldLog('debug')) return;

    if (typeof contextOrMessage === 'string') {
      console.debug(this.formatMessage('debug', contextOrMessage));
    } else {
      const ctx = this.processContext(contextOrMessage);
      console.debug(this.formatMessage('debug', message!, ctx));
    }
  }

  info(contextOrMessage: LogContext | string, message?: string): void {
    if (!this.shouldLog('info')) return;

    if (typeof contextOrMessage === 'string') {
      console.log(this.formatMessage('info', contextOrMessage));
    } else {
      const ctx = this.processContext(contextOrMessage);
      console.log(this.formatMessage('info', message!, ctx));
    }
  }

  warn(contextOrMessage: LogContext | string, message?: string): void {
    if (!this.shouldLog('warn')) return;

    if (typeof contextOrMessage === 'string') {
      console.warn(this.formatMessage('warn', contextOrMessage));
    } else {
      const ctx = this.processContext(contextOrMessage);
      console.warn(this.formatMessage('warn', message!, ctx));
    }
  }

  error(contextOrMessageOrError: LogContext | string | Error, message?: string): void {
    if (!this.shouldLog('error')) return;

    if (contextOrMessageOrError instanceof Error) {
      const err = contextOrMessageOrError;
      console.error(this.formatMessage('error', message ?? err.message), err);
    } else if (typeof contextOrMessageOrError === 'string') {
      console.error(this.formatMessage('error', contextOrMessageOrError));
    } else {
      const ctx = this.processContext(contextOrMessageOrError);
      console.error(this.formatMessage('error', message!, ctx));
    }
  }

  fatal(contextOrMessageOrError: LogContext | string | Error, message?: string): void {
    if (!this.shouldLog('fatal')) return;

    if (contextOrMessageOrError instanceof Error) {
      const err = contextOrMessageOrError;
      console.error(this.formatMessage('fatal', message ?? err.message), err);
    } else if (typeof contextOrMessageOrError === 'string') {
      console.error(this.formatMessage('fatal', contextOrMessageOrError));
    } else {
      const ctx = this.processContext(contextOrMessageOrError);
      console.error(this.formatMessage('fatal', message!, ctx));
    }
  }

  child(bindings: LogContext): Logger {
    return new FrontendLogger(
      { level: this.level, redact: this.redact },
      { ...this.bindings, ...bindings }
    );
  }
}

/**
 * Create a frontend logger instance.
 */
export function createFrontendLogger(options?: LoggerOptions): Logger {
  return new FrontendLogger(options);
}
