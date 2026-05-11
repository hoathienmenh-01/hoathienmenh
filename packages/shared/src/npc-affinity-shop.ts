/**
 * Phase 12.10.C — NPC Affinity Shop catalog.
 *
 * Tách rời với `shop.ts` (Phase 9 — generic NPC vendor): catalog NÀY gắn vào
 * **per-NPC affinity tier** — item chỉ unlock khi `affinityScore >= tier.minScore`.
 *
 * Mỗi `NpcAffinityShopItemDef`:
 *   - `npcKey` — match `NPCS[].key` + `NPC_AFFINITY[].npcKey`.
 *   - `itemKey` — match `ITEMS[].key`.
 *   - `cost` + `currency` — giá hiệu dụng (override `ItemDef.price`).
 *   - `requiredAffinityTier` — match `AFFINITY_TIERS[].key`.
 *   - `dailyLimit` / `weeklyLimit` — opt-in, server enforce qua ItemLedger
 *     aggregate (`reason='NPC_SHOP_BUY'`, `refId='${npcKey}:${itemKey}'`).
 *   - `stockType` — `'unlimited'` | `'daily'` | `'weekly'`. Helper invariant
 *     đảm bảo `daily` ⇔ `dailyLimit`, `weekly` ⇔ `weeklyLimit`.
 *   - `unlockHint` — flavor cho FE locked-state tooltip (vi + en).
 *
 * Catalog rules (validator + balance review):
 *   1. KHÔNG bán item phá economy: tier-cap kiểm tra
 *      - tier `xa_la` / `quen_biet`: chỉ bán `PHAM` (sơ căn) hoặc consumable
 *        `LINH`. Tổng cost ≤ 250 / item.
 *      - tier `ban_huu`: cho phép `LINH` equipment + `LINH` consumable. Cost
 *        ≤ 1500 / item.
 *      - tier `tri_giao` / `tri_ky`: cho phép `HUYEN`/`TIEN` consumable, nhưng
 *        `dailyLimit ≤ 2` để rare resource không farm.
 *   2. Mỗi NPC có ≥ 1 entry (cover catalog).
 *   3. Hard cap: tổng `dailyLimit` per-NPC ≤ 30 (anti-grind).
 *
 * Persistence: KHÔNG ghi DB ở đây (catalog tĩnh). Server enforce daily/weekly
 * limit qua `ItemLedger` aggregate theo `(reason='NPC_SHOP_BUY', refId)`
 * + `createdAt` window — không cần migration mới (mirror pattern `ShopService.buy`).
 *
 * Design refs:
 *   - `docs/BALANCE_MODEL.md` — cap reward/cost mỗi tier.
 *   - `docs/ECONOMY_MODEL.md` — anti-hoard rule, ledger reason chuẩn.
 *   - `docs/story/PHASE12_STORY_PROGRESS.md` — Phase 12.10.C row.
 */

import { ITEMS, type ItemDef } from './items';
import { NPCS } from './npcs';
import {
  AFFINITY_TIERS,
  NPC_AFFINITY,
  type AffinityTierDef,
  type AffinityTierKey,
} from './npc-affinity';

/** Currency hỗ trợ — mirror `ShopCurrency` (`shop.ts`). */
export type NpcAffinityShopCurrency = 'LINH_THACH' | 'TIEN_NGOC';

/** Stock pattern — daily/weekly/unlimited. */
export type NpcAffinityShopStockType = 'unlimited' | 'daily' | 'weekly';

export interface NpcAffinityShopItemDef {
  /** Match `NPCS[].key` + `NPC_AFFINITY[].npcKey`. */
  npcKey: string;
  /** Match `ITEMS[].key`. */
  itemKey: string;
  /** Tier required để mở khoá entry này. */
  requiredAffinityTier: AffinityTierKey;
  /** Cost / 1 unit (LINH_THACH integer hoặc TIEN_NGOC integer). */
  cost: number;
  currency: NpcAffinityShopCurrency;
  stockType: NpcAffinityShopStockType;
  /** Required khi `stockType='daily'`. UTC day bucket reset (mirror NPC gift). */
  dailyLimit?: number;
  /** Required khi `stockType='weekly'`. UTC week bucket (Monday 00:00 UTC). */
  weeklyLimit?: number;
  /** Mô tả locked-state cho FE tooltip — tiếng Việt. */
  unlockHint: string;
  /** Mô tả locked-state cho FE tooltip — tiếng Anh fallback. */
  unlockHintEn: string;
}

/**
 * Catalog NPC affinity shop. Mỗi NPC trục cốt truyện có vài item nhỏ.
 *
 * Balance review (BALANCE_MODEL §3):
 *   - Lăng Vân Sinh (chưởng môn): consumable Hoa Thiên-themed + skill book unlock cao tier.
 *   - Mộc Thanh Y (alchemy): pill cao cấp daily limit chặt.
 *   - Hàn Dạ (rival): vũ khí kim hệ rare, weekly limit.
 *   - Tô Nguyệt Ly (mysterious): material/ore khám phá Hoa Thiên cổ.
 *   - Huyết La Sát (ma tu): ma đan / Huyết hệ — chỉ unlock cao tier vì path nguy hiểm.
 */
export const NPC_AFFINITY_SHOPS: readonly NpcAffinityShopItemDef[] = [
  // ============================================================================
  // Lăng Vân Sinh — chưởng môn Hoa Thiên Môn.
  // ============================================================================
  {
    npcKey: 'npc_lang_van_sinh',
    itemKey: 'huyet_chi_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 30,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 5,
    unlockHint: 'Chưởng môn cấp đan dược sơ căn cho đệ tử ngoại môn quen mặt.',
    unlockHintEn: 'Sect master shares basic pills with familiar outer disciples.',
  },
  {
    npcKey: 'npc_lang_van_sinh',
    itemKey: 'co_thien_dan',
    requiredAffinityTier: 'ban_huu',
    cost: 220,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 2,
    unlockHint: 'Đan dược tăng tu vi — chưởng môn dành cho bằng hữu thân tín.',
    unlockHintEn: 'Cultivation pills granted only to trusted companions.',
  },
  {
    npcKey: 'npc_lang_van_sinh',
    itemKey: 'skill_book_kim_quang_tram',
    requiredAffinityTier: 'tri_giao',
    cost: 800,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Tâm pháp Kim Quang — chỉ tri giao mới được lĩnh hội.',
    unlockHintEn: 'Kim Quang heart-method — only confidants may inherit.',
  },

  // ============================================================================
  // Mộc Thanh Y — đại sư tỷ alchemy.
  // ============================================================================
  {
    npcKey: 'npc_moc_thanh_y',
    itemKey: 'thanh_lam_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 90,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 4,
    unlockHint: 'Đại sư tỷ luyện đan hồi máu — chia sẻ với đồng môn quen biết.',
    unlockHintEn: 'Senior sister shares healing pills with acquaintances.',
  },
  {
    npcKey: 'npc_moc_thanh_y',
    itemKey: 'sinh_co_dan',
    requiredAffinityTier: 'ban_huu',
    cost: 480,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 2,
    unlockHint: 'Sinh Cơ Đan — đan dược buff hồi phục, mộc hệ thân pháp.',
    unlockHintEn: 'Sinh Cơ pill — Wood-element regen buff for companions.',
  },
  {
    npcKey: 'npc_moc_thanh_y',
    itemKey: 'skill_book_moc_linh_truong_dieu',
    requiredAffinityTier: 'tri_giao',
    cost: 950,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Mộc Linh Trượng Điều — bí pháp mộc hệ đại sư tỷ truyền cho tri giao.',
    unlockHintEn: 'Mộc Linh staff art — Wood secret art for confidants.',
  },

  // ============================================================================
  // Hàn Dạ — rival kiếm khách.
  // ============================================================================
  {
    npcKey: 'npc_han_da',
    itemKey: 'so_kiem',
    requiredAffinityTier: 'quen_biet',
    cost: 60,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 3,
    unlockHint: 'Hàn Dạ chỉ điểm — sơ kiếm phàm phẩm cho người luyện kiếm.',
    unlockHintEn: 'Hàn Dạ guides sword students with starter blades.',
  },
  {
    npcKey: 'npc_han_da',
    itemKey: 'cuong_luc_dan',
    requiredAffinityTier: 'ban_huu',
    cost: 320,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 2,
    unlockHint: 'Đan tăng công — Hàn Dạ tặng bằng hữu cùng tu kiếm.',
    unlockHintEn: 'Attack-buff pill from Hàn Dạ to fellow swordsmen.',
  },
  {
    npcKey: 'npc_han_da',
    itemKey: 'skill_book_kim_quang_tram',
    requiredAffinityTier: 'tri_giao',
    cost: 1200,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Hàn Dạ truyền kiếm pháp Kim Quang Trảm — chỉ tri giao mới được học.',
    unlockHintEn: 'Hàn Dạ passes the Kim Quang sword art only to confidants.',
  },

  // ============================================================================
  // Tô Nguyệt Ly — mysterious Hoa Thiên hậu nhân.
  // ============================================================================
  {
    npcKey: 'npc_to_nguyet_ly',
    itemKey: 'linh_thao',
    requiredAffinityTier: 'quen_biet',
    cost: 18,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 6,
    unlockHint: 'Linh thảo Tô Nguyệt Ly hái ở di tích Hoa Thiên Cổ Mộ.',
    unlockHintEn: 'Spirit herbs Tô Nguyệt Ly gathered at the Ancient Hoa Thiên Tomb.',
  },
  {
    npcKey: 'npc_to_nguyet_ly',
    itemKey: 'huyet_tinh',
    requiredAffinityTier: 'ban_huu',
    cost: 70,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 3,
    unlockHint: 'Huyết Tinh hiếm — Tô Nguyệt Ly chia sẻ với bằng hữu cùng tìm di tích.',
    unlockHintEn: 'Rare Huyết Tinh — Tô Nguyệt Ly shares with relic-seeking companions.',
  },
  {
    npcKey: 'npc_to_nguyet_ly',
    itemKey: 'tinh_thiet',
    requiredAffinityTier: 'tri_giao',
    cost: 140,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 5,
    unlockHint: 'Tinh Thiết Hoa Thiên cổ — luyện khí tài liệu cao cấp.',
    unlockHintEn: 'Ancient Hoa Thiên Tinh Thiết — high-grade refine material.',
  },

  // ============================================================================
  // Huyết La Sát — ma tu, path nguy hiểm.
  // ============================================================================
  {
    npcKey: 'npc_huyet_la_sat',
    itemKey: 'huyet_tinh',
    requiredAffinityTier: 'ban_huu',
    cost: 50,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 4,
    unlockHint: 'Huyết Tinh Huyết La Sát thu được từ ma thú — bằng hữu mới được mua.',
    unlockHintEn: 'Huyết La Sát\u2019s demon-beast Huyết Tinh — for companions only.',
  },
  {
    npcKey: 'npc_huyet_la_sat',
    itemKey: 'than_dan',
    requiredAffinityTier: 'tri_giao',
    cost: 600,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Thần Đan ma tu — Huyết La Sát chỉ trao cho tri giao đi cùng đường.',
    unlockHintEn: 'Demonic Thần Đan — Huyết La Sát reserves it for path-bound confidants.',
  },
  {
    npcKey: 'npc_a_linh',
    itemKey: 'huyet_chi_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 20,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 3,
    unlockHint: 'A Linh để dành đan sơ cấp cho tân đệ tử chịu nghe hướng dẫn.',
    unlockHintEn: 'A Linh saves starter pills for new disciples who follow guidance.',
  },
  {
    npcKey: 'npc_van_kim_nuong',
    itemKey: 'linh_thao',
    requiredAffinityTier: 'quen_biet',
    cost: 22,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 5,
    unlockHint: 'Thương hội bán linh thảo giá mềm cho khách giữ chữ tín.',
    unlockHintEn: 'The guild offers fair-priced herbs to trustworthy customers.',
  },
  {
    npcKey: 'npc_bach_de_tu',
    itemKey: 'linh_lo_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 120,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 2,
    unlockHint: 'Bạch Đế Tử bố thí linh lộ như một phép thử tiên luật.',
    unlockHintEn: 'Bạch Đế Tử grants dew pills as a test of immortal law.',
  },
  {
    npcKey: 'npc_tich_linh_su_gia',
    itemKey: 'linh_lo_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 140,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 1,
    unlockHint: 'Sứ giả để lại linh lộ nhiễm khí lạnh, chỉ dùng làm manh mối nhỏ.',
    unlockHintEn: 'The emissary leaves cold dew pills as a minor clue only.',
  },
  {
    npcKey: 'npc_huyet_ha_su_gia',
    itemKey: 'huyet_tinh',
    requiredAffinityTier: 'quen_biet',
    cost: 65,
    currency: 'LINH_THACH',
    stockType: 'daily',
    dailyLimit: 2,
    unlockHint: 'Môi giới Huyết Hà bán huyết tinh có giới hạn để tránh lạm dụng.',
    unlockHintEn: 'The Blood River broker sells limited blood crystals to prevent abuse.',
  },
  {
    npcKey: 'npc_hoa_thien_dao_to',
    itemKey: 'co_thien_dan',
    requiredAffinityTier: 'quen_biet',
    cost: 240,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Tàn niệm tổ sư mở một viên Cổ Thiên Đan như ký ức truyền thừa.',
    unlockHintEn: 'The founder remnant unlocks one ancient pill as inheritance memory.',
  },
  {
    npcKey: 'npc_tich_thien_dao_chu',
    itemKey: 'linh_lo_dan',
    requiredAffinityTier: 'xa_la',
    cost: 160,
    currency: 'LINH_THACH',
    stockType: 'weekly',
    weeklyLimit: 1,
    unlockHint: 'Đạo âm Tịch Thiên chỉ để lại vật chứng nhỏ, không phải phần thưởng lớn.',
    unlockHintEn: 'The Tịch Thiên echo leaves a small clue, not a major reward.',
  },
] as const;

export interface NpcAffinityShopItemView {
  npcKey: string;
  itemKey: string;
  requiredAffinityTier: AffinityTierKey;
  requiredTierLabel: string;
  requiredTierLabelEn: string;
  requiredTierMinScore: number;
  cost: number;
  currency: NpcAffinityShopCurrency;
  stockType: NpcAffinityShopStockType;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  unlockHint: string;
  unlockHintEn: string;
  /** Resolved item def — name/description/quality/kind cho FE render. */
  item: ItemDef;
}

/** Lookup tier def theo `AffinityTierKey`. */
function tierDefForKey(key: AffinityTierKey): AffinityTierDef {
  return AFFINITY_TIERS.find((t) => t.key === key) ?? AFFINITY_TIERS[0];
}

/** Build view object cho FE / API response (merge ItemDef + tier label). */
export function toNpcAffinityShopItemView(
  def: NpcAffinityShopItemDef,
): NpcAffinityShopItemView | null {
  const item = ITEMS.find((i) => i.key === def.itemKey);
  if (!item) return null;
  const tier = tierDefForKey(def.requiredAffinityTier);
  return {
    npcKey: def.npcKey,
    itemKey: def.itemKey,
    requiredAffinityTier: def.requiredAffinityTier,
    requiredTierLabel: tier.label,
    requiredTierLabelEn: tier.labelEn,
    requiredTierMinScore: tier.minScore,
    cost: def.cost,
    currency: def.currency,
    stockType: def.stockType,
    dailyLimit: def.dailyLimit ?? null,
    weeklyLimit: def.weeklyLimit ?? null,
    unlockHint: def.unlockHint,
    unlockHintEn: def.unlockHintEn,
    item,
  };
}

/**
 * List shop entries của 1 NPC (catalog order, không filter theo tier — caller
 * marker locked/unlocked dựa vào tier hiện tại).
 */
export function npcAffinityShopForNpc(npcKey: string): NpcAffinityShopItemDef[] {
  return NPC_AFFINITY_SHOPS.filter((e) => e.npcKey === npcKey);
}

/**
 * List shop entries CHỈ unlocked với 1 affinity tier cụ thể.
 *
 * Spec helper: `npcShopForAffinity(npcKey, affinityTier)`.
 */
export function npcShopForAffinity(
  npcKey: string,
  affinityTier: AffinityTierKey,
): NpcAffinityShopItemDef[] {
  const order = AFFINITY_TIERS.find((t) => t.key === affinityTier)?.order ?? 0;
  return NPC_AFFINITY_SHOPS.filter((e) => {
    if (e.npcKey !== npcKey) return false;
    const reqOrder =
      AFFINITY_TIERS.find((t) => t.key === e.requiredAffinityTier)?.order ?? 0;
    return order >= reqOrder;
  });
}

/** Lookup catalog entry theo `(npcKey, itemKey)`. */
export function npcAffinityShopItem(
  npcKey: string,
  itemKey: string,
): NpcAffinityShopItemDef | undefined {
  return NPC_AFFINITY_SHOPS.find((e) => e.npcKey === npcKey && e.itemKey === itemKey);
}

/**
 * Validate catalog — invariant test pin-down các điểm dễ break:
 *   1. Mọi `npcKey` ∈ `NPCS` + `NPC_AFFINITY` (NPC có affinity config).
 *   2. Mọi `itemKey` ∈ `ITEMS`.
 *   3. KHÔNG duplicate `(npcKey, itemKey)`.
 *   4. `requiredAffinityTier` ∈ `AFFINITY_TIERS`.
 *   5. `cost > 0` integer.
 *   6. `stockType='daily'` ⇔ `dailyLimit` integer ≥ 1, ≤ 30.
 *   7. `stockType='weekly'` ⇔ `weeklyLimit` integer ≥ 1, ≤ 50.
 *   8. `stockType='unlimited'` ⇔ KHÔNG có `dailyLimit` / `weeklyLimit`.
 *   9. `unlockHint` / `unlockHintEn` non-empty.
 *  10. Mỗi NPC có ≥ 1 entry (cover catalog representative content).
 *  11. Tổng `dailyLimit` của 1 NPC ≤ 30 (anti-grind).
 *  12. Cost cap theo tier (ECONOMY_MODEL):
 *      - `xa_la` / `quen_biet`: cost ≤ 250.
 *      - `ban_huu`: cost ≤ 1500.
 *      - `tri_giao` / `tri_ky`: cost ≤ 2500.
 */
export function validateNpcAffinityShopCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const affinityKeys = new Set(NPC_AFFINITY.map((a) => a.npcKey));
  const itemKeys = new Set(ITEMS.map((i) => i.key));
  const tierKeys = new Set(AFFINITY_TIERS.map((t) => t.key));

  const seenPair = new Set<string>();
  const dailySumByNpc = new Map<string, number>();
  const npcSeen = new Set<string>();

  for (const def of NPC_AFFINITY_SHOPS) {
    const where = `${def.npcKey}:${def.itemKey}`;
    if (!npcKeys.has(def.npcKey)) {
      errs.push(`Shop ${where} references unknown NPC`);
    }
    if (!affinityKeys.has(def.npcKey)) {
      errs.push(`Shop ${where} references NPC without NPC_AFFINITY config`);
    }
    if (!itemKeys.has(def.itemKey)) {
      errs.push(`Shop ${where} references unknown item`);
    }
    if (!tierKeys.has(def.requiredAffinityTier)) {
      errs.push(`Shop ${where} references unknown tier ${def.requiredAffinityTier}`);
    }
    if (seenPair.has(where)) {
      errs.push(`Shop ${where} duplicate`);
    }
    seenPair.add(where);
    npcSeen.add(def.npcKey);

    if (!Number.isInteger(def.cost) || def.cost <= 0) {
      errs.push(`Shop ${where} cost ${def.cost} must be positive integer`);
    }

    // Stock type ⇔ limit fields.
    if (def.stockType === 'daily') {
      if (
        typeof def.dailyLimit !== 'number' ||
        !Number.isInteger(def.dailyLimit) ||
        def.dailyLimit < 1 ||
        def.dailyLimit > 30
      ) {
        errs.push(
          `Shop ${where} stockType=daily requires dailyLimit ∈ [1,30], got ${def.dailyLimit}`,
        );
      }
      if (def.weeklyLimit !== undefined) {
        errs.push(`Shop ${where} stockType=daily must NOT set weeklyLimit`);
      }
      if (typeof def.dailyLimit === 'number') {
        dailySumByNpc.set(
          def.npcKey,
          (dailySumByNpc.get(def.npcKey) ?? 0) + def.dailyLimit,
        );
      }
    } else if (def.stockType === 'weekly') {
      if (
        typeof def.weeklyLimit !== 'number' ||
        !Number.isInteger(def.weeklyLimit) ||
        def.weeklyLimit < 1 ||
        def.weeklyLimit > 50
      ) {
        errs.push(
          `Shop ${where} stockType=weekly requires weeklyLimit ∈ [1,50], got ${def.weeklyLimit}`,
        );
      }
      if (def.dailyLimit !== undefined) {
        errs.push(`Shop ${where} stockType=weekly must NOT set dailyLimit`);
      }
    } else if (def.stockType === 'unlimited') {
      if (def.dailyLimit !== undefined || def.weeklyLimit !== undefined) {
        errs.push(`Shop ${where} stockType=unlimited must NOT set daily/weekly limit`);
      }
    } else {
      errs.push(`Shop ${where} unknown stockType ${String(def.stockType)}`);
    }

    if (def.unlockHint.trim().length === 0) {
      errs.push(`Shop ${where} empty unlockHint`);
    }
    if (def.unlockHintEn.trim().length === 0) {
      errs.push(`Shop ${where} empty unlockHintEn`);
    }

    // Cost cap theo tier (ECONOMY_MODEL).
    let costCap = Infinity;
    if (def.requiredAffinityTier === 'xa_la' || def.requiredAffinityTier === 'quen_biet') {
      costCap = 250;
    } else if (def.requiredAffinityTier === 'ban_huu') {
      costCap = 1500;
    } else if (
      def.requiredAffinityTier === 'tri_giao' ||
      def.requiredAffinityTier === 'tri_ky'
    ) {
      costCap = 2500;
    }
    if (def.cost > costCap) {
      errs.push(
        `Shop ${where} cost ${def.cost} > tier ${def.requiredAffinityTier} cap ${costCap}`,
      );
    }
  }

  // Coverage: mọi NPC trong NPC_AFFINITY có ≥ 1 entry.
  for (const a of NPC_AFFINITY) {
    if (!npcSeen.has(a.npcKey)) {
      errs.push(`Shop catalog missing entries for NPC ${a.npcKey}`);
    }
  }

  // Anti-grind: tổng dailyLimit per-NPC ≤ 30.
  for (const [npcKey, total] of dailySumByNpc.entries()) {
    if (total > 30) {
      errs.push(`Shop NPC ${npcKey} total dailyLimit ${total} > 30 (anti-grind cap)`);
    }
  }

  return errs;
}
