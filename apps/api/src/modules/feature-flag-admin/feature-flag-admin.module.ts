/**
 * Phase 15.4 — Feature Flag admin module.
 *
 * Tách ra khỏi `FeatureFlagModule` để KHÔNG tạo cycle:
 *   - `FeatureFlagModule` chỉ giữ `FeatureFlagService` + public controller
 *     (no AdminModule import) — gameplay modules (CharacterModule,
 *     ArenaModule, MarketModule, ...) có thể import an toàn.
 *   - `FeatureFlagAdminModule` import `AdminModule` cho `AdminGuard` +
 *     `FeatureFlagModule` cho `FeatureFlagService` — admin controller
 *     ở đây.
 *
 * Cycle nếu gộp:
 *   AppModule → CharacterModule → FeatureFlagModule → AdminModule →
 *   CharacterModule (back). AdminModule import CharacterModule (cho
 *   admin character endpoints), nên không thể để FeatureFlagModule import
 *   AdminModule khi CharacterModule cần FeatureFlagService.
 *
 * Pattern mirror `ArenaAntiWintradeAdminModule` (Phase 14.1.D).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminFeatureFlagController } from './admin-feature-flag.controller';

@Module({
  imports: [AdminModule, AuthModule, FeatureFlagModule],
  controllers: [AdminFeatureFlagController],
  providers: [PrismaService],
})
export class FeatureFlagAdminModule {}
