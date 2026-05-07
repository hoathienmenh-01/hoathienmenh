import { Injectable, Logger } from '@nestjs/common';
import {
  LIVE_OPS_DEFAULT_TZ,
  activeLiveOpsEvents,
  bossScheduleForToday,
  liveOpsEventsForToday,
  nextLiveOpsEvent,
  type BossScheduleSlot,
  type LiveOpsEventDef,
} from '@xuantoi/shared';

/**
 * Phase 13.0 §D LiveOps service — read-only retention dashboard data.
 *
 * Pure aggregation layer: combine static catalog + 1 boss-schedule heartbeat
 * snapshot (no ledger writes, no reward grants). UI-shape oriented — caller
 * controller chỉ thin (1 endpoint).
 *
 * Reuse `LIVE_OPS_DEFAULT_TZ` (Asia/Ho_Chi_Minh) cho consistency với
 * mission reset + boss schedule slot evaluation. Override qua env
 * `LIVEOPS_TZ` (chỉ phục vụ debug/test, không document trong API).
 */
export interface LiveOpsTodayResponse {
  /** ISO timestamp lúc compute snapshot (caller dùng cho countdown). */
  readonly nowIso: string;
  /** Tz name (vd `Asia/Ho_Chi_Minh`). */
  readonly timezone: string;
  /** Toàn bộ event hôm nay (DAILY/WEEKLY/BOSS/STORY/LIMITED, sorted slot start asc). */
  readonly todayEvents: ReadonlyArray<LiveOpsEventViewModel>;
  /** Event đang ACTIVE tại nowIso (subset todayEvents). */
  readonly activeEvents: ReadonlyArray<LiveOpsEventViewModel>;
  /** Next upcoming event trong 7 ngày (null nếu catalog disabled hết). */
  readonly nextEvent: LiveOpsNextEventViewModel | null;
  /** Boss schedule today (3 slots default + Huyết Nguyệt nếu Saturday). */
  readonly bossSchedule: ReadonlyArray<BossScheduleViewModel>;
  /** Suggested CTA (UI hint cho retention hub). */
  readonly suggestedActivities: ReadonlyArray<SuggestedActivity>;
}

export interface LiveOpsEventViewModel {
  readonly key: string;
  readonly type: LiveOpsEventDef['type'];
  readonly titleI18nKey: string;
  readonly descriptionI18nKey: string;
  readonly rewardHintI18nKey?: string;
  readonly bossKey?: string;
  readonly regionKey?: string;
  /** Có dailyTime lặp hoặc startTime LIMITED — UI quyết định format. */
  readonly dailyTime?: string;
  readonly daysOfWeek?: ReadonlyArray<number>;
  readonly durationMinutes?: number;
}

export interface LiveOpsNextEventViewModel extends LiveOpsEventViewModel {
  readonly slotStartIso: string;
  readonly slotEndIso: string;
  readonly secondsUntilStart: number;
}

export interface BossScheduleViewModel {
  readonly key: string;
  readonly bossKey: string;
  readonly regionKey: string;
  readonly slotStartIso: string;
  readonly slotEndIso: string;
  readonly status: BossScheduleSlot['status'];
  readonly secondsUntilStart: number;
}

export interface SuggestedActivity {
  /** Stable key cho UI map → CTA. */
  readonly key: string;
  /** Loose category cho UI grouping. */
  readonly kind: 'boss' | 'event' | 'daily' | 'weekly';
  /** I18n key tham chiếu event/activity. */
  readonly titleI18nKey: string;
  /** Optional liên kết (vd boss hiện active → bossKey + regionKey). */
  readonly bossKey?: string;
  readonly regionKey?: string;
  /** Optional cho countdown UI. */
  readonly secondsUntilStart?: number;
}

@Injectable()
export class LiveOpsService {
  private readonly logger = new Logger(LiveOpsService.name);

  /** Override timezone qua env (default Asia/Ho_Chi_Minh). */
  private getTz(): string {
    const v = process.env.LIVEOPS_TZ?.trim();
    return v && v.length > 0 ? v : LIVE_OPS_DEFAULT_TZ;
  }

  /**
   * Snapshot live-ops state cho retention hub. Read-only — không ghi DB.
   */
  today(now: Date = new Date()): LiveOpsTodayResponse {
    const tz = this.getTz();
    const events = liveOpsEventsForToday(now, tz);
    const active = activeLiveOpsEvents(now, tz);
    const nextHit = nextLiveOpsEvent(now, tz);
    const bossSlots = bossScheduleForToday(now, tz);

    const nextEvent: LiveOpsNextEventViewModel | null = nextHit
      ? this.toNextEventVm(nextHit.ev, nextHit.slotStart, now)
      : null;

    return {
      nowIso: now.toISOString(),
      timezone: tz,
      todayEvents: events.map((ev) => this.toEventVm(ev)),
      activeEvents: active.map((ev) => this.toEventVm(ev)),
      nextEvent,
      bossSchedule: bossSlots.map((s) => this.toBossSlotVm(s, now)),
      suggestedActivities: this.suggestActivities(events, active, bossSlots, nextHit, now),
    };
  }

  private toEventVm(ev: LiveOpsEventDef): LiveOpsEventViewModel {
    return {
      key: ev.key,
      type: ev.type,
      titleI18nKey: ev.titleI18nKey,
      descriptionI18nKey: ev.descriptionI18nKey,
      rewardHintI18nKey: ev.rewardHintI18nKey,
      bossKey: ev.bossKey,
      regionKey: ev.regionKey,
      dailyTime: ev.dailyTime,
      daysOfWeek: ev.daysOfWeek,
      durationMinutes: ev.durationMinutes,
    };
  }

  private toNextEventVm(
    ev: LiveOpsEventDef,
    slotStart: Date,
    now: Date,
  ): LiveOpsNextEventViewModel {
    const dur = (ev.durationMinutes ?? 30) * 60_000;
    const slotEnd = new Date(slotStart.getTime() + dur);
    const secs = Math.max(0, Math.floor((slotStart.getTime() - now.getTime()) / 1000));
    return {
      ...this.toEventVm(ev),
      slotStartIso: slotStart.toISOString(),
      slotEndIso: slotEnd.toISOString(),
      secondsUntilStart: secs,
    };
  }

  private toBossSlotVm(slot: BossScheduleSlot, now: Date): BossScheduleViewModel {
    const secs = Math.max(
      0,
      Math.floor((slot.slotStart.getTime() - now.getTime()) / 1000),
    );
    return {
      key: slot.key,
      bossKey: slot.bossKey,
      regionKey: slot.regionKey,
      slotStartIso: slot.slotStart.toISOString(),
      slotEndIso: slot.slotEnd.toISOString(),
      status: slot.status,
      secondsUntilStart: secs,
    };
  }

  private suggestActivities(
    todayEvents: LiveOpsEventDef[],
    activeEvents: LiveOpsEventDef[],
    bossSlots: BossScheduleSlot[],
    nextHit: { ev: LiveOpsEventDef; slotStart: Date } | null,
    now: Date,
  ): SuggestedActivity[] {
    const out: SuggestedActivity[] = [];

    // 1. Boss đang ACTIVE — prio cao nhất.
    const activeBossSlot = bossSlots.find((s) => s.status === 'active');
    if (activeBossSlot) {
      out.push({
        key: `boss_active_${activeBossSlot.key}`,
        kind: 'boss',
        titleI18nKey: `liveops.event.${activeBossSlot.key}.title`,
        bossKey: activeBossSlot.bossKey,
        regionKey: activeBossSlot.regionKey,
      });
    } else {
      // 2. Boss upcoming — show next.
      const upcomingBoss = bossSlots.find((s) => s.status === 'upcoming');
      if (upcomingBoss) {
        const secs = Math.max(
          0,
          Math.floor((upcomingBoss.slotStart.getTime() - now.getTime()) / 1000),
        );
        out.push({
          key: `boss_upcoming_${upcomingBoss.key}`,
          kind: 'boss',
          titleI18nKey: `liveops.event.${upcomingBoss.key}.title`,
          bossKey: upcomingBoss.bossKey,
          regionKey: upcomingBoss.regionKey,
          secondsUntilStart: secs,
        });
      }
    }

    // 3. Event đang ACTIVE non-boss — vd daily exp rush.
    for (const ev of activeEvents) {
      if (ev.type === 'BOSS') continue;
      out.push({
        key: `event_active_${ev.key}`,
        kind: ev.type === 'DAILY' ? 'daily' : ev.type === 'WEEKLY' ? 'weekly' : 'event',
        titleI18nKey: ev.titleI18nKey,
      });
    }

    // 4. Next event nếu chưa có active boss/event nào.
    if (out.length === 0 && nextHit) {
      const secs = Math.max(
        0,
        Math.floor((nextHit.slotStart.getTime() - now.getTime()) / 1000),
      );
      const k =
        nextHit.ev.type === 'BOSS'
          ? 'boss'
          : nextHit.ev.type === 'DAILY'
            ? 'daily'
            : nextHit.ev.type === 'WEEKLY'
              ? 'weekly'
              : 'event';
      out.push({
        key: `next_${nextHit.ev.key}`,
        kind: k,
        titleI18nKey: nextHit.ev.titleI18nKey,
        bossKey: nextHit.ev.bossKey,
        regionKey: nextHit.ev.regionKey,
        secondsUntilStart: secs,
      });
    }

    return out;
  }
}
