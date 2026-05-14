import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PrismaService } from '../../common/prisma.service';
import { DailyEncounterController } from './daily-encounter.controller';
import { DailyEncounterService } from './daily-encounter.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebPushModule } from '../web-push/web-push.module';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ Module.
 *
 * Wires `DAILY_ENCOUNTERS` catalog (shared) into runtime
 * `CharacterDailyEncounter` rows + currency/exp grant on claim.
 *
 * Phase 44.1 — Wire `RealtimeService` cho rare/hidden encounter realtime
 * banner + `WebPushService` cho push fallback nếu user offline.
 */
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    FeatureFlagModule,
    RealtimeModule,
    WebPushModule,
  ],
  controllers: [DailyEncounterController],
  providers: [DailyEncounterService, PrismaService],
  exports: [DailyEncounterService],
})
export class DailyEncounterModule {}
