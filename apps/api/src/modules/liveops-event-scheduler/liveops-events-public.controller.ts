import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import {
  LiveOpsEventSchedulerError,
  LiveOpsEventSchedulerService,
  type LiveOpsActiveEventPublicView,
  type LiveOpsClaimResult,
} from './liveops-event-scheduler.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 15.3.A — public LiveOps endpoints cho player.
 *
 * Routes:
 *   - GET  /liveops/events/active           → list ACTIVE events public-safe
 *   - POST /liveops/events/:eventKey/claim  → claim FESTIVAL_GIFT 1 lần
 *
 * Auth: cookie-based (xt_access) qua AuthService — anonymous viewer được
 * permit cho `/active` (không lộ admin metadata) nhưng `claim` bắt buộc auth.
 *
 * Error mapping:
 *   - EVENT_NOT_FOUND          → 404
 *   - EVENT_NOT_ACTIVE         → 409
 *   - EVENT_NOT_CLAIMABLE      → 409 (wrong type, e.g. SHOP_DISCOUNT)
 *   - EVENT_ALREADY_CLAIMED    → 409
 *   - NO_CHARACTER             → 404
 *   - EVENT_REWARD_*           → 422 (admin config bug, surfaced as
 *                                 unprocessable for player visibility)
 */
@Controller('liveops/events')
export class LiveOpsEventsPublicController {
  constructor(
    private readonly events: LiveOpsEventSchedulerService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async resolveCharacterId(req: Request): Promise<string | null> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) return null;
    const ch = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    return ch?.id ?? null;
  }

  private async requireCharacterId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const ch = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ch) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return ch.id;
  }

  @Get('active')
  async listActive(
    @Req() req: Request,
  ): Promise<{ ok: true; data: LiveOpsActiveEventPublicView[] }> {
    // Phase 15.4 — runtime gate. Khi LIVEOPS_EVENTS_ENABLED=false,
    // FE nhận `data: []` (empty list) thay vì 503 — player không
    // thấy event UI nhưng app vẫn hoạt động bình thường.
    const enabled = await this.featureFlags.isEnabled('LIVEOPS_EVENTS_ENABLED');
    if (!enabled) {
      return { ok: true, data: [] };
    }
    const characterId = await this.resolveCharacterId(req);
    try {
      const data = await this.events.getActiveEventsPublic(characterId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':eventKey/claim')
  @HttpCode(200)
  @RateLimitPolicy('LIVEOPS_GIFT_CLAIM')
  async claim(
    @Req() req: Request,
    @Param('eventKey') eventKey: string,
  ): Promise<{ ok: true; data: LiveOpsClaimResult }> {
    // Phase 15.4 — runtime gate. Tắt khi double-reward exploit;
    // 503 + FEATURE_DISABLED. Player UI sẽ kiểm tra public flag
    // và ẩn nút claim, nhưng server vẫn enforce.
    await this.featureFlags.requireEnabled('LIVEOPS_FESTIVAL_GIFT_ENABLED');
    if (!eventKey || typeof eventKey !== 'string' || eventKey.length > 80) {
      fail('INVALID_INPUT');
    }
    const characterId = await this.requireCharacterId(req);
    try {
      const data = await this.events.claimEventReward(characterId, eventKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof LiveOpsEventSchedulerError) {
      switch (e.code) {
        case 'EVENT_NOT_FOUND':
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'EVENT_NOT_ACTIVE':
        case 'EVENT_NOT_CLAIMABLE':
        case 'EVENT_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'EVENT_REWARD_ITEM_INVALID':
        case 'EVENT_REWARD_QTY_INVALID':
        case 'EVENT_REWARD_CURRENCY_INVALID':
        case 'EVENT_REWARD_EMPTY':
        case 'EVENT_REWARD_OVER_CAP':
          fail(e.code, HttpStatus.UNPROCESSABLE_ENTITY);
        // eslint-disable-next-line no-fallthrough
        default:
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
