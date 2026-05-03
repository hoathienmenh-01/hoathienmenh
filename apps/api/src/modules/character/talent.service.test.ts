import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeTalentPointBudget, getTalentDef, REALMS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TalentError, TalentService } from './talent.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: TalentService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new TalentService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const realmKeyToOrder = new Map(REALMS.map((r) => [r.key, r.order]));

describe('TalentService.learnTalent — happy path', () => {
  it('character ở kim_dan(3) học talent_kim_thien_co (cost=1, req=kim_dan) thành công', async () => {
    // kim_dan order=3 → budget=1 (3÷3). cost=1 → vừa đủ.
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const result = await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    expect(result.talentKey).toBe('talent_kim_thien_co');
    expect(result.learnedAt).toBeInstanceOf(Date);

    const rows = await prisma.characterTalent.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].talentKey).toBe('talent_kim_thien_co');
  });

  it('character ở luyen_hu(6) có budget=2 → học 2 talent cost=1 mỗi cái OK', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    await svc.learnTalent(ctx.characterId, 'talent_thuy_long_an');

    const rows = await prisma.characterTalent.findMany({
      where: { characterId: ctx.characterId },
      orderBy: { learnedAt: 'asc' },
    });
    expect(rows.map((r) => r.talentKey)).toEqual([
      'talent_kim_thien_co',
      'talent_thuy_long_an',
    ]);
  });
});

describe('TalentService.learnTalent — gating', () => {
  it('throws REALM_TOO_LOW khi character realm < talent.realmRequirement', async () => {
    // luyenkhi(1) < kim_dan(3) — talent_kim_thien_co req=kim_dan
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(
      svc.learnTalent(ctx.characterId, 'talent_kim_thien_co'),
    ).rejects.toMatchObject({ code: 'REALM_TOO_LOW' });

    const rows = await prisma.characterTalent.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('throws INSUFFICIENT_TALENT_POINTS khi học xong vượt budget', async () => {
    // kim_dan(3) budget=1. Học 1 talent cost=1 → spent=1. Học cái thứ 2 → fail.
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');

    await expect(
      svc.learnTalent(ctx.characterId, 'talent_thuy_long_an'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_TALENT_POINTS' });
  });

  it('throws ALREADY_LEARNED khi học lại talent đã có (idempotency)', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    await expect(
      svc.learnTalent(ctx.characterId, 'talent_kim_thien_co'),
    ).rejects.toMatchObject({ code: 'ALREADY_LEARNED' });

    const rows = await prisma.characterTalent.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
  });

  it('throws TALENT_NOT_FOUND khi talentKey không có trong catalog', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    await expect(
      svc.learnTalent(ctx.characterId, 'talent_does_not_exist'),
    ).rejects.toMatchObject({ code: 'TALENT_NOT_FOUND' });
  });

  it('throws CHARACTER_NOT_FOUND khi characterId không tồn tại', async () => {
    await expect(
      svc.learnTalent('char-does-not-exist', 'talent_kim_thien_co'),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});

describe('TalentService.listLearned', () => {
  it('return empty cho character chưa học talent nào', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const list = await svc.listLearned(ctx.characterId);
    expect(list).toEqual([]);
  });

  it('return list đã học, kèm def metadata, order theo learnedAt asc', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    await svc.learnTalent(ctx.characterId, 'talent_thuy_long_an');

    const list = await svc.listLearned(ctx.characterId);
    expect(list).toHaveLength(2);
    expect(list[0].talentKey).toBe('talent_kim_thien_co');
    expect(list[0].def.name).toBe(getTalentDef('talent_kim_thien_co')!.name);
    expect(list[1].talentKey).toBe('talent_thuy_long_an');
  });

  it('Phase 11.7.E++ — listLearned default cooldownTurnsRemaining = 0 cho talent vừa học', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');

    const list = await svc.listLearned(ctx.characterId);
    expect(list).toHaveLength(1);
    expect(list[0].cooldownTurnsRemaining).toBe(0);
  });

  it('Phase 11.7.E++ — listLearned phản ánh cooldownTurnsRemaining sau setCooldown', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');

    await prisma.$transaction(async (tx) => {
      await svc.setCooldown(tx, ctx.characterId, 'talent_kim_thien_co', 5);
    });

    const list = await svc.listLearned(ctx.characterId);
    expect(list).toHaveLength(1);
    expect(list[0].cooldownTurnsRemaining).toBe(5);
  });
});

describe('TalentService.getRemainingTalentPoints', () => {
  it('character ở phamnhan(0) còn 0 điểm', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const remain = await svc.getRemainingTalentPoints(ctx.characterId);
    expect(remain).toBe(0);
  });

  it('character ở kim_dan(3) chưa học gì → còn 1 điểm', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const remain = await svc.getRemainingTalentPoints(ctx.characterId);
    const expectedBudget = computeTalentPointBudget(
      realmKeyToOrder.get('kim_dan')!,
    );
    expect(remain).toBe(expectedBudget); // 1
  });

  it('character ở luyen_hu(6) học xong 1 talent cost=1 → còn 1 điểm', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    const remain = await svc.getRemainingTalentPoints(ctx.characterId);
    expect(remain).toBe(1); // budget=2 - spent=1
  });
});

describe('TalentService.getMods', () => {
  it('chưa học → return identity mods', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.dropMul).toBe(1);
    expect(mods.expMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
  });

  it('học talent_kim_thien_co (stat_mod atk 1.10) → atkMul tăng', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_thien_co');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
  });

  it('học talent_moc_linh_quy (regen hp +5) → hpRegenFlat=5', async () => {
    // moc_linh_quy req=truc_co(2). Cần budget≥1 → kim_dan(3, budget=1) đủ.
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    await svc.learnTalent(ctx.characterId, 'talent_moc_linh_quy');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.hpRegenFlat).toBe(5);
  });
});

describe('TalentService — cross-character isolation', () => {
  it('learn cho Char A KHÔNG ảnh hưởng Char B', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const b = await makeUserChar(prisma, { realmKey: 'kim_dan' });

    await svc.learnTalent(a.characterId, 'talent_kim_thien_co');

    const aList = await svc.listLearned(a.characterId);
    const bList = await svc.listLearned(b.characterId);
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(0);

    // B vẫn còn nguyên 1 điểm budget.
    expect(await svc.getRemainingTalentPoints(b.characterId)).toBe(1);
    // A đã spent 1.
    expect(await svc.getRemainingTalentPoints(a.characterId)).toBe(0);

    // B vẫn học được talent đó.
    await svc.learnTalent(b.characterId, 'talent_kim_thien_co');
    const bAfter = await svc.listLearned(b.characterId);
    expect(bAfter).toHaveLength(1);
  });
});

describe('TalentService — error class', () => {
  it('throws TalentError instance với code chuẩn (không leak Prisma)', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    try {
      await svc.learnTalent(ctx.characterId, 'talent_does_not_exist');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TalentError);
      expect((e as TalentError).code).toBe('TALENT_NOT_FOUND');
    }
  });
});

describe('TalentService — cooldown (Phase 11.7.E)', () => {
  it('getCooldownRemaining default 0 sau khi học (chưa cast)', async () => {
    // talent_kim_quang_tram = active damage cooldown=3, cost=2.
    // luyen_hu(6) → budget=2 → vừa đủ. learnedAt → cooldown 0.
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_quang_tram');
    const remaining = await svc.getCooldownRemaining(
      ctx.characterId,
      'talent_kim_quang_tram',
    );
    expect(remaining).toBe(0);
  });

  it('getCooldownRemaining = 0 cho talent chưa học (defensive)', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    const remaining = await svc.getCooldownRemaining(
      ctx.characterId,
      'talent_kim_quang_tram',
    );
    expect(remaining).toBe(0);
  });

  it('setCooldown lưu đúng cooldownTurns từ activeEffect', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_quang_tram');
    await prisma.$transaction(async (tx) => {
      // talent_kim_quang_tram cooldownTurns=3.
      await svc.setCooldown(tx, ctx.characterId, 'talent_kim_quang_tram', 3);
    });
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(3);
  });

  it('setCooldown clamp Math.max(0, floor(turns)) — guard âm + float', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_quang_tram');
    await prisma.$transaction(async (tx) => {
      await svc.setCooldown(tx, ctx.characterId, 'talent_kim_quang_tram', -5);
    });
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(0);
    await prisma.$transaction(async (tx) => {
      await svc.setCooldown(tx, ctx.characterId, 'talent_kim_quang_tram', 4.7);
    });
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(4);
  });

  it('decrementAllCooldowns -1 cho mọi row > 0, idempotent cho row =0', async () => {
    // 2 active talent costs 2 mỗi cái → cần budget=4 → thien_tien(12).
    const ctx = await makeUserChar(prisma, { realmKey: 'thien_tien' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_quang_tram'); // cd=3, cost=2
    await svc.learnTalent(ctx.characterId, 'talent_thuy_yen_nguc'); // cd=5, cost=2
    await prisma.$transaction(async (tx) => {
      await svc.setCooldown(tx, ctx.characterId, 'talent_kim_quang_tram', 3);
      await svc.setCooldown(tx, ctx.characterId, 'talent_thuy_yen_nguc', 5);
    });

    await prisma.$transaction(async (tx) => {
      await svc.decrementAllCooldowns(tx, ctx.characterId);
    });
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(2);
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_thuy_yen_nguc'),
    ).toBe(4);

    // Tick xuống 0 + tick thêm → vẫn 0 (idempotent guard `> 0`).
    for (let i = 0; i < 5; i++) {
      await prisma.$transaction((tx) =>
        svc.decrementAllCooldowns(tx, ctx.characterId),
      );
    }
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(0);
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_thuy_yen_nguc'),
    ).toBe(0);
  });

  it('decrementAllCooldowns không ảnh hưởng character khác (cross-character isolation)', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    const b = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(a.characterId, 'talent_kim_quang_tram');
    await svc.learnTalent(b.characterId, 'talent_kim_quang_tram');
    await prisma.$transaction(async (tx) => {
      await svc.setCooldown(tx, a.characterId, 'talent_kim_quang_tram', 3);
      await svc.setCooldown(tx, b.characterId, 'talent_kim_quang_tram', 3);
    });

    await prisma.$transaction((tx) =>
      svc.decrementAllCooldowns(tx, a.characterId),
    );

    expect(
      await svc.getCooldownRemaining(a.characterId, 'talent_kim_quang_tram'),
    ).toBe(2);
    expect(
      await svc.getCooldownRemaining(b.characterId, 'talent_kim_quang_tram'),
    ).toBe(3); // Char B không bị ảnh hưởng.
  });

  it('cooldown lifecycle full: cast → 3 → 2 → 1 → 0 (sẵn sàng cast lại)', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyen_hu' });
    await svc.learnTalent(ctx.characterId, 'talent_kim_quang_tram');
    // T0: cast → set 3.
    await prisma.$transaction((tx) =>
      svc.setCooldown(tx, ctx.characterId, 'talent_kim_quang_tram', 3),
    );
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(3);
    // T1, T2, T3: tick mỗi lần.
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) =>
        svc.decrementAllCooldowns(tx, ctx.characterId),
      );
    }
    expect(
      await svc.getCooldownRemaining(ctx.characterId, 'talent_kim_quang_tram'),
    ).toBe(0);
  });
});
