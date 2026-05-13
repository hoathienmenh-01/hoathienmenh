/**
 * Phase 26.5 — Trial Tower (Đăng Tiên Tháp / Linh Khí Tháp / Huyết Thể Tháp).
 *
 * **Vô hạn theo formula** — không hard-code 10.000 tầng. Pure catalog +
 * floor formula:
 *
 *   floorPower(floor) = basePower * powerMultiplierByFloor(floor)
 *
 *   floorEnemyType(floor):
 *     - chia hết 1000 → DAI_MOC_SERVER
 *     - chia hết 500  → DAI_KIEP_NAN
 *     - chia hết 100  → CHECKPOINT_BOSS
 *     - chia hết 50   → MILESTONE_BOSS
 *     - chia hết 10   → ELITE_GUARDIAN
 *     - mặc định      → NORMAL_GUARDIAN
 *
 *   floorReward(floor) — chỉ first-clear-only cho normal/elite, milestone
 *   reward chỉ 1 lần / floor / character.
 *
 * Service runtime (cụm API) sẽ sinh `TrialTowerAttemptLog` + grant reward
 * theo `TrialTowerProgress` (Prisma).
 *
 * Anti-P2W:
 *   - First-clear reward unique per (character, tower, floor).
 *   - Milestone reward unique per (character, tower, milestone).
 *   - Repeat reward = 0 (đánh lại để leo cao hơn, không farm).
 *   - Ranking reward weekly/season có cap.
 */

// ───────────────────────────────────────────────────────────────────────────
// TrialTowerType
// ───────────────────────────────────────────────────────────────────────────

export type TrialTowerType =
  | 'DANG_TIEN_THAP'  // sức mạnh tổng thể
  | 'LINH_KHI_THAP'   // Luyện Khí + công pháp
  | 'HUYET_THE_THAP'  // Luyện Thể
  | 'NGU_HANH_THAP'; // Ngũ hành (foundation phase sau)

export const TRIAL_TOWER_TYPES: readonly TrialTowerType[] = [
  'DANG_TIEN_THAP',
  'LINH_KHI_THAP',
  'HUYET_THE_THAP',
  'NGU_HANH_THAP',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// FloorEnemyType
// ───────────────────────────────────────────────────────────────────────────

export type FloorEnemyType =
  | 'NORMAL_GUARDIAN'
  | 'ELITE_GUARDIAN'
  | 'MILESTONE_BOSS'
  | 'CHECKPOINT_BOSS'
  | 'DAI_KIEP_NAN'
  | 'DAI_MOC_SERVER';

export const FLOOR_ENEMY_TYPES: readonly FloorEnemyType[] = [
  'NORMAL_GUARDIAN',
  'ELITE_GUARDIAN',
  'MILESTONE_BOSS',
  'CHECKPOINT_BOSS',
  'DAI_KIEP_NAN',
  'DAI_MOC_SERVER',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// MilestoneRule + RewardProfile
// ───────────────────────────────────────────────────────────────────────────

export interface TrialTowerMilestoneRule {
  /** Khoảng tầng để mốc kích hoạt (mod). */
  everyFloors: number;
  /** Floor power multiplier khi gặp mốc. */
  powerMultiplier: number;
  /** Loại enemy (tham chiếu FloorEnemyType). */
  enemyType: FloorEnemyType;
  /** Reward profile cho mốc. */
  reward: TrialTowerFloorReward;
  labelVi: string;
  labelEn: string;
}

export interface TrialTowerFloorReward {
  linhThach: number;
  exp: number;
  tienNgoc?: number;
  /** Điểm tháp (TrialPoint). */
  trialPoints: number;
  /** Item drop (key, qty). */
  items?: readonly { itemKey: string; qty: number }[];
}

export interface TrialTowerFloorFormula {
  basePower: number;
  /**
   * Power tăng tuyến tính / hàm mũ. Implementation cố định —
   * powerMultiplierByFloor(floor) = (1 + floor * linearStep) * pow(expBase, floor / expDivisor).
   */
  linearStep: number;
  expBase: number;
  expDivisor: number;
}

export interface TrialTowerRankingSeason {
  /** Số ngày / season. */
  durationDays: number;
  /** Reward weekly. */
  weeklyTop1: TrialTowerFloorReward;
  weeklyTop10: TrialTowerFloorReward;
  /** Reward season cuối. */
  seasonTop1: TrialTowerFloorReward;
  seasonTop10: TrialTowerFloorReward;
}

// ───────────────────────────────────────────────────────────────────────────
// TrialTowerDef
// ───────────────────────────────────────────────────────────────────────────

export interface TrialTowerDef {
  key: string;
  towerType: TrialTowerType;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  unlockRealmOrder: number;
  /** Tầng tối đa formula được phép sinh. null = vô hạn. */
  maxGeneratedFloor?: number | null;
  infiniteScaling: boolean;
  floorFormula: TrialTowerFloorFormula;
  /** Tỉ lệ stat weight (Luyện Khí / Luyện Thể / trang bị / công pháp / pháp bảo). */
  statWeights: {
    qi: number;
    body: number;
    equipment: number;
    method: number;
    artifact: number;
  };
  milestoneRules: readonly TrialTowerMilestoneRule[];
  rankingSeason: TrialTowerRankingSeason;
  /** Normal floor reward (cho first-clear). */
  normalFloorReward: TrialTowerFloorReward;
  /** Elite floor reward (mỗi 10 tầng). */
  eliteFloorReward: TrialTowerFloorReward;
  /** Daily attempts cap (per character). */
  dailyAttempts: number;
  enabled: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

export function getTrialTowerByKey(key: string): TrialTowerDef | undefined {
  return TRIAL_TOWERS.find((t) => t.key === key);
}

export function getTrialTowersByType(type: TrialTowerType): readonly TrialTowerDef[] {
  return TRIAL_TOWERS.filter((t) => t.towerType === type);
}

/**
 * Resolve enemy type cho 1 floor cụ thể — chia hết 1000 → DAI_MOC_SERVER,
 * 500 → DAI_KIEP_NAN, 100 → CHECKPOINT_BOSS, 50 → MILESTONE_BOSS,
 * 10 → ELITE_GUARDIAN, mặc định NORMAL_GUARDIAN.
 */
export function resolveFloorEnemyType(floor: number): FloorEnemyType {
  if (floor <= 0) return 'NORMAL_GUARDIAN';
  if (floor % 1000 === 0) return 'DAI_MOC_SERVER';
  if (floor % 500 === 0) return 'DAI_KIEP_NAN';
  if (floor % 100 === 0) return 'CHECKPOINT_BOSS';
  if (floor % 50 === 0) return 'MILESTONE_BOSS';
  if (floor % 10 === 0) return 'ELITE_GUARDIAN';
  return 'NORMAL_GUARDIAN';
}

/**
 * Resolve multiplier theo enemy type.
 *
 *   normal           x1.00
 *   chia hết 10      x1.25
 *   chia hết 50      x1.75
 *   chia hết 100     x2.50
 *   chia hết 500     x4.00
 *   chia hết 1000    x6.00
 */
export function resolveFloorPowerMultiplier(floor: number): number {
  switch (resolveFloorEnemyType(floor)) {
    case 'DAI_MOC_SERVER':
      return 6.0;
    case 'DAI_KIEP_NAN':
      return 4.0;
    case 'CHECKPOINT_BOSS':
      return 2.5;
    case 'MILESTONE_BOSS':
      return 1.75;
    case 'ELITE_GUARDIAN':
      return 1.25;
    default:
      return 1.0;
  }
}

/**
 * Power required cho 1 floor.
 */
export function computeFloorPower(tower: TrialTowerDef, floor: number): number {
  const { basePower, linearStep, expBase, expDivisor } = tower.floorFormula;
  const linear = 1 + Math.max(0, floor) * linearStep;
  const exponential = Math.pow(expBase, Math.max(0, floor) / expDivisor);
  return Math.round(basePower * linear * exponential * resolveFloorPowerMultiplier(floor));
}

/**
 * Reward cho first-clear 1 floor (linear scaling).
 */
export function computeFloorFirstClearReward(
  tower: TrialTowerDef,
  floor: number,
): TrialTowerFloorReward {
  const enemy = resolveFloorEnemyType(floor);
  if (enemy === 'NORMAL_GUARDIAN') return tower.normalFloorReward;
  if (enemy === 'ELITE_GUARDIAN') return tower.eliteFloorReward;
  // Milestone — match rule
  const rule = tower.milestoneRules.find((r) => floor % r.everyFloors === 0);
  return rule?.reward ?? tower.eliteFloorReward;
}

/**
 * Repeat reward khi đánh lại tầng đã first-cleared. Anti-P2W: 0 reward.
 */
export function computeFloorRepeatReward(): TrialTowerFloorReward {
  return { linhThach: 0, exp: 0, trialPoints: 0 };
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — 3 trial tower theo spec (DANG_TIEN_THAP / LINH_KHI_THAP / HUYET_THE_THAP)
// ───────────────────────────────────────────────────────────────────────────

const SHARED_MILESTONE_RULES: readonly TrialTowerMilestoneRule[] = [
  {
    everyFloors: 1000,
    powerMultiplier: 6.0,
    enemyType: 'DAI_MOC_SERVER',
    reward: { linhThach: 100000, tienNgoc: 200, exp: 100000, trialPoints: 10000 },
    labelVi: 'Đại mốc server',
    labelEn: 'Server Grand Milestone',
  },
  {
    everyFloors: 500,
    powerMultiplier: 4.0,
    enemyType: 'DAI_KIEP_NAN',
    reward: { linhThach: 30000, tienNgoc: 50, exp: 30000, trialPoints: 3000 },
    labelVi: 'Đại kiếp nạn',
    labelEn: 'Great Tribulation',
  },
  {
    everyFloors: 100,
    powerMultiplier: 2.5,
    enemyType: 'CHECKPOINT_BOSS',
    reward: { linhThach: 8000, tienNgoc: 10, exp: 8000, trialPoints: 800 },
    labelVi: 'Mốc cảnh giới',
    labelEn: 'Realm Checkpoint',
  },
  {
    everyFloors: 50,
    powerMultiplier: 1.75,
    enemyType: 'MILESTONE_BOSS',
    reward: { linhThach: 2500, tienNgoc: 3, exp: 2500, trialPoints: 250 },
    labelVi: 'Boss mốc 50',
    labelEn: 'Floor-50 Milestone',
  },
];

const SHARED_RANKING_SEASON: TrialTowerRankingSeason = {
  durationDays: 28,
  weeklyTop1: { linhThach: 5000, tienNgoc: 30, exp: 5000, trialPoints: 1000 },
  weeklyTop10: { linhThach: 2500, tienNgoc: 15, exp: 2500, trialPoints: 500 },
  seasonTop1: { linhThach: 20000, tienNgoc: 200, exp: 20000, trialPoints: 5000 },
  seasonTop10: { linhThach: 10000, tienNgoc: 100, exp: 10000, trialPoints: 2500 },
};

export const TRIAL_TOWERS: readonly TrialTowerDef[] = [
  {
    key: 'dang_tien_thap',
    towerType: 'DANG_TIEN_THAP',
    nameVi: 'Đăng Tiên Tháp',
    nameEn: 'Ascend-Immortal Tower',
    descriptionVi:
      'Tháp tu tiên cổ — test sức mạnh tổng thể: luyện khí, luyện thể, trang bị, công pháp, pháp bảo, kỹ năng, đan buff.',
    descriptionEn:
      'Ancient ascension tower — tests overall strength: qi-refining, body, equipment, methods, artifacts, skills, buffs.',
    unlockRealmOrder: 1,
    maxGeneratedFloor: null,
    infiniteScaling: true,
    floorFormula: {
      basePower: 100,
      linearStep: 0.05,
      expBase: 1.1,
      expDivisor: 10,
    },
    statWeights: {
      qi: 1.0,
      body: 1.0,
      equipment: 1.0,
      method: 1.0,
      artifact: 1.0,
    },
    milestoneRules: SHARED_MILESTONE_RULES,
    rankingSeason: SHARED_RANKING_SEASON,
    normalFloorReward: { linhThach: 20, exp: 40, trialPoints: 5 },
    eliteFloorReward: { linhThach: 100, exp: 200, trialPoints: 30 },
    dailyAttempts: 5,
    enabled: true,
  },
  {
    key: 'linh_khi_thap',
    towerType: 'LINH_KHI_THAP',
    nameVi: 'Linh Khí Tháp',
    nameEn: 'Spirit-Qi Tower',
    descriptionVi:
      'Tháp luyện khí — test pháp lực + công pháp. Stat weight: 100% Luyện Khí, 40% Luyện Thể, 70% pháp bảo/trang bị.',
    descriptionEn:
      'Spirit-qi tower — tests qi power + methods. Stat weights: 100% qi, 40% body, 70% artifact/equipment.',
    unlockRealmOrder: 2,
    maxGeneratedFloor: null,
    infiniteScaling: true,
    floorFormula: {
      basePower: 120,
      linearStep: 0.06,
      expBase: 1.12,
      expDivisor: 10,
    },
    statWeights: {
      qi: 1.0,
      body: 0.4,
      equipment: 0.7,
      method: 1.0,
      artifact: 0.7,
    },
    milestoneRules: SHARED_MILESTONE_RULES,
    rankingSeason: SHARED_RANKING_SEASON,
    normalFloorReward: { linhThach: 25, exp: 50, trialPoints: 6 },
    eliteFloorReward: { linhThach: 120, exp: 240, trialPoints: 35 },
    dailyAttempts: 5,
    enabled: true,
  },
  {
    key: 'huyet_the_thap',
    towerType: 'HUYET_THE_THAP',
    nameVi: 'Huyết Thể Tháp',
    nameEn: 'Blood-Body Tower',
    descriptionVi:
      'Tháp luyện thể — test HP/phòng thủ/stamina. Stat weight: 100% Luyện Thể, 40% Luyện Khí, 80% trang bị/pháp bảo phòng thủ.',
    descriptionEn:
      'Blood-body tower — tests HP / defense / stamina. Stat weights: 100% body, 40% qi, 80% defensive equipment/artifact.',
    unlockRealmOrder: 2,
    maxGeneratedFloor: null,
    infiniteScaling: true,
    floorFormula: {
      basePower: 130,
      linearStep: 0.06,
      expBase: 1.12,
      expDivisor: 10,
    },
    statWeights: {
      qi: 0.4,
      body: 1.0,
      equipment: 0.8,
      method: 0.6,
      artifact: 0.8,
    },
    milestoneRules: SHARED_MILESTONE_RULES,
    rankingSeason: SHARED_RANKING_SEASON,
    normalFloorReward: { linhThach: 25, exp: 50, trialPoints: 6 },
    eliteFloorReward: { linhThach: 120, exp: 240, trialPoints: 35 },
    dailyAttempts: 5,
    enabled: true,
  },
];
