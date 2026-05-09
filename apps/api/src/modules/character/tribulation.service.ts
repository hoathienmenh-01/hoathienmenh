import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  buildSelectedSupportItemEntries,
  collectBuffTribulationSupports,
  collectEquipmentTribulationSupports,
  collectItemTribulationSupports,
  collectTalentTribulationSupports,
  composeTribulationSupports,
  computeEquipmentTribulationResist,
  computePassiveTalentTribulationResist,
  computeSpiritualRootTribulationResist,
  computeTribulationEncounterPhaseCount,
  computeTribulationEncounterPowerHint,
  computeTribulationFailurePenalty,
  computeTribulationReward,
  computeTribulationSuccessChance,
  describeTribulationEncounterAdvantage,
  ELEMENT_MODIFIER_ABSOLUTE_CEIL,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
  ELEMENTS,
  expCostForStage,
  getTribulationForBreakthrough,
  itemByKey,
  listTribulationSupportConsumables,
  nextRealm,
  resolveTribulationEncounterDef,
  simulateTribulation,
  summarizeTribulationPenaltyHint,
  summarizeTribulationRewardHint,
  titleForRealmMilestone,
  TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS,
  validateTribulationSupportSelection,
  type ElementKey,
  type ItemDef,
  type PassiveTalentMods,
  type TribulationDef,
  type TribulationEncounterDef,
  type TribulationPenaltyHint,
  type TribulationRewardHint,
  type TribulationSuccessChanceBreakdown,
  type TribulationSupportEntry,
  type TribulationSupportSelectionError,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AchievementService } from './achievement.service';
import { BuffService } from './buff.service';
import { CurrencyService } from './currency.service';
import { TalentService } from './talent.service';
import { TitleService } from './title.service';

/**
 * Phase 11.6.B Tribulation/Tâm Ma MVP runtime — server-authoritative deterministic kiếp.
 *
 * Manual breakthrough flow cho realm threshold cao (theo `TRIBULATIONS` catalog
 * trong `packages/shared/src/tribulation.ts`). Khác với
 * {@link CharacterService.breakthrough} (low-tier, không kiếp), service này:
 *   - Verify cùng realm gate (`realmStage===9` + `exp>=cost(9)`).
 *   - Verify catalog có `TribulationDef` cho transition `c.realmKey → next`.
 *   - Verify cooldown chưa active (`Character.tribulationCooldownAt`).
 *   - Roll deterministic simulation qua `simulateTribulation(def, hp, resistFn)`.
 *   - Roll RNG `[0,1]` cho `taoMaDebuffChance` (test inject `() => 0.0` lock-in
 *     debuff trigger; `() => 0.99` block).
 *   - Apply outcome (atomic trong `prisma.$transaction`):
 *     - Success → realm advance giống {@link CharacterService.breakthrough}
 *       (`realmKey=next`, `realmStage=1`, `exp -= cost9 + bonus`,
 *       `hpMax/mpMax × 1.2`, `hp/mp = max`), grant linhThach reward qua
 *       `CurrencyLedger.TRIBULATION_REWARD`, clear `tribulationCooldownAt` +
 *       `taoMaUntil`, write `TribulationAttemptLog{success:true}`.
 *     - Fail → apply penalty từ `computeTribulationFailurePenalty(...)`
 *       (EXP loss, cooldown, optional Tâm Ma debuff), set `hp=1` (knock down,
 *       không death), write `TribulationAttemptLog{success:false}`.
 *
 * Element resist (Phase 11.6.C — wired): wave element của mỗi
 * `TribulationDef.waves[i].element` được resolve qua
 * {@link computeSpiritualRootTribulationResist} dựa trên `Character.primaryElement`
 * + `Character.secondaryElements`. Tâm Kiếp (`element=null`) luôn fallback 1.0.
 * Legacy character (chưa onboard linh căn → primaryElement=null) cũng fallback
 * 1.0 (backward-compat).
 *
 * Talent resist (Phase 11.6.D — wired): trên top spiritual root resist, compose
 * multiplicatively với {@link computePassiveTalentTribulationResist} từ
 * {@link TalentService.getMods}. Producer = 5 talent `talent_<elem>_thien_giap`
 * `kind: 'element_resist' value: 0.95`. Tổng resist clamp envelope qua
 * `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR, ELEMENT_MODIFIER_ABSOLUTE_CEIL]` (`0.6..1.5`).
 * `talents` Optional: legacy test (no talent inject) → fallback 1.0 (no extra
 * resist).
 *
 * Equipment resist (Phase 11.6.E — wired): trên top talent resist, compose
 * multiplicatively với {@link computeEquipmentTribulationResist} từ
 * {@link InventoryService.equipElementResistMods}. Producer = 5 catalog armor
 * `huyen_giap_phong_<elem>` (`ItemBonus.elementResist[<elem>] = 0.95`). Compose
 * order: `rootResist × talentResist × equipmentResist`, clamp tổng theo cùng
 * envelope `[FLOOR, CEIL]`. `inventory` Optional: legacy test (no inventory
 * inject) → fallback empty map → identity 1.0 (no extra resist).
 *
 * Idempotency: KHÔNG có natural key — caller phải debounce. Mỗi attempt = 1
 * row `TribulationAttemptLog` mới + 1 row `CurrencyLedger` (chỉ khi success).
 */
@Injectable()
export class TribulationService {
  private readonly logger = new Logger(TribulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly titles?: TitleService,
    private readonly buffs?: BuffService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly talents?: TalentService,
    // Phase 11.6.E — Optional + forwardRef vì InventoryModule ↔ CharacterModule
    // có circular import (InventoryService inject CharacterService cho equip
    // restat). Legacy test (no inventory inject) → fallback empty map.
    @Optional()
    @Inject(forwardRef(() => InventoryService))
    private readonly inventory?: InventoryService,
  ) {}

  /**
   * Thực hiện 1 tribulation attempt cho character.
   *
   * @param characterId character id (server-trusted, đã resolve từ userId).
   * @param rng deterministic RNG source cho `taoMaDebuffChance` roll.
   *   Default = `Math.random` (production server-authoritative roll).
   * @param now timestamp gốc cho cooldown + taoMaExpiresAt computation.
   *   Default = `new Date()`. Inject từ test để control timeline.
   */
  async attemptTribulation(
    characterId: string,
    rng: () => number = Math.random,
    now: Date = new Date(),
    options: TribulationAttemptOptions = {},
  ): Promise<TribulationAttemptOutcome> {
    const selectedKeysRaw = options.selectedSupportItemKeys ?? [];
    // Phase 14.3.C — pure validate (catalog + dedupe + cap). KHÔNG check
    // inventory ở đây vì cần tx; ownership check inside tx.
    const validateResult = validateTribulationSupportSelection(selectedKeysRaw);
    if (!validateResult.ok) {
      throw new TribulationError(
        mapSupportSelectionErrorToTribulationCode(validateResult.code),
      );
    }
    const selectedKeys: readonly string[] = validateResult.entries.map(
      (e: TribulationSupportEntry) => e.key,
    );

    const outcome = await this.prisma.$transaction(async (tx) => {
      return this.runAttemptInTx(tx, characterId, selectedKeys, rng, now);
    });

    // Phase 11.10.G — fail-soft post-tx tracking. Tribulation success advance
    // realm giống `CultivationProcessor` low-tier breakthrough; pair với
    // `AchievementService.trackEvent('BREAKTHROUGH', 1)` để 4 achievement
    // catalog `BREAKTHROUGH` (`achievements.ts` line 228..278) thực sự
    // increment khi player clear realm cao qua tribulation.
    if (outcome.success && this.achievements) {
      try {
        await this.achievements.trackEvent(characterId, 'BREAKTHROUGH', 1);
      } catch (e) {
        this.logger.warn(
          `tribulation: achievement BREAKTHROUGH track failed for char=${characterId}: ${(e as Error).message}`,
        );
      }
    }

    return outcome;
  }

  /**
   * Phase 14.3.D — extracted core attempt logic (1 atomic block within an
   * outer Prisma `$transaction`). Used by both:
   *   - {@link attemptTribulation} (legacy 1-step flow, Phase 11.6.B).
   *   - {@link resolveTribulationEncounter} (Phase 14.3.D 2-phase flow).
   *
   * Caller responsibilities:
   *   - Pre-validate + dedupe + cap `selectedKeys` (already done by
   *     {@link validateTribulationSupportSelection}).
   *   - Wrap in own `prisma.$transaction(...)`.
   *   - Apply post-tx side effects (achievement track) outside this helper.
   *
   * Behavior identical to original 1-method flow — preserved 1:1.
   */
  private async runAttemptInTx(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    characterId: string,
    selectedKeys: readonly string[],
    rng: () => number,
    now: Date,
  ): Promise<TribulationAttemptOutcome> {
    {
      const character = await tx.character.findUnique({
        where: { id: characterId },
      });
      if (!character) throw new TribulationError('CHARACTER_NOT_FOUND');

      // Realm gate: peak (stage 9) + đủ EXP cost — giống `breakthrough()`.
      if (character.realmStage < 9) throw new TribulationError('NOT_AT_PEAK');
      const cost = expCostForStage(character.realmKey, 9);
      if (cost === null || character.exp < cost) {
        throw new TribulationError('NOT_AT_PEAK');
      }

      // Catalog gate: phải có TribulationDef cho transition này. Nếu không
      // (low-tier transition: phamnhan→luyenkhi v.v.), caller phải dùng
      // `CharacterService.breakthrough()` low-risk thay vì service này.
      const next = nextRealm(character.realmKey);
      if (!next) throw new TribulationError('NO_NEXT_REALM');
      const def = getTribulationForBreakthrough(character.realmKey, next.key);
      if (!def) throw new TribulationError('NO_TRIBULATION_FOR_TRANSITION');

      // Cooldown gate (set từ FAIL trước đó).
      if (
        character.tribulationCooldownAt &&
        character.tribulationCooldownAt > now
      ) {
        throw new TribulationError('COOLDOWN_ACTIVE');
      }

      // Đếm attempt index cho transition (audit + tests).
      const priorAttempts = await tx.tribulationAttemptLog.count({
        where: { characterId, tribulationKey: def.key },
      });
      const attemptIndex = priorAttempts + 1;

      // Phase 14.3.C — Pre-check inventory ownership trong tx. Selected key
      // phải có ít nhất 1 stack unequipped (qty>0, equippedSlot=null) tại thời
      // điểm attempt. Nếu missing/insufficient → reject TRƯỚC khi sim/log →
      // KHÔNG burn EXP, KHÔNG cooldown. Player retry an toàn (idempotent).
      // Race condition: 2 attempt song song cùng key → 1 trúng consume,
      // 1 fail ở consumeOneByItemKeyTx (decResult.count===0) → throw → tx
      // rollback. Cả 2 đều atomic.
      for (const key of selectedKeys) {
        const owned = await tx.inventoryItem.findFirst({
          where: { characterId, itemKey: key, equippedSlot: null, qty: { gt: 0 } },
          select: { id: true },
        });
        if (!owned) throw new TribulationError('SUPPORT_ITEM_MISSING');
      }

      // Element resist: Phase 11.6.C — wire Character.primaryElement +
      // secondaryElements vào computeSpiritualRootTribulationResist. Defensive
      // narrow primaryElement string → ElementKey union (Prisma trả về string?).
      const primaryElement: ElementKey | null =
        character.primaryElement && (ELEMENTS as readonly string[]).includes(character.primaryElement)
          ? (character.primaryElement as ElementKey)
          : null;
      const secondaryElements: ElementKey[] = (character.secondaryElements ?? [])
        .filter((e): e is ElementKey =>
          (ELEMENTS as readonly string[]).includes(e),
        );

      // Phase 11.6.D — compose talent passive resist multiplicatively trên top
      // spiritual root resist. `talents` Optional (test/legacy bootstrap chưa
      // inject) → fallback identity mods (no extra resist).
      let talentMods: PassiveTalentMods | null = null;
      if (this.talents) {
        talentMods = await this.talents.getMods(characterId);
      }

      // Phase 11.6.E — compose equipment elementResist multiplicatively trên top
      // talent resist. `inventory` Optional (legacy test) → empty map → identity
      // 1.0. Lookup 1 lần / attempt vì equipment không đổi trong tx tribulation.
      let equipmentResistMods: ReadonlyMap<ElementKey, number> = new Map();
      if (this.inventory) {
        equipmentResistMods = await this.inventory.equipElementResistMods(
          characterId,
        );
      }

      // Phase 14.3.C — server-side recalc composedSupports cho attempt.
      // KHÔNG tin FE-sent bonus value: build entries từ
      //   - selectedKeys (validated, bonus từ catalog)
      //   - equipment supports (đeo on character — passive, KHÔNG consume)
      //   - buff supports (active buff — passive)
      //   - talent supports (learned talent — passive)
      // Inventory items KHÔNG selected → KHÔNG đóng góp bonus (player phải
      // explicit chọn để consume). Compose qua foundation clamp per-entry +
      // total → totalBonus ∈ [-TRIBULATION_SUPPORT_TOTAL_CEIL, +ditto].
      const selectedItemEntries = buildSelectedSupportItemEntries(selectedKeys);
      const supportEntries: TribulationSupportEntry[] = [...selectedItemEntries];

      // Equipment supports — collect từ inventory rows (equippedSlot != null).
      // Đọc qua tx vì tx.inventoryItem.findMany sẽ thấy state đã sync với
      // pre-check ownership ở trên + sẽ guard nếu equipped item bị thay đổi
      // trong race window.
      const allRows = await tx.inventoryItem.findMany({
        where: { characterId },
        select: { itemKey: true, qty: true, equippedSlot: true },
      });
      const supportRows = allRows.map((r) => ({
        itemKey: r.itemKey,
        qty: r.qty,
        equippedSlot: r.equippedSlot,
      }));
      supportEntries.push(...collectEquipmentTribulationSupports(supportRows));

      // Buff supports — active buffs có BuffDef.tribulationSupport.
      if (this.buffs) {
        const activeBuffs = await this.buffs.listActive(characterId, now);
        supportEntries.push(...collectBuffTribulationSupports(activeBuffs));
      }

      // Talent supports — learned talents có element_resist matching wave
      // element của kiếp sắp tới.
      if (this.talents) {
        const learnedTalents = await this.talents.listLearned(characterId);
        const waveElements: (ElementKey | null)[] = def.waves.map(
          (w) => w.element,
        );
        supportEntries.push(
          ...collectTalentTribulationSupports(
            learnedTalents.map((l) => l.talentKey),
            waveElements,
          ),
        );
      }

      const composedSupports = composeTribulationSupports(supportEntries);
      // Phase 14.3.C — successChance breakdown server-side (parity với
      // preview). Persist vào response để FE/audit so sánh với preview pre-
      // attempt. Bao gồm TẤT CẢ supports (item/equipment/buff/talent) —
      // mirror Phase 14.3.B preview semantics.
      const successChanceBreakdown = computeTribulationSuccessChance({
        def,
        primaryElement,
        secondaryElements,
        supports: composedSupports,
      });
      // Damage-layer supportMultiplier dùng RIÊNG composition KHÔNG bao gồm
      // talent supports — vì talent element_resist đã được áp via
      // `computePassiveTalentTribulationResist` ở elementResistFn (avoid
      // double-count). Item / buff / equipment có dedicated `tribulationSupport`
      // field độc lập với element_resist nên KHÔNG double-count.
      //
      // Convention:
      //   damageSupports.totalBonus = 0.13 → supportMultiplier = 0.87
      //   → damage layer × 0.87 (giảm 13% sát thương kiếp).
      // Stack multiplicative: clamped(elementLayer) × supportMultiplier.
      // Sàn 0.5 guard nếu cap config bị đẩy bất thường > 0.5.
      const damageSupports = composeTribulationSupports([
        ...selectedItemEntries,
        ...collectEquipmentTribulationSupports(supportRows),
        ...(this.buffs
          ? collectBuffTribulationSupports(
              await this.buffs.listActive(characterId, now),
            )
          : []),
      ]);
      const supportMultiplier = Math.max(0.5, 1 - damageSupports.totalBonus);

      const elementResistFn = (element: ElementKey | null): number => {
        const rootResist = computeSpiritualRootTribulationResist(
          primaryElement,
          secondaryElements,
          element,
        );
        const talentResist = talentMods
          ? computePassiveTalentTribulationResist(talentMods, element)
          : 1.0;
        const equipmentResist = computeEquipmentTribulationResist(
          equipmentResistMods,
          element,
        );
        const composed = rootResist * talentResist * equipmentResist;
        // Clamp envelope `[FLOOR, CEIL]` để stack tất cả layer (root + talent +
        // equipment + future buff) không làm resist âm hoặc vượt 1.5×. Worst-case
        // stack: spiritual primary 0.7 × talent 5-stack 0.7738 × equipment 5-stack
        // 0.7738 = 0.4193, clamp về FLOOR=0.6.
        let clamped = composed;
        if (clamped < ELEMENT_MODIFIER_ABSOLUTE_FLOOR) clamped = ELEMENT_MODIFIER_ABSOLUTE_FLOOR;
        if (clamped > ELEMENT_MODIFIER_ABSOLUTE_CEIL) clamped = ELEMENT_MODIFIER_ABSOLUTE_CEIL;
        return clamped * supportMultiplier;
      };

      const sim = simulateTribulation(def, character.hpMax, elementResistFn);

      const taoMaRoll = rng();
      if (!Number.isFinite(taoMaRoll) || taoMaRoll < 0 || taoMaRoll > 1) {
        throw new TribulationError('INVALID_RNG');
      }

      if (sim.success) {
        // === SUCCESS PATH === realm advance + reward grant + clear debuffs.
        const reward = computeTribulationReward(def);
        const newHpMax = Math.round(character.hpMax * 1.2);
        const newMpMax = Math.round(character.mpMax * 1.2);
        const newExp = character.exp - cost + reward.expBonus;

        await tx.character.update({
          where: { id: characterId },
          data: {
            realmKey: next.key,
            realmStage: 1,
            exp: newExp,
            hpMax: newHpMax,
            mpMax: newMpMax,
            hp: newHpMax,
            mp: newMpMax,
            tribulationCooldownAt: null,
            taoMaUntil: null,
          },
        });

        const log = await tx.tribulationAttemptLog.create({
          data: {
            characterId,
            tribulationKey: def.key,
            fromRealmKey: def.fromRealmKey,
            toRealmKey: def.toRealmKey,
            severity: def.severity,
            type: def.type,
            success: true,
            wavesCompleted: sim.wavesCompleted,
            totalDamage: sim.totalDamage,
            finalHp: sim.finalHp,
            hpInitial: character.hpMax,
            expBefore: character.exp,
            expAfter: newExp,
            expLoss: 0n,
            taoMaActive: false,
            taoMaExpiresAt: null,
            cooldownAt: null,
            linhThachReward: reward.linhThach,
            expBonusReward: reward.expBonus,
            titleKeyReward: reward.titleKey,
            attemptIndex,
            taoMaRoll,
          },
        });

        // Currency reward via ledger (atomic trong cùng tx).
        if (reward.linhThach > 0) {
          await this.currency.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.linhThach),
            reason: 'TRIBULATION_REWARD',
            refType: 'TribulationAttemptLog',
            refId: log.id,
          });
        }

        // Phase 14.3.C — consume selected support items (success path) trong
        // cùng tx, sau khi log row đã có id (refId pointer). Nếu consume fail
        // (race) → throw → rollback toàn bộ tx (KHÔNG mất realm advance,
        // currency, log).
        await this.consumeSelectedSupportItemsTx(
          tx,
          characterId,
          selectedKeys,
          log.id,
        );

        // Phase 11.9.C-2 — auto-unlock realm milestone title (atomic trong
        // cùng tx). Idempotent qua `CharacterTitleUnlock` composite UNIQUE.
        // Skip nếu (a) `titles` chưa inject (test/legacy), (b) realm mới
        // không có milestone title trong catalog (vd hoa_than → luyen_hu).
        // KHÔNG fail-soft như `CharacterService.breakthrough()` low-tier:
        // nếu unlock fail trong tx này, rollback toàn bộ (currency + log +
        // realm advance) — atomic guarantee. Ngoại lệ: `TITLE_NOT_FOUND`
        // (catalog drift) chỉ log warn, không rollback (tribulation success
        // KHÔNG nên fail vì cosmetic title catalog drift).
        if (this.titles) {
          const titleDef = titleForRealmMilestone(next.key);
          if (titleDef) {
            try {
              await this.titles.unlockTitleTx(
                tx,
                characterId,
                titleDef.key,
                'realm_milestone',
              );
            } catch (err) {
              const msg = (err as Error).message;
              if (msg === 'TITLE_NOT_FOUND') {
                this.logger.warn(
                  `tribulation: title catalog drift for ${titleDef.key}: ${msg}`,
                );
              } else {
                throw err;
              }
            }
          }
        }

        return {
          success: true,
          tribulationKey: def.key,
          fromRealmKey: def.fromRealmKey,
          toRealmKey: def.toRealmKey,
          severity: def.severity,
          type: def.type,
          wavesCompleted: sim.wavesCompleted,
          totalDamage: sim.totalDamage,
          finalHp: sim.finalHp,
          attemptIndex,
          reward: {
            linhThach: reward.linhThach,
            expBonus: reward.expBonus,
            titleKey: reward.titleKey,
          },
          penalty: null,
          logId: log.id,
          consumedSupportItemKeys: [...selectedKeys],
          supportTotalBonus: composedSupports.totalBonus,
          successChance: successChanceBreakdown,
        };
      }

      // === FAIL PATH === penalty + cooldown + optional Tâm Ma debuff.
      const penalty = computeTribulationFailurePenalty(
        character.exp,
        def,
        now,
        taoMaRoll,
      );
      const expLoss = character.exp - penalty.expAfter;

      await tx.character.update({
        where: { id: characterId },
        data: {
          exp: penalty.expAfter,
          tribulationCooldownAt: penalty.cooldownAt,
          taoMaUntil: penalty.taoMaActive ? penalty.taoMaExpiresAt : null,
          // Knock down (không death — design choice MVP: không xoá nhân vật).
          hp: 1,
        },
      });

      // Phase 11.8.D-2 — atomic apply `debuff_taoma` qua BuffService cùng tx.
      // Per-tier duration từ tribulation catalog (`taoMaDebuffDurationMinutes`)
      // override default buff catalog `durationSec` để tier scaling chính xác
      // (15/30/60/120 phút). Legacy `Character.taoMaUntil` field vẫn được set
      // ở update phía trên cho backward-compat — future migration sẽ migrate
      // tất cả readers sang BuffService rồi gỡ field legacy.
      // Nếu BuffService không inject (constructor 3-arg backward-compat), skip
      // — legacy field vẫn cover.
      if (penalty.taoMaActive && penalty.taoMaExpiresAt && this.buffs) {
        await this.buffs.applyBuffTx(
          tx,
          characterId,
          'debuff_taoma',
          'tribulation',
          now,
          penalty.taoMaExpiresAt,
        );
      }

      const log = await tx.tribulationAttemptLog.create({
        data: {
          characterId,
          tribulationKey: def.key,
          fromRealmKey: def.fromRealmKey,
          toRealmKey: def.toRealmKey,
          severity: def.severity,
          type: def.type,
          success: false,
          wavesCompleted: sim.wavesCompleted,
          totalDamage: sim.totalDamage,
          finalHp: sim.finalHp,
          hpInitial: character.hpMax,
          expBefore: character.exp,
          expAfter: penalty.expAfter,
          expLoss,
          taoMaActive: penalty.taoMaActive,
          taoMaExpiresAt: penalty.taoMaActive ? penalty.taoMaExpiresAt : null,
          cooldownAt: penalty.cooldownAt,
          linhThachReward: 0,
          expBonusReward: 0n,
          titleKeyReward: null,
          attemptIndex,
          taoMaRoll,
        },
      });

      // Phase 14.3.C — consume selected support items (fail path) trong cùng
      // tx, sau khi log row đã có id. Failed attempt VẪN consume — design
      // choice: player phải tính toán trước khi attempt, không thể "lãng
      // phí" 1 lần thử rồi refund. Doc rõ ở `docs/ECONOMY_MODEL.md`.
      await this.consumeSelectedSupportItemsTx(
        tx,
        characterId,
        selectedKeys,
        log.id,
      );

      return {
        success: false,
        tribulationKey: def.key,
        fromRealmKey: def.fromRealmKey,
        toRealmKey: def.toRealmKey,
        severity: def.severity,
        type: def.type,
        wavesCompleted: sim.wavesCompleted,
        totalDamage: sim.totalDamage,
        finalHp: sim.finalHp,
        attemptIndex,
        reward: null,
        penalty: {
          expBefore: character.exp,
          expAfter: penalty.expAfter,
          expLoss,
          cooldownAt: penalty.cooldownAt,
          taoMaActive: penalty.taoMaActive,
          taoMaExpiresAt: penalty.taoMaExpiresAt,
        },
        logId: log.id,
        consumedSupportItemKeys: [...selectedKeys],
        supportTotalBonus: composedSupports.totalBonus,
        successChance: successChanceBreakdown,
      };
    }
  }

  /**
   * Phase 14.3.C — consume danh sách selected support items trong cùng tx
   * với attempt log + character update. Mỗi key consume **1 stack** (không
   * dùng qty multiplier — bonus per-key đã pre-clamp ở
   * {@link composeTribulationSupports}).
   *
   * Race safety: nếu inventory row qty đã = 0 (concurrent consume ở tx khác)
   * → `consumeOneByItemKeyTx` throw `INVENTORY_ITEM_NOT_FOUND`. Helper convert
   * sang `TribulationError('SUPPORT_ITEM_MISSING')` để controller map BAD
   * REQUEST. Tx rollback toàn bộ → KHÔNG mất EXP, KHÔNG cooldown.
   *
   * Inventory absent: nếu `this.inventory` chưa inject (legacy test path)
   * VÀ player chọn ≥ 1 item → throw `INVENTORY_UNAVAILABLE`. Empty selection
   * → no-op.
   *
   * @param tx Prisma transaction client từ `prisma.$transaction`.
   * @param characterId character id.
   * @param selectedKeys keys đã validate (catalog + dedupe + cap).
   * @param logId TribulationAttemptLog.id cho ledger refType+refId pointer.
   */
  private async consumeSelectedSupportItemsTx(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    characterId: string,
    selectedKeys: readonly string[],
    logId: string,
  ): Promise<void> {
    if (selectedKeys.length === 0) return;
    if (!this.inventory) {
      throw new TribulationError('INVENTORY_UNAVAILABLE');
    }
    for (const key of selectedKeys) {
      try {
        await this.inventory.consumeOneByItemKeyTx(tx, characterId, key, {
          reason: 'TRIBULATION_SUPPORT_CONSUME',
          refType: 'TribulationAttemptLog',
          refId: logId,
        });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (
          code === 'INVENTORY_ITEM_NOT_FOUND' ||
          code === 'INSUFFICIENT_QTY'
        ) {
          throw new TribulationError('SUPPORT_ITEM_MISSING');
        }
        throw e;
      }
    }
  }

  /**
   * Phase 14.3.A — Tribulation preview (read-only).
   *
   * Trả về snapshot kiếp sắp tới cho character + ước tính success chance
   * deterministic + reward/penalty hint. KHÔNG mutate state, KHÔNG roll RNG,
   * KHÔNG chạy `simulateTribulation` (giữ runtime simulate exclusive cho
   * `attemptTribulation`).
   *
   * Use case:
   *   - FE TribulationView preview panel: hiển thị "%kiếp" + reward + penalty
   *     trước khi player click "Vượt kiếp".
   *   - FE breakthrough route: nếu `requirement=true`, hiển thị warning
   *     "Realm này yêu cầu kiếp" + redirect button.
   *
   * Shape:
   *   - `requirement: true` khi catalog có `TribulationDef` cho transition.
   *   - `def`: `TribulationDef` snapshot (catalog read).
   *   - `successChance`: deterministic estimate (`computeTribulationSuccessChance`).
   *   - `supports`: composed support list (Phase 14.3.A foundation: empty
   *     mảng — sub-PR sẽ collect từ items/buffs/talents).
   *   - `rewardHint` / `penaltyHint`: BigInt-safe summary cho FE.
   *   - `cooldownAt` / `taoMaUntil`: pass-through từ character row.
   *   - `atPeak`: `realmStage===9 && exp>=cost(9)`.
   *
   * Server-authoritative: caller phải resolve `characterId` từ session
   * userId trước khi gọi. Trả `null` (không throw) nếu transition không
   * có catalog entry — FE render empty state.
   *
   * @param characterId character id (server-trusted).
   * @returns `TribulationPreview` hoặc `null` nếu không có kiếp cho realm
   *   hiện tại (đã đỉnh, transition low-tier, hoặc no nextRealm).
   */
  async previewTribulation(
    characterId: string,
  ): Promise<TribulationPreview | null> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
    });
    if (!character) throw new TribulationError('CHARACTER_NOT_FOUND');

    const next = nextRealm(character.realmKey);
    if (!next) return null;
    const def = getTribulationForBreakthrough(character.realmKey, next.key);
    if (!def) return null;

    const cost = expCostForStage(character.realmKey, 9);
    const atPeak =
      character.realmStage >= 9 && cost !== null && character.exp >= cost;

    const primaryElement: ElementKey | null =
      character.primaryElement &&
      (ELEMENTS as readonly string[]).includes(character.primaryElement)
        ? (character.primaryElement as ElementKey)
        : null;
    const secondaryElements: ElementKey[] = (
      character.secondaryElements ?? []
    ).filter((e): e is ElementKey =>
      (ELEMENTS as readonly string[]).includes(e),
    );

    // Phase 14.3.B — collect support entries từ inventory/buff/equipment/
    // talent. Mỗi service Optional ở constructor nên fallback []` khi inject
    // thiếu (legacy test path / future phase pruning).
    const inventoryRows = this.inventory
      ? await this.inventory.list(characterId)
      : [];
    const itemEntries = collectItemTribulationSupports(inventoryRows);
    const equipmentEntries =
      collectEquipmentTribulationSupports(inventoryRows);

    const activeBuffs = this.buffs ? await this.buffs.listActive(characterId) : [];
    const buffEntries = collectBuffTribulationSupports(activeBuffs);

    const learnedTalents = this.talents
      ? await this.talents.listLearned(characterId)
      : [];
    const waveElements: (ElementKey | null)[] = def.waves.map(
      (w) => w.element,
    );
    const talentEntries = collectTalentTribulationSupports(
      learnedTalents.map((l) => l.talentKey),
      waveElements,
    );

    // KHÔNG mutate state: composeTribulationSupports + collect* helpers đều
    // pure. Inventory/buff fetch đều read-only Prisma findMany.
    const supports = composeTribulationSupports([
      ...itemEntries,
      ...equipmentEntries,
      ...buffEntries,
      ...talentEntries,
    ]);
    const successChance = computeTribulationSuccessChance({
      def,
      primaryElement,
      secondaryElements,
      supports,
    });

    // Phase 14.3.C — build availableSupportItems từ catalog + inventory rows.
    // Mỗi consumable support item key → 1 entry với qty (sum across rows).
    // Equipment supports / buff / talent KHÔNG include — chúng auto active.
    const consumableDefs = listTribulationSupportConsumables();
    const qtyByKey = new Map<string, number>();
    for (const r of inventoryRows) {
      if (r.equippedSlot !== null) continue;
      qtyByKey.set(r.itemKey, (qtyByKey.get(r.itemKey) ?? 0) + r.qty);
    }
    const availableSupportItems = consumableDefs
      .map((d: ItemDef) => ({
        itemKey: d.key,
        label: d.name,
        bonus: d.bonuses?.tribulationSupport ?? 0,
        qty: qtyByKey.get(d.key) ?? 0,
      }))
      .filter((e: { qty: number }) => e.qty > 0);

    return {
      requirement: true,
      fromRealmKey: character.realmKey,
      toRealmKey: next.key,
      atPeak,
      def: {
        key: def.key,
        name: def.name,
        description: def.description,
        type: def.type,
        severity: def.severity,
        wavesCount: def.waves.length,
      },
      successChance,
      supports: supports.entries,
      supportTotalBonus: supports.totalBonus,
      rewardHint: summarizeTribulationRewardHint(def),
      penaltyHint: summarizeTribulationPenaltyHint(def),
      cooldownAt: character.tribulationCooldownAt
        ? character.tribulationCooldownAt.toISOString()
        : null,
      taoMaUntil: character.taoMaUntil
        ? character.taoMaUntil.toISOString()
        : null,
      availableSupportItems,
      maxSelectedSupportItems: TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS,
    };
  }

  /**
   * Phase 14.3.D — get current encounter view (read-only, idempotent).
   *
   * Trả về snapshot encounter sắp tới (hoặc đang pending) cho character:
   *   - `null` nếu không có kiếp cho transition (low-tier hoặc realm cuối).
   *   - `{ pending: TribulationEncounterRowView | null, spec: ... }` nếu có
   *     kiếp.
   *
   * Server-authoritative: caller resolve `characterId` từ session.
   * KHÔNG mutate state — chỉ đọc Character, TribulationEncounter pending,
   * preview supports.
   */
  async getCurrentEncounter(
    characterId: string,
  ): Promise<TribulationEncounterCurrentView | null> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
    });
    if (!character) throw new TribulationError('CHARACTER_NOT_FOUND');

    const next = nextRealm(character.realmKey);
    if (!next) return null;
    const tribDef = getTribulationForBreakthrough(character.realmKey, next.key);
    if (!tribDef) return null;

    const cost = expCostForStage(character.realmKey, 9);
    const atPeak =
      character.realmStage >= 9 && cost !== null && character.exp >= cost;

    const encounterDef = resolveTribulationEncounterDef(tribDef);
    const phaseCount = computeTribulationEncounterPhaseCount(tribDef);
    const requiredPowerHint = computeTribulationEncounterPowerHint(tribDef);

    const primaryElement: ElementKey | null =
      character.primaryElement &&
      (ELEMENTS as readonly string[]).includes(character.primaryElement)
        ? (character.primaryElement as ElementKey)
        : null;
    const advantage = describeTribulationEncounterAdvantage(
      primaryElement,
      encounterDef.element,
    );

    // Reuse preview machinery for supports + success chance breakdown.
    const preview = await this.previewTribulation(characterId);
    const successChance = preview?.successChance ?? null;

    const pending = await this.prisma.tribulationEncounter.findFirst({
      where: { characterId, state: 'pending' },
      orderBy: { startedAt: 'desc' },
    });

    return {
      requirement: true,
      atPeak,
      fromRealmKey: character.realmKey,
      toRealmKey: next.key,
      tribulationKey: tribDef.key,
      severity: tribDef.severity,
      type: tribDef.type,
      encounter: {
        key: encounterDef.key,
        element: encounterDef.element,
        effectType: encounterDef.effectType,
        name: encounterDef.name,
        description: encounterDef.description,
        difficulty: tribDef.severity,
        phaseCount,
        successThreshold: encounterDef.successThreshold,
        requiredPowerHint,
        failPenaltyMultiplier: encounterDef.failPenaltyMultiplier,
        rewardHintMultiplier: encounterDef.rewardHintMultiplier,
        playerHpMax: character.hpMax,
        playerPrimaryElement: primaryElement,
        elementAdvantage: advantage,
      },
      successChance,
      pending: pending ? this.toEncounterRowView(pending) : null,
      cooldownAt: character.tribulationCooldownAt
        ? character.tribulationCooldownAt.toISOString()
        : null,
      taoMaUntil: character.taoMaUntil
        ? character.taoMaUntil.toISOString()
        : null,
    };
  }

  /**
   * Phase 14.3.D — start a tribulation encounter session.
   *
   * Validate peak gate + selection (catalog + dedupe + cap), tạo row
   * `TribulationEncounter{state: 'pending'}` snapshot selection. KHÔNG
   * consume item ở đây (consume diễn ra trong {@link resolveEncounter}).
   *
   * Idempotency:
   *   - Nếu đã có pending row cùng character + cùng `tribulationKey` →
   *     trả về row đó (no new row).
   *   - Nếu đã có pending row khác `tribulationKey` (data drift) → reject
   *     `ENCOUNTER_ALREADY_PENDING`. Caller có thể decide cancel + retry
   *     (future PR).
   *   - Pending row sẽ được resolve (terminal) hoặc cancel (future).
   */
  async startEncounter(
    characterId: string,
    options: TribulationAttemptOptions = {},
    now: Date = new Date(),
  ): Promise<TribulationEncounterRowView> {
    const selectedKeysRaw = options.selectedSupportItemKeys ?? [];
    const validateResult =
      validateTribulationSupportSelection(selectedKeysRaw);
    if (!validateResult.ok) {
      throw new TribulationError(
        mapSupportSelectionErrorToTribulationCode(validateResult.code),
      );
    }
    const selectedKeys: readonly string[] = validateResult.entries.map(
      (e: TribulationSupportEntry) => e.key,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
      });
      if (!character) throw new TribulationError('CHARACTER_NOT_FOUND');

      // Realm gate (mirror `attemptTribulation`).
      if (character.realmStage < 9) throw new TribulationError('NOT_AT_PEAK');
      const cost = expCostForStage(character.realmKey, 9);
      if (cost === null || character.exp < cost) {
        throw new TribulationError('NOT_AT_PEAK');
      }

      const next = nextRealm(character.realmKey);
      if (!next) throw new TribulationError('NO_NEXT_REALM');
      const tribDef = getTribulationForBreakthrough(
        character.realmKey,
        next.key,
      );
      if (!tribDef) throw new TribulationError('NO_TRIBULATION_FOR_TRANSITION');

      // Cooldown gate (set từ FAIL trước đó).
      if (
        character.tribulationCooldownAt &&
        character.tribulationCooldownAt > now
      ) {
        throw new TribulationError('COOLDOWN_ACTIVE');
      }

      // Inventory ownership pre-check (best-effort; resolve recheck inside
      // its own tx — true authoritative consume happens at resolve time).
      for (const key of selectedKeys) {
        const owned = await tx.inventoryItem.findFirst({
          where: { characterId, itemKey: key, equippedSlot: null, qty: { gt: 0 } },
          select: { id: true },
        });
        if (!owned) throw new TribulationError('SUPPORT_ITEM_MISSING');
      }

      const encounterDef = resolveTribulationEncounterDef(tribDef);

      // Idempotent: existing pending for same tribulation → return as-is.
      const existing = await tx.tribulationEncounter.findFirst({
        where: { characterId, state: 'pending' },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) {
        if (existing.tribulationKey !== tribDef.key) {
          throw new TribulationError('ENCOUNTER_ALREADY_PENDING');
        }
        return existing;
      }

      return tx.tribulationEncounter.create({
        data: {
          characterId,
          tribulationKey: tribDef.key,
          fromRealmKey: tribDef.fromRealmKey,
          toRealmKey: tribDef.toRealmKey,
          encounterKey: encounterDef.key,
          effectType: encounterDef.effectType,
          element: encounterDef.element,
          difficulty: tribDef.severity,
          selectedSupportItemKeys: [...selectedKeys],
          state: 'pending',
          startedAt: now,
        },
      });
    });

    return this.toEncounterRowView(created);
  }

  /**
   * Phase 14.3.D — resolve a pending tribulation encounter.
   *
   * Server-authoritative: simulate kiếp + consume selected items + atomic
   * update character/currency/log. State machine pending → resolved.
   *
   * Idempotency:
   *   - Nếu state='resolved' → re-fetch + reconstruct cached outcome từ
   *     `TribulationAttemptLog` row (KHÔNG double breakthrough, KHÔNG
   *     double consume support, KHÔNG double reward).
   *   - Nếu state='pending' → run attempt logic (reuse `runAttemptInTx`),
   *     update encounter row sang 'resolved' + set `resolvedAttemptLogId`.
   *
   * Race safety: multi-call concurrent → 1 call thắng update encounter
   * row trước khi return; lock optimistic via state check inside tx.
   */
  async resolveEncounter(
    characterId: string,
    rng: () => number = Math.random,
    now: Date = new Date(),
  ): Promise<TribulationAttemptOutcome> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const encounter = await tx.tribulationEncounter.findFirst({
        where: { characterId },
        orderBy: { startedAt: 'desc' },
      });
      if (!encounter) throw new TribulationError('NO_PENDING_ENCOUNTER');

      // Idempotent resolved branch: reconstruct outcome từ existing log.
      if (encounter.state === 'resolved') {
        if (!encounter.resolvedAttemptLogId) {
          // Defensive: should never happen vì pending→resolved set pointer.
          throw new TribulationError('NO_PENDING_ENCOUNTER');
        }
        const log = await tx.tribulationAttemptLog.findUnique({
          where: { id: encounter.resolvedAttemptLogId },
        });
        if (!log) throw new TribulationError('NO_PENDING_ENCOUNTER');
        return this.reconstructOutcomeFromLog(log, encounter);
      }

      if (encounter.state !== 'pending') {
        throw new TribulationError('NO_PENDING_ENCOUNTER');
      }

      const selectedKeys: readonly string[] = encounter.selectedSupportItemKeys;
      const result = await this.runAttemptInTx(
        tx,
        characterId,
        selectedKeys,
        rng,
        now,
      );

      // Mark encounter as resolved + pointer to attempt log.
      await tx.tribulationEncounter.update({
        where: { id: encounter.id },
        data: {
          state: 'resolved',
          resolvedAt: now,
          resolvedAttemptLogId: result.logId,
        },
      });

      return result;
    });

    if (outcome.success && this.achievements) {
      try {
        await this.achievements.trackEvent(characterId, 'BREAKTHROUGH', 1);
      } catch (e) {
        this.logger.warn(
          `tribulation: achievement BREAKTHROUGH track failed (encounter) for char=${characterId}: ${(e as Error).message}`,
        );
      }
    }

    return outcome;
  }

  /**
   * Phase 14.3.D — reconstruct outcome shape from a persisted attempt log
   * row (idempotent re-resolve path). KHÔNG re-roll RNG, KHÔNG re-consume
   * item — chỉ project fields → outcome view.
   */
  private reconstructOutcomeFromLog(
    log: {
      tribulationKey: string;
      fromRealmKey: string;
      toRealmKey: string;
      severity: string;
      type: string;
      success: boolean;
      wavesCompleted: number;
      totalDamage: number;
      finalHp: number;
      attemptIndex: number;
      linhThachReward: number;
      expBonusReward: bigint;
      titleKeyReward: string | null;
      expBefore: bigint;
      expAfter: bigint;
      expLoss: bigint;
      cooldownAt: Date | null;
      taoMaActive: boolean;
      taoMaExpiresAt: Date | null;
      id: string;
    },
    encounter: { selectedSupportItemKeys: string[] },
  ): TribulationAttemptOutcome {
    return {
      success: log.success,
      tribulationKey: log.tribulationKey,
      fromRealmKey: log.fromRealmKey,
      toRealmKey: log.toRealmKey,
      severity: log.severity as TribulationDef['severity'],
      type: log.type as TribulationDef['type'],
      wavesCompleted: log.wavesCompleted,
      totalDamage: log.totalDamage,
      finalHp: log.finalHp,
      attemptIndex: log.attemptIndex,
      reward: log.success
        ? {
            linhThach: log.linhThachReward,
            expBonus: log.expBonusReward,
            titleKey: log.titleKeyReward,
          }
        : null,
      penalty: log.success
        ? null
        : {
            expBefore: log.expBefore,
            expAfter: log.expAfter,
            expLoss: log.expLoss,
            cooldownAt: log.cooldownAt ?? new Date(0),
            taoMaActive: log.taoMaActive,
            taoMaExpiresAt: log.taoMaExpiresAt,
          },
      logId: log.id,
      consumedSupportItemKeys: [...encounter.selectedSupportItemKeys],
      // Best-effort 0 (real value persisted via attempt log, not duplicated
      // here); FE can re-fetch breakdown from preview if needed.
      supportTotalBonus: 0,
      successChance: {
        base: 0,
        supportBonus: 0,
        elementAdjustment: 0,
        raw: 0,
        final: 0,
        floorHit: false,
        ceilHit: false,
      },
    };
  }

  /**
   * Phase 14.3.D — project Prisma `TribulationEncounter` row → FE-friendly
   * view. Date cast → ISO string; `selectedSupportItemKeys` cast readonly.
   */
  private toEncounterRowView(row: {
    id: string;
    characterId: string;
    tribulationKey: string;
    fromRealmKey: string;
    toRealmKey: string;
    encounterKey: string;
    effectType: string;
    element: string;
    difficulty: string;
    selectedSupportItemKeys: string[];
    state: string;
    startedAt: Date;
    resolvedAt: Date | null;
    resolvedAttemptLogId: string | null;
  }): TribulationEncounterRowView {
    return {
      id: row.id,
      tribulationKey: row.tribulationKey,
      fromRealmKey: row.fromRealmKey,
      toRealmKey: row.toRealmKey,
      encounterKey: row.encounterKey,
      effectType: row.effectType,
      element: row.element,
      difficulty: row.difficulty,
      selectedSupportItemKeys: [...row.selectedSupportItemKeys],
      state: row.state,
      startedAt: row.startedAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      resolvedAttemptLogId: row.resolvedAttemptLogId,
    };
  }

  /**
   * Phase 11.6.F — list recent tribulation attempt logs cho 1 character.
   *
   * Trả về tối đa `limit` row gần nhất (sort theo `createdAt` DESC). Idempotent
   * GET — không thay đổi state. Server-authoritative: caller phải resolve
   * `characterId` từ session userId trước khi gọi.
   *
   * @param characterId character id (server-trusted).
   * @param limit số row tối đa (1..MAX_LIMIT). Default 20.
   * @returns array `TribulationAttemptLogView` với BigInt fields cast → string
   *   để FE serialize an toàn (ko mất precision).
   */
  async listAttemptLogs(
    characterId: string,
    limit: number = TRIBULATION_LOG_DEFAULT_LIMIT,
  ): Promise<TribulationAttemptLogView[]> {
    const safeLimit = Math.max(
      1,
      Math.min(TRIBULATION_LOG_MAX_LIMIT, Math.floor(limit)),
    );
    const rows = await this.prisma.tribulationAttemptLog.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows.map((r) => ({
      id: r.id,
      tribulationKey: r.tribulationKey,
      fromRealmKey: r.fromRealmKey,
      toRealmKey: r.toRealmKey,
      severity: r.severity,
      type: r.type,
      success: r.success,
      wavesCompleted: r.wavesCompleted,
      totalDamage: r.totalDamage,
      finalHp: r.finalHp,
      hpInitial: r.hpInitial,
      expBefore: r.expBefore.toString(),
      expAfter: r.expAfter.toString(),
      expLoss: r.expLoss.toString(),
      taoMaActive: r.taoMaActive,
      taoMaExpiresAt: r.taoMaExpiresAt ? r.taoMaExpiresAt.toISOString() : null,
      cooldownAt: r.cooldownAt ? r.cooldownAt.toISOString() : null,
      linhThachReward: r.linhThachReward,
      expBonusReward: r.expBonusReward.toString(),
      titleKeyReward: r.titleKeyReward,
      attemptIndex: r.attemptIndex,
      taoMaRoll: r.taoMaRoll,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

/**
 * Phase 11.6.F — pagination defaults cho `listAttemptLogs`.
 * MAX cap để tránh DOS qua `?limit=999999`.
 */
export const TRIBULATION_LOG_DEFAULT_LIMIT = 20;
export const TRIBULATION_LOG_MAX_LIMIT = 100;

/**
 * Phase 11.6.F — view-friendly shape của `TribulationAttemptLog`.
 * BigInt fields cast → string (giữ precision khi qua JSON), DateTime cast
 * → ISO string. Mirror `TribulationOutcomeView` nhưng giữ snapshot fields.
 */
export interface TribulationAttemptLogView {
  id: string;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  severity: string;
  type: string;
  success: boolean;
  wavesCompleted: number;
  totalDamage: number;
  finalHp: number;
  hpInitial: number;
  expBefore: string;
  expAfter: string;
  expLoss: string;
  taoMaActive: boolean;
  taoMaExpiresAt: string | null;
  cooldownAt: string | null;
  linhThachReward: number;
  expBonusReward: string;
  titleKeyReward: string | null;
  attemptIndex: number;
  taoMaRoll: number;
  createdAt: string;
}

/**
 * Phase 14.3.A — Tribulation preview shape (read-only).
 *
 * Mirror server preview struct cho FE. BigInt cast → string trong
 * `rewardHint.expBonus`. Date cast → ISO string trong `cooldownAt`/
 * `taoMaUntil`. `def` chỉ expose subset (`key/name/description/type/
 * severity/wavesCount`) — không expose full `waves[]` để giảm payload
 * (FE tooltip chỉ cần count).
 */
export interface TribulationPreview {
  /** `true` khi catalog có `TribulationDef` cho transition hiện tại. */
  requirement: true;
  /** Realm hiện tại của character (peak gate vẫn check riêng). */
  fromRealmKey: string;
  /** Realm sau khi vượt kiếp thành công (`nextRealm(from).key`). */
  toRealmKey: string;
  /** `realmStage===9 && exp>=cost(stage=9)` — eligible attempt. */
  atPeak: boolean;
  /** Subset def cho FE — không expose toàn bộ waves[]. */
  def: {
    key: string;
    name: string;
    description: string;
    type: TribulationDef['type'];
    severity: TribulationDef['severity'];
    wavesCount: number;
  };
  /** Deterministic estimate (KHÔNG roll RNG). */
  successChance: TribulationSuccessChanceBreakdown;
  /** Composed list — Phase 14.3.A foundation: empty. */
  supports: readonly TribulationSupportEntry[];
  /** Pass-through `composeTribulationSupports.totalBonus`. */
  supportTotalBonus: number;
  /** BigInt-safe reward summary. */
  rewardHint: TribulationRewardHint;
  /** Penalty summary 1:1 từ `TribulationDef`. */
  penaltyHint: TribulationPenaltyHint;
  /** ISO string nếu còn cooldown active; null nếu đã hết hoặc chưa có. */
  cooldownAt: string | null;
  /** ISO string nếu còn Tâm Ma debuff active; null nếu hết hoặc chưa có. */
  taoMaUntil: string | null;
  /**
   * Phase 14.3.C — danh sách consumable support items player có thể chọn để
   * consume khi attempt. Mỗi entry: `{itemKey, label, bonus, qty}`. FE render
   * checkbox/select UI từ list này. KHÔNG include equipment / buff / talent
   * supports — chúng passive auto-active. Cap UX: max
   * {@link TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS} = 3 selected/attempt.
   */
  availableSupportItems: ReadonlyArray<{
    itemKey: string;
    label: string;
    bonus: number;
    qty: number;
  }>;
  /**
   * Phase 14.3.C — cap số selected items tối đa cho 1 attempt (server
   * authoritative). FE đọc để clamp checkbox count.
   */
  maxSelectedSupportItems: number;
}

/**
 * Phase 14.3.D — view of a `TribulationEncounter` row (FE-friendly).
 * Date cast → ISO string, `selectedSupportItemKeys` readonly snapshot.
 */
export interface TribulationEncounterRowView {
  id: string;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  encounterKey: string;
  effectType: string;
  element: string;
  difficulty: string;
  selectedSupportItemKeys: readonly string[];
  /** 'pending' | 'resolved'. */
  state: string;
  startedAt: string;
  resolvedAt: string | null;
  resolvedAttemptLogId: string | null;
}

/**
 * Phase 14.3.D — encounter spec snapshot (server-authoritative). Mirror
 * shared `TribulationEncounterDef` + per-character context (HP, primary
 * element advantage, phase count, required power hint).
 */
export interface TribulationEncounterSpec {
  /** `tribulation_encounter_<element>` key. */
  key: string;
  /** ElementKey ∈ {kim, moc, thuy, hoa, tho}. */
  element: TribulationEncounterDef['element'];
  /** `BURST | SUSTAIN | POISON_RECOVERY | ARMOR_CRIT | DEFENSE_ENDURANCE`. */
  effectType: TribulationEncounterDef['effectType'];
  /** Tên hiển thị (Vietnamese). */
  name: string;
  /** Lore description. */
  description: string;
  /** Severity alias. */
  difficulty: TribulationDef['severity'];
  phaseCount: number;
  successThreshold: number;
  requiredPowerHint: number;
  failPenaltyMultiplier: number;
  rewardHintMultiplier: number;
  playerHpMax: number;
  playerPrimaryElement: TribulationEncounterDef['element'] | null;
  /** Number ∈ {-2, -1, 0, +1, +2} — element advantage relative to encounter. */
  elementAdvantage: number;
}

/**
 * Phase 14.3.D — current encounter view (read-only).
 * `pending` is null if no in-progress session; otherwise pinned snapshot.
 */
export interface TribulationEncounterCurrentView {
  requirement: true;
  atPeak: boolean;
  fromRealmKey: string;
  toRealmKey: string;
  tribulationKey: string;
  severity: TribulationDef['severity'];
  type: TribulationDef['type'];
  encounter: TribulationEncounterSpec;
  successChance: TribulationSuccessChanceBreakdown | null;
  pending: TribulationEncounterRowView | null;
  cooldownAt: string | null;
  taoMaUntil: string | null;
}

export interface TribulationAttemptOutcome {
  success: boolean;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  severity: TribulationDef['severity'];
  type: TribulationDef['type'];
  wavesCompleted: number;
  totalDamage: number;
  finalHp: number;
  attemptIndex: number;
  reward: {
    linhThach: number;
    expBonus: bigint;
    titleKey: string | null;
  } | null;
  penalty: {
    expBefore: bigint;
    expAfter: bigint;
    expLoss: bigint;
    cooldownAt: Date;
    taoMaActive: boolean;
    taoMaExpiresAt: Date | null;
  } | null;
  logId: string;
  /**
   * Phase 14.3.C — danh sách itemKey đã consume (1 stack/key) trong attempt.
   * Empty array nếu player attempt không chọn item. FE render "đã dùng X
   * vật phẩm" sau response.
   */
  consumedSupportItemKeys: readonly string[];
  /**
   * Phase 14.3.C — total bonus support đã dùng (đã clamp per-entry + total
   * server-side). FE so sánh với predicted bonus tính local trước attempt.
   */
  supportTotalBonus: number;
  /**
   * Phase 14.3.C — server-side breakdown success chance (parity với preview).
   * Persist cho FE audit + future replay.
   */
  successChance: TribulationSuccessChanceBreakdown;
}

/**
 * Phase 11.6.B view — HTTP-safe shape của `TribulationAttemptOutcome`.
 * BigInt fields (`reward.expBonus`, `penalty.expBefore/After/Loss`) cast →
 * string để Express JSON serialize không throw `Do not know how to serialize
 * a BigInt`. Date fields cast → ISO string. Mirror pattern của
 * `TribulationAttemptLogView` (Phase 11.6.F).
 *
 * Bug context: trước khi có view này, `CharacterController.tribulationAttempt`
 * trả raw outcome → mọi attempt thành công HOẶC thất bại đều 500 ở HTTP level
 * (BigInt serialize). Vitest service-level test KHÔNG catch vì JSON.stringify
 * chỉ chạy ở Express response path. Smoke `pnpm smoke:tribulation` positive
 * path expose bug.
 */
export interface TribulationAttemptOutcomeView {
  success: boolean;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  severity: TribulationDef['severity'];
  type: TribulationDef['type'];
  wavesCompleted: number;
  totalDamage: number;
  finalHp: number;
  attemptIndex: number;
  reward: {
    linhThach: number;
    expBonus: string;
    titleKey: string | null;
  } | null;
  penalty: {
    expBefore: string;
    expAfter: string;
    expLoss: string;
    cooldownAt: string;
    taoMaActive: boolean;
    taoMaExpiresAt: string | null;
  } | null;
  logId: string;
  /** Phase 14.3.C — items consumed during attempt. */
  consumedSupportItems: ReadonlyArray<{
    itemKey: string;
    label: string;
    bonus: number;
  }>;
  /** Phase 14.3.C — total bonus (after clamp) applied to attempt. */
  supportTotalBonus: number;
  /** Phase 14.3.C — server-side success-chance breakdown for audit/UX. */
  successChance: TribulationSuccessChanceBreakdown;
}

/**
 * Phase 11.6.B view mapper — cast BigInt + Date → string cho HTTP JSON.
 *
 * @param outcome `TribulationAttemptOutcome` từ `attemptTribulation()`.
 * @returns `TribulationAttemptOutcomeView` HTTP-safe.
 */
export function toAttemptOutcomeView(
  outcome: TribulationAttemptOutcome,
): TribulationAttemptOutcomeView {
  return {
    success: outcome.success,
    tribulationKey: outcome.tribulationKey,
    fromRealmKey: outcome.fromRealmKey,
    toRealmKey: outcome.toRealmKey,
    severity: outcome.severity,
    type: outcome.type,
    wavesCompleted: outcome.wavesCompleted,
    totalDamage: outcome.totalDamage,
    finalHp: outcome.finalHp,
    attemptIndex: outcome.attemptIndex,
    reward: outcome.reward
      ? {
          linhThach: outcome.reward.linhThach,
          expBonus: outcome.reward.expBonus.toString(),
          titleKey: outcome.reward.titleKey,
        }
      : null,
    penalty: outcome.penalty
      ? {
          expBefore: outcome.penalty.expBefore.toString(),
          expAfter: outcome.penalty.expAfter.toString(),
          expLoss: outcome.penalty.expLoss.toString(),
          cooldownAt: outcome.penalty.cooldownAt.toISOString(),
          taoMaActive: outcome.penalty.taoMaActive,
          taoMaExpiresAt: outcome.penalty.taoMaExpiresAt
            ? outcome.penalty.taoMaExpiresAt.toISOString()
            : null,
        }
      : null,
    logId: outcome.logId,
    consumedSupportItems: outcome.consumedSupportItemKeys.map((k) => {
      const def: ItemDef | undefined = itemByKey(k);
      return {
        itemKey: k,
        label: def?.name ?? k,
        bonus: def?.bonuses?.tribulationSupport ?? 0,
      };
    }),
    supportTotalBonus: outcome.supportTotalBonus,
    successChance: outcome.successChance,
  };
}

export class TribulationError extends Error {
  constructor(
    public code:
      | 'CHARACTER_NOT_FOUND'
      | 'NOT_AT_PEAK'
      | 'NO_NEXT_REALM'
      | 'NO_TRIBULATION_FOR_TRANSITION'
      | 'COOLDOWN_ACTIVE'
      | 'INVALID_RNG'
      // Phase 14.3.C — selection validation errors.
      | 'INVALID_SUPPORT_SELECTION'
      | 'TOO_MANY_SUPPORT_ITEMS'
      | 'DUPLICATE_SUPPORT_ITEM'
      | 'INVALID_SUPPORT_ITEM'
      | 'SUPPORT_ITEM_MISSING'
      | 'INVENTORY_UNAVAILABLE'
      // Phase 14.3.D — encounter system errors.
      | 'NO_PENDING_ENCOUNTER'
      | 'ENCOUNTER_ALREADY_PENDING',
  ) {
    super(code);
  }
}

/**
 * Phase 14.3.C — map shared `TribulationSupportSelectionError` →
 * {@link TribulationError} code. Used khi pure validator reject input để
 * service throw consistent error class (controller layer chỉ catch 1 class).
 */
export function mapSupportSelectionErrorToTribulationCode(
  code: TribulationSupportSelectionError,
):
  | 'INVALID_SUPPORT_SELECTION'
  | 'TOO_MANY_SUPPORT_ITEMS'
  | 'DUPLICATE_SUPPORT_ITEM'
  | 'INVALID_SUPPORT_ITEM' {
  switch (code) {
    case 'INVALID_INPUT':
      return 'INVALID_SUPPORT_SELECTION';
    case 'TOO_MANY_SELECTED':
      return 'TOO_MANY_SUPPORT_ITEMS';
    case 'DUPLICATE_SELECTED':
      return 'DUPLICATE_SUPPORT_ITEM';
    case 'INVALID_SUPPORT_ITEM':
      return 'INVALID_SUPPORT_ITEM';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/**
 * Phase 14.3.C — options arg cho {@link TribulationService.attemptTribulation}.
 *
 * - `selectedSupportItemKeys`: list catalog itemKey player chọn để consume khi
 *   attempt. Mỗi key validate qua {@link validateTribulationSupportSelection}
 *   (≤ {@link TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS}, no duplicate, valid
 *   catalog support consumable). Empty/undefined = no item consumed.
 */
export interface TribulationAttemptOptions {
  selectedSupportItemKeys?: readonly string[];
}
