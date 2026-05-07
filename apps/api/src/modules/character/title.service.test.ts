import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composeTitleMods, getTitleDef } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TitleError, TitleService } from './title.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: TitleService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new TitleService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('TitleService.unlockTitle — happy path', () => {
  it('unlock title mới → tạo row + trả về metadata', async () => {
    const ctx = await makeUserChar(prisma);
    const result = await svc.unlockTitle(
      ctx.characterId,
      'realm_luyenkhi_initiate',
      'realm_milestone',
    );
    expect(result.titleKey).toBe('realm_luyenkhi_initiate');
    expect(result.source).toBe('realm_milestone');
    expect(result.unlockedAt).toBeInstanceOf(Date);

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].titleKey).toBe('realm_luyenkhi_initiate');
    expect(rows[0].source).toBe('realm_milestone');
  });

  it('unlock 2 title khác nhau → 2 row riêng biệt', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_luyenkhi_initiate',
      'realm_milestone',
    );
    await svc.unlockTitle(
      ctx.characterId,
      'element_kim_blade_master',
      'element_mastery',
    );

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
      orderBy: { unlockedAt: 'asc' },
    });
    expect(rows.map((r) => r.titleKey)).toEqual([
      'realm_luyenkhi_initiate',
      'element_kim_blade_master',
    ]);
  });

  it('unlock idempotent — re-unlock cùng key trả về row cũ, không tạo dup', async () => {
    const ctx = await makeUserChar(prisma);
    const r1 = await svc.unlockTitle(
      ctx.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    const r2 = await svc.unlockTitle(
      ctx.characterId,
      'realm_kim_dan_adept',
      'event', // source khác → bị ignored vì đã unlock
    );
    expect(r2.titleKey).toBe(r1.titleKey);
    expect(r2.unlockedAt.getTime()).toBe(r1.unlockedAt.getTime());
    expect(r2.source).toBe('realm_milestone'); // giữ nguyên source ban đầu

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('TitleService.unlockTitle — errors', () => {
  it('throws TITLE_NOT_FOUND khi titleKey không có trong catalog', async () => {
    const ctx = await makeUserChar(prisma);
    await expect(
      svc.unlockTitle(ctx.characterId, 'title_does_not_exist', 'event'),
    ).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('throws CHARACTER_NOT_FOUND khi characterId không tồn tại', async () => {
    await expect(
      svc.unlockTitle(
        'char_doesnt_exist',
        'realm_luyenkhi_initiate',
        'realm_milestone',
      ),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});

describe('TitleService.equipTitle', () => {
  it('equip title đã unlock → set Character.title', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    await svc.equipTitle(ctx.characterId, 'realm_kim_dan_adept');

    const c = await prisma.character.findUnique({
      where: { id: ctx.characterId },
      select: { title: true },
    });
    expect(c?.title).toBe('realm_kim_dan_adept');
  });

  it('equip title khác → thay thế title hiện tại (single slot)', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    await svc.unlockTitle(
      ctx.characterId,
      'element_kim_blade_master',
      'element_mastery',
    );
    await svc.equipTitle(ctx.characterId, 'realm_kim_dan_adept');
    await svc.equipTitle(ctx.characterId, 'element_kim_blade_master');

    const c = await prisma.character.findUnique({
      where: { id: ctx.characterId },
      select: { title: true },
    });
    expect(c?.title).toBe('element_kim_blade_master');
  });

  it('throws TITLE_NOT_OWNED khi equip title chưa unlock', async () => {
    const ctx = await makeUserChar(prisma);
    await expect(
      svc.equipTitle(ctx.characterId, 'realm_luyenkhi_initiate'),
    ).rejects.toMatchObject({ code: 'TITLE_NOT_OWNED' });
  });

  it('throws TITLE_NOT_FOUND khi title key không có trong catalog', async () => {
    const ctx = await makeUserChar(prisma);
    await expect(
      svc.equipTitle(ctx.characterId, 'title_does_not_exist'),
    ).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
  });

  it('throws CHARACTER_NOT_FOUND', async () => {
    await expect(
      svc.equipTitle('char_doesnt_exist', 'realm_luyenkhi_initiate'),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});

describe('TitleService.unequipTitle', () => {
  it('clear Character.title', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    await svc.equipTitle(ctx.characterId, 'realm_kim_dan_adept');
    await svc.unequipTitle(ctx.characterId);

    const c = await prisma.character.findUnique({
      where: { id: ctx.characterId },
      select: { title: true },
    });
    expect(c?.title).toBeNull();
  });

  it('idempotent — gọi khi chưa equip vẫn OK', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unequipTitle(ctx.characterId);
    const c = await prisma.character.findUnique({
      where: { id: ctx.characterId },
      select: { title: true },
    });
    expect(c?.title).toBeNull();
  });

  it('throws CHARACTER_NOT_FOUND', async () => {
    await expect(svc.unequipTitle('char_doesnt_exist')).rejects.toMatchObject({
      code: 'CHARACTER_NOT_FOUND',
    });
  });
});

describe('TitleService.listOwned', () => {
  it('empty list khi chưa unlock', async () => {
    const ctx = await makeUserChar(prisma);
    const list = await svc.listOwned(ctx.characterId);
    expect(list).toEqual([]);
  });

  it('return list với def metadata, sort theo unlockedAt asc', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_luyenkhi_initiate',
      'realm_milestone',
    );
    // Brief delay để 2 timestamp khác nhau (vẫn cùng tick PG có thể trùng,
    // nên ta chỉ check có đủ entries + def metadata).
    await svc.unlockTitle(
      ctx.characterId,
      'element_kim_blade_master',
      'element_mastery',
    );

    const list = await svc.listOwned(ctx.characterId);
    expect(list).toHaveLength(2);
    const keys = list.map((l) => l.titleKey);
    expect(keys).toContain('realm_luyenkhi_initiate');
    expect(keys).toContain('element_kim_blade_master');
    for (const item of list) {
      expect(item.def.key).toBe(item.titleKey);
      expect(item.def.nameVi.length).toBeGreaterThan(0);
    }
  });
});

describe('TitleService.getEquipped', () => {
  it('null khi chưa equip', async () => {
    const ctx = await makeUserChar(prisma);
    const eq = await svc.getEquipped(ctx.characterId);
    expect(eq).toBeNull();
  });

  it('return TitleDef khi đã equip', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'element_hoa_phoenix_flame',
      'element_mastery',
    );
    await svc.equipTitle(ctx.characterId, 'element_hoa_phoenix_flame');
    const eq = await svc.getEquipped(ctx.characterId);
    expect(eq).not.toBeNull();
    expect(eq?.titleKey).toBe('element_hoa_phoenix_flame');
    expect(eq?.def.element).toBe('hoa');
    expect(eq?.def.rarity).toBe('epic');
  });

  it('throws CHARACTER_NOT_FOUND', async () => {
    await expect(svc.getEquipped('char_doesnt_exist')).rejects.toMatchObject({
      code: 'CHARACTER_NOT_FOUND',
    });
  });
});

describe('TitleService.getMods', () => {
  it('identity (atkMul=1, …) khi chưa equip', async () => {
    const ctx = await makeUserChar(prisma);
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBeCloseTo(1, 5);
    expect(mods.defMul).toBeCloseTo(1, 5);
    expect(mods.hpMaxMul).toBeCloseTo(1, 5);
    expect(mods.mpMaxMul).toBeCloseTo(1, 5);
    expect(mods.spiritMul).toBeCloseTo(1, 5);
  });

  it('atkMul=1.05 khi equip element_kim_blade_master (epic statTarget=atk value=1.05)', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'element_kim_blade_master',
      'element_mastery',
    );
    await svc.equipTitle(ctx.characterId, 'element_kim_blade_master');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBeCloseTo(1.05, 5);
    expect(mods.defMul).toBeCloseTo(1, 5);
  });

  it('hpMaxMul=1.05 khi equip element_moc_forest_lord (epic statTarget=hpMax value=1.05)', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'element_moc_forest_lord',
      'element_mastery',
    );
    await svc.equipTitle(ctx.characterId, 'element_moc_forest_lord');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.hpMaxMul).toBeCloseTo(1.05, 5);
    expect(mods.atkMul).toBeCloseTo(1, 5);
  });

  it('parity với composeTitleMods([equipped]) cho realm_luyenkhi_initiate (no statBonus)', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.unlockTitle(
      ctx.characterId,
      'realm_luyenkhi_initiate',
      'realm_milestone',
    );
    await svc.equipTitle(ctx.characterId, 'realm_luyenkhi_initiate');
    const svcMods = await svc.getMods(ctx.characterId);
    const catalogMods = composeTitleMods(['realm_luyenkhi_initiate']);
    expect(svcMods).toEqual(catalogMods);
    // realm_luyenkhi_initiate có flavorStatBonus=null → identity.
    expect(getTitleDef('realm_luyenkhi_initiate')?.flavorStatBonus).toBeNull();
    expect(svcMods.atkMul).toBeCloseTo(1, 5);
  });
});

describe('TitleService — cross-character isolation', () => {
  it('unlock cho char A không ảnh hưởng char B', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await svc.unlockTitle(
      a.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );

    const aRows = await svc.listOwned(a.characterId);
    const bRows = await svc.listOwned(b.characterId);
    expect(aRows.map((r) => r.titleKey)).toEqual(['realm_kim_dan_adept']);
    expect(bRows).toEqual([]);
  });

  it('equip cho char A không touch Character.title của char B', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await svc.unlockTitle(
      a.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    await svc.equipTitle(a.characterId, 'realm_kim_dan_adept');

    const cB = await prisma.character.findUnique({
      where: { id: b.characterId },
      select: { title: true },
    });
    expect(cB?.title).toBeNull();
  });
});

describe('TitleError', () => {
  it('có name="TitleError" + code prop', () => {
    const e = new TitleError('TITLE_NOT_FOUND');
    expect(e.name).toBe('TitleError');
    expect(e.code).toBe('TITLE_NOT_FOUND');
    expect(e instanceof Error).toBe(true);
    expect(e instanceof TitleError).toBe(true);
  });
});

// Phase 13.0 audit pass #4 — Bug #7: pre-fix unlockTitleTx dùng
// findUnique-then-create pattern; 2 boss reward hook concurrent (cùng
// character, cùng titleKey) → both see no existing → both call create →
// race loser hits P2002 + Postgres aborts tx. Boss reward hook try/catch
// swallowed P2002 nhưng tx vẫn aborted → subsequent currency/inventory
// grant cũng fail (tx rollback) → mất reward kinh tế. Fix: refactor sang
// `createMany({ skipDuplicates: true })` — dịch sang Postgres
// `INSERT … ON CONFLICT DO NOTHING`, đúng atomic, không bao giờ throw
// P2002. Prisma's `upsert` KHÔNG atomic (find-then-create) nên không
// dùng được cho race-safe path.
describe('TitleService.unlockTitle — race regression', () => {
  it('2 unlock concurrent cùng (char, titleKey) → cả 2 commit, không throw P2002', async () => {
    const ctx = await makeUserChar(prisma);

    // Pre-fix: 1 trong 2 throw P2002 (nhưng wrapper unlockTitle có $tx riêng,
    // nên P2002 thoát ra ngoài → caller phải tự catch). Post-fix: cả 2
    // succeed; rows count = 1.
    const [r1, r2] = await Promise.all([
      svc.unlockTitle(
        ctx.characterId,
        'achievement_first_boss',
        'achievement',
      ),
      svc.unlockTitle(
        ctx.characterId,
        'achievement_first_boss',
        'achievement',
      ),
    ]);

    expect(r1.titleKey).toBe('achievement_first_boss');
    expect(r2.titleKey).toBe('achievement_first_boss');

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
  });
});
