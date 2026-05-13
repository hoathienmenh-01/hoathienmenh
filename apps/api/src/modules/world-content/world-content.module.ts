import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { FarmService } from './farm.service';
import { TrialTowerService } from './trial-tower.service';
import { WorldCapService } from './world-cap.service';
import { WorldContentController } from './world-content.controller';

/**
 * Phase 26.5 — `WorldContentModule`.
 *
 * Server-authoritative wrapper cho farm session + trial tower attempt +
 * catalog read endpoints (world summary, farm maps, dungeons V2, bosses V2,
 * sect content, opportunities).
 *
 * Imports:
 *  - AuthModule       — `xt_access` cookie validation.
 *  - CharacterModule  — `CharacterService.findByUser` + `CurrencyService.applyTx`.
 */
@Module({
  imports: [AuthModule, CharacterModule],
  controllers: [WorldContentController],
  providers: [FarmService, TrialTowerService, WorldCapService, PrismaService],
  exports: [FarmService, TrialTowerService, WorldCapService],
})
export class WorldContentModule {}
