import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { EconomyModule } from '../economy/economy.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RemoteConfigModule } from '../remote-config/remote-config.module';
import { SeasonsModule } from '../seasons/seasons.module';
import { WorldContentModule } from '../world-content/world-content.module';
import { RoguelikeController } from './roguelike.controller';
import { RoguelikeService } from './roguelike.service';

@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    EconomyModule,
    WorldContentModule,
    FeatureFlagModule,
    RemoteConfigModule,
    SeasonsModule,
  ],
  controllers: [RoguelikeController],
  providers: [RoguelikeService, PrismaService],
  exports: [RoguelikeService],
})
export class RoguelikeModule {}
