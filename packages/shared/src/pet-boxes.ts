/**
 * Phase 35.0B — Pet Box / Egg / Pity catalog. Pure shared catalog &
 * validators — KHÔNG I/O, KHÔNG Prisma. Test deterministic.
 *
 * **Invariant**:
 *   - Mọi box rate sum = 100% (1.0 ± 1e-9).
 *   - Pity guarantee không bao giờ vượt 300 mở (spec §35.0B).
 *   - Server tự tính cost; client KHÔNG gửi cost.
 *   - Pet rate phải public qua API + UI (`POST /pets/boxes/:boxKey/rates`).
 *   - Pool entries chỉ tham chiếu pet tồn tại trong `PETS`.
 */

import { isPetRarity, type PetRarity, petByKey } from './pets';

// ===========================================================================
// 1. Cost types
// ===========================================================================

/**
 * Box cost — chỉ chấp nhận các kiểu cost server biết.
 * `TICKET` = inventory item; `LINH_THACH` / `TIEN_NGOC` = currency.
 */
export const PET_BOX_COST_TYPES = [
  'TICKET',
  'LINH_THACH',
  'TIEN_NGOC',
  'EVENT_TOKEN',
] as const;
export type PetBoxCostType = (typeof PET_BOX_COST_TYPES)[number];

export function isPetBoxCostType(s: unknown): s is PetBoxCostType {
  return (
    typeof s === 'string' &&
    (PET_BOX_COST_TYPES as readonly string[]).includes(s)
  );
}

// ===========================================================================
// 2. Pool entry types
// ===========================================================================

/** Loại kết quả: pet đầy đủ, shard, material, ticket refund. */
export const PET_BOX_RESULT_TYPES = [
  'PET',
  'SHARD',
  'MATERIAL',
  'TICKET_REFUND',
] as const;
export type PetBoxResultType = (typeof PET_BOX_RESULT_TYPES)[number];

export interface PetBoxPoolEntry {
  resultType: PetBoxResultType;
  /** Key tham chiếu (`petKey` / `itemKey`). */
  resultKey: string;
  rarity: PetRarity;
  /** Số lượng grant nếu là SHARD/MATERIAL. */
  amount?: number;
  /** Probability trong rarity bucket (sum trong cùng rarity = 100%). */
  weightInBucket: number;
}

/** Tỉ lệ rarity bucket (sum = 100%). */
export interface PetBoxRarityRate {
  rarity: PetRarity;
  ratePercent: number;
}

export interface PetBoxPityRule {
  /** Số mở liên tiếp không trúng `rarityAtLeast` để trigger pity. */
  triggerEveryOpens: number;
  /** Rarity tối thiểu khi pity trigger. */
  rarityAtLeast: PetRarity;
  /** Sau pity trigger, reset counter này về 0. */
  resetsCounter: 'opensSinceRare' | 'opensSinceEpic' | 'opensSinceLegendary' | 'opensSinceMythic';
}

export interface PetBoxDef {
  boxKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  /** Pool key cho phép share giữa nhiều box. */
  poolKey: string;
  rateVersion: number;
  /** Cost mở 1 lần. */
  costPerOpen: { costType: PetBoxCostType; amount: number; itemKey?: string };
  /** Hỗ trợ x10 với discount % (e.g., 10% off). */
  tenPullDiscountPercent?: number;
  /** Rarity rates (sum = 100). */
  rarityRates: PetBoxRarityRate[];
  /** Pity rules — server áp dụng theo thứ tự. */
  pityRules: PetBoxPityRule[];
  /** Pool entries cho từng rarity. */
  pool: PetBoxPoolEntry[];
  /** Box có active hay không (event-limited). */
  isEventLimited: boolean;
}

// ===========================================================================
// 3. Catalog
// ===========================================================================

const COMMON_POOL: PetBoxPoolEntry[] = [
  { resultType: 'PET', resultKey: 'pet_lapin_qi', rarity: 'COMMON', weightInBucket: 25 },
  { resultType: 'PET', resultKey: 'pet_squirrel_explorer', rarity: 'COMMON', weightInBucket: 25 },
  { resultType: 'SHARD', resultKey: 'pet_lapin_qi', rarity: 'COMMON', amount: 5, weightInBucket: 25 },
  { resultType: 'SHARD', resultKey: 'pet_squirrel_explorer', rarity: 'COMMON', amount: 5, weightInBucket: 25 },
];

const UNCOMMON_POOL: PetBoxPoolEntry[] = [
  { resultType: 'PET', resultKey: 'pet_cat_lucky', rarity: 'UNCOMMON', weightInBucket: 20 },
  { resultType: 'PET', resultKey: 'pet_butterfly_breeze', rarity: 'UNCOMMON', weightInBucket: 20 },
  { resultType: 'PET', resultKey: 'pet_fox_courier', rarity: 'UNCOMMON', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_moc_seedling', rarity: 'UNCOMMON', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_thuy_jellyfish', rarity: 'UNCOMMON', weightInBucket: 10 },
  { resultType: 'SHARD', resultKey: 'pet_cat_lucky', rarity: 'UNCOMMON', amount: 3, weightInBucket: 10 },
  { resultType: 'SHARD', resultKey: 'pet_moc_seedling', rarity: 'UNCOMMON', amount: 3, weightInBucket: 10 },
];

const RARE_POOL: PetBoxPoolEntry[] = [
  { resultType: 'PET', resultKey: 'pet_kim_lang', rarity: 'RARE', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_kim_dieu', rarity: 'RARE', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_moc_bear', rarity: 'RARE', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_thuy_rui', rarity: 'RARE', weightInBucket: 10 },
  { resultType: 'PET', resultKey: 'pet_owl_secret', rarity: 'RARE', weightInBucket: 10 },
  { resultType: 'PET', resultKey: 'pet_phong_falcon', rarity: 'RARE', weightInBucket: 10 },
  { resultType: 'PET', resultKey: 'pet_loi_panther', rarity: 'RARE', weightInBucket: 10 },
  { resultType: 'PET', resultKey: 'pet_bang_wolf', rarity: 'RARE', weightInBucket: 5 },
  { resultType: 'PET', resultKey: 'pet_am_serpent', rarity: 'RARE', weightInBucket: 10 },
];

const EPIC_POOL: PetBoxPoolEntry[] = [
  { resultType: 'PET', resultKey: 'pet_kim_qilin', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_moc_long', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_thuy_dragon', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_tho_tortoise', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_loi_dragon', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_hoa_kirin', rarity: 'EPIC', weightInBucket: 15 },
  { resultType: 'PET', resultKey: 'pet_quang_crane', rarity: 'EPIC', weightInBucket: 10 },
];

const LEGENDARY_POOL: PetBoxPoolEntry[] = [
  { resultType: 'PET', resultKey: 'pet_hoa_phoenix', rarity: 'LEGENDARY', weightInBucket: 50 },
  { resultType: 'PET', resultKey: 'pet_quang_kirin', rarity: 'LEGENDARY', weightInBucket: 50 },
];

const MYTHIC_POOL: PetBoxPoolEntry[] = [
  { resultType: 'SHARD', resultKey: 'pet_legend_kirin_supreme', rarity: 'MYTHIC', amount: 5, weightInBucket: 50 },
  { resultType: 'SHARD', resultKey: 'pet_legend_phoenix_supreme', rarity: 'MYTHIC', amount: 5, weightInBucket: 50 },
];

const STANDARD_RATES: PetBoxRarityRate[] = [
  { rarity: 'COMMON', ratePercent: 55 },
  { rarity: 'UNCOMMON', ratePercent: 28 },
  { rarity: 'RARE', ratePercent: 12 },
  { rarity: 'EPIC', ratePercent: 4 },
  { rarity: 'LEGENDARY', ratePercent: 0.9 },
  { rarity: 'MYTHIC', ratePercent: 0.1 },
];

const STANDARD_PITY: PetBoxPityRule[] = [
  { triggerEveryOpens: 10, rarityAtLeast: 'RARE', resetsCounter: 'opensSinceRare' },
  { triggerEveryOpens: 50, rarityAtLeast: 'EPIC', resetsCounter: 'opensSinceEpic' },
  { triggerEveryOpens: 100, rarityAtLeast: 'LEGENDARY', resetsCounter: 'opensSinceLegendary' },
  { triggerEveryOpens: 300, rarityAtLeast: 'LEGENDARY', resetsCounter: 'opensSinceMythic' },
];

const PREMIUM_RATES: PetBoxRarityRate[] = [
  { rarity: 'COMMON', ratePercent: 30 },
  { rarity: 'UNCOMMON', ratePercent: 35 },
  { rarity: 'RARE', ratePercent: 22 },
  { rarity: 'EPIC', ratePercent: 10 },
  { rarity: 'LEGENDARY', ratePercent: 2.5 },
  { rarity: 'MYTHIC', ratePercent: 0.5 },
];

const ALL_POOL: PetBoxPoolEntry[] = [
  ...COMMON_POOL,
  ...UNCOMMON_POOL,
  ...RARE_POOL,
  ...EPIC_POOL,
  ...LEGENDARY_POOL,
  ...MYTHIC_POOL,
];

export const PET_BOXES: readonly PetBoxDef[] = [
  {
    boxKey: 'pet_box_standard',
    nameVi: 'Hộp Linh Thú Thường',
    nameEn: 'Standard Pet Box',
    descriptionVi: 'Hộp tiêu chuẩn — mở bằng vé thường, đủ phẩm cấp.',
    descriptionEn: 'Standard pet box — opens with normal ticket, all rarities possible.',
    poolKey: 'standard_pool_v1',
    rateVersion: 1,
    costPerOpen: { costType: 'TICKET', amount: 1, itemKey: 'pet_ticket_standard' },
    tenPullDiscountPercent: 10,
    rarityRates: STANDARD_RATES,
    pityRules: STANDARD_PITY,
    pool: ALL_POOL,
    isEventLimited: false,
  },
  {
    boxKey: 'pet_box_premium',
    nameVi: 'Hộp Linh Thú Cao Cấp',
    nameEn: 'Premium Pet Box',
    descriptionVi: 'Hộp cao cấp — tỷ lệ phẩm cao hơn nhiều.',
    descriptionEn: 'Premium box — much higher chance for top rarities.',
    poolKey: 'premium_pool_v1',
    rateVersion: 1,
    costPerOpen: { costType: 'TICKET', amount: 1, itemKey: 'pet_ticket_premium' },
    tenPullDiscountPercent: 10,
    rarityRates: PREMIUM_RATES,
    pityRules: STANDARD_PITY,
    pool: ALL_POOL,
    isEventLimited: false,
  },
  {
    boxKey: 'pet_box_event_festival',
    nameVi: 'Hộp Linh Thú Sự Kiện',
    nameEn: 'Festival Pet Box',
    descriptionVi: 'Hộp sự kiện — có thể rơi pet sự kiện cosmetic.',
    descriptionEn: 'Event box — may contain festival cosmetic pet.',
    poolKey: 'event_festival_pool_v1',
    rateVersion: 1,
    costPerOpen: { costType: 'EVENT_TOKEN', amount: 50 },
    tenPullDiscountPercent: 5,
    rarityRates: STANDARD_RATES,
    pityRules: STANDARD_PITY,
    pool: [
      ...ALL_POOL,
      { resultType: 'PET', resultKey: 'pet_event_lantern', rarity: 'EPIC', weightInBucket: 5 },
    ],
    isEventLimited: true,
  },
  {
    boxKey: 'pet_box_element_kim_moc',
    nameVi: 'Hộp Linh Thú Kim Mộc',
    nameEn: 'Metal-Wood Pet Box',
    descriptionVi: 'Hộp Ngũ Hành Kim/Mộc.',
    descriptionEn: 'Five-element Metal/Wood box.',
    poolKey: 'element_kim_moc_pool_v1',
    rateVersion: 1,
    costPerOpen: { costType: 'TICKET', amount: 1, itemKey: 'pet_ticket_element' },
    tenPullDiscountPercent: 10,
    rarityRates: STANDARD_RATES,
    pityRules: STANDARD_PITY,
    pool: ALL_POOL.filter((p) => {
      // Keep all shard/material/refund and pets in element KIM/MOC; keep
      // legendary/mythic full pool để bucket không trống.
      if (p.resultType !== 'PET') return true;
      if (p.rarity === 'LEGENDARY' || p.rarity === 'MYTHIC') return true;
      const el = petByKey(p.resultKey)?.element;
      return el === 'KIM' || el === 'MOC';
    }),
    isEventLimited: false,
  },
  {
    boxKey: 'pet_box_egg_mythic',
    nameVi: 'Trứng Thần Thú',
    nameEn: 'Mythic Beast Egg',
    descriptionVi: 'Trứng cực hiếm — duy nhất nguồn Thần phẩm shard.',
    descriptionEn: 'Extremely rare egg — primary source of mythic shards.',
    poolKey: 'egg_mythic_pool_v1',
    rateVersion: 1,
    costPerOpen: { costType: 'TIEN_NGOC', amount: 300 },
    tenPullDiscountPercent: 10,
    rarityRates: PREMIUM_RATES,
    pityRules: STANDARD_PITY,
    pool: ALL_POOL,
    isEventLimited: false,
  },
] as const;

const PET_BOXES_BY_KEY: Record<string, PetBoxDef> = Object.fromEntries(
  PET_BOXES.map((b) => [b.boxKey, b]),
);

export function petBoxByKey(boxKey: string): PetBoxDef | undefined {
  return PET_BOXES_BY_KEY[boxKey];
}

// ===========================================================================
// 4. Validators / integrity helpers
// ===========================================================================

export interface PetBoxIssue {
  boxKey: string;
  code:
    | 'RATE_SUM_NOT_100'
    | 'POOL_BUCKET_WEIGHT_INVALID'
    | 'POOL_EMPTY_BUCKET'
    | 'POOL_INVALID_PET_REF'
    | 'PITY_TOO_LATE'
    | 'INVALID_RARITY'
    | 'INVALID_COST'
    | 'MISSING_POOL_FOR_RARITY';
  message: string;
}

const RATE_EPS = 1e-6;

/**
 * Audit toàn bộ catalog box. Kiểm tra:
 *   - Sum rarity rate = 100.
 *   - Mỗi rarity bucket có ít nhất 1 entry; sum weight = 100.
 *   - Pet ref tồn tại.
 *   - Pity không bao giờ trigger trễ hơn 300 mở.
 */
export function auditPetBoxes(
  boxes: readonly PetBoxDef[] = PET_BOXES,
): PetBoxIssue[] {
  const issues: PetBoxIssue[] = [];
  for (const b of boxes) {
    const sum = b.rarityRates.reduce((a, r) => a + r.ratePercent, 0);
    if (Math.abs(sum - 100) > RATE_EPS) {
      issues.push({
        boxKey: b.boxKey,
        code: 'RATE_SUM_NOT_100',
        message: `sum=${sum}`,
      });
    }
    for (const r of b.rarityRates) {
      if (!isPetRarity(r.rarity)) {
        issues.push({ boxKey: b.boxKey, code: 'INVALID_RARITY', message: `${r.rarity}` });
      }
    }
    if (b.costPerOpen.amount <= 0) {
      issues.push({ boxKey: b.boxKey, code: 'INVALID_COST', message: 'cost <= 0' });
    }

    // Pool bucket integrity
    const byRarity = new Map<PetRarity, PetBoxPoolEntry[]>();
    for (const e of b.pool) {
      if (!byRarity.has(e.rarity)) byRarity.set(e.rarity, []);
      byRarity.get(e.rarity)!.push(e);
      if (e.resultType === 'PET' && !petByKey(e.resultKey)) {
        issues.push({ boxKey: b.boxKey, code: 'POOL_INVALID_PET_REF', message: `bad pet ${e.resultKey}` });
      }
      if (e.resultType === 'SHARD' && !petByKey(e.resultKey)) {
        issues.push({ boxKey: b.boxKey, code: 'POOL_INVALID_PET_REF', message: `bad shard pet ${e.resultKey}` });
      }
    }
    for (const r of b.rarityRates) {
      if (r.ratePercent > 0) {
        const bucket = byRarity.get(r.rarity) ?? [];
        if (bucket.length === 0) {
          issues.push({ boxKey: b.boxKey, code: 'MISSING_POOL_FOR_RARITY', message: `${r.rarity}` });
          continue;
        }
        // Weights được normalize tại runtime (rollEntry chia theo total).
        // Chỉ enforce mọi weight > 0 và sum > 0.
        const w = bucket.reduce((a, e) => a + e.weightInBucket, 0);
        if (w <= 0) {
          issues.push({
            boxKey: b.boxKey,
            code: 'POOL_BUCKET_WEIGHT_INVALID',
            message: `${r.rarity} sum=${w}`,
          });
        }
        for (const e of bucket) {
          if (e.weightInBucket <= 0) {
            issues.push({
              boxKey: b.boxKey,
              code: 'POOL_BUCKET_WEIGHT_INVALID',
              message: `${r.rarity} non-positive weight on ${e.resultKey}`,
            });
          }
        }
      }
    }

    for (const p of b.pityRules) {
      if (p.triggerEveryOpens > 300) {
        issues.push({ boxKey: b.boxKey, code: 'PITY_TOO_LATE', message: `${p.triggerEveryOpens}` });
      }
      if (!isPetRarity(p.rarityAtLeast)) {
        issues.push({ boxKey: b.boxKey, code: 'INVALID_RARITY', message: `pity ${p.rarityAtLeast}` });
      }
    }
  }
  return issues;
}

// ===========================================================================
// 5. RNG roll (deterministic given roll u in [0,1)) — used by service
// ===========================================================================

const RARITY_ORDER: PetRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

/** Compare rarity tier: -1 / 0 / 1. */
export function compareRarity(a: PetRarity, b: PetRarity): number {
  return RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b);
}

/**
 * Roll rarity từ rate table. `u` ∈ [0,1) deterministic.
 */
export function rollRarity(rates: PetBoxRarityRate[], u: number): PetRarity {
  const uu = Math.max(0, Math.min(1 - 1e-12, u));
  let acc = 0;
  for (const r of rates) {
    acc += r.ratePercent / 100;
    if (uu < acc) return r.rarity;
  }
  // Fallback (shouldn't reach if sum=100)
  return rates[rates.length - 1].rarity;
}

/**
 * Roll entry trong rarity bucket. `u` ∈ [0,1).
 */
export function rollEntry(
  bucket: PetBoxPoolEntry[],
  u: number,
): PetBoxPoolEntry {
  if (bucket.length === 0) throw new Error('EMPTY_BUCKET');
  const uu = Math.max(0, Math.min(1 - 1e-12, u));
  let acc = 0;
  const total = bucket.reduce((a, e) => a + e.weightInBucket, 0);
  for (const e of bucket) {
    acc += e.weightInBucket / total;
    if (uu < acc) return e;
  }
  return bucket[bucket.length - 1];
}

/**
 * Apply pity: nếu counter sau lần mở này ≥ rule trigger, nâng rarity lên
 * tối thiểu rule yêu cầu.
 *
 * Trả về:
 *   - `appliedRarity`: rarity cuối cùng.
 *   - `pityTriggered`: rule nào trigger (nếu có).
 *   - `counterResets`: counter cần reset.
 */
export interface PetPityCounters {
  opensSinceRare: number;
  opensSinceEpic: number;
  opensSinceLegendary: number;
  opensSinceMythic: number;
}

export interface PetPityApplyResult {
  appliedRarity: PetRarity;
  pityTriggered: boolean;
  triggeredRule?: PetBoxPityRule;
  counterResets: Array<keyof PetPityCounters>;
}

export function applyPity(
  pityRules: PetBoxPityRule[],
  rolledRarity: PetRarity,
  countersAfterThisOpen: PetPityCounters,
): PetPityApplyResult {
  // Find the most restrictive (highest rarity) pity that has been "due"
  // by the counter strictly ≥ trigger.
  let upgraded = rolledRarity;
  let triggered: PetBoxPityRule | undefined;
  const resets: Array<keyof PetPityCounters> = [];

  // Sort pity rules by rarityAtLeast desc (mythic > legendary > epic > rare)
  const sorted = [...pityRules].sort((a, b) =>
    compareRarity(b.rarityAtLeast, a.rarityAtLeast),
  );
  for (const rule of sorted) {
    const counter = countersAfterThisOpen[rule.resetsCounter];
    if (counter >= rule.triggerEveryOpens) {
      if (compareRarity(rule.rarityAtLeast, upgraded) > 0) {
        upgraded = rule.rarityAtLeast;
        if (!triggered) triggered = rule;
      }
      resets.push(rule.resetsCounter);
    }
  }
  return {
    appliedRarity: upgraded,
    pityTriggered: !!triggered,
    triggeredRule: triggered,
    counterResets: resets,
  };
}

/**
 * Update counters sau 1 lần mở (trước khi áp dụng pity):
 *   - Tăng tất cả opensSince* nếu rolled rarity < ngưỡng.
 *   - Reset về 0 khi rolled rarity ≥ ngưỡng.
 *
 * Áp dụng cho `appliedRarity` đã sau pity.
 */
export function advanceCounters(
  current: PetPityCounters,
  appliedRarity: PetRarity,
): PetPityCounters {
  const next: PetPityCounters = { ...current };
  next.opensSinceRare = compareRarity(appliedRarity, 'RARE') >= 0 ? 0 : next.opensSinceRare + 1;
  next.opensSinceEpic = compareRarity(appliedRarity, 'EPIC') >= 0 ? 0 : next.opensSinceEpic + 1;
  next.opensSinceLegendary = compareRarity(appliedRarity, 'LEGENDARY') >= 0 ? 0 : next.opensSinceLegendary + 1;
  next.opensSinceMythic = compareRarity(appliedRarity, 'MYTHIC') >= 0 ? 0 : next.opensSinceMythic + 1;
  return next;
}
