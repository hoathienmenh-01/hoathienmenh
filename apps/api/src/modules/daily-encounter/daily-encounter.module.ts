import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { PrismaService } from '../../common/prisma.service';
import { DailyEncounterController } from './daily-encounter.controller';
import { DailyEncounterService } from './daily-encounter.service';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ Module.
 *
 * Wires `DAILY_ENCOUNTERS` catalog (shared) into runtime
 * `CharacterDailyEncounter` rows + currency/exp grant on claim.
 */
@Module({
  imports: [AuthModule, CharacterModule],
  controllers: [DailyEncounterController],
  providers: [DailyEncounterService, PrismaService],
  exports: [DailyEncounterService],
})
export class DailyEncounterModule {}
