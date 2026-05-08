import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AchievementService } from './achievement.service';
import { CharacterService } from './character.service';
import { SpiritualRootService } from './spiritual-root.service';
import { CultivationMethodService } from './cultivation-method.service';
import { CharacterSkillService } from './character-skill.service';
import { CurrencyService } from './currency.service';
import { TitleService } from './title.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  ELEMENTS,
  SPIRITUAL_ROOT_GRADES,
  STARTER_CULTIVATION_METHOD_KEY,
  expCostForStage,
  titleForRealmMilestone,
} from '@xuantoi/shared';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let chars: CharacterService;
let charsWithRoot: CharacterService;
let charsWithMethod: CharacterService;
let charsWithSkill: CharacterService;
let charsWithTitles: CharacterService;
let rootSvc: SpiritualRootService;
let methodSvc: CultivationMethodService;
let skillSvc: CharacterSkillService;
let titleSvc: TitleService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const currency = new CurrencyService(prisma);
  rootSvc = new SpiritualRootService(prisma);
  methodSvc = new CultivationMethodService(prisma);
  skillSvc = new CharacterSkillService(prisma, currency);
  titleSvc = new TitleService(prisma);
  chars = new CharacterService(prisma, realtime);
  charsWithRoot = new CharacterService(prisma, realtime, rootSvc);
  charsWithMethod = new CharacterService(
    prisma,
    realtime,
    rootSvc,
    methodSvc,
  );
  charsWithSkill = new CharacterService(
    prisma,
    realtime,
    rootSvc,
    methodSvc,
    skillSvc,
  );
  charsWithTitles = new CharacterService(
    prisma,
    realtime,
    undefined,
    undefined,
    undefined,
    titleSvc,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CharacterService.findPublicProfile', () => {
  it('id không tồn tại → null', async () => {
    const r = await chars.findPublicProfile('clxxxxxxxxxxxxxxxxxxxxxxx');
    expect(r).toBeNull();
  });

  it('character bình thường → trả public-safe view (không có exp/hp/mp/currency/cultivating)', async () => {
    const f = await makeUserChar(prisma, {
      power: 42,
      spirit: 17,
      speed: 21,
      luck: 8,
      realmKey: 'truchko',
      realmStage: 3,
      linhThach: 999_999_999n,
      tienNgoc: 12345,
      hp: 50,
      mp: 25,
    });
    const r = await chars.findPublicProfile(f.characterId);
    expect(r).not.toBeNull();
    expect(r?.id).toBe(f.characterId);
    expect(r?.name).toBe(f.name);
    expect(r?.power).toBe(42);
    expect(r?.spirit).toBe(17);
    expect(r?.speed).toBe(21);
    expect(r?.luck).toBe(8);
    expect(r?.realmKey).toBe('truchko');
    expect(r?.realmStage).toBe(3);
    expect(r?.role).toBe('PLAYER');
    // Public-safe — không lộ các field nhạy cảm.
    const obj = r as unknown as Record<string, unknown>;
    expect(obj.exp).toBeUndefined();
    expect(obj.hp).toBeUndefined();
    expect(obj.mp).toBeUndefined();
    expect(obj.stamina).toBeUndefined();
    expect(obj.linhThach).toBeUndefined();
    expect(obj.tienNgoc).toBeUndefined();
    expect(obj.cultivating).toBeUndefined();
    // createdAt là ISO string.
    expect(typeof r?.createdAt).toBe('string');
    expect(new Date(r!.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('character có sect → sectId/sectKey/sectName được điền đúng', async () => {
    const sect = await prisma.sect.create({
      data: { name: 'Thanh Vân Môn' },
    });
    const f = await makeUserChar(prisma, { sectId: sect.id });
    const r = await chars.findPublicProfile(f.characterId);
    expect(r?.sectId).toBe(sect.id);
    expect(r?.sectName).toBe('Thanh Vân Môn');
    expect(r?.sectKey).toBe('thanh_van');
  });

  it('character không có sect → các field sect đều null', async () => {
    const f = await makeUserChar(prisma, { sectId: null });
    const r = await chars.findPublicProfile(f.characterId);
    expect(r?.sectId).toBeNull();
    expect(r?.sectKey).toBeNull();
    expect(r?.sectName).toBeNull();
  });

  it('user owner đang banned → trả null (không lộ profile của người bị khóa)', async () => {
    const f = await makeUserChar(prisma);
    await prisma.user.update({
      where: { id: f.userId },
      data: { banned: true },
    });
    const r = await chars.findPublicProfile(f.characterId);
    expect(r).toBeNull();
  });

  it('role admin/mod được phơi ra (cho UI hiển thị badge)', async () => {
    const fAdmin = await makeUserChar(prisma, { role: 'ADMIN' });
    const fMod = await makeUserChar(prisma, { role: 'MOD' });
    const rAdmin = await chars.findPublicProfile(fAdmin.characterId);
    const rMod = await chars.findPublicProfile(fMod.characterId);
    expect(rAdmin?.role).toBe('ADMIN');
    expect(rMod?.role).toBe('MOD');
  });
});

describe('CharacterService.onboard with SpiritualRootService (Phase 11.3.A)', () => {
  it('onboard tự động roll Linh căn server-side', async () => {
    // Tạo user trống (chưa có Character) — qua prisma trực tiếp.
    const user = await prisma.user.create({
      data: {
        email: `onboard_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithRoot.onboard(user.id, {
      name: `Tester_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'thanh_van',
    });
    expect(state.id).toBeDefined();
    const c = await prisma.character.findUnique({ where: { id: state.id } });
    expect(c).not.toBeNull();
    expect(SPIRITUAL_ROOT_GRADES).toContain(c!.spiritualRootGrade as never);
    expect(ELEMENTS).toContain(c!.primaryElement as never);
    expect(c!.rootPurity).toBeGreaterThanOrEqual(80);
    expect(c!.rootPurity).toBeLessThanOrEqual(100);

    // Log entry tạo với source='onboard'.
    const logs = await prisma.spiritualRootRollLog.findMany({
      where: { characterId: c!.id, source: 'onboard' },
    });
    expect(logs.length).toBe(1);
  });

  it('CharacterService không inject SpiritualRootService vẫn onboard được (backward-compat)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_legacy_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await chars.onboard(user.id, {
      name: `LegacyTester_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'tu_la',
    });
    const c = await prisma.character.findUnique({ where: { id: state.id } });
    expect(c).not.toBeNull();
    // Legacy onboard (không có SpiritualRootService) → field nullable.
    expect(c!.spiritualRootGrade).toBeNull();
    expect(c!.primaryElement).toBeNull();
  });
});

describe('CharacterService.onboard with CultivationMethodService (Phase 11.1.B)', () => {
  it('onboard tự động grant + equip starter `khai_thien_quyet`', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_method_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithMethod.onboard(user.id, {
      name: `MethodTester_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'thanh_van',
    });
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: state.id },
    });
    expect(c.equippedCultivationMethodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: c.id },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].methodKey).toBe(STARTER_CULTIVATION_METHOD_KEY);
    expect(rows[0].source).toBe('starter');
  });

  it('CharacterService không inject CultivationMethodService vẫn onboard được (backward-compat)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_no_method_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithRoot.onboard(user.id, {
      name: `NoMethod_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'huyen_thuy',
    });
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: state.id },
    });
    expect(c.equippedCultivationMethodKey).toBeNull();
  });
});

describe('CharacterService.onboard with CharacterSkillService (Phase 11.2.B)', () => {
  it('onboard tự động grant + equip starter `basic_attack`', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_skill_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithSkill.onboard(user.id, {
      name: `SkillTester_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'thanh_van',
    });
    const rows = await prisma.characterSkill.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].skillKey).toBe('basic_attack');
    expect(rows[0].masteryLevel).toBe(1);
    expect(rows[0].isEquipped).toBe(true);
    expect(rows[0].source).toBe('starter');
  });

  it('CharacterService không inject CharacterSkillService vẫn onboard được (backward-compat)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_no_skill_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithRoot.onboard(user.id, {
      name: `NoSkill_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'huyen_thuy',
    });
    const rows = await prisma.characterSkill.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(0);
  });

  it('onboard idempotent: chạy 2 lần (giả lập retry) → KHÔNG dup row skill', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_skill_idem_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithSkill.onboard(user.id, {
      name: `IdemSkill_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'tu_la',
    });
    // Re-call grantStarterIfMissing — must be safe.
    await skillSvc.grantStarterIfMissing(state.id);
    await skillSvc.grantStarterIfMissing(state.id);
    const rows = await prisma.characterSkill.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(1);
  });
});

describe('CharacterService.breakthrough with TitleService (Phase 11.9.C)', () => {
  it('breakthrough luyenkhi → truc_co tự auto-unlock title `realm_truc_co_pillar`', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const expectedTitle = titleForRealmMilestone('truc_co');
    expect(expectedTitle).toBeDefined();
    expect(expectedTitle!.key).toBe('realm_truc_co_pillar');

    const state = await charsWithTitles.breakthrough(fix.userId);
    expect(state.realmKey).toBe('truc_co');
    expect(state.realmStage).toBe(1);

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: fix.characterId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].titleKey).toBe('realm_truc_co_pillar');
    expect(rows[0].source).toBe('realm_milestone');
  });

  // Phase 14.3.A — `hoa_than → luyen_hu` đã có catalog kiếp.
  // `breakthrough()` được gate-block bằng `TRIBULATION_REQUIRED`; route
  // tribulation `attemptTribulation()` xử lý title path tương tự (Phase 11.9.C-2).
  it('breakthrough hoa_than → luyen_hu BLOCKED bởi TRIBULATION_REQUIRED gate (Phase 14.3.A)', async () => {
    const cost = expCostForStage('hoa_than', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'hoa_than',
      realmStage: 9,
      exp: cost,
    });

    expect(titleForRealmMilestone('luyen_hu')).toBeUndefined();

    await expect(charsWithTitles.breakthrough(fix.userId)).rejects.toThrow(
      'TRIBULATION_REQUIRED',
    );

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: fix.characterId },
    });
    expect(rows.length).toBe(0);
  });

  it('breakthrough idempotent: title đã unlock → KHÔNG dup row (composite UNIQUE)', async () => {
    // 1st: breakthrough truc_co peak → kim_dan, unlock `realm_kim_dan_adept`.
    const cost1 = expCostForStage('truc_co', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      realmStage: 9,
      exp: cost1,
    });

    await charsWithTitles.breakthrough(fix.userId);
    const after1 = await prisma.characterTitleUnlock.findMany({
      where: { characterId: fix.characterId },
    });
    expect(after1.length).toBe(1);
    expect(after1[0].titleKey).toBe('realm_kim_dan_adept');

    // Manually unlock 1 lần nữa qua TitleService trực tiếp — phải idempotent.
    await titleSvc.unlockTitle(
      fix.characterId,
      'realm_kim_dan_adept',
      'realm_milestone',
    );
    const after2 = await prisma.characterTitleUnlock.findMany({
      where: { characterId: fix.characterId },
    });
    expect(after2.length).toBe(1);
  });

  it('breakthrough KHÔNG inject TitleService → vẫn advance realm bình thường (backward-compat)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const state = await chars.breakthrough(fix.userId);
    expect(state.realmKey).toBe('truc_co');

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: fix.characterId },
    });
    expect(rows.length).toBe(0);
  });
});

// ── Phase 14.3.A — CharacterService.breakthrough TRIBULATION_REQUIRED gate ──
describe('Phase 14.3.A — breakthrough() TRIBULATION_REQUIRED gate', () => {
  it('low-tier (luyenkhi → truc_co): KHÔNG có catalog kiếp → breakthrough pass-through', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });
    const state = await chars.breakthrough(fix.userId);
    expect(state.realmKey).toBe('truc_co');
    expect(state.realmStage).toBe(1);
  });

  it('truc_co → kim_dan: chưa có catalog kiếp → breakthrough pass-through', async () => {
    const cost = expCostForStage('truc_co', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      realmStage: 9,
      exp: cost,
    });
    const state = await chars.breakthrough(fix.userId);
    expect(state.realmKey).toBe('kim_dan');
  });

  it('kim_dan → nguyen_anh: catalog có kiếp → throw TRIBULATION_REQUIRED, KHÔNG advance', async () => {
    const cost = expCostForStage('kim_dan', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 9,
      exp: cost + 1000n,
    });
    await expect(chars.breakthrough(fix.userId)).rejects.toThrow(
      'TRIBULATION_REQUIRED',
    );
    // Character KHÔNG bị mutate.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: fix.characterId },
    });
    expect(after.realmKey).toBe('kim_dan');
    expect(after.realmStage).toBe(9);
    expect(after.exp).toBe(cost + 1000n);
  });

  it('kim_dan stage<9 → vẫn throw NOT_AT_PEAK trước khi check kiếp', async () => {
    const fix = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 5,
      exp: 0n,
    });
    await expect(chars.breakthrough(fix.userId)).rejects.toThrow('NOT_AT_PEAK');
  });

  it('hu_khong_chi_ton (realm cuối, không nextRealm) → KHÔNG advance, giữ nguyên realm', async () => {
    const cost = expCostForStage('hu_khong_chi_ton', 9);
    if (cost === null) return;
    const fix = await makeUserChar(prisma, {
      realmKey: 'hu_khong_chi_ton',
      realmStage: 9,
      exp: cost,
    });
    const state = await chars.breakthrough(fix.userId);
    expect(state.realmKey).toBe('hu_khong_chi_ton');
  });
});

describe('CharacterService.onboard with TitleService (Phase 11.9.C-3)', () => {
  it('onboard tự auto-unlock title khởi đầu `realm_luyenkhi_initiate`', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_title_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });

    const expectedTitle = titleForRealmMilestone('luyenkhi');
    expect(expectedTitle).toBeDefined();
    expect(expectedTitle!.key).toBe('realm_luyenkhi_initiate');

    const state = await charsWithTitles.onboard(user.id, {
      name: `OnboardTitle_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'thanh_van',
    });

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].titleKey).toBe('realm_luyenkhi_initiate');
    expect(rows[0].source).toBe('realm_milestone');
  });

  it('onboard idempotent: pre-unlock manual rồi onboard → KHÔNG dup row', async () => {
    // Tạo user + char qua charsWithTitles.onboard, manual unlock thêm 1 lần
    // (mô phỏng retry / double-call) — vẫn 1 row.
    const user = await prisma.user.create({
      data: {
        email: `onboard_title_idem_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await charsWithTitles.onboard(user.id, {
      name: `OnboardIdem_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'tu_la',
    });

    // Manual unlock cùng key — phải idempotent.
    await titleSvc.unlockTitle(
      state.id,
      'realm_luyenkhi_initiate',
      'realm_milestone',
    );
    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(1);
  });

  it('onboard KHÔNG inject TitleService → vẫn create character (backward-compat)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `onboard_title_legacy_${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    const state = await chars.onboard(user.id, {
      name: `OnboardLegacy_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      sectKey: 'huyen_thuy',
    });

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: state.id },
    });
    expect(rows.length).toBe(0);
  });
});

describe('CharacterService.toState exposes tribulation timestamps (Phase 11.6.E)', () => {
  it('character chưa attempt → tribulationCooldownAt=null + taoMaUntil=null', async () => {
    const fx = await makeUserChar(prisma, { realmKey: 'kim_dan', realmStage: 9 });
    const state = await chars.findByUser(fx.userId);
    expect(state).not.toBeNull();
    expect(state!.tribulationCooldownAt).toBeNull();
    expect(state!.taoMaUntil).toBeNull();
  });

  it('character có tribulationCooldownAt → ISO string trả về (toISOString)', async () => {
    const fx = await makeUserChar(prisma, { realmKey: 'kim_dan', realmStage: 9 });
    const cooldown = new Date('2030-01-01T00:00:00.000Z');
    await prisma.character.update({
      where: { id: fx.characterId },
      data: { tribulationCooldownAt: cooldown },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state!.tribulationCooldownAt).toBe(cooldown.toISOString());
    expect(state!.taoMaUntil).toBeNull();
  });

  it('character có taoMaUntil → ISO string trả về', async () => {
    const fx = await makeUserChar(prisma, { realmKey: 'kim_dan', realmStage: 9 });
    const taoMa = new Date('2030-02-01T12:00:00.000Z');
    await prisma.character.update({
      where: { id: fx.characterId },
      data: { taoMaUntil: taoMa },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state!.tribulationCooldownAt).toBeNull();
    expect(state!.taoMaUntil).toBe(taoMa.toISOString());
  });

  it('character có cả 2 → expose đủ cả 2', async () => {
    const fx = await makeUserChar(prisma, { realmKey: 'kim_dan', realmStage: 9 });
    const cooldown = new Date('2030-03-01T00:00:00.000Z');
    const taoMa = new Date('2030-03-01T01:00:00.000Z');
    await prisma.character.update({
      where: { id: fx.characterId },
      data: { tribulationCooldownAt: cooldown, taoMaUntil: taoMa },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state!.tribulationCooldownAt).toBe(cooldown.toISOString());
    expect(state!.taoMaUntil).toBe(taoMa.toISOString());
  });
});

// ── Phase 11.3.A — CharacterService.toState exposes Spiritual Root state ──
// Thêm để FE consume `/character/me` + `state:update` WS broadcast biết
// linh căn grade + primary/secondary element + purity. Trước commit này, FE
// phải gọi riêng `/api/character/spiritual-root` (Phase 11.3.A endpoint) →
// extra round-trip + FE không có data lúc render lần đầu.
describe('CharacterService.toState exposes Spiritual Root fields (Phase 11.3.A)', () => {
  it('character chưa onboard linh căn → 4 field null/default (legacy backward-compat)', async () => {
    const fx = await makeUserChar(prisma);
    // makeUserChar legacy không seed spiritual root → null/default fallback.
    await prisma.character.update({
      where: { id: fx.characterId },
      data: {
        spiritualRootGrade: null,
        primaryElement: null,
        secondaryElements: [],
        rootPurity: 100,
      },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state).not.toBeNull();
    expect(state!.spiritualRootGrade).toBeNull();
    expect(state!.primaryElement).toBeNull();
    expect(state!.secondaryElements).toEqual([]);
    expect(state!.rootPurity).toBe(100);
  });

  it('character có linh căn populated → expose đủ grade + primary + secondary + purity', async () => {
    const fx = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: fx.characterId },
      data: {
        spiritualRootGrade: 'huyen',
        primaryElement: 'thuy',
        secondaryElements: ['tho', 'kim'],
        rootPurity: 80,
      },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state!.spiritualRootGrade).toBe('huyen');
    expect(state!.primaryElement).toBe('thuy');
    expect(state!.secondaryElements).toEqual(['tho', 'kim']);
    expect(state!.rootPurity).toBe(80);
  });

  it('character có primaryElement nhưng secondaryElements rỗng (pham grade) → primary + [] + purity', async () => {
    const fx = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: fx.characterId },
      data: {
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
        secondaryElements: [],
        rootPurity: 60,
      },
    });
    const state = await chars.findByUser(fx.userId);
    expect(state!.spiritualRootGrade).toBe('pham');
    expect(state!.primaryElement).toBe('kim');
    expect(state!.secondaryElements).toEqual([]);
    expect(state!.rootPurity).toBe(60);
  });
});

// ── Phase 11.10.G-2 — CharacterService.breakthrough BREAKTHROUGH achievement track ──
// Symmetric với CultivationProcessor auto-tick BREAKTHROUGH track (line 196)
// và TribulationService SUCCESS path (Phase 11.10.G). Manual peak breakthrough
// trước đó KHÔNG fire BREAKTHROUGH event → 4 catalog achievement BREAKTHROUGH
// (`first_breakthrough` v.v.) miss khi player click button đột phá thủ công.
describe('CharacterService.breakthrough BREAKTHROUGH achievement track (Phase 11.10.G-2)', () => {
  let charsWithAch: CharacterService;
  let charsNoAch: CharacterService;

  beforeAll(() => {
    const realtime = new RealtimeService();
    const currency = new CurrencyService(prisma);
    const tempChars = new CharacterService(prisma, realtime);
    const inventory = new InventoryService(prisma, realtime, tempChars);
    const achievements = new AchievementService(
      prisma,
      currency,
      titleSvc,
      inventory,
    );
    charsWithAch = new CharacterService(
      prisma,
      realtime,
      undefined,
      undefined,
      undefined,
      titleSvc,
      achievements,
    );
    charsNoAch = new CharacterService(prisma, realtime);
  });

  it('breakthrough luyenkhi → truc_co với AchievementService → first_breakthrough progress=1, completedAt set', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    // Pre-condition: chưa có CharacterAchievement row.
    const before = await prisma.characterAchievement.findMany({
      where: { characterId: fix.characterId },
    });
    expect(before).toHaveLength(0);

    const state = await charsWithAch.breakthrough(fix.userId);
    expect(state.realmKey).toBe('truc_co');

    // first_breakthrough (goal=1, BREAKTHROUGH) phải completed.
    const row = await prisma.characterAchievement.findUnique({
      where: {
        characterId_achievementKey: {
          characterId: fix.characterId,
          achievementKey: 'first_breakthrough',
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row!.progress).toBe(1);
    expect(row!.completedAt).not.toBeNull();
  });

  it('breakthrough KHÔNG inject AchievementService → vẫn advance realm, KHÔNG có row (backward-compat)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const state = await charsNoAch.breakthrough(fix.userId);
    expect(state.realmKey).toBe('truc_co');

    const rows = await prisma.characterAchievement.findMany({
      where: { characterId: fix.characterId },
    });
    expect(rows).toHaveLength(0);
  });
});

// ── Phase 11 nâng cao §5 PR2 wire — CharacterService.attemptBreakthrough ──
// RNG-based đột phá: success advance realm + log; fail apply tam_ma_light +
// log (KHÔNG advance, KHÔNG trừ EXP). Khác `breakthrough()` deterministic.
describe('CharacterService.attemptBreakthrough (Phase 11 nâng cao §5 PR2)', () => {
  let charsWithBuffs: CharacterService;
  let buffSvc: import('./buff.service').BuffService;

  beforeAll(async () => {
    const { BuffService } = await import('./buff.service');
    buffSvc = new BuffService(prisma);
    const realtime = new RealtimeService();
    charsWithBuffs = new CharacterService(
      prisma,
      realtime,
      undefined,
      undefined,
      undefined,
      titleSvc,
      undefined,
      buffSvc,
    );
  });

  it('SUCCESS path (rngRoll=0.0) → realm advance + log success + KHÔNG buff', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const outcome = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.0,
    );

    expect(outcome.success).toBe(true);
    expect(outcome.fromRealmKey).toBe('luyenkhi');
    expect(outcome.toRealmKey).toBe('truc_co');
    expect(outcome.toRealmStage).toBe(1);
    expect(outcome.attemptIndex).toBe(1);
    expect(outcome.debuffApplied).toBe(false);
    expect(outcome.debuffKey).toBeNull();
    expect(outcome.character.realmKey).toBe('truc_co');

    // BreakthroughAttemptLog success row
    const log = await prisma.breakthroughAttemptLog.findUniqueOrThrow({
      where: { id: outcome.logId },
    });
    expect(log.success).toBe(true);
    expect(log.toRealmKey).toBe('truc_co');
    expect(log.tamMaActive).toBe(false);
    expect(log.attemptIndex).toBe(1);

    // KHÔNG có CharacterBuff `tam_ma_light`
    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: fix.characterId },
    });
    expect(buffs).toHaveLength(0);
  });

  it('FAIL path (rngRoll=0.99) → KHÔNG advance + apply tam_ma_light + log fail', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const now = new Date('2026-05-05T12:00:00Z');
    const outcome = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.99,
      now,
    );

    expect(outcome.success).toBe(false);
    expect(outcome.fromRealmKey).toBe('luyenkhi');
    expect(outcome.toRealmKey).toBe('luyenkhi'); // KHÔNG advance
    expect(outcome.toRealmStage).toBe(9);
    expect(outcome.debuffApplied).toBe(true);
    expect(outcome.debuffKey).toBe('tam_ma_light');
    expect(outcome.debuffExpiresAt).not.toBeNull();
    expect(outcome.debuffExpiresAt!.getTime()).toBe(
      now.getTime() + 300_000, // 300s
    );

    // Character KHÔNG advance, EXP KHÔNG trừ.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: fix.characterId },
    });
    expect(after.realmKey).toBe('luyenkhi');
    expect(after.realmStage).toBe(9);
    expect(after.exp).toBe(cost);

    // Log fail
    const log = await prisma.breakthroughAttemptLog.findUniqueOrThrow({
      where: { id: outcome.logId },
    });
    expect(log.success).toBe(false);
    expect(log.tamMaActive).toBe(true);
    expect(log.tamMaExpiresAt).not.toBeNull();
    expect(log.attemptIndex).toBe(1);
    expect(log.expBefore).toBe(BigInt(cost));
    expect(log.expAfter).toBe(BigInt(cost));

    // CharacterBuff tam_ma_light tồn tại với source='breakthrough'
    const buff = await prisma.characterBuff.findUniqueOrThrow({
      where: {
        characterId_buffKey: {
          characterId: fix.characterId,
          buffKey: 'tam_ma_light',
        },
      },
    });
    expect(buff.source).toBe('breakthrough');
    expect(buff.expiresAt.getTime()).toBe(now.getTime() + 300_000);
  });

  it('NOT_AT_PEAK throw khi realmStage < 9 (no log row)', async () => {
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 5,
    });

    await expect(
      charsWithBuffs.attemptBreakthrough(fix.userId, () => 0.0),
    ).rejects.toMatchObject({ code: 'NOT_AT_PEAK' });

    // KHÔNG có log row (gate fail trước attempt).
    const logs = await prisma.breakthroughAttemptLog.findMany({
      where: { characterId: fix.characterId },
    });
    expect(logs).toHaveLength(0);
  });

  it('NOT_AT_PEAK throw khi exp < cost', async () => {
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: 1n, // dưới cost
    });

    await expect(
      charsWithBuffs.attemptBreakthrough(fix.userId, () => 0.0),
    ).rejects.toMatchObject({ code: 'NOT_AT_PEAK' });
  });

  it('attemptIndex tăng dần qua nhiều attempt (lifetime counter)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    // Attempt 1 fail
    const o1 = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.99,
    );
    expect(o1.attemptIndex).toBe(1);

    // Attempt 2 fail
    const o2 = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.99,
    );
    expect(o2.attemptIndex).toBe(2);
  });

  it('legacy bootstrap KHÔNG inject BuffService → fail vẫn log nhưng KHÔNG insert CharacterBuff (backward-compat)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    const realtime = new RealtimeService();
    const charsNoBuffs = new CharacterService(prisma, realtime);

    const outcome = await charsNoBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.99,
    );
    expect(outcome.success).toBe(false);
    expect(outcome.debuffApplied).toBe(true); // outcome shape vẫn say applied

    // Log row vẫn tamMaActive=true (audit consistency).
    const log = await prisma.breakthroughAttemptLog.findUniqueOrThrow({
      where: { id: outcome.logId },
    });
    expect(log.tamMaActive).toBe(true);

    // Nhưng KHÔNG có CharacterBuff row (BuffService chưa inject).
    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: fix.characterId },
    });
    expect(buffs).toHaveLength(0);
  });
});

describe('CharacterService.listBreakthroughAttemptLogs (Phase 11 nâng cao §5 PR3 prep)', () => {
  let charsWithBuffs: CharacterService;

  beforeAll(async () => {
    const { BuffService } = await import('./buff.service');
    const buffSvc = new BuffService(prisma);
    const realtime = new RealtimeService();
    charsWithBuffs = new CharacterService(
      prisma,
      realtime,
      undefined,
      undefined,
      undefined,
      titleSvc,
      undefined,
      buffSvc,
    );
  });

  it('character chưa có log → return empty array', async () => {
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 1,
    });

    const rows = await chars.listBreakthroughAttemptLogs(fix.characterId);
    expect(rows).toEqual([]);
  });

  it('return rows sort theo createdAt DESC + BigInt cast → string + Date cast → ISO', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    // Attempt 1 fail (apply tam_ma_light buff)
    const o1 = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.99,
      new Date('2026-05-05T12:00:00Z'),
    );
    expect(o1.success).toBe(false);

    // Reset stage to 9 + add exp lại để attempt thứ 2 (bypass NOT_AT_PEAK).
    await prisma.character.update({
      where: { id: fix.characterId },
      data: { realmStage: 9, exp: cost },
    });

    // Attempt 2 success
    const o2 = await charsWithBuffs.attemptBreakthrough(
      fix.userId,
      () => 0.0,
      new Date('2026-05-05T12:01:00Z'),
    );
    expect(o2.success).toBe(true);

    const rows = await chars.listBreakthroughAttemptLogs(fix.characterId);
    expect(rows).toHaveLength(2);

    // DESC: row[0] = attempt mới nhất (success).
    expect(rows[0].success).toBe(true);
    expect(rows[0].attemptIndex).toBe(2);
    expect(rows[0].toRealmKey).toBe('truc_co');
    expect(rows[0].tamMaActive).toBe(false);
    expect(rows[0].tamMaExpiresAt).toBeNull();

    // row[1] = attempt cũ (fail).
    expect(rows[1].success).toBe(false);
    expect(rows[1].attemptIndex).toBe(1);
    expect(rows[1].toRealmKey).toBe('luyenkhi');
    expect(rows[1].tamMaActive).toBe(true);
    expect(typeof rows[1].tamMaExpiresAt).toBe('string');
    expect(() => new Date(rows[1].tamMaExpiresAt!).toISOString()).not.toThrow();

    // BigInt cast → string
    expect(typeof rows[0].expBefore).toBe('string');
    expect(typeof rows[0].expAfter).toBe('string');
    expect(typeof rows[1].expBefore).toBe('string');
    expect(typeof rows[1].expAfter).toBe('string');
    expect(rows[1].expBefore).toBe(cost.toString());
    expect(rows[1].expAfter).toBe(cost.toString()); // fail → no exp loss MVP

    // createdAt → ISO
    expect(typeof rows[0].createdAt).toBe('string');
    expect(() => new Date(rows[0].createdAt).toISOString()).not.toThrow();

    // Breakdown numeric fields preserved
    expect(typeof rows[0].chance).toBe('number');
    expect(typeof rows[0].baseChance).toBe('number');
    expect(typeof rows[0].rngRoll).toBe('number');
    expect(rows[0].rngRoll).toBeGreaterThanOrEqual(0);
    expect(rows[0].rngRoll).toBeLessThan(1);
  });

  it('limit=N giới hạn số rows trả về (default 20)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    // Tạo 5 fail attempts liên tiếp (KHÔNG advance, KHÔNG trừ exp ở fail MVP).
    for (let i = 0; i < 5; i++) {
      await charsWithBuffs.attemptBreakthrough(fix.userId, () => 0.99);
    }

    const rowsAll = await chars.listBreakthroughAttemptLogs(fix.characterId);
    expect(rowsAll).toHaveLength(5);

    const rows3 = await chars.listBreakthroughAttemptLogs(fix.characterId, 3);
    expect(rows3).toHaveLength(3);

    // limit=0 → service clamp tới min 1.
    const r0 = await chars.listBreakthroughAttemptLogs(fix.characterId, 0);
    expect(r0).toHaveLength(1);

    // limit < 0 → clamp tới min 1.
    const rNeg = await chars.listBreakthroughAttemptLogs(fix.characterId, -5);
    expect(rNeg).toHaveLength(1);

    // limit vượt MAX → clamp về MAX (5 row, ko vượt thực tế).
    const rMax = await chars.listBreakthroughAttemptLogs(
      fix.characterId,
      999_999,
    );
    expect(rMax).toHaveLength(5);
  });

  it('return rows chỉ của character được hỏi (no leak across users)', async () => {
    const cost = expCostForStage('luyenkhi', 9)!;
    const fixA = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });
    const fixB = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cost,
    });

    await charsWithBuffs.attemptBreakthrough(fixA.userId, () => 0.99);
    await charsWithBuffs.attemptBreakthrough(fixB.userId, () => 0.99);

    const rowsA = await chars.listBreakthroughAttemptLogs(fixA.characterId);
    expect(rowsA).toHaveLength(1);
    const rowsB = await chars.listBreakthroughAttemptLogs(fixB.characterId);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].id).not.toBe(rowsB[0].id);
  });
});
