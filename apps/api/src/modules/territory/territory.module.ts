import { Module } from '@nestjs/common';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Phase 14.0.A — Territory module.
 *
 * Exports `TerritoryService` để các module gameplay (DungeonRunModule,
 * BossModule) inject hook fail-soft. Controller chỉ read-only — mọi mutation
 * điểm influence đi qua `addInfluenceTx` từ caller's transaction.
 */
@Module({
  imports: [AuthModule],
  controllers: [TerritoryController],
  providers: [TerritoryService, PrismaService],
  exports: [TerritoryService],
})
export class TerritoryModule {}
