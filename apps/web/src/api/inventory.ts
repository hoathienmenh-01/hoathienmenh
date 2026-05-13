import { apiClient } from './client';
import type {
  ActiveSetBonus,
  ElementKey,
  EquipSlot,
  EquipmentSubstat,
  EquipmentSubstatKind,
  ElementalEnchantEffect,
  GearResonanceSummary,
  ItemDef,
  Quality,
  ResonanceTier,
  SetBonusBonusEnvelope,
} from '@xuantoi/shared';

export interface InventoryView {
  id: string;
  itemKey: string;
  qty: number;
  equippedSlot: EquipSlot | null;
  item: ItemDef;
  /** Phase 11.4.B Gem MVP — danh sách gemKey đã khảm theo thứ tự slot. */
  sockets: string[];
  /** Phase 11.5.B Refine MVP — cấp luyện khí 0..15. */
  refineLevel: number;
  /** Phase 15.0.A Equipment Reforge — substats phụ đã re-roll (atk/def/...) */
  substats: EquipmentSubstat[];
  /** Phase 15.0.A Equipment Enchant — element Ngũ Hành đã gắn (null nếu chưa). */
  enchantElement: ElementKey | null;
  /** Phase 15.0.A Equipment Enchant — level 0..MAX_ENCHANT_LEVEL. */
  enchantLevel: number;
  /**
   * Phase QOL-1 — instance lock. `true` ⇒ item KHÔNG được phép `use`.
   * Backend reject `INVENTORY_ITEM_LOCKED` (409). UI hiện icon khóa.
   */
  locked: boolean;
  /** Phase QOL-1 — ISO date (server serialize Date) để sort theo acquired time. */
  createdAt: string;
}

/**
 * Phase 11.5.C — Refine attempt result envelope (sub-set của
 * `RefineAttemptOutcome` của API). Dùng cho UI toast Luyện Khí.
 */
export interface RefineResult {
  equipmentInventoryItemId: string;
  attemptLevel: number;
  result: {
    success: boolean;
    nextLevel: number;
    broken: boolean;
    protectionConsumed: boolean;
  };
  finalLevel: number | null;
  broken: boolean;
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  protectionConsumed: boolean;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function listInventory(): Promise<InventoryView[]> {
  const { data } = await apiClient.get<Envelope<{ items: InventoryView[] }>>('/inventory');
  return unwrap(data).items;
}

/**
 * Phase 23.3 — Equipment Build snapshot (Set Bonus + Gear Resonance).
 *
 * Trả `null` nếu character chưa equip món Phase 23.2 compatible.
 */
export interface EquipmentBuildSummaryDto {
  pieceCount: number;
  mainElement: ElementKey | null;
  elementDistribution: Partial<Record<ElementKey, number>>;
  activeSets: ActiveSetBonus[];
  activeSetCount: number;
  resonance: GearResonanceSummary;
  totalBonusRatio: SetBonusBonusEnvelope;
  totalPowerScore: number;
  resonanceTier: ResonanceTier;
}

export async function getEquipmentBuild(): Promise<EquipmentBuildSummaryDto | null> {
  const { data } = await apiClient.get<Envelope<{ summary: EquipmentBuildSummaryDto | null }>>(
    '/inventory/build',
  );
  return unwrap(data).summary;
}

export async function equipItem(inventoryItemId: string): Promise<InventoryView[]> {
  const { data } = await apiClient.post<Envelope<{ items: InventoryView[] }>>(
    '/inventory/equip',
    { inventoryItemId },
  );
  return unwrap(data).items;
}

export async function unequipItem(slot: EquipSlot): Promise<InventoryView[]> {
  const { data } = await apiClient.post<Envelope<{ items: InventoryView[] }>>(
    '/inventory/unequip',
    { slot },
  );
  return unwrap(data).items;
}

export async function useItem(inventoryItemId: string): Promise<InventoryView[]> {
  const { data } = await apiClient.post<Envelope<{ items: InventoryView[] }>>(
    '/inventory/use',
    { inventoryItemId },
  );
  return unwrap(data).items;
}

/**
 * Phase QOL-1 — POST `/inventory/:id/lock`. Idempotent: gọi 2 lần OK.
 * Trả về `InventoryView` đã cập nhật. Caller có thể replace optimistically
 * trong list hoặc re-fetch.
 */
export async function lockInventoryItem(
  inventoryItemId: string,
): Promise<InventoryView> {
  const { data } = await apiClient.post<Envelope<{ item: InventoryView }>>(
    `/inventory/${encodeURIComponent(inventoryItemId)}/lock`,
  );
  return unwrap(data).item;
}

export async function unlockInventoryItem(
  inventoryItemId: string,
): Promise<InventoryView> {
  const { data } = await apiClient.post<Envelope<{ item: InventoryView }>>(
    `/inventory/${encodeURIComponent(inventoryItemId)}/unlock`,
  );
  return unwrap(data).item;
}

/**
 * Phase QOL-1 — POST `/inventory/lock/batch`. Max 100 ids per call.
 */
export async function lockInventoryBatch(
  inventoryItemIds: string[],
  lock: boolean,
): Promise<{ changed: number; total: number }> {
  const { data } = await apiClient.post<
    Envelope<{ changed: number; total: number }>
  >('/inventory/lock/batch', { inventoryItemIds, lock });
  return unwrap(data);
}

/**
 * Phase 11.5.C — POST `/character/refine`. Server-authoritative refine
 * attempt, deterministic RNG (seedrandom future). Trả `RefineResult` cho UI
 * toast (success +1 / fail risky -1 / fail extreme break / protection consumed).
 *
 * Caller phải re-fetch `listInventory()` sau khi success để cập nhật refineLevel
 * + bonus stat (UI không tự cộng, server-authoritative).
 */
export async function refineEquipment(
  equipmentInventoryItemId: string,
  useProtection: boolean,
): Promise<RefineResult> {
  const { data } = await apiClient.post<Envelope<{ refine: RefineResult }>>(
    '/character/refine',
    { equipmentInventoryItemId, useProtection },
  );
  return unwrap(data).refine;
}

// ====================================================================
// Phase 11.4.C — Gem socket / unsocket / combine API
// ====================================================================

/** Phase 11.4.C — `/character/gem/socket` response envelope. */
export interface GemSocketResult {
  equipmentInventoryItemId: string;
  gemKey: string;
  slotIndex: number;
  sockets: string[];
}

/** Phase 11.4.C — `/character/gem/unsocket` response envelope. */
export interface GemUnsocketResult {
  equipmentInventoryItemId: string;
  gemKey: string;
  sockets: string[];
  /**
   * `false` nếu gem catalog drift — gemKey trong DB không còn trong catalog
   * → service vẫn cho gỡ nhưng không grant lại để tránh restore item invalid.
   */
  gemReturned: boolean;
}

/**
 * Phase 11.4.C — `/character/gem/combine` response envelope.
 * Trùng pattern với `GemCombineResultOut` của `apps/api/.../gem.service.ts`,
 * KHÔNG nhầm với `GemCombineResult` của `@xuantoi/shared` (catalog type).
 */
export interface GemCombineApiResult {
  srcGemKey: string;
  srcQtyConsumed: 3;
  resultGemKey: string;
  resultQtyGained: 1;
}

/**
 * Phase 11.4.C — POST `/character/gem/socket`. Server-authoritative socket
 * 1× gem vào equipment slot kế tiếp. Caller phải re-fetch `listInventory()`
 * để cập nhật equipment.sockets[] + gem qty inventory.
 */
export async function socketGem(
  equipmentInventoryItemId: string,
  gemKey: string,
): Promise<GemSocketResult> {
  const { data } = await apiClient.post<Envelope<{ socket: GemSocketResult }>>(
    '/character/gem/socket',
    { equipmentInventoryItemId, gemKey },
  );
  return unwrap(data).socket;
}

/**
 * Phase 11.4.C — POST `/character/gem/unsocket`. Gỡ gem khỏi 1 slot, gem
 * qty về inventory unequipped row. Caller phải re-fetch `listInventory()`.
 */
export async function unsocketGem(
  equipmentInventoryItemId: string,
  slotIndex: number,
): Promise<GemUnsocketResult> {
  const { data } = await apiClient.post<Envelope<{ unsocket: GemUnsocketResult }>>(
    '/character/gem/unsocket',
    { equipmentInventoryItemId, slotIndex },
  );
  return unwrap(data).unsocket;
}

/**
 * Phase 11.4.C — POST `/character/gem/combine`. Combine 3× gem cùng key
 * thành 1× gem next-tier (deterministic). THAN tier không combine.
 */
export async function combineGemsApi(srcGemKey: string): Promise<GemCombineApiResult> {
  const { data } = await apiClient.post<Envelope<{ combine: GemCombineApiResult }>>(
    '/character/gem/combine',
    { srcGemKey },
  );
  return unwrap(data).combine;
}

// ====================================================================
// Phase 15.0.A — Equipment Reforge / Enchant Foundation API
// ====================================================================

/** Phase 15.0.A — common cost shape cho cả reforge + enchant. */
export interface EquipmentUpgradeCost {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
}

/** Phase 15.0.A — `/character/equipment/reforge` response envelope. */
export interface EquipmentReforgeResult {
  inventoryItemId: string;
  before: EquipmentSubstat[];
  after: EquipmentSubstat[];
  cost: EquipmentUpgradeCost;
}

/** Phase 15.0.A — `/character/equipment/enchant` response envelope. */
export interface EquipmentEnchantResult {
  inventoryItemId: string;
  beforeElement: ElementKey | null;
  beforeLevel: number;
  afterElement: ElementKey;
  afterLevel: number;
  cost: EquipmentUpgradeCost;
}

/** Phase 15.0.A — `/character/equipment/upgrade-preview` response envelope. */
export interface EquipmentUpgradePreview {
  inventoryItemId: string;
  itemKey: string;
  quality: Quality;
  reforge: {
    slots: number;
    currentSubstats: EquipmentSubstat[];
    currentBonus: Record<EquipmentSubstatKind, number>;
    nextCost: EquipmentUpgradeCost;
  };
  enchant: {
    currentElement: ElementKey | null;
    currentLevel: number;
    maxLevel: number;
    currentBonus: Record<EquipmentSubstatKind, number>;
    nextCost: EquipmentUpgradeCost | null;
    baseLinhThachCost: number;
    materialKey: string;
    materialQty: number;
    elements: Array<{ element: ElementKey; effect: ElementalEnchantEffect }>;
  };
}

/**
 * Phase 15.0.A — POST `/character/equipment/reforge`. Server-authoritative
 * re-roll substats (atk/def/hpMax/mpMax/spirit). Atomic consume linhThach +
 * material + write history. Caller phải re-fetch `listInventory()` sau khi
 * success để cập nhật substats.
 */
export async function reforgeEquipment(
  equipmentInventoryItemId: string,
): Promise<EquipmentReforgeResult> {
  const { data } = await apiClient.post<Envelope<{ reforge: EquipmentReforgeResult }>>(
    '/character/equipment/reforge',
    { equipmentInventoryItemId },
  );
  return unwrap(data).reforge;
}

/**
 * Phase 15.0.A — POST `/character/equipment/enchant`. Server-authoritative
 * level-up enchant Ngũ Hành. Lần đầu chọn `element`; các lần sau buộc cùng
 * element. Caller phải re-fetch `listInventory()` sau khi success.
 */
export async function enchantEquipment(
  equipmentInventoryItemId: string,
  element: ElementKey,
): Promise<EquipmentEnchantResult> {
  const { data } = await apiClient.post<Envelope<{ enchant: EquipmentEnchantResult }>>(
    '/character/equipment/enchant',
    { equipmentInventoryItemId, element },
  );
  return unwrap(data).enchant;
}

/**
 * Phase 15.0.A — POST `/character/equipment/upgrade-preview`. Read-only,
 * trả config + cost cho reforge + enchant. Không mutate.
 */
export async function getEquipmentUpgradePreview(
  equipmentInventoryItemId: string,
): Promise<EquipmentUpgradePreview> {
  const { data } = await apiClient.post<Envelope<{ preview: EquipmentUpgradePreview }>>(
    '/character/equipment/upgrade-preview',
    { equipmentInventoryItemId },
  );
  return unwrap(data).preview;
}

// ---------------------------------------------------------------------------
// Phase 23.4 — Equipment Upgrade Economy / Resource Sink.
// ---------------------------------------------------------------------------

export interface EquipmentMergeResult {
  outputInventoryItemId: string;
  outputItemKey: string;
  outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  consumedInventoryItemIds: string[];
  cost: {
    linhThachCost: number;
    materialKey: string;
    materialQty: number;
  };
}

export interface EquipmentDismantleYieldMaterial {
  itemKey: string;
  qty: number;
}

export interface EquipmentDismantleResult {
  consumedInventoryItemId: string;
  returnedGems: string[];
  yield: {
    materials: EquipmentDismantleYieldMaterial[];
    linhThachYield: number;
  };
}

/**
 * Phase 23.4 — Read-only preview returned by `POST /character/equipment/economy-preview`.
 *
 * Shape mirrors `EquipmentEconomyPreview` in
 * `apps/api/src/modules/character/equipment-economy.service.ts` exactly so the
 * UI binds against the actual server payload. Earlier versions of this type
 * declared a nested `enhance.cost` and a `protection.{requiredItemKey,
 * minLevelThreshold}` shape that the server has never returned — that drift
 * silently produced `Cannot read properties of undefined (reading 'linhThachCost')`
 * exceptions at render time when many panels mounted simultaneously (large
 * inventory). All cost helpers in `@xuantoi/shared` return flat objects, so
 * `enhance`, `socket`, `unsocket`, and `reforge` are flat here too.
 */
export interface EquipmentEconomyPreview {
  inventoryItemId: string;
  itemKey: string;
  equipmentTier: number;
  quality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  slot: string;
  currentEnhanceLevel: number;
  maxEnhanceLevel: number;
  enhance: {
    linhThachCost: number;
    materialKey: string;
    materialQty: number;
    protectionRecommended: boolean;
    protectionRequired: boolean;
  } | null;
  merge: {
    inputItemKey: string;
    outputItemKey: string;
    outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
    cost: {
      linhThachCost: number;
      materialKey: string;
      materialQty: number;
      outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
    };
  } | null;
  dismantle: {
    linhThachYield: number;
    materials: EquipmentDismantleYieldMaterial[];
    valueScore: number;
  };
  socket: { linhThachCost: number };
  unsocket: {
    linhThachCost: number;
    materialKey: string | null;
    materialQty: number;
  } | null;
  reforge: {
    linhThachCost: number;
    materialKey: string;
    materialQty: number;
    maxReforgeCount: number;
    currentReforgeCount: number;
  } | null;
  protection: {
    recommended: boolean;
    required: boolean;
    itemKey: string;
  };
  upgradeValidation: { ok: boolean; code: string };
}

/**
 * Phase 23.4 — POST `/character/equipment/merge`. 3 món cùng `itemKey` →
 * 1 món quality cao hơn. Server verify ownership + equipped + recipe.
 * Caller phải re-fetch `listInventory()` sau khi success.
 */
export async function mergeEquipment(
  inventoryItemIds: string[],
): Promise<EquipmentMergeResult> {
  const { data } = await apiClient.post<Envelope<{ merge: EquipmentMergeResult }>>(
    '/character/equipment/merge',
    { inventoryItemIds },
  );
  return unwrap(data).merge;
}

/**
 * Phase 23.4 — POST `/character/equipment/dismantle`. Phân giải 1 món →
 * yield material + linhThach + auto-return gem. Caller phải re-fetch
 * `listInventory()` sau khi success.
 */
export async function dismantleEquipment(
  inventoryItemId: string,
): Promise<EquipmentDismantleResult> {
  const { data } = await apiClient.post<Envelope<{ dismantle: EquipmentDismantleResult }>>(
    '/character/equipment/dismantle',
    { inventoryItemId },
  );
  return unwrap(data).dismantle;
}

/**
 * Phase 23.4 — POST `/character/equipment/economy-preview`. Read-only,
 * trả enhance/merge/dismantle/socket/unsocket/reforge/protection info
 * cho 1 item. Không mutate.
 */
export async function getEquipmentEconomyPreview(
  inventoryItemId: string,
): Promise<EquipmentEconomyPreview> {
  const { data } = await apiClient.post<Envelope<{ preview: EquipmentEconomyPreview }>>(
    '/character/equipment/economy-preview',
    { inventoryItemId },
  );
  return unwrap(data).preview;
}
