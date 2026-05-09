import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { captureException } from '../observability/sentry';
import type { RequestWithLog } from '../observability/request-logger.middleware';

interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string };
}

/**
 * Chuẩn hoá MỌI lỗi unhandled về envelope { ok: false, error: { code, message } }.
 * - HttpException đã có body envelope: pass-through.
 * - HttpException body string: bọc thành envelope với code = HTTP status name.
 * - Lỗi khác: log + trả 500 INTERNAL_ERROR.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>() as RequestWithLog | undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // 5xx HttpException vẫn capture để debug. 4xx (client error) skip.
      if (status >= 500) {
        captureException(exception, {
          requestId: typeof req?.requestId === 'string' ? req.requestId : undefined,
          userId: readUserId(req),
        });
      }
      if (this.isApiErrorBody(body)) {
        res.status(status).json(body);
        return;
      }
      const code = this.codeFromStatus(status);
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: unknown })?.message as string | undefined) ?? code;
      res.status(status).json({
        ok: false,
        error: { code, message },
      } satisfies ApiErrorBody);
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    captureException(exception, {
      requestId: typeof req?.requestId === 'string' ? req.requestId : undefined,
      userId: readUserId(req),
    });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR' },
    } satisfies ApiErrorBody);
  }

  private isApiErrorBody(b: unknown): b is ApiErrorBody {
    return (
      typeof b === 'object' &&
      b !== null &&
      (b as { ok?: unknown }).ok === false &&
      typeof (b as { error?: unknown }).error === 'object'
    );
  }

  // (helper ngoài class — defined ở dưới)

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
    }
  }
}

interface MaybeAuthRequest {
  user?: { sub?: unknown; id?: unknown };
}

function readUserId(req: RequestWithLog | undefined): string | undefined {
  if (!req) return undefined;
  const r = req as unknown as MaybeAuthRequest;
  if (typeof r.user?.sub === 'string') return r.user.sub;
  if (typeof r.user?.id === 'string') return r.user.id;
  return undefined;
}
