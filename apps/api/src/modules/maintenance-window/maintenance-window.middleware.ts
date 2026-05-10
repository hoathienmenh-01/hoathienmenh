/**
 * Phase 15.5 — Maintenance Window guard middleware.
 *
 * NestJS class-based middleware (`NestMiddleware`) — gắn qua
 * `MaintenanceWindowModule.configure()` cho `forRoutes('*')`.
 *
 * Trách nhiệm:
 *   1. `getActiveWindow(now)` — fast path nếu cache hit "no active" →
 *      `next()` ngay, không load auth.
 *   2. Nếu có active window: resolve role từ cookie `xt_access`:
 *        - Token thiếu/sai → `ANONYMOUS`.
 *        - Token hợp lệ + user banned/missing → `ANONYMOUS`.
 *        - Token hợp lệ + user OK → role thực tế (ADMIN/MOD/PLAYER).
 *      KHÔNG throw lỗi auth — middleware chỉ phục vụ gating; nếu user
 *      thực sự cần auth (vd admin route), AdminGuard sẽ throw 401/403
 *      sau đó.
 *   3. Gọi `service.isMaintenanceActiveForRequest({ role, path, method })`.
 *      Trả `null` → pass; trả `MaintenanceBlockResult` → render 503
 *      envelope `{ ok: false, error: { code: 'MAINTENANCE_ACTIVE', ... } }`.
 *
 * Bảo vệ tránh khoá ngoài admin:
 *   - `/_auth/*` luôn bypass (trừ `FULL_LOCKDOWN`) — admin login lại được.
 *   - `/healthz` `/readyz` `/version` bypass nếu `allowHealthcheck=true`.
 *   - `/maintenance/status` luôn bypass — FE poll status.
 *
 * Race condition / lỗi:
 *   - Mọi exception bên trong middleware đều được try/catch swallow →
 *     `next()` để không 503 toàn site khi maintenance service lỗi
 *     ngoài luồng (fail-open). Lỗi được log qua Logger.
 */
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import {
  MaintenanceWindowService,
  type RequestRole,
} from './maintenance-window.service';

const ACCESS_COOKIE = 'xt_access';

type CookieMap = Record<string, string | undefined>;

@Injectable()
export class MaintenanceWindowGuardMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MaintenanceWindowGuardMiddleware.name);

  constructor(
    private readonly service: MaintenanceWindowService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date();
      const winner = await this.service.getActiveWindow(now);
      if (!winner) {
        next();
        return;
      }

      const role = await this.resolveRole(req);
      const path = req.path ?? req.originalUrl ?? '';
      const method = String(req.method ?? 'GET').toUpperCase();

      const block = await this.service.isMaintenanceActiveForRequest(
        { role, path, method },
        now,
      );
      if (!block) {
        next();
        return;
      }

      // 503 envelope — mirror AllExceptionsFilter shape:
      //   `{ ok: false, error: { code, message, meta? } }`.
      res
        .status(503)
        .header('Retry-After', String(Math.max(1, retryAfterSeconds(winner.endsAt, now))))
        .json({ ok: false, error: block.payload });
    } catch (err) {
      this.logger.warn(
        `MaintenanceWindowGuardMiddleware error — fail-open. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      next();
    }
  }

  private async resolveRole(req: Request): Promise<RequestRole> {
    const cookies = (req as Request & { cookies?: CookieMap }).cookies;
    const token = cookies?.[ACCESS_COOKIE];
    if (!token) return 'ANONYMOUS';
    let userId: string | null = null;
    try {
      userId = await this.auth.userIdFromAccess(token);
    } catch {
      return 'ANONYMOUS';
    }
    if (!userId) return 'ANONYMOUS';
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, banned: true },
      });
      if (!u || u.banned) return 'ANONYMOUS';
      if (u.role === 'ADMIN' || u.role === 'MOD' || u.role === 'PLAYER') {
        return u.role;
      }
    } catch (err) {
      this.logger.warn(
        `resolveRole DB error — fall back ANONYMOUS. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return 'ANONYMOUS';
  }
}

function retryAfterSeconds(endsAt: Date, now: Date): number {
  const diff = Math.floor((endsAt.getTime() - now.getTime()) / 1000);
  return Number.isFinite(diff) && diff > 0 ? diff : 60;
}
