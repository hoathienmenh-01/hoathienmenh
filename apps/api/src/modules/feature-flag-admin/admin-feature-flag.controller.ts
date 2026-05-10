/**
 * Phase 15.4 — Admin endpoints cho Feature Flag.
 *
 * Endpoints (`@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/feature-flags`                      — list.
 *   - `PATCH  /admin/feature-flags/:key`                 — toggle enabled.
 *   - `POST   /admin/feature-flags/refresh-defaults`     — lazy seed.
 *   - `POST   /admin/feature-flags/clear-cache`          — flush cache.
 *
 * Audit: ghi `AdminAuditLog` action `ADMIN_FEATURE_FLAG_UPDATE` /
 * `ADMIN_FEATURE_FLAG_REFRESH_DEFAULTS` / `ADMIN_FEATURE_FLAG_CLEAR_CACHE`.
 *
 * Validate body qua zod `.strict()` + shared `isFeatureFlagKey` —
 * reject key ngoài catalog.
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
  FEATURE_FLAG_KEYS,
  isFeatureFlagKey,
  type FeatureFlagAdminView,
  type FeatureFlagKey,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  FeatureFlagInvalidKeyError,
  FeatureFlagService,
} from '../feature-flag/feature-flag.service';

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const PatchBodyZ = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
export class AdminFeatureFlagController {
  constructor(
    private readonly service: FeatureFlagService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/feature-flags')
  @RequireAdmin()
  async list(): Promise<{
    ok: true;
    data: { flags: FeatureFlagAdminView[] };
  }> {
    const flags = await this.service.listFlags();
    return { ok: true, data: { flags } };
  }

  @Patch('admin/feature-flags/:key')
  @RequireAdmin()
  async update(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: FeatureFlagAdminView }> {
    if (!isFeatureFlagKey(key)) {
      fail('FEATURE_FLAG_KEY_INVALID', HttpStatus.NOT_FOUND);
    }
    const parsed = PatchBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');

    let view: FeatureFlagAdminView;
    try {
      view = await this.service.setFlag(req.userId, key, parsed.data.enabled);
    } catch (e) {
      if (e instanceof FeatureFlagInvalidKeyError) {
        fail('FEATURE_FLAG_KEY_INVALID', HttpStatus.NOT_FOUND);
      }
      throw e;
    }

    await this.audit(req.userId, 'ADMIN_FEATURE_FLAG_UPDATE', {
      key: view.key,
      enabled: view.enabled,
      defaultEnabled: view.defaultEnabled,
      category: view.category,
    });
    return { ok: true, data: view };
  }

  @Post('admin/feature-flags/refresh-defaults')
  @RequireAdmin()
  async refreshDefaults(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: { created: number; existing: number } }> {
    const result = await this.service.ensureDefaultFlags();
    await this.audit(req.userId, 'ADMIN_FEATURE_FLAG_REFRESH_DEFAULTS', {
      created: result.created,
      existing: result.existing,
      catalogSize: FEATURE_FLAG_KEYS.length,
    });
    return { ok: true, data: result };
  }

  @Post('admin/feature-flags/clear-cache')
  @RequireAdmin()
  async clearCache(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: { cleared: true } }> {
    await this.service.clearCache();
    await this.audit(req.userId, 'ADMIN_FEATURE_FLAG_CLEAR_CACHE', {
      catalogSize: FEATURE_FLAG_KEYS.length,
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

export type { FeatureFlagKey };
