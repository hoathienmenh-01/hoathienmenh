import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { CharacterModule } from './modules/character/character.module';
import { CombatModule } from './modules/combat/combat.module';
import { DungeonRunModule } from './modules/dungeon-run/dungeon-run.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MarketModule } from './modules/market/market.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CultivationModule } from './modules/cultivation/cultivation.module';
import { ChatModule } from './modules/chat/chat.module';
import { SectModule } from './modules/sect/sect.module';
import { BossModule } from './modules/boss/boss.module';
import { TopupModule } from './modules/topup/topup.module';
import { AdminModule } from './modules/admin/admin.module';
import { OpsModule } from './modules/ops/ops.module';
import { MissionModule } from './modules/mission/mission.module';
import { QuestModule } from './modules/quest/quest.module';
import { NpcModule } from './modules/npc/npc.module';
import { NpcAffinityModule } from './modules/npc-affinity/npc-affinity.module';
import { StoryDialogueModule } from './modules/story-dialogue/story-dialogue.module';
import { StoryDungeonModule } from './modules/story-dungeon/story-dungeon.module';
import { GiftCodeModule } from './modules/giftcode/giftcode.module';
import { MailModule } from './modules/mail/mail.module';
import { EmailModule } from './modules/email/email.module';
import { ShopModule } from './modules/shop/shop.module';
import { HealthModule } from './modules/health/health.module';
import { NextActionModule } from './modules/next-action/next-action.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { DailyLoginModule } from './modules/daily-login/daily-login.module';
import { LogsModule } from './modules/logs/logs.module';
import { LiveOpsModule } from './modules/liveops/liveops.module';
import { SectWarModule } from './modules/sect-war/sect-war.module';
import { SectSeasonModule } from './modules/sect-season/sect-season.module';
import { RedisModule } from './common/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    AuthModule,
    RealtimeModule,
    CharacterModule,
    CultivationModule,
    CombatModule,
    DungeonRunModule,
    InventoryModule,
    MarketModule,
    SectModule,
    ChatModule,
    BossModule,
    TopupModule,
    AdminModule,
    OpsModule,
    MissionModule,
    QuestModule,
    NpcModule,
    NpcAffinityModule,
    StoryDialogueModule,
    StoryDungeonModule,
    GiftCodeModule,
    MailModule,
    EmailModule,
    ShopModule,
    HealthModule,
    NextActionModule,
    LeaderboardModule,
    DailyLoginModule,
    LogsModule,
    LiveOpsModule,
    SectWarModule,
    SectSeasonModule,
  ],
})
export class AppModule {}
