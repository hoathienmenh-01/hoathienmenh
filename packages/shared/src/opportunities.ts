/**
 * Phase 26.5 — Opportunity Encounter (cơ duyên) trong farm map.
 *
 * Cơ duyên xuất hiện ngẫu nhiên khi farm — reward vừa phải (linh thạch
 * nhỏ, nguyên liệu thường, mảnh công thức, lore, NPC affinity).
 *
 * Anti-P2W rule (Phần 6 spec):
 *   - Cơ duyên KHÔNG rơi: pháp bảo top, công pháp chí tôn, đan endgame,
 *     nguyên liệu đột phá cao cấp số lượng lớn, tiên ngọc nhiều.
 *   - Daily cap: cơ duyên thường ≤ 5/ngày, hiếm ≤ 1/ngày hoặc weekly.
 *   - Premium KHÔNG bypass cap (server-side enforce).
 */
import type { RegionKey } from './map-regions';

// ───────────────────────────────────────────────────────────────────────────
// Rarity & RiskLevel
// ───────────────────────────────────────────────────────────────────────────

export type OpportunityRarity =
  | 'COMMON'
  | 'UNCOMMON'
  | 'RARE'
  | 'EPIC';

export const OPPORTUNITY_RARITIES: readonly OpportunityRarity[] = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
] as const;

export type OpportunityRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export const OPPORTUNITY_RISK_LEVELS: readonly OpportunityRiskLevel[] = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Reward / Choice
// ───────────────────────────────────────────────────────────────────────────

export interface OpportunityRewardItem {
  itemKey: string;
  qty: number;
}

export interface OpportunityRewardProfile {
  /** Linh thạch (luôn nhỏ — anti-P2W). */
  linhThach?: number;
  /** EXP. */
  exp?: number;
  /** Tiên ngọc — cấm cho COMMON/UNCOMMON, RARE ≤ 1, EPIC ≤ 3. */
  tienNgoc?: number;
  /** Items (qty thấp). */
  items?: readonly OpportunityRewardItem[];
  /** NPC affinity points (key, delta). */
  npcAffinityDelta?: readonly { npcKey: string; delta: number }[];
  /** Lore unlock key (optional). */
  loreKey?: string | null;
  /** Boss hint key (optional, gợi ý boss ẩn). */
  bossHintKey?: string | null;
}

export interface OpportunityChoice {
  key: string;
  labelVi: string;
  labelEn: string;
  /** Reward khi pick choice này (resolve khi resolve encounter). */
  reward: OpportunityRewardProfile;
  /** Risk: chance fail. Khi fail không nhận reward. */
  failChance?: number;
  riskLevel?: OpportunityRiskLevel;
}

// ───────────────────────────────────────────────────────────────────────────
// OpportunityEncounterDef
// ───────────────────────────────────────────────────────────────────────────

export interface OpportunityEncounterDef {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  regionKey: RegionKey;
  sourceTier: number;
  rarity: OpportunityRarity;
  /** Chance spawn mỗi farm tick. */
  triggerChance: number;
  /** Cap trigger / ngày (per character). */
  maxDailyTriggers: number;
  /** Cap trigger / tuần (per character) — dùng cho RARE/EPIC. */
  maxWeeklyTriggers?: number | null;
  /** Lựa chọn cho user. */
  choices: readonly OpportunityChoice[];
  /** Risk level cao nhất nếu auto-resolve. */
  riskLevel: OpportunityRiskLevel;
  enabled: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

export function getOpportunityByKey(key: string): OpportunityEncounterDef | undefined {
  return OPPORTUNITIES.find((o) => o.key === key);
}

export function getOpportunitiesByRegion(
  region: RegionKey,
): readonly OpportunityEncounterDef[] {
  return OPPORTUNITIES.filter((o) => o.regionKey === region);
}

export function getOpportunitiesByRarity(
  rarity: OpportunityRarity,
): readonly OpportunityEncounterDef[] {
  return OPPORTUNITIES.filter((o) => o.rarity === rarity);
}

/**
 * Daily cap cho từng rarity (anti-P2W). Server runtime sẽ tổng hợp qua
 * `DailyContentCap`.
 *
 *   COMMON   ≤ 5/ngày
 *   UNCOMMON ≤ 3/ngày
 *   RARE     ≤ 1/ngày (hoặc weekly)
 *   EPIC     ≤ 1/tuần
 */
export function getOpportunityRarityDailyCap(rarity: OpportunityRarity): {
  daily: number;
  weekly: number | null;
} {
  switch (rarity) {
    case 'COMMON':
      return { daily: 5, weekly: null };
    case 'UNCOMMON':
      return { daily: 3, weekly: null };
    case 'RARE':
      return { daily: 1, weekly: 5 };
    case 'EPIC':
      return { daily: 1, weekly: 1 };
  }
}

/**
 * Validate reward profile theo rarity (anti-P2W enforce ở catalog-time).
 *
 *   COMMON   tienNgoc=0, linhThach ≤ 100
 *   UNCOMMON tienNgoc=0, linhThach ≤ 250
 *   RARE     tienNgoc ≤ 1, linhThach ≤ 500
 *   EPIC     tienNgoc ≤ 3, linhThach ≤ 1000
 */
export function isRewardWithinRarityCap(
  rarity: OpportunityRarity,
  reward: OpportunityRewardProfile,
): boolean {
  const ng = reward.tienNgoc ?? 0;
  const ls = reward.linhThach ?? 0;
  switch (rarity) {
    case 'COMMON':
      return ng === 0 && ls <= 100;
    case 'UNCOMMON':
      return ng === 0 && ls <= 250;
    case 'RARE':
      return ng <= 1 && ls <= 500;
    case 'EPIC':
      return ng <= 3 && ls <= 1000;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — 6 cơ duyên (2 mỗi khu sâu)
// ───────────────────────────────────────────────────────────────────────────

export const OPPORTUNITIES: readonly OpportunityEncounterDef[] = [
  // ─── son_coc ───────────────────────────────────────────────────────────
  {
    key: 'son_coc_co_duyen_linh_thao',
    nameVi: 'Linh Thảo Cổ',
    nameEn: 'Ancient Spirit Herb',
    descriptionVi:
      'Phát hiện một cây linh thảo cổ trong cốc — hái thuận tay, hoặc nhường lại cho thiên nhiên.',
    descriptionEn:
      'A patch of ancient spirit herb in the valley — pluck it, or leave it to nature.',
    regionKey: 'son_coc',
    sourceTier: 1,
    rarity: 'COMMON',
    triggerChance: 0.08,
    maxDailyTriggers: 5,
    choices: [
      {
        key: 'pluck',
        labelVi: 'Hái về',
        labelEn: 'Pluck',
        reward: { linhThach: 30, items: [{ itemKey: 'linh_thao', qty: 1 }] },
      },
      {
        key: 'leave',
        labelVi: 'Nhường lại',
        labelEn: 'Leave',
        reward: { exp: 20 },
      },
    ],
    riskLevel: 'NONE',
    enabled: true,
  },
  {
    key: 'son_coc_co_duyen_van_co',
    nameVi: 'Vân Cờ Cổ Trận',
    nameEn: 'Cloud-Flag Ancient Array',
    descriptionVi:
      'Tàn tích trận cờ cổ — phá trận lấy mảnh công thức, hoặc cẩn thận quan sát học hỏi.',
    descriptionEn:
      'Ruins of an ancient flag array — break the array for recipe shards, or study it carefully.',
    regionKey: 'son_coc',
    sourceTier: 1,
    rarity: 'UNCOMMON',
    triggerChance: 0.04,
    maxDailyTriggers: 3,
    choices: [
      {
        key: 'break_array',
        labelVi: 'Phá trận lấy mảnh',
        labelEn: 'Break the array',
        reward: { linhThach: 80, exp: 60 },
        failChance: 0.15,
        riskLevel: 'LOW',
      },
      {
        key: 'study',
        labelVi: 'Quan sát học hỏi',
        labelEn: 'Study quietly',
        reward: { exp: 100 },
      },
    ],
    riskLevel: 'LOW',
    enabled: true,
  },

  // ─── hac_lam ───────────────────────────────────────────────────────────
  {
    key: 'hac_lam_co_duyen_yeu_ho',
    nameVi: 'Yêu Hồ Thiếu Niên',
    nameEn: 'Young Yao-Fox',
    descriptionVi:
      'Một con yêu hồ chưa thành hình đứng nhìn ngươi — chia sẻ một viên đan, hoặc ngó lơ.',
    descriptionEn:
      'A young yao-fox not yet matured eyes you — share a pill, or ignore it.',
    regionKey: 'hac_lam',
    sourceTier: 2,
    rarity: 'UNCOMMON',
    triggerChance: 0.05,
    maxDailyTriggers: 3,
    choices: [
      {
        key: 'share',
        labelVi: 'Chia sẻ một viên',
        labelEn: 'Share a pill',
        reward: { exp: 60, npcAffinityDelta: [{ npcKey: 'npc_yao_ho', delta: 5 }] },
      },
      {
        key: 'ignore',
        labelVi: 'Ngó lơ',
        labelEn: 'Ignore',
        reward: { linhThach: 30 },
      },
    ],
    riskLevel: 'NONE',
    enabled: true,
  },
  {
    key: 'hac_lam_co_duyen_thi_co_anh',
    nameVi: 'Bóng Thi Cổ',
    nameEn: 'Ancient Corpse Shadow',
    descriptionVi:
      'Bóng hồn cổ xưa hé lộ manh mối boss ẩn — tiếp cận để nhận manh mối, hoặc bỏ qua.',
    descriptionEn:
      'An ancient soul shadow hints at a hidden boss — approach for the hint, or pass.',
    regionKey: 'hac_lam',
    sourceTier: 2,
    rarity: 'RARE',
    triggerChance: 0.015,
    maxDailyTriggers: 1,
    maxWeeklyTriggers: 3,
    choices: [
      {
        key: 'approach',
        labelVi: 'Tiếp cận',
        labelEn: 'Approach',
        reward: {
          linhThach: 200,
          exp: 200,
          bossHintKey: 'hidden_hac_lam_thi_quy_de',
        },
        failChance: 0.25,
        riskLevel: 'MEDIUM',
      },
      {
        key: 'pass',
        labelVi: 'Bỏ qua',
        labelEn: 'Pass',
        reward: { exp: 40 },
      },
    ],
    riskLevel: 'MEDIUM',
    enabled: true,
  },

  // ─── kim_son_mach ──────────────────────────────────────────────────────
  {
    key: 'kim_son_co_duyen_kiem_phach',
    nameVi: 'Kiếm Phách Tàn',
    nameEn: 'Sword-Spirit Remnant',
    descriptionVi:
      'Một mảnh kiếm phách tàn lưu giữa kim sơn — hấp thụ luyện hoá, hoặc cất kỹ lưu niệm.',
    descriptionEn:
      'A sword-spirit remnant lingering in the golden mountain — absorb it, or preserve it.',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    rarity: 'RARE',
    triggerChance: 0.02,
    maxDailyTriggers: 1,
    maxWeeklyTriggers: 4,
    choices: [
      {
        key: 'absorb',
        labelVi: 'Hấp thụ',
        labelEn: 'Absorb',
        reward: { linhThach: 250, exp: 300 },
        failChance: 0.1,
        riskLevel: 'LOW',
      },
      {
        key: 'preserve',
        labelVi: 'Lưu niệm',
        labelEn: 'Preserve',
        reward: { linhThach: 100, loreKey: 'lore_kim_son_kiem_phach' },
      },
    ],
    riskLevel: 'LOW',
    enabled: true,
  },
  {
    key: 'kim_son_co_duyen_huyen_kim',
    nameVi: 'Mạch Huyền Kim Ẩn',
    nameEn: 'Hidden Mystic-Gold Vein',
    descriptionVi:
      'Mạch quặng huyền kim ẩn dưới đáy hồ — khai thác nguy hiểm, hoặc đánh dấu báo về tông môn.',
    descriptionEn:
      'A hidden mystic-gold ore vein under the lake — risky to mine, or mark it for the sect.',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    rarity: 'EPIC',
    triggerChance: 0.005,
    maxDailyTriggers: 1,
    maxWeeklyTriggers: 1,
    choices: [
      {
        key: 'mine',
        labelVi: 'Khai thác',
        labelEn: 'Mine',
        reward: { linhThach: 600, tienNgoc: 2, exp: 600, items: [{ itemKey: 'tinh_thiet', qty: 3 }] },
        failChance: 0.3,
        riskLevel: 'HIGH',
      },
      {
        key: 'mark',
        labelVi: 'Đánh dấu báo về tông môn',
        labelEn: 'Mark for sect',
        reward: { linhThach: 200, exp: 200 },
      },
    ],
    riskLevel: 'HIGH',
    enabled: true,
  },
];
