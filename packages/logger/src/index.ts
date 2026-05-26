/**
 * @xuantoi/logger — Unified logging infrastructure
 *
 * Platform-agnostic types and utilities.
 * Import backend/frontend from subpaths:
 * - `@xuantoi/logger/backend` — Pino-based logger for Node.js
 * - `@xuantoi/logger/frontend` — Console-based logger for browser
 */

export type { LogLevel, LogContext, Logger, LoggerOptions } from './types';
export { REDACT_PATHS, FRONTEND_LOG_SIZE_LIMIT, redactSensitiveData } from './redact';

// Note: Backend and frontend loggers are imported via subpaths
// import { createBackendLogger } from '@xuantoi/logger/backend';
// import { createFrontendLogger } from '@xuantoi/logger/frontend';
