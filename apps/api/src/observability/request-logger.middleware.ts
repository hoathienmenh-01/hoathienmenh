/**
 * Phase 17.3 — Express middleware: gán `requestId` + log start/end mỗi
 * request với `method`, `path`, `statusCode`, `durationMs`, `userId`,
 * `characterId` (nếu auth user attach lên `req.user`).
 *
 * KHÔNG log body — chỉ metadata an toàn. Header redact qua Pino redact
 * paths (logger.ts).
 *
 * Thiết kế thuần Express middleware (không phụ thuộc Nest decorator) để
 * có thể app.use() ở main.ts và test bằng mock req/res.
 */
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger as PinoLogger } from 'pino';
import { getLogger } from './logger';

/**
 * Request shape mở rộng — gắn bởi middleware. Dùng intersection type
 * thay cho `declare module` augmentation để tránh quirk module
 * resolution của pnpm + `@types/express-serve-static-core`.
 */
export type RequestWithLog = Request & {
  requestId?: string;
  log?: PinoLogger;
};

const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestLoggerOptions {
  /** Path prefixes bị skip log (vd healthz, readyz spam). */
  skipPathPrefixes?: string[];
  /** Override logger (test). Mặc định lấy singleton. */
  logger?: PinoLogger;
}

/**
 * Tạo middleware. Mỗi request:
 * 1. Lấy header `x-request-id` (nếu có upstream) hoặc sinh UUID v4 mới.
 * 2. Set header response `x-request-id` để client (FE) gắn vào Sentry breadcrumb.
 * 3. Gắn `req.requestId` + `req.log` (child logger) cho downstream handler.
 * 4. Log info "request done" khi response finish: { requestId, method, path, statusCode, durationMs, userId, characterId }.
 */
export function createRequestLoggerMiddleware(
  options: RequestLoggerOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const skipPrefixes = options.skipPathPrefixes ?? [
    '/api/healthz',
    '/api/readyz',
  ];

  return function requestLogger(
    rawReq: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const req = rawReq as RequestWithLog;
    const baseLogger = options.logger ?? getLogger();
    const startedAt = Date.now();
    const incoming =
      typeof req.headers[REQUEST_ID_HEADER] === 'string'
        ? (req.headers[REQUEST_ID_HEADER] as string).slice(0, 64)
        : undefined;
    const requestId = isSafeRequestId(incoming) ? incoming! : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    req.log = baseLogger.child({ requestId });

    if (shouldSkip(req.path ?? req.url, skipPrefixes)) {
      next();
      return;
    }

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const userId = readUserId(req);
      const characterId = readCharacterId(req);

      baseLogger.info(
        {
          requestId,
          method: req.method,
          path: stripQuery(req.originalUrl ?? req.url ?? ''),
          statusCode: res.statusCode,
          durationMs,
          ...(userId !== undefined ? { userId } : {}),
          ...(characterId !== undefined ? { characterId } : {}),
        },
        'request done',
      );
    });

    next();
  };
}

function shouldSkip(p: string | undefined, prefixes: string[]): boolean {
  if (!p) return false;
  return prefixes.some((pre) => p.startsWith(pre));
}

function stripQuery(u: string): string {
  const idx = u.indexOf('?');
  return idx >= 0 ? u.slice(0, idx) : u;
}

/**
 * Chấp nhận header upstream nếu match shape an toàn (UUID hoặc alphanum
 * `[A-Za-z0-9._-]{1..64}`). Tránh attacker inject newline / control chars
 * vào log line.
 */
function isSafeRequestId(v: string | undefined): boolean {
  if (!v) return false;
  return /^[A-Za-z0-9._-]{1,64}$/.test(v);
}

interface MaybeAuthRequest {
  user?: { sub?: unknown; id?: unknown; userId?: unknown };
  userId?: unknown;
  characterId?: unknown;
  character?: { id?: unknown };
}

function readUserId(req: Request): string | undefined {
  const r = req as unknown as MaybeAuthRequest;
  const v =
    (typeof r.user?.sub === 'string' && r.user.sub) ||
    (typeof r.user?.id === 'string' && r.user.id) ||
    (typeof r.user?.userId === 'string' && r.user.userId) ||
    (typeof r.userId === 'string' && r.userId);
  return v && v.length <= 128 ? v : undefined;
}

function readCharacterId(req: Request): string | undefined {
  const r = req as unknown as MaybeAuthRequest;
  const v =
    (typeof r.characterId === 'string' && r.characterId) ||
    (typeof r.character?.id === 'string' && r.character.id);
  return v && v.length <= 128 ? v : undefined;
}
