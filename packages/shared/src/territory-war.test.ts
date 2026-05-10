/**
 * Phase 14.0.D — Tests cho period helpers thuộc Territory Weekly War Loop.
 *
 * **TZ Hotfix expansion**: các helper period đã chuyển sang TZ-aware ICT
 * (`Asia/Ho_Chi_Minh`) đồng nhất với `sectWarWeekKey`/`startOfSectWarWeek`.
 * Mốc tuần là Thứ Hai 00:00 ICT (= Chủ Nhật 17:00 UTC tuần liền trước), KHÔNG
 * còn là Mon 00:00 UTC như bản cũ Phase 14.0.B.
 *
 * Cover:
 *   - currentTerritoryPeriodKey() = territoryPeriodKeyForDate(now) trong tz.
 *   - nextTerritoryResetAt() rơi đúng Thứ Hai 00:00 ICT kế tiếp
 *     (= Chủ Nhật 17:00 UTC).
 *   - territoryPeriodWindow() trả startsAt = Mon 00:00 ICT, endsAt =
 *     Mon 00:00 ICT kế.
 *   - previousTerritoryPeriodKey(Mon 00:05 ICT) trả đúng week trước
 *     (cron-style scenario, cơ chế cũ `now-7d` UTC đã bị off-by-one).
 *   - validateTerritoryPeriodKey() OK / fail mã chuẩn.
 */
import { describe, it, expect } from 'vitest';
import {
  currentTerritoryPeriodKey,
  nextTerritoryResetAt,
  previousTerritoryPeriodKey,
  territoryPeriodKeyForDate,
  territoryPeriodWindow,
  validateTerritoryPeriodKey,
} from './territory';

describe('currentTerritoryPeriodKey', () => {
  it('đồng nhất với territoryPeriodKeyForDate(now)', () => {
    const now = new Date('2026-06-04T12:34:56.000Z'); // Thursday W23.
    expect(currentTerritoryPeriodKey(now)).toBe(
      territoryPeriodKeyForDate(now),
    );
  });

  it('Thursday đầu năm 2027 → 2027-W01 (ISO week)', () => {
    // 2027-01-07 07:00 ICT (Thursday) → tuần 1.
    const now = new Date('2027-01-07T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(now)).toBe('2027-W01');
  });

  it('biên giao mùa: 2025-12-29 07:00 ICT (Mon W01/2026) → 2026-W01', () => {
    // 2025-12-29 00:00 UTC = 2025-12-29 07:00 ICT (Monday). Mon ICT W01/2026.
    const mon = new Date('2025-12-29T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(mon)).toBe('2026-W01');
  });

  it('Sunday 2026-01-04 16:59 UTC (= 23:59 ICT, vẫn thuộc W01/2026) → 2026-W01', () => {
    // ICT-aware: mốc chuyển tuần là Mon 00:00 ICT = Sun 17:00 UTC. Tại Sun 16:59 UTC
    // (= Sun 23:59 ICT) vẫn thuộc W01/2026.
    const sun = new Date('2026-01-04T16:59:59.999Z');
    expect(currentTerritoryPeriodKey(sun)).toBe('2026-W01');
  });

  it('Sunday 2026-01-04 17:00 UTC (= Mon 00:00 ICT) → 2026-W02 (chuyển tuần)', () => {
    // Đúng mốc chuyển tuần ICT → W02.
    const boundary = new Date('2026-01-04T17:00:00.000Z');
    expect(currentTerritoryPeriodKey(boundary)).toBe('2026-W02');
  });
});

describe('nextTerritoryResetAt (TZ-aware ICT)', () => {
  it('Thursday giữa tuần → Monday 00:00 ICT kỳ kế (= Sun 17:00 UTC)', () => {
    // 2026-06-04 Thursday ICT → next Mon ICT = 2026-06-08 00:00 ICT
    //   = 2026-06-07T17:00:00.000Z.
    const now = new Date('2026-06-04T12:34:56.789Z');
    const reset = nextTerritoryResetAt(now);
    expect(reset.toISOString()).toBe('2026-06-07T17:00:00.000Z');
  });

  it('Monday 00:00 ICT chính xác → 7 ngày sau (next reset, KHÔNG phải reset hiện tại)', () => {
    // Mon 2026-06-01 00:00 ICT = Sun 2026-05-31 17:00 UTC.
    const mon = new Date('2026-05-31T17:00:00.000Z');
    const reset = nextTerritoryResetAt(mon);
    // Mon 2026-06-08 00:00 ICT = Sun 2026-06-07 17:00 UTC.
    expect(reset.toISOString()).toBe('2026-06-07T17:00:00.000Z');
  });

  it('Monday giữa ngày ICT → Monday tuần kế ICT', () => {
    // Mon 2026-06-01 22:00 ICT = Mon 2026-06-01 15:00 UTC.
    const mon = new Date('2026-06-01T15:00:00.000Z');
    const reset = nextTerritoryResetAt(mon);
    expect(reset.toISOString()).toBe('2026-06-07T17:00:00.000Z');
  });

  it('Sunday 16:59 UTC (= Sun 23:59 ICT) → Monday 00:00 ICT (1 phút sau)', () => {
    const sun = new Date('2026-06-07T16:59:59.999Z');
    const reset = nextTerritoryResetAt(sun);
    expect(reset.toISOString()).toBe('2026-06-07T17:00:00.000Z');
  });

  it('biên giao năm: 2025-12-31 12:00 UTC (= 19:00 ICT) → Mon 2026-01-05 00:00 ICT (W02)', () => {
    const wed = new Date('2025-12-31T12:00:00.000Z');
    const reset = nextTerritoryResetAt(wed);
    // Wed Dec 31 ICT thuộc tuần Mon 2025-12-29..Sun 2026-01-04 ICT → next Mon =
    //   Mon 2026-01-05 00:00 ICT = Sun 2026-01-04 17:00 UTC.
    expect(reset.toISOString()).toBe('2026-01-04T17:00:00.000Z');
  });

  it('reset luôn rơi đúng Thứ Hai 00:00 ICT (= Sun 17:00 UTC, qua nhiều mẫu)', () => {
    const samples = [
      '2026-01-01T00:00:00.000Z',
      '2026-03-15T18:00:00.000Z',
      '2026-07-04T12:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ];
    for (const s of samples) {
      const reset = nextTerritoryResetAt(new Date(s));
      // Mon 00:00 ICT = Sun 17:00 UTC → getUTCDay() === 0 (Sun), getUTCHours()
      //   === 17.
      expect(reset.getUTCDay()).toBe(0);
      expect(reset.getUTCHours()).toBe(17);
      expect(reset.getUTCMinutes()).toBe(0);
      expect(reset.getUTCSeconds()).toBe(0);
      expect(reset.getUTCMilliseconds()).toBe(0);
      expect(reset.getTime()).toBeGreaterThan(new Date(s).getTime());
    }
  });
});

describe('territoryPeriodWindow (TZ-aware ICT)', () => {
  it('2026-W23 → Mon 2026-06-01 00:00 ICT .. Mon 2026-06-08 00:00 ICT', () => {
    const w = territoryPeriodWindow('2026-W23');
    expect(w).not.toBeNull();
    // Mon 00:00 ICT = Sun 17:00 UTC tuần liền trước.
    expect(w!.startsAt.toISOString()).toBe('2026-05-31T17:00:00.000Z');
    expect(w!.endsAt.toISOString()).toBe('2026-06-07T17:00:00.000Z');
  });

  it('2026-W01 → Mon 2025-12-29 00:00 ICT .. Mon 2026-01-05 00:00 ICT', () => {
    const w = territoryPeriodWindow('2026-W01');
    expect(w).not.toBeNull();
    // 2025-12-29 00:00 ICT = 2025-12-28 17:00 UTC.
    expect(w!.startsAt.toISOString()).toBe('2025-12-28T17:00:00.000Z');
    expect(w!.endsAt.toISOString()).toBe('2026-01-04T17:00:00.000Z');
  });

  it('roundtrip: territoryPeriodKeyForDate(window.startsAt) === periodKey', () => {
    // 2026 có 53 tuần ISO (Jan 1 = Thursday) — sample W53 boundary year.
    const samples = [
      '2026-W01',
      '2026-W23',
      '2026-W52',
      '2026-W53',
      '2027-W01',
    ];
    for (const pk of samples) {
      const w = territoryPeriodWindow(pk);
      expect(w).not.toBeNull();
      expect(territoryPeriodKeyForDate(w!.startsAt)).toBe(pk);
    }
  });

  it('endsAt - startsAt = 7 ngày wall-time', () => {
    const w = territoryPeriodWindow('2026-W23')!;
    const diff = w.endsAt.getTime() - w.startsAt.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('manual_* periodKey → null (không có cửa sổ thời gian xác định)', () => {
    expect(territoryPeriodWindow('manual_admin_001')).toBeNull();
    expect(territoryPeriodWindow('manual_xx')).toBeNull();
  });

  it('periodKey malformed → null (không throw)', () => {
    expect(territoryPeriodWindow('bad')).toBeNull();
    expect(territoryPeriodWindow('2026-W00')).toBeNull();
    expect(territoryPeriodWindow('2026-W54')).toBeNull();
    expect(territoryPeriodWindow('')).toBeNull();
  });

  it('startsAt luôn là Mon 00:00 ICT (= Sun 17:00 UTC) qua nhiều mẫu', () => {
    const samples = ['2026-W01', '2026-W12', '2026-W30', '2026-W52'];
    for (const pk of samples) {
      const w = territoryPeriodWindow(pk)!;
      // Mon 00:00 ICT ≡ Sun 17:00 UTC.
      expect(w.startsAt.getUTCDay()).toBe(0);
      expect(w.startsAt.getUTCHours()).toBe(17);
      expect(w.startsAt.getUTCMinutes()).toBe(0);
    }
  });

  it('TZ độc lập: territoryPeriodWindow("2026-W23", "UTC") → Mon 00:00 UTC', () => {
    // Khi caller truyền tz=UTC, startsAt = Mon 00:00 UTC (legacy behavior).
    const w = territoryPeriodWindow('2026-W23', 'UTC');
    expect(w).not.toBeNull();
    expect(w!.startsAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(w!.endsAt.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });
});

describe('validateTerritoryPeriodKey', () => {
  it('ISO week valid → ok=true, kind=iso_week', () => {
    const r = validateTerritoryPeriodKey('2026-W23');
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('iso_week');
    expect(r.code).toBeNull();
  });

  it('manual valid → ok=true, kind=manual', () => {
    const r = validateTerritoryPeriodKey('manual_admin_001');
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('manual');
    expect(r.code).toBeNull();
  });

  it('empty string → PERIOD_EMPTY', () => {
    const r = validateTerritoryPeriodKey('');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PERIOD_EMPTY');
    expect(r.kind).toBeNull();
  });

  it('quá dài → PERIOD_TOO_LONG', () => {
    const r = validateTerritoryPeriodKey('a'.repeat(65));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PERIOD_TOO_LONG');
  });

  it('format không khớp → PERIOD_INVALID_FORMAT', () => {
    const cases = [
      'bad',
      '2026-w23',
      '2026-W00',
      '2026-W54',
      'manual',
      'manual_',
      'manual_UPPER',
    ];
    for (const c of cases) {
      const r = validateTerritoryPeriodKey(c);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('PERIOD_INVALID_FORMAT');
    }
  });
});

describe('previousTerritoryPeriodKey vs current (TZ-aware)', () => {
  it('previousTerritoryPeriodKey(now) = period của tuần liền trước now', () => {
    // 2026-06-04 07:00 ICT (Thu W23) → previous = 2026-W22.
    const now = new Date('2026-06-04T00:00:00.000Z');
    expect(previousTerritoryPeriodKey(now)).toBe('2026-W22');
    expect(currentTerritoryPeriodKey(now)).toBe('2026-W23');
  });

  it('biên giao năm: previous của 2026-W01 = 2025-W52', () => {
    // 2025-12-29 07:00 ICT (Mon W01/2026) → previous = 2025-W52.
    const mon = new Date('2025-12-29T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(mon)).toBe('2026-W01');
    expect(previousTerritoryPeriodKey(mon)).toBe('2025-W52');
  });

  it('cron Mon 00:05 ICT (= Sun 17:05 UTC) → previousPeriodKey = tuần vừa kết thúc (KHÔNG off-by-one)', () => {
    // **TZ Hotfix bug-demo case**: cron chạy thứ Hai 00:05 ICT (= Sun 17:05
    // UTC) để chốt tuần vừa kết thúc. Cơ chế cũ (`now-7d` UTC) trả
    // 2026-W17 (off-by-one), cơ chế mới (`startOfSectWarWeek - 1ms`) trả
    //   đúng 2026-W18.
    const cronAt = new Date('2026-05-03T17:05:00.000Z');
    expect(currentTerritoryPeriodKey(cronAt)).toBe('2026-W19');
    expect(previousTerritoryPeriodKey(cronAt)).toBe('2026-W18');
  });

  it('cron Mon 00:00:00 ICT đúng giây reset → previous = tuần vừa kết thúc', () => {
    // Mon 2026-05-04 00:00:00 ICT = Sun 2026-05-03 17:00:00 UTC.
    const cronAt = new Date('2026-05-03T17:00:00.000Z');
    expect(currentTerritoryPeriodKey(cronAt)).toBe('2026-W19');
    expect(previousTerritoryPeriodKey(cronAt)).toBe('2026-W18');
  });

  it('cron Sun 23:59:59 ICT (= Sun 16:59:59 UTC) trước reset → previous = tuần trước', () => {
    // Sun 2026-05-03 23:59:59 ICT = Sun 2026-05-03 16:59:59 UTC — vẫn
    //   thuộc W18.
    const beforeBoundary = new Date('2026-05-03T16:59:59.999Z');
    expect(currentTerritoryPeriodKey(beforeBoundary)).toBe('2026-W18');
    expect(previousTerritoryPeriodKey(beforeBoundary)).toBe('2026-W17');
  });

  it('consistency: previousTerritoryPeriodKey(window(currentKey).startsAt - 1ms)', () => {
    // Roundtrip: end-of-prev-week → prev key.
    const now = new Date('2026-06-04T07:00:00.000Z');
    const curKey = currentTerritoryPeriodKey(now);
    const w = territoryPeriodWindow(curKey)!;
    const prevEnd = new Date(w.startsAt.getTime() - 1);
    expect(territoryPeriodKeyForDate(prevEnd)).toBe(
      previousTerritoryPeriodKey(now),
    );
  });
});
