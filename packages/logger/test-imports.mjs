// Test subpath imports
import { createBackendLogger } from '@xuantoi/logger/backend';
import { createFrontendLogger } from '@xuantoi/logger/frontend';
import { REDACT_PATHS } from '@xuantoi/logger/redact';

console.log('✓ Backend logger import works');
console.log('✓ Frontend logger import works');
console.log('✓ Redact import works');
console.log(`✓ REDACT_PATHS has ${REDACT_PATHS.length} paths`);

const backendLogger = createBackendLogger({ level: 'info', pretty: false });
backendLogger.info('Backend logger test');
console.log('✓ Backend logger created and logged');

const frontendLogger = createFrontendLogger({ level: 'info' });
frontendLogger.info('Frontend logger test');
console.log('✓ Frontend logger created and logged');

console.log('\n✅ All subpath imports work correctly!');
