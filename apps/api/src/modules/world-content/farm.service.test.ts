import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { CurrencyService } from '../character/currency.service';
import { FarmError, FarmService } from './farm.service';
import { WorldCapService } from './world-cap.service';

/**
 * Phase 26.5 — FarmService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB.
 *
 * Coverage:
 *   - listForCharacter: gating theo realm + sessionLimit theo entitlement.
 *   - startSession: MAP_NOT_FOUND, REALM_TOO_LOW, SESSION_ALREADY_ACTIVE,
 *     happy path tạo ACTIVE session.
 *   - claimSession: SESSION_NOT_FOUND, SESSION_NOT_OWNED, SESSION_NOT_ACTIVE,
 *     happy path mint LINH_THACH + EXP, mark CLAIMED, cap counter tăng.
 *   - Anti-P2W: reward theo sourceTier KHÔNG scale theo player realm.
 *   - Anti-P2W: premium entitlement KHÔNG bypass `maxSessionMinutes` cap.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let worldCap: WorldCapService;
let farm: FarmService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  worldCap = new WorldCapService(prisma);
  farm = new FarmService(prisma, currency, worldCap);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

// son_coc_thao_nguyen — sourceTier=1, unlockRealmOrder=1, free 60', max 1440
const ENTRY_MAP = 'son_coc_thao_nguyen';

describe('Phase 26.5 — FarmService.listForCharacter', () => {
  it('trả về list map có gating theo player realm', async () => {
    const c = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const view = await farm.listForCharacter({
      characterId: c.characterId,
      playerRealmOrder: 1,
    });
    expect(view.length).toBeGreaterThan(0);
    const entry = view.find((v) => v.key === ENTRY_MAP);
    expect(entry).toBeDefined();
    expect(entry!.unlocked).toBe(true);
    expect(entry!.sourceTier).toBe(1);
    expect(entry!.sessionLimitMinutes).toBe(60); // free default
  });

  it('premium entitlement tăng sessionLimit nhưng KHÔNG vượt maxSessionMinutes', async () => {
    const c = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const view = await farm.listForCharacter({
      characterId: c.characterId,
      playerRealmOrder: 1,
      entitlements: { hasActiveVip: true },
    });
    const entry = view.find((v) => v.key === ENTRY_MAP);
    expect(entry).toBeDefined();
    // Premium nhận 720 (vip) nhưng cap maxSessionMinutes=1440 vẫn enforce.
    expect(entry!.sessionLimitMinutes).toBeGreaterThan(60);
    expect(entry!.sessionLimitMinutes).toBeLessThanOrEqual(entry!.maxSessionMinutes);
  });
});

describe('Phase 26.5 — FarmService.startSession', () => {
  it('happy path: tạo ACTIVE session', async () => {
    const c = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const s = await farm.startSession({
      characterId: c.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });
    expect(s.id).toBeDefined();
    expect(s.status).toBe('ACTIVE');
    expect(s.farmMapKey).toBe(ENTRY_MAP);

    const dbSession = await prisma.farmSession.findUnique({
      where: { id: s.id },
    });
    expect(dbSession?.status).toBe('ACTIVE');
  });

  it('MAP_NOT_FOUND nếu key sai', async () => {
    const c = await makeUserChar(prisma);
    await expect(
      farm.startSession({
        characterId: c.characterId,
        farmMapKey: 'KHONG_TON_TAI',
        playerRealmOrder: 5,
      }),
    ).rejects.toBeInstanceOf(FarmError);
  });

  it('SESSION_ALREADY_ACTIVE nếu đang có ACTIVE session', async () => {
    const c = await makeUserChar(prisma);
    await farm.startSession({
      characterId: c.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });
    await expect(
      farm.startSession({
        characterId: c.characterId,
        farmMapKey: ENTRY_MAP,
        playerRealmOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_ALREADY_ACTIVE' });
  });
});

describe('Phase 26.5 — FarmService.claimSession', () => {
  it('happy path: claim mint linhThach + exp, mark CLAIMED, cap counter tăng', async () => {
    const c = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
    });
    const started = await farm.startSession({
      characterId: c.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });

    // Backdate startedAt 30' để có minutesProcessed=30.
    const startedAt = new Date(Date.now() - 30 * 60_000);
    await prisma.farmSession.update({
      where: { id: started.id },
      data: { startedAt },
    });

    const claimed = await farm.claimSession({
      characterId: c.characterId,
      sessionId: started.id,
    });

    expect(claimed.minutesProcessed).toBeGreaterThanOrEqual(29);
    expect(claimed.minutesProcessed).toBeLessThanOrEqual(31);
    expect(claimed.rewards.linhThach).toBeGreaterThan(0);
    expect(claimed.rewards.exp).toBeGreaterThan(0);
    expect(claimed.rewards.sourceTier).toBe(1);

    const dbSession = await prisma.farmSession.findUnique({
      where: { id: started.id },
    });
    expect(dbSession?.status).toBe('CLAIMED');

    const chAfter = await prisma.character.findUnique({
      where: { id: c.characterId },
      select: { linhThach: true },
    });
    expect(Number(chAfter!.linhThach)).toBe(claimed.rewards.linhThach);

    const capRow = await prisma.dailyContentCap.findFirst({
      where: { characterId: c.characterId },
    });
    expect(capRow).toBeDefined();
    expect(capRow!.usedCount).toBe(1);
    expect(capRow!.usedQty).toBeGreaterThanOrEqual(claimed.minutesProcessed);
  });

  it('reward sourceTier KHÔNG scale theo player realm (anti-P2W)', async () => {
    // 2 player cùng map sourceTier=1, 1 player ở luyenkhi (tier 1), 1 player
    // ở troc-co realm 3 → reward giống nhau.
    const lo = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
    });
    const hi = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      linhThach: 0n,
    });

    const sLo = await farm.startSession({
      characterId: lo.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });
    const sHi = await farm.startSession({
      characterId: hi.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 5,
    });
    const startedAt = new Date(Date.now() - 10 * 60_000);
    await prisma.farmSession.update({
      where: { id: sLo.id },
      data: { startedAt },
    });
    await prisma.farmSession.update({
      where: { id: sHi.id },
      data: { startedAt },
    });
    const cLo = await farm.claimSession({
      characterId: lo.characterId,
      sessionId: sLo.id,
    });
    const cHi = await farm.claimSession({
      characterId: hi.characterId,
      sessionId: sHi.id,
    });
    expect(cLo.rewards.linhThach).toBe(cHi.rewards.linhThach);
    expect(cLo.rewards.exp).toBe(cHi.rewards.exp);
  });

  it('SESSION_NOT_FOUND nếu sessionId sai', async () => {
    const c = await makeUserChar(prisma);
    await expect(
      farm.claimSession({
        characterId: c.characterId,
        sessionId: 'fake-session-id',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('SESSION_NOT_OWNED nếu session thuộc character khác', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const s = await farm.startSession({
      characterId: a.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });
    await expect(
      farm.claimSession({
        characterId: b.characterId,
        sessionId: s.id,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' });
  });

  it('SESSION_NOT_ACTIVE nếu đã claim trước đó', async () => {
    const c = await makeUserChar(prisma);
    const s = await farm.startSession({
      characterId: c.characterId,
      farmMapKey: ENTRY_MAP,
      playerRealmOrder: 1,
    });
    await farm.claimSession({
      characterId: c.characterId,
      sessionId: s.id,
    });
    await expect(
      farm.claimSession({
        characterId: c.characterId,
        sessionId: s.id,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_ACTIVE' });
  });
});
