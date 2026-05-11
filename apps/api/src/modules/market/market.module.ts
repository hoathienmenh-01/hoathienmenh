import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CharacterModule } from '../character/character.module';
import { MissionModule } from '../mission/mission.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { AdminMarketAbuseModule } from '../admin-market-abuse/admin-market-abuse.module';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    CharacterModule,
    MissionModule,
    FeatureFlagModule,
    AdminMarketAbuseModule,
  ],
  controllers: [MarketController],
  providers: [MarketService, PrismaService],
})
export class MarketModule {}
