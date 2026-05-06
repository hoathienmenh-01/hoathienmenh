import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { BuffDef } from '@xuantoi/shared';

vi.mock('@/api/buffs', () => ({
  getActiveBuffs: vi.fn(),
}));

import * as api from '@/api/buffs';
import { useBuffsStore } from '@/stores/buffs';

const mockedGet = vi.mocked(api.getActiveBuffs);

const BUFF_DEF: BuffDef = {
  key: 'pill_atk_buff_t1',
  name: 'Cương Lực Đan Ấn',
  description: 'desc',
  polarity: 'buff',
  element: null,
  source: 'pill',
  durationSec: 60,
  stackable: false,
  maxStacks: 1,
  dispellable: true,
  effects: [
    {
      kind: 'stat_mod',
      value: 1.12,
      statTarget: 'atk',
      elementTarget: null,
    },
  ],
};

const DEBUFF_DEF: BuffDef = {
  ...BUFF_DEF,
  key: 'boss_dot_thuy',
  name: 'Hàn Băng',
  polarity: 'debuff',
  source: 'boss_skill',
};

describe('useBuffsStore — Phase 11.8.D', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: empty + not loaded', () => {
    const s = useBuffsStore();
    expect(s.active).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.lastFetchAt).toBeNull();
    expect(s.totalCount).toBe(0);
    expect(s.buffCount).toBe(0);
    expect(s.debuffCount).toBe(0);
  });

  it('fetchState: hydrate active + loaded=true + lastFetchAt set', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T22:00:00.000Z',
        def: BUFF_DEF,
      },
    ]);
    const s = useBuffsStore();
    await s.fetchState();
    expect(s.loaded).toBe(true);
    expect(s.active).toHaveLength(1);
    expect(s.lastFetchAt).not.toBeNull();
  });

  it('buffCount / debuffCount split theo polarity', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T22:00:00.000Z',
        def: BUFF_DEF,
      },
      {
        buffKey: 'boss_dot_thuy',
        stacks: 2,
        source: 'boss_skill',
        expiresAt: '2026-05-06T22:01:00.000Z',
        def: DEBUFF_DEF,
      },
    ]);
    const s = useBuffsStore();
    await s.fetchState();
    expect(s.totalCount).toBe(2);
    expect(s.buffCount).toBe(1);
    expect(s.debuffCount).toBe(1);
    expect(s.activeKeys.has('pill_atk_buff_t1')).toBe(true);
    expect(s.activeKeys.has('boss_dot_thuy')).toBe(true);
  });

  it('reset: clear toàn bộ', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T22:00:00.000Z',
        def: BUFF_DEF,
      },
    ]);
    const s = useBuffsStore();
    await s.fetchState();
    s.reset();
    expect(s.active).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.lastFetchAt).toBeNull();
  });
});
