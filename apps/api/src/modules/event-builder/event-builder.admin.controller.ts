import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  BRACKET_MODES,
  EVENT_BOSS_TYPES,
  EVENT_ITEM_KINDS,
  EVENT_MISSION_RESET_TYPES,
  EVENT_MISSION_TYPES,
  EVENT_RANKING_TYPES,
  EVENT_STATUSES,
  EVENT_TYPES,
  PAID_REWARD_POLICIES,
  PERSONAL_EVENT_TRIGGER_TYPES,
  PRESET_EVENT_TEMPLATES,
  findEventTemplate,
  type AdminRoleKey,
} from '@xuantoi/shared';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { EventService } from './event.service';
import { BracketService } from './bracket.service';
import { EventItemService } from './event-item.service';
import { EventMissionService } from './event-mission.service';
import { EventShopService } from './event-shop.service';
import { EventBossService } from './event-boss.service';
import { EventRankingService } from './event-ranking.service';
import { EventPersonalMilestoneService } from './event-personal-milestone.service';

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

// ----- Zod schemas (admin write) ----------------------------------------

const KeyZ = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/);

const DateZ = z.union([
  z.string().min(1),
  z.date(),
]);

const EventUpsertZ = z
  .object({
    key: KeyZ,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    eventType: z.enum(EVENT_TYPES as unknown as [string, ...string[]]),
    startsAt: DateZ,
    endsAt: DateZ,
    timezone: z.string().max(64).optional(),
    bannerUrl: z.string().url().nullable().optional(),
    iconUrl: z.string().url().nullable().optional(),
    adminNote: z.string().max(1000).nullable().optional(),
    playerNotice: z.string().max(2000).nullable().optional(),
    enabled: z.boolean().optional(),
    bracketMode: z
      .enum(BRACKET_MODES as unknown as [string, ...string[]])
      .optional(),
    tokenKey: z.string().nullable().optional(),
    eventShopKey: z.string().nullable().optional(),
    missionGroupKey: z.string().nullable().optional(),
    bossGroupKey: z.string().nullable().optional(),
    rankingGroupKey: z.string().nullable().optional(),
    rewardProfileKey: z.string().nullable().optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

const TransitionZ = z
  .object({
    status: z.enum(EVENT_STATUSES as unknown as [string, ...string[]]),
    reason: z.string().min(1).max(500),
  })
  .strict();

const BracketUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: KeyZ,
    name: z.string().min(1).max(120),
    minRealmOrder: z.number().int().min(0).max(40),
    maxRealmOrder: z.number().int().min(0).max(40),
    minBodyRealmOrder: z.number().int().min(0).max(40).nullable().optional(),
    maxBodyRealmOrder: z.number().int().min(0).max(40).nullable().optional(),
    bracketTier: z.number().int().min(1).max(9),
    rewardTierMin: z.number().int().min(1).max(9),
    rewardTierMax: z.number().int().min(1).max(9),
    eventMaxTier: z.number().int().min(1).max(9),
    rankingEnabled: z.boolean(),
    shopFilterTier: z.number().int().min(1).max(9),
    bossPowerMultiplier: z.number().min(0).max(10),
    missionScalingMultiplier: z.number().min(0).max(10),
    enabled: z.boolean(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

const BalancePolicyZ = z
  .object({
    eventKey: KeyZ,
    maxTokenPerDay: z.number().int().min(0),
    maxTokenPerWeek: z.number().int().min(0),
    maxTokenPerEvent: z.number().int().min(0),
    maxRareRewardPerDay: z.number().int().min(0),
    maxRareRewardPerWeek: z.number().int().min(0),
    maxShopRareExchangePerEvent: z.number().int().min(0),
    allowHighLevelEnterLowBracket: z.boolean(),
    highLevelLowBracketTokenPenaltyPercent: z.number().min(0).max(1),
    highLevelLowBracketRankingDisabled: z.boolean(),
    sourceTierRewardCap: z.number().int().min(1).max(9),
    maxAllowedRewardTierDelta: z.number().int().min(0).max(2),
    paidRewardPolicy: z.enum(
      PAID_REWARD_POLICIES as unknown as [string, ...string[]],
    ),
    enabled: z.boolean(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const MissionUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: KeyZ,
    bracketKey: KeyZ.nullable().optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    missionType: z.enum(EVENT_MISSION_TYPES as unknown as [string, ...string[]]),
    targetValue: z.number().int().min(1).max(1_000_000),
    resetType: z.enum(
      EVENT_MISSION_RESET_TYPES as unknown as [string, ...string[]],
    ),
    rewardProfileKey: z.string().nullable().optional(),
    scoreAmount: z.number().int().min(0).max(1_000_000),
    tokenReward: z.number().int().min(0).max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();

const ShopUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: KeyZ,
    name: z.string().min(1).max(120),
    tokenCurrencyKey: z.string().min(1).max(64),
    startsAt: DateZ,
    endsAt: DateZ,
    enabled: z.boolean(),
  })
  .strict();

const ShopItemUpsertZ = z
  .object({
    key: KeyZ,
    shopKey: KeyZ,
    itemKey: z.string().min(1).max(64),
    rewardJson: z.array(
      z
        .object({
          kind: z.enum([
            'ITEM',
            'CURRENCY',
            'EXP',
            'COSMETIC',
            'TITLE',
            'TOKEN',
          ]),
          key: z.string().min(1).max(100),
          qty: z.number().int().min(0).max(100_000),
          itemTier: z.number().int().min(1).max(9).nullable().optional(),
        })
        .strict(),
    ),
    priceTokenAmount: z.number().int().min(0).max(1_000_000),
    requiredBracketKey: z.string().nullable().optional(),
    minRealmOrder: z.number().int().min(0).max(40).nullable().optional(),
    maxRealmOrder: z.number().int().min(0).max(40).nullable().optional(),
    purchaseLimitDaily: z.number().int().min(0).nullable().optional(),
    purchaseLimitWeekly: z.number().int().min(0).nullable().optional(),
    purchaseLimitEvent: z.number().int().min(0).nullable().optional(),
    enabled: z.boolean(),
    rewardContext: z
      .object({
        bracketTier: z.number().int().min(1).max(9),
        eventMaxTier: z.number().int().min(1).max(9),
        sourceTier: z.number().int().min(1).max(9),
        maxAllowedRewardTierDelta: z.number().int().min(0).max(2).optional(),
      })
      .strict(),
  })
  .strict();

const RankingUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: KeyZ,
    rankingType: z.enum(
      EVENT_RANKING_TYPES as unknown as [string, ...string[]],
    ),
    bracketMode: z.enum(BRACKET_MODES as unknown as [string, ...string[]]),
    bracketKey: z.string().nullable().optional(),
    scoreFormulaKey: z.string().min(1).max(64),
    rewardProfileKey: z.string().nullable().optional(),
    startsAt: DateZ,
    endsAt: DateZ,
    finalized: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

const BossUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: KeyZ,
    bracketKey: z.string().nullable().optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    bossType: z.enum(EVENT_BOSS_TYPES as unknown as [string, ...string[]]),
    sourceTier: z.number().int().min(1).max(9),
    bossTier: z.number().int().min(1).max(9),
    recommendedPower: z.number().int().min(0),
    hpFormulaKey: z.string().nullable().optional(),
    scheduleKey: z.string().nullable().optional(),
    participationRewardProfileKey: z.string().nullable().optional(),
    damageRankingRewardProfileKey: z.string().nullable().optional(),
    lastHitRewardProfileKey: z.string().nullable().optional(),
    sectRewardProfileKey: z.string().nullable().optional(),
    dailyAttempts: z.number().int().min(0).max(50),
    weeklyAttempts: z.number().int().min(0).max(500).nullable().optional(),
    enabled: z.boolean(),
  })
  .strict();

const ItemUpsertZ = z
  .object({
    key: KeyZ,
    eventKey: z.string().nullable().optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    itemKind: z.enum(EVENT_ITEM_KINDS as unknown as [string, ...string[]]),
    itemTier: z.number().int().min(1).max(9),
    rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']),
    category: z.string().min(1).max(64),
    expiresAt: z.string().nullable().optional(),
    tradeable: z.boolean(),
    bindOnPickup: z.boolean(),
    maxStack: z.number().int().min(1).max(1_000_000),
    dailyGainCap: z.number().int().min(0).nullable().optional(),
    weeklyGainCap: z.number().int().min(0).nullable().optional(),
    eventGainCap: z.number().int().min(0).nullable().optional(),
    allowedSources: z.array(z.string()).max(50),
    forbiddenSources: z.array(z.string()).max(50),
    sourceHint: z.string().nullable().optional(),
    enabled: z.boolean(),
  })
  .strict();

// ----- Controller --------------------------------------------------------

@UseGuards(AdminPermissionGuard)
@Controller('admin/events')
@RateLimitPolicy('ADMIN_MUTATION')
export class EventBuilderAdminController {
  constructor(
    private readonly events: EventService,
    private readonly brackets: BracketService,
    private readonly items: EventItemService,
    private readonly missions: EventMissionService,
    private readonly shops: EventShopService,
    private readonly bosses: EventBossService,
    private readonly rankings: EventRankingService,
    private readonly personal: EventPersonalMilestoneService,
    private readonly audit: AdminAuditWriter,
  ) {}

  // ----- Catalog endpoints -----

  @Get('catalog')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async getCatalog() {
    return {
      ok: true,
      data: {
        eventTypes: EVENT_TYPES,
        eventStatuses: EVENT_STATUSES,
        bracketModes: BRACKET_MODES,
        missionTypes: EVENT_MISSION_TYPES,
        missionResetTypes: EVENT_MISSION_RESET_TYPES,
        bossTypes: EVENT_BOSS_TYPES,
        rankingTypes: EVENT_RANKING_TYPES,
        itemKinds: EVENT_ITEM_KINDS,
        paidPolicies: PAID_REWARD_POLICIES,
        personalTriggers: PERSONAL_EVENT_TRIGGER_TYPES,
      },
    };
  }

  @Get('templates')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async getTemplates() {
    return { ok: true, data: { templates: PRESET_EVENT_TEMPLATES } };
  }

  @Get('templates/:templateKey')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async getTemplate(@Param('templateKey') templateKey: string) {
    const t = findEventTemplate(templateKey);
    if (!t) fail('TEMPLATE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: { template: t } };
  }

  // ----- Event CRUD -----

  @Get()
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listEvents(
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('enabled') enabled?: string,
  ) {
    const data = await this.events.list({
      status: status as never,
      eventType: eventType as never,
      enabled:
        enabled === 'true' ? true : enabled === 'false' ? false : undefined,
    });
    return { ok: true, data };
  }

  @Get(':key')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async getEvent(@Param('key') key: string) {
    const e = await this.events.findByKey(key);
    if (!e) fail('EVENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: e };
  }

  @Post()
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async createEvent(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = EventUpsertZ.safeParse(body);
    if (!parsed.success) fail('EVENT_PAYLOAD_INVALID');
    const { reason, ...rest } = parsed.data;
    const created = await this.events.create(rest as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_CREATE',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: reason ?? 'event create',
      targetType: 'EventDef',
      targetId: created.key,
      afterJson: created,
    });
    return { ok: true, data: created };
  }

  @Post(':key')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async updateEvent(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = EventUpsertZ.partial().safeParse(body);
    if (!parsed.success) fail('EVENT_PAYLOAD_INVALID');
    const before = await this.events.findByKey(key);
    if (!before) fail('EVENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const { reason, ...rest } = parsed.data;
    const updated = await this.events.update(key, rest as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_UPDATE',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: reason ?? 'event update',
      targetType: 'EventDef',
      targetId: key,
      beforeJson: before,
      afterJson: updated,
    });
    return { ok: true, data: updated };
  }

  @Delete(':key')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async deleteEvent(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Query('reason') reason?: string,
  ) {
    const before = await this.events.findByKey(key);
    if (!before) fail('EVENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.events.delete(key);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_DELETE',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: reason ?? 'event delete',
      targetType: 'EventDef',
      targetId: key,
      beforeJson: before,
    });
    return { ok: true, data: { deleted: true } };
  }

  @Post(':key/transition')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async transition(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = TransitionZ.safeParse(body);
    if (!parsed.success) fail('TRANSITION_PAYLOAD_INVALID');
    const before = await this.events.findByKey(key);
    if (!before) fail('EVENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const updated = await this.events.transition(
      key,
      parsed.data.status as never,
      req.userId,
    );
    const action =
      parsed.data.status === 'ACTIVE'
        ? 'EVENT_ACTIVATE'
        : parsed.data.status === 'PAUSED'
          ? 'EVENT_PAUSE'
          : parsed.data.status === 'REWARD_LOCKED'
            ? 'EVENT_LOCK_REWARDS'
            : parsed.data.status === 'FINALIZED'
              ? 'EVENT_FINALIZE'
              : parsed.data.status === 'ARCHIVED'
                ? 'EVENT_ARCHIVE'
                : parsed.data.status === 'CANCELLED'
                  ? 'EVENT_CANCEL'
                  : 'EVENT_UPDATE';
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: action,
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: parsed.data.reason,
      targetType: 'EventDef',
      targetId: key,
      beforeJson: { status: before.status },
      afterJson: { status: updated.status },
    });
    return { ok: true, data: updated };
  }

  @Post('validate')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async validateEvent(@Body() body: unknown) {
    const parsed = EventUpsertZ.safeParse(body);
    if (!parsed.success) fail('EVENT_PAYLOAD_INVALID');
    const v = this.events.validate(parsed.data as never);
    return { ok: true, data: v };
  }

  // ----- Bracket -----

  @Get(':key/brackets')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listBrackets(@Param('key') key: string) {
    const data = await this.brackets.listForEvent(key);
    return { ok: true, data };
  }

  @Post(':key/brackets')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertBracket(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = BracketUpsertZ.safeParse(body);
    if (!parsed.success) fail('BRACKET_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('BRACKET_EVENT_MISMATCH');
    const { reason, ...rest } = parsed.data;
    const row = await this.brackets.upsertBracket(rest as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_BRACKET_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: reason ?? 'bracket upsert',
      targetType: 'EventBracket',
      targetId: row.key,
      afterJson: row,
    });
    return { ok: true, data: row };
  }

  // ----- Balance policy -----

  @Get(':key/policy')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async getPolicy(@Param('key') key: string) {
    const data =
      (await this.brackets.getPolicy(key)) ?? this.brackets.defaultPolicy(key);
    return { ok: true, data };
  }

  @Post(':key/policy')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertPolicy(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = BalancePolicyZ.safeParse(body);
    if (!parsed.success) fail('POLICY_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('POLICY_EVENT_MISMATCH');
    const { reason, ...rest } = parsed.data;
    const before = await this.brackets.getPolicy(eventKey);
    const row = await this.brackets.upsertPolicy(rest as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_BALANCE_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason,
      targetType: 'EventBalancePolicy',
      targetId: eventKey,
      beforeJson: before,
      afterJson: row,
    });
    return { ok: true, data: row };
  }

  // ----- Mission -----

  @Get(':key/missions')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listMissions(@Param('key') key: string) {
    const data = await this.missions.list(key);
    return { ok: true, data };
  }

  @Post(':key/missions')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertMission(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = MissionUpsertZ.safeParse(body);
    if (!parsed.success) fail('MISSION_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('MISSION_EVENT_MISMATCH');
    const data = await this.missions.upsert(parsed.data as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_MISSION_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'mission upsert',
      targetType: 'EventMissionDef',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  // ----- Shop -----

  @Get(':key/shops')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listShops(@Param('key') key: string) {
    const data = await this.shops.listShops(key);
    return { ok: true, data };
  }

  @Post(':key/shops')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertShop(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = ShopUpsertZ.safeParse(body);
    if (!parsed.success) fail('SHOP_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('SHOP_EVENT_MISMATCH');
    const data = await this.shops.upsertShop(parsed.data as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_SHOP_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'shop upsert',
      targetType: 'EventShopDef',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  @Post('shop-items')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertShopItem(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = ShopItemUpsertZ.safeParse(body);
    if (!parsed.success) fail('SHOP_ITEM_PAYLOAD_INVALID');
    const { rewardContext, ...itemData } = parsed.data;
    const data = await this.shops.upsertShopItem(
      itemData as never,
      rewardContext as never,
      req.userId,
    );
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_SHOP_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'shop item upsert',
      targetType: 'EventShopItemDef',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  // ----- Boss -----

  @Get(':key/bosses')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listBosses(@Param('key') key: string) {
    const data = await this.bosses.list(key);
    return { ok: true, data };
  }

  @Post(':key/bosses')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertBoss(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = BossUpsertZ.safeParse(body);
    if (!parsed.success) fail('BOSS_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('BOSS_EVENT_MISMATCH');
    const data = await this.bosses.upsert(parsed.data as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_BOSS_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'boss upsert',
      targetType: 'EventBossDef',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  // ----- Ranking -----

  @Get(':key/rankings')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listRankings(@Param('key') key: string) {
    const data = await this.rankings.list(key);
    return { ok: true, data };
  }

  @Post(':key/rankings')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertRanking(
    @Req() req: AdminReq,
    @Param('key') eventKey: string,
    @Body() body: unknown,
  ) {
    const parsed = RankingUpsertZ.safeParse(body);
    if (!parsed.success) fail('RANKING_PAYLOAD_INVALID');
    if (parsed.data.eventKey !== eventKey) fail('RANKING_EVENT_MISMATCH');
    const data = await this.rankings.upsert(parsed.data as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_RANKING_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'ranking upsert',
      targetType: 'EventRankingDef',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  @Post('rankings/:rankingKey/finalize')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async finalizeRanking(
    @Req() req: AdminReq,
    @Param('rankingKey') rankingKey: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.rankings.finalize(rankingKey, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_RANKING_LOCK',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: body?.reason ?? 'finalize ranking',
      targetType: 'EventRankingDef',
      targetId: rankingKey,
      afterJson: data,
    });
    return { ok: true, data };
  }

  // ----- Item -----

  @Get('items')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listItems(@Query('eventKey') eventKey?: string) {
    const data = await this.items.list(eventKey);
    return { ok: true, data };
  }

  @Post('items')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async upsertItem(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = ItemUpsertZ.safeParse(body);
    if (!parsed.success) fail('ITEM_PAYLOAD_INVALID');
    const data = await this.items.upsert(parsed.data as never, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'EVENT_ITEM_UPSERT',
      permissionKey: 'ADMIN_MANAGE_EVENTS',
      reason: 'item upsert',
      targetType: 'EventItemConfig',
      targetId: parsed.data.key,
      afterJson: data,
    });
    return { ok: true, data };
  }

  // ----- Personal milestone -----

  @Get(':key/personal-progress')
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async listPersonalProgress(@Param('key') key: string) {
    const data = await this.personal.list(key);
    return { ok: true, data };
  }
}
