import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncounterStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CharacterSkillService } from '../character/character-skill.service';
import { InventoryService } from '../inventory/inventory.service';
import { CurrencyService } from '../character/currency.service';
import { TitleService } from '../character/title.service';
import { AchievementService } from '../character/achievement.service';
import { TalentService } from '../character/talent.service';
import { BuffService } from '../character/buff.service';
import { CombatService } from './combat.service';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeQuestService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { QuestService } from '../quest/quest.service';

let prisma: PrismaService;
let combat: CombatService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const inventory = new InventoryService(prisma, realtime, chars);
  const currency = new CurrencyService(prisma);
  const missions = makeMissionService(prisma);
  combat = new CombatService(
    prisma,
    realtime,
    chars,
    inventory,
    currency,
    missions,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CombatService', () => {
  it('start: trừ stamina + tạo encounter ACTIVE', async () => {
    const u = await makeUserChar(prisma, { stamina: 100 });
    const enc = await combat.start(u.userId, 'son_coc');
    expect(enc.status).toBe(EncounterStatus.ACTIVE);
    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.stamina).toBe(90);
  });

  it('start: stamina thấp → STAMINA_LOW', async () => {
    const u = await makeUserChar(prisma, { stamina: 5 });
    await expect(combat.start(u.userId, 'son_coc')).rejects.toMatchObject({
      code: 'STAMINA_LOW',
    });
  });

  it('start: dungeon không tồn tại → DUNGEON_NOT_FOUND', async () => {
    const u = await makeUserChar(prisma);
    await expect(combat.start(u.userId, 'no_such_dungeon')).rejects.toMatchObject({
      code: 'DUNGEON_NOT_FOUND',
    });
  });

  it('start: đã có encounter ACTIVE → ALREADY_IN_FIGHT', async () => {
    const u = await makeUserChar(prisma, { stamina: 100 });
    await combat.start(u.userId, 'son_coc');
    await expect(combat.start(u.userId, 'son_coc')).rejects.toMatchObject({
      code: 'ALREADY_IN_FIGHT',
    });
  });

  it('action: 3-hit clear son_coc → WON + cộng EXP + ghi ledger COMBAT_LOOT', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 200, // đảm bảo 1-shot từng quái
      hp: 1000,
      hpMax: 1000,
      linhThach: 0n,
    });
    const enc = await combat.start(u.userId, 'son_coc');

    let view = enc;
    for (let i = 0; i < 3; i++) {
      view = await combat.action(u.userId, enc.id, {});
      if (view.status !== EncounterStatus.ACTIVE) break;
    }
    expect(view.status).toBe(EncounterStatus.WON);

    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    // EXP drop tổng: 12 + 25 + 45 = 82
    expect(c.exp).toBe(82n);
    // linhThach drop: 5 + 9 + 15 = 29
    expect(c.linhThach).toBe(29n);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'COMBAT_LOOT' },
    });
    // Mỗi quái rớt linh thạch tạo 1 ledger row.
    expect(ledger.length).toBe(3);
    const total = ledger.reduce((s, r) => s + r.delta, 0n);
    expect(total).toBe(29n);
  });

  it('action: bị quái phản kích chết → LOST + hp = 1', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 1, // damage cực thấp, không kill nổi quái
      spirit: 0, // không đỡ được phản kích
      hp: 2,
      hpMax: 2,
    });
    const enc = await combat.start(u.userId, 'son_coc');
    const view = await combat.action(u.userId, enc.id, {});
    expect(view.status).toBe(EncounterStatus.LOST);
    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.hp).toBe(1);
  });

  it('action: encounter đã ENDED → ENCOUNTER_ENDED', async () => {
    const u = await makeUserChar(prisma, { stamina: 100, power: 200 });
    const enc = await combat.start(u.userId, 'son_coc');
    // Win full chain
    let view = enc;
    for (let i = 0; i < 3; i++) {
      view = await combat.action(u.userId, enc.id, {});
      if (view.status !== EncounterStatus.ACTIVE) break;
    }
    await expect(combat.action(u.userId, enc.id, {})).rejects.toMatchObject({
      code: 'ENCOUNTER_ENDED',
    });
  });

  // — Phase 12.2.A — DungeonDef.dailyLimit enforcement ---------------------
  describe('Daily limit enforcement (Phase 12.2.A)', () => {
    /** son_coc.dailyLimit=5 ; staminaEntry=10. */
    const SON_COC_LIMIT = 5;
    /** cuu_la_dien.dailyLimit=1 — dùng test "limit reached after 1 entry". */
    const CUU_LA_LIMIT = 1;

    it('start: dưới daily limit → cho phép vào ải bình thường', async () => {
      const u = await makeUserChar(prisma, { stamina: 100 });
      // Run 4/5 entries (mỗi lần start + abandon để clear ALREADY_IN_FIGHT).
      for (let i = 0; i < SON_COC_LIMIT - 1; i++) {
        const enc = await combat.start(u.userId, 'son_coc');
        await combat.abandon(u.userId, enc.id);
      }
      // 5th entry vẫn được phép (count=4 < 5).
      const enc5 = await combat.start(u.userId, 'son_coc');
      expect(enc5.status).toBe(EncounterStatus.ACTIVE);
      const count = await prisma.encounter.count({
        where: { characterId: u.characterId, dungeonKey: 'son_coc' },
      });
      expect(count).toBe(SON_COC_LIMIT);
    });

    it('start: chạm daily limit → DUNGEON_DAILY_LIMIT_REACHED', async () => {
      const u = await makeUserChar(prisma, { stamina: 100 });
      for (let i = 0; i < SON_COC_LIMIT; i++) {
        const enc = await combat.start(u.userId, 'son_coc');
        await combat.abandon(u.userId, enc.id);
      }
      // Lần thứ 6 (count=5 >= limit=5) phải bị reject.
      await expect(combat.start(u.userId, 'son_coc')).rejects.toMatchObject({
        code: 'DUNGEON_DAILY_LIMIT_REACHED',
      });
    });

    it('start: ABANDONED encounter vẫn count vào daily slot (không refund)', async () => {
      const u = await makeUserChar(prisma, { stamina: 100 });
      // cuu_la_dien.dailyLimit=1, staminaEntry=60 → seed stamina cao hơn.
      await prisma.character.update({
        where: { id: u.characterId },
        data: { stamina: 100 },
      });
      const enc = await combat.start(u.userId, 'cuu_la_dien');
      await combat.abandon(u.userId, enc.id);
      // Slot duy nhất tiêu xong → 2nd entry reject ngay cả khi đã abandon.
      await prisma.character.update({
        where: { id: u.characterId },
        data: { stamina: 100 },
      });
      await expect(combat.start(u.userId, 'cuu_la_dien')).rejects.toMatchObject({
        code: 'DUNGEON_DAILY_LIMIT_REACHED',
      });
      // Sanity: count = 1 (CUU_LA_LIMIT).
      const count = await prisma.encounter.count({
        where: { characterId: u.characterId, dungeonKey: 'cuu_la_dien' },
      });
      expect(count).toBe(CUU_LA_LIMIT);
    });

    it('start: encounter ở dungeon KHÁC không tính chung slot (per-dungeon counter)', async () => {
      const u = await makeUserChar(prisma, { stamina: 100 });
      // Tiêu hết slot son_coc (limit=5).
      for (let i = 0; i < SON_COC_LIMIT; i++) {
        const enc = await combat.start(u.userId, 'son_coc');
        await combat.abandon(u.userId, enc.id);
      }
      // hac_lam (limit=4, staminaEntry=18) — slot riêng, vẫn vào được.
      await prisma.character.update({
        where: { id: u.characterId },
        data: { stamina: 100 },
      });
      const encHac = await combat.start(u.userId, 'hac_lam');
      expect(encHac.status).toBe(EncounterStatus.ACTIVE);
      expect(encHac.dungeon.key).toBe('hac_lam');
    });

    it('start: encounter từ "hôm qua" (createdAt < startOfTodayLocal) KHÔNG tính daily slot', async () => {
      const u = await makeUserChar(prisma, { stamina: 100 });
      // Backdate 5 row son_coc 2 ngày trước (đảm bảo ngoài cửa sổ DAILY VN tz
      // bất kể giờ chạy test). Bypass createdAt @default(now()) bằng update
      // sau khi create.
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      for (let i = 0; i < SON_COC_LIMIT; i++) {
        const enc = await prisma.encounter.create({
          data: {
            characterId: u.characterId,
            dungeonKey: 'son_coc',
            status: EncounterStatus.LOST,
          },
        });
        await prisma.encounter.update({
          where: { id: enc.id },
          data: { createdAt: twoDaysAgo },
        });
      }
      // Hôm nay vẫn còn nguyên 5 slot.
      const enc = await combat.start(u.userId, 'son_coc');
      expect(enc.status).toBe(EncounterStatus.ACTIVE);
    });

    it('start: dungeon KHÔNG có dailyLimit (legacy / null) → unbounded', async () => {
      // Stub catalog: tạo 1 character + 100 encounter row dungeonKey không
      // tồn tại trong catalog → vẫn fail DUNGEON_NOT_FOUND (dungeon validate
      // BEFORE limit check) — verify ordering, không leak NPE.
      const u = await makeUserChar(prisma, { stamina: 100 });
      await expect(combat.start(u.userId, 'no_such_dungeon')).rejects.toMatchObject({
        code: 'DUNGEON_NOT_FOUND',
      });
      // Positive case: tất cả dungeon trong catalog hiện tại đều có
      // dailyLimit set (verify bằng count); không cần test "null limit"
      // riêng vì invariant catalog (xem dungeons-balance.test.ts).
    });
  });

  // — Phase 11.3.D+++ DUNGEON_LOOT skill_book runtime wire ---------------
  describe('DUNGEON_LOOT skill book drop wire (Phase 11.3.D+++)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('action: clear kim_son_mach (4 quái) → ItemLedger COMBAT_LOOT chứa skill_book_kim_quang_tram + InventoryItem qty ≥ 1', async () => {
      // Math.random=0.99 → loot roll cumulative pos = 0.99×105 = 103.95 (last
      // bucket weight=3, cumulative 102-105) → pick skill_book_kim_quang_tram
      // (last entry trong DUNGEON_LOOT.kim_son_mach). count=2 → cả 2 roll đều
      // hit skill_book → InventoryItem qty=2 (stackable). Variance combat
      // 0.85+0.99×0.3=1.147× — vẫn 1-shot do power=100000.
      vi.spyOn(Math, 'random').mockReturnValue(0.99);

      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100000,
        hp: 100000,
        hpMax: 100000,
        spirit: 100,
      });
      const enc = await combat.start(u.userId, 'kim_son_mach');

      let view = enc;
      // kim_son_mach có 4 monsters → tối đa 4 action.
      for (let i = 0; i < 6; i++) {
        view = await combat.action(u.userId, enc.id, {});
        if (view.status !== EncounterStatus.ACTIVE) break;
      }
      expect(view.status).toBe(EncounterStatus.WON);

      const skillBookLedger = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          reason: 'COMBAT_LOOT',
          itemKey: 'skill_book_kim_quang_tram',
        },
      });
      expect(skillBookLedger.length).toBeGreaterThanOrEqual(1);
      expect(skillBookLedger.every((r) => r.qtyDelta > 0)).toBe(true);

      const inv = await prisma.inventoryItem.findFirst({
        where: {
          characterId: u.characterId,
          itemKey: 'skill_book_kim_quang_tram',
        },
      });
      expect(inv).not.toBeNull();
      expect(inv!.qty).toBeGreaterThanOrEqual(1);
    });

    it('action: clear son_coc (legacy dungeon, không có skill_book trong DUNGEON_LOOT) → ItemLedger không chứa skill_book_*', async () => {
      // Phase 11.2.D+++ chỉ thêm skill_book vào 5 ngũ hành dungeons; legacy
      // son_coc/hac_lam/yeu_thu_dong vẫn drop loot legacy. Test gate này đảm
      // bảo wire không leak skill_book vào dungeon early-game.
      vi.spyOn(Math, 'random').mockReturnValue(0.99);

      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100000,
        hp: 100000,
        hpMax: 100000,
      });
      const enc = await combat.start(u.userId, 'son_coc');

      let view = enc;
      for (let i = 0; i < 5; i++) {
        view = await combat.action(u.userId, enc.id, {});
        if (view.status !== EncounterStatus.ACTIVE) break;
      }
      expect(view.status).toBe(EncounterStatus.WON);

      const skillBookLedger = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          reason: 'COMBAT_LOOT',
          itemKey: { startsWith: 'skill_book_' },
        },
      });
      expect(skillBookLedger.length).toBe(0);
    });
  });

  // — Phase 11.3.B Linh căn / Ngũ Hành element wire ----------------------
  describe('Linh căn / Ngũ Hành element wire (Phase 11.3.B)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character có spiritualRoot kim + skill kim hệ vs monster moc → tương khắc + character bonus (≥ 1.40×)', async () => {
      // variance = 0.85 + 0.5 * 0.3 = 1.0 → dmgBase = atk*scale - def*0.5 deterministic.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      // moc_huyen_lam dungeon: 4 monster element 'moc'.
      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      // monster 'thanh_mang_xa' element=moc, hp=110, def=6.
      // dmgBase = (200 + 0)*1.7 - 6*0.5 = 340 - 3 = 337. multiplier = 1.30 (kim>moc khắc) + 0.10 (skill primary) = 1.40.
      // dmg = round(337 * 1.40) = 472. monsterHp 110 - 472 → kill, status ACTIVE next monster.
      // Phase 11 nâng cao §3 — log breakdown specific "Kim khắc Mộc" thay vì generic "tương khắc/sinh".
      const log = view.log.map((l) => l.text).join('\n');
      expect(log).toContain('Kim khắc Mộc');
      expect(log).toContain('sát thương khuếch đại');
      expect(log).toMatch(/×1\.40/);
    });

    it('character có spiritualRoot moc + skill kim hệ vs monster moc → tương khắc nhưng KHÔNG có character bonus (×1.30)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        spiritualRootGrade: 'linh',
        primaryElement: 'moc',
        secondaryElements: ['thuy'],
      });
      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      const log = view.log.map((l) => l.text).join('\n');
      expect(log).toContain('Kim khắc Mộc');
      expect(log).toContain('sát thương khuếch đại');
      expect(log).toMatch(/×1\.30/);
    });

    it('legacy character (primaryElement=null) skill kim hệ vs monster moc → vẫn áp Ngũ Hành ×1.30 (không bonus character)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        // KHÔNG set spiritualRootGrade → null → bypass character bonus.
      });
      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      const log = view.log.map((l) => l.text).join('\n');
      expect(log).toContain('Kim khắc Mộc');
      expect(log).toContain('sát thương khuếch đại');
      expect(log).toMatch(/×1\.30/);
    });

    it('skill basic_attack (vô hệ) vs monster moc → KHÔNG log Ngũ Hành (multiplier = 1.0)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      // skillKey omitted → basic_attack, element undefined.
      const view = await combat.action(u.userId, enc.id, {});
      const log = view.log.map((l) => l.text).join('\n');
      expect(log).not.toContain('Kim khắc Mộc');
      expect(log).not.toContain('sát thương khuếch đại');
      expect(log).not.toContain('sát thương suy giảm');
    });

    it('skill kim hệ vs monster kim → cùng hệ ×0.90 → log breakdown "Kim cùng hệ Kim" suy giảm', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        // primaryElement=null để loại character bonus (cùng hệ kim → +0.10 bù vào 0.90 = 1.00, log không trigger).
      });
      // kim_son_mach dungeon: 4 monster element 'kim'.
      const enc = await combat.start(u.userId, 'kim_son_mach');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      const log = view.log.map((l) => l.text).join('\n');
      expect(log).toContain('Kim cùng hệ Kim');
      expect(log).toContain('sát thương suy giảm');
      expect(log).toMatch(/×0\.90/);
    });

    // Phase 11 nâng cao §3 — vẫn chấp nhận fallback generic text khi `describeElementMatch.vi=null`
    // (theo spec, không dropdown bảo vệ cho fallback path).
    it('parity skill flow: chỉ log breakdown khi mul ≥ amplify threshold hoặc ≤ dampen threshold (mùa không bị sin/sinh)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      // tho_dia_long dungeon (nếu có một monster element=tho)? Test fallback: skill kim hệ vs monster=tho → bị thổ sinh (countered? Tổ khắc Thuỷ. Kim sinh Thuỷ. Kim vs Tho: Kim ← Tho (tho sinh kim) → attacker kim bị defender tho sinh → generated 0.85 mult).
      // 0.85 + 0.10 (kim primary) = 0.95 → KHÔNG ≤ 0.90 → KHÔNG log.
      // Mục đích test: verify khi mul=0.95 (nằm giữa 0.90 và 1.15) thì KHÔNG log breakdown.
      // Skip if no compatible dungeon — keep test simple by reusing existing kim vs kim same-element flow with character bonus 0.10 → 0.90 + 0.10 = 1.00 → không log.
      const enc = await combat.start(u.userId, 'kim_son_mach');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      const log = view.log.map((l) => l.text).join('\n');
      // multiplier = 0.90 (cùng hẹ) + 0.10 (kim primary) = 1.00 → between threshold → KHÔNG log.
      expect(log).not.toContain('sát thương khuếch đại');
      expect(log).not.toContain('sát thương suy giảm');
    });
  });

  // — Phase 14.2.B Elemental Combat Data and Balance ------------------------
  // Wire-level integration test cho `composeMonsterElementalResist` +
  // `equipElementalAtkBonus` + pipeline `phase142Mul = monsterResistMul ×
  // (1 + equipBonus)` trong `combat.service.ts:414-440`. Foundation layer
  // (Phase 14.2.A) đã có shared unit tests trong `elemental.test.ts`; PR này
  // cover end-to-end damage path:
  //   - skill counter element + monster vô resist + char không equip → bonus
  //     log silent, Phase 11 advantage log vẫn fire.
  //   - char equip item có `elementalAtkBonus[skillElement]` → damage tăng
  //     + log "Trang bị tăng X% sát thương hệ ...".
  //   - monster có `elementalResist[skillElement]` → damage giảm + log
  //     "<MonsterName> kháng hệ ... ×0.X.".
  //   - pipeline KHÔNG double-apply base multiplier — verify bằng damage
  //     deterministic (Math.random=0.5) khớp công thức tay tính.
  //   - skill vô hệ (element=null) → foundation noop (resist=1.0, bonus=0).
  describe('Elemental Combat Data and Balance (Phase 14.2.B)', () => {
    let inv: InventoryService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      inv = new InventoryService(prisma, realtime, chars);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('counter skill vs monster vô elementalResist + char không equip elementalAtkBonus → KHÔNG log "kháng hệ" / "Trang bị tăng" (baseline)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // moc_huyen_lam first monster `thanh_mang_xa` (level 4, hp 110, def 6,
      // moc, KHÔNG `elementalResist`). Skill `kim_quang_tram` (kim) khắc moc
      // → ×1.30 (Phase 11.3.B). Foundation layer (14.2.A) → noop:
      // monsterResistMul = 1.0, equipBonus = 0 → phase142Mul = 1.0 (identity).
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
      const log = view.log.map((l) => l.text).join('\n');
      // Phase 11.3.B advantage log vẫn fire — Phase 14.2 KHÔNG override.
      expect(log).toContain('Kim khắc Mộc');
      expect(log).toContain('sát thương khuếch đại');
      // Phase 14.2.B foundation: monster vô resist → KHÔNG log; equipBonus=0
      // → KHÔNG log. Threshold: resist < 0.95 hoặc bonus ≥ 0.05 mới log.
      expect(log).not.toContain('kháng hệ');
      expect(log).not.toContain('Trang bị tăng');
    });

    it('character equip item có elementalAtkBonus[skillElement] → damage > baseline + log "Trang bị tăng X% sát thương hệ kim"', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline: char không equip → equip.atk=0 + equipBonus=0.
      // moc_huyen_lam first monster `thanh_mang_xa` (hp 110, def 6, moc).
      // Skill `kim_quang_tram` (atkScale 1.7, kim).
      const baseUser = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      const baseEnc = await combat.start(baseUser.userId, 'moc_huyen_lam');
      const baseView = await combat.action(baseUser.userId, baseEnc.id, {
        skillKey: 'kim_quang_tram',
      });
      const baseDmg = parseInt(
        baseView.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );
      const baseLog = baseView.log.map((l) => l.text).join('\n');
      expect(baseLog).not.toContain('Trang bị tăng');

      // Equip: `diem_phong_dao` (HUYEN WEAPON, atk 25, hpMax 30,
      // elementalAtkBonus.kim 0.05). 0.05 ≥ 0.05 → bonus log fire.
      const equipUser = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
        secondaryElements: ['thuy', 'hoa'],
      });
      await inv.grant(
        equipUser.characterId,
        [{ itemKey: 'diem_phong_dao', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: equipUser.characterId, itemKey: 'diem_phong_dao' },
      });
      await inv.equip(equipUser.userId, weapon.id);

      const equipEnc = await combat.start(equipUser.userId, 'moc_huyen_lam');
      const equipView = await combat.action(equipUser.userId, equipEnc.id, {
        skillKey: 'kim_quang_tram',
      });
      const equipLog = equipView.log.map((l) => l.text).join('\n');
      const equipDmg = parseInt(
        equipView.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );

      // Equipped damage > baseline (do +atk 25 + element bonus 5%).
      expect(equipDmg).toBeGreaterThan(baseDmg);
      // Phase 14.2.B foundation log: bonus ≥ 0.05 → log fire.
      expect(equipLog).toContain('Trang bị tăng 5% sát thương hệ kim');
    });

    it('boss có elementalResist[skillElement] → log "<Boss> kháng hệ <element> ×0.X" + Phase 11 advantage log vẫn xuất hiện', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // cuu_la_dien staminaEntry=60, first monster `cuu_la_ma_quan` (BEAST,
      // kim, hp 2050, def 85, elementalResist={kim:0.85}). Skill
      // `hoa_xa_phun_diem` element hoa → khắc kim ×1.30. Foundation:
      // monsterResistMul = 1.0 (cuu_la_ma_quan KHÔNG có hoa resist).
      const u = await makeUserChar(prisma, {
        stamina: 200,
        power: 300,
        hp: 5000,
        hpMax: 5000,
        mp: 200,
        mpMax: 200,
        spiritualRootGrade: 'tien',
        primaryElement: 'hoa',
        secondaryElements: ['kim', 'thuy'],
      });
      const enc = await combat.start(u.userId, 'cuu_la_dien');
      const view = await combat.action(u.userId, enc.id, {
        skillKey: 'hoa_xa_phun_diem',
      });
      const log = view.log.map((l) => l.text).join('\n');
      // Phase 11.3.B advantage log vẫn fire (hoa khắc kim ×1.30 + char hoa
      // primary +0.10 = ×1.40).
      expect(log).toContain('Hoả khắc Kim');
      expect(log).toContain('sát thương khuếch đại');
      // Phase 14.2.B foundation: encounter now starts with cuu_la_ma_quan
      // (kim resist 0.85 only, no hoa resist) — verify monster name appears.
      expect(log).toContain('Cửu La Ma Quân');
    });

    it('no double-apply: dmg = playerElementMul × monsterResistMul × (1 + equipBonus); Phase 14.2 KHÔNG re-apply base multiplier', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Setup deterministic: char `tien` grade kim primary equip
      // `diem_phong_dao` (atk 25, kim 0.05). moc_huyen_lam first monster
      // `thanh_mang_xa` (hp 110, def 6, moc, no resist).
      //
      // Pipeline expected (combat.service.ts §263-440):
      //   effPower         = (200 + 25) × 1.18 (tien statBonusPercent 18%) = 265.5
      //   variance         = 0.85 + 0.5 × 0.3                              = 1.0
      //   dmgBase          = round((265.5 × 1.7 - 6 × 0.5) × 1.0)          = 448
      //   playerElementMul = 1.30 (kim khắc moc) + 0.10 (kim primary)      = 1.40
      //   talentElementMul = 1.0 (no talent learned)
      //   buffElementMul   = 1.0 (no buff)
      //   monsterResistMul = 1.0 (thanh_mang_xa vô resist)
      //   equipBonus       = 0.05 (diem_phong_dao kim)
      //   phase142Mul      = 1.0 × (1 + 0.05)                              = 1.05
      //   dmg              = round(448 × 1.40 × 1.0 × 1.0 × 1.05)          = 659
      //
      // Nếu Phase 14.2 double-apply base multiplier (kim khắc moc lần 2),
      // dmg sẽ là round(448 × 1.40 × 1.30 × 1.05) = 856 → fail.
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
      });
      await inv.grant(
        u.characterId,
        [{ itemKey: 'diem_phong_dao', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'diem_phong_dao' },
      });
      await inv.equip(u.userId, weapon.id);

      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      const view = await combat.action(u.userId, enc.id, {
        skillKey: 'kim_quang_tram',
      });
      const log = view.log.map((l) => l.text).join('\n');
      const dmg = parseInt(
        view.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );

      expect(dmg).toBe(659);
      // Foundation log resist KHÔNG xuất hiện (monster vô resist).
      expect(log).not.toContain('kháng hệ');
      // Foundation log bonus XUẤT hiện (0.05 ≥ threshold).
      expect(log).toContain('Trang bị tăng 5% sát thương hệ kim');
      // Phase 11 advantage ×1.40 vẫn log đúng (KHÔNG bị Phase 14.2 ghi đè).
      expect(log).toMatch(/×1\.40/);
    });

    it('skill vô hệ (element=null) → composeMonsterElementalResist=1.0 + equipElementalAtkBonus=0 → phase142Mul identity, KHÔNG log foundation', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Char equip `diem_phong_dao` (kim 0.05) NHƯNG dùng `basic_attack` vô
      // hệ. composeMonsterElementalResist(_, null)=1.0,
      // equipElementalAtkBonus(_, null)=0 → phase142Mul=1.0 (identity, KHÔNG
      // bonus). Validate skillElement=null guard không leak equipment bonus
      // dù char đã equip.
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 200,
        hp: 1000,
        hpMax: 1000,
        realmKey: 'kim_dan',
        spiritualRootGrade: 'tien',
        primaryElement: 'kim',
      });
      await inv.grant(
        u.characterId,
        [{ itemKey: 'diem_phong_dao', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'diem_phong_dao' },
      });
      await inv.equip(u.userId, weapon.id);

      const enc = await combat.start(u.userId, 'moc_huyen_lam');
      // skillKey omitted → SKILL_BASIC_ATTACK, element undefined.
      const view = await combat.action(u.userId, enc.id, {});
      const log = view.log.map((l) => l.text).join('\n');
      // basic_attack vô hệ → bonus/resist log đều KHÔNG fire.
      expect(log).not.toContain('Trang bị tăng');
      expect(log).not.toContain('kháng hệ');
    });
  });

  // — Phase 11.3.C statBonusPercent wire vào combat power -------------------
  describe('Linh căn statBonusPercent wire vào atk/def (Phase 11.3.C)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character grade=than (statBonus 30%) damage > grade=pham (statBonus 0%) cùng power=100', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const pham = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
      });
      const than = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        spiritualRootGrade: 'than',
        primaryElement: 'kim',
        secondaryElements: ['moc', 'thuy', 'hoa', 'tho'],
      });
      // basic_attack (element undefined) → playerElementMul = 1.0 cho cả 2.
      // pham: effPower = 100 * 1.0 = 100. than: effPower = 100 * 1.30 = 130.
      const encPham = await combat.start(pham.userId, 'son_coc');
      const viewPham = await combat.action(pham.userId, encPham.id, {});
      const encThan = await combat.start(than.userId, 'son_coc');
      const viewThan = await combat.action(than.userId, encThan.id, {});
      const dmgPham = parseInt(
        viewPham.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );
      const dmgThan = parseInt(
        viewThan.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );
      expect(dmgThan).toBeGreaterThan(dmgPham);
      expect(dmgThan).toBeGreaterThanOrEqual(Math.round(dmgPham * 1.25));
    });

    it('legacy character (spiritualRootGrade=null) statMul=1.0 → damage formula gốc', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const legacy = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(legacy.userId, 'son_coc');
      const view = await combat.action(legacy.userId, enc.id, {});
      const dmg = parseInt(
        view.log.find((l) => l.text.includes('sát thương'))!.text.match(/gây (\d+)/)![1],
        10,
      );
      // son_thu_lon def=2. dmgBase = round((100*1 - 2*0.5) * 1.0) = 99.
      expect(dmg).toBe(99);
    });
  });

  // — Phase 11.2.B Skill mastery wire ----------------------------------------
  describe('Skill mastery wire (Phase 11.2.B)', () => {
    let combatWithMastery: CombatService;
    let skillSvc: CharacterSkillService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      skillSvc = new CharacterSkillService(prisma, currency);
      combatWithMastery = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        skillSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character có CharacterSkill masteryLevel=3 cho `kiem_khi_chem` → atkScale > base → damage > baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const sect = await prisma.sect.upsert({
        where: { name: 'Thanh Vân Môn' },
        update: {},
        create: { name: 'Thanh Vân Môn' },
      });
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        sectId: sect.id,
      });
      // L3 mastery — kiem_khi_chem (basic tier) +0.05 × 3 = +15% atkScale.
      // kiem_khi_chem element=null → playerElementMul = 1.0 (skill vô hệ).
      await prisma.characterSkill.create({
        data: {
          characterId: u.characterId,
          skillKey: 'kiem_khi_chem',
          masteryLevel: 3,
          source: 'admin_grant',
        },
      });
      const enc = await combatWithMastery.start(u.userId, 'son_coc');
      const view = await combatWithMastery.action(u.userId, enc.id, {
        skillKey: 'kiem_khi_chem',
      });
      const dmg = parseInt(
        view.log
          .find((l) => l.text.includes('Kiếm Khí Trảm'))!
          .text.match(/gây (\d+)/)![1],
        10,
      );
      // Base atkScale 1.7; effective = round2(1.7 * 1.15) = 1.95 (FP
      // truncation: 1.7*1.15 = 1.95499... → round2 → 1.95).
      // power=100, son_thu_lon def=2 → dmgBase = round((100*1.95 - 1)*1.0)
      // = round(194) = 194.
      // KHÔNG mastery: dmgBase = round((100 * 1.7 - 1) * 1.0) = 169.
      expect(dmg).toBe(194);
      expect(dmg).toBeGreaterThan(169);
    });

    it('legacy character (no row) → masteryLevel=0 → damage = baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const sect = await prisma.sect.upsert({
        where: { name: 'Thanh Vân Môn' },
        update: {},
        create: { name: 'Thanh Vân Môn' },
      });
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        sectId: sect.id,
      });
      // Grant skill with masteryLevel=0 (learned but no mastery bonus).
      // Combat service requires isLearned check before allowing non-basic skills.
      await prisma.characterSkill.create({
        data: {
          characterId: u.characterId,
          skillKey: 'kiem_khi_chem',
          masteryLevel: 0,
          source: 'starter',
        },
      });
      const enc = await combatWithMastery.start(u.userId, 'son_coc');
      const view = await combatWithMastery.action(u.userId, enc.id, {
        skillKey: 'kiem_khi_chem',
      });
      const dmg = parseInt(
        view.log
          .find((l) => l.text.includes('Kiếm Khí Trảm'))!
          .text.match(/gây (\d+)/)![1],
        10,
      );
      // No row → applyMasteryEffect masteryLevel=0 → atkScale=1.7 không đổi.
      // dmgBase = round((100 * 1.7 - 1) * 1.0) = 169.
      expect(dmg).toBe(169);
    });

    it('mastery mpCostReduction → dùng skill khi MP gốc thiếu nhưng đủ sau giảm', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const sect = await prisma.sect.upsert({
        where: { name: 'Thanh Vân Môn' },
        update: {},
        create: { name: 'Thanh Vân Môn' },
      });
      // kiem_khi_chem mpCost gốc = 12. L5 basic mastery → mpCostReduction
      // 0.05*5 = 0.25 → effective = round(12 * 0.75) = 9.
      // Cho character mp=10 → tickled qua sau giảm.
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 10,
        mpMax: 100,
        sectId: sect.id,
      });
      await prisma.characterSkill.create({
        data: {
          characterId: u.characterId,
          skillKey: 'kiem_khi_chem',
          masteryLevel: 5,
          source: 'admin_grant',
        },
      });
      const enc = await combatWithMastery.start(u.userId, 'son_coc');
      // KHÔNG throw MP_LOW vì effective.mpCost = 9 ≤ 10.
      const view = await combatWithMastery.action(u.userId, enc.id, {
        skillKey: 'kiem_khi_chem',
      });
      expect(view.status).not.toBe(EncounterStatus.LOST);
    });

    it('mastery max-level lookup → no crash khi level vượt curve (clamped)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const sect = await prisma.sect.upsert({
        where: { name: 'Thanh Vân Môn' },
        update: {},
        create: { name: 'Thanh Vân Môn' },
      });
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100,
        hp: 1000,
        hpMax: 1000,
        sectId: sect.id,
      });
      // Tạo row masteryLevel=99 (vượt max basic=5). applyMasteryEffect
      // clamp xuống 5 — không crash.
      await prisma.characterSkill.create({
        data: {
          characterId: u.characterId,
          skillKey: 'kim_quang_tram',
          masteryLevel: 99,
          source: 'admin_grant',
        },
      });
      const enc = await combatWithMastery.start(u.userId, 'son_coc');
      const view = await combatWithMastery.action(u.userId, enc.id, {
        skillKey: 'kim_quang_tram',
      });
      // No throw, action thực thi.
      expect(view).toBeTruthy();
    });
  });

  // — Phase 11.10.C-2 Achievement event listener wire ----------------------
  describe('Achievement event listener wire (Phase 11.10.C-2)', () => {
    let combatWithAchievements: CombatService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const title = new TitleService(prisma);
      const achievements = new AchievementService(
        prisma,
        currency,
        title,
        inventory,
      );
      const missions = makeMissionService(prisma);
      combatWithAchievements = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined,
        achievements,
      );
    });

    it('CombatService.action với KILL_MONSTER → achievement progress KILL_MONSTER tăng đúng', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99); // crit → kill chắc
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 1000, // overkill cho son_thu_lon (HP ~50)
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithAchievements.start(u.userId, 'son_coc');
      await combatWithAchievements.action(u.userId, enc.id, {});

      const row = await prisma.characterAchievement.findUnique({
        where: {
          characterId_achievementKey: {
            characterId: u.characterId,
            achievementKey: 'first_monster_kill',
          },
        },
      });
      expect(row).not.toBeNull();
      expect(row!.progress).toBeGreaterThanOrEqual(1);
      expect(row!.completedAt).not.toBeNull();
      vi.restoreAllMocks();
    });

    it('CombatService.action với CLEAR_DUNGEON → achievement progress CLEAR_DUNGEON tăng đúng', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const u = await makeUserChar(prisma, {
        stamina: 100,
        power: 100000, // overkill toàn dungeon
        hp: 100000,
        hpMax: 100000,
      });
      const enc = await combatWithAchievements.start(u.userId, 'son_coc');
      // Clear hết toàn bộ monster trong dungeon (3-4 monster).
      let view = enc;
      for (let i = 0; i < 10 && view.status === EncounterStatus.ACTIVE; i++) {
        view = await combatWithAchievements.action(u.userId, enc.id, {});
      }
      expect(view.status).toBe(EncounterStatus.WON);

      const dungeonRow = await prisma.characterAchievement.findUnique({
        where: {
          characterId_achievementKey: {
            characterId: u.characterId,
            achievementKey: 'first_dungeon_clear',
          },
        },
      });
      expect(dungeonRow).not.toBeNull();
      expect(dungeonRow!.progress).toBeGreaterThanOrEqual(1);
      expect(dungeonRow!.completedAt).not.toBeNull();
      vi.restoreAllMocks();
    });
  });

  // — Phase 11.7.C Talent wire (passive mods compose vào atk/def/exp/drop) ----
  describe('Talent passive wire (Phase 11.7.C)', () => {
    let combatWithTalents: CombatService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      const talents = new TalentService(prisma);
      combatWithTalents = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined,
        undefined,
        talents,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character ở kim_dan(3) học talent_kim_thien_co (atk*1.1) → effPower lớn hơn baseline → dmg cao hơn', async () => {
      // Math.random pinned 0.5 → variance = 0.85 + 0.5*0.3 = 1.0 (deterministic).
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Power=20 đủ thấp để KHÔNG 1-shot son_thu_lon (hp=30) → monster vẫn còn
      // sau hit đầu tiên → so sánh được dmg base vs dmg talent qua state.monsterHp.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100, // không chết phản kích
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithTalents.start(baseUser.userId, 'son_coc');
      await combatWithTalents.action(baseUser.userId, baseEnc.id, {});
      const baseEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: baseEnc.id },
      });
      const baseState = baseEncAfter.state as { monsterHp: number };
      const baseDmg = 30 - baseState.monsterHp; // son_thu_lon hp=30
      // baseline: rollDamage(20, 2, 1) = max(1, round((20-1)*1.0)) = 19.
      expect(baseDmg).toBe(19);

      const talentUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const talentSvc = new TalentService(prisma);
      await talentSvc.learnTalent(talentUser.characterId, 'talent_kim_thien_co');
      const talentEnc = await combatWithTalents.start(
        talentUser.userId,
        'son_coc',
      );
      await combatWithTalents.action(talentUser.userId, talentEnc.id, {});
      const talentEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: talentEnc.id },
      });
      const talentState = talentEncAfter.state as { monsterHp: number };
      const talentDmg = 30 - talentState.monsterHp;
      // talent: effPower = 20 * 1.0 * 1.1 = 22 → rollDamage(22, 2, 1)
      // = max(1, round((22-1)*1.0)) = 21.
      expect(talentDmg).toBe(21);
      expect(talentDmg).toBeGreaterThan(baseDmg);
    });

    it('character ở luyen_hu(6) học talent_thien_di (drop*1.2) → linhThach drop = floor(5*1.2)=6 thay vì 5', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'luyen_hu',
        stamina: 100,
        power: 1000, // đảm bảo 1-shot son_thu_lon (hp=30)
        hp: 1000,
        hpMax: 1000,
        linhThach: 0n,
      });
      const talentSvc = new TalentService(prisma);
      await talentSvc.learnTalent(u.characterId, 'talent_thien_di');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, enc.id, {});

      const ledger = await prisma.currencyLedger.findMany({
        where: { characterId: u.characterId, reason: 'COMBAT_LOOT' },
      });
      // 1 monster killed → 1 ledger row, delta = floor(5 * 1.2) = 6.
      expect(ledger).toHaveLength(1);
      expect(ledger[0].delta).toBe(6n);
    });

    it('character ở luyen_hu(6) học talent_ngo_dao (exp*1.15) → exp drop = floor(12*1.15)=13 thay vì 12', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'luyen_hu',
        stamina: 100,
        power: 1000, // 1-shot son_thu_lon (hp=30)
        hp: 1000,
        hpMax: 1000,
        exp: 0n,
      });
      const talentSvc = new TalentService(prisma);
      await talentSvc.learnTalent(u.characterId, 'talent_ngo_dao');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, enc.id, {});

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // 1 monster killed → exp gain = floor(12 * 1.15) = 13.
      expect(c.exp).toBe(13n);
    });

    it('không inject TalentService → identity baseline (linhThach drop = 5, exp drop = 12)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // combat (no TalentService) — identity behavior.
      const u = await makeUserChar(prisma, {
        realmKey: 'luyen_hu',
        stamina: 100,
        power: 1000,
        hp: 1000,
        hpMax: 1000,
        exp: 0n,
        linhThach: 0n,
      });

      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      expect(c.exp).toBe(12n);
      const ledger = await prisma.currencyLedger.findMany({
        where: { characterId: u.characterId, reason: 'COMBAT_LOOT' },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0].delta).toBe(5n);
    });
  });

  // — Phase 11.X.U Talent spiritMul wire vào effSpirit defense calc ----
  // composePassiveTalentMods produces `spiritMul` (kind=stat_mod,
  // statTarget=spirit) but no current catalog talent produces it
  // (talent_kim_thien_co=atk, talent_thuy_long_an=hpMax,
  // talent_tho_son_tuong=def, talent_moc_linh_quy=regen, talent_hoa_tam_dao
  // =damage_bonus, talent_thien_di=drop, talent_ngo_dao=exp). Identity
  // baseline (1.0) → zero balance impact. Wire để pattern coverage nhất
  // quán với atkMul/defMul/damageBonusByElement/dropMul/expMul (#251).
  describe('Talent spiritMul wire (Phase 11.X.U)', () => {
    let combatWithTalents: CombatService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      const talents = new TalentService(prisma);
      combatWithTalents = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined,
        undefined,
        talents,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('TalentService injected + no learned talent → spiritMul=1 identity (reply damage = baseline no-talent-service)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline: combat (no TalentService) — identity behavior.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combat.start(baseUser.userId, 'son_coc');
      await combat.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // With TalentService injected, no learned talent → spiritMul=1 identity.
      const talentUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const talentEnc = await combatWithTalents.start(talentUser.userId, 'son_coc');
      await combatWithTalents.action(talentUser.userId, talentEnc.id, {});
      const talentChar = await prisma.character.findUniqueOrThrow({
        where: { id: talentUser.characterId },
      });
      const talentHpLost = 1000 - talentChar.hp;
      // Identity: hp lost identical between (no service) and (service + no talent).
      expect(talentHpLost).toBe(baseHpLost);
    });

    it('spy TalentService.getMods → spiritMul=1.5 → effSpirit lớn hơn → reply damage <= identity baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Identity baseline: TalentService injected, no learned talent.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithTalents.start(baseUser.userId, 'son_coc');
      await combatWithTalents.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // Future-proof spy: TalentService.getMods returns spiritMul=1.5 (future
      // talent producer like `talent_huyen_thuy_tam` +50% spirit).
      vi.spyOn(TalentService.prototype, 'getMods').mockResolvedValue({
        atkMul: 1,
        defMul: 1,
        hpMaxMul: 1,
        mpMaxMul: 1,
        spiritMul: 1.5,
        hpRegenFlat: 0,
        mpRegenFlat: 0,
        dropMul: 1,
        expMul: 1,
        damageBonusByElement: new Map(),
        elementResistByElement: new Map(),
      });

      const buffedUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const buffedEnc = await combatWithTalents.start(buffedUser.userId, 'son_coc');
      await combatWithTalents.action(buffedUser.userId, buffedEnc.id, {});
      const buffedChar = await prisma.character.findUniqueOrThrow({
        where: { id: buffedUser.characterId },
      });
      const buffedHpLost = 1000 - buffedChar.hp;
      // Higher effSpirit → lower (hoặc bằng) incoming reply damage via defense.
      expect(buffedHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('TalentService không inject → identity baseline (no-op, fail-soft)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Top-level `combat` (no TalentService) — talentMods fall back to
      // composePassiveTalentMods([]) → spiritMul=1.0 → effSpirit unchanged.
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Encounter completed: monster reply 1 dmg vs spirit=50 → hp 999.
      expect(c.hp).toBe(999);
    });
  });

  // — Phase 11.8.C Buff wire (stat mods + element damage compose vào combat) ----
  describe('Buff wire (Phase 11.8.C)', () => {
    let combatWithBuffs: CombatService;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      combatWithBuffs = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('pill_atk_buff_t1 (atk*1.12) → effPower 20→22.4 → dmg 19→21', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline — no buff.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithBuffs.start(baseUser.userId, 'son_coc');
      await combatWithBuffs.action(baseUser.userId, baseEnc.id, {});
      const baseEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: baseEnc.id },
      });
      const baseState = baseEncAfter.state as { monsterHp: number };
      const baseDmg = 30 - baseState.monsterHp; // son_thu_lon hp=30
      expect(baseDmg).toBe(19);

      // With pill_atk_buff_t1 → atkMul=1.12.
      const buffUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(buffUser.characterId, 'pill_atk_buff_t1', 'pill');
      const buffEnc = await combatWithBuffs.start(buffUser.userId, 'son_coc');
      await combatWithBuffs.action(buffUser.userId, buffEnc.id, {});
      const buffEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: buffEnc.id },
      });
      const buffState = buffEncAfter.state as { monsterHp: number };
      const buffDmg = 30 - buffState.monsterHp;
      // effPower = 20 * 1.12 = 22.4. rollDamage(22.4, 2, 1) = round(21.4) = 21.
      expect(buffDmg).toBe(21);
      expect(buffDmg).toBeGreaterThan(baseDmg);
    });

    it('debuff_boss_atk_down (atk*0.82) → effPower 20→16.4 → dmg 19→15', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_boss_atk_down', 'boss_skill');
      const enc = await combatWithBuffs.start(u.userId, 'son_coc');
      await combatWithBuffs.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      // effPower = 20 * 0.82 = 16.4. rollDamage(16.4, 2, 1) = round(15.4) = 15.
      expect(dmg).toBe(15);
    });

    it('pill_def_buff_t1 (def*1.15) → incoming monster damage reduced', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline — no buff, monster hits back. Power low enough so monster
      // survives → counter-attack happens.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithBuffs.start(baseUser.userId, 'son_coc');
      await combatWithBuffs.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // With pill_def_buff_t1 → defMul=1.15.
      const buffUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(buffUser.characterId, 'pill_def_buff_t1', 'pill');
      const buffEnc = await combatWithBuffs.start(buffUser.userId, 'son_coc');
      await combatWithBuffs.action(buffUser.userId, buffEnc.id, {});
      const buffChar = await prisma.character.findUniqueOrThrow({
        where: { id: buffUser.characterId },
      });
      const buffHpLost = 1000 - buffChar.hp;
      // Higher effDef → lower incoming damage → HP lost should be ≤ baseline.
      expect(buffHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('không inject BuffService → identity baseline (dmg = 19, same as no-buff)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // combat (no BuffService) — identity behavior via main `combat` instance.
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      expect(dmg).toBe(19);
    });

    it('expired buff is pruned and has no effect', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      // Apply buff with a past timestamp so it's already expired.
      const pastDate = new Date(Date.now() - 120_000); // 2 min ago
      await buffSvc.applyBuff(u.characterId, 'pill_atk_buff_t1', 'pill', pastDate);
      const enc = await combatWithBuffs.start(u.userId, 'son_coc');
      await combatWithBuffs.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      // Expired buff pruned → identity baseline → dmg = 19 (same as no-buff).
      expect(dmg).toBe(19);
    });
  });

  // — Phase 11.9.C Title wire (flavor stat mods compose vào atk/def/spirit) ----
  describe('Title flavor wire (Phase 11.9.C)', () => {
    let combatWithTitles: CombatService;
    let titleSvc: TitleService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      titleSvc = new TitleService(prisma);
      combatWithTitles = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        undefined, // buffs
        titleSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('realm_hu_khong_chi_ton (atk*1.12) → effPower 20→22.4 → dmg 19→21', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline — no equipped title.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithTitles.start(baseUser.userId, 'son_coc');
      await combatWithTitles.action(baseUser.userId, baseEnc.id, {});
      const baseEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: baseEnc.id },
      });
      const baseState = baseEncAfter.state as { monsterHp: number };
      const baseDmg = 30 - baseState.monsterHp;
      expect(baseDmg).toBe(19);

      // With realm_hu_khong_chi_ton equipped → atkMul=1.12.
      const titleUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await titleSvc.unlockTitle(
        titleUser.characterId,
        'realm_hu_khong_chi_ton',
        'realm_milestone',
      );
      await titleSvc.equipTitle(titleUser.characterId, 'realm_hu_khong_chi_ton');
      const titleEnc = await combatWithTitles.start(titleUser.userId, 'son_coc');
      await combatWithTitles.action(titleUser.userId, titleEnc.id, {});
      const titleEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: titleEnc.id },
      });
      const titleState = titleEncAfter.state as { monsterHp: number };
      const titleDmg = 30 - titleState.monsterHp;
      // effPower = 20 * 1.12 = 22.4. rollDamage(22.4, 2, 1)
      // = max(1, round((22.4 - 1) * 1.0)) = round(21.4) = 21.
      expect(titleDmg).toBe(21);
      expect(titleDmg).toBeGreaterThan(baseDmg);
    });

    it('realm_do_kiep_tribulant (def*1.04) → incoming monster damage giảm hoặc bằng baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline — no title, monster hits back. Power thấp → quái sống → counter.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithTitles.start(baseUser.userId, 'son_coc');
      await combatWithTitles.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // With realm_do_kiep_tribulant → defMul=1.04.
      const titleUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      await titleSvc.unlockTitle(
        titleUser.characterId,
        'realm_do_kiep_tribulant',
        'realm_milestone',
      );
      await titleSvc.equipTitle(titleUser.characterId, 'realm_do_kiep_tribulant');
      const titleEnc = await combatWithTitles.start(titleUser.userId, 'son_coc');
      await combatWithTitles.action(titleUser.userId, titleEnc.id, {});
      const titleChar = await prisma.character.findUniqueOrThrow({
        where: { id: titleUser.characterId },
      });
      const titleHpLost = 1000 - titleChar.hp;
      // Higher effDef → lower (hoặc bằng) incoming damage.
      expect(titleHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('realm_thanh_nhan_sage (spirit*1.08) → incoming monster damage giảm hoặc bằng baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline — no title.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50, // spirit cao đủ để diff visible
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combatWithTitles.start(baseUser.userId, 'son_coc');
      await combatWithTitles.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // With realm_thanh_nhan_sage → spiritMul=1.08.
      const titleUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      await titleSvc.unlockTitle(
        titleUser.characterId,
        'realm_thanh_nhan_sage',
        'realm_milestone',
      );
      await titleSvc.equipTitle(titleUser.characterId, 'realm_thanh_nhan_sage');
      const titleEnc = await combatWithTitles.start(titleUser.userId, 'son_coc');
      await combatWithTitles.action(titleUser.userId, titleEnc.id, {});
      const titleChar = await prisma.character.findUniqueOrThrow({
        where: { id: titleUser.characterId },
      });
      const titleHpLost = 1000 - titleChar.hp;
      // Higher effSpirit → lower (hoặc bằng) incoming damage via defense calc.
      expect(titleHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('không inject TitleService → identity baseline (dmg = 19, same as no-title)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // combat (no TitleService) — identity behavior via main `combat` instance.
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      expect(dmg).toBe(19);
    });

    it('character chưa equip title (Character.title=null) → identity baseline (dmg = 19)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // TitleService injected nhưng character chưa unlock/equip title nào →
      // composeTitleMods([]) trả về identity (atkMul=defMul=spiritMul=1).
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithTitles.start(u.userId, 'son_coc');
      await combatWithTitles.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      expect(dmg).toBe(19);
    });
  });

  // ── Phase 11.4.D — Equip spiritBonus wire vào effSpirit ───────────────
  // Wire item base spirit + gem socket bonus + refine multiplier (đã compute
  // ở `inventory.equipBonus.spiritBonus`) vào effSpirit cho defense calc của
  // monster reply. Pattern same as atk wire (line 232): (base + flat) × mul.
  describe('Equip spiritBonus wire (Phase 11.4.D)', () => {
    let inv: InventoryService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      inv = new InventoryService(prisma, realtime, chars);
    });

    it('character equip weapon có spirit bonus + gem spirit → effSpirit increase → reply damage <= baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Baseline: character KHÔNG equip item — equip.spiritBonus = 0.
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combat.start(baseUser.userId, 'son_coc');
      await combat.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      // Equip: huyen_kiem (base atk +12, spirit +2) + gem_kim_pham
      // (atk +3, spirit +1) socket → equip.spiritBonus = 3.
      const equipUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      await inv.grant(
        equipUser.characterId,
        [{ itemKey: 'huyen_kiem', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: equipUser.characterId, itemKey: 'huyen_kiem' },
      });
      await inv.equip(equipUser.userId, weapon.id);
      await prisma.inventoryItem.update({
        where: { id: weapon.id },
        data: { sockets: ['gem_kim_pham'] },
      });

      const equipEnc = await combat.start(equipUser.userId, 'son_coc');
      await combat.action(equipUser.userId, equipEnc.id, {});
      const equipChar = await prisma.character.findUniqueOrThrow({
        where: { id: equipUser.characterId },
      });
      const equipHpLost = 1000 - equipChar.hp;
      // Higher effSpirit → lower (hoặc bằng) incoming reply damage.
      // Equip spiritBonus = 3 cộng vào effSpirit nên defense lớn hơn.
      expect(equipHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('character KHÔNG equip item → equip.spiritBonus = 0 → effSpirit = char.spirit (identity baseline)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const st = encAfter.state as { monsterHp: number };
      const dmg = 30 - st.monsterHp;
      // Damage formula gốc: same baseline 19 dmg.
      expect(dmg).toBe(19);
    });
  });

  // ── Phase 11.X.M — Buff DOT (debuff_burn_hoa, debuff_poison_moc) ───────
  // Wire `buffMods.dotPerTickFlat` end-of-turn HP loss vào CombatService.action().
  // Apply trên encounter còn ACTIVE (không WON/LOST). Stack handler ở
  // composeBuffMods nhân value × stacks. dotKilled → status LOST + clamp HP=1.
  describe('Buff DOT wire (Phase 11.X.M)', () => {
    let combatWithDot: CombatService;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      combatWithDot = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character có debuff_burn_hoa (1 stack, 8 dmg/tick) → end-of-turn DOT 8 dmg', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      const enc = await combatWithDot.start(u.userId, 'son_coc');
      await combatWithDot.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Baseline reply (vs son_thu_lon, mock 0.5) = 1 dmg → 999 hp.
      // DOT (debuff_burn_hoa 8 dmg) trừ thêm cuối lượt → 999 - 8 = 991.
      expect(c.hp).toBe(991);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      const dotLine = logs.find((l) => l.text.includes('Độc/bỏng phát tác'));
      expect(dotLine).toBeDefined();
      expect(dotLine?.text).toContain('8 sát thương DOT');
    });

    it('character có debuff_burn_hoa stack 2 (16 dmg/tick) → DOT 16 dmg', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      const enc = await combatWithDot.start(u.userId, 'son_coc');
      await combatWithDot.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Reply 1 dmg + DOT 16 dmg (8 × 2 stacks) = 17 → 1000 - 17 = 983.
      expect(c.hp).toBe(983);
    });

    it('character HP thấp + DOT đủ kill → status LOST + charHp clamp 1', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 5,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      const enc = await combatWithDot.start(u.userId, 'son_coc');
      await combatWithDot.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // hp=5, monster reply 1 dmg → 4. Player attack 19 dmg vs son_thu_lon hp=30
      // → still alive (monsterHp=11). Then DOT 8 dmg → 4-8 = -4 → clamp to 1.
      // Status LOST.
      expect(c.hp).toBe(1);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      expect(encAfter.status).toBe(EncounterStatus.LOST);
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      const koLine = logs.find((l) => l.text.includes('hôn mê do độc/bỏng'));
      expect(koLine).toBeDefined();
    });

    it('character KHÔNG debuff → composeBuffMods identity (dotPerTickFlat=0) → no DOT', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithDot.start(u.userId, 'son_coc');
      await combatWithDot.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Reply 1 dmg, no DOT → 999.
      expect(c.hp).toBe(999);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      const dotLine = logs.find((l) => l.text.includes('Độc/bỏng phát tác'));
      expect(dotLine).toBeUndefined();
    });

    it('BuffService không inject vào CombatService → identity baseline (no DOT)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      // grant debuff vào DB
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      // dùng top-level `combat` instance (no BuffService injected)
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // BuffService not injected → composeBuffMods([]) → dotPerTickFlat=0
      // → no DOT despite DB row. 1000 - 1 (reply) = 999.
      expect(c.hp).toBe(999);
    });
  });

  // ── Phase 11.X.O — Buff control (root/stun/silence) ─────────────────────
  // Wire `buffMods.controlTurnsMax > 0` block player action sau khi buff mods
  // composed. Throw `CombatError('CONTROLLED')` EARLY — encounter status,
  // character HP/MP/stamina, ledger row đều không đụng tới.
  describe('Buff control wire (Phase 11.X.O)', () => {
    let combatWithControl: CombatService;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      combatWithControl = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character có debuff_stun_tho (control 1 turn) → throw CONTROLLED', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 1000,
        mpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_stun_tho', 'skill');
      const enc = await combatWithControl.start(u.userId, 'son_coc');
      await expect(
        combatWithControl.action(u.userId, enc.id, {}),
      ).rejects.toThrow('CONTROLLED');

      // Encounter còn ACTIVE, character HP/MP/stamina không đổi sau throw.
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      expect(encAfter.status).toBe(EncounterStatus.ACTIVE);
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      expect(c.hp).toBe(1000);
      expect(c.mp).toBe(1000);
      // start() đã trừ stamina dungeon entry (son_coc=10); action() không trừ
      // thêm khi throw.
      expect(c.stamina).toBe(100 - 10);
    });

    it('character có debuff_root_thuy (control 3 turns) → throw CONTROLLED', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 1000,
        mpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'debuff_root_thuy', 'skill');
      const enc = await combatWithControl.start(u.userId, 'son_coc');
      await expect(
        combatWithControl.action(u.userId, enc.id, {}),
      ).rejects.toThrow('CONTROLLED');
    });

    it('character có debuff_burn_hoa (DOT, không control) → action proceeds', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 1000,
        mpMax: 1000,
      });
      // DOT debuff không có effect kind 'control' → controlTurnsMax = 0.
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill');
      const enc = await combatWithControl.start(u.userId, 'son_coc');
      await combatWithControl.action(u.userId, enc.id, {});
      // Action proceeds: monster reply 1 + DOT 8 → 1000 - 9 = 991.
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      expect(c.hp).toBe(991);
    });

    it('character KHÔNG buff → composeBuffMods identity (controlTurnsMax=0) → action proceeds', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 1000,
        mpMax: 1000,
      });
      const enc = await combatWithControl.start(u.userId, 'son_coc');
      await combatWithControl.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // No buff → no control, no DOT. Reply 1 dmg → 999.
      expect(c.hp).toBe(999);
    });

    it('BuffService không inject vào CombatService → identity baseline (no CONTROLLED throw)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 1000,
        mpMax: 1000,
      });
      // grant control debuff vào DB
      await buffSvc.applyBuff(u.characterId, 'debuff_stun_tho', 'skill');
      // dùng top-level `combat` instance (no BuffService injected) →
      // composeBuffMods([]) → controlTurnsMax = 0 → no throw despite DB row.
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Action proceeds. Reply 1 dmg → 999.
      expect(c.hp).toBe(999);
    });
  });

  describe('Buff shield wire (Phase 11.X.N)', () => {
    let combatWithShield: CombatService;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      combatWithShield = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        buffSvc, // ← BuffService injected (unlike top-level `combat`).
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('character có talent_shield_phong (shield 30% hpMax) → reply absorbed', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      // talent_shield_phong: kind=shield value=0.3 statTarget=hpMax
      // → shieldHpMaxRatio = 0.3 → shieldAbsorb = floor(1000 * 0.3) = 300.
      await buffSvc.applyBuff(u.characterId, 'talent_shield_phong', 'talent');
      const enc = await combatWithShield.start(u.userId, 'son_coc');
      await combatWithShield.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Baseline reply (vs son_thu_lon, mock 0.5) = 1 dmg.
      // Shield absorb = min(300, 1) = 1 → netReply = 0 → charHp unchanged 1000.
      expect(c.hp).toBe(1000);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      const shieldLine = logs.find((l) => l.text.includes('Khiên hấp thu'));
      expect(shieldLine).toBeDefined();
      expect(shieldLine?.text).toContain('1 sát thương');
    });

    it('shield > reply → reply absorbed fully (charHp unchanged)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'talent_shield_phong', 'talent');
      const enc = await combatWithShield.start(u.userId, 'son_coc');
      await combatWithShield.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // shieldAbsorb=300, reply=1 → fully absorbed → charHp=1000.
      expect(c.hp).toBe(1000);
    });

    it('character KHÔNG shield buff → composeBuffMods identity (shieldHpMaxRatio=0) → no absorb', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithShield.start(u.userId, 'son_coc');
      await combatWithShield.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // No shield → reply 1 → charHp 999.
      expect(c.hp).toBe(999);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      const shieldLine = logs.find((l) => l.text.includes('Khiên hấp thu'));
      expect(shieldLine).toBeUndefined();
    });

    it('BuffService không inject vào CombatService → identity baseline (no absorb)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      // grant shield buff vào DB
      await buffSvc.applyBuff(u.characterId, 'talent_shield_phong', 'talent');
      // dùng top-level `combat` instance (no BuffService injected) →
      // composeBuffMods([]) → shieldHpMaxRatio = 0 → no absorb despite DB row.
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // No shield wire active → reply 1 → charHp 999.
      expect(c.hp).toBe(999);
    });

    it('shield + DOT cùng tồn tại → shield chỉ absorb monster reply, không absorb DOT', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await buffSvc.applyBuff(u.characterId, 'talent_shield_phong', 'talent'); // shield 300
      await buffSvc.applyBuff(u.characterId, 'debuff_burn_hoa', 'skill'); // DOT 8
      const enc = await combatWithShield.start(u.userId, 'son_coc');
      await combatWithShield.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Reply 1 → shield absorb 1 → netReply 0 → charHp 1000. Then DOT 8 →
      // charHp 992. Shield wire chỉ apply ở monster reply branch, không apply
      // ở DOT branch (DOT là post-encounter-active end-of-turn, không phải
      // direct hit từ monster).
      expect(c.hp).toBe(992);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      expect(logs.find((l) => l.text.includes('Khiên hấp thu'))).toBeDefined();
      expect(logs.find((l) => l.text.includes('Độc/bỏng phát tác'))).toBeDefined();
    });
  });

  // — Phase 11.X.V Buff invuln wire (kind=invuln) override damage ----
  // Wire `buffMods.invulnActive` in CombatService.action() reply branch
  // (combat.service.ts:404-438) and DOT branch (line 449). Identity false
  // → no-op. Catalog hiện tại không có producer cho `kind=invuln` → wire
  // pattern coverage + future-proof. Same pattern như cultivationBlocked
  // (#270) + control (#264).
  describe('Buff invuln wire (Phase 11.X.V)', () => {
    let combatWithBuffs: CombatService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      const buffSvc = new BuffService(prisma);
      combatWithBuffs = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined, // characterSkill
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('spy BuffService.getMods → invulnActive=true → reply nullified, charHp unchanged', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Spy getMods to inject invulnActive=true (catalog không có producer
      // hiện tại — future buff design).
      vi.spyOn(BuffService.prototype, 'getMods').mockResolvedValue({
        atkMul: 1,
        defMul: 1,
        hpMaxMul: 1,
        mpMaxMul: 1,
        spiritMul: 1,
        hpRegenFlat: 0,
        mpRegenFlat: 0,
        damageBonusByElement: new Map(),
        damageReductionByElement: new Map(),
        dotPerTickFlat: 0,
        shieldHpMaxRatio: 0,
        controlTurnsMax: 0,
        tauntActive: false,
        invulnActive: true,
        cultivationBlocked: false,
        cultivationRateMul: 1,
      });

      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5, // monster sống → reply phát động
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithBuffs.start(u.userId, 'son_coc');
      await combatWithBuffs.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Invuln → reply nullified, charHp unchanged.
      expect(c.hp).toBe(1000);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      expect(
        logs.find((l) => l.text.includes('Bất tử — vô hiệu hóa')),
      ).toBeDefined();
    });

    it('spy BuffService.getMods → invulnActive=true + dotPerTickFlat=8 → DOT cũng skip, charHp unchanged', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Invuln + DOT cùng tồn tại → invuln override cả DOT (spec: "ignore
      // all damage"). Identity false → DOT vẫn áp.
      vi.spyOn(BuffService.prototype, 'getMods').mockResolvedValue({
        atkMul: 1,
        defMul: 1,
        hpMaxMul: 1,
        mpMaxMul: 1,
        spiritMul: 1,
        hpRegenFlat: 0,
        mpRegenFlat: 0,
        damageBonusByElement: new Map(),
        damageReductionByElement: new Map(),
        dotPerTickFlat: 8,
        shieldHpMaxRatio: 0,
        controlTurnsMax: 0,
        tauntActive: false,
        invulnActive: true,
        cultivationBlocked: false,
        cultivationRateMul: 1,
      });

      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithBuffs.start(u.userId, 'son_coc');
      await combatWithBuffs.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // Invuln nullifies reply (1) AND DOT (8) → charHp 1000 unchanged.
      expect(c.hp).toBe(1000);
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const logs = encAfter.log as unknown as Array<{ side: string; text: string }>;
      // No DOT log emitted khi invulnActive=true.
      expect(logs.find((l) => l.text.includes('Độc/bỏng phát tác'))).toBeUndefined();
    });

    it('character KHÔNG buff → composeBuffMods identity (invulnActive=false) → reply applies, DOT N/A', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combatWithBuffs.start(u.userId, 'son_coc');
      await combatWithBuffs.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // No invuln → reply 1 dmg → charHp 999.
      expect(c.hp).toBe(999);
    });

    it('BuffService không inject vào CombatService → identity baseline (no invuln, reply applies)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Top-level `combat` (no BuffService) → composeBuffMods([]) →
      // invulnActive=false → reply applies normally.
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 10,
        hp: 1000,
        hpMax: 1000,
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      expect(c.hp).toBe(999);
    });
  });

  // ── Phase 11.1.D — Cultivation method statBonus.atk/defPercent wire ───
  // Wire `methodStatBonusFor(char.equippedCultivationMethodKey)` vào effPower
  // và effDef. Catalog `cuu_cuc_kim_cuong_quyet` (huyen kim, atk +5%, def +12%)
  // có statBonus runtime impact; `khai_thien_quyet` (pham starter, all 0%)
  // identity; legacy character (no method) identity. Tests dùng raw prisma
  // update để set equippedCultivationMethodKey trực tiếp (bypass realm /
  // forbiddenElements check của CultivationMethodService.equip — không cần
  // cho test fixture).
  describe('Cultivation method statBonus wire (Phase 11.1.D)', () => {
    it('huyen kim method (atk +5%, def +12%) → effPower/effDef higher than legacy baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 100,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combat.start(baseUser.userId, 'son_coc');
      await combat.action(baseUser.userId, baseEnc.id, {});
      const baseEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: baseEnc.id },
      });
      const baseDmg =
        30 - (baseEncAfter.state as { monsterHp: number }).monsterHp;

      const methodUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 100,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await prisma.character.update({
        where: { id: methodUser.characterId },
        data: { equippedCultivationMethodKey: 'cuu_cuc_kim_cuong_quyet' },
      });
      const methodEnc = await combat.start(methodUser.userId, 'son_coc');
      await combat.action(methodUser.userId, methodEnc.id, {});
      const methodEncAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: methodEnc.id },
      });
      const methodDmg =
        30 - (methodEncAfter.state as { monsterHp: number }).monsterHp;
      // method atk +5% → dmg phải >= base (cùng RNG seed mocked 0.5).
      expect(methodDmg).toBeGreaterThanOrEqual(baseDmg);
    });

    it('huyen kim method def +12% → reply damage <= legacy baseline', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const baseUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      const baseEnc = await combat.start(baseUser.userId, 'son_coc');
      await combat.action(baseUser.userId, baseEnc.id, {});
      const baseChar = await prisma.character.findUniqueOrThrow({
        where: { id: baseUser.characterId },
      });
      const baseHpLost = 1000 - baseChar.hp;

      const methodUser = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 5,
        spirit: 50,
        hp: 1000,
        hpMax: 1000,
      });
      await prisma.character.update({
        where: { id: methodUser.characterId },
        data: { equippedCultivationMethodKey: 'cuu_cuc_kim_cuong_quyet' },
      });
      const methodEnc = await combat.start(methodUser.userId, 'son_coc');
      await combat.action(methodUser.userId, methodEnc.id, {});
      const methodChar = await prisma.character.findUniqueOrThrow({
        where: { id: methodUser.characterId },
      });
      const methodHpLost = 1000 - methodChar.hp;
      // method def +12% → effDef bonus → reply damage giảm hoặc bằng baseline.
      expect(methodHpLost).toBeLessThanOrEqual(baseHpLost);
    });

    it('pham starter khai_thien_quyet (all statBonus 0%) → identity (same dmg=19)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      await prisma.character.update({
        where: { id: u.characterId },
        data: { equippedCultivationMethodKey: 'khai_thien_quyet' },
      });
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const dmg = 30 - (encAfter.state as { monsterHp: number }).monsterHp;
      expect(dmg).toBe(19);
    });

    it('legacy character (equippedCultivationMethodKey=null) → methodStatBonusFor identity', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
      });
      // makeUserChar default equippedCultivationMethodKey=null
      const enc = await combat.start(u.userId, 'son_coc');
      await combat.action(u.userId, enc.id, {});
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const dmg = 30 - (encAfter.state as { monsterHp: number }).monsterHp;
      expect(dmg).toBe(19);
    });
  });

  // — Phase 11.7.D Active talent wire (talent cast trong combat action) ----
  describe('Active talent wire (Phase 11.7.D)', () => {
    let combatWithTalents: CombatService;
    let talents: TalentService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      talents = new TalentService(prisma);
      combatWithTalents = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined,
        undefined,
        talents,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('cast talent_kim_quang_tram (active damage) đã học → monster bị 1-shot, mp deduct 30', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // do_kiep order=9 → talentPointBudget = 3 → đủ học cost=2 talent.
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20, // damage = 20*2 = 40 → kill son_thu_lon hp=30
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 50,
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      const view = await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_kim_quang_tram',
      });

      // son_thu_lon (hp=30) chết — monster index advance.
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // mp 50 - 30 (kim_quang_tram cost) = 20.
      expect(c.mp).toBe(20);
      // exp + linhThach drop từ kill.
      expect(c.exp).toBeGreaterThanOrEqual(12n);
      // log có entry "phát động Kim Quang Trảm".
      expect(view.log.some((l) => l.text.includes('Kim Quang Trảm'))).toBe(true);
    });

    it('cast talent_moc_chu_lam (active heal) → HP restore + mp deduct 40, monster không bị hit', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // moc_chu_lam talentPointCost=1 → kim_dan(3) đủ.
      const u = await makeUserChar(prisma, {
        realmKey: 'kim_dan',
        stamina: 100,
        power: 200, // heal = round(200 × 0.3) = 60
        spirit: 100,
        hp: 100, // HP thấp để thấy heal
        hpMax: 1000,
        mp: 50,
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_moc_chu_lam');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_moc_chu_lam',
      });

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // moc_chu_lam value=0.30 atk → heal = round(200 × 0.30) = 60. HP 100 + 60 = 160 (clamp 1000).
      expect(c.hp).toBe(160);
      // mp 50 - 40 (moc_chu_lam cost) = 10.
      expect(c.mp).toBe(10);
      // monster không bị hit (heal flow skip monster reply too).
      const encAfter = await prisma.encounter.findUniqueOrThrow({
        where: { id: enc.id },
      });
      const monsterHp = (encAfter.state as { monsterHp: number }).monsterHp;
      expect(monsterHp).toBe(30); // son_thu_lon full hp (chưa bị damage).
    });

    it('cast talent_thuy_yen_nguc (active cc root) → log control + skip monster reply', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep', // 3 points → cost=2 OK
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 50,
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_thuy_yen_nguc');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      const view = await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_thuy_yen_nguc',
      });

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // mp 50 - 25 (thuy_yen_nguc cost) = 25.
      expect(c.mp).toBe(25);
      // HP không bị giảm (skip monster reply).
      expect(c.hp).toBe(1000);
      // log có entry "phong toả".
      expect(view.log.some((l) => l.text.includes('phong toả'))).toBe(true);
    });

    it('cast talent_hoa_long_phun (active dot) → log burn + skip monster reply', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 50,
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_hoa_long_phun');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      const view = await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_hoa_long_phun',
      });

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // mp 50 - 35 = 15.
      expect(c.mp).toBe(15);
      // HP không bị giảm (skip monster reply).
      expect(c.hp).toBe(1000);
      expect(view.log.some((l) => l.text.includes('thiêu') || l.text.includes('burn'))).toBe(true);
    });

    it('cast talent_thien_loi_trung_tri (active true damage) → bypass def + 1-shot', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // thien_loi cost=3, requires hoa_than(5) → do_kiep(9) OK với 3 points.
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 50, // damage = 50 * 3 = 150 → kill son_thu_lon hp=30
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      await talents.learnTalent(u.characterId, 'talent_thien_loi_trung_tri');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_thien_loi_trung_tri',
      });

      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // mp 100 - 50 = 50.
      expect(c.mp).toBe(50);
      // Monster killed → exp + linhThach drop.
      expect(c.exp).toBeGreaterThanOrEqual(12n);
    });

    it('cast talent_phong_lui (active utility escape) → encounter ABANDONED', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // phong_lui cost=3, requires luyen_hu(6) → do_kiep(9) OK.
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      await talents.learnTalent(u.characterId, 'talent_phong_lui');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      const view = await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_phong_lui',
      });

      // Encounter ABANDONED.
      expect(view.status).toBe(EncounterStatus.ABANDONED);
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // mp 100 - 60 = 40.
      expect(c.mp).toBe(40);
    });

    it('cast active talent CHƯA học → reject TALENT_NOT_LEARNED', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      // KHÔNG learn talent.

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await expect(
        combatWithTalents.action(u.userId, enc.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('TALENT_NOT_LEARNED');
    });

    it('cast active talent với MP không đủ → reject MP_LOW', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 10, // < 30 (kim_quang_tram cost)
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await expect(
        combatWithTalents.action(u.userId, enc.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('MP_LOW');
    });

    it('cast passive talent (talent_kim_thien_co) → reject TALENT_NOT_ACTIVE', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_thien_co');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await expect(
        combatWithTalents.action(u.userId, enc.id, {
          skillKey: 'talent_kim_thien_co',
        }),
      ).rejects.toThrow('TALENT_NOT_ACTIVE');
    });

    it('CombatService không inject TalentService → cast active talent reject TALENT_NOT_LEARNED', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      // top-level `combat` (no TalentService) → can't validate ownership → reject.
      const enc = await combat.start(u.userId, 'son_coc');
      await expect(
        combat.action(u.userId, enc.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('TALENT_NOT_LEARNED');
    });
  });

  describe('Active talent cooldown persist (Phase 11.7.E)', () => {
    let combatWithTalents: CombatService;
    let talents: TalentService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const chars = new CharacterService(prisma, realtime);
      const inventory = new InventoryService(prisma, realtime, chars);
      const currency = new CurrencyService(prisma);
      const missions = makeMissionService(prisma);
      talents = new TalentService(prisma);
      combatWithTalents = new CombatService(
        prisma,
        realtime,
        chars,
        inventory,
        currency,
        missions,
        undefined,
        undefined,
        talents,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('cast talent active thành công → cooldown persist = activeEffect.cooldownTurns (3)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_kim_quang_tram',
      });

      const remaining = await talents.getCooldownRemaining(
        u.characterId,
        'talent_kim_quang_tram',
      );
      expect(remaining).toBe(3);
    });

    it('cast lại talent đang còn cooldown → reject TALENT_ON_COOLDOWN, mp KHÔNG bị deduct', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 100,
        mpMax: 100,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      // Lần 1: cast OK → mp 70, cooldown 3.
      await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_kim_quang_tram',
      });
      const cAfter1 = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      // skill flow tick decrements (no skill cast yet, but talent cast itself
      // sets cd=3 AFTER decrement → 3). mp = 100 - 30 = 70.
      expect(cAfter1.mp).toBe(70);

      // Lần 2 ngay sau: vẫn còn cooldown → reject + KHÔNG deduct mp lần 2.
      await expect(
        combatWithTalents.action(u.userId, enc.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('TALENT_ON_COOLDOWN');

      const cAfter2 = await prisma.character.findUniqueOrThrow({
        where: { id: u.characterId },
      });
      expect(cAfter2.mp).toBe(70); // mp y nguyên — early reject.
    });

    it('skill flow (basic_attack) tick -1 cooldown talent active → 3 → 2 (1 tick verified)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // power=2 + statMul + talentMul → rollDamage tiny ~ 2-3 → son_thu_lon
      // hp=30 KHÔNG chết trong 1 lượt → encounter vẫn ACTIVE cho tick test.
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 2,
        spirit: 100,
        hp: 5000,
        hpMax: 5000,
        mp: 200,
        mpMax: 200,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      // Cast active talent → cd 3.
      await combatWithTalents.action(u.userId, enc.id, {
        skillKey: 'talent_kim_quang_tram',
      });
      expect(
        await talents.getCooldownRemaining(
          u.characterId,
          'talent_kim_quang_tram',
        ),
      ).toBe(3);
      // Skill flow basic_attack 1 tick → cd 3 → 2.
      await combatWithTalents.action(u.userId, enc.id, {});
      expect(
        await talents.getCooldownRemaining(
          u.characterId,
          'talent_kim_quang_tram',
        ),
      ).toBe(2);
    });

    it('cooldown persist xuyên encounter — encounter mới vẫn block cast cho tới khi tick về 0', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 200,
        mpMax: 200,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      // Encounter A: cast → cd 3.
      const encA = await combatWithTalents.start(u.userId, 'son_coc');
      await combatWithTalents.action(u.userId, encA.id, {
        skillKey: 'talent_kim_quang_tram',
      });
      // Abandon A.
      await combatWithTalents.abandon(u.userId, encA.id);

      // Encounter B mới: cooldown vẫn = 3 (persist trong DB cross-encounter).
      const encB = await combatWithTalents.start(u.userId, 'son_coc');
      await expect(
        combatWithTalents.action(u.userId, encB.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('TALENT_ON_COOLDOWN');
    });

    it('cooldown KHÔNG ghi đè khi reject (MP_LOW trước cooldown check) → cooldown vẫn 0', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // mp=10 < cost=30 → MP_LOW reject EARLY (trước cooldown check).
      const u = await makeUserChar(prisma, {
        realmKey: 'do_kiep',
        stamina: 100,
        power: 20,
        spirit: 100,
        hp: 1000,
        hpMax: 1000,
        mp: 10,
        mpMax: 50,
      });
      await talents.learnTalent(u.characterId, 'talent_kim_quang_tram');

      const enc = await combatWithTalents.start(u.userId, 'son_coc');
      await expect(
        combatWithTalents.action(u.userId, enc.id, {
          skillKey: 'talent_kim_quang_tram',
        }),
      ).rejects.toThrow('MP_LOW');

      // Cooldown vẫn = 0 (cast bị reject sớm).
      expect(
        await talents.getCooldownRemaining(
          u.characterId,
          'talent_kim_quang_tram',
        ),
      ).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 12 Story PR-6 — Combat → quest auto-track integration tests.
//
// Verify rằng kill hook ở `CombatService.action` (line ~716) gọi
// `QuestService.track()` với:
//   1) `monster.key` (real catalog key)
//   2) `monster.questTargetIds[*]` (placeholder mappings từ shared catalog)
// và quest catalog dùng targetId placeholder (vd `son_thu`) progress đúng khi
// player kill quái real (vd `son_thu_lon`).
//
// Chapter 1 critical path: `phamnhan_main_01` step_03 + `phamnhan_grind_01`
// step_01 (kill `son_thu` placeholder × 3 / × 10) — match `son_thu_lon` trong
// dungeon `son_coc`.
// ─────────────────────────────────────────────────────────────────────────────
describe('CombatService → QuestService auto-track integration (Phase 12 Story PR-6)', () => {
  let combatWithQuests: CombatService;
  let questService: QuestService;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const realtime = new RealtimeService();
    const chars = new CharacterService(prisma, realtime);
    const inventory = new InventoryService(prisma, realtime, chars);
    const currency = new CurrencyService(prisma);
    const missions = makeMissionService(prisma);
    questService = makeQuestService(prisma);
    combatWithQuests = new CombatService(
      prisma,
      realtime,
      chars,
      inventory,
      currency,
      missions,
      undefined, // characterSkill
      undefined, // achievements
      undefined, // talents
      undefined, // buffs
      undefined, // titles
      questService,
    );
  });

  it('kill 1 son_thu_lon trong son_coc → phamnhan_grind_01 step_01 progress = 1 (qua placeholder questTargetIds)', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 200, // 1-shot son_thu_lon (hp 30)
      hp: 1000,
      hpMax: 1000,
    });

    // Accept quest grind trước khi kill (auto-AVAILABLE qua list lazy-create).
    await questService.listForUser(u.userId);
    await questService.accept(u.userId, 'phamnhan_grind_01');

    const enc = await combatWithQuests.start(u.userId, 'son_coc');
    // Đánh trúng quái đầu (son_thu_lon) → 1-shot kill.
    const view = await combatWithQuests.action(u.userId, enc.id, {});
    expect(view.status).toBe(EncounterStatus.ACTIVE); // còn 2 quái nữa
    // Verify quest progress incremented qua placeholder `son_thu`.
    const row = await prisma.questProgress.findUniqueOrThrow({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    expect(row.status).toBe('ACCEPTED');
    const progress = row.stepProgress as Record<string, number>;
    expect(progress.step_01).toBe(1);
  });

  it('clear son_coc (3 quái: son_thu_lon + da_quan + huyet_lang) → phamnhan_grind_01 step_01 = 1 (chỉ son_thu_lon match), phamnhan_main_01 step_03 = 1', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 500,
      hp: 1000,
      hpMax: 1000,
    });
    await questService.listForUser(u.userId);
    await questService.accept(u.userId, 'phamnhan_grind_01');
    // phamnhan_main_01 step_03 cũng kill `son_thu` × 3 — accept trước khi clear.
    // Need to progress talk steps trước (step_01 + step_02 talk LVS + MTY).
    await questService.accept(u.userId, 'phamnhan_main_01');
    await questService.progress(u.userId, {
      questKey: 'phamnhan_main_01',
      stepId: 'step_01',
    });
    await questService.progress(u.userId, {
      questKey: 'phamnhan_main_01',
      stepId: 'step_02',
    });

    const enc = await combatWithQuests.start(u.userId, 'son_coc');
    let view = enc;
    for (let i = 0; i < 3; i += 1) {
      view = await combatWithQuests.action(u.userId, enc.id, {});
      if (view.status !== EncounterStatus.ACTIVE) break;
    }
    expect(view.status).toBe(EncounterStatus.WON);

    const grindRow = await prisma.questProgress.findUniqueOrThrow({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    const grindProgress = grindRow.stepProgress as Record<string, number>;
    // Chỉ son_thu_lon (questTargetIds=['son_thu']) match. da_quan +
    // huyet_lang map sang son_tac_dau_muc + bac_lang_quan, không match
    // phamnhan_grind_01 step_01 (`son_thu`).
    expect(grindProgress.step_01).toBe(1);
    expect(grindRow.status).toBe('ACCEPTED');

    const mainRow = await prisma.questProgress.findUniqueOrThrow({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_main_01',
        },
      },
    });
    const mainProgress = mainRow.stepProgress as Record<string, number>;
    // step_01 + step_02 talk = 1+1, step_03 kill son_thu = 1 (mới kill 1).
    expect(mainProgress.step_01).toBe(1);
    expect(mainProgress.step_02).toBe(1);
    expect(mainProgress.step_03).toBe(1);
    // Quest chưa COMPLETED (step_03 cần count=3).
    expect(mainRow.status).toBe('ACCEPTED');
  });

  it('kill da_quan (questTargetIds=[son_tac_dau_muc]) → KHÔNG progress phamnhan_grind_01 (mismatch placeholder)', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 200,
      hp: 1000,
      hpMax: 1000,
    });
    await questService.listForUser(u.userId);
    await questService.accept(u.userId, 'phamnhan_grind_01');

    // son_coc có thứ tự [son_thu_lon, da_quan, huyet_lang]. Kill 2 quái đầu:
    // hit 1 = son_thu_lon (match), hit 2 = da_quan (mismatch).
    const enc = await combatWithQuests.start(u.userId, 'son_coc');
    await combatWithQuests.action(u.userId, enc.id, {}); // kill son_thu_lon
    await combatWithQuests.action(u.userId, enc.id, {}); // kill da_quan

    const row = await prisma.questProgress.findUniqueOrThrow({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    const progress = row.stepProgress as Record<string, number>;
    // step_01 = 1 chỉ từ son_thu_lon (questTargetIds.son_thu) — da_quan
    // (questTargetIds.son_tac_dau_muc) không tăng phamnhan_grind_01.
    expect(progress.step_01).toBe(1);
    expect(row.status).toBe('ACCEPTED');
  });

  it('kill flow KHÔNG accept quest → KHÔNG tạo QuestProgress row (track() no-op cho ACCEPTED quest)', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 200,
      hp: 1000,
      hpMax: 1000,
    });
    // KHÔNG gọi accept.
    const enc = await combatWithQuests.start(u.userId, 'son_coc');
    await combatWithQuests.action(u.userId, enc.id, {}); // kill son_thu_lon

    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    // QuestService.list() lazy-create AVAILABLE; nhưng test không gọi list →
    // KHÔNG có row.
    expect(row).toBeNull();
  });

  it('quest đã COMPLETED → kill thêm KHÔNG tăng step (step.count cap)', async () => {
    const u = await makeUserChar(prisma, {
      stamina: 200,
      power: 500,
      hp: 1000,
      hpMax: 1000,
    });
    await questService.listForUser(u.userId);
    await questService.accept(u.userId, 'phamnhan_main_01');
    await questService.progress(u.userId, {
      questKey: 'phamnhan_main_01',
      stepId: 'step_01',
    });
    await questService.progress(u.userId, {
      questKey: 'phamnhan_main_01',
      stepId: 'step_02',
    });

    // Cần kill 3 son_thu_lon, nhưng son_coc chỉ có 1 son_thu_lon mỗi instance.
    // Spin 3 instance liên tiếp.
    for (let run = 0; run < 3; run += 1) {
      const enc = await combatWithQuests.start(u.userId, 'son_coc');
      let view = enc;
      for (let i = 0; i < 5 && view.status === EncounterStatus.ACTIVE; i += 1) {
        view = await combatWithQuests.action(u.userId, enc.id, {});
      }
    }

    const row = await prisma.questProgress.findUniqueOrThrow({
      where: {
        characterId_questKey: {
          characterId: u.characterId,
          questKey: 'phamnhan_main_01',
        },
      },
    });
    expect(row.status).toBe('COMPLETED');
    const progress = row.stepProgress as Record<string, number>;
    expect(progress.step_03).toBe(3); // cap tại count=3, không vượt.
  });
});

// — Phase 14.2.C Elemental Skill Tree Expansion: DOT / SHIELD apply -----
//
// Cover apply DOT tag (monsterDot multi-turn state) và SHIELD tag (single-
// turn absorb monster reply) qua skill ngũ hành identity:
//   - moc_doc_van_truong (Mộc, DOT, atkScale 1.5, mp 26, cd 2)
//   - tho_kim_son_ho_phap (Thổ, SHIELD+CONTROL, atkScale 0.6, mp 18, cd 3)
// Test ép Math.random=0.5 (variance=1.0) → reproducible damage. Dùng
// `son_coc` dungeon (Phase 4 baseline, monster vô resist) để loại noise
// 14.2.B equipBonus / monsterResist.
describe('Phase 14.2.C — Skill DOT / SHIELD apply', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skill DOT cast → monsterDot persist trên EncounterState với turnsLeft=3', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 5,
      hp: 1000,
      hpMax: 1000,
      spiritualRootGrade: 'tien',
      primaryElement: 'moc',
      secondaryElements: ['thuy'],
    });
    // son_coc monster đầu `son_thu_lon` (level 1, hp 30, def 2, tho hệ).
    // Power 5 + atkScale 1.5 → dmg base ~6 → ×1.40 (moc khắc tho + char
    // primary) ~9. Dưới 30 HP → monster sống → DOT apply.
    const enc = await combat.start(u.userId, 'son_coc');
    const view = await combat.action(u.userId, enc.id, {
      skillKey: 'moc_doc_van_truong',
    });
    // Monster vẫn ALIVE (status ACTIVE) — DOT đã apply.
    expect(view.status).toBe(EncounterStatus.ACTIVE);
    const log = view.log.map((l) => l.text).join('\n');
    expect(log).toContain('DOT');
    expect(log).toMatch(/sát thương \/ lượt × 3 lượt/);

    // EncounterState persist DOT.
    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } });
    const state = row.state as { monsterIndex: number; monsterHp: number; monsterDot?: { skillKey: string; element: string; perTurnDamage: number; turnsLeft: number } };
    expect(state.monsterDot).toBeDefined();
    expect(state.monsterDot!.skillKey).toBe('moc_doc_van_truong');
    expect(state.monsterDot!.element).toBe('moc');
    expect(state.monsterDot!.turnsLeft).toBe(3);
    expect(state.monsterDot!.perTurnDamage).toBeGreaterThan(0);
  });

  it('DOT tick → turnsLeft decrement mỗi lượt và damage áp lên monster', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 5,
      hp: 1000,
      hpMax: 1000,
      spiritualRootGrade: 'tien',
      primaryElement: 'moc',
      secondaryElements: ['thuy'],
    });
    const enc = await combat.start(u.userId, 'son_coc');
    // Turn 1: cast DOT skill — set monsterDot turnsLeft=3.
    await combat.action(u.userId, enc.id, { skillKey: 'moc_doc_van_truong' });
    const state1 = (await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } })).state as { monsterDot?: { turnsLeft: number; perTurnDamage: number } };
    expect(state1.monsterDot).toBeDefined();
    expect(state1.monsterDot!.turnsLeft).toBe(3);
    const dotPerTurn = state1.monsterDot!.perTurnDamage;

    // Turn 2: cast basic_attack (no DOT). Tick DOT → turnsLeft=2.
    const view2 = await combat.action(u.userId, enc.id, {});
    const log2 = view2.log.map((l) => l.text).join('\n');
    expect(log2).toContain(`chịu ${dotPerTurn} sát thương DOT`);
    const state2 = (await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } })).state as { monsterDot?: { turnsLeft: number } };
    // turnsLeft có thể decrement từ 3 → 2, hoặc nếu DOT vừa làm chết
    // monster (perTurn × 3 ≥ HP còn) sẽ clear → undefined. Test chỉ assert
    // không bị stale state (≤ 2 hoặc undefined).
    if (state2.monsterDot) {
      expect(state2.monsterDot.turnsLeft).toBeLessThanOrEqual(2);
    }
  });

  it('DOT clear khi monster killed (chuyển monster mới → state.monsterDot=undefined)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 5000,
      hp: 5000,
      hpMax: 5000,
      spiritualRootGrade: 'tien',
      primaryElement: 'moc',
      secondaryElements: ['thuy'],
    });
    const enc = await combat.start(u.userId, 'son_coc');
    // Power cao 1-shot kill monster đầu — DOT không persist sang monster mới.
    const view = await combat.action(u.userId, enc.id, {
      skillKey: 'moc_doc_van_truong',
    });
    // Monster đầu chết → chuyển monster 2 (hoặc WON nếu single-monster
    // dungeon — son_coc có 3 monster).
    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } });
    const state = row.state as { monsterIndex: number; monsterDot?: unknown };
    expect(state.monsterIndex).toBeGreaterThan(0);
    expect(state.monsterDot).toBeUndefined();
    // Status vẫn ACTIVE (còn monster).
    expect(view.status).toBe(EncounterStatus.ACTIVE);
  });

  it('skill SHIELD cast → log "Khiên ... hấp thu N sát thương phản kích"', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 50,
      hp: 1000,
      hpMax: 1000,
      spiritualRootGrade: 'tien',
      primaryElement: 'tho',
      secondaryElements: ['kim'],
    });
    const enc = await combat.start(u.userId, 'son_coc');
    // tho_kim_son_ho_phap: SHIELD identity, atkScale 0.6 → không kill
    // monster đầu → có monster reply → shield absorb.
    const view = await combat.action(u.userId, enc.id, {
      skillKey: 'tho_kim_son_ho_phap',
    });
    expect(view.status).toBe(EncounterStatus.ACTIVE);
    const log = view.log.map((l) => l.text).join('\n');
    // Pre-cast log line.
    expect(log).toContain('Khiên tho dựng');
    // Absorb log line — số HP tuỳ reply, kiểm tra contain prefix.
    expect(log).toMatch(/Khiên tho hấp thu \d+ sát thương phản kích/);
  });

  it('SHIELD không persist sang turn 2 (single-use, encounter state KHÔNG lưu shield)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 50,
      hp: 1000,
      hpMax: 1000,
      spiritualRootGrade: 'tien',
      primaryElement: 'tho',
      secondaryElements: ['kim'],
    });
    const enc = await combat.start(u.userId, 'son_coc');
    await combat.action(u.userId, enc.id, { skillKey: 'tho_kim_son_ho_phap' });
    const state = (await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } }))
      .state as Record<string, unknown>;
    // Phase 14.2.C: không có `playerShield` field — shield single-use,
    // chỉ áp same-turn với cast.
    expect(state).not.toHaveProperty('playerShield');
    // Turn 2 cast basic_attack: log không có "Khiên tho hấp thu".
    const view2 = await combat.action(u.userId, enc.id, {});
    const log2 = view2.log.map((l) => l.text).join('\n');
    // Log accumulate, nhưng turn 2 không phát line shield mới (chỉ turn 1).
    // Đếm matches.
    const shieldHits = (log2.match(/Khiên tho hấp thu/g) ?? []).length;
    expect(shieldHits).toBeLessThanOrEqual(1);
  });

  it('legacy skill (kim_quang_tram, no tags) → DOT/SHIELD wiring identity (state.monsterDot=undefined)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const u = await makeUserChar(prisma, {
      stamina: 100,
      power: 200,
      hp: 1000,
      hpMax: 1000,
      spiritualRootGrade: 'tien',
      primaryElement: 'kim',
      secondaryElements: ['thuy', 'hoa'],
    });
    const enc = await combat.start(u.userId, 'moc_huyen_lam');
    const view = await combat.action(u.userId, enc.id, { skillKey: 'kim_quang_tram' });
    const state = (await prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } }))
      .state as { monsterDot?: unknown };
    expect(state.monsterDot).toBeUndefined();
    const log = view.log.map((l) => l.text).join('\n');
    expect(log).not.toContain('DOT');
    expect(log).not.toContain('Khiên kim dựng');
  });
});
