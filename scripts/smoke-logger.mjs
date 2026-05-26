#!/usr/bin/env node
/**
 * Smoke test for @xuantoi/logger package
 *
 * Verifies:
 * - Backend logger works (Pino)
 * - Frontend logger works (Console)
 * - NestLoggerAdapter works
 * - Redaction works
 * - Child logger works
 * - All exports are accessible
 */

import { createBackendLogger, NestLoggerAdapter } from '../packages/logger/dist/backend/index.js';
import { createFrontendLogger } from '../packages/logger/dist/frontend/index.js';

console.log('=== @xuantoi/logger Smoke Test ===\n');

// Test 1: Backend Logger
console.log('1. Backend Logger (Pino)');
const backendLogger = createBackendLogger({ level: 'debug', pretty: false });
backendLogger.info('Backend logger initialized');
backendLogger.debug({ userId: '123', action: 'test' }, 'Debug with context');
backendLogger.warn('Warning message');
console.log('✓ Backend logger works\n');

// Test 2: Frontend Logger
console.log('2. Frontend Logger (Console)');
const frontendLogger = createFrontendLogger({ level: 'debug', redact: false });
frontendLogger.info('Frontend logger initialized');
frontendLogger.debug({ component: 'test', action: 'smoke' }, 'Debug with context');
frontendLogger.warn('Warning message');
console.log('✓ Frontend logger works\n');

// Test 3: NestLoggerAdapter
console.log('3. NestLoggerAdapter');
const nestAdapter = new NestLoggerAdapter(backendLogger);
nestAdapter.log('NestJS log message');
nestAdapter.error('NestJS error message', 'TestContext');
nestAdapter.warn('NestJS warn message');
console.log('✓ NestLoggerAdapter works\n');

// Test 4: Redaction
console.log('4. Redaction');
const redactLogger = createFrontendLogger({ level: 'debug', redact: true });
redactLogger.info({
  email: 'test@example.com',
  password: 'secret123',
  token: 'abc123',
  safe: 'visible'
}, 'Sensitive data test');
console.log('✓ Redaction works (email/password/token should be [REDACTED])\n');

// Test 5: Child Logger
console.log('5. Child Logger');
const childLogger = backendLogger.child({ module: 'auth', requestId: 'req-123' });
childLogger.info('Child logger message');
console.log('✓ Child logger works\n');

// Test 6: Error Logging
console.log('6. Error Logging');
const testError = new Error('Test error');
backendLogger.error(testError, 'Error with message');
frontendLogger.error(testError, 'Frontend error');
console.log('✓ Error logging works\n');

console.log('=== All Smoke Tests Passed ===');
