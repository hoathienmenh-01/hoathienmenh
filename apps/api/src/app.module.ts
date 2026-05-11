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
import { AdminAnticheatModule } from './modules/admin-anticheat/admin-anticheat.module';
import { AdminMarketAbuseModule } from './modules/admin-market-abuse/admin-market-abuse.module';
import { SocialModule } from './modules/social/social.module';
import { ChatPrivateModule } from './modules/chat-private/chat-private.module';
import { ChatGroupModule } from './modules/chat-group/chat-group.module';
import { PresenceModule } from './modules/presence/presence.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PartyModule } from './modules/party/party.module';
import { PartyDungeonModule } from './modules/party-dungeon/party-dungeon.module';
import { CoopBossModule } from './modules/coop-boss/coop-boss.module';
import { ChatModerationModule } from './modules/chat-moderation/chat-moderation.module';
import { LiveOpsCronModule } from './modules/liveops-cron/liveops-cron.module';
import { LiveOpsEventSchedulerModule } from './modules/liveops-event-scheduler/liveops-event-scheduler.module';
import { LiveOpsAnnouncementModule } from './modules/liveops-announcement/liveops-announcement.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { FeatureFlagAdminModule } from './modules/feature-flag-admin/feature-flag-admin.module';
import { MaintenanceWindowModule } from './modules/maintenance-window/maintenance-window.module';
import { MaintenanceWindowAdminModule } from './modules/maintenance-window-admin/maintenance-window-admin.module';
import { ConfigVersionModule } from './modules/config-version/config-version.module';
import { ConfigVersionAdminModule } from './modules/config-version-admin/config-version-admin.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ArenaModule } from './modules/arena/arena.module';
import { ArenaAntiWintradeAdminModule } from './modules/arena-anti-wintrade-admin/arena-anti-wintrade-admin.module';
import { BackupModule } from './modules/backup/backup.module';
import { RedisModule } from './common/redis.module';
import { EconomyModule } from './modules/economy/economy.module';
import { SecurityModule } from './modules/security/security.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    EconomyModule,
    AuthModule,
    // Phase 18.1 — Security rate-limit + abuse block. SAU AuthModule
    // (cần AuthService cho decode cookie trong RateLimitGuard) +
    // RedisModule. Đăng ký APP_GUARD opt-in: chỉ enforce trên route
    // có `@RateLimitPolicy(...)`. Route có `@SkipRateLimit()` bypass.
    SecurityModule,
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
    // Phase 15.1–15.2 — LiveOps Event Scheduler. SAU AdminModule (cần
    // AdminGuard); cron tick recompute wire trong LiveOpsCronModule
    // (file cron.processor đọc service này).
    LiveOpsEventSchedulerModule,
    // Phase 15.3.B — LiveOps Announcement (banner / marquee + WS broadcast).
    // SAU AdminModule + AuthModule + RealtimeModule. Cron recompute của
    // announcement được invoke từ LiveOpsEventSchedulerCronProcessor
    // (cuối tick) để tận dụng cron tick sẵn có — đồng bộ announcement
    // + event transitions trong cùng 5-phút scan.
    LiveOpsAnnouncementModule,
    FeatureFlagModule,
    // Phase 15.4 — Admin endpoints cho Feature Flag (tách riêng để tránh
    // cycle: AppModule → CharacterModule → FeatureFlagModule → AdminModule
    // → CharacterModule). Pattern mirror `ArenaAntiWintradeAdminModule`.
    FeatureFlagAdminModule,
    // Phase 15.5 — Maintenance Window runtime + public endpoint
    // (`GET /maintenance/status`). Service exported cho middleware
    // (`MaintenanceWindowGuardMiddleware`) inject mà không kéo theo
    // AdminModule cycle.
    MaintenanceWindowModule,
    // Phase 15.5 — Admin endpoints cho Maintenance Window (`POST/PATCH
    // /admin/maintenance-windows*`, recompute, disable). Tách module
    // riêng để tránh cycle với AdminModule.
    MaintenanceWindowAdminModule,
    // Phase 15.6 — Config Version persistence (snapshot before/after).
    // Exported `ConfigVersionService` cho 4 entity admin-managed module
    // (LiveOpsEvent, LiveOpsAnnouncement, FeatureFlag, MaintenanceWindow)
    // ghi version row sau mutation. Admin endpoints + rollback orchestrator
    // sẽ vào file riêng `ConfigVersionAdminModule` (tránh cycle với
    // AdminModule, mirror Phase 15.4/15.5).
    ConfigVersionModule,
    // Phase 15.6 — Admin endpoints cho version listing + dry-run/rollback.
    ConfigVersionAdminModule,
    // Phase 16.6 — Economy Anti-cheat (ledger checker + anomaly
    // scanner cron + admin endpoints). SAU AdminModule + EconomyModule.
    AdminEconomySafetyModule,
    AdminAnticheatModule,
    AdminMarketAbuseModule,
    // Phase 19.1 — Social System Foundation (friend / block / private
    // chat / group chat). SocialModule export SocialService cho 2 chat
    // module re-use isBlockedBetween + areFriends. RealtimeModule đã
    // imported gián tiếp qua ChatModule — explicit re-import an toàn.
    SocialModule,
    ChatPrivateModule,
    ChatGroupModule,
    // Phase 19.2 — Chat Moderation & Report System. User report
    // private/group messages; admin ack/resolve, mute, hide, group
    // lock/dissolve. SocialModule + ChatPrivateModule + ChatGroupModule
    // import ChatModerationModule sớm hơn trong file này thì OK; tránh
    // circular bằng cách ChatModerationModule KHÔNG import 3 module đó.
    ChatModerationModule,
    // Phase 19.3 — Social Presence & Notification Center. PresenceModule
    // wire vào RealtimeGateway lifecycle (forwardRef cả 2 chiều để tránh
    // circular). Cung cấp `GET /social/presence` cho FE query batch
    // online + lastSeenAt. NotificationModule cung cấp
    // `/notifications` REST + service cho integration hook.
    PresenceModule,
    NotificationModule,
    // Phase 19.4 — Group / Party System Upgrade. PartyModule depend
    // SocialModule (block check), RealtimeModule (party:* WS),
    // SecurityModule (rate-limit), AuthModule. Soft-ref pattern; KHÔNG
    // đụng GroupChat hiện có (party / group chat tách biệt semantics).
    PartyModule,
    // Phase 20.1 — Party Dungeon Co-op PvE Foundation. Standalone
    // module depend Character (CurrencyService), Inventory
    // (InventoryService), Realtime (party-dungeon:* WS), Security
    // (rate-limit), Auth. Soft-ref pattern; KHÔNG đụng DungeonRun
    // (solo farm) hay GroupChat. Service enforce party-membership +
    // leader-only invariants trên từng mutation.
    PartyDungeonModule,
    // Phase 20.2 — Co-op Boss / World Boss Party Contribution.
    // Standalone module depend Character (CurrencyService),
    // Inventory (InventoryService), Realtime (coop-boss:* WS),
    // Security (rate-limit), Auth, Admin (AdminGuard cho admin
    // controller). Soft-ref pattern; KHÔNG đụng WorldBoss /
    // BossDamage (Phase 7/12.6 solo+global) hay PartyDungeon. Service
    // enforce party-membership + leader-only + contribution clamp
    // invariants trên từng mutation.
    CoopBossModule,
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
    // Phase 17.2 — Backup / Restore Weekly Verification (admin endpoints
    // + BullMQ weekly cron + spawn shell scripts/backup-db.sh /
    // scripts/verify-restore.sh + tracking BackupRun / BackupVerifyRun).
    // Cron default disabled qua env BACKUP_CRON_ENABLED=false /
    // BACKUP_VERIFY_CRON_ENABLED=false. KHÔNG expose restore-db.sh.
    BackupModule,
  ],
})
export class AppModule {}
