import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIVE_OPS_DEFAULT_TZ,
  LIVE_OPS_EVENTS,
  activeLiveOpsEvents,
  getLiveOpsEventDef,
  liveOpsEventsForToday,
  type LiveOpsEventDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 13.1.B — Admin LiveOps Controls service.
 *
 * Mục tiêu PR (intentional minimal — KHÔNG full CMS):
 *   - GET status: list catalog + override hiện tại + computed today/active.
 *   - POST toggle: upsert `LiveOpsEventOverride` với `enabled` + optional
 *     window. Mọi mutation log vào `AdminAuditLedger` reason
 *     `ADMIN_LIVEOPS_OVERRIDE`.
 *   - GET sect-war/status: snapshot leaderboard + cumulative weeks count
 *     (read-only audit).
 *   - POST sect-war/recalculate: lazy / no-op trong PR này (catalog-driven
 *     Sect War KHÔNG cần recalc — placeholder cho Phase 13.2 cross-sect).
 *
 * Audit:
 *   - Mọi POST endpoint đều ghi `AdminAuditLedger` qua
 *     `AdminAuditLedgerService.write` (mirror existing admin pattern).
 *   - Catalog read-only (KHÔNG mutate `LIVE_OPS_EVENTS`); `enabled`
 *     hiệu dụng = catalog AND override (override.enabled = false ⇒ disable;
 *     override absent ⇒ catalog default; override.enabled = true với
 *     `startsAt`/`endsAt` ⇒ window override).
 */

export type AdminLiveOpsErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'INVALID_INPUT';

export class AdminLiveOpsError extends Error {
  readonly code: AdminLiveOpsErrorCode;
  constructor(code: AdminLiveOpsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AdminLiveOpsError';
    this.code = code;
  }
}

export interface LiveOpsOverrideView {
  key: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export interface LiveOpsEventStatusView {
  key: string;
  type: LiveOpsEventDef['type'];
  catalogEnabled: boolean;
  /** Effective enabled = catalog `enabled` AND (override absent OR override.enabled). */
  effectiveEnabled: boolean;
  override: LiveOpsOverrideView | null;
  titleI18nKey: string;
  descriptionI18nKey: string;
  dailyTime?: string;
  durationMinutes?: number;
  daysOfWeek?: ReadonlyArray<number>;
  regionKey?: string;
  bossKey?: string;
  startTime?: string;
  endTime?: string;
}

export interface LiveOpsStatusView {
  /** Catalog version + tz cho FE display. */
  tz: string;
  events: ReadonlyArray<LiveOpsEventStatusView>;
  /** Computed today (effective). */
  todayKeys: ReadonlyArray<string>;
  activeKeys: ReadonlyArray<string>;
}

export interface LiveOpsOverrideToggleInput {
  key: string;
  enabled: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  reason?: string | null;
}

export interface SectWarStatusView {
  weekKey: string;
  totalSects: number;
  totalContributors: number;
  totalContributions: number;
  topSects: ReadonlyArray<{
    sectId: string;
    sectName: string;
    points: number;
    contributors: number;
  }>;
}

@Injectable()
export class AdminLiveOpsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Audit helper — mirror `AdminService.audit` private pattern. */
  private async writeAudit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId, action, meta: meta as Prisma.InputJsonValue },
    });
  }

  /**
   * GET /admin/liveops — list catalog + DB overrides + computed today/active.
   */
  async getStatus(now: Date = new Date()): Promise<LiveOpsStatusView> {
    const overrides = await this.prisma.liveOpsEventOverride.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const overridesByKey = new Map(overrides.map((o) => [o.key, o]));

    const events: LiveOpsEventStatusView[] = LIVE_OPS_EVENTS.map((def) => {
      const ovr = overridesByKey.get(def.key);
      const overrideView: LiveOpsOverrideView | null = ovr
        ? {
            key: ovr.key,
            enabled: ovr.enabled,
            startsAt: ovr.startsAt ? ovr.startsAt.toISOString() : null,
            endsAt: ovr.endsAt ? ovr.endsAt.toISOString() : null,
            reason: ovr.reason ?? null,
            updatedBy: ovr.updatedBy,
            updatedAt: ovr.updatedAt.toISOString(),
            createdAt: ovr.createdAt.toISOString(),
          }
        : null;
      const effectiveEnabled = def.enabled && (!ovr || ovr.enabled);
      return {
        key: def.key,
        type: def.type,
        catalogEnabled: def.enabled,
        effectiveEnabled,
        override: overrideView,
        titleI18nKey: def.titleI18nKey,
        descriptionI18nKey: def.descriptionI18nKey,
        dailyTime: def.dailyTime,
        durationMinutes: def.durationMinutes,
        daysOfWeek: def.daysOfWeek,
        regionKey: def.regionKey,
        bossKey: def.bossKey,
        startTime: def.startTime,
        endTime: def.endTime,
      };
    });

    // Computed today/active dựa trên catalog (effective enabled overlay).
    const tz = LIVE_OPS_DEFAULT_TZ;
    const todayDefs = liveOpsEventsForToday(now, tz);
    const activeDefs = activeLiveOpsEvents(now, tz);
    const todayKeys = todayDefs
      .filter((e) => events.find((v) => v.key === e.key)?.effectiveEnabled)
      .map((e) => e.key);
    const activeKeys = activeDefs
      .filter((e) => events.find((v) => v.key === e.key)?.effectiveEnabled)
      .map((e) => e.key);

    return { tz, events, todayKeys, activeKeys };
  }

  /**
   * POST /admin/liveops/event/toggle — upsert override + audit log.
   * `enabled=true` + no window ⇒ remove override (revert to catalog default).
   */
  async toggleEvent(
    actorUserId: string,
    input: LiveOpsOverrideToggleInput,
  ): Promise<LiveOpsOverrideView> {
    const def = getLiveOpsEventDef(input.key);
    if (!def) throw new AdminLiveOpsError('EVENT_NOT_FOUND');

    const startsAt = input.startsAt ?? null;
    const endsAt = input.endsAt ?? null;
    if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) {
      throw new AdminLiveOpsError('INVALID_INPUT', 'startsAt must be <= endsAt');
    }

    const reason = input.reason ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.liveOpsEventOverride.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          enabled: input.enabled,
          startsAt,
          endsAt,
          reason,
          updatedBy: actorUserId,
        },
        update: {
          enabled: input.enabled,
          startsAt,
          endsAt,
          reason,
          updatedBy: actorUserId,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'ADMIN_LIVEOPS_OVERRIDE',
          meta: {
            targetType: 'LiveOpsEvent',
            targetId: input.key,
            enabled: input.enabled,
            startsAt: startsAt ? startsAt.toISOString() : null,
            endsAt: endsAt ? endsAt.toISOString() : null,
            reason,
            catalogEnabled: def.enabled,
          } as Prisma.InputJsonValue,
        },
      });
      return upserted;
    });

    return {
      key: result.key,
      enabled: result.enabled,
      startsAt: result.startsAt ? result.startsAt.toISOString() : null,
      endsAt: result.endsAt ? result.endsAt.toISOString() : null,
      reason: result.reason ?? null,
      updatedBy: result.updatedBy,
      updatedAt: result.updatedAt.toISOString(),
      createdAt: result.createdAt.toISOString(),
    };
  }

  /**
   * GET /admin/sect-war/status — read-only snapshot weekly leaderboard +
   * cumulative weeks count. KHÔNG mutate.
   */
  async getSectWarStatus(weekKey: string): Promise<SectWarStatusView> {
    const grouped = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId'],
      where: { weekKey },
      _sum: { points: true },
      _count: { _all: true },
    });
    const totalContribRows = grouped.reduce(
      (acc, g) => acc + (g._count._all ?? 0),
      0,
    );
    const sectIds = grouped.map((g) => g.sectId);
    const sects =
      sectIds.length > 0
        ? await this.prisma.sect.findMany({
            where: { id: { in: sectIds } },
            select: { id: true, name: true },
          })
        : [];
    const sectNameById = new Map(sects.map((s) => [s.id, s.name]));
    const distinctContribs = sectIds.length > 0
      ? await this.prisma.sectWarContribution.findMany({
          where: { weekKey, sectId: { in: sectIds } },
          select: { sectId: true, characterId: true },
          distinct: ['sectId', 'characterId'],
        })
      : [];
    const contribMap = new Map<string, Set<string>>();
    for (const r of distinctContribs) {
      let s = contribMap.get(r.sectId);
      if (!s) {
        s = new Set<string>();
        contribMap.set(r.sectId, s);
      }
      s.add(r.characterId);
    }
    const topSects = grouped
      .map((g) => ({
        sectId: g.sectId,
        sectName: sectNameById.get(g.sectId) ?? '',
        points: g._sum.points ?? 0,
        contributors: contribMap.get(g.sectId)?.size ?? 0,
      }))
      .sort((a, b) => b.points - a.points || a.sectId.localeCompare(b.sectId))
      .slice(0, 10);

    const totalContributors = Array.from(contribMap.values()).reduce(
      (acc, s) => acc + s.size,
      0,
    );

    return {
      weekKey,
      totalSects: grouped.length,
      totalContributors,
      totalContributions: totalContribRows,
      topSects,
    };
  }

  /**
   * POST /admin/sect-war/recalculate — placeholder cho Phase 13.2 cross-sect
   * recompute. PR 13.1.B: log audit + no-op (sect war catalog-driven, không
   * cần recalc internal state). Trả về `noop=true` cho FE confirm.
   */
  async recalculateSectWar(
    actorUserId: string,
    weekKey: string,
    reason?: string,
  ): Promise<{ noop: true; weekKey: string }> {
    await this.writeAudit(actorUserId, 'ADMIN_SECT_WAR_RECALCULATE', {
      targetType: 'SectWarWeek',
      targetId: weekKey,
      reason: reason ?? null,
      noop: true,
    });
    return { noop: true, weekKey };
  }

  /** Helper internal — meta cast cho audit.write. */
  static metaToJson(meta: Record<string, unknown>): Prisma.InputJsonValue {
    return meta as Prisma.InputJsonValue;
  }
}
