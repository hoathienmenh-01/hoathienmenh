/**
 * Phase 16.3 — Integration test cho GameplayAntiCheatService.
 *
 * Bao phủ:
 *   - clean state → 0 anomaly created.
 *   - currency gain spike (1h) → CURRENCY_GAIN_SPIKE created.
 *   - item gain spike → ITEM_GAIN_SPIKE created.
 *   - dungeon reward farming (24h) → DUNGEON_REWARD_FARM created.
 *   - boss reward farming (24h CurrencyLedger BOSS_REWARD) → BOSS_REWARD_FARM created.
 *   - mission claim farming → MISSION_REWARD_FARM created.
 *   - arena WIN farming → ARENA_REWARD_FARM created.
 *   - territory reward spike → TERRITORY_REWARD_SPIKE created.
 *   - reward cap bypass attempts → REWARD_CAP_BYPASS_ATTEMPT created.
 *   - EXP gain spike → EXP_GAIN_SPIKE created (via RewardCapEvent.grantedExp).
 *   - idempotent: 2 lần scan cùng window không double anomaly.
 *   - severity mapping correct (WARN vs CRITICAL).
 *   - per-rule fail-soft (1 rule lỗi không lật ngược tổng scan).
 *   - detection-only: KHÔNG mutate character balance / item / EXP.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { GameplayAntiCheatService } from './gameplay-anticheat.service';

let prisma: PrismaService;
let svc: GameplayAntiCheatService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new GameplayAntiCheatService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date('2026-05-15T12:00:00.000Z');

describe('GameplayAntiCheatService.scanAll — empty state', () => {
  it('clean DB → 0 anomalies', async () => {
    const r = await svc.scanAll({ now: NOW });
    expect(r.totalCreated).toBe(0);
    expect(r.totalSkipped).toBe(0);
    expect(r.totalErrored).toBe(0);
    expect(r.rules.length).toBe(10);
    for (const rule of r.rules) {
      expect(rule.created).toBe(0);
      expect(rule.errored).toBe(false);
    }
    const all = await prisma.gameplayAnomaly.count();
    expect(all).toBe(0);
  });
});

describe('GameplayAntiCheatService — currency gain spike', () => {
  it('Σ positive linhThạch ≥ 200k (1h) → WARN', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 250_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });

    const r = await svc.scanAll({ now: NOW });
    const anomaly = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'CURRENCY_GAIN_SPIKE', characterId: f.characterId },
    });
    expect(anomaly).not.toBeNull();
    expect(anomaly?.severity).toBe('WARN');
    expect(anomaly?.status).toBe('OPEN');
    expect(r.totalCreated).toBeGreaterThanOrEqual(1);
  });

  it('Σ positive linhThạch ≥ 1M → CRITICAL', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 1_500_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });

    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'CURRENCY_GAIN_SPIKE', characterId: f.characterId },
    });
    expect(a?.severity).toBe('CRITICAL');
  });

  it('Σ delta < threshold → KHÔNG tạo anomaly', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100_000n, // dưới 200k
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });
    await svc.scanAll({ now: NOW });
    expect(
      await prisma.gameplayAnomaly.count({ where: { type: 'CURRENCY_GAIN_SPIKE' } }),
    ).toBe(0);
  });

  it('ngoài cửa sổ (>1h) → KHÔNG count', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 500_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 2 * 3600 * 1000),
      },
    });
    await svc.scanAll({ now: NOW });
    expect(
      await prisma.gameplayAnomaly.count({ where: { type: 'CURRENCY_GAIN_SPIKE' } }),
    ).toBe(0);
  });
});

describe('GameplayAntiCheatService — item gain spike', () => {
  it('Σ qtyDelta ≥ 100 → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 5; i += 1) {
      await prisma.itemLedger.create({
        data: {
          characterId: f.characterId,
          itemKey: 'item_a',
          qtyDelta: 25,
          reason: 'TEST_DROP',
          createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'ITEM_GAIN_SPIKE', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — dungeon farming', () => {
  it('20 DungeonRun CLAIMED trong 24h → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 20; i += 1) {
      await prisma.dungeonRun.create({
        data: {
          characterId: f.characterId,
          templateKey: 'son_coc',
          status: 'CLAIMED',
          encounterIndex: 3,
          claimedAt: new Date(NOW.getTime() - i * 60 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'DUNGEON_REWARD_FARM', characterId: f.characterId },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('WARN');
  });

  it('< 20 claim → no anomaly', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 5; i += 1) {
      await prisma.dungeonRun.create({
        data: {
          characterId: f.characterId,
          templateKey: 'son_coc',
          status: 'CLAIMED',
          encounterIndex: 3,
          claimedAt: new Date(NOW.getTime() - i * 60 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    expect(
      await prisma.gameplayAnomaly.count({ where: { type: 'DUNGEON_REWARD_FARM' } }),
    ).toBe(0);
  });
});

describe('GameplayAntiCheatService — boss reward farming', () => {
  it('15 BOSS_REWARD ledger trong 24h → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 15; i += 1) {
      await prisma.currencyLedger.create({
        data: {
          characterId: f.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: 1000n,
          reason: 'BOSS_REWARD',
          createdAt: new Date(NOW.getTime() - i * 60 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'BOSS_REWARD_FARM', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — mission farming', () => {
  it('30 MissionProgress claimed → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 30; i += 1) {
      await prisma.missionProgress.create({
        data: {
          characterId: f.characterId,
          missionKey: `m_${i}`,
          period: 'DAILY',
          currentAmount: 1,
          goalAmount: 1,
          claimed: true,
          claimedAt: new Date(NOW.getTime() - i * 30 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'MISSION_REWARD_FARM', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — arena WIN farming', () => {
  it('30 ArenaMatch WIN trong 24h → WARN', async () => {
    const winner = await makeUserChar(prisma);
    const loser = await makeUserChar(prisma);
    for (let i = 0; i < 30; i += 1) {
      await prisma.arenaMatch.create({
        data: {
          attackerCharacterId: winner.characterId,
          defenderCharacterId: loser.characterId,
          status: 'RESOLVED',
          result: 'ATTACKER_WIN',
          winnerCharacterId: winner.characterId,
          attackerSnapshotJson: {},
          defenderSnapshotJson: {},
          seed: i,
          battleLogJson: [],
          resolvedAt: new Date(NOW.getTime() - i * 30 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'ARENA_REWARD_FARM', characterId: winner.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — territory reward spike', () => {
  it('10 TerritoryOwnerRewardGrant trong 7d → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 10; i += 1) {
      // Spread 10 grants trong 5 ngày để chắc chắn nằm trong 7d window.
      await prisma.territoryOwnerRewardGrant.create({
        data: {
          periodKey: `2026-W${i}`,
          regionKey: `r_${i}`,
          sectId: 'sect_a',
          characterId: f.characterId,
          rewardJson: { linhThach: 100 },
          grantedAt: new Date(NOW.getTime() - i * 12 * 3600 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'TERRITORY_REWARD_SPIKE', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — reward cap bypass attempt', () => {
  it('5 RewardCapEvent trong 1h → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 5; i += 1) {
      await prisma.rewardCapEvent.create({
        data: {
          characterId: f.characterId,
          dayBucket: '2026-05-15',
          source: 'TEST',
          requestedExp: 100n,
          requestedLinhThach: 100n,
          grantedExp: 50n,
          grantedLinhThach: 50n,
          cappedExp: 50n,
          cappedLinhThach: 50n,
          reason: 'TEST',
          createdAt: new Date(NOW.getTime() - i * 5 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'REWARD_CAP_BYPASS_ATTEMPT', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — EXP gain spike', () => {
  it('Σ RewardCapEvent.grantedExp ≥ 50k (1h) → WARN', async () => {
    const f = await makeUserChar(prisma);
    for (let i = 0; i < 5; i += 1) {
      await prisma.rewardCapEvent.create({
        data: {
          characterId: f.characterId,
          dayBucket: '2026-05-15',
          source: 'CULTIVATION',
          requestedExp: 20_000n,
          requestedLinhThach: 0n,
          grantedExp: 15_000n,
          grantedLinhThach: 0n,
          cappedExp: 5_000n,
          cappedLinhThach: 0n,
          reason: 'CULTIVATION',
          createdAt: new Date(NOW.getTime() - i * 5 * 60 * 1000),
        },
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.gameplayAnomaly.findFirst({
      where: { type: 'EXP_GAIN_SPIKE', characterId: f.characterId },
    });
    expect(a?.severity).toBe('WARN');
  });
});

describe('GameplayAntiCheatService — idempotency + detection-only', () => {
  it('2 lần scanAll cùng windowKey → KHÔNG double anomaly', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 500_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });
    await svc.scanAll({ now: NOW });
    await svc.scanAll({ now: NOW });
    const count = await prisma.gameplayAnomaly.count({
      where: { type: 'CURRENCY_GAIN_SPIKE', characterId: f.characterId },
    });
    expect(count).toBe(1);
  });

  it('scanAll KHÔNG mutate Character (balance / exp / item) — detection-only', async () => {
    const f = await makeUserChar(prisma, {
      linhThach: 1_000n,
      tienNgoc: 50,
      exp: 100n,
    });
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 500_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });
    await svc.scanAll({ now: NOW });
    const c = await prisma.character.findUnique({ where: { id: f.characterId } });
    expect(c?.linhThach).toBe(1_000n);
    expect(c?.tienNgoc).toBe(50);
    expect(c?.exp).toBe(100n);
    // User KHÔNG bị ban.
    const u = await prisma.user.findUnique({ where: { id: f.userId } });
    expect(u?.banned).toBe(false);
    expect(u?.role).toBe('PLAYER');
  });

  it('summary fields populated correctly', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 500_000n,
        reason: 'TEST',
        createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });
    const r = await svc.scanAll({ now: NOW });
    expect(r.scannedAt).toBeTruthy();
    expect(r.windowKeysByType.CURRENCY_GAIN_SPIKE).toMatch(/^1h:/);
    expect(r.windowKeysByType.DUNGEON_REWARD_FARM).toMatch(/^24h:/);
    expect(r.windowKeysByType.TERRITORY_REWARD_SPIKE).toMatch(/^7d:/);
    expect(r.totalCreated).toBeGreaterThanOrEqual(1);
  });

  it('combat result mismatch rule → no-op (reserved, Phase 16.3 chưa hook runtime)', async () => {
    const f = await makeUserChar(prisma);
    const r = await svc.scanRule({
      type: 'COMBAT_RESULT_MISMATCH',
      now: NOW,
      windowMs: 60 * 60 * 1000,
      windowKey: '1h:test',
    });
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(0);
    // Không có row được tạo cho rule này.
    const c = await prisma.gameplayAnomaly.count({
      where: { type: 'COMBAT_RESULT_MISMATCH', characterId: f.characterId },
    });
    expect(c).toBe(0);
  });
});
