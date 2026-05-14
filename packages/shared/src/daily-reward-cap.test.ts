import { describe, expect, it } from 'vitest';
import { REALMS } from './realms';
import {
  DAILY_REWARD_CAP_BY_REALM_AND_SOURCE,
  REWARD_SOURCES,
  type RewardSource,
  computeCapDecision,
  dailyRewardCapFor,
  isRewardSource,
} from './daily-reward-cap';

describe('Phase 16.5 — daily reward cap catalog', () => {
  describe('REWARD_SOURCES enum', () => {
    it('bao gồm nguồn chính được wire', () => {
      expect(REWARD_SOURCES).toEqual([
        'CULTIVATION',
        'BODY_CULTIVATION',
        'DUNGEON',
        'MISSION',
        'ROGUELIKE',
        'SEASON',
      ]);
    });

    it('isRewardSource type-narrow đúng', () => {
      expect(isRewardSource('CULTIVATION')).toBe(true);
      expect(isRewardSource('BODY_CULTIVATION')).toBe(true);
      expect(isRewardSource('DUNGEON')).toBe(true);
      expect(isRewardSource('MISSION')).toBe(true);
      expect(isRewardSource('ROGUELIKE')).toBe(true);
      expect(isRewardSource('SEASON')).toBe(true);
      expect(isRewardSource('TERRITORY')).toBe(false);
      expect(isRewardSource('')).toBe(false);
    });
  });

  describe('cap catalog map đầy đủ', () => {
    it('mỗi realm trong REALMS có entry cho mọi source', () => {
      for (const r of REALMS) {
        const entry = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key];
        expect(entry, `realm ${r.key}`).toBeDefined();
        for (const src of REWARD_SOURCES) {
          expect(entry![src], `${r.key}.${src}`).toBeDefined();
        }
      }
    });

    it('cap giá trị ≥ 0n + integer (không nhận float dive)', () => {
      for (const r of REALMS) {
        for (const src of REWARD_SOURCES) {
          const cap = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key]![src];
          expect(cap.expCap >= 0n, `${r.key}.${src}.expCap`).toBe(true);
          expect(
            cap.linhThachCap >= 0n,
            `${r.key}.${src}.linhThachCap`,
          ).toBe(true);
        }
      }
    });

    it('cap CULTIVATION linhThach = 0n (cultivation không grant linh thạch)', () => {
      for (const r of REALMS) {
        const cap = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key]!.CULTIVATION;
        expect(cap.linhThachCap).toBe(0n);
      }
    });

    it('cap BODY_CULTIVATION riêng và không grant linh thạch', () => {
      for (const r of REALMS) {
        const cap = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key]!.BODY_CULTIVATION;
        expect(cap.expCap > 0n).toBe(true);
        expect(cap.linhThachCap).toBe(0n);
      }
    });
  });

  describe('cap monotonic non-decreasing theo realm.order (invariant)', () => {
    it.each(REWARD_SOURCES)('source=%s expCap không giảm', (src: RewardSource) => {
      let prev = -1n;
      for (const r of [...REALMS].sort((a, b) => a.order - b.order)) {
        const cap = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key]![src];
        expect(cap.expCap >= prev, `realm=${r.key} src=${src}`).toBe(true);
        prev = cap.expCap;
      }
    });

    it.each(REWARD_SOURCES)('source=%s linhThachCap không giảm', (src: RewardSource) => {
      let prev = -1n;
      for (const r of [...REALMS].sort((a, b) => a.order - b.order)) {
        const cap = DAILY_REWARD_CAP_BY_REALM_AND_SOURCE[r.key]![src];
        expect(cap.linhThachCap >= prev, `realm=${r.key} src=${src}`).toBe(
          true,
        );
        prev = cap.linhThachCap;
      }
    });
  });

  describe('dailyRewardCapFor lookup', () => {
    it('realm cao có cap ≥ realm thấp cùng source', () => {
      const low = dailyRewardCapFor('phamnhan', 'DUNGEON');
      const high = dailyRewardCapFor('vinh_hang', 'DUNGEON');
      expect(high.expCap >= low.expCap).toBe(true);
      expect(high.linhThachCap >= low.linhThachCap).toBe(true);
    });

    it('realm key không tồn tại → fallback realm 0 (phamnhan tier)', () => {
      const fallback = dailyRewardCapFor('khong-ton-tai-realm', 'DUNGEON');
      const baseline = dailyRewardCapFor('phamnhan', 'DUNGEON');
      expect(fallback).toEqual(baseline);
    });

    it('cap CULTIVATION > 0 cho mọi realm (cultivation luôn cho phép EXP gain)', () => {
      for (const r of REALMS) {
        expect(dailyRewardCapFor(r.key, 'CULTIVATION').expCap > 0n).toBe(true);
        expect(dailyRewardCapFor(r.key, 'BODY_CULTIVATION').expCap > 0n).toBe(
          true,
        );
      }
    });
  });

  describe('computeCapDecision pure helper', () => {
    const cap = { expCap: 1000n, linhThachCap: 500n };
    const zeroAccum = { expDelta: 0n, linhThachDelta: 0n };

    it('first request under cap → grant đủ, không cap', () => {
      const out = computeCapDecision(zeroAccum, cap, {
        expDelta: 200n,
        linhThachDelta: 100n,
      });
      expect(out.granted.expDelta).toBe(200n);
      expect(out.granted.linhThachDelta).toBe(100n);
      expect(out.remainder.expDelta).toBe(0n);
      expect(out.remainder.linhThachDelta).toBe(0n);
      expect(out.wasCapped).toBe(false);
      expect(out.remaining.expDelta).toBe(800n);
      expect(out.remaining.linhThachDelta).toBe(400n);
    });

    it('request vượt cap → grant tới ngưỡng, remainder = phần thừa', () => {
      const out = computeCapDecision(zeroAccum, cap, {
        expDelta: 1500n,
        linhThachDelta: 600n,
      });
      expect(out.granted.expDelta).toBe(1000n);
      expect(out.granted.linhThachDelta).toBe(500n);
      expect(out.remainder.expDelta).toBe(500n);
      expect(out.remainder.linhThachDelta).toBe(100n);
      expect(out.wasCapped).toBe(true);
      expect(out.remaining.expDelta).toBe(0n);
      expect(out.remaining.linhThachDelta).toBe(0n);
    });

    it('đã hết cap (accum=cap) → grant 0, wasCapped=true', () => {
      const out = computeCapDecision(
        { expDelta: 1000n, linhThachDelta: 500n },
        cap,
        { expDelta: 100n, linhThachDelta: 50n },
      );
      expect(out.granted.expDelta).toBe(0n);
      expect(out.granted.linhThachDelta).toBe(0n);
      expect(out.wasCapped).toBe(true);
    });

    it('accum vượt cap (legacy/admin grant) không gây remainder âm', () => {
      const out = computeCapDecision(
        { expDelta: 9999n, linhThachDelta: 9999n },
        cap,
        { expDelta: 100n, linhThachDelta: 50n },
      );
      expect(out.granted.expDelta).toBe(0n);
      expect(out.granted.linhThachDelta).toBe(0n);
      expect(out.remaining.expDelta).toBe(0n);
      expect(out.remaining.linhThachDelta).toBe(0n);
    });

    it('requested âm → coerce 0 (không xử lý refund qua cap)', () => {
      const out = computeCapDecision(zeroAccum, cap, {
        expDelta: -50n,
        linhThachDelta: -10n,
      });
      expect(out.granted.expDelta).toBe(0n);
      expect(out.granted.linhThachDelta).toBe(0n);
      expect(out.wasCapped).toBe(false);
      expect(out.remainder.expDelta).toBe(0n);
      expect(out.remainder.linhThachDelta).toBe(0n);
    });

    it('partial cap: chỉ exp bị cap, linhThach còn dư', () => {
      const out = computeCapDecision(
        { expDelta: 950n, linhThachDelta: 0n },
        cap,
        { expDelta: 200n, linhThachDelta: 100n },
      );
      expect(out.granted.expDelta).toBe(50n);
      expect(out.granted.linhThachDelta).toBe(100n);
      expect(out.remainder.expDelta).toBe(150n);
      expect(out.remainder.linhThachDelta).toBe(0n);
      expect(out.wasCapped).toBe(true);
    });

    it('invariant: granted + remainder = requested (cho input dương)', () => {
      const out = computeCapDecision(
        { expDelta: 200n, linhThachDelta: 50n },
        cap,
        { expDelta: 1000n, linhThachDelta: 600n },
      );
      expect(out.granted.expDelta + out.remainder.expDelta).toBe(1000n);
      expect(
        out.granted.linhThachDelta + out.remainder.linhThachDelta,
      ).toBe(600n);
    });
  });

  describe('balance sanity — early game cap không quá tight', () => {
    it('phamnhan cultivation cap ≥ rate đỉnh × tick/ngày bình thường', () => {
      // Tick mỗi 60s ≈ 1440 tick/ngày; phamnhan rate ~5–10 EXP → ngày
      // cày "active" 4h ≈ 240 tick × 10 EXP = 2400 EXP. Cap 6000 đủ headroom.
      const cap = dailyRewardCapFor('phamnhan', 'CULTIVATION');
      expect(cap.expCap >= 6000n).toBe(true);
    });

    it('phamnhan dungeon cap ≥ 10 dungeon clear cơ bản', () => {
      // 1 dungeon clear ~ 50 linhThach + 200 EXP. 10 clear/ngày ngày
      // bùng nổ ~ 500 linhThach + 2000 EXP. Cap phải đủ accomodate.
      const cap = dailyRewardCapFor('phamnhan', 'DUNGEON');
      expect(cap.linhThachCap >= 500n).toBe(true);
      expect(cap.expCap >= 2000n).toBe(true);
    });

    it('mid-game (kim_dan) cap ≥ ×3 phamnhan cùng source', () => {
      const low = dailyRewardCapFor('phamnhan', 'DUNGEON');
      const mid = dailyRewardCapFor('kim_dan', 'DUNGEON');
      expect(mid.expCap).toBe(low.expCap * 3n);
      expect(mid.linhThachCap).toBe(low.linhThachCap * 3n);
    });

    it('late-game (luyen_hu+) cap ≥ ×8 phamnhan', () => {
      const low = dailyRewardCapFor('phamnhan', 'DUNGEON');
      const late = dailyRewardCapFor('luyen_hu', 'DUNGEON');
      expect(late.expCap).toBe(low.expCap * 8n);
      expect(late.linhThachCap).toBe(low.linhThachCap * 8n);
    });
  });
});
