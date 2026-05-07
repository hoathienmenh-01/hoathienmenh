/**
 * LiveOpsService tests — Phase 13.0 §D `/liveops/today` retention dashboard.
 *
 * Pure deterministic compute trên timestamp inject — không cần DB.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LiveOpsService } from './liveops.service';

describe('LiveOpsService.today()', () => {
  const svc = new LiveOpsService();

  afterEach(() => {
    delete process.env.LIVEOPS_TZ;
  });

  it('Saturday 21:30 ICT → activeEvents include Huyết Nguyệt boss + bossSchedule có cuu_la_thien_de active', () => {
    // Sat 2026-05-09 21:30 ICT = 14:30 UTC.
    const now = new Date('2026-05-09T14:30:00Z');
    const out = svc.today(now);

    expect(out.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(out.nowIso).toBe(now.toISOString());

    const huyetNguyet = out.activeEvents.find(
      (e) => e.key === 'event_huyet_nguyet_weekend',
    );
    expect(huyetNguyet).toBeDefined();
    expect(huyetNguyet!.bossKey).toBe('cuu_la_thien_de');
    expect(huyetNguyet!.regionKey).toBe('cuu_la_dien');

    const bossSlot = out.bossSchedule.find(
      (s) => s.bossKey === 'cuu_la_thien_de',
    );
    expect(bossSlot).toBeDefined();
    expect(bossSlot!.status).toBe('active');
  });

  it('Wednesday 13:00 ICT → bossSchedule không include Huyết Nguyệt (weekly only Sat)', () => {
    // Wed 2026-05-06 13:00 ICT = 06:00 UTC.
    const now = new Date('2026-05-06T06:00:00Z');
    const out = svc.today(now);

    expect(
      out.bossSchedule.find((s) => s.bossKey === 'cuu_la_thien_de'),
    ).toBeUndefined();

    // Noon slot (12:00 ICT) đã completed (current 13:00).
    const noonSlot = out.bossSchedule.find(
      (s) => s.bossKey === 'hoa_long_to_su',
    );
    expect(noonSlot).toBeDefined();
    expect(noonSlot!.status).toBe('completed');
  });

  it('Wednesday 12:15 ICT → noon boss `hoa_long_to_su` ACTIVE, suggestedActivities priority boss', () => {
    // Wed 2026-05-06 12:15 ICT = 05:15 UTC, in noon slot 12:00-12:30.
    const now = new Date('2026-05-06T05:15:00Z');
    const out = svc.today(now);

    const noon = out.bossSchedule.find((s) => s.bossKey === 'hoa_long_to_su');
    expect(noon!.status).toBe('active');

    const sug = out.suggestedActivities[0];
    expect(sug).toBeDefined();
    expect(sug!.kind).toBe('boss');
    expect(sug!.bossKey).toBe('hoa_long_to_su');
    expect(sug!.regionKey).toBe('hoa_diem_son');
  });

  it('Wednesday 11:30 ICT → noon boss upcoming, suggestedActivities có secondsUntilStart > 0', () => {
    const now = new Date('2026-05-06T04:30:00Z');
    const out = svc.today(now);

    const noon = out.bossSchedule.find((s) => s.bossKey === 'hoa_long_to_su');
    expect(noon!.status).toBe('upcoming');
    expect(noon!.secondsUntilStart).toBeGreaterThan(0);
    expect(noon!.secondsUntilStart).toBeLessThanOrEqual(30 * 60);

    const sug = out.suggestedActivities[0];
    expect(sug?.kind).toBe('boss');
    expect(sug?.bossKey).toBe('hoa_long_to_su');
    expect(sug?.secondsUntilStart).toBeGreaterThan(0);
  });

  it('nextEvent populated với secondsUntilStart consistent', () => {
    const now = new Date('2026-05-06T04:00:00Z');
    const out = svc.today(now);

    expect(out.nextEvent).not.toBeNull();
    expect(out.nextEvent!.secondsUntilStart).toBeGreaterThan(0);
    const start = new Date(out.nextEvent!.slotStartIso).getTime();
    const expectedSec = Math.floor((start - now.getTime()) / 1000);
    expect(out.nextEvent!.secondsUntilStart).toBe(expectedSec);
  });

  it('todayEvents shape stable: type ∈ DAILY|WEEKLY|LIMITED|BOSS|STORY', () => {
    const now = new Date('2026-05-09T14:30:00Z');
    const out = svc.today(now);
    for (const ev of out.todayEvents) {
      expect(['DAILY', 'WEEKLY', 'LIMITED', 'BOSS', 'STORY']).toContain(ev.type);
      expect(typeof ev.titleI18nKey).toBe('string');
    }
  });

  it('LIVEOPS_TZ override → response.timezone reflect override', () => {
    process.env.LIVEOPS_TZ = 'UTC';
    const now = new Date('2026-05-06T05:15:00Z');
    const out = svc.today(now);
    expect(out.timezone).toBe('UTC');
  });
});
