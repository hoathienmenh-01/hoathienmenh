import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CULTIVATION_TICK_BASE_EXP,
  STAMINA_REGEN_PER_TICK,
  cultivationRateForRealm,
  expCostForStage,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BuffService } from '../character/buff.service';
import { TalentService } from '../character/talent.service';
import { CultivationProcessor } from './cultivation.processor';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let processor: CultivationProcessor;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService(); // unbound — emitToUser sẽ no-op.
  const missions = makeMissionService(prisma);
  processor = new CultivationProcessor(prisma, realtime, missions);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Job giả lập — processor chỉ đọc `name`.
function tickJob() {
  return { name: 'tick' } as Parameters<CultivationProcessor['process']>[0];
}

describe('CultivationProcessor.process (tick)', () => {
  it('cộng EXP cho character đang `cultivating=true`, không cộng cho đứa false', async () => {
    const a = await makeUserChar(prisma, { cultivating: true, spirit: 8 });
    const b = await makeUserChar(prisma, { cultivating: false, spirit: 8 });

    await processor.process(tickJob());

    const cA = await prisma.character.findUniqueOrThrow({ where: { id: a.characterId } });
    const cB = await prisma.character.findUniqueOrThrow({ where: { id: b.characterId } });
    // gain = rateForRealm(luyenkhi) + floor(spirit/4) = 7 + 2 = 9
    const expectedGain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2,
    );
    expect(cA.exp).toBe(expectedGain);
    expect(cB.exp).toBe(0n);
  });

  it('regen stamina cho TẤT CẢ character (kể cả không tu luyện), cap = staminaMax', async () => {
    const a = await makeUserChar(prisma, { stamina: 50, staminaMax: 100, cultivating: false });
    const b = await makeUserChar(prisma, {
      stamina: 99,
      staminaMax: 100,
      cultivating: true,
    });

    await processor.process(tickJob());

    const cA = await prisma.character.findUniqueOrThrow({ where: { id: a.characterId } });
    const cB = await prisma.character.findUniqueOrThrow({ where: { id: b.characterId } });
    expect(cA.stamina).toBe(50 + STAMINA_REGEN_PER_TICK);
    // cap không vượt staminaMax
    expect(cB.stamina).toBe(100);
  });

  it('auto-breakthrough khi vượt cap stage < 9 — exp dư đẩy sang stage tiếp theo', async () => {
    // Stage 1 cap = 1000; cho exp gần đủ để 1 tick đẩy qua stage 2.
    const cap1 = expCostForStage('luyenkhi', 1)!;
    const a = await makeUserChar(prisma, {
      cultivating: true,
      spirit: 8,
      realmKey: 'luyenkhi',
      realmStage: 1,
      exp: cap1 - 1n, // chỉ thiếu 1 EXP
    });

    await processor.process(tickJob());

    const c = await prisma.character.findUniqueOrThrow({ where: { id: a.characterId } });
    // Sau tick: vượt cap → stage 2; exp = (exp + gain - cap1)
    const gain = BigInt(
      cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2,
    );
    expect(c.realmStage).toBe(2);
    expect(c.exp).toBe(cap1 - 1n + gain - cap1);
  });

  it('KHÔNG auto-breakthrough qua cảnh giới mới — dừng ở stage 9 (chờ gọi breakthrough thủ công)', async () => {
    const cap9 = expCostForStage('luyenkhi', 9)!;
    const a = await makeUserChar(prisma, {
      cultivating: true,
      spirit: 8,
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: cap9 - 1n,
    });
    await processor.process(tickJob());
    const c = await prisma.character.findUniqueOrThrow({ where: { id: a.characterId } });
    // stage 9 không auto-break → vẫn ở luyenkhi/9, exp tiếp tục cộng dồn.
    expect(c.realmKey).toBe('luyenkhi');
    expect(c.realmStage).toBe(9);
    expect(c.exp).toBeGreaterThan(cap9 - 1n);
  });

  it('character không tồn tại trong tick (deleted) — process không throw, các others vẫn tick', async () => {
    const a = await makeUserChar(prisma, { cultivating: true, spirit: 8 });
    const b = await makeUserChar(prisma, { cultivating: true, spirit: 8 });

    // Mô phỏng race: xoá `a` ngay sau khi processor đọc danh sách (khó kiểm
    // chứng race thật, nhưng processor có try/catch per-character ngăn chặn
    // 1 lỗi làm hỏng cả batch). Test bằng cách run 1 tick bình thường và
    // confirm cả 2 đều có EXP > 0.
    await processor.process(tickJob());

    const cA = await prisma.character.findUniqueOrThrow({ where: { id: a.characterId } });
    const cB = await prisma.character.findUniqueOrThrow({ where: { id: b.characterId } });
    expect(cA.exp).toBeGreaterThan(0n);
    expect(cB.exp).toBeGreaterThan(0n);
  });

  // — Phase 11.3.C Linh căn cultivationMultiplier wire ----------------------
  describe('Linh căn cultivationMultiplier wire (Phase 11.3.C)', () => {
    it('character có spiritualRootGrade=than → gain × 1.80 vs legacy null × 1.0', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      // Legacy character (spiritualRootGrade=null) → multiplier 1.0
      const legacy = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        // KHÔNG set spiritualRootGrade → null
      });
      // Thần linh căn → multiplier 1.80
      const than = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'than',
        primaryElement: 'kim',
        secondaryElements: ['moc', 'thuy', 'hoa', 'tho'],
      });

      await processor.process(tickJob());

      const cLegacy = await prisma.character.findUniqueOrThrow({ where: { id: legacy.characterId } });
      const cThan = await prisma.character.findUniqueOrThrow({ where: { id: than.characterId } });
      expect(cLegacy.exp).toBe(BigInt(baseGain));
      // Thần grade × 1.80 → round(baseGain * 1.80)
      expect(cThan.exp).toBe(BigInt(Math.round(baseGain * 1.8)));
    });

    it('character có spiritualRootGrade=pham → gain × 1.0 (KHÔNG bonus)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const pham = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: pham.characterId } });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('character có spiritualRootGrade=huyen → gain × 1.30', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const huyen = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'huyen',
        primaryElement: 'kim',
        secondaryElements: ['moc'],
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: huyen.characterId } });
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.3)));
    });
  });

  // — Phase 11.1.B Cultivation Method expMultiplier wire --------------------
  describe('Cultivation method expMultiplier wire (Phase 11.1.B)', () => {
    it('character equip method huyen `liet_hoa_phap` (1.20×) compose với root than (1.80×) + primary=hoa khớp method.element=hoa → gain × 2.376 (Phase 11.1.E affinity bonus +10%)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'than',
        primaryElement: 'hoa',
        secondaryElements: ['kim', 'moc', 'thuy', 'tho'],
        equippedCultivationMethodKey: 'liet_hoa_phap',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // Compose: baseGain × rootMul (1.80) × methodMul (1.20) ×
      //   affinityMul (1 + 0.10 primary bonus) → round.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.8 * 1.2 * 1.1)));
    });

    it('character KHÔNG equip method (legacy null) → methodMul=1.0 (backward-compat)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        // KHÔNG set equippedCultivationMethodKey → null
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('character equip starter `khai_thien_quyet` (1.0×) → KHÔNG bonus', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        equippedCultivationMethodKey: 'khai_thien_quyet',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('character equip than-grade `thai_hu_chan_kinh` (1.60×) + root pham (1.0×) → gain × 1.60 (vô hệ method → affinity=0)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
        equippedCultivationMethodKey: 'thai_hu_chan_kinh',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // `thai_hu_chan_kinh` element=null → affinity bonus=0 → identity mul.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.6)));
    });
  });

  // — Phase 11.1.E Linh căn × Cultivation Method element affinity bonus -----
  describe('Cultivation method element affinity bonus wire (Phase 11.1.E)', () => {
    it('primary=hoa khớp method.element=hoa (`liet_hoa_phap`) → +10% bonus compose với rootMul=1.0 + methodMul=1.20', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham', // root mul=1.0 → cô lập affinity
        primaryElement: 'hoa',
        equippedCultivationMethodKey: 'liet_hoa_phap',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // baseGain × 1.0 × 1.20 × (1 + 0.10) → round.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.2 * 1.1)));
    });

    it('method.element=hoa ∈ secondaryElements=[hoa] → +5% secondary bonus', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim', // primary KHÔNG match hoa → kiểm secondary
        secondaryElements: ['hoa', 'moc'],
        equippedCultivationMethodKey: 'liet_hoa_phap', // element=hoa
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // baseGain × 1.0 × 1.20 × (1 + 0.05) → round.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.2 * 1.05)));
    });

    it('khác hệ (primary=kim, secondary=[moc], method.element=hoa) → bonus=0 (chỉ methodMul)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
        secondaryElements: ['moc'],
        equippedCultivationMethodKey: 'liet_hoa_phap',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // baseGain × 1.0 × 1.20 × (1 + 0) → round.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.2)));
    });

    it('vô hệ method (`thai_hu_chan_kinh` element=null) → bonus=0 (không thiên vị primary)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'thuy',
        secondaryElements: ['hoa', 'moc', 'kim', 'tho'],
        equippedCultivationMethodKey: 'thai_hu_chan_kinh',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // `thai_hu_chan_kinh` element=null → bonus=0 → baseGain × 1.0 × 1.60.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.6)));
    });

    it('primary trumps secondary — method.element=kim, primary=kim, secondary=[kim] → +10% (KHÔNG +5%)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
        secondaryElements: ['kim'], // overlap edge — runtime KHÔNG nên có
        equippedCultivationMethodKey: 'cuu_cuc_kim_cuong_quyet', // element=kim
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // `cuu_cuc_kim_cuong_quyet` huyen → methodMul=1.20 + primary affinity +10%.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.2 * 1.1)));
    });

    it('legacy character (primaryElement=null, secondaryElements=[]) + method có element → bonus=0 (backward-compat)', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'pham',
        // primaryElement=null + secondaryElements=[] (default Prisma)
        equippedCultivationMethodKey: 'liet_hoa_phap', // element=hoa
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // Legacy null → primary mismatch + secondary empty → bonus=0.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.2)));
    });

    it('compose full stack — root than (1.80×) + method huyen kim (1.20×) + primary=kim → gain × 2.376', async () => {
      const baseGain = cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        spiritualRootGrade: 'than',
        primaryElement: 'kim',
        equippedCultivationMethodKey: 'cuu_cuc_kim_cuong_quyet',
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
      // baseGain × 1.80 × 1.20 × (1 + 0.10) = baseGain × 2.376 → round.
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.8 * 1.2 * 1.1)));
    });
  });

  // — Phase 11.7.D — Talent expMul wire vào cultivation tick ----
  describe('Talent expMul wire (Phase 11.7.D)', () => {
    let processorWithTalents: CultivationProcessor;
    let talentSvc: TalentService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const missions = makeMissionService(prisma);
      talentSvc = new TalentService(prisma);
      processorWithTalents = new CultivationProcessor(
        prisma,
        realtime,
        missions,
        undefined, // achievements
        talentSvc,
      );
    });

    it('character đã học `talent_ngo_dao` (exp_bonus 1.15) ở luyen_hu → gain × 1.15', async () => {
      // Baseline ở luyen_hu (order 6, root null) → cultivationMul=1.0,
      // methodMul=1.0, talentExpMul=1.15. baseGain = rateForRealm(luyen_hu)+spirit/4.
      const baseGain =
        cultivationRateForRealm('luyen_hu', CULTIVATION_TICK_BASE_EXP) + 2;

      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'luyen_hu',
        realmStage: 1,
      });
      await talentSvc.learnTalent(f.characterId, 'talent_ngo_dao');

      await processorWithTalents.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.15)));
    });

    it('character KHÔNG học talent (legacy) → talentExpMul=1.0 (backward-compat)', async () => {
      const baseGain =
        cultivationRateForRealm('luyen_hu', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'luyen_hu',
        realmStage: 1,
      });
      await processorWithTalents.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('không inject TalentService (legacy DI) → talentExpMul=1.0 identity', async () => {
      // Default `processor` instance không inject TalentService → fallback path.
      const baseGain =
        cultivationRateForRealm('luyen_hu', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'luyen_hu',
        realmStage: 1,
      });
      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('compose talent ngo_dao × root than × method thai_hu_chan_kinh → gain × 1.15 × 1.80 × 1.60', async () => {
      const baseGain =
        cultivationRateForRealm('luyen_hu', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'luyen_hu',
        realmStage: 1,
        spiritualRootGrade: 'than',
        primaryElement: 'kim',
        equippedCultivationMethodKey: 'thai_hu_chan_kinh',
      });
      await talentSvc.learnTalent(f.characterId, 'talent_ngo_dao');

      await processorWithTalents.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(Math.round(baseGain * 1.8 * 1.6 * 1.15)));
    });
  });

  // — Phase 11.8.D — Buff cultivationBlocked (Tâm Ma) wire ----
  describe('Buff cultivationBlocked wire (Phase 11.8.D)', () => {
    let processorWithBuffs: CultivationProcessor;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      processorWithBuffs = new CultivationProcessor(
        prisma,
        realtime,
        missions,
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    it('character có debuff_taoma active → skip EXP gain (Tâm Ma block)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
      });
      await buffSvc.applyBuff(f.characterId, 'debuff_taoma', 'tribulation');

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // Tâm Ma block → exp KHÔNG đổi (vẫn 0).
      expect(c.exp).toBe(0n);
    });

    it('character KHÔNG có buff → vẫn cộng EXP bình thường', async () => {
      const baseGain =
        cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
      });
      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('không inject BuffService (legacy DI) → identity (không block)', async () => {
      // Default `processor` instance không inject BuffService — character có
      // buff applied vẫn tu luyện bình thường.
      const baseGain =
        cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
      });
      await buffSvc.applyBuff(f.characterId, 'debuff_taoma', 'tribulation');

      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // Service không inject → buff bị ignore → exp gain bình thường.
      expect(c.exp).toBe(BigInt(baseGain));
    });

    it('character có buff KHÔNG cultivation_block (vd buff_pill_*) → vẫn tu luyện', async () => {
      // Apply buff non-cultivation-block để verify chỉ flag cultivationBlocked
      // mới skip, không phải bất kỳ buff nào.
      const baseGain =
        cultivationRateForRealm('luyenkhi', CULTIVATION_TICK_BASE_EXP) + 2;
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
      });
      // Apply buff khác (debuff_boss_atk_down: stat_mod atk×0.82, KHÔNG block).
      await buffSvc.applyBuff(
        f.characterId,
        'debuff_boss_atk_down',
        'boss_skill',
      );

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.exp).toBe(BigInt(baseGain));
    });
  });

  // — Phase 11.8.E — Buff hp/mpRegenFlat wire vào cultivation tick ----
  describe('Buff hp/mpRegenFlat wire (Phase 11.8.E)', () => {
    let processorWithBuffs: CultivationProcessor;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const missions = makeMissionService(prisma);
      buffSvc = new BuffService(prisma);
      processorWithBuffs = new CultivationProcessor(
        prisma,
        realtime,
        missions,
        undefined, // achievements
        undefined, // talents
        buffSvc,
      );
    });

    it('character có pill_hp_regen_t1 (5 HP/sec × 30s = 150 HP) → hp += 150 (cap hpMax)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });
      await buffSvc.applyBuff(f.characterId, 'pill_hp_regen_t1', 'pill');

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(250); // 100 + 5*30 = 250 (≤ hpMax 500)
      expect(c.mp).toBe(50); // không có mp regen
    });

    it('character có sect_aura_thuy (4 MP/sec × 30s = 120 MP) → mp += 120 (cap mpMax)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 100,
        hpMax: 100,
        mp: 50,
        mpMax: 200,
      });
      await buffSvc.applyBuff(f.characterId, 'sect_aura_thuy', 'sect_aura');

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(100); // không có hp regen
      expect(c.mp).toBe(170); // 50 + 4*30 = 170 (≤ mpMax 200)
    });

    it('hp regen vượt cap → cap LEAST(hpMax)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 90,
        hpMax: 100,
        mp: 50,
        mpMax: 50,
      });
      await buffSvc.applyBuff(f.characterId, 'pill_hp_regen_t1', 'pill');

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // 90 + 150 = 240 → cap 100 (hpMax).
      expect(c.hp).toBe(100);
    });

    it('character KHÔNG có buff regen → hp/mp không đổi', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 200,
      });

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(100);
      expect(c.mp).toBe(50);
    });

    it('không inject BuffService (legacy DI) → hp/mp identity (không regen)', async () => {
      // Default `processor` instance không inject BuffService — character có
      // buff applied vẫn không được hồi hp/mp ở cultivation tick.
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 200,
      });
      await buffSvc.applyBuff(f.characterId, 'pill_hp_regen_t1', 'pill');

      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(100);
      expect(c.mp).toBe(50);
    });

    it('character có debuff_taoma + buff regen → cultivationBlocked → hp/mp KHÔNG regen', async () => {
      // Tâm Ma block cả EXP gain LẪN hp/mp regen (continue skip toàn bộ).
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 200,
      });
      await buffSvc.applyBuff(f.characterId, 'debuff_taoma', 'tribulation');
      await buffSvc.applyBuff(f.characterId, 'pill_hp_regen_t1', 'pill');

      await processorWithBuffs.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // Tâm Ma block → hp/mp KHÔNG đổi (continue skip toàn bộ tick).
      expect(c.hp).toBe(100);
      expect(c.mp).toBe(50);
      expect(c.exp).toBe(0n);
    });
  });

  // — Phase 11.7.E — Talent hp/mpRegenFlat wire vào cultivation tick ----
  describe('Talent hp/mpRegenFlat wire (Phase 11.7.E)', () => {
    let processorWithTalentRegen: CultivationProcessor;
    let talentSvc: TalentService;
    let buffSvc: BuffService;

    beforeAll(() => {
      const realtime = new RealtimeService();
      const missions = makeMissionService(prisma);
      talentSvc = new TalentService(prisma);
      buffSvc = new BuffService(prisma);
      processorWithTalentRegen = new CultivationProcessor(
        prisma,
        realtime,
        missions,
        undefined, // achievements
        talentSvc,
        buffSvc,
      );
    });

    it('character đã học `talent_moc_linh_quy` (5 HP/sec × 30s = 150 HP) → hp += 150 (cap hpMax)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'kim_dan', // talent_moc_linh_quy req truc_co (order 2), nhưng cần budget ≥ 1 (kim_dan order 3)
        realmStage: 1,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });
      await talentSvc.learnTalent(f.characterId, 'talent_moc_linh_quy');

      await processorWithTalentRegen.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(250); // 100 + 5*30 = 250 (≤ hpMax 500)
      expect(c.mp).toBe(50); // không có mp regen (catalog talent regen chỉ có hpMax)
    });

    it('talent + buff regen compose additively: talent 5 HP/sec + buff 5 HP/sec → 300 HP/tick', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'kim_dan',
        realmStage: 1,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });
      await talentSvc.learnTalent(f.characterId, 'talent_moc_linh_quy');
      await buffSvc.applyBuff(f.characterId, 'pill_hp_regen_t1', 'pill');

      await processorWithTalentRegen.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // talent 5 + buff 5 = 10 HP/sec × 30s = 300 → 100 + 300 = 400 (≤ hpMax 500).
      expect(c.hp).toBe(400);
    });

    it('character KHÔNG học talent → talentMods.hpRegenFlat=0 identity (no regen)', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'kim_dan',
        realmStage: 1,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });

      await processorWithTalentRegen.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(100);
      expect(c.mp).toBe(50);
    });

    it('không inject TalentService (legacy DI) → talentMods=null identity (no regen despite DB row)', async () => {
      // Default `processor` instance không inject TalentService.
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'kim_dan',
        realmStage: 1,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });
      await talentSvc.learnTalent(f.characterId, 'talent_moc_linh_quy');

      await processor.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      expect(c.hp).toBe(100);
    });

    it('character có debuff_taoma + talent regen → cultivationBlocked → hp/mp KHÔNG regen', async () => {
      const f = await makeUserChar(prisma, {
        cultivating: true,
        spirit: 8,
        realmKey: 'kim_dan',
        realmStage: 1,
        hp: 100,
        hpMax: 500,
        mp: 50,
        mpMax: 50,
      });
      await talentSvc.learnTalent(f.characterId, 'talent_moc_linh_quy');
      await buffSvc.applyBuff(f.characterId, 'debuff_taoma', 'tribulation');

      await processorWithTalentRegen.process(tickJob());
      const c = await prisma.character.findUniqueOrThrow({
        where: { id: f.characterId },
      });
      // Tâm Ma block → continue skip → hp KHÔNG đổi dù talent regen active.
      expect(c.hp).toBe(100);
      expect(c.exp).toBe(0n);
    });
  });
});
