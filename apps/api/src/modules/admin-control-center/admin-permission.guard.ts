import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ADMIN_ROLE_PERMISSIONS,
  hasAdminPermission,
  isAdminPermissionKey,
  type AdminPermissionKey,
  type AdminRoleKey,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { REQUIRE_ADMIN_PERMISSION_KEY } from './admin-permission.decorator';

const ACCESS_COOKIE = 'xt_access';

/**
 * Phase 27.6 — AdminPermissionGuard.
 *
 * Trách nhiệm:
 *   1. Authenticate qua access cookie (như `AdminGuard`).
 *   2. Đọc User từ DB (không tin token role).
 *   3. Reject PLAYER (`FORBIDDEN`).
 *   4. Map `User.role` → `AdminRoleKey`:
 *      - ADMIN → SUPER_ADMIN (back-compat, có thể override sau qua
 *        AdminRoleAssignment).
 *      - MOD   → MODERATOR.
 *   5. Đọc metadata `REQUIRE_ADMIN_PERMISSION_KEY` (array
 *      `AdminPermissionKey`). Nếu thiếu metadata → KHÔNG check permission
 *      (route mở cho mọi admin/MOD).
 *   6. Kiểm tra `hasAdminPermission(role, perm)` cho TỪNG perm yêu cầu —
 *      thiếu 1 → reject `ADMIN_PERMISSION_DENIED` 403 + `meta.perm`.
 *
 * Phase 27.6 KHÔNG thay thế `AdminGuard` — dùng song song. Module
 * `admin-control-center` dùng `AdminPermissionGuard` riêng. Module
 * cũ giữ nguyên `AdminGuard + @RequireAdmin`.
 *
 * Gắn `userId` + `role` + `adminRole` vào `req` để controller dùng.
 */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & {
        userId?: string;
        role?: 'ADMIN' | 'MOD' | 'PLAYER';
        adminRole?: AdminRoleKey;
      }
    >();
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, banned: true },
    });
    if (!u || u.banned) {
      throw new HttpException(
        { ok: false, error: { code: 'FORBIDDEN', message: 'FORBIDDEN' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (u.role !== 'ADMIN' && u.role !== 'MOD') {
      throw new HttpException(
        { ok: false, error: { code: 'FORBIDDEN', message: 'FORBIDDEN' } },
        HttpStatus.FORBIDDEN,
      );
    }
    const adminRole: AdminRoleKey =
      u.role === 'ADMIN' ? 'SUPER_ADMIN' : 'MODERATOR';

    const required = this.reflector.getAllAndOverride<AdminPermissionKey[]>(
      REQUIRE_ADMIN_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (required && required.length > 0) {
      for (const perm of required) {
        if (!isAdminPermissionKey(perm)) {
          throw new HttpException(
            {
              ok: false,
              error: {
                code: 'ADMIN_PERMISSION_KEY_INVALID',
                message: 'ADMIN_PERMISSION_KEY_INVALID',
              },
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
        if (!hasAdminPermission(adminRole, perm)) {
          throw new HttpException(
            {
              ok: false,
              error: {
                code: 'ADMIN_PERMISSION_DENIED',
                message: 'ADMIN_PERMISSION_DENIED',
                meta: { perm, role: adminRole },
              },
            },
            HttpStatus.FORBIDDEN,
          );
        }
      }
    }

    req.userId = u.id;
    req.role = u.role;
    req.adminRole = adminRole;
    return true;
  }
}

/**
 * Helper pure-fn — không phụ thuộc Nest. Dùng cho service layer kiểm
 * tra permission khi không có decorator (ví dụ gọi từ cron / background
 * job với 1 admin user id).
 */
export function getPermissionsFromUserRole(
  role: 'PLAYER' | 'MOD' | 'ADMIN',
): readonly AdminPermissionKey[] {
  if (role === 'ADMIN') return ADMIN_ROLE_PERMISSIONS.SUPER_ADMIN;
  if (role === 'MOD') return ADMIN_ROLE_PERMISSIONS.MODERATOR;
  return [];
}

export function adminRoleFromUserRole(
  role: 'PLAYER' | 'MOD' | 'ADMIN',
): AdminRoleKey | null {
  if (role === 'ADMIN') return 'SUPER_ADMIN';
  if (role === 'MOD') return 'MODERATOR';
  return null;
}
