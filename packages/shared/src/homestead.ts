import { itemByKey } from './items';
import { realmByKey } from './realms';

export const HOMESTEAD_MAX_LEVEL = 6;
export const HOMESTEAD_OFFLINE_CAP_HOURS = 8;
export const HOMESTEAD_STORAGE_CAP_BASE = 80;
export const HOMESTEAD_STORAGE_CAP_PER_LEVEL = 40;
export const HOMESTEAD_SPIRITUAL_ENERGY_REGEN_PER_HOUR = 10;

export interface HomesteadLevelDef {
  readonly level: number;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly fieldSlots: number;
  readonly gardenSlots: number;
  readonly storageCap: number;
  readonly maxCropTier: number;
  readonly maxGardenTier: number;
  readonly upgradeCostLinhThach: number;
  readonly upgradeCostSpiritualEnergy: number;
  readonly requiredRealmKey: string | null;
}

export interface HomesteadCropDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly tier: number;
  readonly outputItemKey: string;
  readonly yieldQty: number;
  readonly growthMinutes: number;
  readonly spiritualEnergyCost: number;
  readonly dailyCapQty: number;
  readonly requiredRealmKey: string | null;
}

export interface HomesteadGardenProductionDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly tier: number;
  readonly outputItemKey: string;
  readonly yieldQty: number;
  readonly durationMinutes: number;
  readonly spiritualEnergyCost: number;
  readonly dailyCapQty: number;
  readonly rare: boolean;
  readonly requiredRealmKey: string | null;
}

export interface HomesteadGateContext {
  readonly homesteadLevel: number;
  readonly realmKey: string;
}

export const HOMESTEAD_LEVELS: readonly HomesteadLevelDef[] = [
  {
    level: 1,
    nameVi: 'Thạch Động Sơ Khai',
    nameEn: 'Newly Opened Stone Cave',
    fieldSlots: 2,
    gardenSlots: 1,
    storageCap: 120,
    maxCropTier: 1,
    maxGardenTier: 1,
    upgradeCostLinhThach: 300,
    upgradeCostSpiritualEnergy: 40,
    requiredRealmKey: null,
  },
  {
    level: 2,
    nameVi: 'Linh Tuyền Động',
    nameEn: 'Spirit Spring Cave',
    fieldSlots: 3,
    gardenSlots: 1,
    storageCap: 180,
    maxCropTier: 2,
    maxGardenTier: 1,
    upgradeCostLinhThach: 900,
    upgradeCostSpiritualEnergy: 70,
    requiredRealmKey: 'luyenkhi',
  },
  {
    level: 3,
    nameVi: 'Tụ Khí Động Phủ',
    nameEn: 'Qi-Gathering Homestead',
    fieldSlots: 4,
    gardenSlots: 2,
    storageCap: 260,
    maxCropTier: 2,
    maxGardenTier: 2,
    upgradeCostLinhThach: 2_400,
    upgradeCostSpiritualEnergy: 110,
    requiredRealmKey: 'truc_co',
  },
  {
    level: 4,
    nameVi: 'Huyền Mạch Dược Cốc',
    nameEn: 'Mystic Vein Medicine Valley',
    fieldSlots: 5,
    gardenSlots: 2,
    storageCap: 360,
    maxCropTier: 3,
    maxGardenTier: 2,
    upgradeCostLinhThach: 6_000,
    upgradeCostSpiritualEnergy: 160,
    requiredRealmKey: 'kim_dan',
  },
  {
    level: 5,
    nameVi: 'Nguyên Anh Linh Phủ',
    nameEn: 'Nascent Soul Spirit Estate',
    fieldSlots: 6,
    gardenSlots: 3,
    storageCap: 500,
    maxCropTier: 4,
    maxGardenTier: 3,
    upgradeCostLinhThach: 14_000,
    upgradeCostSpiritualEnergy: 220,
    requiredRealmKey: 'nguyen_anh',
  },
  {
    level: 6,
    nameVi: 'Thiên Địa Đan Viên',
    nameEn: 'Heaven-Earth Alchemy Garden',
    fieldSlots: 8,
    gardenSlots: 4,
    storageCap: 680,
    maxCropTier: 5,
    maxGardenTier: 4,
    upgradeCostLinhThach: 0,
    upgradeCostSpiritualEnergy: 0,
    requiredRealmKey: 'hoa_than',
  },
];

export const HOMESTEAD_CROPS: readonly HomesteadCropDef[] = [
  {
    key: 'linh_thao_mam',
    nameVi: 'Mầm Linh Thảo',
    nameEn: 'Spirit Herb Sprout',
    tier: 1,
    outputItemKey: 'linh_thao',
    yieldQty: 2,
    growthMinutes: 30,
    spiritualEnergyCost: 8,
    dailyCapQty: 24,
    requiredRealmKey: null,
  },
  {
    key: 'khi_huyet_thao_lu',
    nameVi: 'Luống Khí Huyết Thảo',
    nameEn: 'Vital Blood Herb Bed',
    tier: 1,
    outputItemKey: 'khi_huyet_thao',
    yieldQty: 2,
    growthMinutes: 45,
    spiritualEnergyCost: 10,
    dailyCapQty: 20,
    requiredRealmKey: null,
  },
  {
    key: 'huyet_tinh_dang',
    nameVi: 'Dây Huyết Tinh',
    nameEn: 'Blood Essence Vine',
    tier: 2,
    outputItemKey: 'huyet_tinh',
    yieldQty: 1,
    growthMinutes: 90,
    spiritualEnergyCost: 16,
    dailyCapQty: 10,
    requiredRealmKey: 'luyenkhi',
  },
  {
    key: 'yeu_dan_thao',
    nameVi: 'Yêu Đan Thảo',
    nameEn: 'Beast Core Herb',
    tier: 3,
    outputItemKey: 'yeu_dan',
    yieldQty: 1,
    growthMinutes: 180,
    spiritualEnergyCost: 28,
    dailyCapQty: 5,
    requiredRealmKey: 'truc_co',
  },
  {
    key: 'han_ngoc_hoa',
    nameVi: 'Hàn Ngọc Hoa',
    nameEn: 'Cold Jade Blossom',
    tier: 4,
    outputItemKey: 'han_ngoc',
    yieldQty: 1,
    growthMinutes: 360,
    spiritualEnergyCost: 42,
    dailyCapQty: 3,
    requiredRealmKey: 'kim_dan',
  },
  {
    key: 'bat_hoai_linh_can',
    nameVi: 'Bất Hoại Linh Căn',
    nameEn: 'Imperishable Spirit Root',
    tier: 5,
    outputItemKey: 'bat_hoai_hon_thach',
    yieldQty: 1,
    growthMinutes: 720,
    spiritualEnergyCost: 70,
    dailyCapQty: 1,
    requiredRealmKey: 'nguyen_anh',
  },
];

export const HOMESTEAD_GARDEN_PRODUCTIONS: readonly HomesteadGardenProductionDef[] = [
  {
    key: 'tinh_thiet_loc',
    nameVi: 'Lọc Tinh Thiết',
    nameEn: 'Refined Iron Filtration',
    tier: 1,
    outputItemKey: 'tinh_thiet',
    yieldQty: 1,
    durationMinutes: 60,
    spiritualEnergyCost: 12,
    dailyCapQty: 8,
    rare: false,
    requiredRealmKey: null,
  },
  {
    key: 'doan_cot_ngam',
    nameVi: 'Ngâm Đoán Cốt Thạch',
    nameEn: 'Bone Tempering Stone Soak',
    tier: 2,
    outputItemKey: 'doan_cot_thach',
    yieldQty: 1,
    durationMinutes: 120,
    spiritualEnergyCost: 22,
    dailyCapQty: 5,
    rare: false,
    requiredRealmKey: 'luyenkhi',
  },
  {
    key: 'tay_tuy_chung_cat',
    nameVi: 'Chưng Cất Tẩy Tủy Dịch',
    nameEn: 'Marrow Cleansing Distillation',
    tier: 3,
    outputItemKey: 'tay_tuy_dich',
    yieldQty: 1,
    durationMinutes: 300,
    spiritualEnergyCost: 40,
    dailyCapQty: 2,
    rare: true,
    requiredRealmKey: 'truc_co',
  },
  {
    key: 'kim_than_ngung_luyen',
    nameVi: 'Ngưng Luyện Kim Thân Tinh',
    nameEn: 'Golden Body Essence Condensing',
    tier: 4,
    outputItemKey: 'kim_than_tinh',
    yieldQty: 1,
    durationMinutes: 600,
    spiritualEnergyCost: 65,
    dailyCapQty: 1,
    rare: true,
    requiredRealmKey: 'kim_dan',
  },
];

export function getHomesteadLevelDef(level: number): HomesteadLevelDef | undefined {
  return HOMESTEAD_LEVELS.find((def) => def.level === level);
}

export function getHomesteadCropDef(key: string): HomesteadCropDef | undefined {
  return HOMESTEAD_CROPS.find((def) => def.key === key);
}

export function getHomesteadGardenProductionDef(
  key: string,
): HomesteadGardenProductionDef | undefined {
  return HOMESTEAD_GARDEN_PRODUCTIONS.find((def) => def.key === key);
}

export function homesteadStorageCap(level: number): number {
  const def = getHomesteadLevelDef(level);
  if (def) return def.storageCap;
  return HOMESTEAD_STORAGE_CAP_BASE + Math.max(0, level - 1) * HOMESTEAD_STORAGE_CAP_PER_LEVEL;
}

export function homesteadOfflineRegenEnergy(input: {
  readonly currentEnergy: number;
  readonly updatedAt: Date;
  readonly now: Date;
  readonly storageCap: number;
}): { energy: number; regenerated: number; cappedHours: number } {
  const elapsedMs = Math.max(0, input.now.getTime() - input.updatedAt.getTime());
  const elapsedHours = Math.min(HOMESTEAD_OFFLINE_CAP_HOURS, elapsedMs / 3_600_000);
  const regenerated = Math.floor(elapsedHours * HOMESTEAD_SPIRITUAL_ENERGY_REGEN_PER_HOUR);
  const energy = Math.min(input.storageCap, input.currentEnergy + regenerated);
  return { energy, regenerated: Math.max(0, energy - input.currentEnergy), cappedHours: elapsedHours };
}

export function homesteadTierLimitByRealm(realmKey: string): number {
  const realm = realmByKey(realmKey);
  const order = realm?.order ?? 1;
  if (order >= 5) return 5;
  if (order >= 4) return 4;
  if (order >= 3) return 3;
  if (order >= 2) return 2;
  return 1;
}

export function canUseHomesteadTier(
  tier: number,
  context: HomesteadGateContext,
): { allowed: boolean; reason: 'HOMESTEAD_LEVEL_TOO_LOW' | 'REALM_TOO_LOW' | null } {
  const levelDef = getHomesteadLevelDef(context.homesteadLevel);
  const homesteadTier = levelDef?.maxCropTier ?? 1;
  const realmTier = homesteadTierLimitByRealm(context.realmKey);
  if (tier > homesteadTier) return { allowed: false, reason: 'HOMESTEAD_LEVEL_TOO_LOW' };
  if (tier > realmTier) return { allowed: false, reason: 'REALM_TOO_LOW' };
  return { allowed: true, reason: null };
}

export function realmMeetsHomesteadRequirement(
  realmKey: string,
  requiredRealmKey: string | null,
): boolean {
  if (!requiredRealmKey) return true;
  const realm = realmByKey(realmKey);
  const required = realmByKey(requiredRealmKey);
  return Boolean(realm && required && realm.order >= required.order);
}

export function validateHomesteadCatalog(): string[] {
  const errors: string[] = [];
  for (const level of HOMESTEAD_LEVELS) {
    if (level.level < 1 || level.level > HOMESTEAD_MAX_LEVEL) {
      errors.push(`invalid homestead level ${level.level}`);
    }
    if (level.storageCap <= 0) errors.push(`${level.level} storageCap must be positive`);
    if (level.requiredRealmKey && !realmByKey(level.requiredRealmKey)) {
      errors.push(`${level.level} unknown requiredRealmKey ${level.requiredRealmKey}`);
    }
  }
  for (const crop of HOMESTEAD_CROPS) {
    if (!itemByKey(crop.outputItemKey)) errors.push(`${crop.key} unknown item ${crop.outputItemKey}`);
    if (crop.yieldQty <= 0) errors.push(`${crop.key} yieldQty must be positive`);
    if (crop.dailyCapQty < crop.yieldQty) errors.push(`${crop.key} dailyCapQty below yield`);
    if (crop.requiredRealmKey && !realmByKey(crop.requiredRealmKey)) {
      errors.push(`${crop.key} unknown requiredRealmKey ${crop.requiredRealmKey}`);
    }
  }
  for (const prod of HOMESTEAD_GARDEN_PRODUCTIONS) {
    if (!itemByKey(prod.outputItemKey)) errors.push(`${prod.key} unknown item ${prod.outputItemKey}`);
    if (prod.yieldQty <= 0) errors.push(`${prod.key} yieldQty must be positive`);
    if (prod.dailyCapQty < prod.yieldQty) errors.push(`${prod.key} dailyCapQty below yield`);
    if (prod.rare && prod.dailyCapQty > 2) errors.push(`${prod.key} rare dailyCapQty too high`);
    if (prod.requiredRealmKey && !realmByKey(prod.requiredRealmKey)) {
      errors.push(`${prod.key} unknown requiredRealmKey ${prod.requiredRealmKey}`);
    }
  }
  return errors;
}
