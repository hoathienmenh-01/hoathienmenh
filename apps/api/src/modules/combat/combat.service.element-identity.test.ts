/**
 * Phase 14.2.D — Combat service element identity response shape tests.
 *
 * Verifies:
 *   - `listDungeons()` returns mỗi entry kèm `elementProfile`
 *     (dominantElement, recommendedCounterElement, rewardElementHint).
 *   - Profile derive consistent với catalog `DungeonDef.element`.
 *   - No-double-multiplier: response không expose multiplier numeric
 *     (FE compute via i18n key + relation type, không nhận formula).
 *
 * Pure unit test — no DB. CombatService.listDungeons() là sync getter
 * trên DUNGEONS catalog không cần Prisma.
 */
import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  elementOvercomes,
  type DungeonDef,
  type DungeonElementProfile,
  type ElementKey,
} from '@xuantoi/shared';
import { CombatService } from './combat.service';

// Stub-construct CombatService với undefined deps. listDungeons() chỉ
// đọc DUNGEONS shared catalog, KHÔNG đụng Prisma/Realtime/etc.
function makeListOnlyCombat(): CombatService {
  return new CombatService(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

describe('CombatService.listDungeons (Phase 14.2.D)', () => {
  it('mỗi dungeon trả kèm elementProfile shape ổn định', () => {
    const combat = makeListOnlyCombat();
    const list = combat.listDungeons() as Array<
      DungeonDef & { elementProfile: DungeonElementProfile }
    >;
    expect(list.length).toBeGreaterThanOrEqual(9);
    for (const d of list) {
      expect(d.elementProfile).toBeDefined();
      expect(d.elementProfile).toHaveProperty('dominantElement');
      expect(d.elementProfile).toHaveProperty('recommendedCounterElement');
      expect(d.elementProfile).toHaveProperty('rewardElementHint');
    }
  });

  it('dominantElement match catalog element (legacy fallback)', () => {
    const combat = makeListOnlyCombat();
    const list = combat.listDungeons();
    for (const d of list) {
      const expected = (d.dominantElement ?? d.element ?? null) as
        | ElementKey
        | null;
      expect(d.elementProfile.dominantElement).toBe(expected);
    }
  });

  it('recommendedCounterElement đúng quan hệ counter của dominant', () => {
    const combat = makeListOnlyCombat();
    const list = combat.listDungeons();
    for (const d of list) {
      const dom = d.elementProfile.dominantElement;
      const rec = d.elementProfile.recommendedCounterElement;
      if (dom && rec) {
        expect(elementOvercomes(rec)).toBe(dom);
      }
      if (!dom) {
        // dungeon vô hệ → recommendedCounter null (default).
        expect(rec).toBeNull();
      }
    }
  });

  it('mỗi element có ≥ 1 dungeon dominant trong response', () => {
    const combat = makeListOnlyCombat();
    const list = combat.listDungeons();
    for (const el of ELEMENTS) {
      const dungeons = list.filter(
        (d) => d.elementProfile.dominantElement === el,
      );
      expect(
        dungeons.length,
        `element ${el} cần ≥ 1 dungeon trong API response`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('no-double-multiplier: response KHÔNG include multiplier numeric', () => {
    const combat = makeListOnlyCombat();
    const list = combat.listDungeons();
    for (const d of list) {
      // FE phải compute multiplier qua spiritual-root.elementMultiplier()
      // hoặc describeElementMatch — KHÔNG nhận từ API.
      expect(d.elementProfile).not.toHaveProperty('counterMultiplier');
      expect(d.elementProfile).not.toHaveProperty('weaknessMultiplier');
      expect(d.elementProfile).not.toHaveProperty('elementBonus');
    }
  });
});
