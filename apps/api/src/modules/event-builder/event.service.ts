import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  EVENT_STATUSES,
  EVENT_TYPES,
  EVENT_TYPES_REQUIRE_BRACKET_RANKING,
  BRACKET_MODES,
  validateEventDef,
  computeEffectiveRewardTier,
  publicEventSummary,
  type EventDef as EventDefShared,
  type EventStatus,
  type EventType,
  type BracketMode,
  type PublicEventSummary,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventService.
 *
 * CRUD + lifecycle cho `EventDef` model. Toàn bộ mutation đi qua
 * `validateEventDef` ở shared (cũng dùng cho dry-run validate
 * endpoint admin). Status transitions enforced ở service layer.
 *
 * Lifecycle hợp lệ:
 *   DRAFT     → SCHEDULED, CANCELLED
 *   SCHEDULED → ACTIVE, PAUSED, CANCELLED
 *   ACTIVE    → PAUSED, REWARD_LOCKED, ENDED, CANCELLED
 *   PAUSED    → ACTIVE, ENDED, CANCELLED
 *   REWARD_LOCKED → ENDED
 *   ENDED     → FINALIZED, ARCHIVED
 *   FINALIZED → ARCHIVED
 *   ARCHIVED  → (terminal)
 *   CANCELLED → ARCHIVED (terminal)
 */

const STATUS_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> =
  {
    DRAFT: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['ACTIVE', 'PAUSED', 'CANCELLED'],
    ACTIVE: ['PAUSED', 'REWARD_LOCKED', 'ENDED', 'CANCELLED'],
    PAUSED: ['ACTIVE', 'ENDED', 'CANCELLED'],
    REWARD_LOCKED: ['ENDED'],
    ENDED: ['FINALIZED', 'ARCHIVED'],
    FINALIZED: ['ARCHIVED'],
    ARCHIVED: [],
    CANCELLED: ['ARCHIVED'],
  };

export interface EventDefUpsertInput {
  key: string;
  name: string;
  description?: string;
  eventType: EventType;
  startsAt: Date | string;
  endsAt: Date | string;
  timezone?: string;
  bannerUrl?: string | null;
  iconUrl?: string | null;
  adminNote?: string | null;
  playerNotice?: string | null;
  enabled?: boolean;
  bracketMode?: BracketMode;
  tokenKey?: string | null;
  eventShopKey?: string | null;
  missionGroupKey?: string | null;
  bossGroupKey?: string | null;
  rankingGroupKey?: string | null;
  rewardProfileKey?: string | null;
}

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(filters?: {
    status?: EventStatus;
    eventType?: EventType;
    enabled?: boolean;
  }): Promise<EventDefShared[]> {
    const rows = await this.prisma.eventDef.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.eventType ? { eventType: filters.eventType } : {}),
        ...(filters?.enabled !== undefined ? { enabled: filters.enabled } : {}),
      },
      orderBy: [{ startsAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.toShared(r));
  }

  async findByKey(key: string): Promise<EventDefShared | null> {
    const row = await this.prisma.eventDef.findUnique({ where: { key } });
    return row ? this.toShared(row) : null;
  }

  async listPublicForPlayer(opts: {
    bracketKey?: string | null;
    bracketTier?: number | null;
    playerTier?: number | null;
    now?: number;
  }): Promise<PublicEventSummary[]> {
    const now = opts.now ?? Date.now();
    const rows = await this.prisma.eventDef.findMany({
      where: {
        enabled: true,
        status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'REWARD_LOCKED'] },
      },
      orderBy: [{ startsAt: 'asc' }],
      take: 100,
    });
    return rows.map((r) =>
      publicEventSummary(
        this.toShared(r),
        {
          bracketKey: opts.bracketKey ?? null,
          bracketTier: opts.bracketTier ?? undefined,
          playerTier: opts.playerTier ?? undefined,
        },
        now,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Validate + Upsert
  // -------------------------------------------------------------------------

  validate(input: EventDefUpsertInput) {
    return validateEventDef({
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      eventType: input.eventType,
      status: 'DRAFT',
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
      bannerUrl: input.bannerUrl ?? null,
      iconUrl: input.iconUrl ?? null,
      adminNote: input.adminNote ?? null,
      playerNotice: input.playerNotice ?? null,
      enabled: input.enabled ?? true,
      bracketMode: input.bracketMode ?? 'NONE',
      tokenKey: input.tokenKey ?? null,
      eventShopKey: input.eventShopKey ?? null,
      missionGroupKey: input.missionGroupKey ?? null,
      bossGroupKey: input.bossGroupKey ?? null,
      rankingGroupKey: input.rankingGroupKey ?? null,
      rewardProfileKey: input.rewardProfileKey ?? null,
      createdBy: 'PENDING',
      updatedBy: 'PENDING',
    });
  }

  async create(
    input: EventDefUpsertInput,
    adminUserId: string,
  ): Promise<EventDefShared> {
    const v = this.validate(input);
    if (!v.ok) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_INVALID', meta: { issues: v.errors } } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.eventDef.findUnique({
      where: { key: input.key },
    });
    if (existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_KEY_DUPLICATE' } },
        HttpStatus.CONFLICT,
      );
    }
    const row = await this.prisma.eventDef.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? '',
        eventType: input.eventType,
        status: 'DRAFT',
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
        bannerUrl: input.bannerUrl ?? null,
        iconUrl: input.iconUrl ?? null,
        adminNote: input.adminNote ?? null,
        playerNotice: input.playerNotice ?? null,
        enabled: input.enabled ?? true,
        bracketMode: input.bracketMode ?? 'NONE',
        tokenKey: input.tokenKey ?? null,
        eventShopKey: input.eventShopKey ?? null,
        missionGroupKey: input.missionGroupKey ?? null,
        bossGroupKey: input.bossGroupKey ?? null,
        rankingGroupKey: input.rankingGroupKey ?? null,
        rewardProfileKey: input.rewardProfileKey ?? null,
        createdByAdminId: adminUserId,
        updatedByAdminId: adminUserId,
      },
    });
    return this.toShared(row);
  }

  async update(
    key: string,
    input: Partial<EventDefUpsertInput>,
    adminUserId: string,
  ): Promise<EventDefShared> {
    const existing = await this.prisma.eventDef.findUnique({ where: { key } });
    if (!existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    // Build merged spec để validate.
    const merged: EventDefUpsertInput = {
      key,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      eventType: (input.eventType ?? existing.eventType) as EventType,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
      timezone: input.timezone ?? existing.timezone,
      bannerUrl: input.bannerUrl ?? existing.bannerUrl,
      iconUrl: input.iconUrl ?? existing.iconUrl,
      adminNote: input.adminNote ?? existing.adminNote,
      playerNotice: input.playerNotice ?? existing.playerNotice,
      enabled: input.enabled ?? existing.enabled,
      bracketMode: (input.bracketMode ?? existing.bracketMode) as BracketMode,
      tokenKey: input.tokenKey ?? existing.tokenKey,
      eventShopKey: input.eventShopKey ?? existing.eventShopKey,
      missionGroupKey: input.missionGroupKey ?? existing.missionGroupKey,
      bossGroupKey: input.bossGroupKey ?? existing.bossGroupKey,
      rankingGroupKey: input.rankingGroupKey ?? existing.rankingGroupKey,
      rewardProfileKey: input.rewardProfileKey ?? existing.rewardProfileKey,
    };
    const v = this.validate(merged);
    if (!v.ok) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_INVALID', meta: { issues: v.errors } } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.prisma.eventDef.update({
      where: { key },
      data: {
        name: merged.name,
        description: merged.description ?? '',
        eventType: merged.eventType,
        startsAt: new Date(merged.startsAt),
        endsAt: new Date(merged.endsAt),
        timezone: merged.timezone ?? 'Asia/Ho_Chi_Minh',
        bannerUrl: merged.bannerUrl ?? null,
        iconUrl: merged.iconUrl ?? null,
        adminNote: merged.adminNote ?? null,
        playerNotice: merged.playerNotice ?? null,
        enabled: merged.enabled ?? true,
        bracketMode: merged.bracketMode ?? 'NONE',
        tokenKey: merged.tokenKey ?? null,
        eventShopKey: merged.eventShopKey ?? null,
        missionGroupKey: merged.missionGroupKey ?? null,
        bossGroupKey: merged.bossGroupKey ?? null,
        rankingGroupKey: merged.rankingGroupKey ?? null,
        rewardProfileKey: merged.rewardProfileKey ?? null,
        updatedByAdminId: adminUserId,
      },
    });
    return this.toShared(row);
  }

  async delete(key: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.eventDef.findUnique({ where: { key } });
    if (!existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      existing.status === 'ACTIVE' ||
      existing.status === 'PAUSED' ||
      existing.status === 'REWARD_LOCKED'
    ) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_CANNOT_DELETE_LIVE' } },
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.eventDef.delete({ where: { key } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async transition(
    key: string,
    nextStatus: EventStatus,
    adminUserId: string,
  ): Promise<EventDefShared> {
    const existing = await this.prisma.eventDef.findUnique({ where: { key } });
    if (!existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!(EVENT_STATUSES as readonly string[]).includes(nextStatus)) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_STATUS_INVALID' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowed = STATUS_TRANSITIONS[existing.status as EventStatus] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'EVENT_STATUS_TRANSITION_INVALID',
            meta: { from: existing.status, to: nextStatus },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
    // Khi activate phải có balance policy.
    if (nextStatus === 'ACTIVE') {
      const policy = await this.prisma.eventBalancePolicy.findUnique({
        where: { eventKey: key },
      });
      if (!policy || !policy.enabled) {
        throw new HttpException(
          { ok: false, error: { code: 'EVENT_BALANCE_POLICY_MISSING' } },
          HttpStatus.CONFLICT,
        );
      }
      if (existing.bracketMode !== 'NONE') {
        const cnt = await this.prisma.eventBracket.count({
          where: { eventKey: key, enabled: true },
        });
        if (cnt === 0) {
          throw new HttpException(
            { ok: false, error: { code: 'EVENT_BRACKETS_REQUIRED' } },
            HttpStatus.CONFLICT,
          );
        }
      }
    }
    const row = await this.prisma.eventDef.update({
      where: { key },
      data: { status: nextStatus, updatedByAdminId: adminUserId },
    });
    return this.toShared(row);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  computeEffectiveRewardTier(
    playerTier: number,
    bracketTier: number,
    eventMaxTier: number,
  ): number {
    return computeEffectiveRewardTier(playerTier, bracketTier, eventMaxTier);
  }

  isRankingTypeRequiringBracket(eventType: EventType): boolean {
    return EVENT_TYPES_REQUIRE_BRACKET_RANKING.has(eventType);
  }

  toShared(row: {
    key: string;
    name: string;
    description: string;
    eventType: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    bannerUrl: string | null;
    iconUrl: string | null;
    adminNote: string | null;
    playerNotice: string | null;
    enabled: boolean;
    bracketMode: string;
    tokenKey: string | null;
    eventShopKey: string | null;
    missionGroupKey: string | null;
    bossGroupKey: string | null;
    rankingGroupKey: string | null;
    rewardProfileKey: string | null;
    createdByAdminId: string | null;
    updatedByAdminId: string | null;
  }): EventDefShared {
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      eventType: row.eventType as EventType,
      status: row.status as EventStatus,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: row.timezone,
      bannerUrl: row.bannerUrl,
      iconUrl: row.iconUrl,
      adminNote: row.adminNote,
      playerNotice: row.playerNotice,
      enabled: row.enabled,
      bracketMode: row.bracketMode as BracketMode,
      tokenKey: row.tokenKey,
      eventShopKey: row.eventShopKey,
      missionGroupKey: row.missionGroupKey,
      bossGroupKey: row.bossGroupKey,
      rankingGroupKey: row.rankingGroupKey,
      rewardProfileKey: row.rewardProfileKey,
      createdBy: row.createdByAdminId ?? 'system',
      updatedBy: row.updatedByAdminId ?? 'system',
    };
  }
}

export { EVENT_TYPES, EVENT_STATUSES, BRACKET_MODES };
