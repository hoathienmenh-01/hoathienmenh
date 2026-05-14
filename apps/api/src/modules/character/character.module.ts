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
import { CultivationMethodV2Service } from './cultivation-method-v2.service';
import { ArtifactV2Service } from './artifact-v2.service';
import { GemService } from './gem.service';
import { RefineService } from './refine.service';
import { PhapBaoService } from './phap-bao.service';
import { EquipmentService } from './equipment.service';
import { EquipmentEconomyService } from './equipment-economy.service';
import { TribulationService } from './tribulation.service';
import { TribulationMiniBattleService } from './tribulation-mini-battle.service';
import { BuffService } from './buff.service';
import { TalentService } from './talent.service';
import { TitleService } from './title.service';
import { AchievementService } from './achievement.service';
import { ReputationService } from './reputation.service';
import { LongTermGoalService } from './long-term-goal.service';
import { AlchemyService } from './alchemy.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { InventoryModule } from '../inventory/inventory.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
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
  imports: [
    AuthModule,
    RealtimeModule,
    forwardRef(() => InventoryModule),
    FeatureFlagModule,
  ],
  controllers: [CharacterController],
  providers: [
    CharacterService,
    CurrencyService,
    SpiritualRootService,
    CultivationMethodService,
    CultivationMethodV2Service,
    ArtifactV2Service,
    CharacterSkillService,
    GemService,
    RefineService,
    EquipmentService,
    EquipmentEconomyService,
    TribulationService,
    TribulationMiniBattleService,
    BuffService,
    TalentService,
    TitleService,
    AchievementService,
    ReputationService,
    LongTermGoalService,
    AlchemyService,
    PhapBaoService,
    PrismaService,
    profileLimiterProvider,
  ],
  exports: [
    CharacterService,
    CurrencyService,
    SpiritualRootService,
    CultivationMethodService,
    CultivationMethodV2Service,
    ArtifactV2Service,
    CharacterSkillService,
    GemService,
    RefineService,
    EquipmentService,
    EquipmentEconomyService,
    TribulationService,
    TribulationMiniBattleService,
    BuffService,
    TalentService,
    TitleService,
    AchievementService,
    ReputationService,
    LongTermGoalService,
    AlchemyService,
    PhapBaoService,
  ],
})
export class CharacterModule {}
