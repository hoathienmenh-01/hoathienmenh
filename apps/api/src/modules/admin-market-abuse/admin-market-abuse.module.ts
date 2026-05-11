import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminMarketAbuseController } from './admin-market-abuse.controller';
import { MarketTradeAbuseService } from './market-trade-abuse.service';

/**
 * Phase 16.4 — Admin Market Trade Abuse module.
 *
 * Tách riêng khỏi `AdminAnticheatModule` (Phase 16.3 gameplay) và
 * `AdminEconomySafetyModule` (Phase 16.6 economy aggregate):
 *   - Domain khác (market trade vs gameplay/economy).
 *   - Không share queue / cron processor (Phase 16.4 manual scan-only;
 *     cron là follow-up).
 *
 * Dependencies:
 *   - `AdminModule` cho `AdminGuard` + `AuthService`.
 *   - `AuthModule` cho cookie decode.
 *   - `PrismaService` standalone.
 *
 * Export `MarketTradeAbuseService` để `MarketModule` có thể inject
 * hook `recordListingCreate` / `recordListingBuy` post-mutation.
 *
 * Cron: KHÔNG có ở Phase 16.4 (follow-up). Admin force-run qua
 * `POST /admin/market/abuse/scan` thủ công.
 */
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [AdminMarketAbuseController],
  providers: [PrismaService, MarketTradeAbuseService],
  exports: [MarketTradeAbuseService],
})
export class AdminMarketAbuseModule {}
