import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
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
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory);
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
