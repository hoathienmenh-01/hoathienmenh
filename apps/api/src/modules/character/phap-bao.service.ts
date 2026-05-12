import { Injectable } from '@nestjs/common';
import {
  PHAP_BAO_CATALOG,
  canEquipPhapBao,
  computePhapBaoActiveSkillPreview,
  computePhapBaoPassiveBonus,
  computePhapBaoPowerScore,
  getPhapBaoByKey,
  getPhapBaoAwakenCost,
  getPhapBaoStarUpCost,
  getPhapBaoUpgradeCost,
  itemByKey,
  realmByKey,
  validatePhapBaoUpgradeRequest,
  type ItemBonus,
  type PhapBaoActiveSkillPreview,
  type PhapBaoDef,
  type PhapBaoSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
      result.push(this.toView(def, row.id, row.refineLevel, row.equippedSlot, realmOrder));
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

    // Foundation: star + awaken chưa persist — đọc default 0.
    const starLevel = 0;
    const awakenStage = 0;
    const instance = {
      artifactKey: def.artifactKey,
      starLevel,
      refineLevel: inv.refineLevel,
      awakenStage,
    };

    const passiveBonus = computePhapBaoPassiveBonus(instance);
    const activeSkill = computePhapBaoActiveSkillPreview(instance);
    const powerScore = computePhapBaoPowerScore(instance);

    const refineCost = safeRefineCost(def, inv.refineLevel);
    const starCost = safeStarCost(def, starLevel);
    const awakenCost = safeAwakenCost(def, starLevel, awakenStage);

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
    equippedSlot: string | null,
    characterRealmOrder: number,
  ): PhapBaoView {
    const starLevel = 0;
    const awakenStage = 0;
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
      powerScore: computePhapBaoPowerScore(instance),
    };
  }
}

/**
 * Phase 23.5 foundation: star-up persistence DEFER → flag tắt cứng.
 * Phase 23.6 / 25.1 sẽ wire migration `artifactProgressJson` + endpoint
 * mutate. UI surface cost preview nhưng disable nút bấm.
 */
export const PHAP_BAO_STAR_UP_ENABLED = false;
export const PHAP_BAO_AWAKEN_ENABLED = false;

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
  const validation = validatePhapBaoUpgradeRequest({
    artifactKey: def.artifactKey,
    kind: 'refine',
    currentRefineLevel,
    currentStarLevel: 0,
    currentAwakenStage: 0,
  });
  if (!validation.ok) return null;
  const cost = getPhapBaoUpgradeCost({
    tier: def.artifactTier,
    currentRefineLevel,
    refineCap: def.refineCap,
    quality: def.quality,
  });
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

function safeStarCost(
  def: PhapBaoDef,
  currentStarLevel: number,
): PhapBaoCostView | null {
  const validation = validatePhapBaoUpgradeRequest({
    artifactKey: def.artifactKey,
    kind: 'star',
    currentRefineLevel: 0,
    currentStarLevel,
    currentAwakenStage: 0,
  });
  if (!validation.ok) return null;
  const cost = getPhapBaoStarUpCost({
    tier: def.artifactTier,
    currentStarLevel,
    starCap: def.starCap,
    quality: def.quality,
  });
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

function safeAwakenCost(
  def: PhapBaoDef,
  currentStarLevel: number,
  currentAwakenStage: number,
): PhapBaoCostView | null {
  const validation = validatePhapBaoUpgradeRequest({
    artifactKey: def.artifactKey,
    kind: 'awaken',
    currentRefineLevel: 0,
    currentStarLevel,
    currentAwakenStage,
  });
  if (!validation.ok) return null;
  try {
    const cost = getPhapBaoAwakenCost({
      tier: def.artifactTier,
      currentAwakenStage,
      awakenCap: def.awakenCap,
      quality: def.quality,
    });
    return {
      linhThachCost: cost.linhThachCost,
      materialKey: cost.materialKey,
      materialQty: cost.materialQty,
      shardKey: cost.shardKey ?? null,
      shardQty: cost.shardQty ?? null,
      awakenStoneKey: cost.awakenStoneKey ?? null,
      awakenStoneQty: cost.awakenStoneQty ?? null,
    };
  } catch {
    return null;
  }
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

export class PhapBaoError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'INVENTORY_ITEM_NOT_FOUND'
      | 'PHAP_BAO_NOT_FOUND'
      | 'PHAP_BAO_STAR_UP_DISABLED'
      | 'PHAP_BAO_AWAKEN_DISABLED',
  ) {
    super(code);
  }
}
