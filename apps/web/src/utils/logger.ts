/**
 * Frontend Logger — Configured instance for web app
 */
import { createFrontendLogger } from '@xuantoi/logger/frontend';

// Create logger with environment-aware defaults
export const logger = createFrontendLogger({
  level: import.meta.env.PROD ? 'warn' : 'debug',
  redact: import.meta.env.PROD,
});
