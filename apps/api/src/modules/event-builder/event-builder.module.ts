/**
 * Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2.
 *
 * Module gom 8 service + 2 controller (admin & player). Tách khỏi
 * `LiveOpsModule` cũ (cron / announcement / scheduler) — module này focus
 * vào event definitions + runtime cho event V2 (tier-balanced, bracket,
 * mission, shop, boss, ranking, personal milestone).
 *
 * Phụ thuộc:
 *   - `AuthModule` (cho `AuthService.userIdFromAccess`)
 *   - `AdminControlCenterModule` (re-use `AdminPermissionGuard`,
 *      `AdminAuditWriter`)
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PrismaService } from '../../common/prisma.service';
import { EventService } from './event.service';
import { BracketService } from './bracket.service';
import { EventItemService } from './event-item.service';
import { EventMissionService } from './event-mission.service';
import { EventShopService } from './event-shop.service';
import { EventBossService } from './event-boss.service';
import { EventRankingService } from './event-ranking.service';
import { EventPersonalMilestoneService } from './event-personal-milestone.service';
import { EventBuilderAdminController } from './event-builder.admin.controller';
import { EventBuilderPlayerController } from './event-builder.player.controller';

@Module({
  imports: [AuthModule, AdminControlCenterModule, FeatureFlagModule],
  controllers: [EventBuilderAdminController, EventBuilderPlayerController],
  providers: [
    PrismaService,
    EventService,
    BracketService,
    EventItemService,
    EventMissionService,
    EventShopService,
    EventBossService,
    EventRankingService,
    EventPersonalMilestoneService,
  ],
  exports: [
    EventService,
    BracketService,
    EventItemService,
    EventMissionService,
    EventShopService,
    EventBossService,
    EventRankingService,
    EventPersonalMilestoneService,
  ],
})
export class EventBuilderModule {}
