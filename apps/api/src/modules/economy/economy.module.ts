import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { InventoryModule } from '../inventory/inventory.module';
import { DropEconomyService } from './drop-economy.service';
import { EconomyAnomalyScannerService } from './economy-anomaly-scanner.service';
import { LedgerCheckerService } from './ledger-checker.service';
import { RewardCapService } from './reward-cap.service';

/**
 * Phase 16.5 + 16.6 — Economy module (anti-abuse layer).
 *
 * Phase 16.5 wire `RewardCapService` (daily reward cap apply runtime).
 * Phase 16.6 thêm:
 *   - `LedgerCheckerService` — daily invariant scan (currency / item /
 *     reward-cap consistency, negative balance, suspicious delta).
 *   - `EconomyAnomalyScannerService` — windowed anomaly detection
 *     (currency delta 24h, rare item gain, reward-cap bypass, market
 *     outlier, admin grant over-limit hook).
 *
 * Module Global-flagged ở `app.module.ts` để service khác (DungeonRun,
 * Mission, Cultivation processor, AdminService grant hook) inject mà
 * không cần import lẫn nhau.
 *
 * KHÔNG thêm controller/cron ở đây — admin endpoint ở
 * `admin-economy-safety/` module riêng (cron module riêng tương tự
 * `liveops-cron/`).
 */
@Module({
  imports: [InventoryModule],
  providers: [
    PrismaService,
    RewardCapService,
    LedgerCheckerService,
    EconomyAnomalyScannerService,
    DropEconomyService,
  ],
  exports: [
    RewardCapService,
    LedgerCheckerService,
    EconomyAnomalyScannerService,
    DropEconomyService,
  ],
})
export class EconomyModule {}
