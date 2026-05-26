/**
 * Backend Logger — Pino-based structured logging for Node.js
 */
import pino from 'pino';
import type { Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from 'pino';
import { REDACT_PATHS } from '../redact';
import type { LoggerOptions, LogLevel } from '../types';

export { NestLoggerAdapter } from './nest-adapter';

/**
 * Build Pino options based on environment and user options.
 */
export function buildLoggerOptions(options: LoggerOptions = {}): PinoLoggerOptions {
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();

  // Default log level by environment
  const defaultLevel: LogLevel =
    env === 'production' ? 'info' : env === 'test' ? 'warn' : 'debug';

  const level = options.level ?? (process.env.LOG_LEVEL as LogLevel) ?? defaultLevel;
  const redact = options.redact ?? (process.env.LOG_REDACT !== 'false');
  const pretty = options.pretty ?? (process.env.LOG_PRETTY === 'true' || env === 'development');

  const pinoOptions: PinoLoggerOptions = {
    level,
    base: {
      service: 'xuantoi-api',
      env,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  // Redaction config
  if (redact) {
    pinoOptions.redact = {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
      remove: false,
    };
  }

  // Pretty print for development (requires pino-pretty installed)
  if (pretty && env !== 'production') {
    try {
      // Check if pino-pretty is available before setting transport
      require.resolve('pino-pretty');
      pinoOptions.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    } catch {
      // pino-pretty not installed, fall back to JSON
    }
  }

  return pinoOptions;
}

/**
 * Create a backend logger instance (Pino).
 * No singleton — caller manages instance lifecycle.
 */
export function createBackendLogger(options?: LoggerOptions): PinoLogger {
  return pino(buildLoggerOptions(options));
}
