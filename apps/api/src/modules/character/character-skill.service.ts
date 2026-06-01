import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  SKILL_TEMPLATES,
  SKILLS,
  applyMasteryEffect,
  getSkillTemplate,
  getSkillTierDef,
  itemByKey,
  realmByKey,
  sectNameToKey,
  skillByKey,
  type EffectiveSkill,
  type SkillDef,
  type SkillTemplate,
  type SkillUnlockRequirement,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';

/**
 * Phase 11.2.B — Skill mastery server-authoritative service.
 *
 * Trách nhiệm:
 *   - `learn(characterId, skillKey, source)` — học skill. Validate
 *     `SkillTemplate.unlocks` AND-condition (realm/sect/method).
 *     Idempotent qua `@@unique([characterId, skillKey])` (P2002 → return
 *     existing).
 *   - `upgradeMastery(characterId, skillKey)` — increment masteryLevel +1
 *     (clamp tới `tier.maxMastery`). Trừ LinhThach qua CurrencyService
 *     (atomic). Skill shard cost ghi vào response cho tương lai 11.2.C
 *     wire `ItemLedger`.
 *   - `equip(characterId, skillKey)` — bật `isEquipped = true`. Cap
 *     `MAX_EQUIPPED_SKILLS = 4` (basic_attack tự coi như slot riêng — luôn
 *     usable không cần equip). Throw `TOO_MANY_EQUIPPED` nếu đầy.
 *   - `unequip(characterId, skillKey)` — bật false.
 *   - `getState(characterId)` — list skill đã học + view effective skill
 *     (atkScale/mpCost sau mastery), tier/level/maxLevel.
 *   - `grantStarterIfMissing(characterId)` — auto-grant + auto-equip
 *     `basic_attack` cho character mới hoặc legacy. Idempotent.
 *   - `getEffectiveSkillFor(characterId, skillKey, baseSkill)` — pure helper
 *     cho `CombatService.action()` compose `applyMasteryEffect`. Legacy
 *     character (no row) → masteryLevel = 0 → no bonus.
 *   - **Phase 11.2.D** `learnFromBook(characterId, inventoryItemId)` —
 *     consume 1× `kind: 'SKILL_BOOK'` qua `ItemLedger` reason `SKILL_LEARN`,
 *     atomic với `learn(skillKey, 'item_consume')`. Validate ownership +
 *     `def.skillBook.skillKey` + unlocks. Throws `INVENTORY_ITEM_NOT_FOUND`
 *     /`NOT_SKILL_BOOK`/`ALREADY_LEARNED` ngoài errors hiện có.
 *
 * KHÔNG implement:
 *   - Evolution branch resolve (deferred — `evolveSkill`).
 *   - Skill cooldown tracking ngoài encounter (deferred future).
 *   - Skill book drop integration vào boss/dungeon reward pool (deferred
 *     Phase 11.2.D++).
 */
@Injectable()
export class CharacterSkillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  /**
   * Học skill mới. Validate unlocks AND-condition. Idempotent via
   * `@@unique([characterId, skillKey])`.
   */
  async learn(
    characterId: string,
    skillKey: string,
    source: string,
  ): Promise<CharacterSkillStateOut> {
    const template = getSkillTemplate(skillKey);
    if (!template) throw new CharacterSkillError('SKILL_NOT_FOUND');
    const baseSkill = skillByKey(skillKey);
    if (!baseSkill) throw new CharacterSkillError('SKILL_NOT_FOUND');

    const c = await this.loadCharForValidation(characterId);
    await this.validateUnlocks(characterId, c, template);

    try {
      await this.prisma.characterSkill.create({
        data: {
          characterId,
          skillKey,
          masteryLevel: 1,
          isEquipped: false,
          source,
        },
      });
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== 'P2002'
      ) {
        throw e;
      }
    }

    return this.getState(characterId);
  }

  /**
   * Phase 11.2.D — consume 1× `kind: 'SKILL_BOOK'` để học skill được khai
   * báo trong `ItemDef.skillBook.skillKey`. Atomic transaction:
   *
   *  1. Validate inventory row (ownership characterId, qty ≥ 1, kind =
   *     'SKILL_BOOK', `def.skillBook?.skillKey` resolved).
   *  2. Resolve `SkillTemplate` + validate `unlocks` (realm/sect/method)
   *     — fail trước khi consume item.
   *  3. Pre-check `CharacterSkill` đã tồn tại → throw `ALREADY_LEARNED`
   *     (KHÔNG consume item).
   *  4. Trong tx: insert `CharacterSkill { masteryLevel: 1, isEquipped:
   *     false, source: 'item_consume' }` (catch P2002 → ALREADY_LEARNED
   *     race-safe re-throw); decrement qty (delete row khi qty=1, else
   *     qty--); ghi `ItemLedger` qtyDelta=-1 reason='SKILL_LEARN' với
   *     refType='InventoryItem' refId=row.id + meta.skillKey.
   *
   * Server-authoritative: tất cả validation + state mutation chạy ở server,
   * UI chỉ truyền `inventoryItemId`. Idempotent qua P2002 catch — race
   * window giữa pre-check (3) và create (4) sẽ throw ALREADY_LEARNED và
   * roll back consume.
   */
  async learnFromBook(
    characterId: string,
    inventoryItemId: string,
  ): Promise<CharacterSkillLearnFromBookOut> {
    if (!inventoryItemId) {
      throw new CharacterSkillError('INVENTORY_ITEM_NOT_FOUND');
    }
    const inv = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!inv || inv.characterId !== characterId || inv.qty < 1) {
      throw new CharacterSkillError('INVENTORY_ITEM_NOT_FOUND');
    }

    const def = itemByKey(inv.itemKey);
    if (!def || def.kind !== 'SKILL_BOOK' || !def.skillBook?.skillKey) {
      throw new CharacterSkillError('NOT_SKILL_BOOK');
    }
    const skillKey = def.skillBook.skillKey;
    const template = getSkillTemplate(skillKey);
    if (!template) throw new CharacterSkillError('SKILL_NOT_FOUND');
    if (!skillByKey(skillKey)) throw new CharacterSkillError('SKILL_NOT_FOUND');

    const c = await this.loadCharForValidation(characterId);
    await this.validateUnlocks(characterId, c, template);

    // Pre-check ALREADY_LEARNED — UX (không consume item nếu đã học rồi).
    const existed = await this.prisma.characterSkill.findUnique({
      where: { characterId_skillKey: { characterId, skillKey } },
    });
    if (existed) throw new CharacterSkillError('ALREADY_LEARNED');

    await this.prisma.$transaction(async (tx) => {
      // Re-fetch row in tx để chống race với consumer khác.
      const cur = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
      });
      if (!cur || cur.characterId !== characterId || cur.qty < 1) {
        throw new CharacterSkillError('INVENTORY_ITEM_NOT_FOUND');
      }
      try {
        await tx.characterSkill.create({
          data: {
            characterId,
            skillKey,
            masteryLevel: 1,
            isEquipped: false,
            source: 'item_consume',
          },
        });
      } catch (e) {
        // P2002 = unique violation (đã học, race với grant khác). Không
        // consume item, throw ALREADY_LEARNED để client retry safe.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new CharacterSkillError('ALREADY_LEARNED');
        }
        throw e;
      }
      if (cur.qty === 1) {
        await tx.inventoryItem.delete({ where: { id: cur.id } });
      } else {
        await tx.inventoryItem.update({
          where: { id: cur.id },
          data: { qty: cur.qty - 1 },
        });
      }
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: cur.itemKey,
          qtyDelta: -1,
          reason: 'SKILL_LEARN',
          refType: 'InventoryItem',
          refId: cur.id,
          meta: { skillKey },
        },
      });
    });

    const state = await this.getState(characterId);
    return { skillKey, consumedItemKey: def.key, state };
  }

  /**
   * Increment masteryLevel +1, deduct LinhThach cost của level mới (theo
   * `template.masteryLevels[newLevel - 1].linhThachCost`). Atomic — trong
   * 1 transaction: đọc current row → check max → trừ tiền → bump level.
   */
  async upgradeMastery(
    characterId: string,
    skillKey: string,
  ): Promise<CharacterSkillUpgradeOut> {
    const template = getSkillTemplate(skillKey);
    if (!template) throw new CharacterSkillError('SKILL_NOT_FOUND');
    const tierDef = getSkillTierDef(template.tier);

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterSkill.findUnique({
        where: { characterId_skillKey: { characterId, skillKey } },
      });
      if (!row) throw new CharacterSkillError('NOT_LEARNED');

      const newLevel = row.masteryLevel + 1;
      if (newLevel > tierDef.maxMastery) {
        throw new CharacterSkillError('MASTERY_MAX');
      }

      const lvDef = template.masteryLevels[newLevel - 1];
      if (!lvDef) {
        throw new CharacterSkillError('MASTERY_MAX');
      }

      // Deduct LinhThach atomic (CurrencyService throws INSUFFICIENT_FUNDS
      // nếu không đủ — chuyển đổi sang CharacterSkillError để controller
      // map HTTP).
      if (lvDef.linhThachCost > 0) {
        try {
          await this.currency.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(-lvDef.linhThachCost),
            reason: 'SKILL_UPGRADE',
            refType: 'CharacterSkill',
            refId: row.id,
            meta: {
              skillKey,
              fromLevel: row.masteryLevel,
              toLevel: newLevel,
              tier: template.tier,
            },
          });
        } catch (e) {
          if ((e as { code?: string })?.code === 'INSUFFICIENT_FUNDS') {
            throw new CharacterSkillError('INSUFFICIENT_FUNDS');
          }
          throw e;
        }
      }

      await tx.characterSkill.update({
        where: { characterId_skillKey: { characterId, skillKey } },
        data: { masteryLevel: newLevel },
      });

      return {
        skillKey,
        previousLevel: row.masteryLevel,
        newLevel,
        linhThachSpent: lvDef.linhThachCost,
        shardSpent: 0, // deferred 11.2.C — wire ItemLedger consume
        shardRequired: lvDef.shardCost,
      };
    });
  }

  /**
   * Equip skill (set `isEquipped=true`). Cap số skill đang equip
   * (`MAX_EQUIPPED_SKILLS`). basic_attack không tính slot.
   */
  async equip(
    characterId: string,
    skillKey: string,
  ): Promise<CharacterSkillStateOut> {
    if (skillKey === 'basic_attack') {
      // basic_attack luôn usable, không cần slot — coi như no-op success.
      return this.getState(characterId);
    }
    const row = await this.prisma.characterSkill.findUnique({
      where: { characterId_skillKey: { characterId, skillKey } },
    });
    if (!row) throw new CharacterSkillError('NOT_LEARNED');
    if (row.isEquipped) {
      // Idempotent — đã equip rồi, no-op.
      return this.getState(characterId);
    }

    const equippedCount = await this.prisma.characterSkill.count({
      where: {
        characterId,
        isEquipped: true,
        NOT: { skillKey: 'basic_attack' },
      },
    });
    if (equippedCount >= MAX_EQUIPPED_SKILLS) {
      throw new CharacterSkillError('TOO_MANY_EQUIPPED');
    }

    await this.prisma.characterSkill.update({
      where: { characterId_skillKey: { characterId, skillKey } },
      data: { isEquipped: true },
    });
    return this.getState(characterId);
  }

  /** Unequip skill (set `isEquipped=false`). Idempotent. */
  async unequip(
    characterId: string,
    skillKey: string,
  ): Promise<CharacterSkillStateOut> {
    const row = await this.prisma.characterSkill.findUnique({
      where: { characterId_skillKey: { characterId, skillKey } },
    });
    if (!row) throw new CharacterSkillError('NOT_LEARNED');
    if (!row.isEquipped) return this.getState(characterId);
    await this.prisma.characterSkill.update({
      where: { characterId_skillKey: { characterId, skillKey } },
      data: { isEquipped: false },
    });
    return this.getState(characterId);
  }

  /**
   * Đọc trạng thái — list skill đã học + view effective skill cho UI/debug.
   * Auto-grant `basic_attack` cho legacy character (idempotent).
   */
  async getState(characterId: string): Promise<CharacterSkillStateOut> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
    });
    if (!c) throw new CharacterSkillError('CHARACTER_NOT_FOUND');

    const rows = await this.prisma.characterSkill.findMany({
      where: { characterId },
      orderBy: { learnedAt: 'asc' },
    });

    if (rows.length === 0) {
      // Lazy migration cho legacy character — auto-grant basic_attack.
      await this.grantStarterIfMissing(characterId);
      return this.getState(characterId);
    }

    return {
      maxEquipped: MAX_EQUIPPED_SKILLS,
      learned: rows.map((row) => buildSkillView(row)),
    };
  }

  /**
   * Idempotent — auto-grant + auto-equip `basic_attack`. Gọi từ
   * `CharacterService.onboard` sau khi tạo character. Re-call an toàn
   * (no-op nếu đã có).
   */
  async grantStarterIfMissing(characterId: string): Promise<void> {
    const existing = await this.prisma.characterSkill.findUnique({
      where: {
        characterId_skillKey: { characterId, skillKey: STARTER_SKILL_KEY },
      },
    });
    if (existing) {
      // Đã có row — đảm bảo isEquipped true.
      if (!existing.isEquipped) {
        await this.prisma.characterSkill.update({
          where: {
            characterId_skillKey: { characterId, skillKey: STARTER_SKILL_KEY },
          },
          data: { isEquipped: true },
        });
      }
      return;
    }
    await this.prisma.characterSkill.create({
      data: {
        characterId,
        skillKey: STARTER_SKILL_KEY,
        masteryLevel: 1,
        isEquipped: true,
        source: 'starter',
      },
    });
  }

  /**
   * Check xem character đã học skillKey chưa. `basic_attack` luôn trả true
   * (auto-granted starter). Dùng cho combat/boss validation.
   */
  async isLearned(
    characterId: string,
    skillKey: string,
  ): Promise<boolean> {
    // basic_attack always usable (auto-granted onboarding).
    if (skillKey === 'basic_attack') return true;
    const row = await this.prisma.characterSkill.findUnique({
      where: {
        characterId_skillKey: { characterId, skillKey },
      },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * Pure helper cho CombatService — compose effective skill từ character's
   * mastery row. Legacy character (no row) → masteryLevel = 0 → no bonus.
   * Skill không có template → fallback base.
   */
  async getEffectiveSkillFor(
    characterId: string,
    baseSkill: SkillDef,
  ): Promise<EffectiveSkill> {
    const template = getSkillTemplate(baseSkill.key);
    if (!template) {
      return baselineEffective(baseSkill);
    }
    const row = await this.prisma.characterSkill.findUnique({
      where: {
        characterId_skillKey: { characterId, skillKey: baseSkill.key },
      },
    });
    const masteryLevel = row?.masteryLevel ?? 0;
    return applyMasteryEffect(template, masteryLevel, baseSkill);
  }

  // ---------- private ----------

  private async loadCharForValidation(characterId: string): Promise<{
    realmKey: string;
    sectName: string | null;
    equippedCultivationMethodKey: string | null;
  }> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: { sect: true },
    });
    if (!c) throw new CharacterSkillError('CHARACTER_NOT_FOUND');
    return {
      realmKey: c.realmKey,
      sectName: c.sect?.name ?? null,
      equippedCultivationMethodKey: c.equippedCultivationMethodKey,
    };
  }

  /**
   * AND-condition: tất cả requirement phải thoả. Loại requirement:
   *   - realm: character.realmKey order >= ref order
   *   - sect: SECT_NAME_TO_KEY[character.sect.name] === ref
   *   - method: character đã học method `ref` (CharacterCultivationMethod
   *     row tồn tại) hoặc đang equip
   *   - item: deferred 11.2.C (skip silently — baseline catalog không dùng)
   *   - quest: deferred (skip silently — không enforce)
   *   - event: deferred (skip silently)
   */
  private async validateUnlocks(
    characterId: string,
    c: {
      realmKey: string;
      sectName: string | null;
      equippedCultivationMethodKey: string | null;
    },
    template: SkillTemplate,
  ): Promise<void> {
    for (const req of template.unlocks) {
      await this.validateOneUnlock(characterId, c, req);
    }
  }

  private async validateOneUnlock(
    characterId: string,
    c: {
      realmKey: string;
      sectName: string | null;
      equippedCultivationMethodKey: string | null;
    },
    req: SkillUnlockRequirement,
  ): Promise<void> {
    switch (req.kind) {
      case 'realm': {
        const charRealm = realmByKey(c.realmKey);
        const reqRealm = realmByKey(req.ref);
        if (!charRealm || !reqRealm) {
          throw new CharacterSkillError('REALM_NOT_FOUND');
        }
        if (charRealm.order < reqRealm.order) {
          throw new CharacterSkillError('REALM_TOO_LOW');
        }
        return;
      }
      case 'sect': {
        const charSectKey = c.sectName ? sectNameToKey(c.sectName) : null;
        if (charSectKey !== req.ref) {
          throw new CharacterSkillError('WRONG_SECT');
        }
        return;
      }
      case 'method': {
        const owned = await this.prisma.characterCultivationMethod.findUnique({
          where: {
            characterId_methodKey: { characterId, methodKey: req.ref },
          },
        });
        if (!owned) {
          throw new CharacterSkillError('METHOD_NOT_LEARNED');
        }
        return;
      }
      case 'item':
      case 'quest':
      case 'event':
        // Deferred: 11.2.C wire ItemLedger / mission system. MVP skip để
        // skill catalog future-extensible không break learn flow.
        return;
    }
  }
}

// =====================================================================
// Helpers + types
// =====================================================================

const MAX_EQUIPPED_SKILLS = 4;
const STARTER_SKILL_KEY = 'basic_attack';

// sectNameToKey now imported from @xuantoi/shared (combat.ts).

function buildSkillView(row: {
  skillKey: string;
  masteryLevel: number;
  isEquipped: boolean;
  source: string;
  learnedAt: Date;
}): CharacterSkillView {
  const template = getSkillTemplate(row.skillKey);
  const baseSkill = skillByKey(row.skillKey);
  if (!template || !baseSkill) {
    return {
      skillKey: row.skillKey,
      tier: 'basic',
      masteryLevel: row.masteryLevel,
      maxMastery: row.masteryLevel,
      isEquipped: row.isEquipped,
      source: row.source,
      learnedAt: row.learnedAt.toISOString(),
      effective: null,
      nextLevelLinhThachCost: null,
      nextLevelShardCost: null,
    };
  }
  const tierDef = getSkillTierDef(template.tier);
  const effective = applyMasteryEffect(
    template,
    row.masteryLevel,
    baseSkill,
  );
  const nextLevel = row.masteryLevel + 1;
  const nextLvDef =
    nextLevel <= tierDef.maxMastery
      ? template.masteryLevels[nextLevel - 1]
      : null;
  return {
    skillKey: row.skillKey,
    tier: template.tier,
    masteryLevel: row.masteryLevel,
    maxMastery: tierDef.maxMastery,
    isEquipped: row.isEquipped,
    source: row.source,
    learnedAt: row.learnedAt.toISOString(),
    effective: {
      atkScale: effective.atkScale,
      mpCost: effective.mpCost,
      cooldownTurns: effective.cooldownTurns,
    },
    nextLevelLinhThachCost: nextLvDef?.linhThachCost ?? null,
    nextLevelShardCost: nextLvDef?.shardCost ?? null,
  };
}

function baselineEffective(baseSkill: SkillDef): EffectiveSkill {
  return {
    key: baseSkill.key,
    atkScale: baseSkill.atkScale,
    mpCost: baseSkill.mpCost,
    selfHealRatio: baseSkill.selfHealRatio,
    selfBloodCost: baseSkill.selfBloodCost,
    cooldownTurns: baseSkill.cooldownTurns ?? 0,
    element: baseSkill.element ?? null,
    sect: baseSkill.sect,
    masteryLevel: 0,
    tier: 'basic',
  };
}

export class CharacterSkillError extends Error {
  constructor(
    public code:
      | 'SKILL_NOT_FOUND'
      | 'CHARACTER_NOT_FOUND'
      | 'NOT_LEARNED'
      | 'MASTERY_MAX'
      | 'TOO_MANY_EQUIPPED'
      | 'INSUFFICIENT_FUNDS'
      | 'REALM_NOT_FOUND'
      | 'REALM_TOO_LOW'
      | 'WRONG_SECT'
      | 'METHOD_NOT_LEARNED'
      // Phase 11.2.D `learnFromBook`:
      | 'INVENTORY_ITEM_NOT_FOUND'
      | 'NOT_SKILL_BOOK'
      | 'ALREADY_LEARNED',
  ) {
    super(code);
  }
}

export interface CharacterSkillView {
  skillKey: string;
  tier: SkillTemplate['tier'];
  masteryLevel: number;
  maxMastery: number;
  isEquipped: boolean;
  source: string;
  learnedAt: string;
  /** null nếu skill key không có template/SkillDef hợp lệ (forward-compat). */
  effective: {
    atkScale: number;
    mpCost: number;
    cooldownTurns: number;
  } | null;
  nextLevelLinhThachCost: number | null;
  nextLevelShardCost: number | null;
}

export interface CharacterSkillStateOut {
  maxEquipped: number;
  learned: CharacterSkillView[];
}

export interface CharacterSkillUpgradeOut {
  skillKey: string;
  previousLevel: number;
  newLevel: number;
  linhThachSpent: number;
  shardSpent: number;
  shardRequired: number;
}

/** Phase 11.2.D — return của `learnFromBook` cho controller envelope. */
export interface CharacterSkillLearnFromBookOut {
  /** Key skill vừa học (echo cho client refresh UI). */
  skillKey: string;
  /** Item key đã consume (vd `'skill_book_kim_quang_tram'`). */
  consumedItemKey: string;
  /** Trạng thái mới sau khi học (kèm row vừa create). */
  state: CharacterSkillStateOut;
}

// Re-export catalog cho consumers.
export { SKILL_TEMPLATES, SKILLS, MAX_EQUIPPED_SKILLS, STARTER_SKILL_KEY };
