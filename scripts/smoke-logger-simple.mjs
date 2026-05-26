#!/usr/bin/env node
/**
 * Simple smoke test for @xuantoi/logger package
 */

import { createBackendLogger, NestLoggerAdapter } from '../packages/logger/dist/backend/index.js';
import { createFrontendLogger } from '../packages/logger/dist/frontend/index.js';

console.log('Testing backend logger...');
const backendLogger = createBackendLogger({ level: 'info' });
backendLogger.info('Backend works');

console.log('Testing frontend logger...');
const frontendLogger = createFrontendLogger({ level: 'info' });
frontendLogger.info('Frontend works');

console.log('Testing NestLoggerAdapter...');
const nestAdapter = new NestLoggerAdapter(backendLogger);
nestAdapter.log('NestJS works');

console.log('Testing child logger...');
const child = backendLogger.child({ module: 'test' });
child.info('Child works');

console.log('\n✓ All smoke tests passed');
