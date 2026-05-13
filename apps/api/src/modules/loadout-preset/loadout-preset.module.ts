import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { LoadoutPresetController } from './loadout-preset.controller';
import { LoadoutPresetService } from './loadout-preset.service';

/**
 * Phase QOL-2 — Loadout Preset PvE/PvP/Boss.
 *
 * CRUD + apply atomic. KHÔNG đụng combat formula, KHÔNG đụng Story V2,
 * KHÔNG đụng Reward/Currency/Quest service core.
 */
@Module({
  imports: [AuthModule],
  controllers: [LoadoutPresetController],
  providers: [LoadoutPresetService, PrismaService],
  exports: [LoadoutPresetService],
})
export class LoadoutPresetModule {}
