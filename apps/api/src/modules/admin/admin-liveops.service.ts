import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIVE_OPS_DEFAULT_TZ,
  LIVE_OPS_EVENTS,
  activeLiveOpsEvents,
  bossByKey,
  bossScheduleForToday,
  currentSectWarSeason,
  eventSlotDurationMs,
  eventSlotStartFor,
  getLiveOpsEventDef,
  liveOpsEventsForToday,
  localPartsInTz,
  nextLiveOpsEvent,
  sectWarWeekKey,
  type BossDef,
  type BossScheduleSlot,
  type LiveOpsEventDef,
  type SectWarSeasonDef,
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
  | 'BOSS_NOT_FOUND'
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

// ──────────────────────────────────────────────────────────────────────
// Phase 13.1.D — Schedule Preview & Dry-run views.
//
// Mục tiêu: Admin có thể xem trước lịch event/boss/sect war + override
// đang bật/tắt và kiểm tra dry-run (giả lập, KHÔNG ghi DB) trước khi bật
// thật. Read-only aggregate qua các shared helpers
// (`liveOpsEventsForToday`, `activeLiveOpsEvents`, `bossScheduleForToday`,
// `nextLiveOpsEvent`, `currentSectWarSeason`).
// ──────────────────────────────────────────────────────────────────────

/** 1 slot event sắp tới — dùng cho FE preview countdown. */
export interface UpcomingEventSlotView {
  key: string;
  type: LiveOpsEventDef['type'];
  titleI18nKey: string;
  descriptionI18nKey: string;
  effectiveEnabled: boolean;
  catalogEnabled: boolean;
  slotStartIso: string;
  slotEndIso: string;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
}

/** 1 slot boss snapshot (today/week) — wrap shared `BossScheduleSlot` ISO. */
export interface BossScheduleSlotView {
  key: string;
  bossKey: string;
  regionKey: string;
  slotStartIso: string;
  slotEndIso: string;
  status: BossScheduleSlot['status'];
  rewardHintI18nKey?: string;
  effectiveEnabled: boolean;
  catalogEnabled: boolean;
  /** ISO local day (YYYY-MM-DD) cho FE group theo ngày trong tuần. */
  localDate: string;
}

/** Active LiveOps event view (slot start/end ISO). */
export interface ActiveEventView {
  key: string;
  type: LiveOpsEventDef['type'];
  titleI18nKey: string;
  descriptionI18nKey: string;
  slotStartIso: string;
  slotEndIso: string;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
}

export interface SchedulePreviewView {
  /** Server-side computed timestamp ở ISO. */
  nowIso: string;
  /** IANA tz dùng để compute schedule (default `LIVE_OPS_DEFAULT_TZ`). */
  tz: string;
  /** Event đang ACTIVE tại `now` (sau overlay override effective). */
  activeEvents: ReadonlyArray<ActiveEventView>;
  /** Top N (default 5) slot kế tiếp cho mỗi event catalog (đã filter effective). */
  upcomingEvents: ReadonlyArray<UpcomingEventSlotView>;
  /** Boss schedule cho NGÀY HÔM NAY theo `tz` (sub-list của `liveOpsEventsForToday`). */
  bossScheduleToday: ReadonlyArray<BossScheduleSlotView>;
  /** Boss schedule cho 7 NGÀY tới (gộp local day). */
  bossScheduleWeek: ReadonlyArray<BossScheduleSlotView>;
  /** Sect War tuần hiện tại (snapshot read-only). */
  sectWar: {
    season: SectWarSeasonDef;
    status: SectWarStatusView;
  };
  /** Override hiện đang lưu trong DB (mọi key — bao gồm enabled=false). */
  overrides: ReadonlyArray<LiveOpsOverrideView>;
}

export type DryRunKind = 'event' | 'boss';

export interface DryRunInput {
  kind: DryRunKind;
  /** Cho `event`: LiveOps event key. Cho `boss`: BossDef.key. */
  key: string;
  /** Cho `boss`: optional region (default = catalog regionKey hoặc 'world'). */
  regionKey?: string;
  /** Cho `boss`: optional level multiplier (default 1, range 1..99). */
  level?: number;
  /** Optional admin reason — ghi vào audit `ADMIN_LIVEOPS_DRY_RUN`. */
  reason?: string;
}

export interface DryRunEventResult {
  kind: 'event';
  key: string;
  type: LiveOpsEventDef['type'];
  titleI18nKey: string;
  descriptionI18nKey: string;
  catalogEnabled: boolean;
  effectiveEnabled: boolean;
  override: LiveOpsOverrideView | null;
  /** Slot start kế tiếp (ISO) nếu helper compute được. */
  nextSlotStartIso: string | null;
  /** Slot end (ISO) nếu helper compute được. */
  nextSlotEndIso: string | null;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
  /** Cờ tường minh — luôn `true`, KHÔNG có DB write. */
  simulated: true;
  /** Lý do admin nhập (nếu có). */
  reason: string | null;
  simulatedAt: string;
}

export interface DryRunBossResult {
  kind: 'boss';
  bossKey: string;
  bossName: string;
  regionKey: string;
  level: number;
  /** baseMaxHp scale theo level (giả lập, KHÔNG insert WorldBoss row). */
  simulatedMaxHp: string;
  /** Reward catalog (text-only, KHÔNG grant). */
  simulatedReward: {
    baseLinhThach: number;
    topDropPool: ReadonlyArray<string>;
    midDropPool: ReadonlyArray<string>;
    lowDropPool: ReadonlyArray<string>;
  };
  recommendedRealm: string;
  simulated: true;
  reason: string | null;
  simulatedAt: string;
}

export type DryRunResult = DryRunEventResult | DryRunBossResult;

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

  /**
   * Phase 13.1.C — Admin LiveOps Advanced Controls.
   *
   * POST /admin/sect-war/snapshot — record-for-audit sect war state. Read
   * snapshot via `getSectWarStatus(weekKey)` rồi ghi 1 audit row
   * `ADMIN_SECT_WAR_STATUS` để paper-trail rằng admin X đã review state
   * sect war week Y vào thời điểm Z (compliance / handoff). KHÔNG mutate
   * dữ liệu sect war.
   *
   * Khác biệt với GET /admin/sect-war/status:
   *   - GET = auto-fetch FE refresh, KHÔNG audit (tránh log spam).
   *   - POST snapshot = explicit "ghi nhận trạng thái cho hồ sơ" — admin
   *     bấm nút trên panel.
   */
  async snapshotSectWarStatus(
    actorUserId: string,
    weekKey: string,
    reason?: string,
  ): Promise<SectWarStatusView> {
    const snapshot = await this.getSectWarStatus(weekKey);
    await this.writeAudit(actorUserId, 'ADMIN_SECT_WAR_STATUS', {
      targetType: 'SectWarWeek',
      targetId: weekKey,
      reason: reason?.trim() || null,
      summary: {
        totalSects: snapshot.totalSects,
        totalContributors: snapshot.totalContributors,
        totalContributions: snapshot.totalContributions,
        topSectIds: snapshot.topSects.slice(0, 3).map((s) => s.sectId),
      },
    });
    return snapshot;
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase 13.1.D — Schedule Preview & Dry-run.
  // ────────────────────────────────────────────────────────────────────

  /**
   * GET /admin/liveops/schedule-preview — read-only aggregate cho admin xem
   * trước:
   *   - Event đang ACTIVE tại `now` (đã overlay override DB).
   *   - Top N slot kế tiếp cho mỗi event catalog (search 7 ngày).
   *   - Boss schedule today (và 7 ngày tới, group theo local day).
   *   - Sect War season tuần hiện tại + status snapshot leaderboard.
   *   - Toàn bộ override hiện đang lưu trong DB.
   *
   * KHÔNG mutate, KHÔNG audit (read-only refresh; tránh log spam).
   */
  async schedulePreview(now: Date = new Date()): Promise<SchedulePreviewView> {
    const tz = LIVE_OPS_DEFAULT_TZ;

    // 1) Override DB — overlay computed effective enabled.
    const overrideRows = await this.prisma.liveOpsEventOverride.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const overridesByKey = new Map(overrideRows.map((o) => [o.key, o]));
    const overrideViews: LiveOpsOverrideView[] = overrideRows.map((o) => ({
      key: o.key,
      enabled: o.enabled,
      startsAt: o.startsAt ? o.startsAt.toISOString() : null,
      endsAt: o.endsAt ? o.endsAt.toISOString() : null,
      reason: o.reason ?? null,
      updatedBy: o.updatedBy,
      updatedAt: o.updatedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
    }));

    const isEffectiveEnabled = (def: LiveOpsEventDef, t: Date): boolean => {
      const ovr = overridesByKey.get(def.key);
      if (!def.enabled) return false;
      if (!ovr) return true;
      if (!ovr.enabled) return false;
      const tt = t.getTime();
      if (ovr.startsAt && tt < ovr.startsAt.getTime()) return true; // window chưa bắt đầu → coi như catalog default
      if (ovr.endsAt && tt > ovr.endsAt.getTime()) return true;
      return true;
    };

    // 2) Active events — overlay effective enabled.
    const activeDefs = activeLiveOpsEvents(now, tz).filter((def) =>
      isEffectiveEnabled(def, now),
    );
    const activeEvents: ActiveEventView[] = activeDefs.map((def) => {
      const parts = localPartsInTz(now, tz);
      const start = eventSlotStartFor(def, parts.year, parts.month, parts.day, tz);
      const dur = eventSlotDurationMs(def);
      const slotStartIso = start ? start.toISOString() : now.toISOString();
      const slotEndIso = start
        ? new Date(start.getTime() + dur).toISOString()
        : new Date(now.getTime() + dur).toISOString();
      return {
        key: def.key,
        type: def.type,
        titleI18nKey: def.titleI18nKey,
        descriptionI18nKey: def.descriptionI18nKey,
        slotStartIso,
        slotEndIso,
        regionKey: def.regionKey,
        bossKey: def.bossKey,
        rewardHintI18nKey: def.rewardHintI18nKey,
      };
    });

    // 3) Upcoming events — search 7 ngày kế, take top 5 per event key.
    //    Dùng walk theo từng ngày + collect slot start (giống nextLiveOpsEvent
    //    nhưng exhaustive). LIMITED chỉ collect 1 lần.
    const UPCOMING_LIMIT_PER_KEY = 5;
    const upcomingByKey = new Map<string, UpcomingEventSlotView[]>();
    const t0 = now.getTime();
    for (let i = 0; i < 8; i++) {
      const probe = new Date(t0 + i * 24 * 60 * 60_000);
      const parts = localPartsInTz(probe, tz);
      for (const def of LIVE_OPS_EVENTS) {
        if (def.type === 'STORY') continue;
        const list = upcomingByKey.get(def.key) ?? [];
        if (list.length >= UPCOMING_LIMIT_PER_KEY) continue;

        if (def.type === 'LIMITED') {
          if (i !== 0) continue;
          if (!def.startTime) continue;
          const s = new Date(def.startTime);
          if (Number.isNaN(s.getTime())) continue;
          if (s.getTime() <= t0) continue;
          const e = def.endTime
            ? new Date(def.endTime)
            : new Date(s.getTime() + eventSlotDurationMs(def));
          list.push({
            key: def.key,
            type: def.type,
            titleI18nKey: def.titleI18nKey,
            descriptionI18nKey: def.descriptionI18nKey,
            effectiveEnabled: isEffectiveEnabled(def, s),
            catalogEnabled: def.enabled,
            slotStartIso: s.toISOString(),
            slotEndIso: e.toISOString(),
            regionKey: def.regionKey,
            bossKey: def.bossKey,
            rewardHintI18nKey: def.rewardHintI18nKey,
          });
          upcomingByKey.set(def.key, list);
          continue;
        }

        if (def.type === 'WEEKLY') {
          if (!def.daysOfWeek || !def.daysOfWeek.includes(parts.dayOfWeek)) continue;
        } else if (def.daysOfWeek && def.daysOfWeek.length > 0) {
          if (!def.daysOfWeek.includes(parts.dayOfWeek)) continue;
        }

        const start = eventSlotStartFor(def, parts.year, parts.month, parts.day, tz);
        if (!start) continue;
        if (start.getTime() <= t0) continue;
        const dur = eventSlotDurationMs(def);
        const end = new Date(start.getTime() + dur);
        list.push({
          key: def.key,
          type: def.type,
          titleI18nKey: def.titleI18nKey,
          descriptionI18nKey: def.descriptionI18nKey,
          effectiveEnabled: isEffectiveEnabled(def, start),
          catalogEnabled: def.enabled,
          slotStartIso: start.toISOString(),
          slotEndIso: end.toISOString(),
          regionKey: def.regionKey,
          bossKey: def.bossKey,
          rewardHintI18nKey: def.rewardHintI18nKey,
        });
        upcomingByKey.set(def.key, list);
      }
    }
    const upcomingEvents: UpcomingEventSlotView[] = Array.from(
      upcomingByKey.values(),
    )
      .flat()
      .sort((a, b) => a.slotStartIso.localeCompare(b.slotStartIso));

    // 4) Boss schedule today + week.
    const todayParts = localPartsInTz(now, tz);
    const wrapBossSlot = (slot: BossScheduleSlot): BossScheduleSlotView => {
      const def = getLiveOpsEventDef(slot.key);
      const localParts = localPartsInTz(slot.slotStart, tz);
      const localDate = `${localParts.year.toString().padStart(4, '0')}-${localParts.month
        .toString()
        .padStart(2, '0')}-${localParts.day.toString().padStart(2, '0')}`;
      return {
        key: slot.key,
        bossKey: slot.bossKey,
        regionKey: slot.regionKey,
        slotStartIso: slot.slotStart.toISOString(),
        slotEndIso: slot.slotEnd.toISOString(),
        status: slot.status,
        rewardHintI18nKey: slot.rewardHintI18nKey,
        catalogEnabled: def?.enabled ?? false,
        effectiveEnabled: def ? isEffectiveEnabled(def, slot.slotStart) : false,
        localDate,
      };
    };
    const bossScheduleTodaySlots = bossScheduleForToday(now, tz);
    const bossScheduleToday = bossScheduleTodaySlots.map(wrapBossSlot);

    const bossScheduleWeekRaw: BossScheduleSlot[] = [];
    for (let i = 0; i < 7; i++) {
      const probe = new Date(t0 + i * 24 * 60 * 60_000);
      const probeParts = localPartsInTz(probe, tz);
      // Skip duplicates: nếu day == today day, dùng từ today list.
      if (
        probeParts.year === todayParts.year &&
        probeParts.month === todayParts.month &&
        probeParts.day === todayParts.day
      ) {
        bossScheduleWeekRaw.push(...bossScheduleTodaySlots);
        continue;
      }
      const probeSlots = bossScheduleForToday(probe, tz);
      bossScheduleWeekRaw.push(...probeSlots);
    }
    bossScheduleWeekRaw.sort(
      (a, b) => a.slotStart.getTime() - b.slotStart.getTime(),
    );
    const bossScheduleWeek = bossScheduleWeekRaw.map(wrapBossSlot);

    // 5) Sect war — current season + status snapshot (read-only, KHÔNG audit).
    const season = currentSectWarSeason(now, tz);
    const status = await this.getSectWarStatus(season.weekKey);

    return {
      nowIso: now.toISOString(),
      tz,
      activeEvents,
      upcomingEvents,
      bossScheduleToday,
      bossScheduleWeek,
      sectWar: { season, status },
      overrides: overrideViews,
    };
  }

  /**
   * POST /admin/liveops/dry-run — simulate event/boss execution KHÔNG mutate
   * DB. Trả result giả lập + ghi 1 audit nhẹ `ADMIN_LIVEOPS_DRY_RUN`.
   *
   * Constraint:
   *   - KHÔNG ghi reward thật (currency / inventory / world boss).
   *   - KHÔNG insert WorldBoss row.
   *   - KHÔNG bypass override — preview effective enabled từ catalog + override.
   */
  async dryRun(
    actorUserId: string,
    input: DryRunInput,
    now: Date = new Date(),
  ): Promise<DryRunResult> {
    const reason = input.reason?.trim() ? input.reason.trim() : null;

    if (input.kind === 'event') {
      const def = getLiveOpsEventDef(input.key);
      if (!def) throw new AdminLiveOpsError('EVENT_NOT_FOUND');

      const ovr = await this.prisma.liveOpsEventOverride.findUnique({
        where: { key: input.key },
      });
      const effectiveEnabled = def.enabled && (!ovr || ovr.enabled);
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

      // Compute next slot (LIMITED dùng startTime, còn lại nextLiveOpsEvent).
      let nextSlotStartIso: string | null = null;
      let nextSlotEndIso: string | null = null;
      if (def.type === 'LIMITED') {
        if (def.startTime) {
          const s = new Date(def.startTime);
          if (!Number.isNaN(s.getTime())) {
            nextSlotStartIso = s.toISOString();
            const e = def.endTime
              ? new Date(def.endTime)
              : new Date(s.getTime() + eventSlotDurationMs(def));
            nextSlotEndIso = e.toISOString();
          }
        }
      } else {
        const next = nextLiveOpsEvent(now, LIVE_OPS_DEFAULT_TZ);
        if (next && next.ev.key === def.key) {
          nextSlotStartIso = next.slotStart.toISOString();
          nextSlotEndIso = new Date(
            next.slotStart.getTime() + eventSlotDurationMs(def),
          ).toISOString();
        }
      }

      await this.writeAudit(actorUserId, 'ADMIN_LIVEOPS_DRY_RUN', {
        kind: 'event',
        targetType: 'LiveOpsEvent',
        targetId: def.key,
        reason,
        effectiveEnabled,
      });

      const result: DryRunEventResult = {
        kind: 'event',
        key: def.key,
        type: def.type,
        titleI18nKey: def.titleI18nKey,
        descriptionI18nKey: def.descriptionI18nKey,
        catalogEnabled: def.enabled,
        effectiveEnabled,
        override: overrideView,
        nextSlotStartIso,
        nextSlotEndIso,
        regionKey: def.regionKey,
        bossKey: def.bossKey,
        rewardHintI18nKey: def.rewardHintI18nKey,
        simulated: true,
        reason,
        simulatedAt: now.toISOString(),
      };
      return result;
    }

    // input.kind === 'boss'
    const bossDef: BossDef | undefined = bossByKey(input.key);
    if (!bossDef) throw new AdminLiveOpsError('BOSS_NOT_FOUND');

    const level = clampLevel(input.level);
    const regionKey = input.regionKey?.trim() || bossDef.regionKey || 'world';
    // Scale baseMaxHp theo level (1.0× ở level 1, +5% mỗi level — giả lập).
    const scale = 1 + (level - 1) * 0.05;
    const simulatedMaxHpNumber = Math.floor(bossDef.baseMaxHp * scale);

    await this.writeAudit(actorUserId, 'ADMIN_LIVEOPS_DRY_RUN', {
      kind: 'boss',
      targetType: 'Boss',
      targetId: bossDef.key,
      regionKey,
      level,
      reason,
    });

    const result: DryRunBossResult = {
      kind: 'boss',
      bossKey: bossDef.key,
      bossName: bossDef.name,
      regionKey,
      level,
      simulatedMaxHp: simulatedMaxHpNumber.toString(),
      simulatedReward: {
        baseLinhThach: bossDef.baseRewardLinhThach,
        topDropPool: bossDef.topDropPool.slice(),
        midDropPool: bossDef.midDropPool.slice(),
        lowDropPool: bossDef.lowDropPool ? bossDef.lowDropPool.slice() : [],
      },
      recommendedRealm: bossDef.recommendedRealm,
      simulated: true,
      reason,
      simulatedAt: now.toISOString(),
    };
    return result;
  }

  /** Helper internal — meta cast cho audit.write. */
  static metaToJson(meta: Record<string, unknown>): Prisma.InputJsonValue {
    return meta as Prisma.InputJsonValue;
  }
}

/** Clamp dry-run boss level vào range [1, 99]. */
function clampLevel(level: number | undefined): number {
  if (level === undefined || level === null) return 1;
  if (!Number.isFinite(level)) return 1;
  const n = Math.floor(level);
  if (n < 1) return 1;
  if (n > 99) return 99;
  return n;
}
