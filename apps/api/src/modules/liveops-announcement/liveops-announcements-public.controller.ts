import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import {
  LiveOpsAnnouncementService,
  type LiveOpsAnnouncementPublicView,
} from './liveops-announcement.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

/**
 * Phase 15.3.B — Public LiveOps announcement endpoint cho player marquee.
 *
 * Routes:
 *   - GET /liveops/announcements/active → list ACTIVE announcements
 *     public-safe (anonymous viewer được phép xem `target=ALL`).
 *
 * Auth resolve qua `xt_access` cookie:
 *   - anonymous (no cookie / invalid) → chỉ thấy `ALL`.
 *   - authenticated player           → `ALL` + `AUTHENTICATED`.
 *   - admin / mod                    → `ALL` + `AUTHENTICATED` + `ADMIN_ONLY`.
 *
 * KHÔNG bao giờ trả `createdByAdminId` / `disabledAt` / `id`. Field `target`
 * vẫn trả về cho FE biết nguồn (vd hiển thị badge "ADMIN-ONLY").
 */
@Controller('liveops/announcements')
export class LiveOpsAnnouncementsPublicController {
  constructor(
    private readonly service: LiveOpsAnnouncementService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async resolveViewer(
    req: Request,
  ): Promise<'anonymous' | 'authenticated' | 'admin'> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) return 'anonymous';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, banned: true },
    });
    if (!user || user.banned) return 'anonymous';
    if (user.role === 'ADMIN' || user.role === 'MOD') return 'admin';
    return 'authenticated';
  }

  @Get('active')
  async listActive(
    @Req() req: Request,
  ): Promise<{ ok: true; data: LiveOpsAnnouncementPublicView[] }> {
    // Phase 15.4 — runtime gate. Khi LIVEOPS_ANNOUNCEMENTS_ENABLED=false,
    // FE nhận `data: []` → marquee empty, không spam toast nếu cần
    // xử lý announcement spam hoặc bảo trì WS.
    const enabled = await this.featureFlags.isEnabled(
      'LIVEOPS_ANNOUNCEMENTS_ENABLED',
    );
    if (!enabled) {
      return { ok: true, data: [] };
    }
    const viewer = await this.resolveViewer(req);
    const data = await this.service.getActiveAnnouncementsPublic(viewer);
    return { ok: true, data };
  }
}
