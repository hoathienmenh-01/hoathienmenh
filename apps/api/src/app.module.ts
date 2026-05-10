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
import { TerritoryModule } from './modules/territory/territory.module';
import { AdminEconomySafetyModule } from './modules/admin-economy-safety/admin-economy-safety.module';
import { LiveOpsCronModule } from './modules/liveops-cron/liveops-cron.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ArenaModule } from './modules/arena/arena.module';
import { ArenaAntiWintradeAdminModule } from './modules/arena-anti-wintrade-admin/arena-anti-wintrade-admin.module';
import { RedisModule } from './common/redis.module';
import { EconomyModule } from './modules/economy/economy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    EconomyModule,
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
    TerritoryModule,
    // Phase 13.2.D + 14.0.F — Live Ops cron orchestration. Phải đặt
    // SAU TerritoryModule + SectSeasonModule vì cron module import 2
    // module đó để inject services. AdminModule cũng đã import xong.
    LiveOpsCronModule,
    // Phase 16.6 — Economy Anti-cheat (ledger checker + anomaly
    // scanner cron + admin endpoints). SAU AdminModule + EconomyModule.
    AdminEconomySafetyModule,
    // Phase 17.5 — Metrics endpoint (admin-only) + collectors. SAU
    // AdminModule + RealtimeModule (đã imported indirectly).
    MetricsModule,
    // Phase 14.1.B — Async Arena Foundation. Standalone module (chỉ
    // depend AuthModule + PrismaService). Không cycle với
    // CharacterModule.
    ArenaModule,
    // Phase 14.1.D — Arena Anti-Wintrade admin endpoints. SAU
    // AdminModule + ArenaModule (cần AdminGuard + ArenaAntiWintradeService).
    ArenaAntiWintradeAdminModule,
  ],
})
export class AppModule {}
