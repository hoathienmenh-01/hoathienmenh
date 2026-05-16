import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import {
  SectSeasonChampionSnapshotDetail,
  SectSeasonHistoryError,
  SectSeasonHistoryService,
} from './sect-season-history.service';

/**
 * Phase 15.8 — Admin endpoints cho Sect Season history + Hall of Fame.
 *
 * Endpoints (`AdminGuard` + `@RequireAdmin()` — ADMIN-only vì audit data
 * chứa danh sách characterId):
 *   - `GET /admin/sect-season/:seasonKey/champion-snapshot` — đọc snapshot
 *     membership champion sect tại lúc finalize. Trả `memberCharacterIds`
 *     đầy đủ + denormalized `memberCount` để admin cross-check reward
 *     grant rows.
 *
 * KHÔNG audit log read-only inspect — AdminGuard đã ghi access log.
 * KHÔNG expose dữ liệu nhạy cảm (chỉ characterId — không có currency /
 * inventory snapshot).
 */
@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminSectSeasonController {
  constructor(
    private readonly seasonHistory: SectSeasonHistoryService,
  ) {}

  /**
   * Phase 15.8 — Inspect champion membership snapshot. 404 nếu season
   * chưa snapshot (legacy pre-15.8 hoặc chưa chốt).
   */
  @Get('admin/sect-season/:seasonKey/champion-snapshot')
  @RequireAdmin()
  async championSnapshot(
    @Param('seasonKey') seasonKey: string,
  ): Promise<{ ok: true; data: SectSeasonChampionSnapshotDetail }> {
    if (!seasonKey || typeof seasonKey !== 'string') {
      throw new HttpException(
        { ok: false, error: { code: 'SEASON_KEY_REQUIRED' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const data = await this.seasonHistory.getChampionSnapshot(seasonKey);
      return { ok: true, data };
    } catch (e) {
      if (
        e instanceof SectSeasonHistoryError &&
        e.code === 'CHAMPION_SNAPSHOT_NOT_FOUND'
      ) {
        throw new HttpException(
          { ok: false, error: { code: e.code } },
          HttpStatus.NOT_FOUND,
        );
      }
      throw e;
    }
  }
}
