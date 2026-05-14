import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  WebPushPreferencesView,
  WebPushSubscriptionView,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { WebPushService } from './web-push.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

/**
 * Phase PWA-1 — Web Push REST surface.
 *
 * Routes (all require PLAYER cookie session):
 *   - `GET /push/vapid-public-key` — VAPID public key (base64url) cho FE
 *     register subscription.
 *   - `POST /push/subscribe` — register / refresh subscription endpoint.
 *   - `POST /push/unsubscribe` — soft-disable subscription.
 *   - `GET /push/subscriptions` — list active subscription rows của
 *     chính user (debug / FE state).
 *   - `GET /push/preferences` — get prefs (lazy upsert).
 *   - `PATCH /push/preferences` — update prefs.
 *
 * Privacy:
 *   - Mọi route filter `userId = requester`. KHÔNG có cross-user path.
 *
 * Anti-spam:
 *   - Send pipeline KHÔNG có public endpoint — trigger qua internal
 *     service calls (boss/stamina/mail/daily) cũng ở backend layer.
 */
@Controller('push')
export class WebPushController {
  constructor(
    private readonly webPush: WebPushService,
    private readonly auth: AuthService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  @Get('vapid-public-key')
  async getPublicKey(): Promise<{ ok: true; data: { publicKey: string } }> {
    return { ok: true, data: { publicKey: this.webPush.getPublicKey() } };
  }

  @Post('subscribe')
  async subscribe(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: WebPushSubscriptionView }> {
    // Phase 45.0 — WEB_PUSH_ENABLED kill switch. Khi VAPID/provider lỗi
    // hoặc admin tắt để giảm fanout, trả 503 FEATURE_DISABLED.
    await this.featureFlags.requireEnabled('WEB_PUSH_ENABLED');
    const userId = await this.requireUserId(req);
    const ua = (req.headers['user-agent'] ?? null) as string | null;
    const merged =
      body && typeof body === 'object'
        ? { ...(body as Record<string, unknown>), userAgent: ua }
        : body;
    const view = await this.webPush.subscribe(userId, merged);
    return { ok: true, data: view };
  }

  @Post('unsubscribe')
  async unsubscribe(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { ok: true } }> {
    const userId = await this.requireUserId(req);
    if (!body || typeof body !== 'object') fail('PAYLOAD_INVALID');
    const endpoint = (body as { endpoint?: unknown }).endpoint;
    if (typeof endpoint !== 'string') fail('ENDPOINT_INVALID');
    await this.webPush.unsubscribe(userId, endpoint);
    return { ok: true, data: { ok: true } };
  }

  @Get('subscriptions')
  async listSubscriptions(
    @Req() req: Request,
  ): Promise<{ ok: true; data: WebPushSubscriptionView[] }> {
    const userId = await this.requireUserId(req);
    const rows = await this.webPush.listSubscriptions(userId);
    return { ok: true, data: rows };
  }

  @Get('preferences')
  async getPreferences(
    @Req() req: Request,
  ): Promise<{ ok: true; data: WebPushPreferencesView }> {
    const userId = await this.requireUserId(req);
    const prefs = await this.webPush.getPreferences(userId);
    return { ok: true, data: prefs };
  }

  @Patch('preferences')
  async updatePreferences(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: WebPushPreferencesView }> {
    const userId = await this.requireUserId(req);
    const prefs = await this.webPush.updatePreferences(userId, body);
    return { ok: true, data: prefs };
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }
}
