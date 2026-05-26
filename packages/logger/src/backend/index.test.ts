/**
 * Backend Logger Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBackendLogger, buildLoggerOptions } from './index';

describe('createBackendLogger', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_REDACT;
  });

  it('should create a Pino logger instance', () => {
    const logger = createBackendLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('should respect custom log level', () => {
    const logger = createBackendLogger({ level: 'warn' });
    expect(logger.level).toBe('warn');
  });

  it('should default to info level in production', () => {
    process.env.NODE_ENV = 'production';
    const logger = createBackendLogger();
    expect(logger.level).toBe('info');
  });

  it('should default to debug level in development', () => {
    process.env.NODE_ENV = 'development';
    // Disable pretty print in tests to avoid pino-pretty dependency
    const logger = createBackendLogger({ pretty: false });
    expect(logger.level).toBe('debug');
  });

  it('should default to warn level in test', () => {
    process.env.NODE_ENV = 'test';
    const logger = createBackendLogger();
    expect(logger.level).toBe('warn');
  });

  it('should respect LOG_LEVEL environment variable', () => {
    process.env.LOG_LEVEL = 'error';
    const logger = createBackendLogger();
    expect(logger.level).toBe('error');
  });

  it('should enable redaction by default', () => {
    const options = buildLoggerOptions();
    expect(options.redact).toBeDefined();
    expect(options.redact).toHaveProperty('paths');
  });

  it('should disable redaction when LOG_REDACT=false', () => {
    process.env.LOG_REDACT = 'false';
    const options = buildLoggerOptions();
    expect(options.redact).toBeUndefined();
  });

  it('should create child logger with bindings', () => {
    const logger = createBackendLogger();
    const child = logger.child({ module: 'TestModule' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});

describe('buildLoggerOptions', () => {
  it('should include service name in base', () => {
    const options = buildLoggerOptions();
    expect(options.base).toHaveProperty('service', 'xuantoi-api');
  });

  it('should include environment in base', () => {
    process.env.NODE_ENV = 'production';
    const options = buildLoggerOptions();
    expect(options.base).toHaveProperty('env', 'production');
  });

  it('should use ISO timestamp', () => {
    const options = buildLoggerOptions();
    expect(options.timestamp).toBeDefined();
  });
});
