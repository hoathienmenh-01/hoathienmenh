/**
 * Tests cho LiveOps Event Calendar — Phase 13.0 §A.
 *
 * Coverage:
 *   - Catalog invariants: keys unique, validation pass, types coverage
 *   - Helpers: liveOpsEventsForToday / activeLiveOpsEvents / nextLiveOpsEvent /
 *     bossScheduleForToday determ output theo timezone.
 */

import { describe, it, expect } from 'vitest';
import {
  LIVE_OPS_EVENTS,
  LIVE_OPS_DEFAULT_TZ,
  activeLiveOpsEvents,
  bossScheduleForToday,
  eventSlotDurationMs,
  eventSlotStartFor,
  getLiveOpsEventDef,
  liveOpsEventsForToday,
  localPartsInTz,
  nextLiveOpsEvent,
  validateLiveOpsEvent,
} from './liveops';
import { BOSSES } from './boss';
import { REGION_KEYS } from './map-regions';

describe('LiveOpsEvent catalog — invariants', () => {
  it('có ít nhất 1 BOSS event', () => {
    expect(LIVE_OPS_EVENTS.some((e) => e.type === 'BOSS')).toBe(true);
  });

  it('event keys duy nhất', () => {
    const keys = LIVE_OPS_EVENTS.map((e) => e.key);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it('mọi event pass validateLiveOpsEvent', () => {
    for (const ev of LIVE_OPS_EVENTS) {
      const err = validateLiveOpsEvent(ev);
      expect(err, `event ${ev.key} validation: ${err}`).toBeNull();
    }
  });

  it('BOSS event bossKey trỏ về catalog BOSSES', () => {
    const bossKeys = new Set(BOSSES.map((b) => b.key));
    for (const ev of LIVE_OPS_EVENTS) {
      if (ev.type !== 'BOSS') continue;
      expect(ev.bossKey, `event ${ev.key}`).toBeDefined();
      expect(bossKeys.has(ev.bossKey!), `event ${ev.key} bossKey ${ev.bossKey}`).toBe(true);
    }
  });

  it('regionKey (nếu có) match REGION_KEYS', () => {
    for (const ev of LIVE_OPS_EVENTS) {
      if (!ev.regionKey) continue;
      expect(REGION_KEYS.includes(ev.regionKey), `event ${ev.key} region ${ev.regionKey}`).toBe(true);
    }
  });

  it('BOSS event có cả bossKey và regionKey', () => {
    for (const ev of LIVE_OPS_EVENTS) {
      if (ev.type !== 'BOSS') continue;
      expect(ev.bossKey).toBeDefined();
      expect(ev.regionKey).toBeDefined();
    }
  });

  it('getLiveOpsEventDef lookup đúng key', () => {
    const ev = LIVE_OPS_EVENTS[0];
    expect(getLiveOpsEventDef(ev.key)).toBe(ev);
    expect(getLiveOpsEventDef('khong_ton_tai_xxx')).toBeUndefined();
  });

  it('Huyết Nguyệt event là BOSS, daysOfWeek = [6] (thứ 7)', () => {
    const ev = getLiveOpsEventDef('event_huyet_nguyet_weekend');
    expect(ev).toBeDefined();
    expect(ev!.type).toBe('BOSS');
    expect(ev!.daysOfWeek).toEqual([6]);
  });
});

describe('LiveOpsEvent — validateLiveOpsEvent reject invalid', () => {
  it('reject key không hợp lệ', () => {
    expect(
      validateLiveOpsEvent({
        key: 'INVALID-KEY',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'DAILY',
        enabled: true,
        dailyTime: '08:00',
      }),
    ).toBe('INVALID_KEY');
  });

  it('reject dailyTime không hợp lệ', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'DAILY',
        enabled: true,
        dailyTime: '99:99',
      }),
    ).toBe('INVALID_DAILY_TIME');
  });

  it('reject daysOfWeek out-of-range', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'WEEKLY',
        enabled: true,
        dailyTime: '08:00',
        daysOfWeek: [7], // 7 invalid
      }),
    ).toBe('INVALID_DAYS_OF_WEEK');
  });

  it('reject WEEKLY thiếu daysOfWeek', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'WEEKLY',
        enabled: true,
        dailyTime: '08:00',
      }),
    ).toBe('WEEKLY_REQUIRES_DAYS_OF_WEEK');
  });

  it('reject BOSS không có bossKey/regionKey', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'BOSS',
        enabled: true,
        dailyTime: '08:00',
      }),
    ).toBe('BOSS_EVENT_REQUIRES_BOSS_AND_REGION');
  });

  it('reject bossKey không tồn tại trong catalog', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'BOSS',
        enabled: true,
        dailyTime: '08:00',
        bossKey: 'fake_boss_key_xxx',
        regionKey: 'hac_lam',
      }),
    ).toBe('BOSS_KEY_NOT_FOUND');
  });

  it('reject LIMITED có endTime <= startTime', () => {
    expect(
      validateLiveOpsEvent({
        key: 'test_event',
        titleI18nKey: 't',
        descriptionI18nKey: 'd',
        type: 'LIMITED',
        enabled: true,
        startTime: '2026-06-01T00:00:00+07:00',
        endTime: '2026-05-01T00:00:00+07:00',
      }),
    ).toBe('LIMITED_END_BEFORE_START');
  });
});

describe('LiveOpsEvent — localPartsInTz', () => {
  it('Asia/Ho_Chi_Minh = UTC+07', () => {
    // 2026-05-07 00:00 UTC = 2026-05-07 07:00 ICT.
    const now = new Date('2026-05-07T00:00:00Z');
    const parts = localPartsInTz(now, 'Asia/Ho_Chi_Minh');
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(5);
    expect(parts.day).toBe(7);
    expect(parts.hour).toBe(7);
    expect(parts.minute).toBe(0);
    // 2026-05-07 = Thursday (4).
    expect(parts.dayOfWeek).toBe(4);
  });

  it('UTC = UTC offset 0', () => {
    const now = new Date('2026-05-07T15:30:00Z');
    const parts = localPartsInTz(now, 'UTC');
    expect(parts.year).toBe(2026);
    expect(parts.hour).toBe(15);
    expect(parts.minute).toBe(30);
  });
});

describe('LiveOpsEvent — eventSlotStartFor / eventSlotDurationMs', () => {
  it('BOSS event slot start tại dailyTime trong tz', () => {
    const ev = getLiveOpsEventDef('boss_daily_noon_hoa_diem_son')!;
    const start = eventSlotStartFor(ev, 2026, 5, 7, 'Asia/Ho_Chi_Minh');
    expect(start).not.toBeNull();
    // 12:00 ICT = 05:00 UTC.
    expect(start!.toISOString()).toBe('2026-05-07T05:00:00.000Z');
  });

  it('BOSS event slot duration default 30p', () => {
    const ev = getLiveOpsEventDef('boss_daily_noon_hoa_diem_son')!;
    expect(eventSlotDurationMs(ev)).toBe(30 * 60_000);
  });

  it('Huyết Nguyệt slot duration 60p (override)', () => {
    const ev = getLiveOpsEventDef('event_huyet_nguyet_weekend')!;
    expect(eventSlotDurationMs(ev)).toBe(60 * 60_000);
  });
});

describe('LiveOpsEvent — liveOpsEventsForToday', () => {
  it('Thursday Asia/Ho_Chi_Minh: include 3 DAILY boss + 2 DAILY recurring', () => {
    // 2026-05-07 12:00 ICT = 2026-05-07 05:00 UTC. Thursday.
    const now = new Date('2026-05-07T05:00:00Z');
    const events = liveOpsEventsForToday(now, 'Asia/Ho_Chi_Minh');
    const keys = events.map((e) => e.key);
    expect(keys).toContain('boss_daily_noon_hoa_diem_son');
    expect(keys).toContain('boss_daily_evening_kim_son_mach');
    expect(keys).toContain('boss_daily_night_hoang_tho_huyet');
    expect(keys).toContain('daily_exp_rush_morning');
    expect(keys).toContain('daily_dungeon_rush_evening');
    // Thursday → no Saturday Huyet Nguyet, no Sunday sect aura.
    expect(keys).not.toContain('event_huyet_nguyet_weekend');
    expect(keys).not.toContain('weekly_sect_aura_sunday');
  });

  it('Saturday: include event_huyet_nguyet_weekend', () => {
    // 2026-05-09 = Saturday.
    const now = new Date('2026-05-09T05:00:00Z'); // Saturday 12:00 ICT
    const events = liveOpsEventsForToday(now, 'Asia/Ho_Chi_Minh');
    const keys = events.map((e) => e.key);
    expect(keys).toContain('event_huyet_nguyet_weekend');
    // Saturday vẫn match daily boss nếu daysOfWeek undefined.
    expect(keys).toContain('boss_daily_noon_hoa_diem_son');
  });

  it('Sunday: include weekly_sect_aura_sunday', () => {
    // 2026-05-10 = Sunday.
    const now = new Date('2026-05-10T05:00:00Z');
    const events = liveOpsEventsForToday(now, 'Asia/Ho_Chi_Minh');
    const keys = events.map((e) => e.key);
    expect(keys).toContain('weekly_sect_aura_sunday');
  });

  it('output sorted theo slot start asc', () => {
    const now = new Date('2026-05-07T05:00:00Z'); // Thursday 12:00 ICT
    const events = liveOpsEventsForToday(now, 'Asia/Ho_Chi_Minh');
    // exp_rush_morning 07:00 ICT < boss_noon 12:00 < boss_evening 19:00 < boss_night 22:00
    const noonIdx = events.findIndex((e) => e.key === 'boss_daily_noon_hoa_diem_son');
    const evIdx = events.findIndex((e) => e.key === 'boss_daily_evening_kim_son_mach');
    const morningIdx = events.findIndex((e) => e.key === 'daily_exp_rush_morning');
    expect(morningIdx).toBeLessThan(noonIdx);
    expect(noonIdx).toBeLessThan(evIdx);
  });
});

describe('LiveOpsEvent — activeLiveOpsEvents', () => {
  it('chỉ event đang trong window', () => {
    // 12:15 ICT Thursday = trong window 12:00-12:30 boss_daily_noon_hoa_diem_son.
    const now = new Date('2026-05-07T05:15:00Z');
    const active = activeLiveOpsEvents(now, 'Asia/Ho_Chi_Minh');
    const keys = active.map((e) => e.key);
    expect(keys).toContain('boss_daily_noon_hoa_diem_son');
    expect(keys).not.toContain('boss_daily_evening_kim_son_mach'); // 19:00
  });

  it('khong active sau slot duration', () => {
    // 12:31 ICT Thursday = sau window 30p of boss_daily_noon_hoa_diem_son.
    const now = new Date('2026-05-07T05:31:00Z');
    const active = activeLiveOpsEvents(now, 'Asia/Ho_Chi_Minh');
    const keys = active.map((e) => e.key);
    expect(keys).not.toContain('boss_daily_noon_hoa_diem_son');
  });

  it('Huyết Nguyệt active during 21:00-22:00 Saturday', () => {
    const now = new Date('2026-05-09T14:30:00Z'); // Saturday 21:30 ICT
    const active = activeLiveOpsEvents(now, 'Asia/Ho_Chi_Minh');
    const keys = active.map((e) => e.key);
    expect(keys).toContain('event_huyet_nguyet_weekend');
  });
});

describe('LiveOpsEvent — nextLiveOpsEvent', () => {
  it('11:00 ICT Thursday → next = boss_daily_noon_hoa_diem_son (12:00)', () => {
    const now = new Date('2026-05-07T04:00:00Z'); // 11:00 ICT
    const next = nextLiveOpsEvent(now, 'Asia/Ho_Chi_Minh');
    expect(next).not.toBeNull();
    expect(next!.ev.key).toBe('boss_daily_noon_hoa_diem_son');
    expect(next!.slotStart.toISOString()).toBe('2026-05-07T05:00:00.000Z');
  });

  it('23:00 ICT Thursday → next = morning rush 07:00 next day', () => {
    const now = new Date('2026-05-07T16:00:00Z'); // 23:00 ICT Thursday
    const next = nextLiveOpsEvent(now, 'Asia/Ho_Chi_Minh');
    expect(next).not.toBeNull();
    expect(next!.ev.key).toBe('daily_exp_rush_morning');
    // 2026-05-08 07:00 ICT = 2026-05-08 00:00 UTC.
    expect(next!.slotStart.toISOString()).toBe('2026-05-08T00:00:00.000Z');
  });

  it('Friday 22:01 ICT (sau night boss) → next slot Saturday morning', () => {
    const now = new Date('2026-05-08T15:01:00Z'); // Friday 22:01 ICT
    const next = nextLiveOpsEvent(now, 'Asia/Ho_Chi_Minh');
    expect(next).not.toBeNull();
    // Saturday 07:00 ICT = Saturday 00:00 UTC.
    expect(next!.ev.key).toBe('daily_exp_rush_morning');
  });
});

describe('LiveOpsEvent — bossScheduleForToday', () => {
  it('Thursday Asia/Ho_Chi_Minh: 3 BOSS slots (no Huyết Nguyệt)', () => {
    const now = new Date('2026-05-07T05:00:00Z'); // 12:00 ICT
    const slots = bossScheduleForToday(now, 'Asia/Ho_Chi_Minh');
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.key)).toEqual([
      'boss_daily_noon_hoa_diem_son',
      'boss_daily_evening_kim_son_mach',
      'boss_daily_night_hoang_tho_huyet',
    ]);
  });

  it('status = active cho slot đang mở', () => {
    const now = new Date('2026-05-07T05:15:00Z'); // 12:15 ICT
    const slots = bossScheduleForToday(now, 'Asia/Ho_Chi_Minh');
    const noon = slots.find((s) => s.key === 'boss_daily_noon_hoa_diem_son')!;
    expect(noon.status).toBe('active');
    const evening = slots.find((s) => s.key === 'boss_daily_evening_kim_son_mach')!;
    expect(evening.status).toBe('upcoming');
  });

  it('status = completed cho slot đã hết duration', () => {
    const now = new Date('2026-05-07T05:31:00Z'); // 12:31 ICT
    const slots = bossScheduleForToday(now, 'Asia/Ho_Chi_Minh');
    const noon = slots.find((s) => s.key === 'boss_daily_noon_hoa_diem_son')!;
    expect(noon.status).toBe('completed');
  });

  it('Saturday: include Huyết Nguyệt boss slot', () => {
    const now = new Date('2026-05-09T05:00:00Z'); // Saturday 12:00 ICT
    const slots = bossScheduleForToday(now, 'Asia/Ho_Chi_Minh');
    const keys = slots.map((s) => s.key);
    expect(keys).toContain('event_huyet_nguyet_weekend');
  });

  it('default tz = LIVE_OPS_DEFAULT_TZ', () => {
    expect(LIVE_OPS_DEFAULT_TZ).toBe('Asia/Ho_Chi_Minh');
  });

  it('Phase 13.0 audit pass #5 — propagates rewardHintI18nKey từ catalog vào slot', () => {
    // Repro: trước fix BossScheduleSlot không có rewardHintI18nKey → API +
    // FE không thể render reward hint cho boss schedule. Sau fix: copy field
    // từ catalog (LiveOpsEventDef.rewardHintI18nKey) sang slot.
    const now = new Date('2026-05-07T05:00:00Z'); // Thu 12:00 ICT
    const slots = bossScheduleForToday(now, 'Asia/Ho_Chi_Minh');
    const noon = slots.find((s) => s.key === 'boss_daily_noon_hoa_diem_son')!;
    expect(noon.rewardHintI18nKey).toBe(
      'liveops.event.boss_daily_noon_hoa_diem_son.reward',
    );
    const evening = slots.find((s) => s.key === 'boss_daily_evening_kim_son_mach')!;
    expect(evening.rewardHintI18nKey).toBe(
      'liveops.event.boss_daily_evening_kim_son_mach.reward',
    );
  });
});
