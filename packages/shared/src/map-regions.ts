/**
 * Map Region — Phase 12.1 catalog foundation
 * (catalog-only, KHÔNG runtime, KHÔNG Prisma migration).
 *
 * Hệ thống Map Region:
 * - Mỗi vùng (region) gom nhóm `MonsterDef.regionKey` / `DungeonDef.regionKey`
 *   / `BossDef.regionKey` / `MissionDef.regionKey` — UI map view, filter,
 *   "vùng này yêu cầu cảnh giới X" gating.
 * - Catalog source of truth cho region metadata (name, lore flavor,
 *   `unlockRealmKey`, sortOrder, dominant element).
 * - Trước Phase 12.1: `regionKey` là string free-form tự do — không có
 *   typed catalog → typo có thể slip qua, FE/BE drift về tên / unlock
 *   threshold / element label.
 *
 * Hiện trạng Phase 12.1:
 *   - Static catalog (`packages/shared/src/map-regions.ts`) + typed
 *     `RegionKey` union — cùng pattern với `realms.ts` / `items.ts` /
 *     `combat.ts:DUNGEONS`.
 *   - Tightening `MonsterDef.regionKey` / `DungeonDef.regionKey` /
 *     `BossDef.regionKey` / `MissionDef.regionKey` từ `string | null` →
 *     `RegionKey | null` — compile-time guard chống typo / orphan key.
 *   - 9 region formalize từ keys đã dùng trong MONSTERS / DUNGEONS /
 *     BOSSES / MISSIONS: son_coc, hac_lam, yeu_thu_dong, kim_son_mach,
 *     moc_huyen_lam, thuy_long_uyen, hoa_diem_son, hoang_tho_huyet,
 *     cuu_la_dien (endgame instance — boss `cuu_la_thien_de` + 2 mission
 *     `once_clear_cuu_la_dien_*` reference).
 *
 * Defer Phase 12.1+ (NOT in this PR):
 *   - DB-backed `MapRegion` Prisma model — admin tune-live không cần
 *     ngay (region geography lore-stable). Move sang DB nếu Phase 15+
 *     cần admin tune unlock threshold / sortOrder live.
 *   - Service `getRegionsForCharacter(characterId)` filter theo
 *     unlockRealmKey ≤ character realm — Phase 12.X UI map view sẽ wire.
 *   - Endpoint `GET /api/map/regions` REST — FE consume `MAP_REGIONS`
 *     trực tiếp qua `@xuantoi/shared` import là đủ; thêm endpoint khi
 *     cần admin override / per-character filter server-side.
 *
 * Source of truth:
 *   - `docs/LONG_TERM_ROADMAP.md` Phase 12 §12.1 MapRegion model.
 *   - `docs/CONTENT_PIPELINE.md` §1 inventory "Map region" row.
 *   - `docs/GAME_DESIGN_BIBLE.md` lore for region flavor.
 */

import type { ElementKey } from './combat';

/**
 * RegionKey — typed union 9 region. Mở rộng phase 12.X cần update:
 *   - Add key vào `REGION_KEYS` array.
 *   - Add `MapRegionDef` entry vào `MAP_REGIONS` (sortOrder unique +
 *     monotonic).
 *   - Cross-catalog: monster / dungeon / boss / mission có thể reference
 *     region mới ngay — không break existing test (parity test enforce
 *     orphan-free).
 */
export type RegionKey =
  | 'son_coc'
  | 'hac_lam'
  | 'yeu_thu_dong'
  | 'kim_son_mach'
  | 'moc_huyen_lam'
  | 'thuy_long_uyen'
  | 'hoa_diem_son'
  | 'hoang_tho_huyet'
  | 'cuu_la_dien';

export const REGION_KEYS: readonly RegionKey[] = [
  'son_coc',
  'hac_lam',
  'yeu_thu_dong',
  'kim_son_mach',
  'moc_huyen_lam',
  'thuy_long_uyen',
  'hoa_diem_son',
  'hoang_tho_huyet',
  'cuu_la_dien',
];

export interface MapRegionDef {
  /** Region key — match `MonsterDef.regionKey` / `DungeonDef.regionKey`. */
  key: RegionKey;
  /** Tên hiển thị tiếng Việt — UI label. */
  nameVi: string;
  /** Tên hiển thị English — i18n parity. */
  nameEn: string;
  /** Lore flavor ngắn (≤ 200 ký tự) — tiếng Việt. */
  flavorVi: string;
  /** Lore flavor ngắn (≤ 200 ký tự) — English. */
  flavorEn: string;
  /**
   * Cảnh giới thấp nhất gợi ý unlock — match key trong `REALMS`. Phase
   * 12.X UI map view sẽ filter region theo `character.realmKey` ≥
   * unlockRealmKey order.
   */
  unlockRealmKey: string;
  /** Sort order trên UI list — unique, monotonic increasing. */
  sortOrder: number;
  /**
   * Element thiên về region (Ngũ Hành dominant). `null` cho region
   * không thiên hệ (vd `yeu_thu_dong` mix kim/thổ).
   */
  dominantElement: ElementKey | null;
}

export const MAP_REGIONS: readonly MapRegionDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // Tier early — Luyện Khí → Trúc Cơ
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'son_coc',
    nameVi: 'Sơn Cốc',
    nameEn: 'Mountain Valley',
    flavorVi:
      'Sơn cốc xanh thẳm bao quanh Tông Môn — yêu thú nhỏ và sơn thử lông vàng tuần tra trong cỏ rậm, bãi tu luyện đầu tiên của tu sĩ luyện khí.',
    flavorEn:
      'Lush green valleys at the foot of the sect — small beasts and golden-furred mountain rats roam, the first training ground of qi-refining cultivators.',
    unlockRealmKey: 'luyenkhi',
    sortOrder: 1,
    dominantElement: 'tho',
  },
  {
    key: 'hac_lam',
    nameVi: 'Hắc Lâm',
    nameEn: 'Black Forest',
    flavorVi:
      'Cổ lâm âm khí dày đặc — thi quỷ Hắc Lâm Ma nương bóng tối vạn năm, mộc khí âm hàn nhuộm lá đen như mực.',
    flavorEn:
      'Ancient woods saturated with yin energy — the corpse-spirits and Black Forest Phantoms have lurked in the shadows for ten thousand years, dyeing the leaves ink-black with cold mu energy.',
    unlockRealmKey: 'truc_co',
    sortOrder: 2,
    dominantElement: 'moc',
  },
  {
    key: 'moc_huyen_lam',
    nameVi: 'Mộc Huyền Lâm',
    nameEn: 'Wood-Mystery Forest',
    flavorVi:
      'Rừng cổ thiên niên — cổ thụ chi linh và thiên la cổ yêu nương theo huyết khí ngàn năm, mỗi tiếng lá rơi đều ẩn chứa pháp ngôn cổ xưa.',
    flavorEn:
      'Millennium-old forest — ancient tree spirits and primordial Heavenly Net beasts feed on a thousand years of bloodline qi; every fallen leaf carries forgotten ancient incantations.',
    unlockRealmKey: 'truc_co',
    sortOrder: 3,
    dominantElement: 'moc',
  },

  // ─────────────────────────────────────────────────────────────────────
  // Tier mid — Kim Đan
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'yeu_thu_dong',
    nameVi: 'Yêu Thú Động',
    nameEn: 'Beast Cavern',
    flavorVi:
      'Hang yêu thú thượng cổ — Kim Giáp Thú và Huyền Quy thượng cổ trấn giữ, chỉ kim đan trở lên mới có cơ hội sống sót khỏi mê cung yêu khí.',
    flavorEn:
      'Cavern of primordial beasts — Golden-armored Beasts and Mystic Tortoises stand guard; only Golden Core cultivators and above stand a chance to survive the labyrinth of yao energy.',
    unlockRealmKey: 'kim_dan',
    sortOrder: 4,
    dominantElement: null,
  },
  {
    key: 'kim_son_mach',
    nameVi: 'Kim Sơn Mạch',
    nameEn: 'Golden Mountain Vein',
    flavorVi:
      'Mỏ kim cổ xưa — kiếm linh và kim quang thạch giáp tuần ranh, đồng tử kim quang chỉ rõ kẻ trộm tinh thiết, mỗi mạch quặng đều ẩn tinh thạch ngàn năm.',
    flavorEn:
      'Ancient gold-vein mines — sword-spirits and golden-armored stone guardians patrol the borders; pupils of golden light expose any iron-thief, every ore vein hides millennium-old crystal cores.',
    unlockRealmKey: 'kim_dan',
    sortOrder: 5,
    dominantElement: 'kim',
  },
  {
    key: 'thuy_long_uyen',
    nameVi: 'Thuỷ Long Uyên',
    nameEn: 'Water-Dragon Abyss',
    flavorVi:
      'Long uyên hồ sâu vạn trượng — Giao Long ẩn tích, Thuỷ Thanh Long Vương trấn giữ băng tinh nguyên tủy, mặt nước phản chiếu thiên hà cổ.',
    flavorEn:
      'Ten-thousand-fathom dragon abyss — flood dragons hide their tracks while the Azure Water Dragon King guards crystalline ice essence; the surface mirrors an ancient galaxy.',
    unlockRealmKey: 'kim_dan',
    sortOrder: 6,
    dominantElement: 'thuy',
  },

  // ─────────────────────────────────────────────────────────────────────
  // Tier late — Nguyên Anh → Hoá Thần
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'hoa_diem_son',
    nameVi: 'Hoả Diệm Sơn',
    nameEn: 'Flame-Burning Mountain',
    flavorVi:
      'Núi lửa thiêu thiên — Chu Tước Huyết Điêu thiêu đốt vạn vật, đan sĩ luyện hoả tinh, dòng dung nham nung đỏ vạn dặm trời.',
    flavorEn:
      'Sky-scorching volcano — Vermillion Sparrow Blood Eagles burn all in their wake; alchemists refine flame-essence as crimson lava bakes the heavens for ten thousand miles.',
    unlockRealmKey: 'nguyen_anh',
    sortOrder: 7,
    dominantElement: 'hoa',
  },
  {
    key: 'hoang_tho_huyet',
    nameVi: 'Hoàng Thổ Huyệt',
    nameEn: 'Yellow-Earth Hollow',
    flavorVi:
      'Huyệt thổ ngàn năm — Thạch Long Cổ Giáp và Thổ Địa Lão Tử trấn giữ kho tàng địa mạch, mỗi tấc đất đều phong ấn linh khí tổ tông.',
    flavorEn:
      'Earth-hollow of a thousand years — Stone Dragon Ancient Plates and the Earth-Lord Elder watch over a treasury of telluric veins; every inch of soil seals ancestral spirit qi.',
    unlockRealmKey: 'nguyen_anh',
    sortOrder: 8,
    dominantElement: 'tho',
  },

  // ─────────────────────────────────────────────────────────────────────
  // Tier endgame — Hoá Thần secret-instance
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'cuu_la_dien',
    nameVi: 'Cửu La Điện',
    nameEn: 'Nine-Net Hall',
    flavorVi:
      'Điện ma đạo cổ — Cửu La Thiên Đế kim quang chí dương trấn áp ma đạo, instance bí cảnh dành cho tu sĩ Hoá Thần thử nghiệm tâm cảnh.',
    flavorEn:
      'Ancient demonic-path hall — the Heavenly Emperor of Nine Nets suppresses demon-paths with supreme yang radiance; a secret instance reserved for Spirit-Transformation cultivators to test their dao mind.',
    unlockRealmKey: 'hoa_than',
    sortOrder: 9,
    dominantElement: 'kim',
  },
];

/**
 * Lookup region by key. Trả `undefined` nếu key không tồn tại — gọi
 * trang phải xử lý null trước khi dereference.
 */
export function getMapRegionByKey(key: string): MapRegionDef | undefined {
  return MAP_REGIONS.find((r) => r.key === key);
}

/**
 * Type guard — narrow `string` xuống `RegionKey` nếu match catalog.
 * Dùng khi parse input client-side hoặc admin tooling.
 */
export function isMapRegionKey(key: string): key is RegionKey {
  return REGION_KEYS.includes(key as RegionKey);
}

/**
 * Lọc region theo realm — return mọi region có `unlockRealmKey.order` ≤
 * `currentRealmOrder`. Dùng cho UI map view "vùng đã mở khoá".
 *
 * Pass `realms` array (`REALMS` từ `realms.ts`) qua param để tránh
 * circular import — `realms.ts` không nên depend vào `map-regions.ts`.
 */
export function regionsUnlockedAtRealmOrder(
  currentRealmOrder: number,
  realms: readonly { key: string; order: number }[],
): MapRegionDef[] {
  const realmOrderByKey = new Map<string, number>();
  for (const r of realms) realmOrderByKey.set(r.key, r.order);
  return MAP_REGIONS.filter((region) => {
    const unlockOrder = realmOrderByKey.get(region.unlockRealmKey);
    if (unlockOrder == null) return false;
    return unlockOrder <= currentRealmOrder;
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Lọc region theo dominant element. Dùng cho UI filter "vùng hệ KIM" /
 * khuyến nghị farm theo Linh Căn của character.
 */
export function regionsByDominantElement(element: ElementKey): MapRegionDef[] {
  return MAP_REGIONS.filter((r) => r.dominantElement === element).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}
