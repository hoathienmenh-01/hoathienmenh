/**
 * LiveOps Event Calendar — Phase 13.0 LiveOps & Retention Suite (PR #452)
 *
 * Pure catalog + deterministic helpers — KHÔNG runtime / KHÔNG Prisma migration.
 *
 * Mục tiêu Phase 13.0:
 *   - Cho người chơi lý do log-in theo giờ: boss trưa / tối / đêm.
 *   - Sự kiện hằng ngày / hằng tuần lặp lại đều đặn.
 *   - Một số sự kiện đặc biệt LIMITED (vd Huyết Nguyệt cuối tuần) cấp title/buff.
 *   - Endpoint `/liveops/today` (Phase 13.0 §D) + BossView schedule (Phase 13.0 §E)
 *     cùng đọc catalog này.
 *
 * Design intent:
 *   - Lightweight static catalog (chưa cần admin CMS — Phase 13.1+ có thể nâng
 *     lên DB nếu cần admin schedule live).
 *   - Mỗi event có `key` ổn định (immutable) + `type` + window thời gian.
 *   - DAILY/WEEKLY = recurring (`dailyTime` / `daysOfWeek`); LIMITED = explicit
 *     `startTime`/`endTime`; BOSS = recurring boss spawn slot; STORY = one-shot.
 *   - Helpers thuần determ: `liveOpsEventsForToday(now, tz)`,
 *     `activeLiveOpsEvents(now, tz)`, `nextLiveOpsEvent(now, tz)`.
 *   - Reuse helper timezone (`getLocalDayKey`, `dateInTz`) tương thích với
 *     `mission.service.ts` `getMissionResetTz()` — default `Asia/Ho_Chi_Minh`.
 *
 * Phase 13.0 §B (Scheduled Boss): `BossService.heartbeat()` đọc
 * `activeLiveOpsEvents()` filter `type='BOSS'` để force-spawn đúng boss/region
 * khi tới slot. Slot dedup: spawnedAt >= slot start (xem boss.service.ts).
 *
 * Phase 13.0 §C (Title/Buff hooks): event Huyết Nguyệt + boss participation
 * → unlock title `event_huyet_nguyet` / `boss_first_kill` / `boss_top_damage`.
 */

import { bossByKey } from './boss';
import { REGION_KEYS, type RegionKey } from './map-regions';

/**
 * Loại event:
 *   - `DAILY`: lặp mỗi ngày tại `dailyTime` HH:mm. Slot duration = 30 phút.
 *   - `WEEKLY`: lặp theo `daysOfWeek` tại `dailyTime`. Slot duration = 1 giờ.
 *   - `LIMITED`: window cố định `startTime`–`endTime`.
 *   - `BOSS`: scheduled boss spawn — `dailyTime` + `bossKey` + optional
 *     `daysOfWeek` (vd Huyết Nguyệt = thứ 7).
 *   - `STORY`: story event one-shot (placeholder Phase 14+).
 */
export type LiveOpsEventType = 'DAILY' | 'WEEKLY' | 'LIMITED' | 'BOSS' | 'STORY';

export interface LiveOpsEventDef {
  /** Stable key cross-FE/BE. Immutable sau khi ship. */
  readonly key: string;
  /** i18n key cho title (vi/en). FE resolve qua `t(titleI18nKey)`. */
  readonly titleI18nKey: string;
  /** i18n key cho description. */
  readonly descriptionI18nKey: string;
  readonly type: LiveOpsEventType;
  readonly enabled: boolean;
  /**
   * Cho LIMITED: ISO string `2026-06-01T00:00:00Z` (UTC).
   * Cho DAILY/WEEKLY/BOSS: undefined (dùng `dailyTime` + `daysOfWeek`).
   */
  readonly startTime?: string;
  readonly endTime?: string;
  /**
   * "HH:mm" format, theo timezone của event (default `Asia/Ho_Chi_Minh`).
   * Required cho DAILY/WEEKLY/BOSS, undefined cho LIMITED/STORY.
   */
  readonly dailyTime?: string;
  /**
   * Slot duration phút sau `dailyTime`. Cho BOSS/DAILY default 30, WEEKLY default 60.
   * UI dùng để hiển thị "active window" cho event đang mở.
   */
  readonly durationMinutes?: number;
  /**
   * 0=Sunday, 1=Monday, ..., 6=Saturday (matches JS `Date.getDay()`).
   * Empty / undefined = tất cả các ngày (DAILY/BOSS daily).
   */
  readonly daysOfWeek?: readonly number[];
  /** Region scope (must match `MAP_REGIONS` key) — cho BOSS event. */
  readonly regionKey?: RegionKey;
  /** Boss key (must exist trong `BOSSES` catalog) — cho BOSS event. */
  readonly bossKey?: string;
  /** Reward hint i18n key — UI hiển thị "Tham gia nhận: ..." (text-only). */
  readonly rewardHintI18nKey?: string;
  /** Sortable display order — FE list theo asc. Default 100. */
  readonly sortOrder?: number;
}

// ───────────────────────────────────────────────────────────────────────
// 13.0 baseline catalog — 8 events:
//   - 3 DAILY boss slot (trưa 12:00 / tối 19:00 / đêm 22:00) for major regions
//   - 1 WEEKLY event boss "Huyết Nguyệt" thứ 7 21:00 LIMITED 60p (cuu_la_dien)
//   - 2 DAILY recurring (double-EXP morning hour, dungeon-rush evening)
//   - 1 WEEKLY (sect-aura broadcast chủ nhật)
//   - 1 LIMITED placeholder (event Lễ hội tân niên)
//
// Schedule design rationale: BALANCE_MODEL §13 — không cấp reward trực tiếp ở
// activity panel; reward delivered qua boss kill (existing distributeRewards
// + new title/buff hook). Event mostly retention "có lý do log-in" thay vì
// inflate currency.
// ───────────────────────────────────────────────────────────────────────

export const LIVE_OPS_EVENTS: readonly LiveOpsEventDef[] = [
  // ----- DAILY scheduled boss — trưa 12:00 (hoa_diem_son: hoa_long_to_su) -----
  {
    key: 'boss_daily_noon_hoa_diem_son',
    titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
    descriptionI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.desc',
    type: 'BOSS',
    enabled: true,
    dailyTime: '12:00',
    durationMinutes: 30,
    regionKey: 'hoa_diem_son',
    bossKey: 'hoa_long_to_su',
    rewardHintI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.reward',
    sortOrder: 10,
  },
  // ----- DAILY scheduled boss — tối 19:00 (kim_son_mach: kim_phach_long_dieu) -----
  {
    key: 'boss_daily_evening_kim_son_mach',
    titleI18nKey: 'liveops.event.boss_daily_evening_kim_son_mach.title',
    descriptionI18nKey: 'liveops.event.boss_daily_evening_kim_son_mach.desc',
    type: 'BOSS',
    enabled: true,
    dailyTime: '19:00',
    durationMinutes: 30,
    regionKey: 'kim_son_mach',
    bossKey: 'kim_phach_long_dieu',
    rewardHintI18nKey: 'liveops.event.boss_daily_evening_kim_son_mach.reward',
    sortOrder: 20,
  },
  // ----- DAILY scheduled boss — đêm 22:00 (hoang_tho_huyet: yeu_vuong_tho_huyet) -----
  {
    key: 'boss_daily_night_hoang_tho_huyet',
    titleI18nKey: 'liveops.event.boss_daily_night_hoang_tho_huyet.title',
    descriptionI18nKey: 'liveops.event.boss_daily_night_hoang_tho_huyet.desc',
    type: 'BOSS',
    enabled: true,
    dailyTime: '22:00',
    durationMinutes: 30,
    regionKey: 'hoang_tho_huyet',
    bossKey: 'yeu_vuong_tho_huyet',
    rewardHintI18nKey: 'liveops.event.boss_daily_night_hoang_tho_huyet.reward',
    sortOrder: 30,
  },
  // ----- WEEKLY event boss Huyết Nguyệt — thứ 7 21:00, durationMinutes=60 (cuu_la_dien) -----
  {
    key: 'event_huyet_nguyet_weekend',
    titleI18nKey: 'liveops.event.event_huyet_nguyet_weekend.title',
    descriptionI18nKey: 'liveops.event.event_huyet_nguyet_weekend.desc',
    type: 'BOSS',
    enabled: true,
    dailyTime: '21:00',
    durationMinutes: 60,
    daysOfWeek: [6], // Saturday
    regionKey: 'cuu_la_dien',
    bossKey: 'cuu_la_thien_de',
    rewardHintI18nKey: 'liveops.event.event_huyet_nguyet_weekend.reward',
    sortOrder: 5,
  },
  // ----- DAILY EXP rush morning -----
  {
    key: 'daily_exp_rush_morning',
    titleI18nKey: 'liveops.event.daily_exp_rush_morning.title',
    descriptionI18nKey: 'liveops.event.daily_exp_rush_morning.desc',
    type: 'DAILY',
    enabled: true,
    dailyTime: '07:00',
    durationMinutes: 60,
    rewardHintI18nKey: 'liveops.event.daily_exp_rush_morning.reward',
    sortOrder: 40,
  },
  // ----- DAILY dungeon rush evening -----
  {
    key: 'daily_dungeon_rush_evening',
    titleI18nKey: 'liveops.event.daily_dungeon_rush_evening.title',
    descriptionI18nKey: 'liveops.event.daily_dungeon_rush_evening.desc',
    type: 'DAILY',
    enabled: true,
    dailyTime: '20:00',
    durationMinutes: 60,
    rewardHintI18nKey: 'liveops.event.daily_dungeon_rush_evening.reward',
    sortOrder: 50,
  },
  // ----- WEEKLY sect aura — chủ nhật cả ngày (06:00, 12 hour window) -----
  {
    key: 'weekly_sect_aura_sunday',
    titleI18nKey: 'liveops.event.weekly_sect_aura_sunday.title',
    descriptionI18nKey: 'liveops.event.weekly_sect_aura_sunday.desc',
    type: 'WEEKLY',
    enabled: true,
    dailyTime: '06:00',
    durationMinutes: 12 * 60,
    daysOfWeek: [0], // Sunday
    rewardHintI18nKey: 'liveops.event.weekly_sect_aura_sunday.reward',
    sortOrder: 60,
  },
  // ----- LIMITED placeholder Lễ hội (disabled by default — bật khi có event) -----
  {
    key: 'limited_lunar_new_year_2027',
    titleI18nKey: 'liveops.event.limited_lunar_new_year_2027.title',
    descriptionI18nKey: 'liveops.event.limited_lunar_new_year_2027.desc',
    type: 'LIMITED',
    enabled: false,
    startTime: '2027-02-06T00:00:00+07:00',
    endTime: '2027-02-13T23:59:59+07:00',
    rewardHintI18nKey: 'liveops.event.limited_lunar_new_year_2027.reward',
    sortOrder: 80,
  },
];

const LIVE_OPS_EVENTS_BY_KEY = new Map<string, LiveOpsEventDef>(
  LIVE_OPS_EVENTS.map((e) => [e.key, e]),
);

export function getLiveOpsEventDef(key: string): LiveOpsEventDef | undefined {
  return LIVE_OPS_EVENTS_BY_KEY.get(key);
}

/**
 * Default timezone cho LiveOps schedule — match `MISSION_RESET_TZ` default.
 * Server can override via ENV nếu Phase 13.1 cần multi-region timezone.
 */
export const LIVE_OPS_DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

// ───────────────────────────────────────────────────────────────────────
// Helpers cho timezone-aware schedule resolution.
//
// Convention:
//   - Mọi helper nhận `now: Date` (UTC instant) + `tz: string` (IANA tz).
//   - Server passing `getMissionResetTz()` từ `mission.service.ts`.
//   - "Local day" = ngày trong tz đó (vd `2026-05-07` ở Asia/Ho_Chi_Minh).
//   - Cùng instant có thể "today" ở tz X, "yesterday" ở tz Y — caller pick tz.
// ───────────────────────────────────────────────────────────────────────

/**
 * Trả về offset của một IANA timezone tại thời điểm cụ thể (đơn vị phút).
 * Reuse logic với `mission.service.ts` để tránh drift.
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = fmt.formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/** Year/month/day/hour/minute "local" theo tz cho 1 instant Date. */
export interface LocalDateParts {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
  /** Day-of-week 0=Sun..6=Sat (match JS Date.getDay()) tại tz. */
  readonly dayOfWeek: number;
}

export function localPartsInTz(now: Date, tz: string): LocalDateParts {
  const offMs = tzOffsetMinutes(tz, now) * 60_000;
  // Local "instant": Date UTC fields trùng local fields ở tz.
  const local = new Date(now.getTime() + offMs);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    dayOfWeek: local.getUTCDay(),
  };
}

/**
 * Chuyển 1 local datetime (year/month/day HH:mm tại tz) thành UTC Date.
 * Approx 1 step (DST có thể lệch 1 giờ — chấp nhận cho schedule slot).
 */
export function utcDateForLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Tạo "wall clock" instant ở UTC trước, rồi trừ offset.
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Probe offset tại wall instant để approx tz offset (chính xác cho non-DST tz).
  const probe = new Date(wallUtc);
  const offMs = tzOffsetMinutes(tz, probe) * 60_000;
  return new Date(wallUtc - offMs);
}

function parseHHmm(t: string): { hour: number; minute: number } | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Resolve slot start instant cho 1 event tại 1 ngày local cụ thể (tz).
 *
 * - DAILY/WEEKLY/BOSS: dùng `dailyTime` HH:mm trong tz.
 * - LIMITED: trả về startTime parsed (Date) nếu local day == localStartDate;
 *   không thì null.
 * - STORY: undefined (không recurrent).
 */
export function eventSlotStartFor(
  ev: LiveOpsEventDef,
  localYear: number,
  localMonth: number,
  localDay: number,
  tz: string,
): Date | null {
  if (ev.type === 'LIMITED') {
    if (!ev.startTime) return null;
    const d = new Date(ev.startTime);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  if (ev.type === 'STORY') return null;
  if (!ev.dailyTime) return null;
  const hm = parseHHmm(ev.dailyTime);
  if (!hm) return null;
  return utcDateForLocal(localYear, localMonth, localDay, hm.hour, hm.minute, tz);
}

/** Slot duration ms (default 30/60 cho DAILY/WEEKLY). */
export function eventSlotDurationMs(ev: LiveOpsEventDef): number {
  if (ev.durationMinutes && ev.durationMinutes > 0) {
    return ev.durationMinutes * 60_000;
  }
  switch (ev.type) {
    case 'WEEKLY':
      return 60 * 60_000;
    case 'BOSS':
    case 'DAILY':
      return 30 * 60_000;
    case 'LIMITED':
    case 'STORY':
      return 0;
  }
}

/**
 * Tất cả event sẽ trigger TRONG NGÀY local của `now` (theo tz).
 *
 * - Filter `enabled`.
 * - DAILY/BOSS: include nếu `daysOfWeek` undefined hoặc match local DOW.
 * - WEEKLY: phải match `daysOfWeek`.
 * - LIMITED: include nếu local day overlap [startTime, endTime].
 * - STORY: skip (one-shot, FE list khác).
 *
 * Output sort theo slot start asc; tiebreak by sortOrder.
 */
export function liveOpsEventsForToday(
  now: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): LiveOpsEventDef[] {
  const parts = localPartsInTz(now, tz);
  const out: { ev: LiveOpsEventDef; start: Date }[] = [];
  for (const ev of LIVE_OPS_EVENTS) {
    if (!ev.enabled) continue;
    if (ev.type === 'STORY') continue;
    if (ev.type === 'LIMITED') {
      if (!ev.startTime || !ev.endTime) continue;
      const s = new Date(ev.startTime);
      const e = new Date(ev.endTime);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
      // local day window:
      const localStart = utcDateForLocal(parts.year, parts.month, parts.day, 0, 0, tz);
      const localEnd = new Date(localStart.getTime() + 24 * 60 * 60_000);
      if (e <= localStart || s >= localEnd) continue;
      out.push({ ev, start: s > localStart ? s : localStart });
      continue;
    }
    if (ev.type === 'WEEKLY') {
      if (!ev.daysOfWeek || ev.daysOfWeek.length === 0) continue;
      if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
    } else if (ev.type === 'BOSS' || ev.type === 'DAILY') {
      if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
        if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
      }
    }
    const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
    if (!start) continue;
    out.push({ ev, start });
  }
  out.sort((a, b) => {
    const ta = a.start.getTime();
    const tb = b.start.getTime();
    if (ta !== tb) return ta - tb;
    return (a.ev.sortOrder ?? 100) - (b.ev.sortOrder ?? 100);
  });
  return out.map((x) => x.ev);
}

/**
 * Event đang ACTIVE tại `now` — trong window [start, start+duration).
 *
 * Sort theo slot start asc.
 */
export function activeLiveOpsEvents(
  now: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): LiveOpsEventDef[] {
  const parts = localPartsInTz(now, tz);
  const out: { ev: LiveOpsEventDef; start: Date }[] = [];
  const t = now.getTime();
  for (const ev of LIVE_OPS_EVENTS) {
    if (!ev.enabled) continue;
    if (ev.type === 'STORY') continue;
    if (ev.type === 'LIMITED') {
      if (!ev.startTime || !ev.endTime) continue;
      const s = new Date(ev.startTime);
      const e = new Date(ev.endTime);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
      if (t < s.getTime() || t >= e.getTime()) continue;
      out.push({ ev, start: s });
      continue;
    }
    if (ev.type === 'WEEKLY') {
      if (!ev.daysOfWeek || !ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
    } else if (ev.type === 'BOSS' || ev.type === 'DAILY') {
      if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
        if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
      }
    }
    const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
    if (!start) continue;
    const dur = eventSlotDurationMs(ev);
    if (t < start.getTime() || t >= start.getTime() + dur) continue;
    out.push({ ev, start });
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out.map((x) => x.ev);
}

/**
 * Tìm event sắp tới gần nhất từ `now` (search trong vòng 7 ngày tới).
 *
 * Useful cho FE Today Activity Panel "Boss sắp xuất hiện".
 * Trả về object `{ ev, slotStart }` để FE hiển thị countdown.
 */
export function nextLiveOpsEvent(
  now: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): { ev: LiveOpsEventDef; slotStart: Date } | null {
  const t = now.getTime();
  let best: { ev: LiveOpsEventDef; slotStart: Date } | null = null;
  // Search 7 ngày tới — đủ phủ WEEKLY events.
  for (let i = 0; i < 8; i++) {
    const probe = new Date(t + i * 24 * 60 * 60_000);
    const parts = localPartsInTz(probe, tz);
    for (const ev of LIVE_OPS_EVENTS) {
      if (!ev.enabled) continue;
      if (ev.type === 'STORY') continue;
      if (ev.type === 'LIMITED') {
        if (!ev.startTime) continue;
        const s = new Date(ev.startTime);
        if (Number.isNaN(s.getTime())) continue;
        if (s.getTime() <= t) continue;
        if (i !== 0) continue; // chỉ cần check LIMITED 1 lần
        if (!best || s.getTime() < best.slotStart.getTime()) {
          best = { ev, slotStart: s };
        }
        continue;
      }
      // DAILY/WEEKLY/BOSS: filter daysOfWeek per probe day.
      if (ev.type === 'WEEKLY') {
        if (!ev.daysOfWeek || !ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
      } else {
        if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
          if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
        }
      }
      const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
      if (!start) continue;
      if (start.getTime() <= t) continue;
      if (!best || start.getTime() < best.slotStart.getTime()) {
        best = { ev, slotStart: start };
      }
    }
    if (best) return best; // Earliest probe day with any future slot wins.
  }
  return best;
}

/**
 * Boss schedule cho NGÀY HÔM NAY (theo tz) — sub-list của `liveOpsEventsForToday`
 * filter `type='BOSS'`. Slot start = local day at `dailyTime`.
 *
 * Output có status:
 *   - `upcoming`: slot start > now
 *   - `active`: now ∈ [start, start+duration)
 *   - `completed`: now >= end (boss đã expired hoặc defeated)
 */
export interface BossScheduleSlot {
  readonly key: string;
  readonly bossKey: string;
  readonly regionKey: RegionKey;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly status: 'upcoming' | 'active' | 'completed';
  /** Reward hint i18n key — UI hiển thị "Thưởng: ..." (text-only). */
  readonly rewardHintI18nKey?: string;
}

export function bossScheduleForToday(
  now: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): BossScheduleSlot[] {
  const parts = localPartsInTz(now, tz);
  const t = now.getTime();
  const out: BossScheduleSlot[] = [];
  for (const ev of LIVE_OPS_EVENTS) {
    if (!ev.enabled) continue;
    if (ev.type !== 'BOSS') continue;
    if (!ev.bossKey || !ev.regionKey) continue;
    if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
      if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
    }
    const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
    if (!start) continue;
    const dur = eventSlotDurationMs(ev);
    const end = new Date(start.getTime() + dur);
    let status: BossScheduleSlot['status'];
    if (t < start.getTime()) status = 'upcoming';
    else if (t < end.getTime()) status = 'active';
    else status = 'completed';
    out.push({
      key: ev.key,
      bossKey: ev.bossKey,
      regionKey: ev.regionKey,
      slotStart: start,
      slotEnd: end,
      status,
      rewardHintI18nKey: ev.rewardHintI18nKey,
    });
  }
  out.sort((a, b) => a.slotStart.getTime() - b.slotStart.getTime());
  return out;
}

/**
 * Phase 13.0 §C helper — map 1 boss spawn (bossKey + regionKey +
 * spawnedAt) ngược về LiveOpsEventDef đã trigger nó (BOSS event với
 * matching bossKey/regionKey, slotStart ≤ spawnedAt < slotEnd). Caller
 * dùng để gắn reward hook (title/buff per event). Null nếu không match
 * (boss spawn từ rotation default).
 *
 * Lưu ý: catalog cross-validate `bossKey.regionKey === ev.regionKey` qua
 * `validateLiveOpsEvent`, nên cùng (bossKey, regionKey) có ≤1 BOSS event
 * — không cần tie-break.
 */
export function liveOpsEventForBossSpawn(
  bossKey: string,
  regionKey: string,
  spawnedAt: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): LiveOpsEventDef | null {
  const parts = localPartsInTz(spawnedAt, tz);
  for (const ev of LIVE_OPS_EVENTS) {
    if (!ev.enabled) continue;
    if (ev.type !== 'BOSS') continue;
    if (ev.bossKey !== bossKey) continue;
    if (ev.regionKey !== regionKey) continue;
    if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
      if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
    }
    const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
    if (!start) continue;
    const dur = eventSlotDurationMs(ev);
    const end = new Date(start.getTime() + dur);
    if (
      spawnedAt.getTime() < start.getTime() ||
      spawnedAt.getTime() >= end.getTime()
    ) {
      continue;
    }
    return ev;
  }
  return null;
}

/**
 * Phase 13.0 §B helper — return scheduled BOSS event đang ACTIVE tại
 * `now` cho 1 region cụ thể. `BossService.heartbeatRegion()` dùng để
 * force-spawn đúng boss/region khi tới slot.
 *
 * Trả về {ev, slotStart, slotEnd} để caller dedup theo `spawnedAt >=
 * slotStart` (xem boss.service.ts §B). Null nếu region không có
 * scheduled boss đang active.
 */
export function activeScheduledBossEventForRegion(
  regionKey: string,
  now: Date,
  tz: string = LIVE_OPS_DEFAULT_TZ,
): { ev: LiveOpsEventDef; slotStart: Date; slotEnd: Date } | null {
  const parts = localPartsInTz(now, tz);
  const t = now.getTime();
  for (const ev of LIVE_OPS_EVENTS) {
    if (!ev.enabled) continue;
    if (ev.type !== 'BOSS') continue;
    if (ev.regionKey !== regionKey) continue;
    if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
      if (!ev.daysOfWeek.includes(parts.dayOfWeek)) continue;
    }
    const start = eventSlotStartFor(ev, parts.year, parts.month, parts.day, tz);
    if (!start) continue;
    const dur = eventSlotDurationMs(ev);
    const end = new Date(start.getTime() + dur);
    if (t < start.getTime() || t >= end.getTime()) continue;
    return { ev, slotStart: start, slotEnd: end };
  }
  return null;
}

/**
 * Validation helper — exported cho test:
 * - mỗi event key duy nhất
 * - dailyTime HH:mm hợp lệ
 * - daysOfWeek 0..6 hợp lệ
 * - bossKey (nếu có) tồn tại trong BOSSES
 * - regionKey (nếu có) match REGION_KEYS
 * - LIMITED phải có startTime + endTime hợp lệ và endTime > startTime.
 */
export function validateLiveOpsEvent(ev: LiveOpsEventDef): string | null {
  if (!ev.key || !/^[a-z][a-z0-9_]{0,63}$/.test(ev.key)) {
    return 'INVALID_KEY';
  }
  if (ev.type === 'BOSS' || ev.type === 'DAILY' || ev.type === 'WEEKLY') {
    if (!ev.dailyTime || !parseHHmm(ev.dailyTime)) return 'INVALID_DAILY_TIME';
  }
  if (ev.daysOfWeek) {
    for (const d of ev.daysOfWeek) {
      if (!Number.isInteger(d) || d < 0 || d > 6) return 'INVALID_DAYS_OF_WEEK';
    }
  }
  if (ev.bossKey && !bossByKey(ev.bossKey)) return 'BOSS_KEY_NOT_FOUND';
  if (ev.regionKey && !REGION_KEYS.includes(ev.regionKey)) return 'REGION_KEY_NOT_FOUND';
  if (ev.type === 'BOSS' && (!ev.bossKey || !ev.regionKey)) {
    return 'BOSS_EVENT_REQUIRES_BOSS_AND_REGION';
  }
  // Cross-validate: bossKey's regionKey (in BOSSES catalog) phải match event
  // regionKey để giữ boss-by-region invariant. Catalog null → 'world'.
  if (ev.type === 'BOSS' && ev.bossKey && ev.regionKey) {
    const def = bossByKey(ev.bossKey);
    if (def) {
      const defRegion = def.regionKey ?? 'world';
      if (defRegion !== ev.regionKey) return 'BOSS_REGION_MISMATCH';
    }
  }
  if (ev.type === 'WEEKLY' && (!ev.daysOfWeek || ev.daysOfWeek.length === 0)) {
    return 'WEEKLY_REQUIRES_DAYS_OF_WEEK';
  }
  if (ev.type === 'LIMITED') {
    if (!ev.startTime || !ev.endTime) return 'LIMITED_REQUIRES_START_END';
    const s = new Date(ev.startTime);
    const e = new Date(ev.endTime);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'LIMITED_INVALID_TIME';
    if (e <= s) return 'LIMITED_END_BEFORE_START';
  }
  if (ev.durationMinutes !== undefined) {
    if (!Number.isInteger(ev.durationMinutes) || ev.durationMinutes < 0 || ev.durationMinutes > 24 * 60) {
      return 'INVALID_DURATION';
    }
  }
  return null;
}
