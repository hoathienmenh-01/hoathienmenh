import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { CharacterModule } from '../character/character.module';
import { EconomyModule } from '../economy/economy.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WorldContentModule } from '../world-content/world-content.module';
import { SeasonsController } from './seasons.controller';
import { SeasonsService } from './seasons.service';

@Module({
  imports: [
    AuthModule,
    AdminControlCenterModule,
    CharacterModule,
    EconomyModule,
    InventoryModule,
    WorldContentModule,
  ],
  controllers: [SeasonsController],
  providers: [SeasonsService, PrismaService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
