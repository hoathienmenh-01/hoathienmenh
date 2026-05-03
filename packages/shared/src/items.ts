/**
 * Catalog item & drop table — Phase 4.
 *
 * Item là dữ liệu tĩnh (key cố định). Inventory của character chỉ lưu
 * `itemKey + qty + equippedSlot`, server lookup ItemDef bằng key này.
 */

import type { EquipSlot, Quality } from './enums';

export type ItemKind =
  | 'WEAPON'
  | 'ARMOR'
  | 'BELT'
  | 'BOOTS'
  | 'HAT'
  | 'TRAM'
  | 'ARTIFACT'
  | 'PILL_HP'
  | 'PILL_MP'
  | 'PILL_EXP'
  | 'ORE'
  /**
   * Phase 11.2.D — bí kíp/thư trục dùng để học skill mới. Consume 1 stack
   * qua `POST /character/skill/learn-from-book` → `CharacterSkillService.
   * learnFromBook` sẽ validate `unlocks` của template, tạo
   * `CharacterSkill { masteryLevel: 1, source: 'item_consume' }` và ghi
   * `ItemLedger { qtyDelta: -1, reason: 'SKILL_LEARN' }` atomic. Item phải
   * khai báo `skillBook: { skillKey: '...' }` trỏ tới `SkillTemplate.key`.
   */
  | 'SKILL_BOOK'
  | 'MISC';

export interface ItemBonus {
  atk?: number;
  def?: number;
  hpMax?: number;
  mpMax?: number;
  spirit?: number;
}

export interface ItemEffect {
  hp?: number;
  mp?: number;
  exp?: number;
}

/**
 * Phase 11.2.D — metadata cho item kind = 'SKILL_BOOK' liên kết tới
 * `SkillTemplate.key`. Khi player consume, server gọi
 * `CharacterSkillService.learnFromBook(...)` → validate `unlocks` →
 * `learn(skillKey, source='item_consume')`. Idempotent qua
 * `@@unique([characterId, skillKey])` (P2002 → ALREADY_LEARNED).
 */
export interface SkillBookMeta {
  /** `SkillTemplate.key` ↔ `SkillDef.key`. Phải tồn tại trong catalog. */
  skillKey: string;
}

export interface ItemDef {
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  quality: Quality;
  /** Có thể chồng nhiều cái 1 ô (dùng cho đan dược / quặng). */
  stackable: boolean;
  /** Nếu trang bị được, slot tương ứng. */
  slot?: EquipSlot;
  bonuses?: ItemBonus;
  effect?: ItemEffect;
  /** Phase 11.2.D — chỉ set khi `kind === 'SKILL_BOOK'`. */
  skillBook?: SkillBookMeta;
  /** Giá tham khảo (linh thạch). */
  price: number;
}

export const ITEMS: readonly ItemDef[] = [
  // ----- Vũ khí -----
  {
    key: 'so_kiem',
    name: 'Sơ Kiếm',
    description: 'Một thanh kiếm sắt phàm phẩm, hợp với người mới luyện khí.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 5 },
    price: 30,
  },
  {
    key: 'huyen_kiem',
    name: 'Huyền Kiếm',
    description: 'Hắc thiết tinh luyện, thích hợp với trúc cơ kỳ.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 12, spirit: 2 },
    price: 180,
  },
  {
    key: 'diem_phong_dao',
    name: 'Điểm Phong Đao',
    description: 'Yêu đao tia chớp, mỗi đường chém đều có gió rít.',
    kind: 'WEAPON',
    quality: 'HUYEN',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 25, hpMax: 30 },
    price: 720,
  },

  // ----- Áo / Giáp -----
  {
    key: 'pham_giap',
    name: 'Phàm Giáp',
    description: 'Áo da thú thông thường, có thể đỡ vài đòn yêu thú nhỏ.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 4 },
    price: 30,
  },
  {
    key: 'linh_giap',
    name: 'Linh Giáp',
    description: 'Linh giáp dệt từ tơ nhện linh, mềm dẻo và bền.',
    kind: 'ARMOR',
    quality: 'LINH',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 10, hpMax: 25 },
    price: 180,
  },
  {
    key: 'huyet_phach_giap',
    name: 'Huyết Phách Giáp',
    description: 'Giáp đỏ đúc bằng huyết tinh, càng đánh càng mạnh.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 60 },
    price: 720,
  },

  // ----- Đan dược -----
  {
    key: 'huyet_chi_dan',
    name: 'Huyết Chỉ Đan',
    description: 'Hồi 60 HP tức thì.',
    kind: 'PILL_HP',
    quality: 'PHAM',
    stackable: true,
    effect: { hp: 60 },
    price: 25,
  },
  {
    key: 'thanh_lam_dan',
    name: 'Thanh Lam Đan',
    description: 'Hồi 200 HP, vị mát lạnh hơi đắng.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { hp: 200 },
    price: 80,
  },
  {
    key: 'linh_lo_dan',
    name: 'Linh Lộ Đan',
    description: 'Hồi 80 MP, tinh khí ngưng tụ.',
    kind: 'PILL_MP',
    quality: 'PHAM',
    stackable: true,
    effect: { mp: 80 },
    price: 35,
  },
  {
    key: 'co_thien_dan',
    name: 'Cổ Thiên Đan',
    description: 'Tăng 500 EXP tu vi.',
    kind: 'PILL_EXP',
    quality: 'LINH',
    stackable: true,
    effect: { exp: 500 },
    price: 250,
  },
  {
    key: 'huyet_tinh',
    name: 'Huyết Tinh',
    description: 'Tinh huyết yêu thú, nguyên liệu luyện đan.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 60,
  },

  // ----- Drop hiếm boss đại hội (Phase 7) -----
  {
    key: 'tien_huyen_kiem',
    name: 'Tiên Huyền Kiếm',
    description: 'Cổ kiếm rớt từ tay Yêu Vương, sát khí ngút trời.',
    kind: 'WEAPON',
    quality: 'TIEN',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 60, hpMax: 120, spirit: 6 },
    price: 9000,
  },
  {
    key: 'tien_huyen_giap',
    name: 'Tiên Huyền Giáp',
    description: 'Giáp Tiên phẩm, chống đỡ vạn pháp.',
    kind: 'ARMOR',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 55, hpMax: 250 },
    price: 9000,
  },
  {
    key: 'than_dan',
    name: 'Thần Dược Thượng Đan',
    description: 'Đan Thần phẩm, hồi 1500 HP và 600 EXP cùng lúc.',
    kind: 'PILL_HP',
    quality: 'THAN',
    stackable: true,
    effect: { hp: 1500, exp: 600 },
    price: 4000,
  },

  // ----- Thắt lưng (BELT) -----
  {
    key: 'pham_thuc_dai',
    name: 'Phàm Thúc Đái',
    description: 'Thắt lưng da thuộc, gia tăng sức chịu đựng.',
    kind: 'BELT',
    quality: 'PHAM',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 20 },
    price: 35,
  },
  {
    key: 'linh_thuc_dai',
    name: 'Linh Thúc Đái',
    description: 'Thúc đái bện bằng linh ti, ôn nhuận khí huyết.',
    kind: 'BELT',
    quality: 'LINH',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 45, def: 3 },
    price: 200,
  },
  {
    key: 'huyen_long_dai',
    name: 'Huyền Long Đái',
    description: 'Thúc đái khảm vảy huyền long, vững như núi non.',
    kind: 'BELT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 120, def: 10 },
    price: 850,
  },

  // ----- Giày (BOOTS) -----
  {
    key: 'pham_hai',
    name: 'Phàm Hài',
    description: 'Giày vải phàm phẩm, thoải mái đi đường.',
    kind: 'BOOTS',
    quality: 'PHAM',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 2 },
    price: 28,
  },
  {
    key: 'vu_linh_hai',
    name: 'Vũ Linh Hài',
    description: 'Giày linh dệt bằng lông phượng, bước đi nhẹ như gió.',
    kind: 'BOOTS',
    quality: 'LINH',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 6, spirit: 2 },
    price: 190,
  },
  {
    key: 'tien_phong_hai',
    name: 'Tiên Phong Hài',
    description: 'Lưu phong hoá hài, tốc độ vô song.',
    kind: 'BOOTS',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 14, spirit: 5 },
    price: 820,
  },

  // ----- Mũ (HAT) -----
  {
    key: 'pham_quan',
    name: 'Phàm Quan',
    description: 'Mũ vải phàm phẩm.',
    kind: 'HAT',
    quality: 'PHAM',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 2, mpMax: 10 },
    price: 30,
  },
  {
    key: 'tu_ngoc_quan',
    name: 'Tử Ngọc Quan',
    description: 'Mũ khảm tử ngọc, khai minh linh đài.',
    kind: 'HAT',
    quality: 'LINH',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 6, mpMax: 35, spirit: 2 },
    price: 220,
  },
  {
    key: 'huyen_thien_quan',
    name: 'Huyền Thiên Quan',
    description: 'Bảo quan thượng cổ, tâm linh thông thấu huyền thiên.',
    kind: 'HAT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 15, mpMax: 90, spirit: 6 },
    price: 900,
  },

  // ----- Trâm (TRAM) -----
  {
    key: 'ngoc_tram',
    name: 'Ngọc Trâm',
    description: 'Trâm ngọc khảm hoa, tinh tế an thần.',
    kind: 'TRAM',
    quality: 'LINH',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 25, spirit: 3 },
    price: 180,
  },
  {
    key: 'cuu_diep_linh_tram',
    name: 'Cửu Diệp Linh Trâm',
    description: 'Trâm chín cánh, hút linh khí thiên địa.',
    kind: 'TRAM',
    quality: 'HUYEN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 70, spirit: 8 },
    price: 780,
  },

  // ----- Pháp bảo (ARTIFACT) -----
  {
    key: 'luyen_khi_phu',
    name: 'Luyện Khí Phù',
    description: 'Phù thuật sơ cấp, cộng sức công nhẹ.',
    kind: 'ARTIFACT',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARTIFACT_1',
    bonuses: { atk: 4 },
    price: 80,
  },
  {
    key: 'bat_huyet_linh_bai',
    name: 'Bát Huyết Linh Bài',
    description: 'Linh bài tế huyết, bảo vệ chủ nhân khỏi ma khí.',
    kind: 'ARTIFACT',
    quality: 'LINH',
    stackable: false,
    slot: 'ARTIFACT_1',
    bonuses: { def: 8, hpMax: 60 },
    price: 420,
  },
  {
    key: 'huyen_kim_toa',
    name: 'Huyền Kim Toạ',
    description: 'Bảo toạ trường sinh, tăng nguyên khí.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { hpMax: 150, mpMax: 80, spirit: 5 },
    price: 1200,
  },
  {
    key: 'thien_linh_ngoc',
    name: 'Thiên Linh Ngọc',
    description: 'Ngọc trời vô giá, khai mở thiên mệnh.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    bonuses: { atk: 30, hpMax: 200, spirit: 12 },
    price: 6500,
  },

  // ----- Đan dược bổ sung -----
  {
    key: 'hoi_nguyen_dan',
    name: 'Hồi Nguyên Đan',
    description: 'Hồi 400 MP, dùng trong đánh phó bản dài.',
    kind: 'PILL_MP',
    quality: 'LINH',
    stackable: true,
    effect: { mp: 400 },
    price: 150,
  },
  {
    key: 'van_linh_dan',
    name: 'Vạn Linh Đan',
    description: 'Tăng 2500 EXP tu vi, hiếm và đắt.',
    kind: 'PILL_EXP',
    quality: 'HUYEN',
    stackable: true,
    effect: { exp: 2500 },
    price: 1200,
  },
  {
    // Phase 11.3.D — Linh căn reroll consumable. Dùng qua endpoint
    // `POST /character/spiritual-root/reroll` (không tự kích hoạt khi inventory
    // use). Server-authoritative consume 1 stack qua `ItemLedger` reason
    // `SPIRITUAL_ROOT_REROLL`. Drop endgame (boss tier ≥ THAN, dungeon hậu kỳ).
    key: 'linh_can_dan',
    name: 'Linh Căn Đan',
    description: 'Tiên đan tái khai linh căn, dùng để gieo lại linh căn ngẫu nhiên một lần.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 5000,
  },

  // ===================================================================
  // Phase 10 PR-1 — Item Pack 1 (+50 item)
  //
  // Mục tiêu: lấp các khoảng trống early→mid của catalog và chuẩn bị
  // pool drop/equip cho các bản patch sau (skill / dungeon / boss /
  // mission). Stat budget tuân thủ docs/BALANCE_MODEL.md §3.3:
  //   PHAM  ≤ atk 10 / def 8 / hpMax 30 / spirit 5
  //   LINH  ≤ atk 25 / def 20 / hpMax 80 / spirit 12
  //   HUYEN ≤ atk 60 / def 50 / hpMax 200 / spirit 30
  //   TIEN  ≤ atk 200 / def 160 / hpMax 800 / spirit 100
  //   THAN  ≤ atk 800 / def 600 / hpMax 3000 / spirit 350
  // Test bound trong `items-balance.test.ts` (deterministic guard).
  // ===================================================================

  // ----- Vũ khí mới (đa chủng: kiếm / đao / thương / pháp trượng) -----
  {
    key: 'tu_la_dao',
    name: 'Tu La Đao',
    description: 'Yêu đao tế bằng huyết tinh, hợp đệ tử Tu La Điện sơ nhập đạo.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 6 },
    price: 38,
  },
  {
    key: 'thanh_van_thuong',
    name: 'Thanh Vân Thương',
    description: 'Trường thương luyện khí, mũi nhọn chỉ thẳng tâm địch.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 7, hpMax: 10 },
    price: 42,
  },
  {
    key: 'truc_co_truong',
    name: 'Trúc Cơ Trượng',
    description: 'Pháp trượng gỗ trúc khắc văn, dẫn linh khí hộ thân.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 5, mpMax: 20, spirit: 2 },
    price: 50,
  },
  {
    key: 'lanh_phong_kiem',
    name: 'Lãnh Phong Kiếm',
    description: 'Kiếm gió lạnh, vung lên thanh âm như tuyết rơi.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 18, spirit: 3 },
    price: 200,
  },
  {
    key: 'xich_huyet_dao',
    name: 'Xích Huyết Đao',
    description: 'Đao tế huyết, càng giết càng sắc, càng dùng càng khát.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 22, def: 4 },
    price: 220,
  },
  {
    key: 'lien_hoa_truong',
    name: 'Liên Hoa Trượng',
    description: 'Pháp trượng khắc hoa sen, ổn định linh đài người dùng.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 14, mpMax: 40, spirit: 6 },
    price: 230,
  },
  {
    key: 'cuu_u_bi_thuong',
    name: 'Cửu U Bi Thương',
    description: 'Thương u minh, hơi lạnh thấm xương, thích hợp Trúc Cơ hậu kỳ.',
    kind: 'WEAPON',
    quality: 'HUYEN',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 38, hpMax: 60, spirit: 8 },
    price: 850,
  },
  {
    key: 'than_phong_kiem',
    name: 'Thần Phong Kiếm',
    description: 'Kiếm tiên phẩm rút từ thần phong, một chiêu vạn lý.',
    kind: 'WEAPON',
    quality: 'TIEN',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 130, hpMax: 150, spirit: 20 },
    price: 7500,
  },

  // ----- Áo / Giáp mở rộng -----
  {
    key: 'yeu_phach_giap',
    name: 'Yêu Phách Giáp',
    description: 'Giáp da yêu thú sơ cấp, đủ chống vài đòn vuốt sắc.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 6, hpMax: 18 },
    price: 38,
  },
  {
    key: 'truc_co_bao',
    name: 'Trúc Cơ Bào',
    description: 'Trường bào dệt linh ti, tăng mp tự hồi nhẹ.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 7, mpMax: 12 },
    price: 40,
  },
  {
    key: 'cuu_la_giap',
    name: 'Cửu La Giáp',
    description: 'Giáp Linh phẩm khắc cửu la văn, cân bằng công thủ.',
    kind: 'ARMOR',
    quality: 'LINH',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 14, hpMax: 50, spirit: 4 },
    price: 230,
  },
  {
    key: 'han_thiet_giap',
    name: 'Hàn Thiết Giáp',
    description: 'Giáp luyện từ hàn thiết ngàn năm, lạnh thấu xương.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 32, hpMax: 110 },
    price: 750,
  },
  {
    key: 'linh_van_bao',
    name: 'Linh Vân Bào',
    description: 'Pháp bào dệt mây linh, hợp Kim Đan tu sĩ pháp tu.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 28, mpMax: 80, spirit: 10 },
    price: 800,
  },
  {
    key: 'than_lan_giap',
    name: 'Thần Lân Giáp',
    description: 'Giáp Thần phẩm, vảy thần long phản đòn vạn pháp.',
    kind: 'ARMOR',
    quality: 'THAN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 220, hpMax: 1100, spirit: 60 },
    price: 32000,
  },

  // ----- Thắt lưng (BELT) — bổ sung HUYEN/TIEN/THAN -----
  {
    key: 'mau_huyet_dai',
    name: 'Mâu Huyết Đái',
    description: 'Thắt lưng tế huyết, ôn nhuận khí huyết tu sĩ chiến đấu.',
    kind: 'BELT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 150, def: 12 },
    price: 900,
  },
  {
    key: 'tien_van_dai',
    name: 'Tiên Vân Đái',
    description: 'Thắt lưng dệt vân tiên, gia trì khí cơ phòng thủ.',
    kind: 'BELT',
    quality: 'TIEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 500, def: 80, spirit: 30 },
    price: 6500,
  },
  {
    key: 'than_loi_dai',
    name: 'Thần Lôi Đái',
    description: 'Thúc đái Thần phẩm, sấm sét quanh thân hộ chủ.',
    kind: 'BELT',
    quality: 'THAN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 1500, def: 250, spirit: 120 },
    price: 28000,
  },

  // ----- Giày (BOOTS) — bổ sung LINH biến thể + TIEN -----
  {
    key: 'linh_van_hai',
    name: 'Linh Vân Hài',
    description: 'Giày đạp linh vân, bước nhẹ tựa hạc.',
    kind: 'BOOTS',
    quality: 'LINH',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 5, hpMax: 25, spirit: 3 },
    price: 195,
  },
  {
    key: 'cuu_thien_hai',
    name: 'Cửu Thiên Hài',
    description: 'Giày Huyền phẩm, vạn lý đăng tiêu chỉ trong nháy mắt.',
    kind: 'BOOTS',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 18, spirit: 8 },
    price: 850,
  },
  {
    key: 'tien_van_hai',
    name: 'Tiên Vân Hài',
    description: 'Hài Tiên phẩm, đạp vân tiên du, tốc độ vô song.',
    kind: 'BOOTS',
    quality: 'TIEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 90, hpMax: 200, spirit: 30 },
    price: 6800,
  },

  // ----- Mũ (HAT) — bổ sung PHAM + TIEN/THAN -----
  {
    key: 'truc_co_quan',
    name: 'Trúc Cơ Quan',
    description: 'Mũ trúc cơ luyện khí, ổn định linh đài người mới.',
    kind: 'HAT',
    quality: 'PHAM',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 3, mpMax: 15, spirit: 1 },
    price: 35,
  },
  {
    key: 'cuu_diep_quan',
    name: 'Cửu Diệp Quan',
    description: 'Mũ Tiên phẩm khảm cửu diệp linh hoa, khai mở tâm thức.',
    kind: 'HAT',
    quality: 'TIEN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 90, mpMax: 320, spirit: 50 },
    price: 7000,
  },
  {
    key: 'than_minh_quan',
    name: 'Thần Minh Quan',
    description: 'Bảo quan Thần phẩm, hào quang thần minh che chở.',
    kind: 'HAT',
    quality: 'THAN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 280, mpMax: 1100, spirit: 180 },
    price: 30000,
  },

  // ----- Trâm (TRAM) — bổ sung PHAM + TIEN/THAN -----
  {
    key: 'moc_tram',
    name: 'Mộc Trâm',
    description: 'Trâm gỗ đào tránh tà, vật khởi đầu của nữ tu.',
    kind: 'TRAM',
    quality: 'PHAM',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 8, spirit: 1 },
    price: 30,
  },
  {
    key: 'cuu_diep_linh_tram_tien',
    name: 'Cửu Diệp Linh Trâm — Tiên phẩm',
    description: 'Trâm Tiên phẩm chín cánh hoa, hút linh khí thiên địa.',
    kind: 'TRAM',
    quality: 'TIEN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 300, spirit: 50, hpMax: 150 },
    price: 6500,
  },
  {
    key: 'than_linh_tram',
    name: 'Thần Linh Trâm',
    description: 'Trâm Thần phẩm, mỗi lá đều khắc một thiên đạo văn.',
    kind: 'TRAM',
    quality: 'THAN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 1100, spirit: 200 },
    price: 27000,
  },

  // ----- Pháp bảo (ARTIFACT) — bổ sung biến thể -----
  {
    key: 'linh_phu_thuong',
    name: 'Linh Phù Thượng',
    description: 'Phù bảo Linh phẩm cấp cao, tăng công + thủ nhẹ.',
    kind: 'ARTIFACT',
    quality: 'LINH',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { atk: 8, def: 3 },
    price: 220,
  },
  {
    key: 'huyen_an_phu',
    name: 'Huyền Ấn Phù',
    description: 'Ấn phù Huyền phẩm, tăng thủ + máu cho tu sĩ phòng thủ.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    bonuses: { def: 35, hpMax: 130 },
    price: 900,
  },
  {
    key: 'tu_la_huyet_phach',
    name: 'Tu La Huyết Phách',
    description: 'Pháp bảo Tu La Điện, tế huyết khắc cốt, công sát kinh người.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { atk: 90, hpMax: 350, spirit: 25 },
    price: 6800,
  },
  {
    key: 'than_phach_chau',
    name: 'Thần Phách Châu',
    description: 'Châu Thần phẩm, hồn châu vạn cổ, gia trì toàn diện.',
    kind: 'ARTIFACT',
    quality: 'THAN',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { atk: 280, hpMax: 1200, spirit: 100 },
    price: 30000,
  },

  // ----- Đan HP bổ sung -----
  {
    key: 'tieu_phuc_dan',
    name: 'Tiểu Phục Đan',
    description: 'Hồi 35 HP, đan phàm phẩm tân thủ.',
    kind: 'PILL_HP',
    quality: 'PHAM',
    stackable: true,
    effect: { hp: 35 },
    price: 18,
  },
  {
    key: 'cuu_huyen_dan',
    name: 'Cửu Huyền Đan',
    description: 'Hồi 600 HP, đan Huyền phẩm cho phó bản dài.',
    kind: 'PILL_HP',
    quality: 'HUYEN',
    stackable: true,
    effect: { hp: 600 },
    price: 380,
  },
  {
    key: 'tien_phach_dan',
    name: 'Tiên Phách Đan',
    description: 'Hồi 2500 HP, đan Tiên phẩm cứu mạng giữa thiên kiếp.',
    kind: 'PILL_HP',
    quality: 'TIEN',
    stackable: true,
    effect: { hp: 2500 },
    price: 1800,
  },

  // ----- Đan MP bổ sung -----
  {
    key: 'linh_tinh_dan',
    name: 'Linh Tinh Đan',
    description: 'Hồi 30 MP, đan phàm phẩm dùng hằng ngày.',
    kind: 'PILL_MP',
    quality: 'PHAM',
    stackable: true,
    effect: { mp: 30 },
    price: 18,
  },
  {
    key: 'ngoc_lien_dan',
    name: 'Ngọc Liên Đan',
    description: 'Hồi 800 MP, hương sen tinh khiết, an thần.',
    kind: 'PILL_MP',
    quality: 'HUYEN',
    stackable: true,
    effect: { mp: 800 },
    price: 380,
  },
  {
    key: 'tien_van_dan',
    name: 'Tiên Vân Đan',
    description: 'Hồi 2500 MP, đan Tiên phẩm, hương vân tiên dịu nhẹ.',
    kind: 'PILL_MP',
    quality: 'TIEN',
    stackable: true,
    effect: { mp: 2500 },
    price: 1800,
  },

  // ----- Đan EXP bổ sung -----
  {
    key: 'so_huyen_dan',
    name: 'Sơ Huyền Đan',
    description: 'Tăng 200 EXP tu vi, dùng cho tân thủ luyện khí.',
    kind: 'PILL_EXP',
    quality: 'PHAM',
    stackable: true,
    effect: { exp: 200 },
    price: 80,
  },
  {
    key: 'cuu_thien_dan',
    name: 'Cửu Thiên Đan',
    description: 'Tăng 6000 EXP, đan Tiên phẩm cho mid-late game.',
    kind: 'PILL_EXP',
    quality: 'TIEN',
    stackable: true,
    effect: { exp: 6000 },
    price: 3500,
  },
  {
    key: 'nhan_tien_dan',
    name: 'Nhân Tiên Đan',
    description: 'Tăng 18000 EXP, đan Thần phẩm, hỗ trợ phá quan.',
    kind: 'PILL_EXP',
    quality: 'THAN',
    stackable: true,
    effect: { exp: 18000 },
    price: 9000,
  },

  // ----- Nguyên liệu (ORE/herb/material) -----
  {
    key: 'linh_thao',
    name: 'Linh Thảo',
    description: 'Linh thảo trên dược điền, nguyên liệu sơ cấp luyện đan.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 35,
  },
  {
    key: 'tinh_thiet',
    name: 'Tinh Thiết',
    description: 'Khoáng tinh thiết nguyên cấp, nguyên liệu rèn vũ khí Linh phẩm.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 80,
  },
  {
    key: 'yeu_dan',
    name: 'Yêu Đan',
    description: 'Đan tinh hạch của yêu thú trung cấp, nguyên liệu Huyền phẩm.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 250,
  },
  {
    key: 'phu_van_ngoc',
    name: 'Phù Văn Ngọc',
    description: 'Ngọc khắc phù văn cổ, nguyên liệu chế phù lục Huyền phẩm.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 280,
  },
  {
    key: 'han_ngoc',
    name: 'Hàn Ngọc',
    description: 'Ngọc lạnh ngàn năm, nguyên liệu hiếm Tiên phẩm.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 1200,
  },
  {
    key: 'tien_kim_sa',
    name: 'Tiên Kim Sa',
    description: 'Cát kim Tiên giới, nguyên liệu rèn Tiên khí.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 1600,
  },

  // ----- Vật phẩm đặc biệt (MISC) -----
  // Lưu ý: MISC chưa có runtime hook (key dungeon, transport scroll
  // sẽ được wire ở Phase 10 PR-3 dungeon pack hoặc PR-4 mission pack).
  // Hiện tại stub catalog để pre-allocate stable key.
  {
    key: 'son_coc_yeu_phu',
    name: 'Sơn Cốc Yêu Phù',
    description: 'Phù lệnh vào Sơn Cốc bí cảnh — bản thử nghiệm closed beta.',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    price: 100,
  },
  {
    key: 'hac_lam_yeu_phu',
    name: 'Hắc Lâm Yêu Phù',
    description: 'Phù lệnh vào Hắc Lâm bí cảnh, dành cho Trúc Cơ tu sĩ.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 250,
  },
  {
    key: 'yeu_thu_dong_phu',
    name: 'Yêu Thú Động Phù',
    description: 'Phù lệnh vào Yêu Thú Động, bí cảnh Kim Đan kỳ.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 600,
  },
  {
    key: 'tho_dia_phu',
    name: 'Thổ Địa Phù',
    description: 'Phù truyền tống về tông môn, hết khoá sau 1 lần dùng.',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    price: 80,
  },
  {
    key: 'bao_an_phu',
    name: 'Bảo An Phù',
    description: 'Phù bảo hộ, miễn 1 lần sát thương trí mạng (planned hook).',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 200,
  },

  // ----- Phase 10 PR-3 — Yêu phù cho dungeon Ngũ Hành mới -----
  // Stable key, stub PHẢI matching DUNGEONS.key (xem combat.ts). Hiện chưa wire
  // runtime check (DungeonRun service phase 11.5 sẽ enforce); catalog only.
  {
    key: 'kim_son_mach_phu',
    name: 'Kim Sơn Mạch Phù',
    description: 'Phù lệnh vào mỏ kim cổ — kim đan kỳ tu sĩ kiếm tinh thiết và kim ngọc.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 700,
  },
  {
    key: 'moc_huyen_lam_phu',
    name: 'Mộc Huyền Lâm Phù',
    description: 'Phù lệnh vào rừng cổ Mộc Huyền Lâm, dành cho Trúc Cơ tu sĩ luyện linh thảo.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 320,
  },
  {
    key: 'thuy_long_uyen_phu',
    name: 'Thuỷ Long Uyên Phù',
    description: 'Phù lệnh vào hồ sâu Thuỷ Long Uyên — Kim Đan kỳ luyện băng tinh và thuỷ ngọc.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 720,
  },
  {
    key: 'hoa_diem_son_phu',
    name: 'Hoả Diệm Sơn Phù',
    description: 'Phù lệnh vào núi lửa Hoả Diệm Sơn — Nguyên Anh kỳ luyện hoả tinh và Chu Tước trắc nghiệm.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 1500,
  },
  {
    key: 'hoang_tho_huyet_phu',
    name: 'Hoàng Thổ Huyệt Phù',
    description: 'Phù lệnh vào huyệt thổ ngàn năm — Nguyên Anh kỳ luyện thổ ngọc và Thạch Long.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 1450,
  },
  {
    key: 'cuu_la_dien_phu',
    name: 'Cửu La Điện Phù',
    description: 'Phù lệnh vào điện ma đạo Cửu La — Nguyên Anh đỉnh thử nghiệm tâm cảnh, hiếm.',
    kind: 'MISC',
    quality: 'THAN',
    stackable: true,
    price: 3200,
  },

  // ----- Phase 11.5.B Refine MVP runtime — protection charm -----
  // Consume khi refine fail ở stage `risky` / `extreme` (no-break path) để
  // ngăn level-loss. KHÔNG cứu được break ở extreme stage. Server-authoritative
  // qua `RefineService.refineEquipment(useProtection=true)`.
  {
    key: 'refine_protection_charm',
    name: 'Hộ Khí Phù',
    description: 'Phù bảo hộ luyện khí — miễn 1 lần rớt cấp khi refine fail. Không cứu được break ở extreme stage.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 500,
  },

  // ─────────────────────────────────────────────────────────────────────
  // Phase 11.2.D — Skill Book Pack 1 (Ngũ Hành sơ cấp, +5 entries)
  //
  // Mục tiêu: cho player nguồn rare để học 5 skill basic-tier theo Ngũ
  // Hành (Kim/Mộc/Thủy/Hỏa/Thổ) thay vì chỉ tự học khi đủ realm.
  // Mỗi book trỏ tới đúng 1 `SkillTemplate.key`. Quality LINH (price 1500
  // LT) — thấp hơn `linh_can_dan` (TIEN, 5000 LT) vì skill basic re-roll
  // ít quan trọng hơn linh căn.
  //
  // Server-authoritative consume: `POST /character/skill/learn-from-book
  // { inventoryItemId }` → `CharacterSkillService.learnFromBook` validate
  // unlocks (realm/sect/method) → `learn(skillKey, source='item_consume')`
  // idempotent qua P2002 → ALREADY_LEARNED. ItemLedger `SKILL_LEARN`
  // qtyDelta=-1 atomic cùng InventoryItem decrement.
  //
  // Drop sourcing (Phase 11.2.D+++ wired catalog only):
  //   - DUNGEON_LOOT 5 dungeon Ngũ Hành (kim_son_mach / moc_huyen_lam /
  //     thuy_long_uyen / hoa_diem_son / hoang_tho_huyet) match element,
  //     weight 3 (rare ~5% per default 2-roll run).
  //   - boss.lowDropPool tier ≥ Trúc Cơ match element (kim/moc/thuy/hoa/tho)
  //     + cross-element world boss endgame có cả 5 book (Phase 12 pity).
  // Lưu ý: DUNGEON_LOOT chưa wire vào reward path runtime (Phase 11.3.D+++
  // sẽ wire qua DungeonRunService); lowDropPool catalog metadata thuần
  // (Phase 12 BossRewardService sẽ wire share-ratio).
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'skill_book_kim_quang_tram',
    name: 'Bí Kíp: Kim Quang Trảm',
    description: 'Trục giấy linh ghi lại tâm pháp Kim Quang Trảm — đọc xong tan biến. Hệ Kim, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'kim_quang_tram' },
    price: 1500,
  },
  {
    key: 'skill_book_moc_linh_truong_dieu',
    name: 'Bí Kíp: Mộc Linh Trượng Diệu',
    description: 'Trục gỗ thanh môn ghi pháp tiêu Mộc Linh Trượng Diệu — đọc xong tan biến. Hệ Mộc, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'moc_linh_truong_dieu' },
    price: 1500,
  },
  {
    key: 'skill_book_thuy_kinh_phong_an',
    name: 'Bí Kíp: Thủy Kính Phong Ấn',
    description: 'Quyển ngọc băng thấu ghi tâm pháp Thủy Kính Phong Ấn — đọc xong tan biến. Hệ Thủy, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'thuy_kinh_phong_an' },
    price: 1500,
  },
  {
    key: 'skill_book_hoa_xa_phun_diem',
    name: 'Bí Kíp: Hỏa Xà Phun Diệm',
    description: 'Trục đồng đỏ ghi pháp quyết Hỏa Xà Phun Diệm — đọc xong tan biến. Hệ Hỏa, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'hoa_xa_phun_diem' },
    price: 1500,
  },
  {
    key: 'skill_book_thach_giap_ho_than',
    name: 'Bí Kíp: Thạch Giáp Hộ Thân',
    description: 'Trục đá thổ ghi pháp môn phòng ngự Thạch Giáp Hộ Thân — đọc xong tan biến. Hệ Thổ, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'thach_giap_ho_than' },
    price: 1500,
  },
];

export function itemByKey(key: string): ItemDef | undefined {
  return ITEMS.find((i) => i.key === key);
}

/** Drop table theo dungeon: list { itemKey, weight, qtyMin, qtyMax }. */
export interface LootEntry {
  itemKey: string;
  weight: number;
  qtyMin: number;
  qtyMax: number;
}

export const DUNGEON_LOOT: Record<string, readonly LootEntry[]> = {
  son_coc: [
    { itemKey: 'so_kiem', weight: 8, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'pham_giap', weight: 8, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_chi_dan', weight: 30, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'linh_lo_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
  ],
  hac_lam: [
    { itemKey: 'huyen_kiem', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'linh_giap', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'thanh_lam_dan', weight: 20, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'linh_lo_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'co_thien_dan', weight: 6, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_tinh', weight: 25, qtyMin: 1, qtyMax: 4 },
  ],
  yeu_thu_dong: [
    { itemKey: 'diem_phong_dao', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_phach_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'co_thien_dan', weight: 15, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'thanh_lam_dan', weight: 22, qtyMin: 1, qtyMax: 4 },
    { itemKey: 'huyet_tinh', weight: 35, qtyMin: 2, qtyMax: 6 },
  ],

  // ─────────────────────────────────────────────────────────────────────
  // Phase 10 PR-3 — Drop tables cho Dungeon Pack 1 (Ngũ Hành dungeons)
  // Loot strategy (BALANCE_MODEL.md §5.3):
  //   - Equipment HUYEN/TIEN drop weight 3-6 (low rate, ~10-15% chance/run)
  //   - Pill thường (HP/MP) weight 18-30 (consumable steady supply)
  //   - Material element-themed (linh_thao, tinh_thiet, han_ngoc, tien_kim_sa)
  //     weight 20-35 (chính nguồn craft material)
  // Phase 11.2.D+++ — skill_book_<element> drop weight 3 (rare, low pool):
  //   ~3 / total ≈ 2.5–2.8% per loot roll, default rollDungeonLoot count=2
  //   → ~5–5.5% per run; scope catalog metadata (DUNGEON_LOOT chưa wire vào
  //   reward path runtime — Phase 11.3.D+++ sẽ wire qua DungeonRunService).
  //   Element match dungeon → book element (kim_son_mach → kim, etc.) đảm
  //   bảo người chơi farm dungeon đúng hệ Linh Căn để học skill cùng hệ.
  // Lưu ý: chỉ dùng item keys đã có ở `ITEMS`; không tạo orphan reference.
  // ─────────────────────────────────────────────────────────────────────
  kim_son_mach: [
    // Element: kim → drop kim-themed weapon + tinh_thiet (kim material)
    { itemKey: 'lanh_phong_kiem', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'than_phong_kiem', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tinh_thiet', weight: 30, qtyMin: 2, qtyMax: 5 },
    { itemKey: 'co_thien_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'thanh_lam_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'huyet_tinh', weight: 25, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Kim, low weight rare
    { itemKey: 'skill_book_kim_quang_tram', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  moc_huyen_lam: [
    // Element: moc → linh_thao + lien_hoa_truong (mộc-themed)
    { itemKey: 'lien_hoa_truong', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'truc_co_truong', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'linh_thao', weight: 35, qtyMin: 3, qtyMax: 6 },
    { itemKey: 'thanh_lam_dan', weight: 25, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'linh_lo_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'huyet_chi_dan', weight: 28, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Mộc, low weight rare
    { itemKey: 'skill_book_moc_linh_truong_dieu', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  thuy_long_uyen: [
    // Element: thuy → han_ngoc + băng-themed
    { itemKey: 'han_thiet_giap', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'cuu_u_bi_thuong', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'han_ngoc', weight: 20, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'co_thien_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'tieu_phuc_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'huyet_tinh', weight: 28, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Thủy, low weight rare
    { itemKey: 'skill_book_thuy_kinh_phong_an', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  hoa_diem_son: [
    // Element: hoa → xich_huyet_dao + cuu_la_giap + yeu_dan (hoả material)
    { itemKey: 'xich_huyet_dao', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'cuu_la_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tu_la_dao', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'yeu_dan', weight: 25, qtyMin: 2, qtyMax: 5 },
    { itemKey: 'cuu_huyen_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'co_thien_dan', weight: 18, qtyMin: 2, qtyMax: 4 },
    // Phase 11.2.D+++ — skill book hệ Hỏa, low weight rare
    { itemKey: 'skill_book_hoa_xa_phun_diem', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  hoang_tho_huyet: [
    // Element: tho → than_lan_giap + yeu_phach_giap + phu_van_ngoc (thổ material)
    { itemKey: 'than_lan_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'yeu_phach_giap', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'phu_van_ngoc', weight: 22, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'tinh_thiet', weight: 25, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'cuu_huyen_dan', weight: 14, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'tieu_phuc_dan', weight: 18, qtyMin: 2, qtyMax: 4 },
    // Phase 11.2.D+++ — skill book hệ Thổ, low weight rare
    { itemKey: 'skill_book_thach_giap_ho_than', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  cuu_la_dien: [
    // Single-boss endgame instance, drop hiếm THAN + TIEN
    { itemKey: 'than_dan', weight: 1, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_huyen_kiem', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_huyen_giap', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_kim_sa', weight: 8, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'so_huyen_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'cuu_thien_dan', weight: 6, qtyMin: 1, qtyMax: 1 },
    // Phase 11.3.D++ — dungeon hậu kỳ (Cửu La Điện single-boss endgame) drop
    // `linh_can_dan` rare. Weight 1 trong tổng ~31 → ~3.2% per loot roll
    // (rollDungeonLoot mặc định 2 lần → ~6.3% per run). Cùng drop chain với
    // boss world ≥ Hóa Thần, đảm bảo end-game player có dual source.
    { itemKey: 'linh_can_dan', weight: 1, qtyMin: 1, qtyMax: 1 },
  ],
};

export interface RolledLoot {
  itemKey: string;
  qty: number;
}

/** Roll 1-2 entry từ drop table, áp dụng weight. */
export function rollDungeonLoot(dungeonKey: string, count = 2): RolledLoot[] {
  const table = DUNGEON_LOOT[dungeonKey];
  if (!table || table.length === 0) return [];
  const total = table.reduce((s, e) => s + e.weight, 0);
  const out: RolledLoot[] = [];
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total;
    for (const entry of table) {
      r -= entry.weight;
      if (r <= 0) {
        const qty =
          entry.qtyMin + Math.floor(Math.random() * (entry.qtyMax - entry.qtyMin + 1));
        out.push({ itemKey: entry.itemKey, qty });
        break;
      }
    }
  }
  return out;
}

export const QUALITY_COLOR: Record<Quality, string> = {
  PHAM: 'text-ink-200',
  LINH: 'text-emerald-300',
  HUYEN: 'text-sky-300',
  TIEN: 'text-violet-300',
  THAN: 'text-amber-300',
};

export const QUALITY_LABEL_VI: Record<Quality, string> = {
  PHAM: 'Phàm',
  LINH: 'Linh',
  HUYEN: 'Huyền',
  TIEN: 'Tiên',
  THAN: 'Thần',
};
