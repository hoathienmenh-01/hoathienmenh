import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { CurrencyService } from '../character/currency.service';
import { TrialTowerError, TrialTowerService } from './trial-tower.service';

/**
 * Phase 26.5 — TrialTowerService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB.
 *
 * Coverage:
 *   - listForCharacter: trả 3 tower + progress=0 cho new character.
 *   - attemptFloor:
 *      - TOWER_NOT_FOUND, INVALID_FLOOR.
 *      - success=false khi battlePower < required (vẫn log attempt).
 *      - success=true first-clear: grant linhThach + exp, mark progress.
 *      - re-attempt cùng floor: isFirstClear=false, reward=0
 *        (idempotent — anti-farm).
 *      - milestoneClaimed=true khi clear floor mốc (chia hết 10),
 *        re-attempt KHÔNG nhận lại milestone.
 *      - progress.highestFloorCleared & seasonHighestFloor cập nhật monotonic.
 *   - attemptLog: luôn ghi log bất kể success/first-clear.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let trial: TrialTowerService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  trial = new TrialTowerService(prisma, currency);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

const TOWER = 'dang_tien_thap';

describe('Phase 26.5 — TrialTowerService.listForCharacter', () => {
  it('new character: trả 3 tower với progress=0', async () => {
    const c = await makeUserChar(prisma);
    const view = await trial.listForCharacter({
      characterId: c.characterId,
      playerRealmOrder: 5,
    });
    expect(view.length).toBe(3);
    for (const t of view) {
      expect(t.highestFloorCleared).toBe(0);
      expect(t.seasonHighestFloor).toBe(0);
    }
  });
});

describe('Phase 26.5 — TrialTowerService.attemptFloor', () => {
  it('TOWER_NOT_FOUND nếu key sai', async () => {
    const c = await makeUserChar(prisma);
    await expect(
      trial.attemptFloor({
        characterId: c.characterId,
        towerKey: 'KHONG_TON_TAI',
        floor: 1,
        battlePowerSnapshot: 1_000_000,
      }),
    ).rejects.toBeInstanceOf(TrialTowerError);
  });

  it('INVALID_FLOOR nếu floor < 1', async () => {
    const c = await makeUserChar(prisma);
    await expect(
      trial.attemptFloor({
        characterId: c.characterId,
        towerKey: TOWER,
        floor: 0,
        battlePowerSnapshot: 1000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FLOOR' });
  });

  it('success=false nếu battlePower < requiredPower (vẫn ghi log, không grant reward)', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    const r = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 10,
      battlePowerSnapshot: 1,
    });
    expect(r.success).toBe(false);
    expect(r.isFirstClear).toBe(false);
    expect(r.reward.linhThach).toBe(0);
    expect(r.reward.exp).toBe(0);

    const ch = await prisma.character.findUnique({
      where: { id: c.characterId },
      select: { linhThach: true },
    });
    expect(Number(ch!.linhThach)).toBe(0);

    const logs = await prisma.trialTowerAttemptLog.findMany({
      where: { characterId: c.characterId },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.success).toBe(false);
  });

  it('success=true first-clear: grant reward, update progress', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    // Floor 1 — base power tower dang_tien_thap = 200; battlePower=999_999 → success.
    const r = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 1,
      battlePowerSnapshot: 999_999,
    });
    expect(r.success).toBe(true);
    expect(r.isFirstClear).toBe(true);
    expect(r.reward.linhThach).toBeGreaterThan(0);

    const ch = await prisma.character.findUnique({
      where: { id: c.characterId },
      select: { linhThach: true, exp: true },
    });
    expect(Number(ch!.linhThach)).toBe(r.reward.linhThach);
    expect(Number(ch!.exp)).toBe(r.reward.exp);

    const p = await prisma.trialTowerProgress.findUnique({
      where: {
        characterId_towerKey: {
          characterId: c.characterId,
          towerKey: TOWER,
        },
      },
    });
    expect(p?.highestFloorCleared).toBe(1);
    expect(p?.seasonHighestFloor).toBe(1);
  });

  it('re-attempt cùng floor: isFirstClear=false, reward=0 (anti-farm)', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    const first = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 1,
      battlePowerSnapshot: 999_999,
    });
    expect(first.isFirstClear).toBe(true);

    const linhThachAfterFirst = await prisma.character
      .findUnique({
        where: { id: c.characterId },
        select: { linhThach: true },
      })
      .then((c) => c!.linhThach);

    const second = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 1,
      battlePowerSnapshot: 999_999,
    });
    expect(second.isFirstClear).toBe(false);
    expect(second.reward.linhThach).toBe(0);

    const linhThachAfterSecond = await prisma.character
      .findUnique({
        where: { id: c.characterId },
        select: { linhThach: true },
      })
      .then((c) => c!.linhThach);
    expect(linhThachAfterSecond).toBe(linhThachAfterFirst);

    // 2 attempts → 2 logs.
    const logs = await prisma.trialTowerAttemptLog.findMany({
      where: { characterId: c.characterId },
    });
    expect(logs.length).toBe(2);
  });

  it('milestoneClaimed=true khi floor là milestone (50), re-attempt KHÔNG nhận lại', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    const r = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 50,
      battlePowerSnapshot: 999_999_999,
    });
    expect(r.success).toBe(true);
    expect(r.isFirstClear).toBe(true);
    expect(r.milestoneClaimed).toBe(true);

    const p = await prisma.trialTowerProgress.findUnique({
      where: {
        characterId_towerKey: {
          characterId: c.characterId,
          towerKey: TOWER,
        },
      },
    });
    const claimed = Array.isArray(p?.claimedMilestonesJson)
      ? (p!.claimedMilestonesJson as string[])
      : [];
    expect(claimed.length).toBeGreaterThan(0);

    // Re-attempt same milestone — milestoneClaimed=false.
    const r2 = await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 50,
      battlePowerSnapshot: 999_999_999,
    });
    expect(r2.isFirstClear).toBe(false);
    expect(r2.milestoneClaimed).toBe(false);
  });

  it('highestFloorCleared cập nhật monotonic non-decreasing', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 2,
      battlePowerSnapshot: 999_999,
    });
    await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 5,
      battlePowerSnapshot: 999_999,
    });
    // Re-attempt floor 3 (lower) — KHÔNG drop highestFloorCleared.
    await trial.attemptFloor({
      characterId: c.characterId,
      towerKey: TOWER,
      floor: 3,
      battlePowerSnapshot: 999_999,
    });

    const p = await prisma.trialTowerProgress.findUnique({
      where: {
        characterId_towerKey: {
          characterId: c.characterId,
          towerKey: TOWER,
        },
      },
    });
    expect(p?.highestFloorCleared).toBe(5);
    expect(p?.seasonHighestFloor).toBe(5);
  });
});
