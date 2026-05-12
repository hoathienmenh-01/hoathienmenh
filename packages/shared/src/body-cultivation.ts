import type { RealmTier } from './enums';
import { CULTIVATION_TICK_BASE_EXP } from './ws-events';
import {
  cultivationRateForRealm,
  expCostForStage,
  REALMS,
  ROMAN_TRONG,
  type RealmDef,
} from './realms';

export interface BodyRealmDef {
  key: string;
  name: string;
  stages: number;
  order: number;
  tier: RealmTier;
  qiRealmKey: string;
}

export interface BodyStatBonus {
  hpMax: number;
  power: number;
  def: number;
  staminaMax: number;
  bossDamageReduction: number;
}

export interface BodyBreakthroughMaterial {
  itemKey: string;
  qty: number;
}

export interface BodyBreakthroughRequirement {
  fromOrder: number;
  toOrder: number;
  bodyExpCost: bigint;
  materials: readonly BodyBreakthroughMaterial[];
  pillItemKey: string | null;
  minSuccessRate: number;
}

export interface BodyBreakthroughMaterialState {
  itemKey: string;
  qty: number;
}

const BODY_NAMES = [
  'Phàm Thân',
  'Luyện Bì',
  'Đoán Cốt',
  'Tẩy Tủy',
  'Kim Cương Thân',
  'Ngọc Cốt Thần Tủy',
  'Bất Hoại Pháp Thân',
  'Long Tượng Thần Thể',
  'Đại Thừa Thánh Thể',
  'Kiếp Lôi Thần Thể',
  'Nhân Tiên Thể',
  'Địa Tiên Thể',
  'Thiên Tiên Thể',
  'Huyền Tiên Kim Thân',
  'Kim Tiên Đạo Thể',
  'Thái Ất Bảo Thể',
  'Đại La Chân Thể',
  'Chuẩn Thánh Thể',
  'Thánh Nhân Pháp Thân',
  'Hỗn Nguyên Đạo Thân',
  'Đạo Quân Vô Cấu Thân',
  'Thiên Đạo Thần Thân',
  'Bản Nguyên Thánh Thai',
  'Huyền Huyền Nguyên Thể',
  'Vô Thủy Đạo Thể',
  'Vô Chung Bất Diệt Thể',
  'Vĩnh Hằng Chân Thân',
  'Hư Không Chí Tôn Thể',
] as const;

const BODY_KEYS = [
  'pham_than',
  'luyen_bi',
  'doan_cot',
  'tay_tuy',
  'kim_cuong_than',
  'ngoc_cot_than_tuy',
  'bat_hoai_phap_than',
  'long_tuong_than_the',
  'dai_thua_thanh_the',
  'kiep_loi_than_the',
  'nhan_tien_the',
  'dia_tien_the',
  'thien_tien_the',
  'huyen_tien_kim_than',
  'kim_tien_dao_the',
  'thai_at_bao_the',
  'dai_la_chan_the',
  'chuan_thanh_the',
  'thanh_nhan_phap_than',
  'hon_nguyen_dao_than',
  'dao_quan_vo_cau_than',
  'thien_dao_than_than',
  'ban_nguyen_thanh_thai',
  'huyen_huyen_nguyen_the',
  'vo_thuy_dao_the',
  'vo_chung_bat_diet_the',
  'vinh_hang_chan_than',
  'hu_khong_chi_ton_the',
] as const;

export const BODY_CULTIVATION_STAMINA_PER_TICK = 2;
export const BODY_CULTIVATION_INJURY_GAIN_MULT = 0.5;
export const BODY_CULTIVATION_INJURY_MS = 30 * 60 * 1000;

export const BODY_REALMS: readonly BodyRealmDef[] = REALMS.map((realm, index) => ({
  key: BODY_KEYS[index]!,
  name: BODY_NAMES[index]!,
  stages: realm.stages,
  order: realm.order,
  tier: realm.tier,
  qiRealmKey: realm.key,
}));

export function getBodyRealmByKey(key: string): BodyRealmDef | undefined {
  return BODY_REALMS.find((r) => r.key === key);
}

export function getBodyRealmByOrder(order: number): BodyRealmDef | undefined {
  return BODY_REALMS.find((r) => r.order === order);
}

export function nextBodyRealm(currentKey: string): BodyRealmDef | null {
  const cur = getBodyRealmByKey(currentKey);
  if (!cur) return null;
  return getBodyRealmByOrder(cur.order + 1) ?? null;
}

export function fullBodyRealmName(realm: BodyRealmDef, stage: number): string {
  if (realm.stages <= 1) return realm.name;
  const idx = Math.min(Math.max(stage, 1), 9) - 1;
  return `${realm.name} ${ROMAN_TRONG[idx]} Trọng`;
}

function qiRealmForBody(realm: BodyRealmDef): RealmDef {
  return REALMS.find((r) => r.order === realm.order) ?? REALMS[0]!;
}

export function bodyExpCostForStage(realm: BodyRealmDef, stage: number): bigint;
export function bodyExpCostForStage(realmKey: string, stage: number): bigint | null;
export function bodyExpCostForStage(
  realmOrKey: BodyRealmDef | string,
  stage: number,
): bigint | null {
  const realm =
    typeof realmOrKey === 'string'
      ? getBodyRealmByKey(realmOrKey) ?? null
      : realmOrKey;
  if (!realm) return null;
  const qiCost = expCostForStage(qiRealmForBody(realm), stage);
  return BigInt(Math.round(Number(qiCost) * 1.2));
}

export function bodyRateForRealm(
  bodyRealmKey: string,
  baseRate = CULTIVATION_TICK_BASE_EXP,
): number {
  const bodyRealm = getBodyRealmByKey(bodyRealmKey);
  if (!bodyRealm) return baseRate * 0.5;
  const qiRealm = qiRealmForBody(bodyRealm);
  return cultivationRateForRealm(qiRealm.key, baseRate) * 0.5;
}

export function computeBodyStatBonus(
  bodyRealmOrder: number,
  bodyStage = 1,
): BodyStatBonus {
  const realm = getBodyRealmByOrder(bodyRealmOrder) ?? BODY_REALMS[0]!;
  const stage = Math.min(Math.max(bodyStage, 1), realm.stages);
  const progressUnits = realm.order * 9 + (stage - 1);
  const tierMul = 1 + realm.order / 18;
  return {
    hpMax: Math.min(24_000, Math.round(progressUnits * 24 * tierMul)),
    power: Math.min(1_200, Math.round(progressUnits * 1.35 * tierMul)),
    def: Math.min(1_500, Math.round(progressUnits * 1.65 * tierMul)),
    staminaMax: Math.min(220, Math.round(progressUnits * 0.42)),
    bossDamageReduction: Math.min(0.28, Number((progressUnits * 0.0012).toFixed(4))),
  };
}

function bodyMaterialForOrder(toOrder: number): string {
  if (toOrder <= 1) return 'khi_huyet_thao';
  if (toOrder <= 2) return 'doan_cot_thach';
  if (toOrder <= 3) return 'tay_tuy_dich';
  if (toOrder <= 4) return 'kim_than_tinh';
  if (toOrder <= 6) return 'bat_hoai_hon_thach';
  return 'yeu_thu_huyet_tinh';
}

function bodyPillForOrder(toOrder: number): string | null {
  if (toOrder === 3) return 'tay_tuy_dan_t3';
  if (toOrder === 4) return 'kim_than_dan_t4';
  if (toOrder === 6) return 'bat_hoai_dan_t5';
  return null;
}

export function computeBodyBreakthroughRequirement(
  fromOrder: number,
  toOrder = fromOrder + 1,
): BodyBreakthroughRequirement {
  const fromRealm = getBodyRealmByOrder(fromOrder) ?? BODY_REALMS[0]!;
  const cost = bodyExpCostForStage(fromRealm, fromRealm.stages);
  const materialQty = Math.max(1, Math.ceil((toOrder + 1) * 1.4));
  return {
    fromOrder,
    toOrder,
    bodyExpCost: cost,
    materials: [{ itemKey: bodyMaterialForOrder(toOrder), qty: materialQty }],
    pillItemKey: bodyPillForOrder(toOrder),
    minSuccessRate: Math.max(0.15, Number((0.76 - fromOrder * 0.012).toFixed(3))),
  };
}

export function computeBodyBreakthroughSuccessRate(
  fromOrder: number,
  toOrder = fromOrder + 1,
  materialStates: readonly BodyBreakthroughMaterialState[] = [],
  pillItemKey: string | null = null,
): number {
  const req = computeBodyBreakthroughRequirement(fromOrder, toOrder);
  let rate = req.minSuccessRate;
  const counts = new Map(materialStates.map((m) => [m.itemKey, m.qty]));
  const hasAllMaterials = req.materials.every(
    (m) => (counts.get(m.itemKey) ?? 0) >= m.qty,
  );
  if (hasAllMaterials) rate += 0.1;
  if (req.pillItemKey && pillItemKey === req.pillItemKey) rate += 0.09;
  if (!req.pillItemKey && pillItemKey) rate += 0.03;
  return Math.min(0.95, Math.max(0.15, Number(rate.toFixed(3))));
}

export function validateBodyCultivationCatalog(): true {
  if (BODY_REALMS.length !== REALMS.length) throw new Error('BODY_REALMS_LENGTH');
  const seen = new Set<string>();
  for (const realm of BODY_REALMS) {
    const qi = REALMS[realm.order];
    if (!qi) throw new Error(`BODY_REALM_ORDER:${realm.key}`);
    if (qi.stages !== realm.stages) throw new Error(`BODY_REALM_STAGES:${realm.key}`);
    if (qi.tier !== realm.tier) throw new Error(`BODY_REALM_TIER:${realm.key}`);
    if (seen.has(realm.key)) throw new Error(`BODY_REALM_DUP_KEY:${realm.key}`);
    seen.add(realm.key);
  }
  return true;
}
