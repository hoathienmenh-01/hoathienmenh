import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (k: string) => k,
    },
  },
}));

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
  },
}));

import {
  getSkillState,
  equipSkill,
  unequipSkill,
  upgradeSkillMastery,
  learnSkillFromBook,
  type SkillState,
} from '@/api/skill';

const STUB_STATE: SkillState = {
  maxEquipped: 4,
  learned: [
    {
      skillKey: 'basic_attack',
      tier: 'basic',
      masteryLevel: 1,
      maxMastery: 5,
      isEquipped: true,
      source: 'starter',
      learnedAt: '2026-05-03T17:00:00.000Z',
      effective: { atkScale: 1, mpCost: 0, cooldownTurns: 0 },
      nextLevelLinhThachCost: 100,
      nextLevelShardCost: 0,
    },
  ],
};

describe('api/skill — Phase 11.2.C client', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('getSkillState: GET /character/skill, parse envelope', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { skill: STUB_STATE } },
    });
    const out = await getSkillState();
    expect(getMock).toHaveBeenCalledWith('/character/skill');
    expect(out).toEqual(STUB_STATE);
  });

  it('getSkillState: ok=false → throws preserving code', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'NO_CHARACTER', message: 'no' } },
    });
    await expect(getSkillState()).rejects.toMatchObject({ code: 'NO_CHARACTER' });
  });

  it('getSkillState: empty data → throws fallback error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(getSkillState()).rejects.toBeInstanceOf(Error);
  });

  it('equipSkill: POST /character/skill/equip with body', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { skill: STUB_STATE } },
    });
    const out = await equipSkill('kiem_khi_chem');
    expect(postMock).toHaveBeenCalledWith('/character/skill/equip', {
      skillKey: 'kiem_khi_chem',
    });
    expect(out).toEqual(STUB_STATE);
  });

  it('equipSkill: ok=false TOO_MANY_EQUIPPED → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'TOO_MANY_EQUIPPED', message: 'cap reached' },
      },
    });
    await expect(equipSkill('kiem_khi_chem')).rejects.toMatchObject({
      code: 'TOO_MANY_EQUIPPED',
    });
  });

  it('unequipSkill: POST /character/skill/unequip with body', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { skill: STUB_STATE } },
    });
    const out = await unequipSkill('kiem_khi_chem');
    expect(postMock).toHaveBeenCalledWith('/character/skill/unequip', {
      skillKey: 'kiem_khi_chem',
    });
    expect(out.maxEquipped).toBe(4);
  });

  it('upgradeSkillMastery: POST /character/skill/upgrade-mastery returns upgrade detail', async () => {
    const upgrade = {
      skillKey: 'kiem_khi_chem',
      previousLevel: 1,
      newLevel: 2,
      linhThachSpent: 200,
      shardSpent: 0,
    };
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { upgrade } },
    });
    const out = await upgradeSkillMastery('kiem_khi_chem');
    expect(postMock).toHaveBeenCalledWith('/character/skill/upgrade-mastery', {
      skillKey: 'kiem_khi_chem',
    });
    expect(out).toEqual(upgrade);
  });

  it('upgradeSkillMastery: INSUFFICIENT_FUNDS → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', message: 'no LT' },
      },
    });
    await expect(upgradeSkillMastery('kiem_khi_chem')).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('learnSkillFromBook: POST /character/skill/learn-from-book with inventoryItemId, parse envelope', async () => {
    const learn = {
      skillKey: 'kim_quang_tram',
      consumedItemKey: 'skill_book_kim_quang_tram',
      state: STUB_STATE,
    };
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { learn } },
    });
    const out = await learnSkillFromBook('inv-1');
    expect(postMock).toHaveBeenCalledWith('/character/skill/learn-from-book', {
      inventoryItemId: 'inv-1',
    });
    expect(out).toEqual(learn);
  });

  it('learnSkillFromBook: ALREADY_LEARNED → throws preserving code (idempotent retry safe)', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'ALREADY_LEARNED', message: 'already' },
      },
    });
    await expect(learnSkillFromBook('inv-1')).rejects.toMatchObject({
      code: 'ALREADY_LEARNED',
    });
  });

  it('learnSkillFromBook: REALM_TOO_LOW → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'REALM_TOO_LOW', message: 'too low' },
      },
    });
    await expect(learnSkillFromBook('inv-1')).rejects.toMatchObject({
      code: 'REALM_TOO_LOW',
    });
  });

  it('learnSkillFromBook: NOT_SKILL_BOOK → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NOT_SKILL_BOOK', message: 'wrong kind' },
      },
    });
    await expect(learnSkillFromBook('inv-1')).rejects.toMatchObject({
      code: 'NOT_SKILL_BOOK',
    });
  });

  it('learnSkillFromBook: empty data → throws fallback error', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(learnSkillFromBook('inv-1')).rejects.toBeInstanceOf(Error);
  });
});
