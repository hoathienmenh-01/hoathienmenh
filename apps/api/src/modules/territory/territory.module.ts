import { Module } from '@nestjs/common';
import { AdminTerritoryController } from './admin-territory.controller';
import { TerritoryController } from './territory.controller';
import { TerritoryDecayService } from './territory-decay.service';
import { TerritorySettlementService } from './territory-settlement.service';
import { TerritoryService } from './territory.service';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Phase 14.0.A + 14.0.B — Territory module.
 *
 * Exports `TerritoryService` để các module gameplay (DungeonRunModule,
 * BossModule) inject hook fail-soft. `TerritoryController` read-only —
 * mọi mutation điểm influence đi qua `addInfluenceTx` từ caller's
 * transaction.
 *
 * Phase 14.0.B thêm:
 *   - `TerritorySettlementService` — settlement runtime (idempotent,
 *     race-safe).
 *   - `AdminTerritoryController` (mounted under `/admin/territory`,
 *     gated bằng `AdminGuard` + `@RequireAdmin()`) — manual settlement
 *     trigger.
 *   - `GET /territory/regions/:regionKey/history` — public read-only
 *     lịch sử settlement.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [TerritoryController, AdminTerritoryController],
  providers: [
    TerritoryService,
    TerritorySettlementService,
    TerritoryDecayService,
    PrismaService,
  ],
  exports: [
    TerritoryService,
    TerritorySettlementService,
    TerritoryDecayService,
  ],
})
export class TerritoryModule {}
