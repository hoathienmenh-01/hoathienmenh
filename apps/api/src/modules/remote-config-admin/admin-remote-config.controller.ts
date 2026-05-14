/**
 * Phase 45.0 — Admin endpoints cho Remote Config.
 *
 * Endpoints (`@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/remote-config`                    — list.
 *   - `PATCH  /admin/remote-config/:key`               — update value + reason.
 *   - `POST   /admin/remote-config/refresh-defaults`   — lazy seed.
 *   - `POST   /admin/remote-config/clear-cache`        — flush cache.
 *
 * Audit: ghi `AdminAuditLog` action `ADMIN_REMOTE_CONFIG_UPDATE` /
 * `ADMIN_REMOTE_CONFIG_REFRESH_DEFAULTS` / `ADMIN_REMOTE_CONFIG_CLEAR_CACHE`.
 *
 * Body PATCH bắt buộc `reason` ≥ 3 ký tự (anti-typo audit log) — tương
 * tự pattern reward grant Phase 16.x.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  REMOTE_CONFIG_KEYS,
  isRemoteConfigKey,
  type RemoteConfigAdminView,
  type RemoteConfigKey,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  RemoteConfigInvalidKeyError,
  RemoteConfigService,
  RemoteConfigValidationError,
} from '../remote-config/remote-config.service';

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

function fail(
  code: string,
  status = HttpStatus.BAD_REQUEST,
  meta?: Record<string, unknown>,
): never {
  throw new HttpException(
    { ok: false, error: { code, message: code, ...(meta ?? {}) } },
    status,
  );
}

const PatchBodyZ = z
  .object({
    /** Raw JSON value — service validate type/cap qua shared validator. */
    value: z.unknown(),
    /**
     * Audit reason — bắt buộc, ≥ 3 ký tự, ≤ 500. Lưu vào `AdminAuditLog.meta`.
     * Phase 45.0 yêu cầu reason cho mọi mutation flag/config "quan trọng".
     */
    reason: z.string().min(3).max(500),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminRemoteConfigController {
  constructor(
    private readonly service: RemoteConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/remote-config')
  @RequireAdmin()
  async list(): Promise<{
    ok: true;
    data: { configs: RemoteConfigAdminView[] };
  }> {
    const configs = await this.service.listConfigs();
    return { ok: true, data: { configs } };
  }

  @Patch('admin/remote-config/:key')
  @RequireAdmin()
  async update(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: RemoteConfigAdminView }> {
    if (!isRemoteConfigKey(key)) {
      fail('REMOTE_CONFIG_KEY_INVALID', HttpStatus.NOT_FOUND);
    }
    const parsed = PatchBodyZ.safeParse(rawBody);
    if (!parsed.success) {
      fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
        })),
      });
    }
    const { value, reason } = parsed.data;

    let view: RemoteConfigAdminView;
    try {
      view = await this.service.setConfig(req.userId, key, value);
    } catch (e) {
      if (e instanceof RemoteConfigInvalidKeyError) {
        fail('REMOTE_CONFIG_KEY_INVALID', HttpStatus.NOT_FOUND);
      }
      if (e instanceof RemoteConfigValidationError) {
        fail('REMOTE_CONFIG_VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, {
          violations: e.violations.map((v) => ({
            code: v.code,
            message: v.message,
          })),
        });
      }
      throw e;
    }

    await this.audit(req.userId, 'ADMIN_REMOTE_CONFIG_UPDATE', {
      key: view.key,
      valueType: view.valueType,
      value: view.value,
      reason,
    });
    return { ok: true, data: view };
  }

  @Post('admin/remote-config/refresh-defaults')
  @RequireAdmin()
  async refreshDefaults(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: { created: number; existing: number } }> {
    const result = await this.service.ensureDefaultConfigs();
    await this.audit(req.userId, 'ADMIN_REMOTE_CONFIG_REFRESH_DEFAULTS', {
      created: result.created,
      existing: result.existing,
      catalogSize: REMOTE_CONFIG_KEYS.length,
    });
    return { ok: true, data: result };
  }

  @Post('admin/remote-config/clear-cache')
  @RequireAdmin()
  async clearCache(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: { cleared: true } }> {
    await this.service.clearCache();
    await this.audit(req.userId, 'ADMIN_REMOTE_CONFIG_CLEAR_CACHE', {
      catalogSize: REMOTE_CONFIG_KEYS.length,
    });
    return { ok: true, data: { cleared: true } };
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId, action, meta: meta as Prisma.InputJsonValue },
    });
  }
}

export type { RemoteConfigKey };
