/**
 * Redaction Policy — Sensitive data paths and redaction logic
 */

/**
 * Sensitive field paths to redact. Pino uses these paths for backend.
 * Frontend uses runtime redaction with same paths.
 */
export const REDACT_PATHS = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',

  // Body / query / params common secret keys (1-level deep wildcard)
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.refresh_token',
  '*.access_token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.session',
  '*.creditCard',
  '*.cardNumber',
  '*.cvv',

  // Direct top-level paths
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
];

/**
 * Frontend size limit to prevent UI lag on large objects.
 * If serialized object > 100KB, log "[OBJECT_TOO_LARGE]" instead.
 */
export const FRONTEND_LOG_SIZE_LIMIT = 100 * 1024; // 100KB

/**
 * Redact sensitive data from an object (deep clone + replace matched paths).
 * Used by frontend logger (Pino has built-in redact for backend).
 *
 * Guards:
 * 1. Circular reference — use WeakSet to track visited objects
 * 2. Size limit — if serialized > 100KB, return "[OBJECT_TOO_LARGE: XKB]"
 * 3. Only check top-level + 1-level nested (performance trade-off)
 */
export function redactSensitiveData(obj: unknown): unknown {
  // Primitives pass through
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  // Size guard — check before deep clone
  try {
    const serialized = JSON.stringify(obj);
    const sizeKB = serialized.length / 1024;
    if (sizeKB > FRONTEND_LOG_SIZE_LIMIT / 1024) {
      return `[OBJECT_TOO_LARGE: ${sizeKB.toFixed(1)}KB]`;
    }
  } catch (err) {
    // Circular reference or other serialization error
    return '[OBJECT_NOT_SERIALIZABLE]';
  }

  // Circular reference guard
  const visited = new WeakSet<object>();

  function redactRecursive(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    // Max depth = 2 (top-level + 1-level nested)
    if (depth > 2) return value;

    // Circular reference check
    if (visited.has(value as object)) {
      return '[CIRCULAR]';
    }
    visited.add(value as object);

    // Array
    if (Array.isArray(value)) {
      return value.map((item) => redactRecursive(item, depth + 1));
    }

    // Object
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Check if key matches sensitive patterns
      const lowerKey = key.toLowerCase();
      const isSensitive =
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('cookie') ||
        lowerKey.includes('session') ||
        lowerKey.includes('creditcard') ||
        lowerKey.includes('cardnumber') ||
        lowerKey.includes('cvv');

      if (isSensitive) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactRecursive(val, depth + 1);
      }
    }
    return result;
  }

  return redactRecursive(obj, 0);
}
