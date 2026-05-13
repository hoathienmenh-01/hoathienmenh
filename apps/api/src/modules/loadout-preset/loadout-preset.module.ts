import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { LoadoutPresetController } from './loadout-preset.controller';
import { LoadoutPresetService } from './loadout-preset.service';

/**
 * Phase 34.4 — Loadout Preset Module.
 *
 * Wraps `CharacterLoadoutPreset` CRUD + atomic apply. Pure equipment
 * snapshot — no currency/exp/item grant.
 */
@Module({
  imports: [AuthModule],
  controllers: [LoadoutPresetController],
  providers: [LoadoutPresetService, PrismaService],
  exports: [LoadoutPresetService],
})
export class LoadoutPresetModule {}
