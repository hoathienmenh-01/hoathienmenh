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

  it('breakthrough hoa_than → luyen_hu (không có title milestone) → KHÔNG insert row', async () => {
    const cost = expCostForStage('hoa_than', 9)!;
    const fix = await makeUserChar(prisma, {
      realmKey: 'hoa_than',
      realmStage: 9,
      exp: cost,
    });

    expect(titleForRealmMilestone('luyen_hu')).toBeUndefined();

    const state = await charsWithTitles.breakthrough(fix.userId);
    expect(state.realmKey).toBe('luyen_hu');

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
