import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RewardCapService } from './reward-cap.service';

/**
 * Phase 16.5 — Economy module (anti-abuse layer).
 *
 * Hiện chỉ chứa `RewardCapService` (daily reward cap). Module được
 * Global-flagged ở `app.module.ts` để các service khác (DungeonRun,
 * Mission, Cultivation processor) inject mà không cần import lẫn nhau.
 *
 * KHÔNG thêm controller/cron/processor ở đây — module hiện thuần
 * service layer; admin endpoint riêng (nếu có) ở `admin/admin.module.ts`.
 */
@Module({
  providers: [PrismaService, RewardCapService],
  exports: [RewardCapService],
})
export class EconomyModule {}
