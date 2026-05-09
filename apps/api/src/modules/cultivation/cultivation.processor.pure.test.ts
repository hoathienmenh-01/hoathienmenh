/**
 * Pure unit tests for CultivationProcessor — no DB, no Redis.
 * Mocks PrismaService, RealtimeService, MissionService.
 * Covers logic branches not tested by the integration test file:
 *   - job.name guard (skip non-tick)
 *   - empty cultivating list (early return)
 *   - mission.track failure isolation (warn log, EXP still granted)
 *   - realtime.emitToUser call shape (CultivateTickPayload)
 *   - per-character error isolation (one fail doesn't break batch)
 *   - stamina regen SQL call
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CULTIVATION_TICK_BASE_EXP,
  CULTIVATION_TICK_MS,
  STAMINA_REGEN_PER_TICK,
  cultivationRateForRealm,
  expCostForStage,
} from '@xuantoi/shared';
import { CultivationProcessor } from './cultivation.processor';

function makeChar(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-1',
    userId: 'user-1',
    realmKey: 'luyenkhi',
    realmStage: 1,
    exp: 0n,
    spirit: 8,
    ...overrides,
  };
}

function makeDeps() {
  // Mock prisma — `$transaction(cb)` invokes cb with cùng prisma mock
  // làm tx (CultivationProcessor wrap cap+CAS update trong tx).
  const prisma = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    character: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(prisma),
    ),
  };
  const realtime = {
    emitToUser: vi.fn(),
  };
  const missions = {
    track: vi.fn().mockResolvedValue(undefined),
  };
  // Mock applyCapTx — pass-through (grantedExp = requestedExp). Cho phép
  // pure test exercise đầy đủ EXP/realmStage logic mà không cần DB.
  const rewardCap = {
    applyCapTx: vi
      .fn()
      .mockImplementation(
        async (
          _tx: unknown,
          input: { requestedExp: bigint; requestedLinhThach: bigint },
        ) => ({
          grantedExp: input.requestedExp,
          grantedLinhThach: input.requestedLinhThach,
          cappedExp: 0n,
          cappedLinhThach: 0n,
          wasCapped: false,
          remainingExp: 999999n,
          remainingLinhThach: 999999n,
          dayBucket: '2026-01-01',
        }),
      ),
  };
  const processor = new CultivationProcessor(
    prisma as never,
    realtime as never,
    missions as never,
    rewardCap as never,
  );
  return { prisma, realtime, missions, rewardCap, processor };
}

function tickJob() {
  return { name: 'tick' } as Parameters<CultivationProcessor['process']>[0];
}

describe('CultivationProcessor pure unit', () => {
  it('skip when job.name !== "tick"', async () => {
    const { prisma, processor } = makeDeps();
    await processor.process({ name: 'other' } as never);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.character.findMany).not.toHaveBeenCalled();
  });

  it('stamina regen SQL runs with STAMINA_REGEN_PER_TICK', async () => {
    const { prisma, processor } = makeDeps();
    await processor.process(tickJob());
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "Character" SET stamina'),
      STAMINA_REGEN_PER_TICK,
    );
  });

  it('early return when no cultivating characters', async () => {
    const { prisma, realtime, processor } = makeDeps();
    prisma.character.findMany.mockResolvedValue([]);
    await processor.process(tickJob());
    expect(prisma.character.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('grants EXP and emits cultivate:tick payload', async () => {
    const { prisma, realtime, processor } = makeDeps();
    const c = makeChar();
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    const expectedGain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) +
        Math.floor(8 / 4),
    );
    expect(prisma.character.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'char-1',
        exp: 0n,
        realmStage: 1,
        cultivating: true,
      },
      data: { exp: expectedGain, realmStage: 1 },
    });

    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'cultivate:tick',
      expect.objectContaining({
        characterId: 'char-1',
        expGained: expectedGain.toString(),
        realmKey: 'luyenkhi',
        realmStage: 1,
        brokeThrough: false,
      }),
    );
  });

  it('auto-breakthrough increments realmStage when exp >= cap (stage < 9)', async () => {
    const { prisma, realtime, processor } = makeDeps();
    const cap1 = expCostForStage('luyenkhi', 1)!;
    const c = makeChar({ exp: cap1 - 1n, realmStage: 1 });
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    const gain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) +
        Math.floor(8 / 4),
    );
    const expectedExp = cap1 - 1n + gain - cap1;
    expect(prisma.character.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'char-1',
        exp: cap1 - 1n,
        realmStage: 1,
        cultivating: true,
      },
      data: { exp: expectedExp, realmStage: 2 },
    });

    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'cultivate:tick',
      expect.objectContaining({
        realmStage: 2,
        brokeThrough: true,
      }),
    );
  });

  it('does NOT auto-breakthrough at stage 9 (manual breakthrough required)', async () => {
    const { prisma, processor } = makeDeps();
    const cap9 = expCostForStage('luyenkhi', 9)!;
    const c = makeChar({ exp: cap9 - 1n, realmStage: 9 });
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    const gain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) +
        Math.floor(8 / 4),
    );
    expect(prisma.character.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'char-1',
        exp: cap9 - 1n,
        realmStage: 9,
        cultivating: true,
      },
      data: { exp: cap9 - 1n + gain, realmStage: 9 },
    });
  });

  it('mission.track failure does NOT block EXP grant (isolation)', async () => {
    const { prisma, missions, realtime, processor } = makeDeps();
    const c = makeChar();
    prisma.character.findMany.mockResolvedValue([c]);
    missions.track.mockRejectedValue(new Error('mission DB down'));

    await processor.process(tickJob());

    // EXP still updated despite mission failure
    expect(prisma.character.updateMany).toHaveBeenCalled();
    // Payload still emitted
    expect(realtime.emitToUser).toHaveBeenCalled();
  });

  it('mission.track called with CULTIVATE_SECONDS + GAIN_EXP (no BREAKTHROUGH when no stage change)', async () => {
    const { missions, processor, prisma } = makeDeps();
    const c = makeChar();
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    const gain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) +
        Math.floor(8 / 4),
    );
    expect(missions.track).toHaveBeenCalledWith(
      'char-1',
      'CULTIVATE_SECONDS',
      Math.round(CULTIVATION_TICK_MS / 1000),
    );
    expect(missions.track).toHaveBeenCalledWith(
      'char-1',
      'GAIN_EXP',
      Number(gain),
    );
    // No BREAKTHROUGH call when stage doesn't change
    expect(missions.track).not.toHaveBeenCalledWith(
      'char-1',
      'BREAKTHROUGH',
      expect.anything(),
    );
  });

  it('mission.track called with BREAKTHROUGH when stage changes', async () => {
    const { missions, processor, prisma } = makeDeps();
    const cap1 = expCostForStage('luyenkhi', 1)!;
    const c = makeChar({ exp: cap1 - 1n, realmStage: 1 });
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    expect(missions.track).toHaveBeenCalledWith('char-1', 'BREAKTHROUGH', 1);
  });

  it('per-character error isolation: one character failing does not block others', async () => {
    const { prisma, realtime, processor } = makeDeps();
    const c1 = makeChar({ id: 'char-1', userId: 'user-1' });
    const c2 = makeChar({ id: 'char-2', userId: 'user-2' });
    prisma.character.findMany.mockResolvedValue([c1, c2]);
    prisma.character.updateMany
      .mockRejectedValueOnce(new Error('DB error for char-1'))
      .mockResolvedValueOnce({ count: 1 });

    await processor.process(tickJob());

    // char-2 still gets its tick emitted even though char-1 failed
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'user-2',
      'cultivate:tick',
      expect.objectContaining({ characterId: 'char-2' }),
    );
  });

  it('CultivateTickPayload shape: all required fields present and typed correctly', async () => {
    const { prisma, realtime, processor } = makeDeps();
    const c = makeChar();
    prisma.character.findMany.mockResolvedValue([c]);

    await processor.process(tickJob());

    const payload = realtime.emitToUser.mock.calls[0]?.[2];
    expect(payload).toEqual(
      expect.objectContaining({
        characterId: expect.any(String),
        expGained: expect.any(String),
        exp: expect.any(String),
        expNext: expect.any(String),
        realmKey: expect.any(String),
        realmStage: expect.any(Number),
        brokeThrough: expect.any(Boolean),
      }),
    );
    // Verify BigInt values are serialized as strings (not numbers)
    expect(typeof payload.expGained).toBe('string');
    expect(typeof payload.exp).toBe('string');
    expect(typeof payload.expNext).toBe('string');
  });
});
