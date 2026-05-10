import { forwardRef, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  CharacterController,
  PROFILE_RATE_LIMITER,
  PROFILE_RATE_LIMIT_MAX,
  PROFILE_RATE_LIMIT_WINDOW_MS,
} from './character.controller';
import { CharacterService } from './character.service';
import { CharacterSkillService } from './character-skill.service';
import { CurrencyService } from './currency.service';
import { SpiritualRootService } from './spiritual-root.service';
import { CultivationMethodService } from './cultivation-method.service';
import { GemService } from './gem.service';
import { RefineService } from './refine.service';
import { TribulationService } from './tribulation.service';
import { TribulationMiniBattleService } from './tribulation-mini-battle.service';
import { BuffService } from './buff.service';
import { TalentService } from './talent.service';
import { TitleService } from './title.service';
import { AchievementService } from './achievement.service';
import { AlchemyService } from './alchemy.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { InventoryModule } from '../inventory/inventory.module';
import {
  InMemorySlidingWindowRateLimiter,
  RedisSlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';
import { REDIS_CONNECTION } from '../../common/redis.module';

const profileLimiterProvider = {
  provide: PROFILE_RATE_LIMITER,
  inject: [{ token: REDIS_CONNECTION, optional: true }],
  useFactory: (redis?: Redis): RateLimiter => {
    if (redis) {
      return new RedisSlidingWindowRateLimiter(
        redis,
        PROFILE_RATE_LIMIT_WINDOW_MS,
        PROFILE_RATE_LIMIT_MAX,
        'rl:profile',
      );
    }
    return new InMemorySlidingWindowRateLimiter(
      PROFILE_RATE_LIMIT_WINDOW_MS,
      PROFILE_RATE_LIMIT_MAX,
    );
  },
};

// Phase 11.10.D Achievement item rewards — inject `InventoryService` vào
// `AchievementService.claimReward` qua `forwardRef` để grant items khi
// `def.reward.items` non-empty. Cycle: CharacterModule ↔ InventoryModule
// (InventoryModule imports CharacterModule cho CharacterService/CurrencyService).
@Module({
  imports: [AuthModule, RealtimeModule, forwardRef(() => InventoryModule)],
  controllers: [CharacterController],
  providers: [
    CharacterService,
    CurrencyService,
    SpiritualRootService,
    CultivationMethodService,
    CharacterSkillService,
    GemService,
    RefineService,
    TribulationService,
    TribulationMiniBattleService,
    BuffService,
    TalentService,
    TitleService,
    AchievementService,
    AlchemyService,
    PrismaService,
    profileLimiterProvider,
  ],
  exports: [
    CharacterService,
    CurrencyService,
    SpiritualRootService,
    CultivationMethodService,
    CharacterSkillService,
    GemService,
    RefineService,
    TribulationService,
    TribulationMiniBattleService,
    BuffService,
    TalentService,
    TitleService,
    AchievementService,
    AlchemyService,
  ],
})
export class CharacterModule {}
