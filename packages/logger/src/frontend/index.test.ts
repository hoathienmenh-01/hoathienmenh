/**
 * Frontend Logger Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFrontendLogger } from './index';

describe('createFrontendLogger', () => {
  let consoleDebugSpy: any;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a logger instance', () => {
    const logger = createFrontendLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('should log info messages', () => {
    const logger = createFrontendLogger({ level: 'info' });
    logger.info('Test message');
    expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] Test message');
  });

  it('should log with context', () => {
    const logger = createFrontendLogger({ level: 'info' });
    logger.info({ userId: 123 }, 'User action');
    expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] User action {"userId":123}');
  });

  it('should filter logs below configured level', () => {
    const logger = createFrontendLogger({ level: 'warn' });
    logger.debug('Debug message');
    logger.info('Info message');
    expect(consoleDebugSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log warn and error when level is warn', () => {
    const logger = createFrontendLogger({ level: 'warn' });
    logger.warn('Warning message');
    logger.error('Error message');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN] Warning message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] Error message');
  });

  it('should redact sensitive data when enabled', () => {
    const logger = createFrontendLogger({ level: 'info', redact: true });
    logger.info({ username: 'alice', password: 'secret' }, 'Login');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[REDACTED]')
    );
  });

  it('should not redact when disabled', () => {
    const logger = createFrontendLogger({ level: 'info', redact: false });
    logger.info({ username: 'alice', password: 'secret' }, 'Login');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('secret')
    );
  });

  it('should create child logger with merged bindings', () => {
    const logger = createFrontendLogger({ level: 'info' });
    const child = logger.child({ module: 'AuthModule' });
    child.info('Test');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('AuthModule')
    );
  });

  it('should handle Error objects', () => {
    const logger = createFrontendLogger({ level: 'error' });
    const error = new Error('Test error');
    logger.error(error);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Test error'),
      error
    );
  });

  it('should handle Error with custom message', () => {
    const logger = createFrontendLogger({ level: 'error' });
    const error = new Error('Original error');
    logger.error(error, 'Custom message');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Custom message'),
      error
    );
  });

  it('should log all levels when level is trace', () => {
    const logger = createFrontendLogger({ level: 'trace' });
    logger.trace('Trace');
    logger.debug('Debug');
    logger.info('Info');
    logger.warn('Warn');
    logger.error('Error');
    logger.fatal('Fatal');

    expect(consoleDebugSpy).toHaveBeenCalledTimes(2); // trace + debug
    expect(consoleLogSpy).toHaveBeenCalledTimes(1); // info
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1); // warn
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2); // error + fatal
  });
});
