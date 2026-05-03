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

import { getTalentsState, learnTalent } from '@/api/talents';

describe('api/talents — Phase 11.X.AT client', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('getTalentsState: GET /character/talents/state, parse envelope', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          talents: {
            learned: [
              {
                talentKey: 'talent_a',
                learnedAt: '2024-01-01T00:00:00Z',
                cooldownTurnsRemaining: 0,
              },
            ],
            spent: 1,
            remaining: 4,
            budget: 5,
          },
        },
      },
    });
    const out = await getTalentsState();
    expect(getMock).toHaveBeenCalledWith('/character/talents/state');
    expect(out.learned).toHaveLength(1);
    expect(out.learned[0].cooldownTurnsRemaining).toBe(0);
    expect(out.spent).toBe(1);
    expect(out.remaining).toBe(4);
    expect(out.budget).toBe(5);
  });

  it('Phase 11.7.E++ — getTalentsState parse cooldownTurnsRemaining > 0 cho active talent', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          talents: {
            learned: [
              {
                talentKey: 'active_dragon',
                learnedAt: '2024-01-01T00:00:00Z',
                cooldownTurnsRemaining: 3,
              },
            ],
            spent: 2,
            remaining: 0,
            budget: 2,
          },
        },
      },
    });
    const out = await getTalentsState();
    expect(out.learned[0].cooldownTurnsRemaining).toBe(3);
  });

  it('getTalentsState: server error envelope → throws error object', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NO_CHARACTER', message: 'no char' },
      },
    });
    await expect(getTalentsState()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });

  it('getTalentsState: empty data → throws fallback error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(getTalentsState()).rejects.toBeInstanceOf(Error);
  });

  it('learnTalent: POST /character/talents/learn body { talentKey }', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          learn: {
            talentKey: 'talent_a',
            learnedAt: '2024-01-01T00:00:00Z',
          },
          remaining: 4,
        },
      },
    });
    const out = await learnTalent('talent_a');
    expect(postMock).toHaveBeenCalledWith('/character/talents/learn', {
      talentKey: 'talent_a',
    });
    expect(out.learn.talentKey).toBe('talent_a');
    expect(out.remaining).toBe(4);
  });

  it('learnTalent: ok=false → throws error object preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'ALREADY_LEARNED', message: 'dup' },
      },
    });
    await expect(learnTalent('talent_a')).rejects.toMatchObject({
      code: 'ALREADY_LEARNED',
    });
  });
});
