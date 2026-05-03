import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/talents', () => ({
  getTalentsState: vi.fn(),
  learnTalent: vi.fn(),
}));

import * as api from '@/api/talents';
import { useTalentsStore } from '@/stores/talents';

const mockedGet = vi.mocked(api.getTalentsState);
const mockedLearn = vi.mocked(api.learnTalent);

describe('useTalentsStore — Phase 11.X.AT', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: empty learned + zero counts + not loaded', () => {
    const s = useTalentsStore();
    expect(s.learned.size).toBe(0);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.budget).toBe(0);
    expect(s.loaded).toBe(false);
    expect(s.inFlight.size).toBe(0);
  });

  it('fetchState: hydrate learned Map + spent + remaining + budget + loaded=true', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [
        {
          talentKey: 'talent_a',
          learnedAt: '2024-01-01T00:00:00Z',
          cooldownTurnsRemaining: 0,
        },
        {
          talentKey: 'talent_b',
          learnedAt: '2024-01-02T00:00:00Z',
          cooldownTurnsRemaining: 0,
        },
      ],
      spent: 3,
      remaining: 2,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    expect(s.learned.size).toBe(2);
    expect(s.learned.get('talent_a')).toBe('2024-01-01T00:00:00Z');
    expect(s.spent).toBe(3);
    expect(s.remaining).toBe(2);
    expect(s.budget).toBe(5);
    expect(s.loaded).toBe(true);
  });

  it('Phase 11.7.E++ — fetchState hydrate cooldowns Map per learned row', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [
        {
          talentKey: 'passive_a',
          learnedAt: '2024-01-01T00:00:00Z',
          cooldownTurnsRemaining: 0,
        },
        {
          talentKey: 'active_b',
          learnedAt: '2024-01-02T00:00:00Z',
          cooldownTurnsRemaining: 4,
        },
      ],
      spent: 3,
      remaining: 2,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    expect(s.cooldowns.size).toBe(2);
    expect(s.cooldownOf('passive_a')).toBe(0);
    expect(s.cooldownOf('active_b')).toBe(4);
    // Talent chưa học → cooldown 0 (default).
    expect(s.cooldownOf('not_learned')).toBe(0);
  });

  it('isLearned getter: trả true cho talent đã học, false cho chưa', async () => {
    mockedGet.mockResolvedValueOnce({
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
    });
    const s = useTalentsStore();
    await s.fetchState();
    expect(s.isLearned('talent_a')).toBe(true);
    expect(s.isLearned('talent_b')).toBe(false);
  });

  it('learn success: thêm vào learned + update remaining + spent recompute từ budget', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [],
      spent: 0,
      remaining: 5,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    mockedLearn.mockResolvedValueOnce({
      learn: { talentKey: 'talent_a', learnedAt: '2024-01-01T00:00:00Z' },
      remaining: 4,
    });
    const err = await s.learn('talent_a');
    expect(err).toBeNull();
    expect(s.learned.has('talent_a')).toBe(true);
    expect(s.learned.get('talent_a')).toBe('2024-01-01T00:00:00Z');
    expect(s.remaining).toBe(4);
    // budget=5, remaining=4 → spent = 1.
    expect(s.spent).toBe(1);
    expect(s.inFlight.has('talent_a')).toBe(false);
    // Phase 11.7.E++ — talent vừa học cooldown=0.
    expect(s.cooldownOf('talent_a')).toBe(0);
  });

  it('learn server error code: trả về code, không update learned', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [],
      spent: 0,
      remaining: 5,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    mockedLearn.mockRejectedValueOnce({ code: 'ALREADY_LEARNED' });
    const err = await s.learn('talent_a');
    expect(err).toBe('ALREADY_LEARNED');
    expect(s.learned.has('talent_a')).toBe(false);
    expect(s.inFlight.has('talent_a')).toBe(false);
  });

  it('learn nested error.code: extract đúng (axios envelope shape)', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [],
      spent: 0,
      remaining: 5,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    mockedLearn.mockRejectedValueOnce({
      error: { code: 'REALM_TOO_LOW', message: 'realm too low' },
    });
    const err = await s.learn('talent_a');
    expect(err).toBe('REALM_TOO_LOW');
  });

  it('learn unknown error: trả "UNKNOWN"', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [],
      spent: 0,
      remaining: 5,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    mockedLearn.mockRejectedValueOnce(new Error('boom'));
    const err = await s.learn('talent_a');
    expect(err).toBe('UNKNOWN');
  });

  it('learn double-call same key → second returns IN_FLIGHT (race protect)', async () => {
    const s = useTalentsStore();
    let resolveFn!: (v: { learn: { talentKey: string; learnedAt: string }; remaining: number }) => void;
    mockedLearn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p1 = s.learn('talent_a');
    const r2 = await s.learn('talent_a');
    expect(r2).toBe('IN_FLIGHT');
    resolveFn({
      learn: { talentKey: 'talent_a', learnedAt: '2024-01-01T00:00:00Z' },
      remaining: 0,
    });
    await p1;
  });

  it('isLearning reflect inFlight set during pending learn', async () => {
    const s = useTalentsStore();
    let resolveFn!: (v: { learn: { talentKey: string; learnedAt: string }; remaining: number }) => void;
    mockedLearn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p = s.learn('talent_a');
    expect(s.isLearning('talent_a')).toBe(true);
    expect(s.isLearning('talent_b')).toBe(false);
    resolveFn({
      learn: { talentKey: 'talent_a', learnedAt: '2024-01-01T00:00:00Z' },
      remaining: 0,
    });
    await p;
    expect(s.isLearning('talent_a')).toBe(false);
  });

  it('reset: xoá learned + spent + remaining + budget + loaded', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [
        {
          talentKey: 'talent_a',
          learnedAt: '2024-01-01T00:00:00Z',
          cooldownTurnsRemaining: 3,
        },
      ],
      spent: 1,
      remaining: 4,
      budget: 5,
    });
    const s = useTalentsStore();
    await s.fetchState();
    expect(s.loaded).toBe(true);
    expect(s.cooldowns.size).toBe(1);
    s.reset();
    expect(s.learned.size).toBe(0);
    expect(s.cooldowns.size).toBe(0);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.budget).toBe(0);
    expect(s.loaded).toBe(false);
  });

  it('learn không update spent âm khi remaining > budget (defensive)', async () => {
    mockedGet.mockResolvedValueOnce({
      learned: [],
      spent: 0,
      remaining: 0,
      budget: 0,
    });
    const s = useTalentsStore();
    await s.fetchState();
    mockedLearn.mockResolvedValueOnce({
      learn: { talentKey: 'talent_a', learnedAt: '2024-01-01T00:00:00Z' },
      remaining: 5,
    });
    await s.learn('talent_a');
    // budget=0, remaining=5 → spent = max(0, 0-5) = 0.
    expect(s.spent).toBe(0);
  });
});
