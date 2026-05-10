import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';
import { CharacterSkillService } from './character-skill.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

/**
 * Content Scale 2 — High-Realm Skills Pack unlock/runtime tests.
 *
 * Covered:
 *   - REALM_TOO_LOW khi character chưa đủ realm cho skill cảnh giới cao.
 *   - HAPPY PATH khi character đã ở đúng realm.
 *   - HAPPY PATH khi character ở realm cao hơn (order >= reqRealm.order).
 *   - Idempotent learn (gọi 2 lần không tạo row trùng).
 *   - getEffectiveSkillFor mastery 0 cho skill mới (chưa upgrade).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: CharacterSkillService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  svc = new CharacterSkillService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CharacterSkillService.learn — high-realm pack (Content Scale 2)', () => {
  it('REALM_TOO_LOW: học `kim_nhan_tien_pho_thien_kiep` (nhan_tien) khi đang luyenkhi → throw', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.learn(f.characterId, 'kim_nhan_tien_pho_thien_kiep', 'admin_grant'),
    ).rejects.toMatchObject({ code: 'REALM_TOO_LOW' });
  });

  it('REALM_TOO_LOW: học `kim_vinh_hang_thien_kiem_quy_tong` (vo_chung) khi đang nguyen_anh → throw', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'nguyen_anh', realmStage: 9 });
    await expect(
      svc.learn(
        f.characterId,
        'kim_vinh_hang_thien_kiem_quy_tong',
        'admin_grant',
      ),
    ).rejects.toMatchObject({ code: 'REALM_TOO_LOW' });
  });

  it('REALM_TOO_LOW: học `kim_hon_nguyen_kim_kiep_dao_thien` (thanh_nhan, order 18) khi đang chuan_thanh (order 17) → throw', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'chuan_thanh', realmStage: 1 });
    await expect(
      svc.learn(
        f.characterId,
        'kim_hon_nguyen_kim_kiep_dao_thien',
        'admin_grant',
      ),
    ).rejects.toMatchObject({ code: 'REALM_TOO_LOW' });
  });

  it('HAPPY PATH: học `kim_nhan_tien_pho_thien_kiep` (nhan_tien) khi đã ở nhan_tien → row tồn tại', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'nhan_tien', realmStage: 1 });
    const state = await svc.learn(
      f.characterId,
      'kim_nhan_tien_pho_thien_kiep',
      'admin_grant',
    );
    const learned = state.learned.find(
      (s) => s.skillKey === 'kim_nhan_tien_pho_thien_kiep',
    );
    expect(learned).toBeDefined();
    expect(learned?.masteryLevel).toBe(1);
  });

  it('HAPPY PATH: học `moc_nhan_tien_van_lam_sinh_co` ở realm cao hơn (vinh_hang) → cho phép (order ≥ reqRealm.order)', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'vinh_hang', realmStage: 1 });
    const state = await svc.learn(
      f.characterId,
      'moc_nhan_tien_van_lam_sinh_co',
      'admin_grant',
    );
    const learned = state.learned.find(
      (s) => s.skillKey === 'moc_nhan_tien_van_lam_sinh_co',
    );
    expect(learned).toBeDefined();
  });

  it('HAPPY PATH: học `kim_vinh_hang_thien_kiem_quy_tong` (vo_chung order 25) khi đang vinh_hang (order 26) → row tồn tại', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'vinh_hang', realmStage: 1 });
    const state = await svc.learn(
      f.characterId,
      'kim_vinh_hang_thien_kiem_quy_tong',
      'admin_grant',
    );
    const learned = state.learned.find(
      (s) => s.skillKey === 'kim_vinh_hang_thien_kiem_quy_tong',
    );
    expect(learned).toBeDefined();
  });

  it('HAPPY PATH: học `chuan_thanh_dao_quan_kiem` (thanh_nhan, neutral) khi đang thanh_nhan → row tồn tại', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'thanh_nhan', realmStage: 1 });
    const state = await svc.learn(
      f.characterId,
      'chuan_thanh_dao_quan_kiem',
      'admin_grant',
    );
    const learned = state.learned.find(
      (s) => s.skillKey === 'chuan_thanh_dao_quan_kiem',
    );
    expect(learned).toBeDefined();
  });

  it('IDEMPOTENT: học cùng skill 2 lần không tạo row trùng', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'nhan_tien', realmStage: 1 });
    await svc.learn(f.characterId, 'tho_nhan_tien_kim_son_huyen_giap', 'src1');
    await svc.learn(f.characterId, 'tho_nhan_tien_kim_son_huyen_giap', 'src2');
    const rows = await prisma.characterSkill.findMany({
      where: {
        characterId: f.characterId,
        skillKey: 'tho_nhan_tien_kim_son_huyen_giap',
      },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('src1');
  });

  it('Mỗi tier learn được ít nhất 1 skill mỗi hệ Ngũ Hành', async () => {
    const probes: Array<{ realm: string; key: string }> = [
      { realm: 'nhan_tien', key: 'kim_nhan_tien_pho_thien_kiep' },
      { realm: 'nhan_tien', key: 'moc_nhan_tien_van_lam_sinh_co' },
      { realm: 'nhan_tien', key: 'thuy_nhan_tien_thuy_kiep_phong_an' },
      { realm: 'nhan_tien', key: 'hoa_nhan_tien_pho_diem_van_thien' },
      { realm: 'nhan_tien', key: 'tho_nhan_tien_kim_son_huyen_giap' },
      { realm: 'huyen_tien', key: 'kim_tien_gioi_thien_quang_xuyen_van' },
      { realm: 'huyen_tien', key: 'moc_tien_gioi_co_lam_thuong_truong' },
      { realm: 'huyen_tien', key: 'thuy_tien_gioi_thien_ha_dao_chuyen' },
      { realm: 'huyen_tien', key: 'hoa_tien_gioi_chu_tuoc_phan_thien' },
      { realm: 'huyen_tien', key: 'tho_tien_gioi_huyen_son_dia_phong' },
      { realm: 'thanh_nhan', key: 'kim_hon_nguyen_kim_kiep_dao_thien' },
      { realm: 'thanh_nhan', key: 'moc_hon_nguyen_thien_dia_long_lac' },
      { realm: 'thanh_nhan', key: 'thuy_hon_nguyen_van_thuy_quy_nguyen' },
      { realm: 'thanh_nhan', key: 'hoa_hon_nguyen_chu_tuoc_thien_phan' },
      { realm: 'thanh_nhan', key: 'tho_hon_nguyen_dia_thien_son_quan' },
      { realm: 'vo_chung', key: 'kim_vinh_hang_thien_kiem_quy_tong' },
      { realm: 'vo_chung', key: 'moc_vinh_hang_van_co_sinh_chu' },
      { realm: 'vo_chung', key: 'thuy_vinh_hang_thien_ha_dao_lang' },
      { realm: 'vo_chung', key: 'hoa_vinh_hang_kiep_diem_thieu_thien' },
      { realm: 'vo_chung', key: 'tho_vinh_hang_huyen_dia_kim_can_giap' },
    ];
    for (const probe of probes) {
      const f = await makeUserChar(prisma, {
        realmKey: probe.realm,
        realmStage: 1,
      });
      const state = await svc.learn(f.characterId, probe.key, 'admin_grant');
      const learned = state.learned.find((s) => s.skillKey === probe.key);
      expect(learned, `${probe.realm}/${probe.key} should learn`).toBeDefined();
    }
  });

  it('getEffectiveSkillFor cho skill mới chưa upgrade → masteryLevel 0, atkScale = base', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'vinh_hang', realmStage: 1 });
    const baseSkill = {
      key: 'kim_vinh_hang_thien_kiem_quy_tong',
      name: 'Thiên Kiếm Quy Tông',
      description: '',
      mpCost: 80,
      atkScale: 4.8,
      selfHealRatio: 0,
      selfBloodCost: 0,
      sect: null,
    };
    const eff = await svc.getEffectiveSkillFor(f.characterId, baseSkill);
    expect(eff.masteryLevel).toBe(0);
    expect(eff.atkScale).toBe(4.8);
    expect(eff.mpCost).toBe(80);
  });
});
