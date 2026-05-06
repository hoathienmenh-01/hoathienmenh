import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BuffDef } from '@xuantoi/shared';

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (k: string) => k,
    },
  },
}));

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: getMock,
  },
}));

import { getActiveBuffs } from '@/api/buffs';

const STUB_DEF: BuffDef = {
  key: 'pill_atk_buff_t1',
  name: 'Cương Lực Đan Ấn',
  description: 'Sau khi uống Cương Lực Đan, công kích +12% trong 60 giây.',
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

describe('api/buffs — Phase 11.8.D client', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('getActiveBuffs: GET /character/buffs → ActiveBuffRow[]', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          active: [
            {
              buffKey: 'pill_atk_buff_t1',
              stacks: 1,
              source: 'pill',
              expiresAt: '2026-05-06T22:00:00.000Z',
              def: STUB_DEF,
            },
          ],
        },
      },
    });
    const out = await getActiveBuffs();
    expect(getMock).toHaveBeenCalledWith('/character/buffs');
    expect(out).toHaveLength(1);
    expect(out[0].buffKey).toBe('pill_atk_buff_t1');
    expect(out[0].def.polarity).toBe('buff');
    expect(out[0].expiresAt).toBe('2026-05-06T22:00:00.000Z');
  });

  it('getActiveBuffs: empty data → throws fallback error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(getActiveBuffs()).rejects.toBeInstanceOf(Error);
  });

  it('getActiveBuffs: server error envelope → throws preserving code', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'NO_CHARACTER', message: 'x' } },
    });
    await expect(getActiveBuffs()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });
});
