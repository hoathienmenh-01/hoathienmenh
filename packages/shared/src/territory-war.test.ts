/**
 * Phase 14.0.D — Tests cho period helpers thuộc Territory Weekly War Loop.
 *
 * Cover:
 *   - currentTerritoryPeriodKey() = territoryPeriodKeyForDate(now)
 *   - nextTerritoryResetAt() rơi đúng Thứ Hai 00:00 UTC kế tiếp.
 *   - nextTerritoryResetAt() chuyển ngày DST-free (UTC) qua tuần năm mới.
 *   - territoryPeriodWindow() trả startsAt = Thứ Hai, endsAt = Thứ Hai kế.
 *   - territoryPeriodWindow() consistent với territoryPeriodKeyForDate().
 *   - territoryPeriodWindow() cho `manual_*` → null.
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
    // 2027-01-07 Thursday → tuần 1 (chứa Thursday 2027-01-07).
    const now = new Date('2027-01-07T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(now)).toBe('2027-W01');
  });

  it('biên giao mùa: 2025-12-29 (Mon W01/2026) → 2026-W01', () => {
    // ISO 8601: tuần đầu 2026 chứa Thursday 2026-01-01 → Mon = 2025-12-29.
    const mon = new Date('2025-12-29T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(mon)).toBe('2026-W01');
  });

  it('Sunday 2026-01-04 (vẫn thuộc W01/2026) → 2026-W01', () => {
    const sun = new Date('2026-01-04T23:59:59.999Z');
    expect(currentTerritoryPeriodKey(sun)).toBe('2026-W01');
  });
});

describe('nextTerritoryResetAt', () => {
  it('Thursday giữa tuần → Monday 00:00 UTC kỳ kế', () => {
    // 2026-06-04 Thursday → next Monday = 2026-06-08 00:00 UTC.
    const now = new Date('2026-06-04T12:34:56.789Z');
    const reset = nextTerritoryResetAt(now);
    expect(reset.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('Monday 00:00 UTC chính xác → 7 ngày sau (next reset, KHÔNG phải reset hiện tại)', () => {
    const mon = new Date('2026-06-01T00:00:00.000Z'); // Mon W23.
    const reset = nextTerritoryResetAt(mon);
    expect(reset.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('Monday giữa ngày → Monday tuần kế', () => {
    const mon = new Date('2026-06-01T15:00:00.000Z');
    const reset = nextTerritoryResetAt(mon);
    expect(reset.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('Sunday 23:59 → Monday 00:00 (chỉ vài phút sau)', () => {
    const sun = new Date('2026-06-07T23:59:59.999Z');
    const reset = nextTerritoryResetAt(sun);
    expect(reset.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('biên giao năm: 2025-12-31 → Mon 2026-01-05 (W02 boundary)', () => {
    const wed = new Date('2025-12-31T12:00:00.000Z');
    const reset = nextTerritoryResetAt(wed);
    // Wed 2025-12-31 thuộc tuần Mon 2025-12-29..Sun 2026-01-04 → next Mon = 2026-01-05.
    expect(reset.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('reset luôn rơi đúng Thứ Hai 00:00 UTC (qua nhiều mẫu)', () => {
    const samples = [
      '2026-01-01T00:00:00.000Z',
      '2026-03-15T18:00:00.000Z',
      '2026-07-04T12:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ];
    for (const s of samples) {
      const reset = nextTerritoryResetAt(new Date(s));
      expect(reset.getUTCDay()).toBe(1); // 1 = Monday.
      expect(reset.getUTCHours()).toBe(0);
      expect(reset.getUTCMinutes()).toBe(0);
      expect(reset.getUTCSeconds()).toBe(0);
      expect(reset.getUTCMilliseconds()).toBe(0);
      expect(reset.getTime()).toBeGreaterThan(new Date(s).getTime());
    }
  });
});

describe('territoryPeriodWindow', () => {
  it('2026-W23 → Mon 2026-06-01 .. Mon 2026-06-08', () => {
    const w = territoryPeriodWindow('2026-W23');
    expect(w).not.toBeNull();
    expect(w!.startsAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(w!.endsAt.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('2026-W01 → Mon 2025-12-29 .. Mon 2026-01-05 (ISO 8601 boundary)', () => {
    const w = territoryPeriodWindow('2026-W01');
    expect(w).not.toBeNull();
    expect(w!.startsAt.toISOString()).toBe('2025-12-29T00:00:00.000Z');
    expect(w!.endsAt.toISOString()).toBe('2026-01-05T00:00:00.000Z');
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

  it('endsAt - startsAt = 7 ngày', () => {
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

  it('startsAt luôn là Thứ Hai 00:00 UTC', () => {
    const samples = ['2026-W01', '2026-W12', '2026-W30', '2026-W52'];
    for (const pk of samples) {
      const w = territoryPeriodWindow(pk)!;
      expect(w.startsAt.getUTCDay()).toBe(1);
      expect(w.startsAt.getUTCHours()).toBe(0);
      expect(w.startsAt.getUTCMinutes()).toBe(0);
    }
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

describe('previousTerritoryPeriodKey vs current', () => {
  it('previousTerritoryPeriodKey(now) = period 7 ngày trước now', () => {
    // 2026-06-04 Thu W23 → previous = 2026-W22.
    const now = new Date('2026-06-04T00:00:00.000Z');
    expect(previousTerritoryPeriodKey(now)).toBe('2026-W22');
    expect(currentTerritoryPeriodKey(now)).toBe('2026-W23');
  });

  it('biên giao năm: previous của 2026-W01 = 2025-W52 hoặc 2025-W53', () => {
    // 2026-W01 Mon = 2025-12-29. 7 ngày trước = 2025-12-22 (Mon W52/2025).
    const mon = new Date('2025-12-29T00:00:00.000Z');
    expect(currentTerritoryPeriodKey(mon)).toBe('2026-W01');
    expect(previousTerritoryPeriodKey(mon)).toBe('2025-W52');
  });
});
