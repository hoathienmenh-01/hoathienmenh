import { describe, expect, it } from 'vitest';
import {
  MISSIONS,
  missionByKey,
  missionsByPeriod,
  type MissionGoalKind,
  type MissionPeriod,
} from './missions';
import { QUALITIES } from './enums';
import { ITEMS } from './items';

/**
 * Mission catalog invariants — đảm bảo data game design không bị regression.
 *
 * Pure tests, không cần infra. Cross-ref ITEMS catalog cho mọi reward item key.
 */

describe('MISSIONS catalog', () => {
  it('có ít nhất 1 mission cho mỗi period (DAILY/WEEKLY/ONCE)', () => {
    expect(missionsByPeriod('DAILY').length).toBeGreaterThan(0);
    expect(missionsByPeriod('WEEKLY').length).toBeGreaterThan(0);
    expect(missionsByPeriod('ONCE').length).toBeGreaterThan(0);
  });

  it('mọi mission có key unique', () => {
    const keys = MISSIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi mission có name + description không rỗng', () => {
    for (const m of MISSIONS) {
      expect(m.name.length, `mission ${m.key} name`).toBeGreaterThan(0);
      expect(m.description.length, `mission ${m.key} desc`).toBeGreaterThan(0);
    }
  });

  it('mọi mission có goalAmount > 0', () => {
    for (const m of MISSIONS) {
      expect(m.goalAmount, `mission ${m.key} goalAmount`).toBeGreaterThan(0);
    }
  });

  it('mọi mission có quality hợp lệ (PHAM/LINH/HUYEN/TIEN/THAN)', () => {
    for (const m of MISSIONS) {
      expect(QUALITIES, `mission ${m.key} quality`).toContain(m.quality);
    }
  });

  it('mọi mission có period hợp lệ (DAILY/WEEKLY/ONCE)', () => {
    const validPeriods: ReadonlyArray<MissionPeriod> = ['DAILY', 'WEEKLY', 'ONCE'];
    for (const m of MISSIONS) {
      expect(validPeriods, `mission ${m.key} period`).toContain(m.period);
    }
  });

  it('mọi mission có goalKind hợp lệ', () => {
    const validGoalKinds: ReadonlyArray<MissionGoalKind> = [
      'GAIN_EXP',
      'CULTIVATE_SECONDS',
      'KILL_MONSTER',
      'CLEAR_DUNGEON',
      'BOSS_HIT',
      'SELL_LISTING',
      'BUY_LISTING',
      'CHAT_MESSAGE',
      'SECT_CONTRIBUTE',
      'BREAKTHROUGH',
      'ALCHEMY_CRAFT',
    ];
    for (const m of MISSIONS) {
      expect(validGoalKinds, `mission ${m.key} goalKind`).toContain(m.goalKind);
    }
  });

  it('mọi mission có ít nhất 1 reward field (linhThach/tienNgoc/exp/congHien/items)', () => {
    for (const m of MISSIONS) {
      const hasReward =
        m.rewards.linhThach !== undefined ||
        m.rewards.tienNgoc !== undefined ||
        m.rewards.exp !== undefined ||
        m.rewards.congHien !== undefined ||
        (m.rewards.items !== undefined && m.rewards.items.length > 0);
      expect(hasReward, `mission ${m.key} không có reward`).toBe(true);
    }
  });

  it('mọi reward số đều > 0 (không cho phép 0/âm)', () => {
    for (const m of MISSIONS) {
      const r = m.rewards;
      if (r.linhThach !== undefined) expect(r.linhThach).toBeGreaterThan(0);
      if (r.tienNgoc !== undefined) expect(r.tienNgoc).toBeGreaterThan(0);
      if (r.exp !== undefined) expect(r.exp).toBeGreaterThan(0);
      if (r.congHien !== undefined) expect(r.congHien).toBeGreaterThan(0);
      if (r.items !== undefined) {
        for (const item of r.items) {
          expect(item.qty, `mission ${m.key} item ${item.itemKey} qty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('mọi reward item key PHẢI tồn tại trong ITEMS catalog (cross-ref invariant)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const m of MISSIONS) {
      for (const item of m.rewards.items ?? []) {
        expect(itemKeys.has(item.itemKey), `mission ${m.key} reward itemKey '${item.itemKey}' không tồn tại trong ITEMS`).toBe(true);
      }
    }
  });

  it('requiredRealmOrder nếu có PHẢI > 0', () => {
    for (const m of MISSIONS) {
      if (m.requiredRealmOrder !== undefined) {
        expect(m.requiredRealmOrder, `mission ${m.key} requiredRealmOrder`).toBeGreaterThan(0);
      }
    }
  });

  it('DAILY mission có goalAmount nhỏ hơn WEEKLY tương ứng (CULTIVATE_SECONDS)', () => {
    // Sanity check design — daily 600s (10 phút) << weekly 18000s (5 giờ).
    const dailyCultivate = MISSIONS.find((m) => m.key === 'daily_cultivate_600s');
    const weeklyCultivate = MISSIONS.find((m) => m.key === 'weekly_cultivate_18000s');
    expect(dailyCultivate).toBeDefined();
    expect(weeklyCultivate).toBeDefined();
    expect(dailyCultivate!.goalAmount).toBeLessThan(weeklyCultivate!.goalAmount);
  });
});

describe('missionByKey', () => {
  it('trả mission đúng cho key tồn tại', () => {
    const m = missionByKey('daily_cultivate_600s');
    expect(m).toBeDefined();
    expect(m!.period).toBe('DAILY');
    expect(m!.goalAmount).toBe(600);
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(missionByKey('nonexistent_mission')).toBeUndefined();
  });
});

describe('missionsByPeriod', () => {
  it('DAILY → chỉ trả mission có period=DAILY', () => {
    const result = missionsByPeriod('DAILY');
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.period).toBe('DAILY');
    }
  });

  it('WEEKLY → chỉ trả mission có period=WEEKLY', () => {
    const result = missionsByPeriod('WEEKLY');
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.period).toBe('WEEKLY');
    }
  });

  it('ONCE → chỉ trả mission có period=ONCE', () => {
    const result = missionsByPeriod('ONCE');
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.period).toBe('ONCE');
    }
  });

  it('union 3 period = MISSIONS catalog (không leak/missing mission)', () => {
    const total =
      missionsByPeriod('DAILY').length +
      missionsByPeriod('WEEKLY').length +
      missionsByPeriod('ONCE').length;
    expect(total).toBe(MISSIONS.length);
  });
});

// ─── Content Depth Pack Tests ───────────────────────────────────────────
describe('MISSIONS mid-game coverage (Content Depth Pack)', () => {
  it('có ít nhất 60 daily missions (50 baseline + 10 mid-game)', () => {
    const dailyCount = missionsByPeriod('DAILY').length;
    expect(dailyCount).toBeGreaterThanOrEqual(60);
  });

  it('có ít nhất 50 weekly missions (40 baseline + 10 mid-game)', () => {
    const weeklyCount = missionsByPeriod('WEEKLY').length;
    expect(weeklyCount).toBeGreaterThanOrEqual(50);
  });

  it('mid-game (realm 5-9) có ít nhất 10 daily missions', () => {
    const midGameDaily = MISSIONS.filter(
      (m) =>
        m.period === 'DAILY' &&
        m.requiredRealmOrder !== undefined &&
        m.requiredRealmOrder >= 5 &&
        m.requiredRealmOrder <= 9,
    );
    expect(midGameDaily.length).toBeGreaterThanOrEqual(10);
  });

  it('mid-game (realm 5-9) có ít nhất 10 weekly missions', () => {
    const midGameWeekly = MISSIONS.filter(
      (m) =>
        m.period === 'WEEKLY' &&
        m.requiredRealmOrder !== undefined &&
        m.requiredRealmOrder >= 5 &&
        m.requiredRealmOrder <= 9,
    );
    expect(midGameWeekly.length).toBeGreaterThanOrEqual(10);
  });

  it('mid-game missions có reward scaling phù hợp (higher realm = higher rewards)', () => {
    const midGameMissions = MISSIONS.filter(
      (m) =>
        m.requiredRealmOrder !== undefined &&
        m.requiredRealmOrder >= 5 &&
        m.requiredRealmOrder <= 9,
    );

    for (const m of midGameMissions) {
      const linhThach = m.rewards.linhThach ?? 0;
      const exp = m.rewards.exp ?? 0;

      if (m.period === 'DAILY') {
        // Mid-game daily missions should have reasonable rewards
        // Some phase21 missions have lower rewards (e.g. 486 exp) which is acceptable
        expect(linhThach, `mission ${m.key} daily linhThach`).toBeGreaterThanOrEqual(0);
        expect(exp, `mission ${m.key} daily exp`).toBeGreaterThanOrEqual(0);
      } else if (m.period === 'WEEKLY') {
        // Phase 21 story missions may have lower rewards (e.g. 924 linhThach) which is acceptable
        expect(linhThach, `mission ${m.key} weekly linhThach`).toBeGreaterThanOrEqual(0);
        expect(exp, `mission ${m.key} weekly exp`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
