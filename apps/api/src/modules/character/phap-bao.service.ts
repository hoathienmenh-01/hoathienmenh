import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  PHAP_BAO_CATALOG,
  canEquipPhapBao,
  getPhapBaoByKey,
  computePhapBaoEffect,
  computePhapBaoProgressionPowerScore,
  getPhapBaoProgressionAwakenCost,
  getPhapBaoProgressionRefineCost,
  getPhapBaoProgressionStarUpCost,
  requiredRefineForAwaken,
  requiredStarForAwaken,
  itemByKey,
  realmByKey,
  type ItemBonus,
  type PhapBaoActiveSkillPreview,
  type PhapBaoDef,
  type PhapBaoSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyError, CurrencyService } from './currency.service';

/**
 * Phase 23.5 — Pháp Bảo Advanced Artifact System runtime (foundation).
 *
 * Read-only orchestration over `InventoryItem` rows mà item key thuộc
 * `PHAP_BAO_CATALOG`. Star-up / awaken persistence DEFER sang Phase 23.6 /
 * 25.1 (cần migration `artifactProgressJson`). Phase này:
 *
 *   - `listForCharacter(characterId)` — list pháp bảo sở hữu + metadata
 *     catalog hợp nhất, kèm `canEquip` (realm gate check phía server) +
 *     `powerScore` deterministic.
 *   - `preview(characterId, inventoryItemId)` — surface passive bonus,
 *     active skill preview, cost refine/star/awaken kế tiếp. Read-only:
 *     KHÔNG mutate state, KHÔNG consume tài nguyên.
 *
 * Equip / unequip pháp bảo dùng nguyên `InventoryService.equip` (đã
 * realm-gate qua `canEquipItemAtRealm` + `EQUIPMENT_REALM_LOCKED`) — KHÔNG
 * thêm endpoint mới.
 *
 * Refine pháp bảo dùng nguyên `RefineService.refineEquipment` (Phase 11.5.B)
 * — `InventoryItem.refineLevel` đã tồn tại, không cần migration. Caller gọi
 * `/character/refine` cho pháp bảo cùng cách trang bị thường.
 *
 * Server-authoritative:
 *   - Ownership: chỉ trả pháp bảo có `characterId` khớp.
 *   - Realm gate: `canEquipPhapBao(realmOrder, def)` — UI hiển thị state lock
 *     nhưng `InventoryService.equip` mới enforce hard reject.
 *   - Catalog filter: nếu `InventoryItem.itemKey` không thuộc
 *     `PHAP_BAO_CATALOG`, không trả về (giữ list clean).
 */
@Injectable()
export class PhapBaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  /**
   * List pháp bảo của character (kèm canEquip + powerScore).
   *
   * Phase 23.5 foundation: `starLevel = 0`, `awakenStage = 0` (chưa persist).
   * `refineLevel` đọc trực tiếp từ `InventoryItem.refineLevel` (đã có Phase
   * 11.5.B).
   */
  async listForCharacter(characterId: string): Promise<PhapBaoView[]> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true },
    });
    if (!character) throw new PhapBaoError('NO_CHARACTER');

    const realmOrder = (realmByKey(character.realmKey)?.order ?? -1) + 1;

    // Index catalog keys for fast filter.
    const catalogKeys = new Set(PHAP_BAO_CATALOG.map((p) => p.artifactKey));

    const inv = await this.prisma.inventoryItem.findMany({
      where: { characterId },
      orderBy: { createdAt: 'asc' },
    });

    const result: PhapBaoView[] = [];
    for (const row of inv) {
      if (!catalogKeys.has(row.itemKey)) continue;
      const def = getPhapBaoByKey(row.itemKey);
      if (!def) continue;
      result.push(
        this.toView(
          def,
          row.id,
          row.refineLevel,
          row.phapBaoStarLevel,
          row.phapBaoAwakenStage,
          row.equippedSlot,
          realmOrder,
        ),
      );
    }
    return result;
  }

  /**
   * Preview pháp bảo theo `inventoryItemId`. Trả passive bonus đã compose,
   * active skill preview (cooldown sau star reduction + unlock state) +
   * cost refine/star/awaken kế tiếp (nếu còn cap).
   *
   * Read-only — KHÔNG mutate state, KHÔNG consume tài nguyên.
   */
  async preview(
    characterId: string,
    inventoryItemId: string,
  ): Promise<PhapBaoPreview> {
    const inv = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!inv || inv.characterId !== characterId) {
      throw new PhapBaoError('INVENTORY_ITEM_NOT_FOUND');
    }
    const def = getPhapBaoByKey(inv.itemKey);
    if (!def) throw new PhapBaoError('PHAP_BAO_NOT_FOUND');
    const itemDef = itemByKey(inv.itemKey);
    if (!itemDef) throw new PhapBaoError('PHAP_BAO_NOT_FOUND');

    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true },
    });
    if (!character) throw new PhapBaoError('NO_CHARACTER');
    const realmOrder = (realmByKey(character.realmKey)?.order ?? -1) + 1;

    const starLevel = inv.phapBaoStarLevel;
    const awakenStage = inv.phapBaoAwakenStage;
    const instance = {
      artifactKey: def.artifactKey,
      starLevel,
      refineLevel: inv.refineLevel,
      awakenStage,
    };

    const effect = computePhapBaoEffect(instance);
    const passiveBonus = effect.bonus;
    const activeSkill = effect.activeSkill;
    const powerScore = computePhapBaoProgressionPowerScore(instance);

    const refineCost = safeRefineCost(def, inv.refineLevel);
    const starCost = safeStarCost(def, starLevel);
    const awakenCost = safeAwakenCost(
      def,
      starLevel,
      inv.refineLevel,
      awakenStage,
    );

    return {
      inventoryItemId: inv.id,
      def: defView(def),
      equippedSlot: inv.equippedSlot,
      refineLevel: inv.refineLevel,
      starLevel,
      awakenStage,
      canEquip: canEquipPhapBao(realmOrder, def),
      realmOrder,
      requiredRealmOrder: def.requiredRealmOrder,
      passiveBonus,
      activeSkill,
      powerScore,
      refineCost,
      starCost,
      awakenCost,
      starUpEnabled: PHAP_BAO_STAR_UP_ENABLED,
      awakenEnabled: PHAP_BAO_AWAKEN_ENABLED,
    };
  }

  async starUp(
    characterId: string,
    inventoryItemId: string,
  ): Promise<PhapBaoUpgradeResult> {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.loadUpgradeContextTx(tx, characterId, inventoryItemId);
      const { def, inv, characterRealmOrder } = ctx;
      if (inv.locked) throw new PhapBaoError('PHAP_BAO_LOCKED');
      if (characterRealmOrder < def.requiredRealmOrder) {
        throw new PhapBaoError('REALM_TOO_LOW');
      }
      if (inv.phapBaoStarLevel >= Math.min(def.starCap, 5)) {
        throw new PhapBaoError('MAX_STAR_REACHED');
      }
      const cost = getPhapBaoProgressionStarUpCost({
        artifact: def,
        currentStarLevel: inv.phapBaoStarLevel,
      });
      const costView = costToView(cost);
      await this.consumeCostTx(
        tx,
        characterId,
        inv.id,
        costView,
        'PHAP_BAO_STAR_UP',
      );
      const upd = await tx.inventoryItem.updateMany({
        where: {
          id: inv.id,
          characterId,
          phapBaoStarLevel: inv.phapBaoStarLevel,
          phapBaoAwakenStage: inv.phapBaoAwakenStage,
          refineLevel: inv.refineLevel,
          locked: false,
        },
        data: { phapBaoStarLevel: { increment: 1 } },
      });
      if (upd.count !== 1) throw new PhapBaoError('CONCURRENT_UPGRADE');
      const next = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      return this.toUpgradeResult(
        def,
        next.id,
        next.refineLevel,
        next.phapBaoStarLevel,
        next.phapBaoAwakenStage,
        next.equippedSlot,
        characterRealmOrder,
        costView,
      );
    });
  }

  async awaken(
    characterId: string,
    inventoryItemId: string,
  ): Promise<PhapBaoUpgradeResult> {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.loadUpgradeContextTx(tx, characterId, inventoryItemId);
      const { def, inv, characterRealmOrder } = ctx;
      if (inv.locked) throw new PhapBaoError('PHAP_BAO_LOCKED');
      if (characterRealmOrder < def.requiredRealmOrder) {
        throw new PhapBaoError('REALM_TOO_LOW');
      }
      if (def.quality !== 'TIEN' && def.quality !== 'THAN') {
        throw new PhapBaoError('QUALITY_TOO_LOW');
      }
      if (inv.phapBaoAwakenStage >= Math.min(def.awakenCap, 3)) {
        throw new PhapBaoError('MAX_AWAKEN_REACHED');
      }
      if (inv.phapBaoStarLevel < requiredStarForAwaken(inv.phapBaoAwakenStage)) {
        throw new PhapBaoError('STAR_TOO_LOW');
      }
      if (inv.refineLevel < requiredRefineForAwaken(def, inv.phapBaoAwakenStage)) {
        throw new PhapBaoError('REFINE_TOO_LOW');
      }
      const cost = getPhapBaoProgressionAwakenCost({
        artifact: def,
        currentAwakenStage: inv.phapBaoAwakenStage,
      });
      const costView = costToView(cost);
      await this.consumeCostTx(
        tx,
        characterId,
        inv.id,
        costView,
        'PHAP_BAO_AWAKEN',
      );
      const upd = await tx.inventoryItem.updateMany({
        where: {
          id: inv.id,
          characterId,
          phapBaoStarLevel: inv.phapBaoStarLevel,
          phapBaoAwakenStage: inv.phapBaoAwakenStage,
          refineLevel: inv.refineLevel,
          locked: false,
        },
        data: { phapBaoAwakenStage: { increment: 1 } },
      });
      if (upd.count !== 1) throw new PhapBaoError('CONCURRENT_UPGRADE');
      const next = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      return this.toUpgradeResult(
        def,
        next.id,
        next.refineLevel,
        next.phapBaoStarLevel,
        next.phapBaoAwakenStage,
        next.equippedSlot,
        characterRealmOrder,
        costView,
      );
    });
  }

  async refine(
    characterId: string,
    inventoryItemId: string,
  ): Promise<PhapBaoUpgradeResult> {
    return this.prisma.$transaction(async (tx) => {
      const ctx = await this.loadUpgradeContextTx(tx, characterId, inventoryItemId);
      const { def, inv, characterRealmOrder } = ctx;
      if (inv.locked) throw new PhapBaoError('PHAP_BAO_LOCKED');
      if (inv.refineLevel >= def.refineCap) throw new PhapBaoError('MAX_REFINE_REACHED');
      const cost = getPhapBaoProgressionRefineCost({
        artifact: def,
        currentRefineLevel: inv.refineLevel,
      });
      const costView = costToView(cost);
      await this.consumeCostTx(
        tx,
        characterId,
        inv.id,
        costView,
        'PHAP_BAO_REFINE',
      );
      const upd = await tx.inventoryItem.updateMany({
        where: {
          id: inv.id,
          characterId,
          refineLevel: inv.refineLevel,
          phapBaoStarLevel: inv.phapBaoStarLevel,
          phapBaoAwakenStage: inv.phapBaoAwakenStage,
          locked: false,
        },
        data: { refineLevel: { increment: 1 } },
      });
      if (upd.count !== 1) throw new PhapBaoError('CONCURRENT_UPGRADE');
      const next = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: inv.id },
      });
      return this.toUpgradeResult(
        def,
        next.id,
        next.refineLevel,
        next.phapBaoStarLevel,
        next.phapBaoAwakenStage,
        next.equippedSlot,
        characterRealmOrder,
        costView,
      );
    });
  }

  /**
   * Trả catalog metadata cho FE init (lookup lookup, không gọi list mỗi
   * lần). Read-only, cache-safe.
   */
  listCatalog(): readonly PhapBaoDefView[] {
    return PHAP_BAO_CATALOG.map(defView);
  }

  private toView(
    def: PhapBaoDef,
    inventoryItemId: string,
    refineLevel: number,
    starLevel: number,
    awakenStage: number,
    equippedSlot: string | null,
    characterRealmOrder: number,
  ): PhapBaoView {
    const instance = {
      artifactKey: def.artifactKey,
      starLevel,
      refineLevel,
      awakenStage,
    };
    return {
      inventoryItemId,
      def: defView(def),
      equippedSlot,
      refineLevel,
      starLevel,
      awakenStage,
      canEquip: canEquipPhapBao(characterRealmOrder, def),
      requiredRealmOrder: def.requiredRealmOrder,
      powerScore: computePhapBaoProgressionPowerScore(instance),
    };
  }

  private async loadUpgradeContextTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    inventoryItemId: string,
  ) {
    const inv = await tx.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!inv || inv.characterId !== characterId) {
      throw new PhapBaoError('INVENTORY_ITEM_NOT_FOUND');
    }
    const def = getPhapBaoByKey(inv.itemKey);
    if (!def) throw new PhapBaoError('PHAP_BAO_NOT_FOUND');
    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true },
    });
    if (!character) throw new PhapBaoError('NO_CHARACTER');
    return {
      inv,
      def,
      characterRealmOrder: (realmByKey(character.realmKey)?.order ?? -1) + 1,
    };
  }

  private async consumeCostTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    inventoryItemId: string,
    cost: PhapBaoCostView,
    reason: 'PHAP_BAO_STAR_UP' | 'PHAP_BAO_AWAKEN' | 'PHAP_BAO_REFINE',
  ): Promise<void> {
    await this.consumeMaterialTx(
      tx,
      characterId,
      inventoryItemId,
      cost.materialKey,
      cost.materialQty,
      reason,
    );
    if (cost.shardKey && cost.shardQty) {
      await this.consumeMaterialTx(
        tx,
        characterId,
        inventoryItemId,
        cost.shardKey,
        cost.shardQty,
        reason,
      );
    }
    if (cost.awakenStoneKey && cost.awakenStoneQty) {
      await this.consumeMaterialTx(
        tx,
        characterId,
        inventoryItemId,
        cost.awakenStoneKey,
        cost.awakenStoneQty,
        reason,
      );
    }
    try {
      await this.currency.applyTx(tx, {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: BigInt(-cost.linhThachCost),
        reason,
        refType: 'InventoryItem',
        refId: inventoryItemId,
      });
    } catch (e) {
      if (e instanceof CurrencyError && e.code === 'INSUFFICIENT_FUNDS') {
        throw new PhapBaoError('INSUFFICIENT_FUNDS');
      }
      throw e;
    }
  }

  private async consumeMaterialTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    inventoryItemId: string,
    itemKey: string,
    qty: number,
    reason: string,
  ): Promise<void> {
    const row = await tx.inventoryItem.findFirst({
      where: { characterId, itemKey, equippedSlot: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!row || row.qty < qty) throw new PhapBaoError('INSUFFICIENT_MATERIAL');
    const upd = await tx.inventoryItem.updateMany({
      where: { id: row.id, qty: { gte: qty } },
      data: { qty: { decrement: qty } },
    });
    if (upd.count !== 1) throw new PhapBaoError('CONCURRENT_UPGRADE');
    await tx.inventoryItem.deleteMany({ where: { id: row.id, qty: { lte: 0 } } });
    await tx.itemLedger.create({
      data: {
        characterId,
        itemKey,
        qtyDelta: -qty,
        reason,
        refType: 'InventoryItem',
        refId: inventoryItemId,
      },
    });
  }

  private toUpgradeResult(
    def: PhapBaoDef,
    inventoryItemId: string,
    refineLevel: number,
    starLevel: number,
    awakenStage: number,
    equippedSlot: string | null,
    characterRealmOrder: number,
    cost: PhapBaoCostView,
  ): PhapBaoUpgradeResult {
    const view = this.toView(
      def,
      inventoryItemId,
      refineLevel,
      starLevel,
      awakenStage,
      equippedSlot,
      characterRealmOrder,
    );
    return {
      item: view,
      cost,
      nextPreview: {
        refineCost: safeRefineCost(def, refineLevel),
        starCost: safeStarCost(def, starLevel),
        awakenCost: safeAwakenCost(def, starLevel, refineLevel, awakenStage),
      },
    };
  }
}

/**
 * Phase 23.7 runtime enabled: persistence fields + transaction-safe endpoints.
 */
export const PHAP_BAO_STAR_UP_ENABLED = true;
export const PHAP_BAO_AWAKEN_ENABLED = true;

function defView(def: PhapBaoDef): PhapBaoDefView {
  return {
    artifactKey: def.artifactKey,
    itemKey: def.itemKey,
    nameVi: def.nameVi,
    nameEn: def.nameEn,
    descriptionVi: def.descriptionVi,
    descriptionEn: def.descriptionEn,
    artifactTier: def.artifactTier,
    requiredRealmOrder: def.requiredRealmOrder,
    quality: def.quality,
    elementAffinity: def.elementAffinity,
    role: def.role,
    activeSkill: def.activeSkill,
    starCap: def.starCap,
    refineCap: def.refineCap,
    awakenCap: def.awakenCap,
    source: def.source,
    powerBudget: def.powerBudget,
  };
}

function safeRefineCost(
  def: PhapBaoDef,
  currentRefineLevel: number,
): PhapBaoCostView | null {
  try {
    const cost = getPhapBaoProgressionRefineCost({
      artifact: def,
      currentRefineLevel,
    });
    return costToView(cost);
  } catch {
    return null;
  }
}

function safeStarCost(
  def: PhapBaoDef,
  currentStarLevel: number,
): PhapBaoCostView | null {
  try {
    const cost = getPhapBaoProgressionStarUpCost({
      artifact: def,
      currentStarLevel,
    });
    return costToView(cost);
  } catch {
    return null;
  }
}

function safeAwakenCost(
  def: PhapBaoDef,
  currentStarLevel: number,
  currentRefineLevel: number,
  currentAwakenStage: number,
): PhapBaoCostView | null {
  if (currentStarLevel < requiredStarForAwaken(currentAwakenStage)) return null;
  if (currentRefineLevel < requiredRefineForAwaken(def, currentAwakenStage)) {
    return null;
  }
  try {
    const cost = getPhapBaoProgressionAwakenCost({
      artifact: def,
      currentAwakenStage,
    });
    return costToView(cost);
  } catch {
    return null;
  }
}

function costToView(cost: {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  shardKey?: string;
  shardQty?: number;
  awakenStoneKey?: string;
  awakenStoneQty?: number;
}): PhapBaoCostView {
  return {
    linhThachCost: cost.linhThachCost,
    materialKey: cost.materialKey,
    materialQty: cost.materialQty,
    shardKey: cost.shardKey ?? null,
    shardQty: cost.shardQty ?? null,
    awakenStoneKey: cost.awakenStoneKey ?? null,
    awakenStoneQty: cost.awakenStoneQty ?? null,
  };
}

export interface PhapBaoView {
  inventoryItemId: string;
  def: PhapBaoDefView;
  equippedSlot: string | null;
  refineLevel: number;
  starLevel: number;
  awakenStage: number;
  canEquip: boolean;
  requiredRealmOrder: number;
  powerScore: number;
}

export interface PhapBaoPreview {
  inventoryItemId: string;
  def: PhapBaoDefView;
  equippedSlot: string | null;
  refineLevel: number;
  starLevel: number;
  awakenStage: number;
  canEquip: boolean;
  realmOrder: number;
  requiredRealmOrder: number;
  passiveBonus: ItemBonus;
  activeSkill: PhapBaoActiveSkillPreview | { available: false };
  powerScore: number;
  refineCost: PhapBaoCostView | null;
  starCost: PhapBaoCostView | null;
  awakenCost: PhapBaoCostView | null;
  starUpEnabled: boolean;
  awakenEnabled: boolean;
}

export interface PhapBaoDefView {
  artifactKey: string;
  itemKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  artifactTier: number;
  requiredRealmOrder: number;
  quality: string;
  elementAffinity: string;
  role: string;
  activeSkill: PhapBaoDef['activeSkill'];
  starCap: number;
  refineCap: number;
  awakenCap: number;
  source: PhapBaoSource;
  powerBudget: number;
}

export interface PhapBaoCostView {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  shardKey: string | null;
  shardQty: number | null;
  awakenStoneKey: string | null;
  awakenStoneQty: number | null;
}

export interface PhapBaoUpgradeResult {
  item: PhapBaoView;
  cost: PhapBaoCostView;
  nextPreview: {
    refineCost: PhapBaoCostView | null;
    starCost: PhapBaoCostView | null;
    awakenCost: PhapBaoCostView | null;
  };
}

export class PhapBaoError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'INVENTORY_ITEM_NOT_FOUND'
      | 'PHAP_BAO_NOT_FOUND'
      | 'PHAP_BAO_STAR_UP_DISABLED'
      | 'PHAP_BAO_AWAKEN_DISABLED'
      | 'PHAP_BAO_LOCKED'
      | 'REALM_TOO_LOW'
      | 'MAX_STAR_REACHED'
      | 'MAX_AWAKEN_REACHED'
      | 'MAX_REFINE_REACHED'
      | 'QUALITY_TOO_LOW'
      | 'STAR_TOO_LOW'
      | 'REFINE_TOO_LOW'
      | 'INSUFFICIENT_MATERIAL'
      | 'INSUFFICIENT_FUNDS'
      | 'CONCURRENT_UPGRADE',
  ) {
    super(code);
  }
}
