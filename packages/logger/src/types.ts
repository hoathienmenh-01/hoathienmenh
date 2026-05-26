/**
 * Core Logger Types — Platform-agnostic
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  [key: string]: unknown;
  requestId?: string;
  userId?: string;
  characterId?: string;
  traceId?: string;
}

export interface Logger {
  trace(context: LogContext, message: string): void;
  trace(message: string): void;

  debug(context: LogContext, message: string): void;
  debug(message: string): void;

  info(context: LogContext, message: string): void;
  info(message: string): void;

  warn(context: LogContext, message: string): void;
  warn(message: string): void;

  error(context: LogContext, message: string): void;
  error(error: Error, message?: string): void;
  error(message: string): void;

  fatal(context: LogContext, message: string): void;
  fatal(error: Error, message?: string): void;
  fatal(message: string): void;

  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  redact?: boolean;
  pretty?: boolean;
  destination?: 'stdout' | 'stderr' | 'file';
  filePath?: string;
}
