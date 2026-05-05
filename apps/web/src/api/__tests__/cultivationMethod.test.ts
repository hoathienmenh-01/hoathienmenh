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
  getCultivationMethodState,
  equipCultivationMethod,
} from '@/api/cultivationMethod';

const STUB_LEARNED_ROW = {
  methodKey: 'khai_thien_quyet',
  source: 'starter',
  learnedAt: '2026-01-01T00:00:00.000Z',
};

describe('api/cultivationMethod — Phase 11.1.C client', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('getCultivationMethodState: GET /character/cultivation-method, parse envelope', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          cultivationMethod: {
            equippedMethodKey: 'khai_thien_quyet',
            equippedMethodElementAffinity: 0.1,
            learned: [STUB_LEARNED_ROW],
          },
        },
      },
    });
    const out = await getCultivationMethodState();
    expect(getMock).toHaveBeenCalledWith('/character/cultivation-method');
    expect(out.equippedMethodKey).toBe('khai_thien_quyet');
    expect(out.equippedMethodElementAffinity).toBe(0.1);
    expect(out.learned).toHaveLength(1);
    expect(out.learned[0].methodKey).toBe('khai_thien_quyet');
    expect(out.learned[0].source).toBe('starter');
  });

  it('getCultivationMethodState: legacy server (no equippedMethodElementAffinity field) → default 0', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          cultivationMethod: {
            equippedMethodKey: 'khai_thien_quyet',
            learned: [STUB_LEARNED_ROW],
          },
        },
      },
    });
    const out = await getCultivationMethodState();
    expect(out.equippedMethodElementAffinity).toBe(0);
  });

  it('equipCultivationMethod: server returns equippedMethodElementAffinity → forwarded', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          cultivationMethod: {
            equippedMethodKey: 'liet_hoa_phap',
            equippedMethodElementAffinity: 0.05,
            learned: [STUB_LEARNED_ROW],
          },
        },
      },
    });
    const out = await equipCultivationMethod('liet_hoa_phap');
    expect(out.equippedMethodElementAffinity).toBe(0.05);
  });

  it('getCultivationMethodState: server error envelope → throws error object preserving code', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NO_CHARACTER', message: 'no char' },
      },
    });
    await expect(getCultivationMethodState()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });

  it('getCultivationMethodState: empty data → throws fallback error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(getCultivationMethodState()).rejects.toBeInstanceOf(Error);
  });

  it('equipCultivationMethod: POST /character/cultivation-method/equip body { methodKey }', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          cultivationMethod: {
            equippedMethodKey: 'cuu_cuc_kim_cuong_quyet',
            learned: [
              STUB_LEARNED_ROW,
              {
                methodKey: 'cuu_cuc_kim_cuong_quyet',
                source: 'sect_shop',
                learnedAt: '2026-02-01T00:00:00.000Z',
              },
            ],
          },
        },
      },
    });
    const out = await equipCultivationMethod('cuu_cuc_kim_cuong_quyet');
    expect(postMock).toHaveBeenCalledWith(
      '/character/cultivation-method/equip',
      { methodKey: 'cuu_cuc_kim_cuong_quyet' },
    );
    expect(out.equippedMethodKey).toBe('cuu_cuc_kim_cuong_quyet');
    expect(out.learned).toHaveLength(2);
  });

  it('equipCultivationMethod: ok=false → throws error object preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NOT_LEARNED', message: 'method not learned' },
      },
    });
    await expect(
      equipCultivationMethod('cuu_cuc_kim_cuong_quyet'),
    ).rejects.toMatchObject({
      code: 'NOT_LEARNED',
    });
  });

  it('equipCultivationMethod: empty data → throws fallback error', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(
      equipCultivationMethod('cuu_cuc_kim_cuong_quyet'),
    ).rejects.toBeInstanceOf(Error);
  });
});
