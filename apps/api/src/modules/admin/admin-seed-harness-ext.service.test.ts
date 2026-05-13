import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
import { AdminError, AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — QuestService cần NpcAffinityService cho rewards.affinity.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ───────────────── grantTalentPoint ─────────────────

describe('AdminService.grantTalentPoint', () => {
  it('happy path: ADMIN cộng +5 cho PLAYER → bonusTalentPoints = 5 + audit row', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await admin.grantTalentPoint(
      adminU.userId,
      'ADMIN',
      player.userId,
      5,
      'phase 11.x e2e seed',
    );

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.bonusTalentPoints).toBe(5);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.talentPoint.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.delta).toBe(5);
    expect(meta.reason).toBe('phase 11.x e2e seed');
    expect(meta.bonusTalentPointsAfter).toBe(5);
  });

  it('atomic increment: 2 lần grant +3 +2 → bonusTalentPoints = 5 (kiểm increment chứ không set)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, 3, 'first');
    await admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, 2, 'second');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.bonusTalentPoints).toBe(5);
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantTalentPoint(adminU.userId, 'ADMIN', adminU.userId, 1, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('INVALID_INPUT khi delta=0 / âm / quá cap 99', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, -1, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, 100, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('NOT_FOUND khi target user không tồn tại', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantTalentPoint(adminU.userId, 'ADMIN', 'no-such-user', 1, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FORBIDDEN khi MOD cố grant cho ADMIN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const adminTarget = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantTalentPoint(modU.userId, 'MOD', adminTarget.userId, 1, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MOD grant cho PLAYER → ok (role hierarchy mirror grantExp)', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await admin.grantTalentPoint(modU.userId, 'MOD', player.userId, 7, 'mod ok');
    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.bonusTalentPoints).toBe(7);
  });
});

// ───────────────── setRealm ─────────────────

describe('AdminService.setRealm', () => {
  it('happy path: ADMIN set realm kim_dan stage 3 → reset exp=0 + audit ghi previous', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, {
      role: 'PLAYER',
      realmKey: 'luyenkhi',
      realmStage: 5,
      exp: 1234n,
    });

    await admin.setRealm(adminU.userId, 'ADMIN', player.userId, 'kim_dan', 3, 'jump to KD3');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.realmKey).toBe('kim_dan');
    expect(c?.realmStage).toBe(3);
    expect(c?.exp).toBe(0n);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.realm.set' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.previousRealmKey).toBe('luyenkhi');
    expect(meta.previousRealmStage).toBe(5);
    expect(meta.previousExp).toBe('1234');
    expect(meta.newRealmKey).toBe('kim_dan');
    expect(meta.newRealmStage).toBe(3);
    expect(meta.reason).toBe('jump to KD3');
  });

  it('default stage=1 khi controller pass mặc định (service nhận stage=1)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER', realmStage: 4 });

    await admin.setRealm(adminU.userId, 'ADMIN', player.userId, 'truc_co', 1, '');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.realmKey).toBe('truc_co');
    expect(c?.realmStage).toBe(1);
  });

  it('INVALID_INPUT khi realmKey không có trong catalog', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.setRealm(adminU.userId, 'ADMIN', player.userId, 'no_such_realm', 1, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi realmStage > realm.stages (luyenkhi stage=10 vượt cap 9)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.setRealm(adminU.userId, 'ADMIN', player.userId, 'luyenkhi', 10, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi realmStage > realm.stages cho realm peak stages=1 (phamnhan stage=2)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.setRealm(adminU.userId, 'ADMIN', player.userId, 'phamnhan', 2, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.setRealm(adminU.userId, 'ADMIN', adminU.userId, 'truc_co', 1, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('FORBIDDEN khi MOD cố set-realm cho MOD', async () => {
    const mod1 = await makeUserChar(prisma, { role: 'MOD' });
    const mod2 = await makeUserChar(prisma, { role: 'MOD' });
    await expect(
      admin.setRealm(mod1.userId, 'MOD', mod2.userId, 'truc_co', 1, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ───────────────── grantCurrency ─────────────────

describe('AdminService.grantCurrency', () => {
  it('happy path LINH_THACH +500 → balance += 500 + ledger row + audit', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER', linhThach: 1000n });

    await admin.grantCurrency(
      adminU.userId,
      'ADMIN',
      player.userId,
      CurrencyKind.LINH_THACH,
      500n,
      'seed for market',
    );

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.linhThach).toBe(1500n);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: player.characterId },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].currency).toBe('LINH_THACH');
    expect(ledger[0].delta).toBe(500n);
    expect(ledger[0].reason).toBe('ADMIN_GRANT');
    expect(ledger[0].actorUserId).toBe(adminU.userId);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.currency.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.currency).toBe('LINH_THACH');
    expect(meta.delta).toBe('500');
  });

  it('happy path TIEN_NGOC +100 → balance += 100', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER', tienNgoc: 50 });

    await admin.grantCurrency(
      adminU.userId,
      'ADMIN',
      player.userId,
      CurrencyKind.TIEN_NGOC,
      100n,
      '',
    );

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.tienNgoc).toBe(150);
  });

  it('delta âm trừ tiền có balance đủ → ok', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER', linhThach: 1000n });

    await admin.grantCurrency(
      adminU.userId,
      'ADMIN',
      player.userId,
      CurrencyKind.LINH_THACH,
      -300n,
      'punish',
    );

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.linhThach).toBe(700n);
  });

  it('delta âm trừ vượt balance → INVALID_INPUT (CurrencyError INSUFFICIENT_FUNDS map sang)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER', linhThach: 100n });

    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        player.userId,
        CurrencyKind.LINH_THACH,
        -1000n,
        '',
      ),
    ).rejects.toBeInstanceOf(AdminError);
  });

  it('INVALID_INPUT khi delta=0', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        player.userId,
        CurrencyKind.LINH_THACH,
        0n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi vượt cap LINH_THACH (1 tỷ)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        player.userId,
        CurrencyKind.LINH_THACH,
        1_000_000_001n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi vượt cap TIEN_NGOC (1 triệu)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        player.userId,
        CurrencyKind.TIEN_NGOC,
        1_000_001n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        adminU.userId,
        CurrencyKind.LINH_THACH,
        1n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('NOT_FOUND khi target user không tồn tại', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantCurrency(
        adminU.userId,
        'ADMIN',
        'no-such-user',
        CurrencyKind.LINH_THACH,
        1n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FORBIDDEN khi MOD cố grant cho ADMIN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const adminTarget = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantCurrency(
        modU.userId,
        'MOD',
        adminTarget.userId,
        CurrencyKind.LINH_THACH,
        1n,
        '',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ───────────────── grantMethod ─────────────────

describe('AdminService.grantMethod', () => {
  it('happy path: ADMIN grant `cuu_cuc_kim_cuong_quyet` cho PLAYER → row source=admin + audit', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await admin.grantMethod(
      adminU.userId,
      'ADMIN',
      player.userId,
      'cuu_cuc_kim_cuong_quyet',
      'phase 11.x smoke seed',
    );

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].methodKey).toBe('cuu_cuc_kim_cuong_quyet');
    expect(rows[0].source).toBe('admin');

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.method.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.characterId).toBe(player.characterId);
    expect(meta.methodKey).toBe('cuu_cuc_kim_cuong_quyet');
    expect(meta.previousLearnedCount).toBe(0);
    expect(meta.alreadyLearned).toBe(false);
    expect(meta.reason).toBe('phase 11.x smoke seed');
  });

  it('idempotent: grant cùng method 2 lần → vẫn 1 row, lần 2 alreadyLearned=true (audit ghi cả 2 lần)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await admin.grantMethod(adminU.userId, 'ADMIN', player.userId, 'cuu_cuc_kim_cuong_quyet', '');
    await admin.grantMethod(adminU.userId, 'ADMIN', player.userId, 'cuu_cuc_kim_cuong_quyet', '');

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: player.characterId, methodKey: 'cuu_cuc_kim_cuong_quyet' },
    });
    expect(rows).toHaveLength(1);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.method.grant' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect((audits[0].meta as Record<string, unknown>).alreadyLearned).toBe(false);
    expect((audits[1].meta as Record<string, unknown>).alreadyLearned).toBe(true);
    // previousLearnedCount lần 2 = 1 (đã có 1 row)
    expect((audits[1].meta as Record<string, unknown>).previousLearnedCount).toBe(1);
  });

  it('bypass realm/sect validation — luyenkhi PLAYER grant truc_co-tier method OK (admin override)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, {
      role: 'PLAYER',
      realmKey: 'luyenkhi',
      realmStage: 1,
    });

    // `cuu_cuc_kim_cuong_quyet` requires realm `truc_co` (player ở luyenkhi).
    // Service vẫn grant OK — admin override (mirror grantSpiritualRoot semantics).
    await admin.grantMethod(adminU.userId, 'ADMIN', player.userId, 'cuu_cuc_kim_cuong_quyet', '');

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(1);
  });

  it('INVALID_INPUT khi methodKey không có trong shared catalog', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantMethod(adminU.userId, 'ADMIN', player.userId, 'no_such_method', ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi methodKey rỗng', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    await expect(
      admin.grantMethod(adminU.userId, 'ADMIN', player.userId, '', ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantMethod(adminU.userId, 'ADMIN', adminU.userId, 'cuu_cuc_kim_cuong_quyet', ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('NOT_FOUND khi target user không tồn tại', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantMethod(adminU.userId, 'ADMIN', 'no-such-user', 'cuu_cuc_kim_cuong_quyet', ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FORBIDDEN khi MOD cố grant cho ADMIN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const adminTarget = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantMethod(modU.userId, 'MOD', adminTarget.userId, 'cuu_cuc_kim_cuong_quyet', ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MOD grant cho PLAYER → ok (role hierarchy mirror grantTalentPoint)', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await admin.grantMethod(
      modU.userId,
      'MOD',
      player.userId,
      'cuu_cuc_kim_cuong_quyet',
      'mod ok',
    );

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(1);
  });
});

// ───────────────── Talent budget composition (talent.service tích hợp) ─────────────────

describe('TalentService budget compose with bonusTalentPoints', () => {
  it('grant 3 bonus rồi compute remaining budget tại luyenkhi → 3 (default 0 + bonus 3)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, {
      role: 'PLAYER',
      realmKey: 'luyenkhi',
      realmStage: 1,
    });

    await admin.grantTalentPoint(adminU.userId, 'ADMIN', player.userId, 3, '');

    // luyenkhi order=1 → computeTalentPointBudget(1) = floor(1/3) = 0
    // bonusTalentPoints = 3 → tổng remaining budget = 3
    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.bonusTalentPoints).toBe(3);
    expect(c?.realmKey).toBe('luyenkhi');
  });
});

// ───────────────── seedDailyLoginStreak ─────────────────

describe('AdminService.seedDailyLoginStreak', () => {
  it('happy path: ADMIN seed 6 days → 6 rows backdated, streakAtClaim 1..6, audit ghi đủ', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    // Pin now để test deterministic (UTC midnight 2026-05-04).
    const now = new Date('2026-05-04T12:00:00Z');
    const result = await admin.seedDailyLoginStreak(
      adminU.userId,
      'ADMIN',
      player.userId,
      6,
      'phase 11.x smoke seed',
      now,
    );

    expect(result.rowsCreated).toBe(6);
    expect(result.previousRowCount).toBe(0);
    expect(result.newStreakWillBe).toBe(7);

    const rows = await prisma.dailyLoginClaim.findMany({
      where: { characterId: player.characterId },
      orderBy: { claimDateLocal: 'asc' },
    });
    expect(rows).toHaveLength(6);
    // Asia/Ho_Chi_Minh (default MISSION_RESET_TZ): 2026-05-04 12:00Z = 2026-05-04 19:00 ICT → todayDateLocal=2026-05-04.
    // Yesterday=2026-05-03, day-2=2026-05-02, ..., day-6=2026-04-28.
    expect(rows[0].claimDateLocal).toBe('2026-04-28');
    expect(rows[0].streakAtClaim).toBe(1);
    expect(rows[5].claimDateLocal).toBe('2026-05-03');
    expect(rows[5].streakAtClaim).toBe(6);
    // KHÔNG cộng tiền (admin chỉ seed historical).
    expect(rows.every((r) => r.linhThachDelta === 0n)).toBe(true);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.daily_login.seed' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.days).toBe(6);
    expect(meta.rowsCreated).toBe(6);
    expect(meta.previousRowCount).toBe(0);
    // Loop seed từ day-N (oldest) → day-1 (yesterday): firstSeededDateLocal = oldest, lastSeededDateLocal = newest.
    expect(meta.firstSeededDateLocal).toBe('2026-04-28');
    expect(meta.lastSeededDateLocal).toBe('2026-05-03');
  });

  it('idempotent: seed cùng days 2 lần → row count vẫn = days, audit ghi rowsCreated=0 lần 2', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    const now = new Date('2026-05-04T12:00:00Z');

    const r1 = await admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', player.userId, 3, '', now);
    const r2 = await admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', player.userId, 3, '', now);

    expect(r1.rowsCreated).toBe(3);
    expect(r2.rowsCreated).toBe(0);
    expect(r2.previousRowCount).toBe(3);

    const rows = await prisma.dailyLoginClaim.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(3);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.daily_login.seed' },
    });
    expect(audits).toHaveLength(2);
  });

  it('INVALID_INPUT khi days = 0', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', player.userId, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi days > 30 (cap)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', player.userId, 31, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi days không phải integer (vd 1.5)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', player.userId, 1.5, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', adminU.userId, 6, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('NOT_FOUND khi target user không tồn tại', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedDailyLoginStreak(adminU.userId, 'ADMIN', 'no-such-user', 6, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FORBIDDEN khi MOD seed cho ADMIN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const adminTarget = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedDailyLoginStreak(modU.userId, 'MOD', adminTarget.userId, 6, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MOD seed cho PLAYER → ok (role hierarchy mirror grantMethod)', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    const now = new Date('2026-05-04T12:00:00Z');

    const result = await admin.seedDailyLoginStreak(
      modU.userId,
      'MOD',
      player.userId,
      6,
      '',
      now,
    );

    expect(result.rowsCreated).toBe(6);
    const rows = await prisma.dailyLoginClaim.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(6);
  });
});

// ───────────────── seedReturnerInactive ─────────────────

describe('AdminService.seedReturnerInactive', () => {
  it('happy path: ADMIN seed 8 days → CharacterReturnerState.lastLoginAt backdated, audit ghi đủ', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    const now = new Date('2026-05-04T12:00:00Z');
    const result = await admin.seedReturnerInactive(
      adminU.userId,
      'ADMIN',
      player.userId,
      8,
      'phase 31 returner smoke',
      now,
    );

    expect(result.characterId).toBe(player.characterId);
    expect(result.days).toBe(8);
    expect(result.wasExisting).toBe(false);
    // 8 days before 2026-05-04T12:00:00Z = 2026-04-26T12:00:00Z.
    expect(result.lastLoginAt).toBe('2026-04-26T12:00:00.000Z');

    const row = await prisma.characterReturnerState.findUnique({
      where: { characterId: player.characterId },
    });
    expect(row).not.toBeNull();
    expect(row!.lastLoginAt?.toISOString()).toBe('2026-04-26T12:00:00.000Z');
    expect(row!.prevLoginAt).toBeNull();
    expect(row!.inactiveDays).toBe(0);
    expect(row!.currentTier).toBeNull();
    expect(row!.lastCycleKey).toBeNull();
    expect(row!.lastTriggerAt).toBeNull();

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.returner.seed_inactive' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.days).toBe(8);
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.characterId).toBe(player.characterId);
    expect(meta.lastLoginAt).toBe('2026-04-26T12:00:00.000Z');
    expect(meta.wasExisting).toBe(false);
    expect(meta.reason).toBe('phase 31 returner smoke');
  });

  it('idempotent overwrite: seed 5 days then 30 days → row giữ 1, lastLoginAt cập nhật mới, wasExisting=true lần 2', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    const now = new Date('2026-05-04T12:00:00Z');

    const r1 = await admin.seedReturnerInactive(
      adminU.userId,
      'ADMIN',
      player.userId,
      5,
      '',
      now,
    );
    const r2 = await admin.seedReturnerInactive(
      adminU.userId,
      'ADMIN',
      player.userId,
      30,
      '',
      now,
    );

    expect(r1.wasExisting).toBe(false);
    expect(r2.wasExisting).toBe(true);
    expect(r2.lastLoginAt).toBe('2026-04-04T12:00:00.000Z');

    const rows = await prisma.characterReturnerState.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].lastLoginAt?.toISOString()).toBe('2026-04-04T12:00:00.000Z');

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.returner.seed_inactive' },
    });
    expect(audits).toHaveLength(2);
  });

  it('preserves existing cycle/trigger reset → next /returner/check can fire', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    const now = new Date('2026-05-04T12:00:00Z');

    // Pre-seed a row with currentTier + lastCycleKey + lastTriggerAt set
    // (simulate prior cycle).
    await prisma.characterReturnerState.create({
      data: {
        characterId: player.characterId,
        prevLoginAt: new Date('2026-04-01T00:00:00Z'),
        lastLoginAt: new Date('2026-04-05T00:00:00Z'),
        inactiveDays: 4,
        currentTier: 'SHORT',
        lastCycleKey: `${player.userId}:SHORT:2026-04-05`,
        lastTriggerAt: new Date('2026-04-05T00:00:00Z'),
      },
    });

    const result = await admin.seedReturnerInactive(
      adminU.userId,
      'ADMIN',
      player.userId,
      14,
      'reset for MEDIUM smoke',
      now,
    );

    expect(result.wasExisting).toBe(true);

    const row = await prisma.characterReturnerState.findUnique({
      where: { characterId: player.characterId },
    });
    expect(row!.currentTier).toBeNull();
    expect(row!.lastCycleKey).toBeNull();
    expect(row!.lastTriggerAt).toBeNull();
    expect(row!.prevLoginAt).toBeNull();
    expect(row!.lastLoginAt?.toISOString()).toBe('2026-04-20T12:00:00.000Z');
  });

  it('INVALID_INPUT khi days = 0', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedReturnerInactive(adminU.userId, 'ADMIN', player.userId, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi days > 120 (cap)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedReturnerInactive(adminU.userId, 'ADMIN', player.userId, 121, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('INVALID_INPUT khi days không phải integer (vd 7.5)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });

    await expect(
      admin.seedReturnerInactive(adminU.userId, 'ADMIN', player.userId, 7.5, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('CANNOT_TARGET_SELF khi actor === target', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedReturnerInactive(adminU.userId, 'ADMIN', adminU.userId, 8, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('NOT_FOUND khi target user không tồn tại', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedReturnerInactive(adminU.userId, 'ADMIN', 'no-such-user', 8, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FORBIDDEN khi MOD seed cho ADMIN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const adminTarget = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.seedReturnerInactive(modU.userId, 'MOD', adminTarget.userId, 8, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MOD seed cho PLAYER → ok (role hierarchy mirror seedDailyLoginStreak)', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const player = await makeUserChar(prisma, { role: 'PLAYER' });
    const now = new Date('2026-05-04T12:00:00Z');

    const result = await admin.seedReturnerInactive(
      modU.userId,
      'MOD',
      player.userId,
      8,
      '',
      now,
    );

    expect(result.days).toBe(8);
    expect(result.wasExisting).toBe(false);

    const row = await prisma.characterReturnerState.findUnique({
      where: { characterId: player.characterId },
    });
    expect(row).not.toBeNull();
  });
});
