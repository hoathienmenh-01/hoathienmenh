import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminGameplayAntiCheatController } from './admin-gameplay-anticheat.controller';
import { GameplayAntiCheatService } from './gameplay-anticheat.service';

/**
 * Phase 16.3 — Admin Anti-cheat (Gameplay) module.
 *
 * Tách riêng khỏi `AdminEconomySafetyModule`:
 *   - Domain khác (gameplay vs economy).
 *   - Không share queue / cron processor (Phase 16.3 manual scan-only;
 *     cron là follow-up).
 *   - `AdminEconomySafetyModule` đã có BullMQ queue cho economy
 *     anomaly scanner — không reuse để giữ DI graph nhỏ.
 *
 * Dependencies:
 *   - `AdminModule` cho `AdminGuard` + `AuthService`.
 *   - `AuthModule` cho cookie decode.
 *   - `PrismaService` standalone.
 *
 * Cron: KHÔNG có ở Phase 16.3 (follow-up). Admin force-run qua
 * `POST /admin/anticheat/gameplay/scan` thủ công.
 */
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [AdminGameplayAntiCheatController],
  providers: [PrismaService, GameplayAntiCheatService],
  exports: [GameplayAntiCheatService],
})
export class AdminAnticheatModule {}
