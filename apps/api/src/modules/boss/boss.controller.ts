import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@prisma/client';
import { z } from 'zod';
import { BossError, BossService } from './boss.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

const AttackInput = z.object({
  skillKey: z.string().max(64).optional(),
  /**
   * Phase 12.6 — bossId optional cho multi-region disambiguation. Nếu
   * không truyền → fallback "primary" boss (1st ACTIVE found, most
   * recent spawn) cho backwards-compat singleton UI Phase 7.
   */
  bossId: z.string().min(1).max(64).optional(),
});

const AdminSpawnInput = z.object({
  bossKey: z.string().min(1).max(64).optional(),
  level: z.number().int().min(1).max(10).optional(),
  force: z.boolean().optional(),
  /**
   * Phase 12.6 — explicit region cho admin spawn (default 'world' cho
   * legacy world boss). Nếu `bossKey` cũng truyền in, def.regionKey
   * phải match `regionKey` (catalog null → 'world'); mismatch → throw
   * INVALID_BOSS_KEY.
   */
  regionKey: z.string().min(1).max(64).optional(),
  /**
   * Phase 13.1.C — optional admin intent string ghi vào audit
   * `ADMIN_FORCE_BOSS_SCHEDULE` (paper trail). Trim whitespace + cap
   * 200 ký tự. Empty/whitespace-only → null trong audit meta.
   */
  reason: z.string().max(200).optional(),
});

/**
 * Phase 12.6 — region key path validator. Conservative regex: lowercase
 * alpha + underscore + digit (cùng convention với `RegionKey` union ở
 * `@xuantoi/shared/src/map-regions.ts`). Match `'world'`, `'hac_lam'`,
 * `'kim_son_mach'`, v.v. — reject path traversal hoặc special char.
 */
const REGION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

type AdminReq = Request & { userId: string; role: Role };

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('boss')
export class BossController {
  constructor(
    private readonly boss: BossService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async getViewer(req: Request): Promise<{
    userId: string | null;
    characterId: string | null;
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) return { userId: null, characterId: null };
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    return { userId, characterId: c?.id ?? null };
  }

  @Get('current')
  async current(@Req() req: Request) {
    const { characterId } = await this.getViewer(req);
    const boss = await this.boss.getCurrent(characterId);
    return { ok: true, data: { boss } };
  }

  /**
   * Phase 12.6 — list tất cả ACTIVE boss across regions. FE BossView dùng
   * endpoint này để render region tabs. Sorted theo regionKey ascending
   * (deterministic UI ordering).
   */
  @Get('active')
  async active(@Req() req: Request) {
    const { characterId } = await this.getViewer(req);
    const bosses = await this.boss.listActive(characterId);
    return { ok: true, data: { bosses } };
  }

  /**
   * Phase 12.6 — boss ACTIVE trong region cụ thể (≤1 do partial unique
   * `WorldBoss_status_region_active_unique`). Null nếu region trống slot.
   */
  @Get('region/:regionKey')
  async region(@Req() req: Request, @Param('regionKey') regionKey: string) {
    if (!REGION_KEY_PATTERN.test(regionKey)) {
      fail('INVALID_REGION_KEY');
    }
    const { characterId } = await this.getViewer(req);
    const boss = await this.boss.getCurrentByRegion(regionKey, characterId);
    return { ok: true, data: { boss } };
  }

  @Post('attack')
  @HttpCode(200)
  async attack(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    await this.featureFlags.requireEnabled('BOSS_ENABLED');
    const parsed = AttackInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.boss.attack(
        userId,
        parsed.data.skillKey,
        parsed.data.bossId,
      );
      return { ok: true, data: r };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('admin/spawn')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @RequireAdmin()
  async adminSpawn(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = AdminSpawnInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.boss.adminSpawn(req.userId, parsed.data);
      return { ok: true, data: r };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof BossError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NO_ACTIVE_BOSS':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'COOLDOWN':
          fail(e.code, HttpStatus.TOO_MANY_REQUESTS);
        // eslint-disable-next-line no-fallthrough
        case 'SKILL_NOT_USABLE':
        case 'INVALID_BOSS_KEY':
        case 'INVALID_LEVEL':
        // Phase 12.6 — INVALID_REGION_KEY thực ra surface qua `fail()` ở
        // path validation chứ không vào BossError, nhưng giữ branch để
        // exhaustive switch.
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'BOSS_DEFEATED':
        case 'STAMINA_LOW':
        case 'MP_LOW':
        case 'HP_LOW':
        case 'BOSS_ALREADY_ACTIVE':
        case 'CONTROLLED':
        case 'CULTIVATION_BLOCKED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
