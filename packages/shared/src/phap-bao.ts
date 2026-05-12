/**
 * Phase 23.5 — Pháp Bảo Advanced Artifact System (foundation).
 *
 * Pháp bảo là **slot riêng** (artifact / `ARTIFACT_1..3`) — KHÔNG thuộc 8
 * trang bị chính (weapon/armor/helmet/boots/belt/ring/amulet/talisman) của
 * Phase 23.2 + 23.3 + 23.4. Phase này:
 *
 *  - Khai báo catalog ≥ 10 pháp bảo foundation phủ PHAM..THAN × tier 1..10.
 *  - Khoá `requiredRealmOrder` theo equipment tier ladder Phase 23.2.
 *  - Có passive bonus (compose vào equipBonus aggregator) + active skill
 *    optional với cooldown ≥ 30s, unlock theo `starLevel`.
 *  - 3 lớp progression: refine (luyện khí) tái dùng `InventoryItem.refineLevel`
 *    qua `RefineService.refineEquipment`; star-up + awaken **defer** sang
 *    Phase 23.6 / 25.1 (cần migration `artifactProgressJson`) — phase này
 *    chỉ surface cost helpers + UI preview gated bằng feature flag.
 *  - Người chơi chay: pháp bảo drop từ quest / dungeon / boss / event.
 *  - Monetization (Phase 25.1): bán mảnh / nguyên liệu luyện khí / bảo hộ
 *    phù, KHÔNG bán pháp bảo top tier / max sao / max awaken trực tiếp,
 *    KHÔNG cho vượt `requiredRealmOrder`.
 *
 * Cap: passive bonus per stat ≤ `ITEM_STAT_BUDGET_BY_QUALITY[quality] × 1.2`
 * (artifact slotWeight 0.7 cộng off-slot soft cap 1.2× cho multi-stat — cap
 * thực dụng catalog định nghĩa). Active skill cooldown ≥ 30s.
 */

import type { ElementKey } from './combat';
import type { ItemBonus } from './items';
import type { Quality } from './enums';
import {
  ITEM_STAT_BUDGET_BY_QUALITY,
  type ItemStatBudget,
} from './balance-dials';
import {
  getEnhanceCapForTier,
  getEquipmentTierForRealmOrder,
  type EquipmentTierNumber,
} from './equipment-progression';

/**
 * Tổng số sao tối đa cho pháp bảo. Cap cứng để pháp bảo không vượt build
 * identity sang auto-win.
 */
export const PHAP_BAO_STAR_MAX = 5;

/**
 * Cap stage thức tỉnh foundation. Future expansion có thể nâng lên 5 khi
 * Phase 25.1 wire awaken stone shop.
 */
export const PHAP_BAO_AWAKEN_MAX = 3;

/**
 * Pháp bảo passive cap = `ITEM_STAT_BUDGET_BY_QUALITY[q] × this`. Slot
 * artifact có +20% off-slot soft cap (`ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER`),
 * pháp bảo giữ nguyên multiplier đó.
 */
export const PHAP_BAO_PASSIVE_CAP_MULTIPLIER = 1.2;

/**
 * Hệ số phụ trợ: pháp bảo refine cost = `RefineService` cost cùng tier ×
 * 1.5 (luyện khí pháp bảo đắt hơn trang bị thường).
 */
export const PHAP_BAO_REFINE_COST_MULTIPLIER = 1.5;

/**
 * Cooldown tối thiểu cho active skill pháp bảo (giây). Active skill mạnh
 * phải có CD ≥ 60s; early CD ≥ 30s.
 */
export const PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC = 30;

/**
 * Mỗi sao giảm 5% cooldown active skill, cap tối đa 25% (sao 5).
 */
export const PHAP_BAO_STAR_COOLDOWN_REDUCTION_PER_STAR = 0.05;
export const PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP = 0.25;

/**
 * Power score multiplier per star / per refine level / per awaken stage.
 */
export const PHAP_BAO_STAR_POWER_PER_LEVEL = 0.05;
export const PHAP_BAO_REFINE_POWER_PER_LEVEL = 0.03;
export const PHAP_BAO_AWAKEN_POWER_PER_STAGE = 0.08;

/**
 * Cap tổng multiplier pháp bảo power (vs base powerBudget). Đảm bảo pháp
 * bảo không vượt 50% bonus trên baseline ngay cả khi max star + max refine
 * + max awaken.
 *
 * Verify: 5 × 0.05 + 15 × 0.03 + 3 × 0.08 = 0.25 + 0.45 + 0.24 = 0.94 (raw),
 * sau khi cap 1.5 = max 1.5 (50% bonus). Future expansion có thể tinh chỉnh.
 */
export const PHAP_BAO_POWER_MULTIPLIER_CAP = 1.5;

export type PhapBaoElement = ElementKey | 'NEUTRAL';

export const PHAP_BAO_ELEMENTS: readonly PhapBaoElement[] = [
  'kim',
  'moc',
  'thuy',
  'hoa',
  'tho',
  'NEUTRAL',
] as const;

export type PhapBaoRole =
  | 'burst'
  | 'sustain'
  | 'control'
  | 'defense'
  | 'support'
  | 'farming';

export const PHAP_BAO_ROLES: readonly PhapBaoRole[] = [
  'burst',
  'sustain',
  'control',
  'defense',
  'support',
  'farming',
] as const;

export type PhapBaoSource =
  | 'quest'
  | 'boss'
  | 'dungeon'
  | 'craft'
  | 'event'
  | 'premium_hook';

export const PHAP_BAO_SOURCES: readonly PhapBaoSource[] = [
  'quest',
  'boss',
  'dungeon',
  'craft',
  'event',
  'premium_hook',
] as const;

/**
 * Active skill type cho preview UI + future combat wire. Phase này chỉ
 * surface metadata, KHÔNG enforce trong CombatService.
 */
export type ArtifactActiveEffectKind =
  | 'damage'
  | 'aoe_damage'
  | 'dot'
  | 'heal'
  | 'regen'
  | 'shield'
  | 'buff'
  | 'debuff_slow'
  | 'debuff_freeze'
  | 'reflect'
  | 'crit_window';

export interface ArtifactActiveEffect {
  kind: ArtifactActiveEffectKind;
  /** Magnitude theo % baseline (vd 1.5 = 150% atk, 0.3 = 30% maxHp shield). */
  magnitude: number;
  /** Duration tính bằng giây cho buff/debuff/dot/regen/shield/window. 0 = instant. */
  durationSec: number;
  /** Target hint cho UI: `self` | `enemy` | `aoe` | `ally`. */
  target: 'self' | 'enemy' | 'aoe' | 'ally';
}

export interface ArtifactActiveSkill {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  cooldownSeconds: number;
  effect: ArtifactActiveEffect;
  /** Star tối thiểu để unlock active skill (1..5). */
  unlockStar: number;
}

export interface PhapBaoDef {
  artifactKey: string;
  /** Alias = `artifactKey`. Match `ItemDef.key` để inventory equip pipeline lookup được. */
  itemKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  artifactTier: EquipmentTierNumber;
  requiredRealmOrder: number;
  quality: Quality;
  elementAffinity: PhapBaoElement;
  role: PhapBaoRole;
  /**
   * Passive bonus áp lên equip aggregator (đã capped theo
   * `validatePhapBaoDefinition`).
   */
  passiveBonus: ItemBonus;
  /** Optional active skill. NULL = pháp bảo chỉ có passive. */
  activeSkill: ArtifactActiveSkill | null;
  starCap: number;
  refineCap: number;
  awakenCap: number;
  source: PhapBaoSource;
  powerBudget: number;
}

export interface PhapBaoInstance {
  artifactKey: string;
  starLevel: number;
  refineLevel: number;
  awakenStage: number;
}

/**
 * Pháp bảo catalog foundation. 10 entries phủ tier 2..10 × LINH..THAN ×
 * element kim/moc/thuy/hoa/tho/neutral × role burst/sustain/control/defense/
 * support. Tier 1 deliberately rỗng — người chơi mới dùng ARTIFACT item
 * thường (`luyen_khi_phu` etc.) thay vì pháp bảo "dòng cao cấp".
 */
export const PHAP_BAO_CATALOG: readonly PhapBaoDef[] = [
  {
    artifactKey: 'ngu_hanh_linh_chau',
    itemKey: 'ngu_hanh_linh_chau',
    nameVi: 'Ngũ Hành Linh Châu',
    nameEn: 'Five-Element Spirit Pearl',
    descriptionVi:
      'Châu ngũ hành xoay quanh chủ nhân, dung hòa khí cơ — tăng tinh khí ' +
      'và sinh lực căn bản, hỗ trợ hồi phục theo thời gian.',
    descriptionEn:
      'Pearls of the five elements orbiting the wielder, smoothing qi flow ' +
      'and granting steady regeneration alongside vitality and spirit.',
    artifactTier: 2,
    requiredRealmOrder: 4,
    quality: 'LINH',
    elementAffinity: 'NEUTRAL',
    role: 'support',
    passiveBonus: { hpMax: 60, mpMax: 60, spirit: 8 },
    activeSkill: null,
    starCap: 5,
    refineCap: 7,
    awakenCap: 0,
    source: 'quest',
    powerBudget: 320,
  },
  {
    artifactKey: 'thanh_lien_kiem_an',
    itemKey: 'thanh_lien_kiem_an',
    nameVi: 'Thanh Liên Kiếm Ấn',
    nameEn: 'Azure Lotus Sword Seal',
    descriptionVi:
      'Ấn kiếm khắc thanh liên, kết tinh sát khí Kim hệ — kích hoạt một ' +
      'kiếm ý chém xuyên giáp địch.',
    descriptionEn:
      'A blade-shaped seal carved with azure lotus that channels Kim-aspect ' +
      "qi to unleash an armor-piercing single-target strike.",
    artifactTier: 3,
    requiredRealmOrder: 7,
    quality: 'HUYEN',
    elementAffinity: 'kim',
    role: 'burst',
    passiveBonus: { atk: 30, spirit: 12 },
    activeSkill: {
      key: 'phap_bao_thanh_lien_kiem_y',
      nameVi: 'Thanh Liên Kiếm Ý',
      nameEn: 'Azure Lotus Sword Intent',
      descriptionVi:
        'Phóng kiếm ý hệ Kim chém một mục tiêu, gây sát thương lớn (150% atk).',
      descriptionEn:
        'Releases a Kim-aspect sword intent on a single target, dealing 150% atk damage.',
      cooldownSeconds: 45,
      effect: { kind: 'damage', magnitude: 1.5, durationSec: 0, target: 'enemy' },
      unlockStar: 1,
    },
    starCap: 5,
    refineCap: 9,
    awakenCap: 0,
    source: 'dungeon',
    powerBudget: 820,
  },
  {
    artifactKey: 'huyen_thien_kinh',
    itemKey: 'huyen_thien_kinh',
    nameVi: 'Huyền Thiên Kính',
    nameEn: 'Black Heaven Mirror',
    descriptionVi:
      'Cổ kính phản chiếu thiên cơ, ngưng kết hàn khí Thủy hệ — đóng băng ' +
      'mục tiêu trong khoảnh khắc.',
    descriptionEn:
      'An ancient mirror reflecting heavenly truth, condensing Thủy-aspect ' +
      'frost qi to briefly freeze a target.',
    artifactTier: 4,
    requiredRealmOrder: 10,
    quality: 'HUYEN',
    elementAffinity: 'thuy',
    role: 'control',
    passiveBonus: { def: 35, hpMax: 130, spirit: 18 },
    activeSkill: {
      key: 'phap_bao_huyen_thien_bang_phong',
      nameVi: 'Huyền Thiên Băng Phong',
      nameEn: 'Black Heaven Freeze',
      descriptionVi: 'Đóng băng 1 mục tiêu trong 2 giây, không gây sát thương.',
      descriptionEn: 'Freezes a single target for 2 seconds without dealing damage.',
      cooldownSeconds: 50,
      effect: { kind: 'debuff_freeze', magnitude: 1.0, durationSec: 2, target: 'enemy' },
      unlockStar: 2,
    },
    starCap: 5,
    refineCap: 11,
    awakenCap: 0,
    source: 'quest',
    powerBudget: 2_100,
  },
  {
    artifactKey: 'huyet_nguyet_ho_lo',
    itemKey: 'huyet_nguyet_ho_lo',
    nameVi: 'Huyết Nguyệt Hồ Lô',
    nameEn: 'Blood Moon Gourd',
    descriptionVi:
      'Hồ lô đỏ máu, ngưng tụ Hỏa khí ma đạo — gieo độc lửa thiêu đốt ' +
      'kẻ địch nhiều giây.',
    descriptionEn:
      'A crimson gourd brewing demonic Hỏa-aspect qi, branding the enemy ' +
      'with searing damage over time.',
    artifactTier: 5,
    requiredRealmOrder: 13,
    quality: 'TIEN',
    elementAffinity: 'hoa',
    role: 'sustain',
    passiveBonus: { atk: 80, hpMax: 240, spirit: 30 },
    activeSkill: {
      key: 'phap_bao_huyet_nguyet_chu_hoa',
      nameVi: 'Huyết Nguyệt Chú Hỏa',
      nameEn: 'Blood Moon Cursed Flame',
      descriptionVi:
        'Đốt cháy mục tiêu trong 5 giây, mỗi giây gây 30% atk sát thương Hỏa.',
      descriptionEn: 'Burns the target for 5 seconds, dealing 30% atk Hỏa damage per second.',
      cooldownSeconds: 40,
      effect: { kind: 'dot', magnitude: 0.3, durationSec: 5, target: 'enemy' },
      unlockStar: 2,
    },
    starCap: 5,
    refineCap: 13,
    awakenCap: 2,
    source: 'boss',
    powerBudget: 5_400,
  },
  {
    artifactKey: 'tho_linh_son_an',
    itemKey: 'tho_linh_son_an',
    nameVi: 'Thổ Linh Sơn Ấn',
    nameEn: 'Earth Spirit Mountain Seal',
    descriptionVi:
      'Ấn núi khắc linh văn Thổ hệ, kết khiên đất kiên cố hấp thụ sát ' +
      'thương lớn trong vài giây.',
    descriptionEn:
      'A mountain-shaped seal etched with Thổ-aspect runes, forging an ' +
      'earthen barrier that absorbs heavy damage for a few seconds.',
    artifactTier: 5,
    requiredRealmOrder: 13,
    quality: 'TIEN',
    elementAffinity: 'tho',
    role: 'defense',
    passiveBonus: { def: 110, hpMax: 320 },
    activeSkill: {
      key: 'phap_bao_tho_linh_son_khien',
      nameVi: 'Thổ Linh Sơn Khiên',
      nameEn: 'Earth Spirit Mountain Shield',
      descriptionVi: 'Tạo khiên hấp thụ 30% máu tối đa trong 6 giây.',
      descriptionEn: 'Generates a shield absorbing 30% max HP for 6 seconds.',
      cooldownSeconds: 60,
      effect: { kind: 'shield', magnitude: 0.3, durationSec: 6, target: 'self' },
      unlockStar: 1,
    },
    starCap: 5,
    refineCap: 13,
    awakenCap: 2,
    source: 'dungeon',
    powerBudget: 5_400,
  },
  {
    artifactKey: 'cuu_diem_phien',
    itemKey: 'cuu_diem_phien',
    nameVi: 'Cửu Diễm Phiến',
    nameEn: 'Nine-Flame Fan',
    descriptionVi:
      'Quạt chín ngọn lửa cổ Tiên phẩm, tung quạt thiêu rụi diện rộng — ' +
      'một đòn bộc phát quét hàng quân yêu.',
    descriptionEn:
      'An ancient nine-flame fan of Tiên grade, fanning a wide blaze of ' +
      'Hỏa qi that sweeps clear ranks of demons in one burst.',
    artifactTier: 6,
    requiredRealmOrder: 16,
    quality: 'TIEN',
    elementAffinity: 'hoa',
    role: 'burst',
    passiveBonus: { atk: 130, hpMax: 200, spirit: 40 },
    activeSkill: {
      key: 'phap_bao_cuu_diem_phun_phen',
      nameVi: 'Cửu Diễm Phun Phong',
      nameEn: 'Nine-Flame Burst',
      descriptionVi: 'Quạt lửa AoE gây 180% atk sát thương Hỏa cho tất cả địch.',
      descriptionEn: 'AoE flame burst dealing 180% atk Hỏa damage to all enemies.',
      cooldownSeconds: 75,
      effect: { kind: 'aoe_damage', magnitude: 1.8, durationSec: 0, target: 'aoe' },
      unlockStar: 2,
    },
    starCap: 5,
    refineCap: 15,
    awakenCap: 2,
    source: 'boss',
    powerBudget: 13_800,
  },
  {
    artifactKey: 'moc_linh_binh',
    itemKey: 'moc_linh_binh',
    nameVi: 'Mộc Linh Bình',
    nameEn: 'Wood Spirit Vase',
    descriptionVi:
      'Bình ngọc Mộc hệ chứa linh dịch, rưới nước cam lồ trị thương — ' +
      'hồi máu lớn và kéo dài hồi phục.',
    descriptionEn:
      'A jade vase of Mộc-aspect spirit nectar, dripping healing dew that ' +
      'restores a large amount of HP and sustains regeneration.',
    artifactTier: 6,
    requiredRealmOrder: 16,
    quality: 'TIEN',
    elementAffinity: 'moc',
    role: 'sustain',
    passiveBonus: { hpMax: 400, mpMax: 200, spirit: 35 },
    activeSkill: {
      key: 'phap_bao_moc_linh_cam_lo',
      nameVi: 'Mộc Linh Cam Lộ',
      nameEn: 'Wood Spirit Sweet Dew',
      descriptionVi: 'Hồi 20% máu tối đa tức thì + regen 5 giây cho bản thân.',
      descriptionEn: 'Instantly restores 20% max HP + 5s regen on self.',
      cooldownSeconds: 60,
      effect: { kind: 'heal', magnitude: 0.2, durationSec: 5, target: 'self' },
      unlockStar: 1,
    },
    starCap: 5,
    refineCap: 15,
    awakenCap: 2,
    source: 'quest',
    powerBudget: 13_800,
  },
  {
    artifactKey: 'bang_tam_ngoc_kinh',
    itemKey: 'bang_tam_ngoc_kinh',
    nameVi: 'Băng Tâm Ngọc Kính',
    nameEn: 'Ice-Heart Jade Mirror',
    descriptionVi:
      'Cổ kính ngọc lạnh Thủy hệ, soi ra hàn ảnh — làm chậm địch khu vực, ' +
      'thích hợp control mass mob.',
    descriptionEn:
      'A cold-jade ancient mirror of Thủy aspect projecting frost echoes ' +
      'that slow multiple enemies — ideal for crowd control.',
    artifactTier: 7,
    requiredRealmOrder: 19,
    quality: 'TIEN',
    elementAffinity: 'thuy',
    role: 'control',
    passiveBonus: { def: 120, hpMax: 380, spirit: 55 },
    activeSkill: {
      key: 'phap_bao_bang_tam_han_anh',
      nameVi: 'Băng Tâm Hàn Ảnh',
      nameEn: 'Ice-Heart Frost Echo',
      descriptionVi: 'Làm chậm 2 mục tiêu 40% trong 4 giây.',
      descriptionEn: 'Slows 2 targets by 40% for 4 seconds.',
      cooldownSeconds: 50,
      effect: { kind: 'debuff_slow', magnitude: 0.4, durationSec: 4, target: 'aoe' },
      unlockStar: 2,
    },
    starCap: 5,
    refineCap: 17,
    awakenCap: 3,
    source: 'event',
    powerBudget: 34_800,
  },
  {
    artifactKey: 'kim_quang_bao_luan',
    itemKey: 'kim_quang_bao_luan',
    nameVi: 'Kim Quang Bảo Luân',
    nameEn: 'Golden Light Treasure Wheel',
    descriptionVi:
      'Bánh xe vàng Thần phẩm xoay vần Kim quang — mở cửa sổ chí mạng + ' +
      'xuyên giáp ngắn nhưng cực mạnh.',
    descriptionEn:
      'A Thần-grade golden wheel spinning Kim radiance, briefly opening a ' +
      'crit + armor-pen window of devastating power.',
    artifactTier: 8,
    requiredRealmOrder: 22,
    quality: 'THAN',
    elementAffinity: 'kim',
    role: 'burst',
    passiveBonus: { atk: 320, hpMax: 800, spirit: 110 },
    activeSkill: {
      key: 'phap_bao_kim_quang_xa_xuyen',
      nameVi: 'Kim Quang Xạ Xuyên',
      nameEn: 'Golden Light Piercing Ray',
      descriptionVi:
        'Mở cửa sổ chí mạng + xuyên giáp 100% trong 5 giây cho bản thân.',
      descriptionEn:
        'Opens a 5-second self-buff window granting +100% crit chance and ignoring armor.',
      cooldownSeconds: 90,
      effect: { kind: 'crit_window', magnitude: 1.0, durationSec: 5, target: 'self' },
      unlockStar: 3,
    },
    starCap: 5,
    refineCap: 19,
    awakenCap: 3,
    source: 'craft',
    powerBudget: 86_400,
  },
  {
    artifactKey: 'hau_tho_tran_hon_an',
    itemKey: 'hau_tho_tran_hon_an',
    nameVi: 'Hậu Thổ Trấn Hồn Ấn',
    nameEn: 'Hou-Tu Soul-Sealing Seal',
    descriptionVi:
      'Đại ấn Hậu Thổ cổ xưa Thần phẩm — phản đòn sát thương trong vài ' +
      'giây, áp chế kẻ phá hoại bằng kim cương cổ.',
    descriptionEn:
      'An ancient Hou-Tu great seal of Thần grade, reflecting damage for a ' +
      'brief window while suppressing attackers with primal stone power.',
    artifactTier: 10,
    requiredRealmOrder: 28,
    quality: 'THAN',
    elementAffinity: 'tho',
    role: 'defense',
    passiveBonus: { def: 480, hpMax: 2400, spirit: 180 },
    activeSkill: {
      key: 'phap_bao_hau_tho_phan_kich',
      nameVi: 'Hậu Thổ Phản Kích',
      nameEn: 'Hou-Tu Counter-Strike',
      descriptionVi: 'Phản 30% sát thương nhận vào trong 5 giây.',
      descriptionEn: 'Reflects 30% of damage taken for 5 seconds.',
      cooldownSeconds: 120,
      effect: { kind: 'reflect', magnitude: 0.3, durationSec: 5, target: 'self' },
      unlockStar: 3,
    },
    starCap: 5,
    refineCap: 23,
    awakenCap: 3,
    source: 'premium_hook',
    powerBudget: 504_000,
  },
] as const;

/**
 * Lookup pháp bảo theo key. Trả `undefined` nếu key không thuộc catalog.
 */
export function getPhapBaoByKey(key: string): PhapBaoDef | undefined {
  return PHAP_BAO_CATALOG.find((p) => p.artifactKey === key);
}

/**
 * Alias `getEquipmentTierForRealmOrder(...).tier` — pháp bảo dùng chung
 * tier ladder Phase 23.2.
 */
export function getPhapBaoTierForRealmOrder(
  realmOrder: number,
): EquipmentTierNumber {
  return getEquipmentTierForRealmOrder(realmOrder).tier;
}

/**
 * Server-authoritative gate: nhân vật cảnh giới `characterRealmOrder` có
 * đủ điều kiện equip `artifact` không. Throw `RangeError` nếu realm order
 * âm; trả `false` nếu chưa đủ.
 */
export function canEquipPhapBao(
  characterRealmOrder: number,
  artifact: PhapBaoDef,
): boolean {
  if (!Number.isFinite(characterRealmOrder) || characterRealmOrder < 0) {
    throw new RangeError(
      `characterRealmOrder out of range: ${characterRealmOrder}`,
    );
  }
  return characterRealmOrder >= artifact.requiredRealmOrder;
}

function clampInstance(input: PhapBaoInstance, artifact: PhapBaoDef): {
  starLevel: number;
  refineLevel: number;
  awakenStage: number;
} {
  const starLevel = clampInt(
    input.starLevel ?? 0,
    0,
    Math.min(artifact.starCap, PHAP_BAO_STAR_MAX),
  );
  const refineLevel = clampInt(input.refineLevel ?? 0, 0, artifact.refineCap);
  const awakenStage = clampInt(
    input.awakenStage ?? 0,
    0,
    Math.min(artifact.awakenCap, PHAP_BAO_AWAKEN_MAX),
  );
  return { starLevel, refineLevel, awakenStage };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute power score deterministic theo instance + catalog. Multiplier
 * tổng cap `PHAP_BAO_POWER_MULTIPLIER_CAP` (1.5) để pháp bảo không vượt
 * 50% bonus trên baseline.
 */
export function computePhapBaoPowerScore(input: PhapBaoInstance): number {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) {
    throw new RangeError(`pháp bảo not found: ${input.artifactKey}`);
  }
  const { starLevel, refineLevel, awakenStage } = clampInstance(input, artifact);
  const rawMultiplier =
    1 +
    starLevel * PHAP_BAO_STAR_POWER_PER_LEVEL +
    refineLevel * PHAP_BAO_REFINE_POWER_PER_LEVEL +
    awakenStage * PHAP_BAO_AWAKEN_POWER_PER_STAGE;
  const multiplier = Math.min(rawMultiplier, PHAP_BAO_POWER_MULTIPLIER_CAP);
  return Math.round(artifact.powerBudget * multiplier);
}

/**
 * Compose passive bonus theo instance. Multiplier giống power score nhưng
 * áp lên từng stat trong `passiveBonus`.
 */
export function computePhapBaoPassiveBonus(input: PhapBaoInstance): ItemBonus {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) {
    throw new RangeError(`pháp bảo not found: ${input.artifactKey}`);
  }
  const { starLevel, refineLevel, awakenStage } = clampInstance(input, artifact);
  const rawMultiplier =
    1 +
    starLevel * PHAP_BAO_STAR_POWER_PER_LEVEL +
    refineLevel * PHAP_BAO_REFINE_POWER_PER_LEVEL +
    awakenStage * PHAP_BAO_AWAKEN_POWER_PER_STAGE;
  const multiplier = Math.min(rawMultiplier, PHAP_BAO_POWER_MULTIPLIER_CAP);
  const base = artifact.passiveBonus;
  const result: ItemBonus = {};
  if (base.atk !== undefined) result.atk = Math.round(base.atk * multiplier);
  if (base.def !== undefined) result.def = Math.round(base.def * multiplier);
  if (base.hpMax !== undefined) result.hpMax = Math.round(base.hpMax * multiplier);
  if (base.mpMax !== undefined) result.mpMax = Math.round(base.mpMax * multiplier);
  if (base.spirit !== undefined) result.spirit = Math.round(base.spirit * multiplier);
  if (base.tribulationSupport !== undefined) {
    result.tribulationSupport = base.tribulationSupport;
  }
  if (base.elementalAtkBonus !== undefined) {
    result.elementalAtkBonus = base.elementalAtkBonus;
  }
  if (base.elementResist !== undefined) {
    result.elementResist = base.elementResist;
  }
  return result;
}

export interface PhapBaoActiveSkillPreview {
  available: boolean;
  unlocked: boolean;
  unlockStar: number;
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  /** Cooldown sau khi star reduction (giây). */
  cooldownSeconds: number;
  baseCooldownSeconds: number;
  cooldownReductionRatio: number;
  effect: ArtifactActiveEffect;
}

/**
 * Preview active skill — surface unlock state + cooldown after star
 * reduction. Trả `available: false` nếu catalog không có active.
 */
export function computePhapBaoActiveSkillPreview(
  input: PhapBaoInstance,
): PhapBaoActiveSkillPreview | { available: false } {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) {
    throw new RangeError(`pháp bảo not found: ${input.artifactKey}`);
  }
  if (artifact.activeSkill === null) return { available: false };
  const { starLevel } = clampInstance(input, artifact);
  const skill = artifact.activeSkill;
  const reduction = Math.min(
    starLevel * PHAP_BAO_STAR_COOLDOWN_REDUCTION_PER_STAR,
    PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP,
  );
  const cooldownSeconds = Math.max(
    PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC,
    Math.round(skill.cooldownSeconds * (1 - reduction)),
  );
  return {
    available: true,
    unlocked: starLevel >= skill.unlockStar,
    unlockStar: skill.unlockStar,
    key: skill.key,
    nameVi: skill.nameVi,
    nameEn: skill.nameEn,
    descriptionVi: skill.descriptionVi,
    descriptionEn: skill.descriptionEn,
    cooldownSeconds,
    baseCooldownSeconds: skill.cooldownSeconds,
    cooldownReductionRatio: reduction,
    effect: skill.effect,
  };
}

export type PhapBaoUpgradeKind = 'refine' | 'star' | 'awaken';

export interface PhapBaoUpgradeCost {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  /** Star-up bắt buộc thêm `phap_bao_shard`. */
  shardQty?: number;
  shardKey?: string;
  /** Awaken bắt buộc thêm `awaken_stone`. */
  awakenStoneQty?: number;
  awakenStoneKey?: string;
}

const REFINE_MATERIAL_BY_TIER: readonly string[] = [
  'tinh_thiet',
  'tinh_thiet',
  'tinh_thiet',
  'yeu_dan',
  'yeu_dan',
  'han_ngoc',
  'han_ngoc',
  'tien_kim_sa',
  'tien_kim_sa',
  'tien_kim_sa',
];

const REFINE_BASE_COST_BY_TIER: readonly number[] = [
  80, 200, 480, 1_100, 2_500, 5_600, 12_400, 27_000, 58_000, 124_000,
];

function tierIdx(tier: EquipmentTierNumber): number {
  return tier - 1;
}

const QUALITY_REFINE_MULTIPLIER: Readonly<Record<Quality, number>> = {
  PHAM: 0.6,
  LINH: 1,
  HUYEN: 1.4,
  TIEN: 2,
  THAN: 2.8,
};

/**
 * Cost luyện khí (refine) pháp bảo. Đắt hơn `RefineService` cost cùng tier
 * 1.5×. Throw `RangeError` nếu currentRefineLevel ≥ refineCap.
 */
export function getPhapBaoUpgradeCost(input: {
  tier: EquipmentTierNumber;
  currentRefineLevel: number;
  refineCap: number;
  quality: Quality;
}): PhapBaoUpgradeCost {
  if (input.currentRefineLevel < 0 || input.currentRefineLevel >= input.refineCap) {
    throw new RangeError(
      `currentRefineLevel ${input.currentRefineLevel} >= refineCap ${input.refineCap}`,
    );
  }
  const baseLinh =
    REFINE_BASE_COST_BY_TIER[tierIdx(input.tier)] *
    QUALITY_REFINE_MULTIPLIER[input.quality];
  const growth = Math.pow(1.4, input.currentRefineLevel);
  const linhThachCost = Math.round(
    baseLinh * growth * PHAP_BAO_REFINE_COST_MULTIPLIER,
  );
  const materialKey = REFINE_MATERIAL_BY_TIER[tierIdx(input.tier)];
  const materialQty = Math.max(1, Math.round(input.tier * (1 + input.currentRefineLevel * 0.2)));
  return { linhThachCost, materialKey, materialQty };
}

const STAR_BASE_COST_BY_TIER: readonly number[] = [
  300, 900, 2_400, 5_800, 13_500, 30_000, 66_000, 142_000, 305_000, 660_000,
];

const STAR_SHARD_KEY = 'phap_bao_shard';

const STAR_SHARD_BY_STAR: readonly number[] = [5, 10, 20, 40, 80];

/**
 * Cost thăng sao pháp bảo. Throw nếu currentStarLevel ≥ min(starCap,
 * PHAP_BAO_STAR_MAX).
 */
export function getPhapBaoStarUpCost(input: {
  tier: EquipmentTierNumber;
  currentStarLevel: number;
  starCap: number;
  quality: Quality;
}): PhapBaoUpgradeCost {
  const cap = Math.min(input.starCap, PHAP_BAO_STAR_MAX);
  if (input.currentStarLevel < 0 || input.currentStarLevel >= cap) {
    throw new RangeError(
      `currentStarLevel ${input.currentStarLevel} >= cap ${cap}`,
    );
  }
  const baseLinh =
    STAR_BASE_COST_BY_TIER[tierIdx(input.tier)] *
    QUALITY_REFINE_MULTIPLIER[input.quality];
  const growth = Math.pow(input.currentStarLevel + 1, 2);
  const linhThachCost = Math.round(baseLinh * growth);
  const materialKey = REFINE_MATERIAL_BY_TIER[tierIdx(input.tier)];
  const materialQty = Math.max(
    2,
    Math.round(input.tier * (input.currentStarLevel + 1) * 1.5),
  );
  const shardQty = STAR_SHARD_BY_STAR[input.currentStarLevel];
  return {
    linhThachCost,
    materialKey,
    materialQty,
    shardKey: STAR_SHARD_KEY,
    shardQty,
  };
}

const AWAKEN_STONE_KEY = 'awaken_stone';

/**
 * Cost thức tỉnh pháp bảo. Bắt buộc quality TIEN/THAN + tier ≥ 5. Throw
 * nếu out-of-range.
 */
export function getPhapBaoAwakenCost(input: {
  tier: EquipmentTierNumber;
  currentAwakenStage: number;
  awakenCap: number;
  quality: Quality;
}): PhapBaoUpgradeCost {
  if (input.quality !== 'TIEN' && input.quality !== 'THAN') {
    throw new RangeError(
      `awaken requires quality TIEN/THAN, got ${input.quality}`,
    );
  }
  if (input.tier < 5) {
    throw new RangeError(`awaken requires tier ≥ 5, got ${input.tier}`);
  }
  const cap = Math.min(input.awakenCap, PHAP_BAO_AWAKEN_MAX);
  if (input.currentAwakenStage < 0 || input.currentAwakenStage >= cap) {
    throw new RangeError(
      `currentAwakenStage ${input.currentAwakenStage} >= cap ${cap}`,
    );
  }
  const refineBase = REFINE_BASE_COST_BY_TIER[tierIdx(input.tier)];
  const baseLinh = refineBase * QUALITY_REFINE_MULTIPLIER[input.quality] * 5;
  const linhThachCost = Math.round(
    baseLinh * Math.pow(2, input.currentAwakenStage),
  );
  const materialKey = REFINE_MATERIAL_BY_TIER[tierIdx(input.tier)];
  const materialQty = Math.max(
    3,
    Math.round(input.tier * (input.currentAwakenStage + 1) * 2),
  );
  const awakenStoneQty = (input.currentAwakenStage + 1) * 2;
  return {
    linhThachCost,
    materialKey,
    materialQty,
    awakenStoneKey: AWAKEN_STONE_KEY,
    awakenStoneQty,
  };
}

function passiveBonusExceedsCap(bonus: ItemBonus, quality: Quality): string[] {
  const errs: string[] = [];
  const cap: ItemStatBudget = ITEM_STAT_BUDGET_BY_QUALITY[quality];
  const stats: Array<keyof ItemStatBudget> = [
    'atk',
    'def',
    'hpMax',
    'mpMax',
    'spirit',
  ];
  for (const stat of stats) {
    const value = (bonus[stat as keyof ItemBonus] as number | undefined) ?? 0;
    if (value < 0) errs.push(`passiveBonus.${stat}=${value} âm`);
    const allowed = Math.round(cap[stat] * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
    if (value > allowed) {
      errs.push(
        `passiveBonus.${stat}=${value} vượt cap ${allowed} (${quality} × ${PHAP_BAO_PASSIVE_CAP_MULTIPLIER})`,
      );
    }
  }
  return errs;
}

export interface PhapBaoValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate static catalog definition. Run trên mỗi entry `PHAP_BAO_CATALOG`
 * ở test suite — drift guard tier/realm/quality/cooldown/cap.
 */
export function validatePhapBaoDefinition(
  artifact: PhapBaoDef,
): PhapBaoValidationResult {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9_]{1,}$/.test(artifact.artifactKey)) {
    errs.push(`artifactKey không hợp lệ: ${artifact.artifactKey}`);
  }
  if (artifact.itemKey !== artifact.artifactKey) {
    errs.push(`itemKey phải = artifactKey (${artifact.artifactKey})`);
  }
  if (artifact.nameVi.length === 0 || artifact.nameEn.length === 0) {
    errs.push('thiếu nameVi / nameEn');
  }
  if (artifact.descriptionVi.length < 10 || artifact.descriptionEn.length < 10) {
    errs.push('description quá ngắn (< 10)');
  }
  if (
    !Number.isInteger(artifact.artifactTier) ||
    artifact.artifactTier < 1 ||
    artifact.artifactTier > 10
  ) {
    errs.push(`artifactTier không hợp lệ: ${artifact.artifactTier}`);
  }
  if (
    !Number.isInteger(artifact.requiredRealmOrder) ||
    artifact.requiredRealmOrder < 1 ||
    artifact.requiredRealmOrder > 28
  ) {
    errs.push(`requiredRealmOrder không hợp lệ: ${artifact.requiredRealmOrder}`);
  } else {
    const tierForRealm = getPhapBaoTierForRealmOrder(artifact.requiredRealmOrder);
    if (tierForRealm < artifact.artifactTier) {
      errs.push(
        `requiredRealmOrder ${artifact.requiredRealmOrder} (tier ${tierForRealm}) < artifactTier ${artifact.artifactTier}`,
      );
    }
  }
  if (!PHAP_BAO_ELEMENTS.includes(artifact.elementAffinity)) {
    errs.push(`elementAffinity không hợp lệ: ${artifact.elementAffinity}`);
  }
  if (!PHAP_BAO_ROLES.includes(artifact.role)) {
    errs.push(`role không hợp lệ: ${artifact.role}`);
  }
  if (!PHAP_BAO_SOURCES.includes(artifact.source)) {
    errs.push(`source không hợp lệ: ${artifact.source}`);
  }
  errs.push(...passiveBonusExceedsCap(artifact.passiveBonus, artifact.quality));
  if (artifact.activeSkill !== null) {
    const skill = artifact.activeSkill;
    if (skill.cooldownSeconds < PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC) {
      errs.push(
        `activeSkill cooldown ${skill.cooldownSeconds} < floor ${PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC}`,
      );
    }
    if (skill.unlockStar < 1 || skill.unlockStar > PHAP_BAO_STAR_MAX) {
      errs.push(`activeSkill unlockStar không hợp lệ: ${skill.unlockStar}`);
    }
    if (!/^[a-z][a-z0-9_]{1,}$/.test(skill.key)) {
      errs.push(`activeSkill key không hợp lệ: ${skill.key}`);
    }
  }
  if (artifact.starCap < 0 || artifact.starCap > PHAP_BAO_STAR_MAX) {
    errs.push(`starCap không hợp lệ: ${artifact.starCap}`);
  }
  if (
    Number.isInteger(artifact.artifactTier) &&
    artifact.artifactTier >= 1 &&
    artifact.artifactTier <= 10
  ) {
    const tierEnhanceCap = getEnhanceCapForTier(artifact.artifactTier);
    if (artifact.refineCap < 0 || artifact.refineCap > tierEnhanceCap) {
      errs.push(
        `refineCap ${artifact.refineCap} vượt tier ${artifact.artifactTier} cap ${tierEnhanceCap}`,
      );
    }
  }
  if (artifact.awakenCap < 0 || artifact.awakenCap > PHAP_BAO_AWAKEN_MAX) {
    errs.push(`awakenCap không hợp lệ: ${artifact.awakenCap}`);
  }
  if (artifact.powerBudget <= 0 || !Number.isFinite(artifact.powerBudget)) {
    errs.push(`powerBudget không hợp lệ: ${artifact.powerBudget}`);
  }
  return { ok: errs.length === 0, errors: errs };
}

export interface PhapBaoUpgradeRequest {
  artifactKey: string;
  kind: PhapBaoUpgradeKind;
  currentRefineLevel: number;
  currentStarLevel: number;
  currentAwakenStage: number;
}

/**
 * Validate yêu cầu upgrade trước khi gọi cost helper. Trả errors chi tiết
 * để FE/BE có thể surface lỗi cụ thể.
 */
export function validatePhapBaoUpgradeRequest(
  input: PhapBaoUpgradeRequest,
): PhapBaoValidationResult {
  const errs: string[] = [];
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) {
    errs.push(`pháp bảo không tồn tại: ${input.artifactKey}`);
    return { ok: false, errors: errs };
  }
  if (input.kind === 'refine') {
    if (input.currentRefineLevel < 0 || input.currentRefineLevel >= artifact.refineCap) {
      errs.push(
        `refineLevel ${input.currentRefineLevel} không thể nâng (cap ${artifact.refineCap})`,
      );
    }
  } else if (input.kind === 'star') {
    const cap = Math.min(artifact.starCap, PHAP_BAO_STAR_MAX);
    if (input.currentStarLevel < 0 || input.currentStarLevel >= cap) {
      errs.push(
        `starLevel ${input.currentStarLevel} không thể nâng (cap ${cap})`,
      );
    }
  } else if (input.kind === 'awaken') {
    if (artifact.quality !== 'TIEN' && artifact.quality !== 'THAN') {
      errs.push(
        `awaken yêu cầu quality TIEN/THAN, pháp bảo này là ${artifact.quality}`,
      );
    }
    if (artifact.artifactTier < 5) {
      errs.push(
        `awaken yêu cầu tier ≥ 5, pháp bảo này tier ${artifact.artifactTier}`,
      );
    }
    if (input.currentStarLevel < 1) {
      errs.push('awaken yêu cầu starLevel ≥ 1');
    }
    const cap = Math.min(artifact.awakenCap, PHAP_BAO_AWAKEN_MAX);
    if (input.currentAwakenStage < 0 || input.currentAwakenStage >= cap) {
      errs.push(
        `awakenStage ${input.currentAwakenStage} không thể nâng (cap ${cap})`,
      );
    }
  } else {
    errs.push(`kind không hợp lệ: ${input.kind}`);
  }
  return { ok: errs.length === 0, errors: errs };
}
