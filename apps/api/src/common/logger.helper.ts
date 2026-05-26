/**
 * Logger helper for API modules
 *
 * Provides structured logging with module-specific context.
 * Use this instead of console.log/warn/error for better observability.
 */
import { createBackendLogger } from '@xuantoi/logger/backend';
import type { Logger } from 'pino';

/**
 * Root API logger instance
 */
export const apiLogger = createBackendLogger({
  level: (process.env.LOG_LEVEL as any) ?? undefined,
});

/**
 * Create a child logger with module context
 *
 * @example
 * const logger = createModuleLogger('market');
 * logger.warn({ feeConfig: 'invalid' }, 'Invalid fee config, using default');
 */
export function createModuleLogger(module: string): Logger {
  return apiLogger.child({ module });
}
