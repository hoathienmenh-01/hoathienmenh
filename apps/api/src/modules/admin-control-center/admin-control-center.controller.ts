/**
 * Phase 27.6 — Admin Control Center V2 controller.
 *
 * Endpoints (mounted at root, prefixed `/admin/control-center/*`):
 *
 *   - `GET    /admin/control-center/overview`
 *       → permission `ADMIN_VIEW_DASHBOARD`. Snapshot dashboard.
 *   - `GET    /admin/control-center/permissions/me`
 *       → permission `ADMIN_VIEW_DASHBOARD`. Trả role + permission của
 *         caller (UI hiện tab tương ứng).
 *   - `GET    /admin/control-center/permissions/matrix`
 *       → permission `ADMIN_VIEW_DASHBOARD`. Trả full role-perm matrix
 *         + action types + risk mapping (catalog dump).
 *   - `GET    /admin/control-center/audit-action-types`
 *       → permission `ADMIN_VIEW_DASHBOARD`. List action types + default
 *         risk + requires confirmation.
 *   - `GET    /admin/control-center/reward-profiles`
 *       → permission `ADMIN_MANAGE_REWARD_PROFILE`. List + filter.
 *   - `POST   /admin/control-center/reward-profiles`
 *       → permission `ADMIN_MANAGE_REWARD_PROFILE`. Upsert (validator
 *         server-authoritative; ghi `AdminAuditLog`
 *         action `REWARD_PROFILE_UPDATE`).
 *   - `POST   /admin/control-center/reward-profiles/:key/activate`
 *       → permission `ADMIN_MANAGE_REWARD_PROFILE`. Activate (audit
 *         action `REWARD_PROFILE_ACTIVATE`).
 *   - `POST   /admin/control-center/reward-profiles/:key/deactivate`
 *       → permission `ADMIN_MANAGE_REWARD_PROFILE`. Deactivate (audit
 *         action `REWARD_PROFILE_UPDATE`).
 *   - `POST   /admin/control-center/reward-profiles/validate`
 *       → permission `ADMIN_MANAGE_REWARD_PROFILE`. Dry-run validate.
 *   - `GET    /admin/control-center/drop-profiles`
 *       → permission `ADMIN_MANAGE_DROP_PROFILE`. List + filter.
 *   - `POST   /admin/control-center/drop-profiles`
 *       → permission `ADMIN_MANAGE_DROP_PROFILE`. Upsert.
 *   - `POST   /admin/control-center/drop-profiles/:key/activate`
 *   - `POST   /admin/control-center/drop-profiles/:key/deactivate`
 *   - `POST   /admin/control-center/drop-profiles/validate`
 *   - `POST   /admin/control-center/drop-profiles/simulate`
 *       → permission `ADMIN_MANAGE_DROP_PROFILE`. Run deterministic
 *         simulation (audit action `DROP_PROFILE_UPDATE` riskLevel LOW).
 *   - `GET    /admin/control-center/content-statuses`
 *       → permission `ADMIN_VIEW_DASHBOARD`. List read-only.
 *   - `POST   /admin/control-center/content-statuses`
 *       → permission tuỳ contentType:
 *         FARM_MAP/DUNGEON/DAILY_FARM → `ADMIN_MANAGE_MAPS`/`MANAGE_DUNGEONS`
 *         BOSS/WORLD_BOSS/HOURLY_BOSS/EVENT_BOSS → `ADMIN_MANAGE_BOSSES`
 *         SECT_* → `ADMIN_MANAGE_SECT_CONTENT`
 *         TRIAL_TOWER → `ADMIN_MANAGE_TOWERS`
 *         còn lại → `ADMIN_MANAGE_GAME_CONFIG`.
 *         Implement PR1: dùng `ADMIN_MANAGE_GAME_CONFIG` catch-all
 *         (granular permission per-type sẽ split ở PR sau).
 *
 * Tất cả endpoint dùng `AdminPermissionGuard` + `@RequireAdminPermission`.
 * Tất cả mutation ghi `AdminAuditLog` qua `AdminAuditWriter`.
 */
import {
  Body,
  Controller,
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
  ADMIN_ACTION_TYPES,
  ADMIN_PERMISSION_KEYS,
  ADMIN_RISK_LEVELS,
  ADMIN_ROLE_KEYS,
  ADMIN_ROLE_PERMISSIONS,
  DEFAULT_ACTION_RISK,
  REWARD_ENTRY_KINDS,
  REWARD_PROFILE_CONTENT_TYPES,
  DROP_MATERIAL_CATEGORIES,
  DROP_PROFILE_SOURCE_TYPES,
  CONTENT_STATUS_TYPES,
  actionRequiresConfirmation,
  getPermissionsForRole,
  type AdminRoleKey,
} from '@xuantoi/shared';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { AdminPermissionGuard } from './admin-permission.guard';
import { RequireAdminPermission } from './admin-permission.decorator';
import { AdminAuditWriter } from './admin-audit-writer.service';
import { AdminOverviewService } from './admin-overview.service';
import { RewardProfileService } from './reward-profile.service';
import { DropProfileService } from './drop-profile.service';
import { ContentStatusService } from './content-status.service';

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

const RewardProfileEntryZ = z
  .object({
    kind: z.enum(REWARD_ENTRY_KINDS as unknown as [string, ...string[]]),
    key: z.string().min(1).max(100),
    qty: z.number().int().positive(),
    itemTier: z.number().int().min(1).max(9).optional(),
    weight: z.number().min(0).max(1).optional(),
  })
  .strict();

const RewardProfileCapZ = z
  .object({
    dailyCount: z.number().int().min(0).optional(),
    dailyQty: z.number().int().min(0).optional(),
    weeklyCount: z.number().int().min(0).optional(),
    weeklyQty: z.number().int().min(0).optional(),
  })
  .strict();

const RewardProfileUpsertZ = z
  .object({
    key: z.string().min(2).max(80),
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    contentType: z.enum(
      REWARD_PROFILE_CONTENT_TYPES as unknown as [string, ...string[]],
    ),
    contentKey: z.string().min(1).max(120).optional(),
    sourceTier: z.number().int().min(1).max(9),
    rewards: z.array(RewardProfileEntryZ).min(1).max(50),
    cap: RewardProfileCapZ.optional(),
    active: z.boolean(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const RewardProfileValidateZ = RewardProfileUpsertZ.omit({ reason: true });

const DropProfileItemZ = z
  .object({
    itemKey: z.string().min(1).max(100),
    tier: z.number().int().min(1).max(9),
    weight: z.number().positive().max(1_000_000),
    rare: z.boolean().optional(),
  })
  .strict();

const DropProfileCapZ = z
  .object({
    dailyRare: z.number().int().min(0).optional(),
    weeklyRare: z.number().int().min(0).optional(),
    dailyTotal: z.number().int().min(0).optional(),
  })
  .strict();

const DropProfileUpsertZ = z
  .object({
    key: z.string().min(2).max(80),
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    sourceType: z.enum(
      DROP_PROFILE_SOURCE_TYPES as unknown as [string, ...string[]],
    ),
    sourceTier: z.number().int().min(1).max(9),
    materialCategory: z
      .enum(DROP_MATERIAL_CATEGORIES as unknown as [string, ...string[]])
      .optional(),
    baseRate: z.number().min(0).max(1),
    rareRate: z.number().min(0).max(1),
    items: z.array(DropProfileItemZ).min(1).max(50),
    cap: DropProfileCapZ.optional(),
    active: z.boolean(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const DropProfileValidateZ = DropProfileUpsertZ.omit({ reason: true });

const DropProfileSimulateZ = z
  .object({
    spec: DropProfileValidateZ,
    trials: z.number().int().min(100).max(100_000),
    seed: z.number().int().optional(),
  })
  .strict();

const ContentStatusUpsertZ = z
  .object({
    contentType: z.enum(
      CONTENT_STATUS_TYPES as unknown as [string, ...string[]],
    ),
    contentKey: z.string().min(1).max(120),
    enabled: z.boolean(),
    paused: z.boolean(),
    disableReward: z.boolean(),
    disableClaim: z.boolean(),
    message: z.string().max(1000).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

@UseGuards(AdminPermissionGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminControlCenterController {
  constructor(
    private readonly overview: AdminOverviewService,
    private readonly rewardProfile: RewardProfileService,
    private readonly dropProfile: DropProfileService,
    private readonly contentStatus: ContentStatusService,
    private readonly audit: AdminAuditWriter,
  ) {}

  // ----- Overview & permission catalog -----

  @Get('admin/control-center/overview')
  @RequireAdminPermission('ADMIN_VIEW_DASHBOARD')
  async getOverview() {
    const data = await this.overview.getSnapshot();
    return { ok: true, data };
  }

  @Get('admin/control-center/permissions/me')
  @RequireAdminPermission('ADMIN_VIEW_DASHBOARD')
  async getMyPermissions(@Req() req: AdminReq) {
    const role = req.adminRole;
    return {
      ok: true,
      data: {
        role,
        permissions: getPermissionsForRole(role),
      },
    };
  }

  @Get('admin/control-center/permissions/matrix')
  @RequireAdminPermission('ADMIN_VIEW_DASHBOARD')
  async getPermissionMatrix() {
    return {
      ok: true,
      data: {
        roles: ADMIN_ROLE_KEYS,
        permissions: ADMIN_PERMISSION_KEYS,
        rolePermissions: ADMIN_ROLE_PERMISSIONS,
      },
    };
  }

  @Get('admin/control-center/audit-action-types')
  @RequireAdminPermission('ADMIN_VIEW_DASHBOARD')
  async getAuditActionTypes() {
    const list = ADMIN_ACTION_TYPES.map((action) => ({
      action,
      defaultRisk: DEFAULT_ACTION_RISK[action],
      requiresConfirmation: actionRequiresConfirmation(
        DEFAULT_ACTION_RISK[action],
      ),
    }));
    return {
      ok: true,
      data: {
        actions: list,
        riskLevels: ADMIN_RISK_LEVELS,
      },
    };
  }

  // ----- Reward Profile -----

  @Get('admin/control-center/reward-profiles')
  @RequireAdminPermission('ADMIN_MANAGE_REWARD_PROFILE')
  async listRewardProfiles(
    @Query('contentType') contentType?: string,
    @Query('contentKey') contentKey?: string,
    @Query('active') active?: string,
  ) {
    const filters: Parameters<RewardProfileService['list']>[0] = {};
    if (contentType) {
      if (
        !(
          REWARD_PROFILE_CONTENT_TYPES as readonly string[]
        ).includes(contentType)
      ) {
        fail('CONTENT_TYPE_INVALID');
      }
      filters.contentType =
        contentType as (typeof REWARD_PROFILE_CONTENT_TYPES)[number];
    }
    if (contentKey) filters.contentKey = contentKey;
    if (active === 'true') filters.active = true;
    else if (active === 'false') filters.active = false;
    const data = await this.rewardProfile.list(filters);
    return { ok: true, data: { profiles: data } };
  }

  @Post('admin/control-center/reward-profiles/validate')
  @RequireAdminPermission('ADMIN_MANAGE_REWARD_PROFILE')
  async validateRewardProfile(@Body() body: unknown) {
    const parsed = RewardProfileValidateZ.safeParse(body);
    if (!parsed.success) fail('REWARD_PROFILE_BODY_INVALID');
    const issues = this.rewardProfile.validate({
      ...parsed.data,
      version: 1,
    } as Parameters<RewardProfileService['validate']>[0]);
    return { ok: true, data: { issues, valid: issues.length === 0 } };
  }

  @Post('admin/control-center/reward-profiles')
  @RequireAdminPermission('ADMIN_MANAGE_REWARD_PROFILE')
  async upsertRewardProfile(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = RewardProfileUpsertZ.safeParse(body);
    if (!parsed.success) fail('REWARD_PROFILE_BODY_INVALID');
    const before = await this.rewardProfile.findByKey(parsed.data.key);
    const after = await this.rewardProfile.upsert({
      ...parsed.data,
      adminUserId: req.userId,
    } as Parameters<RewardProfileService['upsert']>[0]);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'REWARD_PROFILE_UPDATE',
      permissionKey: 'ADMIN_MANAGE_REWARD_PROFILE',
      reason: parsed.data.reason,
      targetType: 'RewardProfile',
      targetId: parsed.data.key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  @Post('admin/control-center/reward-profiles/:key/activate')
  @RequireAdminPermission('ADMIN_MANAGE_REWARD_PROFILE')
  async activateRewardProfile(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ reason: z.string().min(1).max(500), confirmText: z.string().optional() })
      .strict()
      .safeParse(body);
    if (!parsed.success) fail('REASON_REQUIRED');
    if (!parsed.data.confirmText) fail('CONFIRM_TEXT_REQUIRED');
    const before = await this.rewardProfile.findByKey(key);
    const after = await this.rewardProfile.activate(key, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'REWARD_PROFILE_ACTIVATE',
      permissionKey: 'ADMIN_MANAGE_REWARD_PROFILE',
      reason: parsed.data.reason,
      targetType: 'RewardProfile',
      targetId: key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  @Post('admin/control-center/reward-profiles/:key/deactivate')
  @RequireAdminPermission('ADMIN_MANAGE_REWARD_PROFILE')
  async deactivateRewardProfile(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ reason: z.string().min(1).max(500) })
      .strict()
      .safeParse(body);
    if (!parsed.success) fail('REASON_REQUIRED');
    const before = await this.rewardProfile.findByKey(key);
    const after = await this.rewardProfile.deactivate(key, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'REWARD_PROFILE_UPDATE',
      permissionKey: 'ADMIN_MANAGE_REWARD_PROFILE',
      reason: parsed.data.reason,
      targetType: 'RewardProfile',
      targetId: key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  // ----- Drop Profile -----

  @Get('admin/control-center/drop-profiles')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async listDropProfiles(
    @Query('sourceType') sourceType?: string,
    @Query('sourceTier') sourceTier?: string,
    @Query('active') active?: string,
  ) {
    const filters: Parameters<DropProfileService['list']>[0] = {};
    if (sourceType) {
      if (!(DROP_PROFILE_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
        fail('SOURCE_TYPE_INVALID');
      }
      filters.sourceType =
        sourceType as (typeof DROP_PROFILE_SOURCE_TYPES)[number];
    }
    if (sourceTier) {
      const n = Number(sourceTier);
      if (!Number.isInteger(n) || n < 1 || n > 9) fail('SOURCE_TIER_INVALID');
      filters.sourceTier = n;
    }
    if (active === 'true') filters.active = true;
    else if (active === 'false') filters.active = false;
    const data = await this.dropProfile.list(filters);
    return { ok: true, data: { profiles: data } };
  }

  @Post('admin/control-center/drop-profiles/validate')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async validateDropProfile(@Body() body: unknown) {
    const parsed = DropProfileValidateZ.safeParse(body);
    if (!parsed.success) fail('DROP_PROFILE_BODY_INVALID');
    const issues = this.dropProfile.validate({
      ...parsed.data,
      version: 1,
    } as Parameters<DropProfileService['validate']>[0]);
    return { ok: true, data: { issues, valid: issues.length === 0 } };
  }

  @Post('admin/control-center/drop-profiles/simulate')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async simulateDropProfile(@Body() body: unknown) {
    const parsed = DropProfileSimulateZ.safeParse(body);
    if (!parsed.success) fail('DROP_PROFILE_SIMULATE_BODY_INVALID');
    const result = this.dropProfile.simulate(
      { ...parsed.data.spec, version: 1 } as Parameters<
        DropProfileService['simulate']
      >[0],
      parsed.data.trials,
      parsed.data.seed,
    );
    return { ok: true, data: { simulation: result } };
  }

  @Post('admin/control-center/drop-profiles')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async upsertDropProfile(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = DropProfileUpsertZ.safeParse(body);
    if (!parsed.success) fail('DROP_PROFILE_BODY_INVALID');
    const before = await this.dropProfile.findByKey(parsed.data.key);
    const after = await this.dropProfile.upsert({
      ...parsed.data,
      adminUserId: req.userId,
    } as Parameters<DropProfileService['upsert']>[0]);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'DROP_PROFILE_UPDATE',
      permissionKey: 'ADMIN_MANAGE_DROP_PROFILE',
      reason: parsed.data.reason,
      targetType: 'DropProfile',
      targetId: parsed.data.key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  @Post('admin/control-center/drop-profiles/:key/activate')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async activateDropProfile(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ reason: z.string().min(1).max(500), confirmText: z.string().optional() })
      .strict()
      .safeParse(body);
    if (!parsed.success) fail('REASON_REQUIRED');
    if (!parsed.data.confirmText) fail('CONFIRM_TEXT_REQUIRED');
    const before = await this.dropProfile.findByKey(key);
    const after = await this.dropProfile.activate(key, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'DROP_PROFILE_ACTIVATE',
      permissionKey: 'ADMIN_MANAGE_DROP_PROFILE',
      reason: parsed.data.reason,
      targetType: 'DropProfile',
      targetId: key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  @Post('admin/control-center/drop-profiles/:key/deactivate')
  @RequireAdminPermission('ADMIN_MANAGE_DROP_PROFILE')
  async deactivateDropProfile(
    @Req() req: AdminReq,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ reason: z.string().min(1).max(500) })
      .strict()
      .safeParse(body);
    if (!parsed.success) fail('REASON_REQUIRED');
    const before = await this.dropProfile.findByKey(key);
    const after = await this.dropProfile.deactivate(key, req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'DROP_PROFILE_UPDATE',
      permissionKey: 'ADMIN_MANAGE_DROP_PROFILE',
      reason: parsed.data.reason,
      targetType: 'DropProfile',
      targetId: key,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { profile: after } };
  }

  // ----- Content Status -----

  @Get('admin/control-center/content-statuses')
  @RequireAdminPermission('ADMIN_VIEW_DASHBOARD')
  async listContentStatuses(
    @Query('contentType') contentType?: string,
    @Query('enabled') enabled?: string,
    @Query('paused') paused?: string,
  ) {
    const filters: Parameters<ContentStatusService['list']>[0] = {};
    if (contentType) {
      if (!(CONTENT_STATUS_TYPES as readonly string[]).includes(contentType)) {
        fail('CONTENT_TYPE_INVALID');
      }
      filters.contentType =
        contentType as (typeof CONTENT_STATUS_TYPES)[number];
    }
    if (enabled === 'true') filters.enabled = true;
    else if (enabled === 'false') filters.enabled = false;
    if (paused === 'true') filters.paused = true;
    else if (paused === 'false') filters.paused = false;
    const data = await this.contentStatus.list(filters);
    return { ok: true, data: { statuses: data } };
  }

  @Post('admin/control-center/content-statuses')
  @RequireAdminPermission('ADMIN_MANAGE_GAME_CONFIG')
  async upsertContentStatus(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = ContentStatusUpsertZ.safeParse(body);
    if (!parsed.success) fail('CONTENT_STATUS_BODY_INVALID');
    const before = await this.contentStatus.findByKey(
      parsed.data.contentType as (typeof CONTENT_STATUS_TYPES)[number],
      parsed.data.contentKey,
    );
    const after = await this.contentStatus.upsert(
      {
        contentType: parsed.data.contentType as (typeof CONTENT_STATUS_TYPES)[number],
        contentKey: parsed.data.contentKey,
        enabled: parsed.data.enabled,
        paused: parsed.data.paused,
        disableReward: parsed.data.disableReward,
        disableClaim: parsed.data.disableClaim,
        message: parsed.data.message,
      },
      req.userId,
    );
    const actionType = parsed.data.paused
      ? 'CONTENT_PAUSE'
      : parsed.data.enabled
        ? 'CONTENT_ENABLE'
        : 'CONTENT_DISABLE';
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType,
      permissionKey: 'ADMIN_MANAGE_GAME_CONFIG',
      reason: parsed.data.reason,
      targetType: 'ContentStatus',
      targetId: `${parsed.data.contentType}:${parsed.data.contentKey}`,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: { status: after } };
  }
}
