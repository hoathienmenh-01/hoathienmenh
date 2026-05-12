/**
 * Phase 25.3 — Code-only Cosmetic Effects (shared catalog).
 *
 * Defines the per-character cosmetic catalog rendered entirely via CSS
 * classes on the web client. **No new image / sprite / SVG asset files** —
 * every cosmetic ships with a `cssClass` that maps to a rule in
 * `apps/web/src/style/cosmetics.css`.
 *
 * Strict scope rules (enforced by {@link validateCosmeticDefinition} and the
 * accompanying test suite):
 *
 *   - Only the six `CosmeticType` values below are valid.
 *     `WEAPON_SKIN` / `PHAP_BAO_SKIN` are intentionally **not** part of the
 *     union — those would need an art pipeline and are deferred.
 *   - Cosmetics never carry stat / power fields. The runtime never reads
 *     character stats when applying a cosmetic.
 *   - `requiredRealmOrder` is NOT a field on cosmetics — equipping never
 *     bypasses or interacts with realm progression.
 *   - The catalog ships ~20–25 entries covering element auras (Ngũ Hành),
 *     5 title tiers, 5 avatar frame tiers, 5 chat badges and 3 profile
 *     decorations. Battle Pass / Monthly Card / VIP rewards from Phase 25.1
 *     already reference a subset of these IDs (`title_*`, `aura_*`,
 *     `frame_*`) — keeping the IDs consistent here is what wires those
 *     reward grants to a visible loadout.
 */

import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CosmeticType =
  | 'AURA'
  | 'TITLE'
  | 'AVATAR_FRAME'
  | 'CHAT_BADGE'
  | 'PROFILE_DECORATION'
  | 'ELEMENT_AURA';

export type CosmeticRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export type CosmeticSource =
  | 'FREE'
  | 'BATTLE_PASS'
  | 'SHOP'
  | 'VIP'
  | 'EVENT'
  | 'ADMIN';

export type CosmeticElementAffinity = ElementKey | 'NEUTRAL';

export interface CosmeticDef {
  /** Unique snake_case identifier; persisted in `CosmeticOwnership.cosmeticId`. */
  cosmeticId: string;
  type: CosmeticType;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  rarity: CosmeticRarity;
  /** Optional — relevant for `AURA`/`ELEMENT_AURA`/themed `TITLE`. */
  elementAffinity?: CosmeticElementAffinity;
  source: CosmeticSource;
  /** Optional premium currency price; Phase 25.3 mostly ships via grant. */
  price?: { currency: 'tienNgoc' | 'tienNgocKhoa' | 'linhThach'; amount: number };
  /** Optional ownership duration; omit/0 = permanent. */
  durationDays?: number;
  /** Stylesheet class applied to the cosmetic surface. */
  cssClass: string;
  /** Class used in wardrobe preview tiles (often same as `cssClass`). */
  previewClass: string;
  /** When false, listed in tests but excluded from `getActiveCosmetics()`. */
  active: boolean;
}

export interface CosmeticView extends CosmeticDef {
  owned: boolean;
  expiresAt?: string | null;
  equipped: boolean;
}

export const COSMETIC_TYPES: readonly CosmeticType[] = [
  'AURA',
  'TITLE',
  'AVATAR_FRAME',
  'CHAT_BADGE',
  'PROFILE_DECORATION',
  'ELEMENT_AURA',
];

export const COSMETIC_RARITIES: readonly CosmeticRarity[] = [
  'COMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
];

export const COSMETIC_SOURCES: readonly CosmeticSource[] = [
  'FREE',
  'BATTLE_PASS',
  'SHOP',
  'VIP',
  'EVENT',
  'ADMIN',
];

/**
 * Forbidden cosmetic types — Phase 25.3 explicitly defers skin work to a
 * later phase. Catalog tests assert these never appear.
 */
export const FORBIDDEN_COSMETIC_TYPES: readonly string[] = [
  'WEAPON_SKIN',
  'PHAP_BAO_SKIN',
];

/**
 * Stat-like keys that must never appear on a cosmetic def. Asserted by
 * {@link validateCosmeticDefinition} and the catalog test suite — keeps the
 * "no power / no P2W" guarantee enforced at the type + runtime level.
 */
const FORBIDDEN_STAT_KEYS: readonly string[] = [
  'power',
  'spirit',
  'speed',
  'luck',
  'hp',
  'hpMax',
  'mp',
  'mpMax',
  'stamina',
  'staminaMax',
  'attack',
  'defense',
  'crit',
  'critRate',
  'critDamage',
  'damage',
  'combat',
  'powerScore',
  'powerBudget',
  'requiredRealmOrder',
];

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function def(d: CosmeticDef): CosmeticDef {
  return d;
}

export const COSMETICS_CATALOG: readonly CosmeticDef[] = [
  // ---------------------------------------------------------------------
  // ELEMENT AURA — Ngũ Hành (one per element).
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'element_aura_kim',
    type: 'ELEMENT_AURA',
    nameVi: 'Hào Quang Kim Linh',
    nameEn: 'Metal Spirit Aura',
    descriptionVi: 'Hào quang Kim hệ — ánh sáng vàng kim phản chiếu khí Kim.',
    descriptionEn: 'Metal element aura — gold-tinted radiance.',
    rarity: 'RARE',
    elementAffinity: 'kim',
    source: 'EVENT',
    cssClass: 'aura-kim',
    previewClass: 'aura-kim',
    active: true,
  }),
  def({
    cosmeticId: 'element_aura_moc',
    type: 'ELEMENT_AURA',
    nameVi: 'Hào Quang Mộc Linh',
    nameEn: 'Wood Spirit Aura',
    descriptionVi: 'Hào quang Mộc hệ — sắc xanh thảo mộc tươi mới.',
    descriptionEn: 'Wood element aura — fresh verdant glow.',
    rarity: 'RARE',
    elementAffinity: 'moc',
    source: 'EVENT',
    cssClass: 'aura-moc',
    previewClass: 'aura-moc',
    active: true,
  }),
  def({
    cosmeticId: 'element_aura_thuy',
    type: 'ELEMENT_AURA',
    nameVi: 'Hào Quang Thủy Linh',
    nameEn: 'Water Spirit Aura',
    descriptionVi: 'Hào quang Thủy hệ — ánh xanh biếc dịu mát.',
    descriptionEn: 'Water element aura — cool azure shimmer.',
    rarity: 'RARE',
    elementAffinity: 'thuy',
    source: 'EVENT',
    cssClass: 'aura-thuy',
    previewClass: 'aura-thuy',
    active: true,
  }),
  def({
    cosmeticId: 'element_aura_hoa',
    type: 'ELEMENT_AURA',
    nameVi: 'Hào Quang Hỏa Linh',
    nameEn: 'Fire Spirit Aura',
    descriptionVi: 'Hào quang Hỏa hệ — sắc đỏ rực như viêm hoả.',
    descriptionEn: 'Fire element aura — searing crimson halo.',
    rarity: 'RARE',
    elementAffinity: 'hoa',
    source: 'EVENT',
    cssClass: 'aura-hoa',
    previewClass: 'aura-hoa',
    active: true,
  }),
  def({
    cosmeticId: 'element_aura_tho',
    type: 'ELEMENT_AURA',
    nameVi: 'Hào Quang Thổ Linh',
    nameEn: 'Earth Spirit Aura',
    descriptionVi: 'Hào quang Thổ hệ — sắc nâu ấm áp như đại địa.',
    descriptionEn: 'Earth element aura — warm ochre glow.',
    rarity: 'RARE',
    elementAffinity: 'tho',
    source: 'EVENT',
    cssClass: 'aura-tho',
    previewClass: 'aura-tho',
    active: true,
  }),

  // ---------------------------------------------------------------------
  // AURA — non-elemental, monetization-channel themed.
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'aura_tien_lo_moc_nien',
    type: 'AURA',
    nameVi: 'Hào Quang Tiên Lộ — Mộc Nguyên',
    nameEn: 'Immortal Path Aura — Verdant Origin',
    descriptionVi: 'Phần thưởng Tiên Lộ Lệnh cấp 10 — hào quang xanh dịu.',
    descriptionEn: 'Battle Pass level 10 reward — soft verdant aura.',
    rarity: 'EPIC',
    elementAffinity: 'NEUTRAL',
    source: 'BATTLE_PASS',
    cssClass: 'aura-tien-lo-moc-nien',
    previewClass: 'aura-tien-lo-moc-nien',
    active: true,
  }),
  def({
    cosmeticId: 'aura_nguyet_tap_vien_man',
    type: 'AURA',
    nameVi: 'Hào Quang Nguyệt Tạp — Viên Mãn',
    nameEn: 'Monthly Pass Aura — Full Moon',
    descriptionVi: 'Phần thưởng Nguyệt Tạp ngày 30 — hào quang trăng tròn bạc.',
    descriptionEn: 'Monthly Card day-30 reward — silver moon aura.',
    rarity: 'LEGENDARY',
    elementAffinity: 'NEUTRAL',
    source: 'BATTLE_PASS',
    cssClass: 'aura-nguyet-tap-vien-man',
    previewClass: 'aura-nguyet-tap-vien-man',
    active: true,
  }),

  // ---------------------------------------------------------------------
  // TITLE — 5 cultivation flavor titles + Phase 25.1 battle pass / VIP keys.
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'title_so_hoc_de_tu',
    type: 'TITLE',
    nameVi: 'Sơ Học Đệ Tử',
    nameEn: 'Initiate Disciple',
    descriptionVi: 'Danh hiệu khởi đầu — chứng tỏ lòng dạ tu hành.',
    descriptionEn: 'Starter title for new cultivators.',
    rarity: 'COMMON',
    source: 'FREE',
    cssClass: 'title-common',
    previewClass: 'title-common',
    active: true,
  }),
  def({
    cosmeticId: 'title_luyen_khi_truyen_nhan',
    type: 'TITLE',
    nameVi: 'Luyện Khí Truyền Nhân',
    nameEn: 'Qi-Refining Heir',
    descriptionVi: 'Danh hiệu đạo hành Luyện Khí.',
    descriptionEn: 'Title for steady Qi-refining cultivators.',
    rarity: 'RARE',
    source: 'EVENT',
    cssClass: 'title-rare',
    previewClass: 'title-rare',
    active: true,
  }),
  def({
    cosmeticId: 'title_kim_dan_chan_tu',
    type: 'TITLE',
    nameVi: 'Kim Đan Chân Tu',
    nameEn: 'Golden Core Cultivator',
    descriptionVi: 'Danh hiệu cho người tu thành Kim Đan.',
    descriptionEn: 'Title for golden-core stage cultivators.',
    rarity: 'EPIC',
    source: 'EVENT',
    cssClass: 'title-epic',
    previewClass: 'title-epic',
    active: true,
  }),
  def({
    cosmeticId: 'title_nguyen_anh_chan_quan',
    type: 'TITLE',
    nameVi: 'Nguyên Anh Chân Quân',
    nameEn: 'Nascent Soul Sovereign',
    descriptionVi: 'Danh hiệu cho người vượt qua Nguyên Anh.',
    descriptionEn: 'Title for nascent-soul tier sovereigns.',
    rarity: 'LEGENDARY',
    source: 'EVENT',
    cssClass: 'title-legendary',
    previewClass: 'title-legendary',
    active: true,
  }),
  def({
    cosmeticId: 'title_dai_la_kim_tien',
    type: 'TITLE',
    nameVi: 'Đại La Kim Tiên',
    nameEn: 'Great Luo Golden Immortal',
    descriptionVi: 'Đỉnh cao danh hiệu — Đại La Kim Tiên bất hoại.',
    descriptionEn: 'Pinnacle title — undying Great Luo immortal.',
    rarity: 'MYTHIC',
    source: 'EVENT',
    cssClass: 'title-mythic',
    previewClass: 'title-mythic',
    active: true,
  }),
  def({
    cosmeticId: 'title_tien_lo_lenh_so_khoi',
    type: 'TITLE',
    nameVi: 'Tiên Lộ Lệnh — Sơ Khởi',
    nameEn: 'Immortal Path — Origin',
    descriptionVi: 'Danh hiệu mùa khai trương Tiên Lộ Lệnh.',
    descriptionEn: 'Origin season Battle Pass title.',
    rarity: 'EPIC',
    source: 'BATTLE_PASS',
    cssClass: 'title-tien-lo-lenh',
    previewClass: 'title-tien-lo-lenh',
    active: true,
  }),
  def({
    cosmeticId: 'title_vip_light_1',
    type: 'TITLE',
    nameVi: 'VIP Sơ Khởi',
    nameEn: 'VIP Initiate',
    descriptionVi: 'Danh hiệu VIP Light cấp 1.',
    descriptionEn: 'VIP Light level 1 title.',
    rarity: 'RARE',
    source: 'VIP',
    cssClass: 'title-vip',
    previewClass: 'title-vip',
    active: true,
  }),
  def({
    cosmeticId: 'title_vip_light_2',
    type: 'TITLE',
    nameVi: 'VIP Tu Sĩ',
    nameEn: 'VIP Cultivator',
    descriptionVi: 'Danh hiệu VIP Light cấp 2.',
    descriptionEn: 'VIP Light level 2 title.',
    rarity: 'RARE',
    source: 'VIP',
    cssClass: 'title-vip',
    previewClass: 'title-vip',
    active: true,
  }),
  def({
    cosmeticId: 'title_vip_light_3',
    type: 'TITLE',
    nameVi: 'VIP Chân Nhân',
    nameEn: 'VIP True One',
    descriptionVi: 'Danh hiệu VIP Light cấp 3.',
    descriptionEn: 'VIP Light level 3 title.',
    rarity: 'EPIC',
    source: 'VIP',
    cssClass: 'title-vip',
    previewClass: 'title-vip',
    active: true,
  }),
  def({
    cosmeticId: 'title_vip_light_4',
    type: 'TITLE',
    nameVi: 'VIP Chân Quân',
    nameEn: 'VIP Sovereign',
    descriptionVi: 'Danh hiệu VIP Light cấp 4.',
    descriptionEn: 'VIP Light level 4 title.',
    rarity: 'EPIC',
    source: 'VIP',
    cssClass: 'title-vip',
    previewClass: 'title-vip',
    active: true,
  }),
  def({
    cosmeticId: 'title_vip_light_5',
    type: 'TITLE',
    nameVi: 'VIP Kim Tiên',
    nameEn: 'VIP Golden Immortal',
    descriptionVi: 'Danh hiệu VIP Light cấp 5.',
    descriptionEn: 'VIP Light level 5 title.',
    rarity: 'LEGENDARY',
    source: 'VIP',
    cssClass: 'title-vip',
    previewClass: 'title-vip',
    active: true,
  }),

  // ---------------------------------------------------------------------
  // AVATAR FRAME — one per rarity tier + Battle Pass / VIP themed frames.
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'frame_common_thanh_da',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Thanh Đá',
    nameEn: 'Stone Frame',
    descriptionVi: 'Khung avatar đá đơn sơ — quà chào mừng.',
    descriptionEn: 'Simple stone frame — welcome gift.',
    rarity: 'COMMON',
    source: 'FREE',
    cssClass: 'avatar-frame-common',
    previewClass: 'avatar-frame-common',
    active: true,
  }),
  def({
    cosmeticId: 'frame_rare_thanh_dong',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Thanh Đồng',
    nameEn: 'Bronze Frame',
    descriptionVi: 'Khung avatar đồng xanh — ánh kim dịu.',
    descriptionEn: 'Bronze avatar frame with mellow glow.',
    rarity: 'RARE',
    source: 'EVENT',
    cssClass: 'avatar-frame-rare',
    previewClass: 'avatar-frame-rare',
    active: true,
  }),
  def({
    cosmeticId: 'frame_epic_huyen_thiet',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Huyền Thiết',
    nameEn: 'Obsidian Iron Frame',
    descriptionVi: 'Khung huyền thiết — quầng sáng tím sẫm.',
    descriptionEn: 'Obsidian-iron frame with deep violet glow.',
    rarity: 'EPIC',
    source: 'EVENT',
    cssClass: 'avatar-frame-epic',
    previewClass: 'avatar-frame-epic',
    active: true,
  }),
  def({
    cosmeticId: 'frame_legendary_kim_quang',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Kim Quang',
    nameEn: 'Golden Aurora Frame',
    descriptionVi: 'Khung vàng ròng — quầng kim quang lấp lánh.',
    descriptionEn: 'Pure gold frame with shimmering aurora.',
    rarity: 'LEGENDARY',
    source: 'BATTLE_PASS',
    cssClass: 'avatar-frame-legendary',
    previewClass: 'avatar-frame-legendary',
    active: true,
  }),
  def({
    cosmeticId: 'frame_mythic_thien_menh',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Thiên Mệnh',
    nameEn: 'Mandate of Heaven Frame',
    descriptionVi: 'Khung huyền diệu — vầng sáng cầu vồng thiên mệnh.',
    descriptionEn: 'Sacred frame with rainbow Heaven-mandate glow.',
    rarity: 'MYTHIC',
    source: 'EVENT',
    cssClass: 'avatar-frame-mythic',
    previewClass: 'avatar-frame-mythic',
    active: true,
  }),
  def({
    cosmeticId: 'frame_tien_lo_lenh',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung Tiên Lộ Lệnh',
    nameEn: 'Immortal Path Pass Frame',
    descriptionVi: 'Khung Tiên Lộ Lệnh — phần thưởng Battle Pass premium.',
    descriptionEn: 'Battle Pass premium frame.',
    rarity: 'EPIC',
    source: 'BATTLE_PASS',
    cssClass: 'avatar-frame-tien-lo-lenh',
    previewClass: 'avatar-frame-tien-lo-lenh',
    active: true,
  }),
  def({
    cosmeticId: 'frame_vip_light_4',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung VIP Chân Quân',
    nameEn: 'VIP Sovereign Frame',
    descriptionVi: 'Khung VIP Light cấp 4.',
    descriptionEn: 'VIP Light level 4 frame.',
    rarity: 'EPIC',
    source: 'VIP',
    cssClass: 'avatar-frame-vip',
    previewClass: 'avatar-frame-vip',
    active: true,
  }),
  def({
    cosmeticId: 'frame_vip_light_5',
    type: 'AVATAR_FRAME',
    nameVi: 'Khung VIP Kim Tiên',
    nameEn: 'VIP Golden Immortal Frame',
    descriptionVi: 'Khung VIP Light cấp 5.',
    descriptionEn: 'VIP Light level 5 frame.',
    rarity: 'LEGENDARY',
    source: 'VIP',
    cssClass: 'avatar-frame-vip-prestige',
    previewClass: 'avatar-frame-vip-prestige',
    active: true,
  }),

  // ---------------------------------------------------------------------
  // CHAT BADGE — short pill prefix.
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'chat_badge_vip',
    type: 'CHAT_BADGE',
    nameVi: 'Phù Hiệu VIP',
    nameEn: 'VIP Badge',
    descriptionVi: 'Phù hiệu VIP hiển thị trước tên trong chat.',
    descriptionEn: 'VIP chat badge shown before sender name.',
    rarity: 'RARE',
    source: 'VIP',
    cssClass: 'chat-badge-vip',
    previewClass: 'chat-badge-vip',
    active: true,
  }),
  def({
    cosmeticId: 'chat_badge_dao_tu',
    type: 'CHAT_BADGE',
    nameVi: 'Phù Hiệu Đạo Tu',
    nameEn: 'Cultivator Badge',
    descriptionVi: 'Phù hiệu Đạo Tu — khẳng định thân phận tu giả.',
    descriptionEn: 'Cultivator chat badge.',
    rarity: 'COMMON',
    source: 'FREE',
    cssClass: 'chat-badge-dao-tu',
    previewClass: 'chat-badge-dao-tu',
    active: true,
  }),
  def({
    cosmeticId: 'chat_badge_battle_pass',
    type: 'CHAT_BADGE',
    nameVi: 'Phù Hiệu Tiên Lộ Lệnh',
    nameEn: 'Battle Pass Badge',
    descriptionVi: 'Phù hiệu chứng nhận chủ Tiên Lộ Lệnh premium.',
    descriptionEn: 'Battle Pass premium holder chat badge.',
    rarity: 'EPIC',
    source: 'BATTLE_PASS',
    cssClass: 'chat-badge-battle-pass',
    previewClass: 'chat-badge-battle-pass',
    active: true,
  }),
  def({
    cosmeticId: 'chat_badge_event_xuan_to',
    type: 'CHAT_BADGE',
    nameVi: 'Phù Hiệu Xuân Tới',
    nameEn: 'Spring Festival Badge',
    descriptionVi: 'Phù hiệu sự kiện Xuân Tới — chỉ trong mùa lễ.',
    descriptionEn: 'Spring Festival event badge.',
    rarity: 'RARE',
    source: 'EVENT',
    durationDays: 30,
    cssClass: 'chat-badge-event',
    previewClass: 'chat-badge-event',
    active: true,
  }),
  def({
    cosmeticId: 'chat_badge_newbie',
    type: 'CHAT_BADGE',
    nameVi: 'Phù Hiệu Tân Đạo',
    nameEn: 'Newbie Badge',
    descriptionVi: 'Phù hiệu chào mừng người tu mới — biến mất khi đạt Trúc Cơ.',
    descriptionEn: 'Welcome badge for new cultivators.',
    rarity: 'COMMON',
    source: 'FREE',
    cssClass: 'chat-badge-newbie',
    previewClass: 'chat-badge-newbie',
    active: true,
  }),

  // ---------------------------------------------------------------------
  // PROFILE DECORATION — gradient overlay for profile card.
  // ---------------------------------------------------------------------
  def({
    cosmeticId: 'profile_decoration_thanh_lien',
    type: 'PROFILE_DECORATION',
    nameVi: 'Nền Thanh Liên',
    nameEn: 'Azure Lotus Backdrop',
    descriptionVi: 'Nền profile sắc thanh liên dịu mát.',
    descriptionEn: 'Cool azure-lotus profile backdrop.',
    rarity: 'RARE',
    source: 'EVENT',
    cssClass: 'profile-decoration-thanh-lien',
    previewClass: 'profile-decoration-thanh-lien',
    active: true,
  }),
  def({
    cosmeticId: 'profile_decoration_tu_khi',
    type: 'PROFILE_DECORATION',
    nameVi: 'Nền Tử Khí',
    nameEn: 'Purple Qi Backdrop',
    descriptionVi: 'Nền profile sắc tử khí huyền diệu.',
    descriptionEn: 'Mystical purple-qi profile backdrop.',
    rarity: 'EPIC',
    source: 'EVENT',
    cssClass: 'profile-decoration-tu-khi',
    previewClass: 'profile-decoration-tu-khi',
    active: true,
  }),
  def({
    cosmeticId: 'profile_decoration_celestial',
    type: 'PROFILE_DECORATION',
    nameVi: 'Nền Thiên Mệnh',
    nameEn: 'Celestial Mandate Backdrop',
    descriptionVi: 'Nền profile thiên mệnh — gradient cầu vồng nhẹ.',
    descriptionEn: 'Celestial mandate profile backdrop with subtle rainbow gradient.',
    rarity: 'LEGENDARY',
    source: 'BATTLE_PASS',
    cssClass: 'profile-decoration-celestial',
    previewClass: 'profile-decoration-celestial',
    active: true,
  }),
] as const;

// ---------------------------------------------------------------------------
// Index / lookup helpers
// ---------------------------------------------------------------------------

const COSMETICS_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(
  COSMETICS_CATALOG.map((c) => [c.cosmeticId, c] as const),
);

export function getCosmeticById(cosmeticId: string): CosmeticDef | null {
  return COSMETICS_BY_ID.get(cosmeticId) ?? null;
}

export function getActiveCosmetics(): readonly CosmeticDef[] {
  return COSMETICS_CATALOG.filter((c) => c.active);
}

export function getCosmeticsByType(type: CosmeticType): readonly CosmeticDef[] {
  return COSMETICS_CATALOG.filter((c) => c.type === type);
}

export function getCosmeticsBySource(
  source: CosmeticSource,
): readonly CosmeticDef[] {
  return COSMETICS_CATALOG.filter((c) => c.source === source);
}

// ---------------------------------------------------------------------------
// Ownership / loadout helpers
// ---------------------------------------------------------------------------

export interface CosmeticOwnershipLike {
  cosmeticId: string;
  expiresAt?: Date | string | null;
}

export interface CosmeticLoadoutLike {
  activeAuraId: string | null;
  activeTitleId: string | null;
  activeAvatarFrameId: string | null;
  activeChatBadgeId: string | null;
  activeProfileDecorationId: string | null;
  activeElementAuraId: string | null;
}

export const EMPTY_COSMETIC_LOADOUT: CosmeticLoadoutLike = {
  activeAuraId: null,
  activeTitleId: null,
  activeAvatarFrameId: null,
  activeChatBadgeId: null,
  activeProfileDecorationId: null,
  activeElementAuraId: null,
};

const LOADOUT_FIELD_BY_TYPE: Readonly<Record<CosmeticType, keyof CosmeticLoadoutLike>> = {
  AURA: 'activeAuraId',
  TITLE: 'activeTitleId',
  AVATAR_FRAME: 'activeAvatarFrameId',
  CHAT_BADGE: 'activeChatBadgeId',
  PROFILE_DECORATION: 'activeProfileDecorationId',
  ELEMENT_AURA: 'activeElementAuraId',
};

export function loadoutFieldForType(type: CosmeticType): keyof CosmeticLoadoutLike {
  return LOADOUT_FIELD_BY_TYPE[type];
}

export function isCosmeticOwnershipExpired(
  ownership: CosmeticOwnershipLike,
  now: Date = new Date(),
): boolean {
  if (ownership.expiresAt == null) return false;
  const expires = ownership.expiresAt instanceof Date
    ? ownership.expiresAt
    : new Date(ownership.expiresAt);
  return expires.getTime() <= now.getTime();
}

export function canEquipCosmetic(
  def: CosmeticDef,
  ownership: CosmeticOwnershipLike | null | undefined,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: 'NOT_OWNED' | 'OWNERSHIP_EXPIRED' | 'COSMETIC_INACTIVE' } {
  if (!def.active) return { ok: false, reason: 'COSMETIC_INACTIVE' };
  if (!ownership || ownership.cosmeticId !== def.cosmeticId) {
    return { ok: false, reason: 'NOT_OWNED' };
  }
  if (isCosmeticOwnershipExpired(ownership, now)) {
    return { ok: false, reason: 'OWNERSHIP_EXPIRED' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface CosmeticValidationResult {
  ok: boolean;
  errors: readonly string[];
}

export function validateCosmeticDefinition(
  raw: unknown,
): CosmeticValidationResult {
  const errors: string[] = [];
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, errors: ['INVALID_DEF_NOT_OBJECT'] };
  }
  const def = raw as Record<string, unknown>;
  if (typeof def.cosmeticId !== 'string' || def.cosmeticId.trim() === '') {
    errors.push('INVALID_COSMETIC_ID');
  }
  if (typeof def.type !== 'string' || !COSMETIC_TYPES.includes(def.type as CosmeticType)) {
    errors.push('INVALID_COSMETIC_TYPE');
  }
  if (FORBIDDEN_COSMETIC_TYPES.includes(def.type as string)) {
    errors.push('FORBIDDEN_COSMETIC_TYPE');
  }
  if (typeof def.nameVi !== 'string' || def.nameVi.trim() === '') {
    errors.push('INVALID_NAME_VI');
  }
  if (typeof def.nameEn !== 'string' || def.nameEn.trim() === '') {
    errors.push('INVALID_NAME_EN');
  }
  if (
    typeof def.rarity !== 'string' ||
    !COSMETIC_RARITIES.includes(def.rarity as CosmeticRarity)
  ) {
    errors.push('INVALID_RARITY');
  }
  if (
    typeof def.source !== 'string' ||
    !COSMETIC_SOURCES.includes(def.source as CosmeticSource)
  ) {
    errors.push('INVALID_SOURCE');
  }
  if (typeof def.cssClass !== 'string' || def.cssClass.trim() === '') {
    errors.push('INVALID_CSS_CLASS');
  }
  if (typeof def.previewClass !== 'string' || def.previewClass.trim() === '') {
    errors.push('INVALID_PREVIEW_CLASS');
  }
  if (typeof def.active !== 'boolean') {
    errors.push('INVALID_ACTIVE_FLAG');
  }
  if (def.elementAffinity !== undefined) {
    const aff = def.elementAffinity as string;
    if (aff !== 'NEUTRAL' && !ELEMENTS.includes(aff as ElementKey)) {
      errors.push('INVALID_ELEMENT_AFFINITY');
    }
  }
  if (def.durationDays !== undefined) {
    if (
      typeof def.durationDays !== 'number' ||
      !Number.isInteger(def.durationDays) ||
      def.durationDays <= 0
    ) {
      errors.push('INVALID_DURATION_DAYS');
    }
  }
  if (def.price !== undefined) {
    const price = def.price as Record<string, unknown> | null;
    if (
      !price ||
      typeof price !== 'object' ||
      typeof price.currency !== 'string' ||
      typeof price.amount !== 'number' ||
      !Number.isInteger(price.amount) ||
      price.amount <= 0
    ) {
      errors.push('INVALID_PRICE');
    }
  }
  for (const key of FORBIDDEN_STAT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(def, key)) {
      errors.push(`FORBIDDEN_STAT_FIELD:${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// View helpers — used by API to materialize wardrobe entries.
// ---------------------------------------------------------------------------

export function buildCosmeticView(
  def: CosmeticDef,
  ownership: CosmeticOwnershipLike | null,
  equippedIds: ReadonlySet<string>,
  now: Date = new Date(),
): CosmeticView {
  const expired = ownership ? isCosmeticOwnershipExpired(ownership, now) : false;
  return {
    ...def,
    owned: !!ownership && !expired,
    expiresAt: ownership?.expiresAt ?
      (ownership.expiresAt instanceof Date
        ? ownership.expiresAt.toISOString()
        : new Date(ownership.expiresAt).toISOString())
      : null,
    equipped: equippedIds.has(def.cosmeticId),
  };
}
