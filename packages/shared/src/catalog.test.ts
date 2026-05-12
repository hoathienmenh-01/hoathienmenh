import { describe, it, expect } from 'vitest';
import { EQUIP_SLOTS, QUALITIES } from './enums';
import { ITEMS, itemByKey } from './items';
import { SKILLS, skillByKey, SKILL_BASIC_ATTACK, DUNGEONS, MONSTERS } from './combat';
import { MISSIONS, missionByKey, missionsByPeriod } from './missions';

describe('catalog integrity', () => {
  describe('ITEMS', () => {
    it('has unique keys', () => {
      const keys = ITEMS.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('covers all equip slots', () => {
      const slotsCovered = new Set(ITEMS.map((i) => i.slot).filter(Boolean));
      for (const slot of EQUIP_SLOTS) {
        expect(slotsCovered.has(slot)).toBe(true);
      }
    });

    it('all items have valid quality', () => {
      for (const item of ITEMS) {
        expect(QUALITIES).toContain(item.quality);
      }
    });

    it('itemByKey resolves known keys', () => {
      expect(itemByKey('so_kiem')?.name).toBe('Sơ Kiếm');
      expect(itemByKey('nonexistent_xyz')).toBeUndefined();
    });

    it('equipment items have positive bonuses', () => {
      const equips = ITEMS.filter((i) => i.slot);
      expect(equips.length).toBeGreaterThan(10);
      for (const it of equips) {
        expect(it.bonuses).toBeDefined();
      }
    });

    it('pills have effect with at least one supported pill effect', () => {
      // Phase 11.10.E — pill effect có thể là buffKey (apply BuffDef qua
      // InventoryService.use → BuffService.applyBuffTx) thay vì hp/mp/exp tức thì.
      const pills = ITEMS.filter((i) => i.kind.startsWith('PILL'));
      for (const p of pills) {
        expect(p.effect).toBeDefined();
        const hasInstant =
          (p.effect?.hp ?? 0) +
          (p.effect?.mp ?? 0) +
          (p.effect?.stamina ?? 0) +
          (p.effect?.exp ?? 0) +
          (p.effect?.bodyExp ?? 0) +
          (p.effect?.qiBreakthroughBonus ?? 0) +
          (p.effect?.bodyBreakthroughBonus ?? 0) +
          (p.effect?.tribulationSupport ?? 0) +
          (p.effect?.bodyInjuryReductionMinutes ?? 0) +
          (p.effect?.taoMaReductionMinutes ?? 0) +
          (p.effect?.cultivationRateBonusPct ?? 0) +
          (p.effect?.bodyCultivationRateBonusPct ?? 0) +
          (p.effect?.bossDamageReductionPct ?? 0);
        const hasBuff = p.effect?.buffKey !== undefined;
        const hasResist = Object.keys(p.effect?.elementalResistBonus ?? {}).length > 0;
        expect(
          hasInstant > 0 || hasBuff || hasResist,
          `pill ${p.key} phải có ít nhất 1 effect hỗ trợ`
        ).toBe(true);
      }
    });
  });

  describe('SKILLS', () => {
    it('has unique keys', () => {
      const keys = SKILLS.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('includes SKILL_BASIC_ATTACK', () => {
      expect(SKILLS).toContain(SKILL_BASIC_ATTACK);
      expect(skillByKey('basic_attack')).toBe(SKILL_BASIC_ATTACK);
    });

    it('each sect has ≥2 exclusive skills', () => {
      for (const sect of ['thanh_van', 'huyen_thuy', 'tu_la'] as const) {
        const exclusive = SKILLS.filter((s) => s.sect === sect);
        expect(exclusive.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('selfBloodCost ∈ [0,1] and selfHealRatio ∈ [0,1]', () => {
      for (const s of SKILLS) {
        expect(s.selfBloodCost).toBeGreaterThanOrEqual(0);
        expect(s.selfBloodCost).toBeLessThanOrEqual(1);
        expect(s.selfHealRatio).toBeGreaterThanOrEqual(0);
        expect(s.selfHealRatio).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('DUNGEONS + MONSTERS', () => {
    it('all dungeon monster keys resolve to MONSTERS', () => {
      const mKeys = new Set(MONSTERS.map((m) => m.key));
      for (const d of DUNGEONS) {
        for (const m of d.monsters) {
          expect(mKeys.has(m)).toBe(true);
        }
      }
    });
  });

  describe('MISSIONS', () => {
    it('has unique keys', () => {
      const keys = MISSIONS.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('all mission item reward keys resolve to ITEMS', () => {
      for (const m of MISSIONS) {
        for (const it of m.rewards.items ?? []) {
          expect(itemByKey(it.itemKey)).toBeDefined();
        }
      }
    });

    it('missionsByPeriod splits correctly', () => {
      const total =
        missionsByPeriod('DAILY').length +
        missionsByPeriod('WEEKLY').length +
        missionsByPeriod('ONCE').length;
      expect(total).toBe(MISSIONS.length);
    });

    it('missionByKey resolves known keys', () => {
      expect(missionByKey('daily_cultivate_600s')?.period).toBe('DAILY');
      expect(missionByKey('nonexistent_mission')).toBeUndefined();
    });

    it('has at least 3 missions per period', () => {
      expect(missionsByPeriod('DAILY').length).toBeGreaterThanOrEqual(3);
      expect(missionsByPeriod('WEEKLY').length).toBeGreaterThanOrEqual(3);
      expect(missionsByPeriod('ONCE').length).toBeGreaterThanOrEqual(3);
    });

    it('goalAmount positive, rewards non-empty', () => {
      for (const m of MISSIONS) {
        expect(m.goalAmount).toBeGreaterThan(0);
        const hasReward =
          (m.rewards.linhThach ?? 0) +
          (m.rewards.tienNgoc ?? 0) +
          (m.rewards.exp ?? 0) +
          (m.rewards.congHien ?? 0) +
          (m.rewards.items?.length ?? 0);
        expect(hasReward).toBeGreaterThan(0);
      }
    });
  });
});
