import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STARTER_CULTIVATION_METHOD_KEY, getCultivationMethodDef } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  CultivationMethodService,
  CultivationMethodError,
  computeMethodElementAffinityForCharacter,
  methodExpMultiplierFor,
} from './cultivation-method.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: CultivationMethodService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new CultivationMethodService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Helper — tạo Sect row + character thuộc sect đó. Một số method
 * sect-locked (e.g. `thanh_van_tam_phap`) cần để test sect validation.
 */
async function makeCharInSect(
  sectName: string,
  charOpts: Parameters<typeof makeUserChar>[1] = {},
) {
  const sect = await prisma.sect.upsert({
    where: { name: sectName },
    update: {},
    create: { name: sectName },
  });
  const f = await makeUserChar(prisma, { ...charOpts, sectId: sect.id });
  return { ...f, sectId: sect.id };
}

describe('CultivationMethodService.grantStarterIfMissing (Phase 11.1.B onboard hook)', () => {
  it('lần đầu: tạo row CharacterCultivationMethod + set equippedCultivationMethodKey', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterIfMissing(f.characterId);

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].methodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    expect(rows[0].source).toBe('starter');

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
  });

  it('idempotent: gọi 2 lần KHÔNG tạo row trùng', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterIfMissing(f.characterId);
    await svc.grantStarterIfMissing(f.characterId);

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows.length).toBe(1);
  });

  it('legacy character đã có row starter nhưng equip key=null → set lại equip key', async () => {
    const f = await makeUserChar(prisma);
    // Simulate legacy state — row tồn tại, nhưng equip key chưa set.
    await prisma.characterCultivationMethod.create({
      data: {
        characterId: f.characterId,
        methodKey: STARTER_CULTIVATION_METHOD_KEY,
        source: 'starter',
      },
    });
    expect(
      (
        await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } })
      ).equippedCultivationMethodKey,
    ).toBeNull();

    await svc.grantStarterIfMissing(f.characterId);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
  });
});

describe('CultivationMethodService.learn (Phase 11.1.B)', () => {
  it('learn method huyen-grade hợp realm + element không forbid → tạo row + return state', async () => {
    // `cuu_cuc_kim_cuong_quyet` — kim, unlockRealm=truc_co, forbidden=[moc].
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    const state = await svc.learn(
      f.characterId,
      'cuu_cuc_kim_cuong_quyet',
      'dungeon_drop',
    );
    expect(state.learned.map((r) => r.methodKey)).toContain(
      'cuu_cuc_kim_cuong_quyet',
    );
    // Equipped vẫn null (learn ≠ equip).
    expect(state.equippedMethodKey).toBeNull();
  });

  it('learn idempotent: 2 lần KHÔNG throw, KHÔNG tạo row trùng', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');
    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: f.characterId, methodKey: 'cuu_cuc_kim_cuong_quyet' },
    });
    expect(rows.length).toBe(1);
  });

  it('reject REALM_TOO_LOW khi realm < method.unlockRealm', async () => {
    // `cuu_cuc_kim_cuong_quyet` cần truc_co (order 2). luyenkhi (order 1) thấp hơn.
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      primaryElement: 'kim',
    });
    await expect(
      svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop'),
    ).rejects.toThrow('REALM_TOO_LOW');
  });

  it('reject FORBIDDEN_ELEMENT khi primaryElement nằm trong forbidden list', async () => {
    // `cuu_cuc_kim_cuong_quyet` forbid `moc`.
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'moc',
    });
    await expect(
      svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop'),
    ).rejects.toThrow('FORBIDDEN_ELEMENT');
  });

  it('reject WRONG_SECT khi method.requiredSect nhưng character không cùng sect', async () => {
    // `thanh_van_tam_phap` sect-locked thanh_van. Character ở Tu La Tông.
    const f = await makeCharInSect('Tu La Tông', {
      realmKey: 'kim_dan',
      primaryElement: 'kim',
    });
    await expect(
      svc.learn(f.characterId, 'thanh_van_tam_phap', 'sect_shop'),
    ).rejects.toThrow('WRONG_SECT');
  });

  it('reject METHOD_NOT_FOUND khi key không có trong catalog', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.learn(f.characterId, 'method_khong_ton_tai', 'admin_grant'),
    ).rejects.toThrow('METHOD_NOT_FOUND');
  });
});

describe('CultivationMethodService.equip (Phase 11.1.B)', () => {
  it('equip method đã học → set equippedCultivationMethodKey + return state', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');
    const state = await svc.equip(f.characterId, 'cuu_cuc_kim_cuong_quyet');

    expect(state.equippedMethodKey).toBe('cuu_cuc_kim_cuong_quyet');
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe('cuu_cuc_kim_cuong_quyet');
  });

  it('equip method CHƯA học → throw NOT_LEARNED', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await expect(
      svc.equip(f.characterId, 'cuu_cuc_kim_cuong_quyet'),
    ).rejects.toThrow('NOT_LEARNED');
  });

  it('equip method KHÔNG có trong catalog → throw METHOD_NOT_FOUND', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.equip(f.characterId, 'method_khong_ton_tai'),
    ).rejects.toThrow('METHOD_NOT_FOUND');
  });

  it('equip method nhưng character đã đổi linh căn vào forbid → throw FORBIDDEN_ELEMENT', async () => {
    // Setup: character kim element + truc_co + đã học cuu_cuc_kim_cuong_quyet.
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');
    // Đổi sang moc (forbidden) — re-validate khi equip.
    await prisma.character.update({
      where: { id: f.characterId },
      data: { primaryElement: 'moc' },
    });
    await expect(
      svc.equip(f.characterId, 'cuu_cuc_kim_cuong_quyet'),
    ).rejects.toThrow('FORBIDDEN_ELEMENT');
  });

  it('switch method: equip method khác → ghi đè key cũ', async () => {
    // Character truc_co với kim primary — học 2 method, equip A rồi switch sang B.
    // method A: cuu_cuc_kim_cuong_quyet (kim, unlock truc_co).
    // method B: thuy_long_ngam (thuy, unlock truc_co, forbid tho — kim OK).
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');
    await svc.learn(f.characterId, 'thuy_long_ngam', 'dungeon_drop');

    await svc.equip(f.characterId, 'cuu_cuc_kim_cuong_quyet');
    let c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe('cuu_cuc_kim_cuong_quyet');

    await svc.equip(f.characterId, 'thuy_long_ngam');
    c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe('thuy_long_ngam');
  });
});

describe('CultivationMethodService.getState (Phase 11.1.B)', () => {
  it('legacy character chưa có method nào → auto-grant starter (lazy migration)', async () => {
    const f = await makeUserChar(prisma);
    const state = await svc.getState(f.characterId);

    expect(state.equippedMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    expect(state.learned.map((r) => r.methodKey)).toContain(
      STARTER_CULTIVATION_METHOD_KEY,
    );
  });

  it('character đã học multiple methods → list đầy đủ', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
    });
    await svc.grantStarterIfMissing(f.characterId);
    await svc.learn(f.characterId, 'cuu_cuc_kim_cuong_quyet', 'dungeon_drop');

    const state = await svc.getState(f.characterId);
    expect(state.learned.length).toBe(2);
    expect(state.learned.map((r) => r.methodKey).sort()).toEqual(
      [STARTER_CULTIVATION_METHOD_KEY, 'cuu_cuc_kim_cuong_quyet'].sort(),
    );
  });

  it('throw CHARACTER_NOT_FOUND nếu characterId không tồn tại', async () => {
    await expect(svc.getState('khong-ton-tai')).rejects.toThrow(
      'CHARACTER_NOT_FOUND',
    );
  });
});

describe('methodExpMultiplierFor pure helper (Phase 11.1.B)', () => {
  it('null → 1.0 (legacy backward-compat)', () => {
    expect(methodExpMultiplierFor(null)).toBe(1.0);
  });

  it('invalid key → 1.0 (defensive)', () => {
    expect(methodExpMultiplierFor('khong_ton_tai')).toBe(1.0);
  });

  it('starter key → catalog expMultiplier (1.0)', () => {
    const def = getCultivationMethodDef(STARTER_CULTIVATION_METHOD_KEY);
    expect(def).toBeDefined();
    expect(methodExpMultiplierFor(STARTER_CULTIVATION_METHOD_KEY)).toBe(
      def!.expMultiplier,
    );
  });

  it('huyen key cuu_cuc_kim_cuong_quyet → catalog expMultiplier (1.2)', () => {
    expect(methodExpMultiplierFor('cuu_cuc_kim_cuong_quyet')).toBe(1.2);
  });

  it('than key thai_hu_chan_kinh → catalog expMultiplier (1.6)', () => {
    expect(methodExpMultiplierFor('thai_hu_chan_kinh')).toBe(1.6);
  });
});

describe('computeMethodElementAffinityForCharacter pure helper (Phase 11.1.E)', () => {
  it('legacy null methodKey → 0 (no equipped)', () => {
    expect(computeMethodElementAffinityForCharacter('hoa', [], null)).toBe(0);
  });

  it('invalid methodKey → 0 (defensive — bad data shouldn’t crash)', () => {
    expect(
      computeMethodElementAffinityForCharacter('hoa', [], 'khong_ton_tai'),
    ).toBe(0);
  });

  it('vô hệ method (`khai_thien_quyet` element=null) + primary=hoa → 0', () => {
    expect(
      computeMethodElementAffinityForCharacter(
        'hoa',
        ['kim', 'moc'],
        STARTER_CULTIVATION_METHOD_KEY,
      ),
    ).toBe(0);
  });

  it('primary=hoa + method=`liet_hoa_phap` (element=hoa) → 0.10', () => {
    expect(
      computeMethodElementAffinityForCharacter('hoa', [], 'liet_hoa_phap'),
    ).toBe(0.1);
  });

  it('secondary contains hoa + method=liet_hoa_phap → 0.05', () => {
    expect(
      computeMethodElementAffinityForCharacter(
        'kim',
        ['hoa', 'moc'],
        'liet_hoa_phap',
      ),
    ).toBe(0.05);
  });

  it('khác hệ — primary=kim secondary=[moc] vs method=liet_hoa_phap (hoa) → 0', () => {
    expect(
      computeMethodElementAffinityForCharacter(
        'kim',
        ['moc'],
        'liet_hoa_phap',
      ),
    ).toBe(0);
  });

  it('legacy character primaryElement=null secondaryElements=[] → 0 (backward-compat)', () => {
    expect(
      computeMethodElementAffinityForCharacter(null, [], 'liet_hoa_phap'),
    ).toBe(0);
  });

  it('invalid primary string ("kim_dan" — sai key) → coi như null → 0', () => {
    // Defensive narrow — Prisma trả `string | null` nhưng catalog chỉ chấp
    // nhận `ElementKey`. Bad data (typo / migration) không nên trigger bonus.
    expect(
      computeMethodElementAffinityForCharacter(
        'kim_dan' as never,
        [],
        'liet_hoa_phap',
      ),
    ).toBe(0);
  });

  it('invalid secondaryElements (mixed valid + bogus) → narrow tốt, valid match vẫn trả bonus', () => {
    expect(
      computeMethodElementAffinityForCharacter(
        'kim',
        ['hoa', 'bogus' as never],
        'liet_hoa_phap',
      ),
    ).toBe(0.05); // hoa valid → match
  });
});

describe('CultivationMethodService.getState (Phase 11.1.E expose affinity)', () => {
  it('character primary=hoa + equipped liet_hoa_phap → equippedMethodElementAffinity=0.10', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co', // unlockRealm cho liet_hoa_phap
      primaryElement: 'hoa',
      secondaryElements: ['kim', 'moc'],
    });
    await svc.learn(f.characterId, 'liet_hoa_phap', 'admin_grant');
    await svc.equip(f.characterId, 'liet_hoa_phap');

    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodKey).toBe('liet_hoa_phap');
    expect(state.equippedMethodElementAffinity).toBe(0.1);
  });

  it('character secondary contains hoa + equipped liet_hoa_phap → 0.05', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'kim',
      secondaryElements: ['hoa', 'moc'],
    });
    await svc.learn(f.characterId, 'liet_hoa_phap', 'admin_grant');
    await svc.equip(f.characterId, 'liet_hoa_phap');

    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodElementAffinity).toBe(0.05);
  });

  it('character primary=thuy + equipped thuy_long_ngam (element=thuy) → 0.10 primary match', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'thuy',
    });
    await svc.learn(f.characterId, 'thuy_long_ngam', 'admin_grant');
    await svc.equip(f.characterId, 'thuy_long_ngam');

    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodElementAffinity).toBe(0.1);
  });

  it('character khác hệ (primary=hoa, no secondary) + equipped thuy_long_ngam (element=thuy) → 0', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      primaryElement: 'hoa', // không trùng thuy + không bị forbidden ['tho']
      secondaryElements: [],
    });
    await svc.learn(f.characterId, 'thuy_long_ngam', 'admin_grant');
    await svc.equip(f.characterId, 'thuy_long_ngam');

    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodElementAffinity).toBe(0);
  });

  it('character starter (vô hệ) primary=hoa → equippedMethodElementAffinity=0 (vô hệ method)', async () => {
    const f = await makeUserChar(prisma, { primaryElement: 'hoa' });
    await svc.grantStarterIfMissing(f.characterId);

    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    // `khai_thien_quyet` element=null → bonus=0.
    expect(state.equippedMethodElementAffinity).toBe(0);
  });

  it('legacy character không primaryElement + auto-grant starter → affinity=0', async () => {
    const f = await makeUserChar(prisma);
    // Auto lazy migration trigger trong getState (learned.length===0).
    const state = await svc.getState(f.characterId);
    expect(state.equippedMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    expect(state.equippedMethodElementAffinity).toBe(0);
  });
});

describe('CultivationMethodError type guard', () => {
  it('learn method không tồn tại → CultivationMethodError instanceof', async () => {
    const f = await makeUserChar(prisma);
    let caught: unknown;
    try {
      await svc.learn(f.characterId, 'method_khong_ton_tai', 'admin_grant');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CultivationMethodError);
    expect((caught as CultivationMethodError).code).toBe('METHOD_NOT_FOUND');
  });
});
