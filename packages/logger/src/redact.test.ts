/**
 * Redaction Tests
 */
import { describe, it, expect } from 'vitest';
import { redactSensitiveData, REDACT_PATHS, FRONTEND_LOG_SIZE_LIMIT } from './redact';

describe('redactSensitiveData', () => {
  it('should redact top-level password', () => {
    const input = { username: 'alice', password: 'secret123' };
    const output = redactSensitiveData(input);
    expect(output).toEqual({ username: 'alice', password: '[REDACTED]' });
  });

  it('should redact nested token (1-level)', () => {
    const input = { user: { id: 1, token: 'abc123' } };
    const output = redactSensitiveData(input);
    expect(output).toEqual({ user: { id: 1, token: '[REDACTED]' } });
  });

  it('should redact array of objects with secrets', () => {
    const input = [
      { username: 'alice', password: 'secret1' },
      { username: 'bob', apiKey: 'key123' },
    ];
    const output = redactSensitiveData(input);
    expect(output).toEqual([
      { username: 'alice', password: '[REDACTED]' },
      { username: 'bob', apiKey: '[REDACTED]' },
    ]);
  });

  it('should not redact safe fields', () => {
    const input = { username: 'alice', id: 123, email: 'alice@example.com' };
    const output = redactSensitiveData(input);
    expect(output).toEqual({ username: 'alice', id: 123, email: 'alice@example.com' });
  });

  it('should handle empty object', () => {
    expect(redactSensitiveData({})).toEqual({});
  });

  it('should handle null and undefined', () => {
    expect(redactSensitiveData(null)).toBe(null);
    expect(redactSensitiveData(undefined)).toBe(undefined);
  });

  it('should handle primitives', () => {
    expect(redactSensitiveData('string')).toBe('string');
    expect(redactSensitiveData(123)).toBe(123);
    expect(redactSensitiveData(true)).toBe(true);
  });

  it('should handle circular references', () => {
    const obj: any = { username: 'alice' };
    obj.self = obj;
    const output = redactSensitiveData(obj);
    // Circular reference causes JSON.stringify to fail, returns error string
    expect(typeof output).toBe('string');
    expect(output).toBe('[OBJECT_NOT_SERIALIZABLE]');
  });

  it('should handle size guard for large objects', () => {
    // Create object > 100KB
    const largeArray = new Array(10000).fill('x'.repeat(100));
    const largeObj = { data: largeArray };
    const output = redactSensitiveData(largeObj);
    expect(typeof output).toBe('string');
    expect(output).toMatch(/\[OBJECT_TOO_LARGE: \d+\.\d+KB\]/);
  });

  it('should redact multiple sensitive fields', () => {
    const input = {
      username: 'alice',
      password: 'secret',
      token: 'abc',
      apiKey: 'key',
      secret: 'shhh',
      creditCard: '1234',
    };
    const output = redactSensitiveData(input);
    expect(output).toEqual({
      username: 'alice',
      password: '[REDACTED]',
      token: '[REDACTED]',
      apiKey: '[REDACTED]',
      secret: '[REDACTED]',
      creditCard: '[REDACTED]',
    });
  });

  it('should redact case-insensitive field names', () => {
    const input = {
      Password: 'secret',
      TOKEN: 'abc',
      ApiKey: 'key',
    };
    const output = redactSensitiveData(input);
    expect(output).toEqual({
      Password: '[REDACTED]',
      TOKEN: '[REDACTED]',
      ApiKey: '[REDACTED]',
    });
  });
});

describe('REDACT_PATHS', () => {
  it('should include common sensitive paths', () => {
    expect(REDACT_PATHS).toContain('password');
    expect(REDACT_PATHS).toContain('token');
    expect(REDACT_PATHS).toContain('apiKey');
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
  });

  it('should have at least 20 paths', () => {
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('FRONTEND_LOG_SIZE_LIMIT', () => {
  it('should be 100KB', () => {
    expect(FRONTEND_LOG_SIZE_LIMIT).toBe(100 * 1024);
  });
});
