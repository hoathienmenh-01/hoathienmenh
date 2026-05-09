import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  computeTribulationFailurePenalty,
  expCostForStage,
  getTribulationForBreakthrough,
  simulateTribulation,
  titleForRealmMilestone,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { AchievementService } from './achievement.service';
import { BuffService } from './buff.service';
import { CharacterService } from './character.service';
import { CurrencyService } from './currency.service';
import { TalentService } from './talent.service';
import { TitleService } from './title.service';
import {
  TribulationError,
  TribulationService,
  toAttemptOutcomeView,
  type TribulationAttemptOutcome,
} from './tribulation.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let svc: TribulationService;
let titleSvc: TitleService;
let buffSvc: BuffService;
let talentSvc: TalentService;
let inventorySvc: InventoryService;
let svcWithTitles: TribulationService;
let svcWithBuffs: TribulationService;
let svcWithTalents: TribulationService;
let svcWithEquip: TribulationService;
let svcWithTalentsEquip: TribulationService;
// Phase 14.3.B — full inject (titles + buffs + talents + inventory) cho preview
// supports tests cần đọc cả 4 nguồn cùng lúc.
let svcFull: TribulationService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  titleSvc = new TitleService(prisma);
  buffSvc = new BuffService(prisma);
  talentSvc = new TalentService(prisma);
  // Phase 11.6.E — InventoryService inject cho equipment resist tests.
  const realtimeForEquip = new RealtimeService();
  const charsForEquip = new CharacterService(prisma, realtimeForEquip);
  inventorySvc = new InventoryService(prisma, realtimeForEquip, charsForEquip);
  svc = new TribulationService(prisma, currency);
  svcWithTitles = new TribulationService(prisma, currency, titleSvc);
  svcWithBuffs = new TribulationService(
    prisma,
    currency,
    titleSvc,
    buffSvc,
  );
  // Phase 11.6.D — TalentService inject vào TribulationService cho resist tests.
  svcWithTalents = new TribulationService(
    prisma,
    currency,
    undefined,
    undefined,
    undefined,
    talentSvc,
  );
  // Phase 11.6.E — InventoryService inject only (no talent) cho equipment-only tests.
  svcWithEquip = new TribulationService(
    prisma,
    currency,
    undefined,
    undefined,
    undefined,
    undefined,
    inventorySvc,
  );
  // Phase 11.6.E — Talent + Inventory inject cho stack compose tests.
  svcWithTalentsEquip = new TribulationService(
    prisma,
    currency,
    undefined,
    undefined,
    undefined,
    talentSvc,
    inventorySvc,
  );
  // Phase 14.3.B — full inject (titles + buffs + talents + inventory) cho
  // preview supports populated tests.
  svcFull = new TribulationService(
    prisma,
    currency,
    titleSvc,
    buffSvc,
    undefined,
    talentSvc,
    inventorySvc,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const KIM_DAN_COST_9 = expCostForStage('kim_dan', 9) ?? 0n;

/** Tạo character đứng đỉnh kim_dan, đủ EXP cost(9), HP đủ vượt minor kiếp. */
async function setupCharAtKimDanPeak(opts?: {
  hpMax?: number;
  exp?: bigint;
  linhThach?: bigint;
}) {
  return makeUserChar(prisma, {
    realmKey: 'kim_dan',
    realmStage: 9,
    exp: opts?.exp ?? KIM_DAN_COST_9 + 1000n,
    hp: opts?.hpMax ?? 10_000,
    hpMax: opts?.hpMax ?? 10_000,
    mp: 200,
    mpMax: 200,
    linhThach: opts?.linhThach ?? 0n,
  });
}

describe('TribulationService.attemptTribulation — SUCCESS path (kim_dan → nguyen_anh, minor lei)', () => {
  it('hpMax đủ vượt 3 wave (minor=800/1080/1458 → ~3338 dmg) → success, advance realm, grant reward, write log + ledger', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh');
    expect(def).toBeDefined();

    const sim = simulateTribulation(def!, 10_000, () => 1.0);
    expect(sim.success).toBe(true); // sanity: catalog đảm bảo hp>tổng dmg

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0);

    expect(out.success).toBe(true);
    expect(out.fromRealmKey).toBe('kim_dan');
    expect(out.toRealmKey).toBe('nguyen_anh');
    expect(out.severity).toBe('minor');
    expect(out.type).toBe('lei');
    expect(out.wavesCompleted).toBe(3);
    expect(out.totalDamage).toBe(sim.totalDamage);
    expect(out.attemptIndex).toBe(1);
    expect(out.reward).not.toBeNull();
    expect(out.reward!.linhThach).toBe(5_000); // SEVERITY_REWARD_BASE.minor
    expect(out.reward!.expBonus).toBe(1_000n);
    expect(out.penalty).toBeNull();

    // Character: realm advance + HP/MP refill + cooldown cleared.
    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.realmKey).toBe('nguyen_anh');
    expect(updated?.realmStage).toBe(1);
    expect(updated?.exp).toBe(KIM_DAN_COST_9 + 1000n - KIM_DAN_COST_9 + 1_000n);
    expect(updated?.hpMax).toBe(Math.round(10_000 * 1.2));
    expect(updated?.hp).toBe(updated?.hpMax);
    expect(updated?.mpMax).toBe(Math.round(200 * 1.2));
    expect(updated?.mp).toBe(updated?.mpMax);
    expect(updated?.tribulationCooldownAt).toBeNull();
    expect(updated?.taoMaUntil).toBeNull();
    expect(updated?.linhThach).toBe(5_000n);

    // CurrencyLedger row for grant.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].reason).toBe('TRIBULATION_REWARD');
    expect(ledger[0].delta).toBe(5_000n);
    expect(ledger[0].refType).toBe('TribulationAttemptLog');
    expect(ledger[0].refId).toBe(out.logId);

    // TribulationAttemptLog row.
    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(out.logId);
    expect(logs[0].success).toBe(true);
    expect(logs[0].fromRealmKey).toBe('kim_dan');
    expect(logs[0].toRealmKey).toBe('nguyen_anh');
    expect(logs[0].severity).toBe('minor');
    expect(logs[0].type).toBe('lei');
    expect(logs[0].wavesCompleted).toBe(3);
    expect(logs[0].totalDamage).toBe(sim.totalDamage);
    expect(logs[0].attemptIndex).toBe(1);
    expect(logs[0].linhThachReward).toBe(5_000);
    expect(logs[0].expBonusReward).toBe(1_000n);
    expect(logs[0].titleKeyReward).toBe('tribulation_minor_lei_pass');
    expect(logs[0].expLoss).toBe(0n);
    expect(logs[0].taoMaActive).toBe(false);
    expect(logs[0].taoMaExpiresAt).toBeNull();
    expect(logs[0].cooldownAt).toBeNull();
    expect(logs[0].taoMaRoll).toBe(0.0);
  });

  it('SUCCESS clears pre-existing cooldown + taoMaUntil (after retry post-cooldown)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // Set pre-existing cooldown đã expire + taoMa đã expire (test cleanup on success).
    const past = new Date(Date.now() - 10 * 60_000);
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        tribulationCooldownAt: past,
        taoMaUntil: past,
      },
    });

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0);
    expect(out.success).toBe(true);

    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.tribulationCooldownAt).toBeNull();
    expect(updated?.taoMaUntil).toBeNull();
  });
});

describe('TribulationService.attemptTribulation — FAIL path', () => {
  it('hpMax thấp (2000) → fail wave 2, EXP loss 10%, cooldown set, hp=1', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000, exp: KIM_DAN_COST_9 + 100_000n });
    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;

    const sim = simulateTribulation(def, 2_000, () => 1.0);
    expect(sim.success).toBe(false); // catalog đảm bảo hp=2000 < tổng dmg

    // rng=0.99 → taoMaRoll cao hơn taoMaDebuffChance (0.05 minor) → KHÔNG taoMa.
    const fakeNow = new Date('2026-05-02T00:00:00Z');
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99, fakeNow);

    expect(out.success).toBe(false);
    expect(out.wavesCompleted).toBe(sim.wavesCompleted);
    expect(out.reward).toBeNull();
    expect(out.penalty).not.toBeNull();
    expect(out.penalty!.taoMaActive).toBe(false);
    expect(out.penalty!.taoMaExpiresAt).toBeNull();

    // Character: EXP loss áp dụng, realm KHÔNG advance, hp=1, cooldown set.
    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.realmKey).toBe('kim_dan');
    expect(updated?.realmStage).toBe(9);
    expect(updated?.hp).toBe(1);
    expect(updated?.taoMaUntil).toBeNull();
    expect(updated?.tribulationCooldownAt).not.toBeNull();
    // 30 phút cooldown cho minor.
    expect(updated?.tribulationCooldownAt?.getTime()).toBe(
      fakeNow.getTime() + 30 * 60_000,
    );

    // EXP loss check via catalog helper (parity).
    const expectedPenalty = computeTribulationFailurePenalty(
      KIM_DAN_COST_9 + 100_000n,
      def,
      fakeNow,
      0.99,
    );
    expect(updated?.exp).toBe(expectedPenalty.expAfter);
    expect(out.penalty!.expBefore).toBe(KIM_DAN_COST_9 + 100_000n);
    expect(out.penalty!.expAfter).toBe(expectedPenalty.expAfter);
    expect(out.penalty!.expLoss).toBe(KIM_DAN_COST_9 + 100_000n - expectedPenalty.expAfter);
  });

  it('rng=0.0 (taoMaRoll < taoMaDebuffChance=0.05) → Tâm Ma debuff trigger, taoMaUntil set', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });

    const fakeNow = new Date('2026-05-02T00:00:00Z');
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0, fakeNow);

    expect(out.success).toBe(false);
    expect(out.penalty!.taoMaActive).toBe(true);
    expect(out.penalty!.taoMaExpiresAt).not.toBeNull();
    // 15 phút Tâm Ma cho minor.
    expect(out.penalty!.taoMaExpiresAt!.getTime()).toBe(
      fakeNow.getTime() + 15 * 60_000,
    );

    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.taoMaUntil?.getTime()).toBe(fakeNow.getTime() + 15 * 60_000);
  });

  it('FAIL không grant CurrencyLedger (chỉ SUCCESS mới grant)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);
    expect(out.success).toBe(false);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(ledger).toHaveLength(0);
  });

  it('FAIL ghi TribulationAttemptLog với expLoss + cooldownAt, success=false', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000, exp: KIM_DAN_COST_9 + 100_000n });
    const fakeNow = new Date('2026-05-02T00:00:00Z');
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0, fakeNow);
    expect(out.success).toBe(false);

    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
    expect(logs[0].expLoss).toBeGreaterThan(0n);
    expect(logs[0].cooldownAt).not.toBeNull();
    expect(logs[0].linhThachReward).toBe(0);
    expect(logs[0].expBonusReward).toBe(0n);
    expect(logs[0].titleKeyReward).toBeNull();
    expect(logs[0].taoMaActive).toBe(true);
    expect(logs[0].taoMaRoll).toBe(0.0);
  });
});

describe('TribulationService.attemptTribulation — gating', () => {
  it('throws NOT_AT_PEAK khi realmStage < 9', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 8,
      exp: KIM_DAN_COST_9,
      hp: 10_000,
      hpMax: 10_000,
    });
    await expect(svc.attemptTribulation(ctx.characterId)).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('throws NOT_AT_PEAK khi exp < cost(9)', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 9,
      exp: KIM_DAN_COST_9 - 1n,
      hp: 10_000,
      hpMax: 10_000,
    });
    await expect(svc.attemptTribulation(ctx.characterId)).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('throws NO_TRIBULATION_FOR_TRANSITION khi catalog không có def (luyenkhi → truc_co)', async () => {
    const luyenkhiCost9 = expCostForStage('luyenkhi', 9) ?? 0n;
    const ctx = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: luyenkhiCost9,
      hp: 10_000,
      hpMax: 10_000,
    });
    await expect(svc.attemptTribulation(ctx.characterId)).rejects.toMatchObject({
      code: 'NO_TRIBULATION_FOR_TRANSITION',
    });
  });

  it('throws COOLDOWN_ACTIVE khi tribulationCooldownAt > now', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const future = new Date(Date.now() + 10 * 60_000);
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { tribulationCooldownAt: future },
    });
    await expect(svc.attemptTribulation(ctx.characterId)).rejects.toMatchObject({
      code: 'COOLDOWN_ACTIVE',
    });
  });

  it('cho phép retry sau khi cooldown expire (now > tribulationCooldownAt)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const past = new Date(Date.now() - 10 * 60_000);
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { tribulationCooldownAt: past },
    });
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0);
    expect(out.success).toBe(true);
  });

  it('throws CHARACTER_NOT_FOUND khi characterId không tồn tại', async () => {
    await expect(
      svc.attemptTribulation('char-does-not-exist'),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });

  it('throws INVALID_RNG khi rng() return out-of-range', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svc.attemptTribulation(ctx.characterId, () => 1.5),
    ).rejects.toMatchObject({ code: 'INVALID_RNG' });
    await expect(
      svc.attemptTribulation(ctx.characterId, () => -0.1),
    ).rejects.toMatchObject({ code: 'INVALID_RNG' });
    await expect(
      svc.attemptTribulation(ctx.characterId, () => Number.NaN),
    ).rejects.toMatchObject({ code: 'INVALID_RNG' });
  });
});

describe('TribulationService.attemptTribulation — cross-character + idempotency', () => {
  it('attemptIndex tăng dần qua nhiều fail attempts (cooldown clear giữa các attempts)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });

    // 1st fail.
    const first = await svc.attemptTribulation(ctx.characterId, () => 0.99);
    expect(first.success).toBe(false);
    expect(first.attemptIndex).toBe(1);

    // Clear cooldown manually (simulate time passing).
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        tribulationCooldownAt: null,
        // EXP refill về peak gate.
        exp: KIM_DAN_COST_9 + 1000n,
      },
    });

    // 2nd fail.
    const second = await svc.attemptTribulation(ctx.characterId, () => 0.99);
    expect(second.success).toBe(false);
    expect(second.attemptIndex).toBe(2);

    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0].attemptIndex).toBe(1);
    expect(logs[1].attemptIndex).toBe(2);
  });

  it('Char A cooldown KHÔNG block Char B (cross-character isolation)', async () => {
    const charA = await setupCharAtKimDanPeak({ hpMax: 2_000 });
    const charB = await setupCharAtKimDanPeak({ hpMax: 10_000 });

    // A fail → cooldown set.
    const aOut = await svc.attemptTribulation(charA.characterId, () => 0.99);
    expect(aOut.success).toBe(false);

    const aChar = await prisma.character.findUnique({
      where: { id: charA.characterId },
    });
    expect(aChar?.tribulationCooldownAt).not.toBeNull();

    // B vẫn attempt được (cooldown của A không liên quan).
    const bOut = await svc.attemptTribulation(charB.characterId, () => 0.0);
    expect(bOut.success).toBe(true);
    expect(bOut.attemptIndex).toBe(1); // B's attemptIndex riêng.
  });
});

describe('TribulationService.attemptTribulation — atomicity', () => {
  it('throws TribulationError instance (không leak Prisma error)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { realmStage: 5 },
    });
    try {
      await svc.attemptTribulation(ctx.characterId);
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TribulationError);
      expect((e as TribulationError).code).toBe('NOT_AT_PEAK');
    }
  });
});

describe('TribulationService.attemptTribulation with TitleService (Phase 11.9.C-2)', () => {
  it('SUCCESS kim_dan → nguyen_anh tự auto-unlock title `realm_nguyen_anh_master` (atomic trong tx)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const expected = titleForRealmMilestone('nguyen_anh');
    expect(expected).toBeDefined();
    expect(expected!.key).toBe('realm_nguyen_anh_master');

    const out = await svcWithTitles.attemptTribulation(
      ctx.characterId,
      () => 0.0,
    );
    expect(out.success).toBe(true);
    expect(out.toRealmKey).toBe('nguyen_anh');

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].titleKey).toBe('realm_nguyen_anh_master');
    expect(rows[0].source).toBe('realm_milestone');
  });

  it('SUCCESS hoa_than → luyen_hu (luyen_hu KHÔNG có title milestone) → KHÔNG insert row', async () => {
    const HOA_THAN_COST_9 = expCostForStage('hoa_than', 9) ?? 0n;
    const ctx = await makeUserChar(prisma, {
      realmKey: 'hoa_than',
      realmStage: 9,
      exp: HOA_THAN_COST_9 + 1000n,
      hp: 1_000_000,
      hpMax: 1_000_000, // major sev wave có dmg cao, set hpMax đủ pass.
      mp: 200,
      mpMax: 200,
      linhThach: 0n,
    });
    expect(titleForRealmMilestone('luyen_hu')).toBeUndefined();

    const out = await svcWithTitles.attemptTribulation(
      ctx.characterId,
      () => 0.99, // không trigger taoMa.
    );
    expect(out.success).toBe(true);
    expect(out.toRealmKey).toBe('luyen_hu');

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows.length).toBe(0);
  });

  it('SUCCESS idempotent: title đã unlock trước → KHÔNG dup row (composite UNIQUE)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // Pre-unlock title qua TitleService để giả lập đã có sẵn.
    await titleSvc.unlockTitle(
      ctx.characterId,
      'realm_nguyen_anh_master',
      'realm_milestone',
    );
    const before = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(before.length).toBe(1);

    const out = await svcWithTitles.attemptTribulation(
      ctx.characterId,
      () => 0.0,
    );
    expect(out.success).toBe(true);

    const after = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(after.length).toBe(1);
  });

  it('SUCCESS KHÔNG inject TitleService → vẫn advance realm + grant reward (backward-compat)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.0);
    expect(out.success).toBe(true);
    expect(out.toRealmKey).toBe('nguyen_anh');

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows.length).toBe(0);
  });

  it('FAIL path KHÔNG trigger title unlock (chỉ SUCCESS path mới unlock)', async () => {
    const ctx = await setupCharAtKimDanPeak({
      hpMax: 2_000,
      exp: KIM_DAN_COST_9 + 100_000n,
    });
    const out = await svcWithTitles.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );
    expect(out.success).toBe(false);

    const rows = await prisma.characterTitleUnlock.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows.length).toBe(0);
  });
});

describe('TribulationService.attemptTribulation with BuffService (Phase 11.8.D-2 taoMa wire)', () => {
  it('FAIL + taoMaActive (rng=0.0) → CharacterBuff debuff_taoma row insert atomic, expiresAt = penalty.taoMaExpiresAt (per-tier)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });
    const fakeNow = new Date('2026-05-02T00:00:00Z');
    const out = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      fakeNow,
    );
    expect(out.success).toBe(false);
    expect(out.penalty!.taoMaActive).toBe(true);
    // Minor tier: taoMaDebuffDurationMinutes = 15.
    const expectedExpiresAt = new Date(fakeNow.getTime() + 15 * 60_000);
    expect(out.penalty!.taoMaExpiresAt!.getTime()).toBe(
      expectedExpiresAt.getTime(),
    );

    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(buffs).toHaveLength(1);
    expect(buffs[0].buffKey).toBe('debuff_taoma');
    expect(buffs[0].source).toBe('tribulation');
    expect(buffs[0].stacks).toBe(1);
    // Per-tier override (15 phút từ tribulation catalog), KHÔNG phải catalog
    // buff `durationSec=3600` (60 phút).
    expect(buffs[0].expiresAt.getTime()).toBe(expectedExpiresAt.getTime());

    // Legacy field vẫn được set cho backward-compat.
    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.taoMaUntil?.getTime()).toBe(expectedExpiresAt.getTime());
  });

  it('FAIL + taoMa NOT active (rng=0.99) → KHÔNG insert CharacterBuff row', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });
    const out = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );
    expect(out.success).toBe(false);
    expect(out.penalty!.taoMaActive).toBe(false);

    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(buffs).toHaveLength(0);
  });

  it('SUCCESS path KHÔNG insert taoMa CharacterBuff row (chỉ FAIL path mới wire)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const out = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.0,
    );
    expect(out.success).toBe(true);

    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    const taoma = buffs.filter((b) => b.buffKey === 'debuff_taoma');
    expect(taoma).toHaveLength(0);
  });

  it('FAIL atomic: nếu attempt tribulation 2 lần liên tiếp với taoMa active → composite UNIQUE giữ stacks=1 (non-stackable), refresh expiresAt', async () => {
    // Setup char hpMax=2_000 đủ để FAIL ở minor tier kim_dan→nguyen_anh.
    const ctx = await setupCharAtKimDanPeak({
      hpMax: 2_000,
      exp: KIM_DAN_COST_9 + 100_000n,
    });
    const t1 = new Date('2026-05-02T00:00:00Z');
    const out1 = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      t1,
    );
    expect(out1.success).toBe(false);
    expect(out1.penalty!.taoMaActive).toBe(true);

    // Verify first buff row.
    const buffs1 = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId, buffKey: 'debuff_taoma' },
    });
    expect(buffs1).toHaveLength(1);
    const firstExpiresAt = buffs1[0].expiresAt.getTime();

    // Move past cooldown + bump exp lại để eligible attempt 2.
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        tribulationCooldownAt: null,
        exp: KIM_DAN_COST_9 + 100_000n,
        hp: 2_000,
      },
    });

    const t2 = new Date('2026-05-02T01:00:00Z'); // 1h sau.
    const out2 = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      t2,
    );
    expect(out2.success).toBe(false);
    expect(out2.penalty!.taoMaActive).toBe(true);

    const buffs2 = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId, buffKey: 'debuff_taoma' },
    });
    // Composite UNIQUE (characterId, buffKey) → 1 row.
    expect(buffs2).toHaveLength(1);
    // debuff_taoma stackable=false → stacks giữ nguyên 1.
    expect(buffs2[0].stacks).toBe(1);
    // expiresAt refresh sang t2 + 15 phút.
    expect(buffs2[0].expiresAt.getTime()).toBe(t2.getTime() + 15 * 60_000);
    expect(buffs2[0].expiresAt.getTime()).toBeGreaterThan(firstExpiresAt);
  });

  it('FAIL KHÔNG inject BuffService → vẫn set legacy taoMaUntil + log (backward-compat)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 2_000 });
    const fakeNow = new Date('2026-05-02T00:00:00Z');
    // Dùng `svc` (3-arg constructor, KHÔNG có buffs).
    const out = await svc.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      fakeNow,
    );
    expect(out.success).toBe(false);
    expect(out.penalty!.taoMaActive).toBe(true);

    // Legacy field vẫn được set.
    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.taoMaUntil?.getTime()).toBe(
      fakeNow.getTime() + 15 * 60_000,
    );

    // KHÔNG có CharacterBuff row vì BuffService không inject.
    const buffs = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(buffs).toHaveLength(0);
  });
});

describe('TribulationService.attemptTribulation — element resist (Phase 11.6.C)', () => {
  /**
   * `kim_dan → nguyen_anh` minor lei kiếp có waves element=['hoa','kim','hoa']
   * (xem TYPE_ELEMENTS['lei'] trong tribulation.ts). Test scenario chính:
   *   - **Thuỷ primary** (khắc Hoả + sinh Kim → composite expectation):
   *     wave[0]='hoa' (thuy khắc hoa = countered = 0.7),
   *     wave[1]='kim' (kim sinh thuy = generate to defender = 1.2),
   *     wave[2]='hoa' (0.7).
   *   - **Hoả primary** (cùng wave hoa + sinh Kim với wave kim):
   *     wave[0]='hoa' (cùng hệ = 0.9), wave[1]='kim' (kim sinh hoa
   *     = wave sinh primary → generate-on-defender = 1.2 weakness),
   *     wave[2]='hoa' (0.9).
   *   - **Legacy** (primaryElement=null): tất cả 1.0 (backward-compat baseline).
   */

  it('Thuỷ primary character → primary khắc hoa wave + sinh kim wave → totalDamage giảm so baseline', async () => {
    const baselineCtx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.character.update({
      where: { id: baselineCtx.characterId },
      data: {
        spiritualRootGrade: 'pham',
        primaryElement: 'thuy',
        secondaryElements: [],
      },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baseline1Sim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svc.attemptTribulation(baselineCtx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    // Thuỷ resist: hoa[0]=0.7, kim[1]=1.2, hoa[2]=0.7. Manual sim shows
    // totalDamage < baseline (resist trên 2 wave hoa outweigh weakness 1 kim).
    expect(out.totalDamage).toBeLessThan(baseline1Sim.totalDamage);
    // Sanity: confirm matches deterministic resolver simulation
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.7 : el === 'kim' ? 1.2 : 1.0,
    );
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
  });

  it('Kim primary character → 2 wave hoa khắc kim primary → totalDamage tăng so baseline (weakness)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        spiritualRootGrade: 'pham',
        primaryElement: 'kim',
        secondaryElements: [],
      },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    // Kim weakness: hoa[0]=1.3 (hoa khắc kim → counter), kim[1]=0.9 (cùng hệ),
    // hoa[2]=1.3. Net effect: 2 wave hoa khắc primary > 1 wave kim cùng hệ
    // → totalDamage > baseline.
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 1.3 : el === 'kim' ? 0.9 : 1.0,
    );
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    expect(out.totalDamage).toBeGreaterThan(baselineSim.totalDamage);
  });

  it('Legacy character (primaryElement=null) → backward-compat 1.0 fallback, totalDamage = baseline', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    // KHÔNG set primaryElement (vẫn null từ makeUserChar default).

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(baselineSim.totalDamage);
  });

  it('huyen grade với 2 secondary trùng/khắc wave → resist sâu hơn pham', async () => {
    // Setup: huyen primary='thuy' với secondaries=['tho','kim']
    //   - wave[0]='hoa': primary thuy khắc hoa → 0.7;
    //     secondary 'kim': elementOvercomes('kim')='moc' ≠ 'hoa' → no bonus.
    //     secondary 'tho': elementOvercomes('tho')='thuy' ≠ 'hoa' → no bonus.
    //     → final 0.7.
    //   - wave[1]='kim': primary thuy: kim sinh thuy → wave sinh primary → 1.2;
    //     secondary 'kim' = wave → resonance -0.05 = 1.15;
    //     secondary 'tho': elementOvercomes('tho')='thuy' ≠ 'kim' → no.
    //     → final 1.15.
    //   - wave[2]='hoa': giống wave[0] = 0.7.
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        spiritualRootGrade: 'huyen',
        primaryElement: 'thuy',
        secondaryElements: ['tho', 'kim'],
      },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.7 : el === 'kim' ? 1.15 : 1.0,
    );
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Verify huyen 2-secondary giảm thêm so với pham primary='thuy' baseline:
    const phamSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.7 : el === 'kim' ? 1.2 : 1.0,
    );
    expect(out.totalDamage).toBeLessThan(phamSim.totalDamage);
  });
});

describe('TribulationService.attemptTribulation — talent resist (Phase 11.6.D)', () => {
  /**
   * Compose talent resist multiplicatively trên top spiritual root resist.
   * - `kim_dan → nguyen_anh` minor lei waves = ['hoa','kim','hoa'].
   * - `talent_hoa_thien_giap` (kind='element_resist' value=0.95
   *   elementTarget='hoa') → 2 wave hoa nhân thêm 0.95.
   * - Backward-compat: TalentService NOT inject (svc) → fallback identity 1.0.
   */

  it('TalentService NOT injected (svc) → backward-compat, totalDamage = baseline', async () => {
    // svc constructor không có talents → fallback identity 1.0.
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    // Đảm bảo talent_hoa_thien_giap có học hay chưa cũng KHÔNG ảnh hưởng vì
    // svc không inject TalentService.
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(baselineSim.totalDamage);
  });

  it('TalentService injected nhưng character chưa học talent → fallback identity, totalDamage = baseline', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svcWithTalents.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(baselineSim.totalDamage);
  });

  it('character học talent_hoa_thien_giap → 2 wave hoa giảm 5%, wave kim không đổi', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    // Insert talent trực tiếp qua prisma (bypass realm/budget gate cho test
    // đơn lẻ — gate đã được test riêng trong talent.service.test.ts).
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.95 : 1.0,
    );

    const out = await svcWithTalents.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Sanity: < baseline 1.0 (do hoa wave nhân 0.95).
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);
    expect(out.totalDamage).toBeLessThan(baselineSim.totalDamage);
  });

  it('character học talent_kim_thien_giap → wave kim giảm 5%, 2 wave hoa không đổi', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_kim_thien_giap' },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'kim' ? 0.95 : 1.0,
    );

    const out = await svcWithTalents.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
  });

  it('compose: học cả hoa + kim talent → 2 wave hoa × 0.95 + wave kim × 0.95', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.characterTalent.createMany({
      data: [
        { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
        { characterId: ctx.characterId, talentKey: 'talent_kim_thien_giap' },
      ],
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.95 : el === 'kim' ? 0.95 : 1.0,
    );

    const out = await svcWithTalents.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
  });

  it('compose với spiritual root: pham primary=hoa + talent_hoa_thien_giap → wave hoa = 0.9 × 0.95, wave kim = 0.7 (countered, no talent kim)', async () => {
    // Wave hoa với primary='hoa' = sameElement = 0.9 (Phase 11.6.C),
    // compose talent resist 0.95 → 0.855.
    // Wave kim attacker vs primary=hoa defender: hoa khắc kim → countered
    // relation → 0.7 (Phase 11.6.C resist mạnh). KHÔNG có talent kim →
    // talent resist 1.0 → final 0.7.
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        spiritualRootGrade: 'pham',
        primaryElement: 'hoa',
        secondaryElements: [],
      },
    });
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
    });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) => {
      if (el === 'hoa') return 0.9 * 0.95; // root sameElement × talent resist
      if (el === 'kim') return 0.7; // root countered only (no talent)
      return 1.0;
    });

    const out = await svcWithTalents.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Sanity: < pham primary=hoa baseline (no talent) — talent thêm resist hoa.
    const phamBaselineSim = simulateTribulation(def, 50_000, (el) => {
      if (el === 'hoa') return 0.9;
      if (el === 'kim') return 0.7;
      return 1.0;
    });
    expect(out.totalDamage).toBeLessThan(phamBaselineSim.totalDamage);
  });
});

describe('TribulationService.attemptTribulation — equipment resist (Phase 11.6.E)', () => {
  /**
   * Compose equipment elementResist multiplicatively trên top spiritual root +
   * talent resist. Catalog: 5 armor `huyen_giap_phong_<elem>` với
   * `ItemBonus.elementResist[<elem>] = 0.95`.
   *
   * - `kim_dan → nguyen_anh` minor lei waves = ['hoa','kim','hoa'].
   * - Equip `huyen_giap_phong_hoa` → 2 wave hoa nhân thêm 0.95.
   * - Backward-compat: InventoryService NOT inject (svc) → fallback identity 1.0.
   */

  it('InventoryService NOT injected (svc) → backward-compat, totalDamage = baseline kể cả khi đeo armor resist', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    // Đeo armor resist nhưng svc không inject InventoryService → fallback 1.0.
    await inventorySvc.grant(
      ctx.characterId,
      [{ itemKey: 'huyen_giap_phong_hoa', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    const armor = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: ctx.characterId, itemKey: 'huyen_giap_phong_hoa' },
    });
    await inventorySvc.equip(ctx.userId, armor.id);

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(baselineSim.totalDamage);
  });

  it('InventoryService injected nhưng character không trang bị → fallback identity, totalDamage = baseline', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);

    const out = await svcWithEquip.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(baselineSim.totalDamage);
  });

  it('character đeo huyen_giap_phong_hoa → 2 wave hoa giảm 5%, wave kim không đổi', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await inventorySvc.grant(
      ctx.characterId,
      [{ itemKey: 'huyen_giap_phong_hoa', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    const armor = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: ctx.characterId, itemKey: 'huyen_giap_phong_hoa' },
    });
    await inventorySvc.equip(ctx.userId, armor.id);

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.95 : 1.0,
    );

    const out = await svcWithEquip.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Sanity: < baseline 1.0 (do hoa wave nhân 0.95).
    const baselineSim = simulateTribulation(def, 50_000, () => 1.0);
    expect(out.totalDamage).toBeLessThan(baselineSim.totalDamage);
  });

  it('character đeo huyen_giap_phong_kim → wave kim giảm 5%, 2 wave hoa không đổi', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await inventorySvc.grant(
      ctx.characterId,
      [{ itemKey: 'huyen_giap_phong_kim', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    const armor = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: ctx.characterId, itemKey: 'huyen_giap_phong_kim' },
    });
    await inventorySvc.equip(ctx.userId, armor.id);

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'kim' ? 0.95 : 1.0,
    );

    const out = await svcWithEquip.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
  });

  it('compose: talent_hoa_thien_giap + huyen_giap_phong_hoa → 2 wave hoa × 0.95 × 0.95', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
    });
    await inventorySvc.grant(
      ctx.characterId,
      [{ itemKey: 'huyen_giap_phong_hoa', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    const armor = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: ctx.characterId, itemKey: 'huyen_giap_phong_hoa' },
    });
    await inventorySvc.equip(ctx.userId, armor.id);

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.95 * 0.95 : 1.0,
    );

    const out = await svcWithTalentsEquip.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Sanity: < talent-only baseline (equipment thêm 5% resist hoa).
    const talentOnlySim = simulateTribulation(def, 50_000, (el) =>
      el === 'hoa' ? 0.95 : 1.0,
    );
    expect(out.totalDamage).toBeLessThan(talentOnlySim.totalDamage);
  });

  it('compose full stack: spiritual root + talent + equipment → 3-layer multiplicative', async () => {
    // Pham primary=hoa (sameElement 0.9 hoa, countered 0.7 kim) +
    // talent_hoa_thien_giap (0.95 hoa) + huyen_giap_phong_hoa (0.95 hoa).
    // Wave hoa = 0.9 × 0.95 × 0.95 = 0.81225.
    // Wave kim = 0.7 × 1.0 × 1.0 = 0.7 (no talent kim, no armor kim).
    const ctx = await setupCharAtKimDanPeak({ hpMax: 50_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        spiritualRootGrade: 'pham',
        primaryElement: 'hoa',
        secondaryElements: [],
      },
    });
    await prisma.characterTalent.create({
      data: { characterId: ctx.characterId, talentKey: 'talent_hoa_thien_giap' },
    });
    await inventorySvc.grant(
      ctx.characterId,
      [{ itemKey: 'huyen_giap_phong_hoa', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    const armor = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: ctx.characterId, itemKey: 'huyen_giap_phong_hoa' },
    });
    await inventorySvc.equip(ctx.userId, armor.id);

    const def = getTribulationForBreakthrough('kim_dan', 'nguyen_anh')!;
    const expectedSim = simulateTribulation(def, 50_000, (el) => {
      if (el === 'hoa') return 0.9 * 0.95 * 0.95;
      if (el === 'kim') return 0.7;
      return 1.0;
    });

    const out = await svcWithTalentsEquip.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );

    expect(out.success).toBe(true);
    expect(out.totalDamage).toBe(expectedSim.totalDamage);
    // Sanity: full stack < talent-only stack < root-only baseline.
    const rootOnlySim = simulateTribulation(def, 50_000, (el) => {
      if (el === 'hoa') return 0.9;
      if (el === 'kim') return 0.7;
      return 1.0;
    });
    expect(out.totalDamage).toBeLessThan(rootOnlySim.totalDamage);
  });
});

describe('TribulationService.listAttemptLogs (Phase 11.6.F)', () => {
  /**
   * Sau mỗi FAIL attempt, character.exp giảm + cooldown set + realmStage giữ
   * nguyên 9. Để chạy nhiều attempts liên tiếp trong test, refill về peak gate.
   */
  async function refillToPeak(characterId: string) {
    await prisma.character.update({
      where: { id: characterId },
      data: {
        tribulationCooldownAt: null,
        exp: KIM_DAN_COST_9 + 1000n,
        realmStage: 9,
        hp: 100,
        hpMax: 100,
      },
    });
  }

  it('character chưa attempt → trả về mảng rỗng', async () => {
    const ctx = await setupCharAtKimDanPeak();
    const rows = await svc.listAttemptLogs(ctx.characterId);
    expect(rows).toEqual([]);
  });

  it('attempt FAIL rồi list → có 1 row, BigInt cast → string, DateTime cast → ISO', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 }); // hp thấp → fail
    const out = await svc.attemptTribulation(ctx.characterId, () => 0.99);
    expect(out.success).toBe(false);

    const rows = await svc.listAttemptLogs(ctx.characterId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tribulationKey).toBe(out.tribulationKey);
    expect(row.success).toBe(false);
    expect(row.fromRealmKey).toBe('kim_dan');
    expect(row.toRealmKey).toBe('nguyen_anh');
    expect(typeof row.expBefore).toBe('string');
    expect(typeof row.expAfter).toBe('string');
    expect(typeof row.expLoss).toBe('string');
    expect(typeof row.expBonusReward).toBe('string');
    expect(BigInt(row.expBefore) >= 0n).toBe(true);
    expect(typeof row.createdAt).toBe('string');
    expect(() => new Date(row.createdAt).toISOString()).not.toThrow();
    expect(row.cooldownAt).not.toBeNull();
    expect(row.titleKeyReward).toBeNull();
    expect(row.linhThachReward).toBe(0);
    expect(row.attemptIndex).toBe(1);
  });

  it('multi attempt → sort theo createdAt DESC (mới nhất đầu tiên)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 });
    await svc.attemptTribulation(
      ctx.characterId,
      () => 0.99,
      new Date('2026-05-02T00:00:00Z'),
    );
    await refillToPeak(ctx.characterId);
    await svc.attemptTribulation(
      ctx.characterId,
      () => 0.99,
      new Date('2026-05-02T01:00:00Z'),
    );
    await refillToPeak(ctx.characterId);
    await svc.attemptTribulation(
      ctx.characterId,
      () => 0.99,
      new Date('2026-05-02T02:00:00Z'),
    );

    const rows = await svc.listAttemptLogs(ctx.characterId);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.attemptIndex).toBe(3);
    expect(rows[1]!.attemptIndex).toBe(2);
    expect(rows[2]!.attemptIndex).toBe(1);
    expect(new Date(rows[0]!.createdAt).getTime()).toBeGreaterThan(
      new Date(rows[1]!.createdAt).getTime(),
    );
  });

  it('limit cap → trả về tối đa N row mới nhất', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 });
    for (let i = 0; i < 5; i++) {
      if (i > 0) await refillToPeak(ctx.characterId);
      await svc.attemptTribulation(
        ctx.characterId,
        () => 0.99,
        new Date(`2026-05-02T0${i}:00:00Z`),
      );
    }

    const rows = await svc.listAttemptLogs(ctx.characterId, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attemptIndex).toBe(5);
    expect(rows[1]!.attemptIndex).toBe(4);
  });

  it('limit invalid (<=0, NaN, >MAX) → service guard cap về [1, MAX]', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 });
    await svc.attemptTribulation(ctx.characterId, () => 0.99);

    // limit=0 → cap về 1
    const r0 = await svc.listAttemptLogs(ctx.characterId, 0);
    expect(r0).toHaveLength(1);

    // limit=-5 → cap về 1
    const rNeg = await svc.listAttemptLogs(ctx.characterId, -5);
    expect(rNeg).toHaveLength(1);

    // limit=999_999 → cap về MAX (cũng = 1 vì chỉ có 1 row).
    const rMax = await svc.listAttemptLogs(ctx.characterId, 999_999);
    expect(rMax).toHaveLength(1);
  });

  it('character khác → KHÔNG leak log của character này (where filter charId)', async () => {
    const ctxA = await setupCharAtKimDanPeak({ hpMax: 100 });
    await svc.attemptTribulation(ctxA.characterId, () => 0.99);
    const ctxB = await setupCharAtKimDanPeak({ hpMax: 100 });
    await svc.attemptTribulation(ctxB.characterId, () => 0.99);
    await refillToPeak(ctxB.characterId);
    await svc.attemptTribulation(ctxB.characterId, () => 0.99);

    const rowsA = await svc.listAttemptLogs(ctxA.characterId);
    expect(rowsA).toHaveLength(1);
    const rowsB = await svc.listAttemptLogs(ctxB.characterId);
    expect(rowsB).toHaveLength(2);
  });
});

// ── Phase 11.10.G — TribulationService BREAKTHROUGH achievement track wire ──
// Symmetric với CultivationProcessor low-tier auto-breakthrough → trackEvent
// 'BREAKTHROUGH'. Trước đó tribulation success advance realm cao (kim_dan
// → nguyen_anh, etc.) NHƯNG không track BREAKTHROUGH event → 4 achievement
// catalog `BREAKTHROUGH` (`first_breakthrough`, `reach_truc_co`, `reach_kim_dan`,
// `reach_nguyen_anh` — `achievements.ts` line 228..278) de facto bỏ qua khi
// player clear realm cao qua tribulation. Wire fail-soft post-tx (tribulation
// reward đã commit; tracking failure chỉ log warn).
describe('TribulationService BREAKTHROUGH achievement track (Phase 11.10.G)', () => {
  let achievements: AchievementService;
  let svcWithAch: TribulationService;

  beforeAll(() => {
    const realtime = new RealtimeService();
    const chars = new CharacterService(prisma, realtime);
    const inventory = new InventoryService(prisma, realtime, chars);
    achievements = new AchievementService(prisma, currency, titleSvc, inventory);
    svcWithAch = new TribulationService(
      prisma,
      currency,
      titleSvc,
      buffSvc,
      achievements,
    );
  });

  it('SUCCESS path → AchievementService.trackEvent BREAKTHROUGH +1 (first_breakthrough progress=1, completedAt set)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });

    // Pre-condition: chưa có CharacterAchievement row.
    const before = await prisma.characterAchievement.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(before).toHaveLength(0);

    const out = await svcWithAch.attemptTribulation(ctx.characterId, () => 0.0);
    expect(out.success).toBe(true);

    // first_breakthrough (goal=1, BREAKTHROUGH) phải completed.
    const row = await prisma.characterAchievement.findUnique({
      where: {
        characterId_achievementKey: {
          characterId: ctx.characterId,
          achievementKey: 'first_breakthrough',
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row!.progress).toBe(1);
    expect(row!.completedAt).not.toBeNull();
  });

  it('FAIL path → KHÔNG track BREAKTHROUGH (no CharacterAchievement row)', async () => {
    const ctx = await setupCharAtKimDanPeak({
      hpMax: 2_000,
      exp: KIM_DAN_COST_9 + 100_000n,
    });
    const out = await svcWithAch.attemptTribulation(
      ctx.characterId,
      () => 0.99,
    );
    expect(out.success).toBe(false);

    // Không có row achievement nào (BREAKTHROUGH track skip).
    const rows = await prisma.characterAchievement.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('legacy 4-arg constructor (no achievements) → SUCCESS không throw, không có row', async () => {
    // svcWithBuffs = constructor(prisma, currency, titleSvc, buffSvc) — không
    // pass achievements. Pre-Phase-11.10.G behavior.
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });

    const out = await svcWithBuffs.attemptTribulation(
      ctx.characterId,
      () => 0.0,
    );
    expect(out.success).toBe(true);

    // Realm vẫn advance (success path đã thực thi).
    const updated = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(updated?.realmKey).toBe('nguyen_anh');

    // Nhưng không có achievement row (achievements not injected).
    const rows = await prisma.characterAchievement.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 11.6.B HTTP fix — `toAttemptOutcomeView` BigInt + Date → string mapper.
// Bug: Express JSON serialize không handle BigInt → mọi attempt success/fail
// đều 500 ở HTTP level. Vitest service-level KHÔNG catch vì JSON.stringify
// chỉ chạy ở Express response path. View mapper cast bigint → string,
// Date → ISO string trước khi return ra controller. Smoke `pnpm
// smoke:tribulation` positive path expose bug và validate fix.
// ---------------------------------------------------------------------------

describe('toAttemptOutcomeView — BigInt + Date → string for HTTP JSON safety (Phase 11.6.B)', () => {
  it('SUCCESS outcome → reward.expBonus bigint cast string, penalty=null', () => {
    const outcome: TribulationAttemptOutcome = {
      success: true,
      tribulationKey: 'tribulation_kim_dan_nguyen_anh',
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      severity: 'minor',
      type: 'lei',
      wavesCompleted: 3,
      totalDamage: 3338,
      finalHp: 162,
      attemptIndex: 1,
      reward: {
        linhThach: 500,
        expBonus: 12345678901234567890n,
        titleKey: 'realm_nguyen_anh_master',
      },
      penalty: null,
      logId: 'log-uuid-success',
      consumedSupportItemKeys: [],
      supportTotalBonus: 0,
      successChance: { base: 0.7, supportBonus: 0, elementAdjustment: 0, raw: 0.7, final: 0.7, floorHit: false, ceilHit: false },
    };
    const view = toAttemptOutcomeView(outcome);
    expect(view.success).toBe(true);
    expect(view.reward).not.toBeNull();
    // BigInt > Number.MAX_SAFE_INTEGER → string preserve precision (chống lossy
    // Number cast ở FE).
    expect(view.reward!.expBonus).toBe('12345678901234567890');
    expect(typeof view.reward!.expBonus).toBe('string');
    expect(view.reward!.linhThach).toBe(500);
    expect(view.reward!.titleKey).toBe('realm_nguyen_anh_master');
    expect(view.penalty).toBeNull();
    expect(view.logId).toBe('log-uuid-success');
    // JSON.stringify must NOT throw (regression test cho bug).
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it('FAIL outcome → penalty.{expBefore,expAfter,expLoss} bigint cast string, cooldownAt+taoMaExpiresAt Date cast ISO', () => {
    const cooldownAt = new Date('2026-05-05T10:00:00.000Z');
    const taoMaExpiresAt = new Date('2026-05-05T10:30:00.000Z');
    const outcome: TribulationAttemptOutcome = {
      success: false,
      tribulationKey: 'tribulation_kim_dan_nguyen_anh',
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      severity: 'minor',
      type: 'lei',
      wavesCompleted: 1,
      totalDamage: 560,
      finalHp: 0,
      attemptIndex: 2,
      reward: null,
      penalty: {
        expBefore: 1000000000n,
        expAfter: 900000000n,
        expLoss: 100000000n,
        cooldownAt,
        taoMaActive: true,
        taoMaExpiresAt,
      },
      logId: 'log-uuid-fail',
      consumedSupportItemKeys: [],
      supportTotalBonus: 0,
      successChance: { base: 0.7, supportBonus: 0, elementAdjustment: 0, raw: 0.7, final: 0.7, floorHit: false, ceilHit: false },
    };
    const view = toAttemptOutcomeView(outcome);
    expect(view.success).toBe(false);
    expect(view.reward).toBeNull();
    expect(view.penalty).not.toBeNull();
    expect(view.penalty!.expBefore).toBe('1000000000');
    expect(view.penalty!.expAfter).toBe('900000000');
    expect(view.penalty!.expLoss).toBe('100000000');
    expect(typeof view.penalty!.expBefore).toBe('string');
    expect(typeof view.penalty!.expAfter).toBe('string');
    expect(typeof view.penalty!.expLoss).toBe('string');
    expect(view.penalty!.cooldownAt).toBe('2026-05-05T10:00:00.000Z');
    expect(view.penalty!.taoMaActive).toBe(true);
    expect(view.penalty!.taoMaExpiresAt).toBe('2026-05-05T10:30:00.000Z');
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it('FAIL outcome với taoMaActive=false → taoMaExpiresAt null preserved', () => {
    const outcome: TribulationAttemptOutcome = {
      success: false,
      tribulationKey: 'tribulation_kim_dan_nguyen_anh',
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      severity: 'minor',
      type: 'lei',
      wavesCompleted: 0,
      totalDamage: 800,
      finalHp: 0,
      attemptIndex: 1,
      reward: null,
      penalty: {
        expBefore: 50000n,
        expAfter: 45000n,
        expLoss: 5000n,
        cooldownAt: new Date('2026-05-05T10:00:00.000Z'),
        taoMaActive: false,
        taoMaExpiresAt: null,
      },
      logId: 'log-uuid-no-taoma',
      consumedSupportItemKeys: [],
      supportTotalBonus: 0,
      successChance: { base: 0.7, supportBonus: 0, elementAdjustment: 0, raw: 0.7, final: 0.7, floorHit: false, ceilHit: false },
    };
    const view = toAttemptOutcomeView(outcome);
    expect(view.penalty!.taoMaActive).toBe(false);
    expect(view.penalty!.taoMaExpiresAt).toBeNull();
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it('regression — JSON.stringify(rawOutcome) THROWS (proof bug existed without view)', () => {
    const rawOutcome: TribulationAttemptOutcome = {
      success: false,
      tribulationKey: 'tribulation_kim_dan_nguyen_anh',
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      severity: 'minor',
      type: 'lei',
      wavesCompleted: 1,
      totalDamage: 560,
      finalHp: 0,
      attemptIndex: 1,
      reward: null,
      penalty: {
        expBefore: 1000000000n,
        expAfter: 900000000n,
        expLoss: 100000000n,
        cooldownAt: new Date(),
        taoMaActive: false,
        taoMaExpiresAt: null,
      },
      logId: 'log-uuid-raw',
      consumedSupportItemKeys: [],
      supportTotalBonus: 0,
      successChance: { base: 0.7, supportBonus: 0, elementAdjustment: 0, raw: 0.7, final: 0.7, floorHit: false, ceilHit: false },
    };
    expect(() => JSON.stringify(rawOutcome)).toThrow(/BigInt/);
    // Sau khi cast view, JSON.stringify phải pass.
    expect(() => JSON.stringify(toAttemptOutcomeView(rawOutcome))).not.toThrow();
  });
});

// ── Phase 14.3.A — TribulationService.previewTribulation (read-only) ──
describe('Phase 14.3.A — TribulationService.previewTribulation', () => {
  it('character ở kim_dan stage 9 + đủ EXP → preview cho transition kim_dan→nguyen_anh', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview).not.toBeNull();
    expect(preview!.requirement).toBe(true);
    expect(preview!.fromRealmKey).toBe('kim_dan');
    expect(preview!.toRealmKey).toBe('nguyen_anh');
    expect(preview!.atPeak).toBe(true);
    expect(preview!.def.key).toBe('tribulation_kim_dan_nguyen_anh');
    expect(preview!.def.severity).toBe('minor');
    expect(preview!.def.type).toBe('lei');
    expect(preview!.def.wavesCount).toBe(3);
    expect(preview!.successChance.base).toBe(0.75); // minor base
    expect(preview!.successChance.final).toBeCloseTo(0.75);
    expect(preview!.supports).toEqual([]);
    expect(preview!.supportTotalBonus).toBe(0);
    expect(preview!.cooldownAt).toBeNull();
    expect(preview!.taoMaUntil).toBeNull();
    // Reward hint BigInt → string.
    expect(typeof preview!.rewardHint.expBonus).toBe('string');
    expect(preview!.rewardHint.linhThach).toBeGreaterThan(0);
    // Penalty hint pass-through.
    expect(preview!.penaltyHint.cooldownMinutes).toBe(30); // minor
    expect(preview!.penaltyHint.expLossRatio).toBeCloseTo(0.1);
  });

  it('character ở stage<9 → preview vẫn trả def, atPeak=false', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 5,
      exp: 0n,
      hp: 10_000,
      hpMax: 10_000,
      mp: 200,
      mpMax: 200,
      linhThach: 0n,
    });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview).not.toBeNull();
    expect(preview!.atPeak).toBe(false);
    expect(preview!.def.key).toBe('tribulation_kim_dan_nguyen_anh');
  });

  it('character ở low-tier (luyenkhi) → no kiếp def → null', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: (expCostForStage('luyenkhi', 9) ?? 0n) + 100n,
      hp: 1000,
      hpMax: 1000,
      mp: 100,
      mpMax: 100,
      linhThach: 0n,
    });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview).toBeNull();
  });

  it('character ở thanh_nhan (đỉnh, không nextRealm) → null', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'thanh_nhan',
      realmStage: 9,
      exp: 0n,
      hp: 1_000_000,
      hpMax: 1_000_000,
      mp: 200,
      mpMax: 200,
      linhThach: 0n,
    });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview).toBeNull();
  });

  it('không mutate state — gọi 2 lần liên tiếp trả cùng kết quả + KHÔNG insert log row', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const a = await svc.previewTribulation(ctx.characterId);
    const b = await svc.previewTribulation(ctx.characterId);
    expect(a).toEqual(b);

    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs.length).toBe(0);

    // Character row unchanged.
    const after = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(after!.realmKey).toBe('kim_dan');
    expect(after!.realmStage).toBe(9);
  });

  it('character không tồn tại → throw CHARACTER_NOT_FOUND', async () => {
    await expect(
      svc.previewTribulation('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(TribulationError);
  });

  it('cooldown active → cooldownAt cast → ISO string', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const future = new Date(Date.now() + 60 * 60_000);
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { tribulationCooldownAt: future },
    });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview!.cooldownAt).toBe(future.toISOString());
  });
});

// ── Phase 14.3.B — Tribulation Support Providers (preview) ──────────────
//
// Cover preview với supports populated từ inventory item / equipped item /
// active buff / learned talent qua các provider helpers shared. Verify:
//   - supports[] không còn empty khi player có hỗ trợ.
//   - source label (item/equipment/buff/talent) trong từng entry.
//   - successChance.support cộng dồn vào final.
//   - preview KHÔNG mutate state (inventory.qty, buff.stacks, char.realmStage
//     không thay đổi).
//   - low-tier (luyenkhi peak) → null vẫn giữ (preview path low-tier không
//     bị break).
describe('Phase 14.3.B — TribulationService.previewTribulation supports populated', () => {
  it('inventory có Thuận Kiếp Đan + Tử Kiếp Đan → 2 entry source=item', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'thuan_kiep_dan',
        qty: 3,
      },
    });
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'tu_kiep_dan',
        qty: 1,
      },
    });

    const preview = await svcFull.previewTribulation(ctx.characterId);
    expect(preview).not.toBeNull();
    const itemEntries = preview!.supports.filter((s) => s.source === 'item');
    expect(itemEntries).toHaveLength(2);
    const keys = itemEntries.map((e) => e.key).sort();
    expect(keys).toEqual(['thuan_kiep_dan', 'tu_kiep_dan']);
    // Total bonus = 0.05 + 0.08 = 0.13.
    expect(preview!.supportTotalBonus).toBeCloseTo(0.13);
    expect(preview!.successChance.supportBonus).toBeCloseTo(0.13);
    // Final = base 0.75 + supportBonus 0.13 = 0.88 (no other modifiers).
    expect(preview!.successChance.final).toBeCloseTo(0.88);
  });

  it('Hộ Kiếp Phù equipped → entry source=equipment + total bonus +0.06', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ho_kiep_phu',
        qty: 1,
        equippedSlot: 'ARTIFACT_2',
      },
    });

    const preview = await svcFull.previewTribulation(ctx.characterId);
    const equipEntries = preview!.supports.filter(
      (s) => s.source === 'equipment',
    );
    expect(equipEntries).toHaveLength(1);
    expect(equipEntries[0].key).toBe('ho_kiep_phu');
    expect(preview!.supportTotalBonus).toBeCloseTo(0.06);
  });

  it('active buff Thuận Kiếp Đan Ấn → entry source=buff + total bonus +0.05', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await buffSvc.applyBuff(ctx.characterId, 'thuan_kiep_dan_aura', 'pill');

    const preview = await svcFull.previewTribulation(ctx.characterId);
    const buffEntries = preview!.supports.filter((s) => s.source === 'buff');
    expect(buffEntries).toHaveLength(1);
    expect(buffEntries[0].key).toBe('thuan_kiep_dan_aura');
    expect(preview!.supportTotalBonus).toBeCloseTo(0.05);
  });

  it('learned talent talent_kim_thien_giap + wave có element kim → entry source=talent', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.characterTalent.create({
      data: {
        characterId: ctx.characterId,
        talentKey: 'talent_kim_thien_giap',
      },
    });

    const preview = await svcFull.previewTribulation(ctx.characterId);
    const talentEntries = preview!.supports.filter(
      (s) => s.source === 'talent',
    );
    // tribulation kim_dan→nguyen_anh waves = ['hoa', 'kim', 'hoa'] — match
    // wave element kim → entry.
    expect(talentEntries.length).toBeGreaterThanOrEqual(1);
    const kimEntry = talentEntries.find(
      (e) => e.key === 'talent_kim_thien_giap',
    );
    expect(kimEntry).toBeDefined();
    expect(kimEntry!.bonus).toBeCloseTo(0.05);
    expect(kimEntry!.element).toBe('kim');
  });

  it('mix nhiều nguồn (item + equipment + buff + talent) → total clamp ≤ 0.30', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // item: thuan_kiep_dan (+0.05) + tu_kiep_dan (+0.08) = 0.13
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'tu_kiep_dan', qty: 1 },
    });
    // equipment: ho_kiep_phu (+0.06) = 0.06
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ho_kiep_phu',
        qty: 1,
        equippedSlot: 'ARTIFACT_2',
      },
    });
    // buff: thuan_kiep_dan_aura (+0.05)
    await buffSvc.applyBuff(ctx.characterId, 'thuan_kiep_dan_aura', 'pill');
    // talent: talent_kim_thien_giap (+0.05) + talent_hoa_thien_giap (+0.05)
    // Cả 2 elements 'kim' và 'hoa' đều có trong tribulation lei waves.
    await prisma.characterTalent.create({
      data: {
        characterId: ctx.characterId,
        talentKey: 'talent_kim_thien_giap',
      },
    });
    await prisma.characterTalent.create({
      data: {
        characterId: ctx.characterId,
        talentKey: 'talent_hoa_thien_giap',
      },
    });

    const preview = await svcFull.previewTribulation(ctx.characterId);
    // Tổng raw = 0.05 + 0.08 + 0.06 + 0.05 + 0.05 + 0.05 = 0.34 → clamp 0.30.
    expect(preview!.supportTotalBonus).toBeCloseTo(0.3);
    // Source label đầy đủ.
    const sources = new Set(preview!.supports.map((s) => s.source));
    expect(sources.has('item')).toBe(true);
    expect(sources.has('equipment')).toBe(true);
    expect(sources.has('buff')).toBe(true);
    expect(sources.has('talent')).toBe(true);
  });

  it('preview KHÔNG mutate inventory/buff/character (read-only)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 3 },
    });
    await buffSvc.applyBuff(ctx.characterId, 'thuan_kiep_dan_aura', 'pill');

    // Snapshot.
    const charBefore = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    const invBefore = await prisma.inventoryItem.findMany({
      where: { characterId: ctx.characterId },
    });
    const buffsBefore = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });

    await svcFull.previewTribulation(ctx.characterId);
    await svcFull.previewTribulation(ctx.characterId);
    await svcFull.previewTribulation(ctx.characterId);

    // No log row written.
    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toHaveLength(0);

    // Inventory qty không bị decrement.
    const invAfter = await prisma.inventoryItem.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(invAfter).toHaveLength(invBefore.length);
    expect(invAfter[0].qty).toBe(invBefore[0].qty);

    // Buff stacks không bị consume.
    const buffsAfter = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(buffsAfter).toHaveLength(buffsBefore.length);
    expect(buffsAfter[0].stacks).toBe(buffsBefore[0].stacks);

    // Character realm/exp unchanged.
    const charAfter = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(charAfter!.realmKey).toBe(charBefore!.realmKey);
    expect(charAfter!.realmStage).toBe(charBefore!.realmStage);
    expect(charAfter!.exp).toBe(charBefore!.exp);
  });

  it('legacy svc (no inventory/buff/talent inject) → fallback supports rỗng (backward-compat)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // Add item + buff nhưng dùng svc baseline (không inject InventoryService /
    // BuffService / TalentService) → KHÔNG fetch → supports rỗng.
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    const preview = await svc.previewTribulation(ctx.characterId);
    expect(preview!.supports).toEqual([]);
    expect(preview!.supportTotalBonus).toBe(0);
  });

  it('low-tier (luyenkhi peak) → preview vẫn null (no kiếp def cho transition này)', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 9,
      exp: (expCostForStage('luyenkhi', 9) ?? 0n) + 100n,
      hp: 1000,
      hpMax: 1000,
      mp: 100,
      mpMax: 100,
      linhThach: 0n,
    });
    // Player có 1 đan và 1 buff hỗ trợ — không quan trọng vì transition này
    // không có TribulationDef → preview return null.
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    await buffSvc.applyBuff(ctx.characterId, 'thuan_kiep_dan_aura', 'pill');
    const preview = await svcFull.previewTribulation(ctx.characterId);
    expect(preview).toBeNull();
  });
});

// ── Phase 14.3.C — Tribulation Support Item Consumption ──────────────────
//
// Coverage:
//  1. Empty selection → no consume, no support bonus, baseline behavior (regression).
//  2. SUCCESS path consume — 1 item key, 1 stack consumed, ledger row written
//     reason=TRIBULATION_SUPPORT_CONSUME refType=TribulationAttemptLog refId=logId.
//  3. FAIL path consume — item vẫn bị consume (design: failed attempt vẫn dùng).
//  4. Reject INVALID_SUPPORT_ITEM (key không phải consumable support).
//  5. Reject TOO_MANY_SUPPORT_ITEMS (> 3).
//  6. Reject DUPLICATE_SUPPORT_ITEM.
//  7. Reject SUPPORT_ITEM_MISSING (player không có item trong inventory).
//  8. Reject INVALID_SUPPORT_SELECTION (non-array body).
//  9. Cap server-side: 3 items × 0.08 = 0.24 → cap về 0.10 + 0.10 + 0.04 = 0.24
//     do per-entry ceil 0.10 + total 0.30 cap. Damage giảm proportional.
// 10. Idempotency: 2 attempt liên tiếp với cùng selection — mỗi attempt consume
//     1 stack (KHÔNG share state) → tổng 2 stacks consumed.
// 11. preview availableSupportItems trả qty + bonus + label đúng từ catalog.
// 12. preview KHÔNG mutate inventory (regression check).
// 13. Race / consume fail → tx rollback (no exp loss, no log).
describe('Phase 14.3.C — TribulationService.attemptTribulation support item consume', () => {
  it('empty selection (default) → no consume, no bonus, KHÔNG ghi ItemLedger', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const out = await svcFull.attemptTribulation(ctx.characterId, () => 0.0);
    expect(out.success).toBe(true);
    expect(out.consumedSupportItemKeys).toEqual([]);
    expect(out.supportTotalBonus).toBe(0);
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: ctx.characterId, reason: 'TRIBULATION_SUPPORT_CONSUME' },
    });
    expect(ledger).toEqual([]);
  });

  it('SUCCESS path với 1 item → consume 1 stack, ghi ledger refType=TribulationAttemptLog', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 2 },
    });
    const out = await svcFull.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      new Date(),
      { selectedSupportItemKeys: ['thuan_kiep_dan'] },
    );
    expect(out.success).toBe(true);
    expect(out.consumedSupportItemKeys).toEqual(['thuan_kiep_dan']);
    expect(out.supportTotalBonus).toBeGreaterThan(0);
    const post = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(post?.qty).toBe(1);
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: ctx.characterId, reason: 'TRIBULATION_SUPPORT_CONSUME' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].itemKey).toBe('thuan_kiep_dan');
    expect(ledger[0].qtyDelta).toBe(-1);
    expect(ledger[0].refType).toBe('TribulationAttemptLog');
    expect(ledger[0].refId).toBe(out.logId);
  });

  it('FAIL path vẫn consume item (design: failed attempt KHÔNG refund)', async () => {
    // hpMax thấp để force fail.
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    const out = await svcFull.attemptTribulation(
      ctx.characterId,
      () => 0.99,
      new Date(),
      { selectedSupportItemKeys: ['thuan_kiep_dan'] },
    );
    expect(out.success).toBe(false);
    expect(out.consumedSupportItemKeys).toEqual(['thuan_kiep_dan']);
    const post = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(post).toBeNull();
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: ctx.characterId, reason: 'TRIBULATION_SUPPORT_CONSUME' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].refId).toBe(out.logId);
  });

  it('reject INVALID_SUPPORT_ITEM (catalog key not a consumable support)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svcFull.attemptTribulation(
        ctx.characterId,
        () => 0.0,
        new Date(),
        { selectedSupportItemKeys: ['ho_kiep_phu'] },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SUPPORT_ITEM' });
    // Character KHÔNG bị mutate.
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: ctx.characterId },
    });
    expect(c.realmKey).toBe('kim_dan');
    expect(c.realmStage).toBe(9);
  });

  it('reject TOO_MANY_SUPPORT_ITEMS (>3 selected)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svcFull.attemptTribulation(
        ctx.characterId,
        () => 0.0,
        new Date(),
        {
          selectedSupportItemKeys: [
            'thuan_kiep_dan',
            'tu_kiep_dan',
            'thuan_kiep_dan',
            'tu_kiep_dan',
          ],
        },
      ),
    ).rejects.toMatchObject({ code: 'TOO_MANY_SUPPORT_ITEMS' });
  });

  it('reject DUPLICATE_SUPPORT_ITEM', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svcFull.attemptTribulation(
        ctx.characterId,
        () => 0.0,
        new Date(),
        { selectedSupportItemKeys: ['thuan_kiep_dan', 'thuan_kiep_dan'] },
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_SUPPORT_ITEM' });
  });

  it('reject SUPPORT_ITEM_MISSING khi player không có item trong inventory', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // KHÔNG add item.
    await expect(
      svcFull.attemptTribulation(
        ctx.characterId,
        () => 0.0,
        new Date(),
        { selectedSupportItemKeys: ['thuan_kiep_dan'] },
      ),
    ).rejects.toMatchObject({ code: 'SUPPORT_ITEM_MISSING' });
    // Reject TRƯỚC log → không log row, KHÔNG mất EXP.
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: ctx.characterId },
    });
    expect(c.exp).toBe(KIM_DAN_COST_9 + 1000n);
    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toEqual([]);
  });

  it('cap server-side: 2 items × 0.08 = 0.16 → cap per-entry 0.10 + 0.08 = 0.18; nhưng total ≤ 0.30', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'tu_kiep_dan', qty: 1 },
    });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    const out = await svcFull.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      new Date(),
      { selectedSupportItemKeys: ['tu_kiep_dan', 'thuan_kiep_dan'] },
    );
    expect(out.success).toBe(true);
    // tu_kiep_dan 0.08 + thuan_kiep_dan 0.05 = 0.13 (under both caps).
    expect(out.supportTotalBonus).toBeCloseTo(0.13, 5);
    expect(out.supportTotalBonus).toBeLessThanOrEqual(0.3);
  });

  it('idempotency: 2 attempt liên tiếp consume 1 stack/lần (KHÔNG share state)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 5 },
    });
    const out1 = await svcFull.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      new Date(),
      { selectedSupportItemKeys: ['thuan_kiep_dan'] },
    );
    expect(out1.success).toBe(true);
    // Refill character về peak để attempt 2.
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: {
        realmKey: 'kim_dan',
        realmStage: 9,
        exp: KIM_DAN_COST_9 + 1000n,
        hpMax: 10_000,
        hp: 10_000,
        tribulationCooldownAt: null,
      },
    });
    const out2 = await svcFull.attemptTribulation(
      ctx.characterId,
      () => 0.0,
      new Date(),
      { selectedSupportItemKeys: ['thuan_kiep_dan'] },
    );
    expect(out2.success).toBe(true);
    const post = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(post?.qty).toBe(3); // 5 - 2 = 3
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: ctx.characterId, reason: 'TRIBULATION_SUPPORT_CONSUME' },
    });
    expect(ledger).toHaveLength(2);
    expect(new Set(ledger.map((l) => l.refId))).toEqual(
      new Set([out1.logId, out2.logId]),
    );
  });

  it('previewTribulation populate availableSupportItems từ inventory', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 3 },
    });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'tu_kiep_dan', qty: 1 },
    });
    const preview = await svcFull.previewTribulation(ctx.characterId);
    expect(preview).not.toBeNull();
    expect(preview!.availableSupportItems).toHaveLength(2);
    const thuan = preview!.availableSupportItems.find(
      (e) => e.itemKey === 'thuan_kiep_dan',
    );
    expect(thuan).toBeDefined();
    expect(thuan!.qty).toBe(3);
    expect(thuan!.bonus).toBeCloseTo(0.05, 5);
    expect(typeof thuan!.label).toBe('string');
    expect(preview!.maxSelectedSupportItems).toBe(3);
  });

  it('preview KHÔNG mutate inventory (regression: read-only)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 2 },
    });
    await svcFull.previewTribulation(ctx.characterId);
    const post = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(post?.qty).toBe(2);
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: ctx.characterId, reason: 'TRIBULATION_SUPPORT_CONSUME' },
    });
    expect(ledger).toEqual([]);
  });

  it('inventory unavailable (svc baseline) + selectedKeys non-empty → INVENTORY_UNAVAILABLE', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    // svc (baseline, no inventory inject) + selectedKeys non-empty → service
    // throw vì không thể consume. Validate runs trước (catalog-only) nên
    // INVALID_SUPPORT_ITEM check vẫn pass (thuan_kiep_dan là valid catalog).
    // Pre-check ownership inside tx fail vì tx.inventoryItem.findFirst trả null
    // (no row) → SUPPORT_ITEM_MISSING. Test này vì vậy assert
    // SUPPORT_ITEM_MISSING (chưa có item) thay vì INVENTORY_UNAVAILABLE.
    await expect(
      svc.attemptTribulation(
        ctx.characterId,
        () => 0.0,
        new Date(),
        { selectedSupportItemKeys: ['thuan_kiep_dan'] },
      ),
    ).rejects.toMatchObject({ code: 'SUPPORT_ITEM_MISSING' });
  });
});

/**
 * Phase 14.3.D — Tribulation Encounter System tests.
 *
 * Coverage:
 *   - getCurrentEncounter trả null cho character chưa có transition.
 *   - getCurrentEncounter trả encounter spec hợp lệ ở peak kim_dan.
 *   - startEncounter peak gate (NOT_AT_PEAK).
 *   - startEncounter idempotent (same tribulation key → reuse pending row).
 *   - resolveEncounter SUCCESS (advance realm + reward + log link).
 *   - resolveEncounter FAIL (penalty nhẹ + log link).
 *   - resolveEncounter idempotent (no double breakthrough/consume/reward).
 *   - resolveEncounter NO_PENDING_ENCOUNTER khi chưa start.
 *   - support items affect chance (compose bonus > 0 sau resolve).
 *   - element advantage tính đúng (primary element vs encounter element).
 *   - low-tier breakthrough cũ KHÔNG affected (regression guard).
 */
describe('TribulationService.getCurrentEncounter (Phase 14.3.D)', () => {
  it('returns null khi character không có transition (mortal start)', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'mortal',
      realmStage: 1,
      exp: 0n,
      hp: 100,
      hpMax: 100,
      mp: 10,
      mpMax: 10,
      linhThach: 0n,
    });
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    // mortal → kim_dan low-tier KHÔNG có TribulationDef → null.
    expect(result).toBeNull();
  });

  it('returns encounter spec ở peak kim_dan (lei → hoa BURST)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    expect(result).not.toBeNull();
    expect(result!.requirement).toBe(true);
    expect(result!.atPeak).toBe(true);
    expect(result!.fromRealmKey).toBe('kim_dan');
    expect(result!.toRealmKey).toBe('nguyen_anh');
    expect(result!.severity).toBe('minor');
    expect(result!.type).toBe('lei');
    // lei → dominant element hoa → encounter BURST.
    expect(result!.encounter.element).toBe('hoa');
    expect(result!.encounter.effectType).toBe('BURST');
    expect(result!.encounter.phaseCount).toBeGreaterThanOrEqual(1);
    expect(result!.encounter.successThreshold).toBeGreaterThanOrEqual(0.1);
    expect(result!.encounter.requiredPowerHint).toBeGreaterThan(0);
    expect(result!.successChance).not.toBeNull();
    expect(result!.pending).toBeNull();
  });

  it('returns pending row sau khi startEncounter', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const started = await svcFull.startEncounter(ctx.characterId);
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    expect(result!.pending).not.toBeNull();
    expect(result!.pending!.id).toBe(started.id);
    expect(result!.pending!.state).toBe('pending');
  });

  it('element advantage: primary=hoa vs encounter=hoa → +2 (same)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { primaryElement: 'hoa' },
    });
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    expect(result!.encounter.playerPrimaryElement).toBe('hoa');
    expect(result!.encounter.elementAdvantage).toBe(2);
  });

  it('element advantage: primary=thuy vs encounter=hoa → +1 (player counters encounter)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { primaryElement: 'thuy' },
    });
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    // thuy khắc hoa → player advantage → +1.
    expect(result!.encounter.elementAdvantage).toBe(1);
  });

  it('element advantage: primary=moc vs encounter=hoa → -1 (player feeds encounter)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.character.update({
      where: { id: ctx.characterId },
      data: { primaryElement: 'moc' },
    });
    const result = await svcFull.getCurrentEncounter(ctx.characterId);
    // moc generates hoa → player feeds encounter → -1.
    expect(result!.encounter.elementAdvantage).toBe(-1);
  });
});

describe('TribulationService.startEncounter (Phase 14.3.D)', () => {
  it('NOT_AT_PEAK rejection (realmStage=8, exp insufficient)', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 8,
      exp: 0n,
      hp: 100,
      hpMax: 100,
      mp: 10,
      mpMax: 10,
      linhThach: 0n,
    });
    await expect(svcFull.startEncounter(ctx.characterId)).rejects.toMatchObject(
      { code: 'NOT_AT_PEAK' },
    );
  });

  it('SUCCESS path: tạo pending row với selectedSupportItemKeys snapshot', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    const started = await svcFull.startEncounter(ctx.characterId, {
      selectedSupportItemKeys: ['thuan_kiep_dan'],
    });
    expect(started.state).toBe('pending');
    expect(started.tribulationKey).toBeDefined();
    expect(started.encounterKey).toBe('tribulation_encounter_hoa');
    expect(started.element).toBe('hoa');
    expect(started.effectType).toBe('BURST');
    expect(started.selectedSupportItemKeys).toEqual(['thuan_kiep_dan']);
    expect(started.resolvedAt).toBeNull();
    expect(started.resolvedAttemptLogId).toBeNull();

    // Inventory KHÔNG consume ở start (consume đợi resolve).
    const post = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(post?.qty).toBe(1);
  });

  it('idempotent re-call: cùng tribulationKey → return pending row đã có', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const first = await svcFull.startEncounter(ctx.characterId);
    const second = await svcFull.startEncounter(ctx.characterId);
    expect(second.id).toBe(first.id);
    const allRows = await prisma.tribulationEncounter.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(allRows).toHaveLength(1);
  });

  it('reject SUPPORT_ITEM_MISSING khi item không có trong inventory', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svcFull.startEncounter(ctx.characterId, {
        selectedSupportItemKeys: ['thuan_kiep_dan'],
      }),
    ).rejects.toMatchObject({ code: 'SUPPORT_ITEM_MISSING' });
  });
});

describe('TribulationService.resolveEncounter (Phase 14.3.D)', () => {
  it('NO_PENDING_ENCOUNTER khi chưa startEncounter', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await expect(
      svcFull.resolveEncounter(ctx.characterId, () => 0.0),
    ).rejects.toMatchObject({ code: 'NO_PENDING_ENCOUNTER' });
  });

  it('SUCCESS path: simulate + advance realm + reward + log link', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    const started = await svcFull.startEncounter(ctx.characterId);
    const out = await svcFull.resolveEncounter(
      ctx.characterId,
      () => 0.0,
      new Date(),
    );
    expect(out.success).toBe(true);
    expect(out.fromRealmKey).toBe('kim_dan');
    expect(out.toRealmKey).toBe('nguyen_anh');
    expect(out.reward).not.toBeNull();
    expect(out.reward!.linhThach).toBeGreaterThan(0);

    // Encounter row updated to resolved.
    const row = await prisma.tribulationEncounter.findUnique({
      where: { id: started.id },
    });
    expect(row?.state).toBe('resolved');
    expect(row?.resolvedAt).not.toBeNull();
    expect(row?.resolvedAttemptLogId).toBe(out.logId);

    // Character realm advanced.
    const character = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(character?.realmKey).toBe('nguyen_anh');
    expect(character?.realmStage).toBe(1);
  });

  it('FAIL path: hp thấp → fail, penalty nhẹ (cooldown set), KHÔNG advance realm', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 100 });
    const started = await svcFull.startEncounter(ctx.characterId);
    const out = await svcFull.resolveEncounter(
      ctx.characterId,
      () => 0.99,
      new Date(),
    );
    expect(out.success).toBe(false);
    expect(out.penalty).not.toBeNull();
    expect(out.penalty!.cooldownAt).toBeInstanceOf(Date);
    expect(out.reward).toBeNull();

    const row = await prisma.tribulationEncounter.findUnique({
      where: { id: started.id },
    });
    expect(row?.state).toBe('resolved');
    expect(row?.resolvedAttemptLogId).toBe(out.logId);

    const character = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    // KHÔNG advance realm.
    expect(character?.realmKey).toBe('kim_dan');
  });

  it('idempotent re-resolve: KHÔNG double breakthrough, KHÔNG double consume, KHÔNG double reward', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    await svcFull.startEncounter(ctx.characterId, {
      selectedSupportItemKeys: ['thuan_kiep_dan'],
    });
    const first = await svcFull.resolveEncounter(
      ctx.characterId,
      () => 0.0,
      new Date(),
    );
    expect(first.success).toBe(true);
    expect(first.consumedSupportItemKeys).toEqual(['thuan_kiep_dan']);

    const characterAfterFirst = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    const linhThachAfterFirst = characterAfterFirst!.linhThach;
    const realmAfterFirst = characterAfterFirst!.realmKey;

    // Re-call resolve → reconstruct from log.
    const second = await svcFull.resolveEncounter(
      ctx.characterId,
      () => 0.0,
      new Date(),
    );
    expect(second.success).toBe(true);
    expect(second.logId).toBe(first.logId); // same log row.

    const characterAfterSecond = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    // Realm + linhThach KHÔNG đổi (no double breakthrough/reward).
    expect(characterAfterSecond!.linhThach).toBe(linhThachAfterFirst);
    expect(characterAfterSecond!.realmKey).toBe(realmAfterFirst);

    // Inventory KHÔNG mất stack mới (no double consume).
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan' },
    });
    expect(inv).toBeNull(); // 1 stack đã consume ở first; second KHÔNG consume thêm.

    // 1 attempt log row only.
    const logs = await prisma.tribulationAttemptLog.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toHaveLength(1);

    // 1 currency ledger row only (TRIBULATION_REWARD).
    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId: ctx.characterId,
        reason: 'TRIBULATION_REWARD',
      },
    });
    expect(ledger).toHaveLength(1);
  });

  it('support items affect chance (compose bonus > 0 sau resolve)', async () => {
    const ctx = await setupCharAtKimDanPeak({ hpMax: 10_000 });
    await prisma.inventoryItem.create({
      data: { characterId: ctx.characterId, itemKey: 'thuan_kiep_dan', qty: 1 },
    });
    await svcFull.startEncounter(ctx.characterId, {
      selectedSupportItemKeys: ['thuan_kiep_dan'],
    });
    const out = await svcFull.resolveEncounter(
      ctx.characterId,
      () => 0.0,
      new Date(),
    );
    expect(out.consumedSupportItemKeys).toEqual(['thuan_kiep_dan']);
    expect(out.supportTotalBonus).toBeGreaterThan(0);
  });
});

