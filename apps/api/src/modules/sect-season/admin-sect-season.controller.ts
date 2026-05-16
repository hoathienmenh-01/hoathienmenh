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
  AdminSectSeasonHallOfFameView,
  SectSeasonChampionSnapshotDetail,
  SectSeasonHistoryError,
  SectSeasonHistoryService,
} from './sect-season-history.service';

/**
 * Phase 15.8 — Admin endpoints cho Sect Season history + Hall of Fame.
 *
 * Endpoints (`AdminGuard` + `@RequireAdmin()` — ADMIN-only vì audit data
 * chứa danh sách characterId):
 *   - `GET /admin/sect-season/hall-of-fame` — overview list mọi season đã
 *     chốt + reward grant stats + champion snapshot meta + aggregate Hall
 *     of Fame. Dùng cho Admin Hall of Fame view (read-only).
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
   * Phase 15.8 — Admin Hall of Fame: list mọi season đã finalize + reward
   * grant status + champion snapshot meta + aggregate Hall of Fame. Empty
   * arrays nếu chưa có season nào chốt (200 OK).
   */
  @Get('admin/sect-season/hall-of-fame')
  @RequireAdmin()
  async hallOfFame(): Promise<{ ok: true; data: AdminSectSeasonHallOfFameView }> {
    const data = await this.seasonHistory.getAdminHallOfFame();
    return { ok: true, data };
  }

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
