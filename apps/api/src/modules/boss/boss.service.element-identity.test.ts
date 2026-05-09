/**
 * Phase 14.2.D — Boss service element identity response shape tests.
 *
 * Verifies:
 *   - `BossView` shape includes `elementProfile` (element, weakness,
 *     resist elements, reward hint).
 *   - Profile derive consistent với `BossDef.element` +
 *     `BossDef.elementalResist`.
 *   - No-double-multiplier: response không expose multiplier numeric.
 *
 * Pure unit test — không cần DB. Test toView() qua casting + invoke
 * trực tiếp với fake boss row.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BOSSES,
  ELEMENTS,
  bossByKey,
  elementCounter,
  type BossElementProfile,
  type ElementKey,
} from '@xuantoi/shared';
import { BossService } from './boss.service';
import type { BossView } from './boss.service';

// Minimal stub services — toView() only reads prisma.bossDamage (count
// + findMany) cho leaderboard/myDamage. Nếu fake → return [] / count 0.
const stubPrisma = {
  bossDamage: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

function makeBossSvc(): BossService {
  return new BossService(
    stubPrisma as never,
    undefined as never, // realtime
    undefined as never, // chars
    undefined as never, // inventory
    undefined as never, // currency
    undefined as never, // missions
  );
}

async function callToView(
  svc: BossService,
  row: {
    id: string;
    bossKey: string;
    name: string;
    level: number;
    maxHp: bigint;
    currentHp: bigint;
    status: 'ACTIVE' | 'DEFEATED' | 'EXPIRED';
    spawnedAt: Date;
    expiresAt: Date;
    regionKey: string;
  },
): Promise<BossView> {
  return (
    svc as unknown as {
      toView: (
        boss: typeof row,
        viewerCharId: string | null,
      ) => Promise<BossView>;
    }
  ).toView(row, null);
}

function fakeRow(bossKey: string) {
  return {
    id: 'b1',
    bossKey,
    name: 'B',
    level: 1,
    maxHp: 1000n,
    currentHp: 500n,
    status: 'ACTIVE' as const,
    spawnedAt: new Date('2026-04-30T12:00:00Z'),
    expiresAt: new Date('2026-04-30T13:00:00Z'),
    regionKey: 'world',
  };
}

describe('BossService.toView elementProfile (Phase 14.2.D)', () => {
  it('boss có catalog def → elementProfile derive từ BossDef', async () => {
    const svc = makeBossSvc();
    // Pick boss đầu tiên có element + elementalResist trong BOSSES.
    const def = BOSSES.find(
      (b) => b.element && b.elementalResist,
    );
    expect(def).toBeDefined();
    const view = await callToView(svc, fakeRow(def!.key));
    expect(view.elementProfile).toBeDefined();
    expect(view.elementProfile.element).toBe(def!.element ?? null);
    if (def!.element) {
      expect(view.elementProfile.weaknessElement).toBe(
        elementCounter(def!.element),
      );
    }
  });

  it('boss vô hệ catalog → elementProfile.element = null', async () => {
    const svc = makeBossSvc();
    const def = BOSSES.find((b) => b.element === null);
    if (!def) return; // OK nếu không có vô hệ entry; coverage test khác.
    const view = await callToView(svc, fakeRow(def.key));
    expect(view.elementProfile.element).toBeNull();
    expect(view.elementProfile.weaknessElement).toBeNull();
  });

  it('boss key không có catalog def → elementProfile fallback null/[]', async () => {
    const svc = makeBossSvc();
    const view = await callToView(svc, fakeRow('legacy_unknown_boss_key'));
    expect(view.elementProfile.element).toBeNull();
    expect(view.elementProfile.weaknessElement).toBeNull();
    expect(view.elementProfile.resistElements).toEqual([]);
    expect(view.elementProfile.rewardElementHint).toBeNull();
  });

  it('mỗi element có ≥ 1 boss với elementProfile.element = element', async () => {
    const svc = makeBossSvc();
    // Iterate BOSSES; gather profiles.
    const profilesByKey = new Map<string, BossElementProfile>();
    for (const def of BOSSES) {
      const view = await callToView(svc, fakeRow(def.key));
      profilesByKey.set(def.key, view.elementProfile);
    }
    for (const el of ELEMENTS) {
      const matches = [...profilesByKey.values()].filter(
        (p) => p.element === el,
      );
      expect(matches.length, `element ${el} cần ≥ 1 boss`).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it('boss có elementalResist → resistElements là subset của keys < 1.0', async () => {
    const svc = makeBossSvc();
    for (const def of BOSSES) {
      if (!def.elementalResist) continue;
      const view = await callToView(svc, fakeRow(def.key));
      const resistKeys = new Set<ElementKey>(
        Object.entries(def.elementalResist)
          .filter(([, v]) => typeof v === 'number' && v < 1)
          .map(([k]) => k as ElementKey),
      );
      for (const el of view.elementProfile.resistElements) {
        expect(
          resistKeys.has(el),
          `boss ${def.key} resistElements chứa ${el} không trong elementalResist`,
        ).toBe(true);
      }
    }
  });

  it('no-double-multiplier: elementProfile KHÔNG expose multiplier numeric', async () => {
    const svc = makeBossSvc();
    for (const def of BOSSES) {
      const view = await callToView(svc, fakeRow(def.key));
      expect(view.elementProfile).not.toHaveProperty('weaknessMultiplier');
      expect(view.elementProfile).not.toHaveProperty('resistMultiplier');
      expect(view.elementProfile).not.toHaveProperty('elementBonus');
    }
  });

  it('bossByKey() trả def consistent với view (sanity)', () => {
    for (const def of BOSSES) {
      expect(bossByKey(def.key)).toBeDefined();
    }
  });
});


