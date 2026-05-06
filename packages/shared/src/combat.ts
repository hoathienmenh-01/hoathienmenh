/**
 * Combat constants & formulas — Phase 3.
 *
 * Mô hình text-mode đơn giản:
 *   damage = max(1, atk * (1 + skillBonus) - def * 0.5) * (rand 0.85..1.15)
 */

/**
 * Loại quái — phase 10 PR-3 forward-compat metadata. Phase 11 boss/dungeon
 * room generator dùng `monsterType` để compose encounter (e.g. ELITE = mid
 * room, BOSS = end room) và pick AI moveset theo `role`.
 *
 * `BEAST` = yêu thú thuần loài; `HUMANOID` = ma đạo / tu sĩ phản phái;
 * `SPIRIT` = hồn thể / kỳ trận; `BOSS` = trùm cuối instance; `ELITE` =
 * tinh anh giữa dungeon (giữa BEAST và BOSS).
 */
export type MonsterType = 'BEAST' | 'HUMANOID' | 'SPIRIT' | 'ELITE' | 'BOSS';

export const MONSTER_TYPES: readonly MonsterType[] = [
  'BEAST',
  'HUMANOID',
  'SPIRIT',
  'ELITE',
  'BOSS',
];

export interface MonsterDef {
  key: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  expDrop: number;
  /** linh thạch drop, lưu thành bigint string. */
  linhThachDrop: number;
  /**
   * **Forward-compat phase 10 PR-3** — Ngũ Hành affinity của monster.
   * Combat runtime hiện KHÔNG đọc `element`; phase 11.3 sẽ wire qua
   * `elementMultiplier(skill.element, target.element)` ở `BALANCE_MODEL.md`
   * §4.2. `null` = không hệ (thuần ngẫu nhiên / vô tướng).
   */
  element?: ElementKey | null;
  /**
   * Loại quái — phase 10 PR-3 metadata. Default `BEAST` cho legacy entry.
   */
  monsterType?: MonsterType;
  /**
   * Region key — phase 10 PR-3 grouping (`son_coc` / `hac_lam` / `yeu_thu_dong` /
   * `kim_son_mach` / `moc_huyen_lam` / `thuy_long_uyen` / `hoa_diem_son` /
   * `hoang_tho_huyet`). Phase 12 sẽ dùng để build map UI.
   */
  regionKey?: string | null;
  /**
   * **Phase 12 Story PR-6** — danh sách quest placeholder targetId mà monster
   * này hoàn thành khi bị kill. Cho phép quest catalog dùng tên placeholder
   * trừu tượng (vd `son_thu`, `bac_lang_quan`) trong khi monster catalog dùng
   * tên cụ thể (vd `son_thu_lon`, `huyet_lang`). `CombatService` kill hook sẽ
   * gọi `QuestService.track(charId, 'kill', 'monster', id, 1)` cho **mỗi**
   * `id ∈ [monster.key, ...questTargetIds]` — tránh double-counting khi
   * placeholder + real key trùng. Không định nghĩa = chỉ track key gốc.
   */
  questTargetIds?: string[];
}

export interface DungeonDef {
  key: string;
  name: string;
  description: string;
  /** Cảnh giới đề nghị (key) — chỉ là gợi ý, không cản. */
  recommendedRealm: string;
  /** Đường đi quái: list key theo thứ tự. */
  monsters: string[];
  /** Stamina cần để mở instance. */
  staminaEntry: number;
  /**
   * **Forward-compat phase 10 PR-3** — Ngũ Hành theme của dungeon. Phase 11.5
   * sẽ dùng để (a) trigger element-bonus drop ngọc cùng hệ, (b) gợi ý player
   * tránh dungeon mà spiritualRoot bị khắc, (c) UI badge màu.
   */
  element?: ElementKey | null;
  /** Region key — phase 10 PR-3 grouping. */
  regionKey?: string | null;
  /**
   * Daily entry limit — phase 10 PR-3 metadata. Phase 11.5 (`DungeonRun`
   * service) sẽ enforce; hiện tại catalog only.
   */
  dailyLimit?: number;
}

export const MONSTERS: readonly MonsterDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // Region: Sơn Cốc (Thổ/Mộc, luyện khí early)
  // ─────────────────────────────────────────────────────────────────────
  { key: 'son_thu_lon',  name: 'Sơn Thử Lớn',     level: 1, hp: 30,  atk: 6,  def: 2,  speed: 6, expDrop: 12,  linhThachDrop: 5,  element: 'tho', monsterType: 'BEAST', regionKey: 'son_coc', questTargetIds: ['son_thu'] },
  { key: 'da_quan',      name: 'Đá Quan Yêu Tinh', level: 2, hp: 55,  atk: 9,  def: 4,  speed: 5, expDrop: 25,  linhThachDrop: 9,  element: 'tho', monsterType: 'BEAST', regionKey: 'son_coc', questTargetIds: ['son_tac_dau_muc'] },
  { key: 'huyet_lang',   name: 'Huyết Lang',      level: 3, hp: 80,  atk: 14, def: 5,  speed: 9, expDrop: 45,  linhThachDrop: 15, element: null,  monsterType: 'BEAST', regionKey: 'son_coc', questTargetIds: ['bac_lang_quan'] },

  // ─────────────────────────────────────────────────────────────────────
  // Region: Hắc Lâm (Mộc/âm khí, luyện khí cao / trúc cơ)
  // ─────────────────────────────────────────────────────────────────────
  { key: 'hac_yeu_xa',   name: 'Hắc Yêu Xà',      level: 5, hp: 140, atk: 22, def: 8,  speed: 11, expDrop: 90,  linhThachDrop: 28, element: 'moc',  monsterType: 'BEAST',    regionKey: 'hac_lam', questTargetIds: ['hac_moc_yeu'] },
  { key: 'thi_quy',      name: 'Thi Quỷ',         level: 6, hp: 200, atk: 28, def: 12, speed: 8,  expDrop: 130, linhThachDrop: 40, element: null,   monsterType: 'SPIRIT',   regionKey: 'hac_lam' },
  { key: 'hac_lam_ma',   name: 'Hắc Lâm Ma',      level: 8, hp: 320, atk: 38, def: 18, speed: 12, expDrop: 220, linhThachDrop: 65, element: 'moc',  monsterType: 'HUMANOID', regionKey: 'hac_lam' },

  // ─────────────────────────────────────────────────────────────────────
  // Region: Yêu Thú Động (Thổ/Kim, trúc cơ / kim đan)
  // ─────────────────────────────────────────────────────────────────────
  { key: 'kim_giap_thu',   name: 'Kim Giáp Thú',    level: 10, hp: 480, atk: 52,  def: 28, speed: 11, expDrop: 360, linhThachDrop: 100, element: 'kim', monsterType: 'BEAST', regionKey: 'yeu_thu_dong' },
  { key: 'huyen_quy',      name: 'Huyền Quy',       level: 12, hp: 700, atk: 60,  def: 45, speed: 6,  expDrop: 520, linhThachDrop: 140, element: 'tho', monsterType: 'BEAST', regionKey: 'yeu_thu_dong' },
  { key: 'yeu_long_tieu',  name: 'Yêu Long Tiểu',   level: 15, hp: 980, atk: 86,  def: 38, speed: 14, expDrop: 800, linhThachDrop: 220, element: null,  monsterType: 'BOSS',  regionKey: 'yeu_thu_dong' },

  // ═════════════════════════════════════════════════════════════════════
  // Phase 10 PR-3 — Monster Pack 1 (+20 monster, Ngũ Hành element)
  //
  // Curve check (BALANCE_MODEL.md §5.1):
  //   tier early   level  1- 9  hp   30- 350 atk  6- 40 def  2- 20
  //   tier mid     level 10-25  hp  500-3000 atk 50-180 def 25-110
  //   tier mid+    level 26-40  hp 3500-9000 atk 200-450 def 120-260
  //   ELITE = +30% hp/atk so với BEAST cùng level; BOSS = +60% hp +40% atk
  // ═════════════════════════════════════════════════════════════════════

  // Region: Kim Sơn Mạch (Hệ KIM, trúc cơ → kim đan; mỏ kim)
  { key: 'kim_quang_thach_giap', name: 'Kim Quang Thạch Giáp', level: 7,  hp: 230,  atk: 26, def: 20, speed: 7,  expDrop: 165,  linhThachDrop: 48,  element: 'kim', monsterType: 'BEAST',    regionKey: 'kim_son_mach', questTargetIds: ['kim_son_yeu'] },
  { key: 'huyen_kim_lang_thu',   name: 'Huyền Kim Lang Thử',   level: 9,  hp: 360,  atk: 42, def: 22, speed: 13, expDrop: 280,  linhThachDrop: 80,  element: 'kim', monsterType: 'BEAST',    regionKey: 'kim_son_mach' },
  { key: 'tinh_thiet_kiem_linh', name: 'Tinh Thiết Kiếm Linh', level: 11, hp: 570,  atk: 70, def: 26, speed: 12, expDrop: 430,  linhThachDrop: 125, element: 'kim', monsterType: 'SPIRIT',   regionKey: 'kim_son_mach' },
  { key: 'kim_dieu_thuong_phong',name: 'Kim Điêu Thượng Phong',level: 14, hp: 920,  atk: 105,def: 42, speed: 16, expDrop: 720,  linhThachDrop: 195, element: 'kim', monsterType: 'ELITE',    regionKey: 'kim_son_mach', questTargetIds: ['kim_dan_yeu_thu'] },

  // Region: Mộc Huyền Lâm (Hệ MỘC, luyện khí cao → trúc cơ; rừng cổ)
  { key: 'thanh_mang_xa',        name: 'Thanh Mang Xà',        level: 4,  hp: 110,  atk: 17, def: 6,  speed: 12, expDrop: 60,   linhThachDrop: 22, element: 'moc', monsterType: 'BEAST',    regionKey: 'moc_huyen_lam' },
  { key: 'tang_diep_yeu_phu',    name: 'Tàng Diệp Yêu Phụ',    level: 6,  hp: 180,  atk: 24, def: 11, speed: 9,  expDrop: 115,  linhThachDrop: 34, element: 'moc', monsterType: 'HUMANOID', regionKey: 'moc_huyen_lam' },
  { key: 'co_thu_chi_linh',      name: 'Cổ Thụ Chi Linh',      level: 8,  hp: 320,  atk: 30, def: 28, speed: 5,  expDrop: 215,  linhThachDrop: 60, element: 'moc', monsterType: 'SPIRIT',   regionKey: 'moc_huyen_lam' },
  { key: 'thien_la_co_yeu',      name: 'Thiên La Cổ Yêu',      level: 11, hp: 620,  atk: 64, def: 32, speed: 10, expDrop: 460,  linhThachDrop: 130,element: 'moc', monsterType: 'ELITE',    regionKey: 'moc_huyen_lam' },

  // Region: Thuỷ Long Uyên (Hệ THUỶ, trúc cơ → kim đan; hồ sâu)
  { key: 'thuy_lan_yeu',         name: 'Thuỷ Lân Yêu',         level: 6,  hp: 195,  atk: 25, def: 10, speed: 12, expDrop: 125,  linhThachDrop: 38, element: 'thuy', monsterType: 'BEAST',    regionKey: 'thuy_long_uyen' },
  { key: 'han_tinh_quy_phach',   name: 'Hàn Tinh Quỷ Phách',   level: 9,  hp: 380,  atk: 44, def: 22, speed: 11, expDrop: 290,  linhThachDrop: 88, element: 'thuy', monsterType: 'SPIRIT',   regionKey: 'thuy_long_uyen' },
  { key: 'huyen_thuy_giao_long', name: 'Huyền Thuỷ Giao Long', level: 13, hp: 820,  atk: 95, def: 42, speed: 14, expDrop: 640,  linhThachDrop: 175,element: 'thuy', monsterType: 'ELITE',    regionKey: 'thuy_long_uyen' },
  { key: 'thuy_thanh_long_vuong',name: 'Thuỷ Thanh Long Vương',level: 17, hp: 1450, atk: 140,def: 56, speed: 13, expDrop: 1100, linhThachDrop: 320,element: 'thuy', monsterType: 'BOSS',     regionKey: 'thuy_long_uyen' },

  // Region: Hoả Diệm Sơn (Hệ HOẢ, kim đan → nguyên anh; núi lửa)
  { key: 'hoa_yen_thu',          name: 'Hoả Yến Thử',          level: 9,  hp: 320,  atk: 50, def: 14, speed: 15, expDrop: 240,  linhThachDrop: 70, element: 'hoa', monsterType: 'BEAST',    regionKey: 'hoa_diem_son' },
  { key: 'xich_diem_yeu_xa',     name: 'Xích Diệm Yêu Xà',     level: 12, hp: 580,  atk: 78, def: 30, speed: 14, expDrop: 470,  linhThachDrop: 145,element: 'hoa', monsterType: 'BEAST',    regionKey: 'hoa_diem_son' },
  { key: 'hoa_long_chi_linh',    name: 'Hoả Long Chi Linh',    level: 16, hp: 1280, atk: 130,def: 50, speed: 13, expDrop: 990,  linhThachDrop: 270,element: 'hoa', monsterType: 'ELITE',    regionKey: 'hoa_diem_son' },
  { key: 'chu_tuoc_huyet_dieu',  name: 'Chu Tước Huyết Điêu',  level: 19, hp: 1800, atk: 175,def: 65, speed: 17, expDrop: 1450, linhThachDrop: 410,element: 'hoa', monsterType: 'BOSS',     regionKey: 'hoa_diem_son' },

  // Region: Hoàng Thổ Huyệt (Hệ THỔ, kim đan → nguyên anh; mỏ thổ + tank)
  { key: 'thach_quang_yeu_thu',  name: 'Thạch Quang Yêu Thú',  level: 10, hp: 540,  atk: 48, def: 50, speed: 5,  expDrop: 380,  linhThachDrop: 110,element: 'tho', monsterType: 'BEAST',    regionKey: 'hoang_tho_huyet' },
  { key: 'hoang_tho_cu_yeu',     name: 'Hoàng Thổ Cự Yêu',     level: 13, hp: 880,  atk: 78, def: 70, speed: 6,  expDrop: 660,  linhThachDrop: 180,element: 'tho', monsterType: 'ELITE',    regionKey: 'hoang_tho_huyet', questTargetIds: ['hoang_tho_quy'] },
  { key: 'thach_long_co_giap',   name: 'Thạch Long Cổ Giáp',   level: 17, hp: 1500, atk: 130,def: 110,speed: 7,  expDrop: 1180, linhThachDrop: 330,element: 'tho', monsterType: 'BOSS',     regionKey: 'hoang_tho_huyet' },
  { key: 'tho_dia_lao_tu',       name: 'Thổ Địa Lão Tử',       level: 20, hp: 2200, atk: 165,def: 130,speed: 8,  expDrop: 1700, linhThachDrop: 480,element: 'tho', monsterType: 'BOSS',     regionKey: 'hoang_tho_huyet' },

  // Phase-10 cross-region BOSS (mid-late, kim đan đỉnh, mixed encounter)
  { key: 'cuu_la_huyen_quan',    name: 'Cửu La Huyền Quân',    level: 18, hp: 1700, atk: 160,def: 80, speed: 14, expDrop: 1380, linhThachDrop: 390,element: 'kim',  monsterType: 'BOSS',    regionKey: 'kim_son_mach' },
];

export function monsterByKey(key: string): MonsterDef | undefined {
  return MONSTERS.find((m) => m.key === key);
}

export const DUNGEONS: readonly DungeonDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // Legacy dungeons (Phase 4 baseline, +regionKey/element metadata phase 10 PR-3)
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'son_coc',
    name: 'Sơn Cốc',
    description: 'Sơn cốc xanh thẳm, yêu thú nhỏ phù hợp đạo hữu mới luyện khí.',
    recommendedRealm: 'luyenkhi',
    monsters: ['son_thu_lon', 'da_quan', 'huyet_lang'],
    staminaEntry: 10,
    element: 'tho',
    regionKey: 'son_coc',
    dailyLimit: 5,
  },
  {
    key: 'hac_lam',
    name: 'Hắc Lâm',
    description: 'Hắc lâm âm khí dày đặc, thi quỷ và yêu xà nương bóng tối.',
    recommendedRealm: 'truc_co',
    monsters: ['hac_yeu_xa', 'thi_quy', 'hac_lam_ma'],
    staminaEntry: 18,
    element: 'moc',
    regionKey: 'hac_lam',
    dailyLimit: 4,
  },
  {
    key: 'yeu_thu_dong',
    name: 'Yêu Thú Động',
    description: 'Hang yêu thú thượng cổ — chỉ kim đan trở lên mới sống sót.',
    recommendedRealm: 'kim_dan',
    monsters: ['kim_giap_thu', 'huyen_quy', 'yeu_long_tieu'],
    staminaEntry: 28,
    element: 'kim',
    regionKey: 'yeu_thu_dong',
    dailyLimit: 3,
  },

  // ═════════════════════════════════════════════════════════════════════
  // Phase 10 PR-3 — Dungeon Pack 1 (+6 dungeon, theo Ngũ Hành region map)
  //
  // Stamina curve (BALANCE_MODEL.md §5.1):
  //   luyenkhi  → 10 (existing son_coc)
  //   truc_co   → 18 (existing hac_lam) / 22 (moc_huyen_lam)
  //   kim_dan   → 28 (existing yeu_thu_dong) / 32 (kim_son_mach, thuy_long_uyen)
  //   nguyen_anh → 42 (hoa_diem_son) / 48 (hoang_tho_huyet) / 60 (cuu_la_dien)
  // ═════════════════════════════════════════════════════════════════════
  {
    key: 'kim_son_mach',
    name: 'Kim Sơn Mạch',
    description: 'Mỏ kim cổ xưa — kiếm linh và kim quang thạch giáp tuần ranh, đồng tử kim quang chỉ rõ kẻ trộm tinh thiết.',
    recommendedRealm: 'kim_dan',
    monsters: ['kim_quang_thach_giap', 'huyen_kim_lang_thu', 'tinh_thiet_kiem_linh', 'kim_dieu_thuong_phong'],
    staminaEntry: 32,
    element: 'kim',
    regionKey: 'kim_son_mach',
    dailyLimit: 3,
  },
  {
    key: 'moc_huyen_lam',
    name: 'Mộc Huyền Lâm',
    description: 'Rừng cổ thiên niên — cổ thụ chi linh và thiên la cổ yêu nương theo huyết khí ngàn năm.',
    recommendedRealm: 'truc_co',
    monsters: ['thanh_mang_xa', 'tang_diep_yeu_phu', 'co_thu_chi_linh', 'thien_la_co_yeu'],
    staminaEntry: 22,
    element: 'moc',
    regionKey: 'moc_huyen_lam',
    dailyLimit: 4,
  },
  {
    key: 'thuy_long_uyen',
    name: 'Thuỷ Long Uyên',
    description: 'Long uyên hồ sâu vạn trượng — Giao Long ẩn tích, Thuỷ Thanh Long Vương trấn giữ băng tinh.',
    recommendedRealm: 'kim_dan',
    monsters: ['thuy_lan_yeu', 'han_tinh_quy_phach', 'huyen_thuy_giao_long', 'thuy_thanh_long_vuong'],
    staminaEntry: 32,
    element: 'thuy',
    regionKey: 'thuy_long_uyen',
    dailyLimit: 3,
  },
  {
    key: 'hoa_diem_son',
    name: 'Hoả Diệm Sơn',
    description: 'Núi lửa thiêu thiên — Chu Tước Huyết Điêu thiêu đốt vạn vật, đan sĩ luyện hoả tinh.',
    recommendedRealm: 'nguyen_anh',
    monsters: ['hoa_yen_thu', 'xich_diem_yeu_xa', 'hoa_long_chi_linh', 'chu_tuoc_huyet_dieu'],
    staminaEntry: 42,
    element: 'hoa',
    regionKey: 'hoa_diem_son',
    dailyLimit: 2,
  },
  {
    key: 'hoang_tho_huyet',
    name: 'Hoàng Thổ Huyệt',
    description: 'Huyệt thổ ngàn năm — Thạch Long Cổ Giáp và Thổ Địa Lão Tử trấn giữ kho tàng địa mạch.',
    recommendedRealm: 'nguyen_anh',
    monsters: ['thach_quang_yeu_thu', 'hoang_tho_cu_yeu', 'thach_long_co_giap', 'tho_dia_lao_tu'],
    staminaEntry: 48,
    element: 'tho',
    regionKey: 'hoang_tho_huyet',
    dailyLimit: 2,
  },
  {
    key: 'cuu_la_dien',
    name: 'Cửu La Điện',
    description: 'Điện ma đạo cổ — Cửu La Huyền Quân trấn giữ, dành cho tu sĩ kim đan đỉnh thử nghiệm tâm cảnh.',
    recommendedRealm: 'nguyen_anh',
    monsters: ['cuu_la_huyen_quan'],
    staminaEntry: 60,
    element: 'kim',
    regionKey: 'kim_son_mach',
    dailyLimit: 1,
  },
];

export function dungeonByKey(key: string): DungeonDef | undefined {
  return DUNGEONS.find((d) => d.key === key);
}

/**
 * Phase 10 PR-3 helper — filter monster theo Ngũ Hành element. `null` =
 * monster vô hệ. Phase 11.3 (`elementMultiplier`) sẽ cần helper này khi
 * compose AI moveset target preference.
 */
export function monstersByElement(
  element: ElementKey | null,
): MonsterDef[] {
  return MONSTERS.filter((m) => (m.element ?? null) === element);
}

/** Phase 10 PR-3 helper — filter dungeon theo Ngũ Hành element. */
export function dungeonsByElement(
  element: ElementKey | null,
): DungeonDef[] {
  return DUNGEONS.filter((d) => (d.element ?? null) === element);
}

/** Phase 10 PR-3 helper — filter monster theo regionKey (UI map view). */
export function monstersByRegion(regionKey: string): MonsterDef[] {
  return MONSTERS.filter((m) => m.regionKey === regionKey);
}

/** Phase 10 PR-3 helper — filter dungeon theo regionKey. */
export function dungeonsByRegion(regionKey: string): DungeonDef[] {
  return DUNGEONS.filter((d) => d.regionKey === regionKey);
}

export type SectKey = 'thanh_van' | 'huyen_thuy' | 'tu_la';

/**
 * Ngũ Hành — phase 10 PR-2 catalog field, **forward-compat** cho phase 11
 * `Linh căn / Spiritual Root` + `elementMultiplier(skill, target)` ở
 * `BALANCE_MODEL.md` §4.2.
 *
 * Hiện trạng PR-2: chỉ là metadata; combat runtime (`combat.service.ts`)
 * KHÔNG đọc `element` (giữ formula `damage = atk * scale - def * 0.5` như
 * cũ). Khi phase 11.3 (`Character.spiritualRoot`) merge, combat sẽ lookup
 * `element` để tính `kim hắc mộc` (Kim ↔ Mộc), `mộc hắc thổ` (Mộc ↔ Thổ),
 * `thổ hắc thuỷ` (Thổ ↔ Thuỷ), `thuỷ hắc hoả` (Thuỷ ↔ Hoả), `hoả hắc kim`
 * (Hoả ↔ Kim) — chu kỳ tương khắc cổ điển.
 */
export type ElementKey = 'kim' | 'moc' | 'thuy' | 'hoa' | 'tho';

export const ELEMENTS: readonly ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];

/**
 * Loại skill — PASSIVE chỉ là catalog entry phase 10, được phase 11.8
 * (Buff/Debuff system) áp dụng tự động khi `skillKey ∈ characterPassives`.
 * Combat picker FE chỉ show ACTIVE (xem `activeSkillsForSect`).
 */
export type SkillType = 'ACTIVE' | 'PASSIVE';

/**
 * Vai trò skill — UI phân loại + AI moveset compose (phase 10 PR-3 monster
 * pack sẽ pick skill theo role).
 */
export type SkillRole = 'DAMAGE' | 'HEAL' | 'BUFF' | 'DEBUFF' | 'CONTROL' | 'UTILITY';

export const SKILL_ROLES: readonly SkillRole[] = [
  'DAMAGE',
  'HEAL',
  'BUFF',
  'DEBUFF',
  'CONTROL',
  'UTILITY',
];

export interface SkillDef {
  key: string;
  name: string;
  description: string;
  /** mp cần để dùng. */
  mpCost: number;
  /** Hệ số nhân atk gốc. 1.0 = đòn thường. */
  atkScale: number;
  /** Hệ số hồi HP của bản thân (% hpMax). 0 = không hồi. */
  selfHealRatio: number;
  /** % hp bản thân tự trừ (huyết tế). */
  selfBloodCost: number;
  /** Sect sở hữu (null = ai cũng dùng). */
  sect: SectKey | null;
  /**
   * Ngũ Hành — `null` = vô hệ (basic / utility). Forward-compat phase 11
   * Spiritual Root. Combat runtime hiện chưa dùng — chỉ metadata.
   */
  element?: ElementKey | null;
  /** ACTIVE (default) hoặc PASSIVE. PASSIVE không hiển thị ở picker FE. */
  type?: SkillType;
  /** Vai trò UI / AI moveset compose. Default 'DAMAGE' nếu atkScale > 0. */
  role?: SkillRole;
  /**
   * Realm key sớm nhất unlock — null = mọi realm. Tham chiếu `realms.ts`.
   * Hiện trạng: metadata; phase 11.2 (`CharacterSkill` DB) sẽ enforce.
   */
  unlockRealm?: string | null;
  /**
   * Cooldown turn sau khi dùng (BALANCE_MODEL §4.3). 0 = no cooldown.
   * Default 0 — combat runtime hiện chưa enforce; phase 11 sẽ wire.
   */
  cooldownTurns?: number;
}

export const SKILL_BASIC_ATTACK: SkillDef = {
  key: 'basic_attack',
  name: 'Đòn Thường',
  description: 'Một chiêu cơ bản, không tốn linh khí.',
  mpCost: 0,
  atkScale: 1,
  selfHealRatio: 0,
  selfBloodCost: 0,
  sect: null,
};

export const SKILLS: readonly SkillDef[] = [
  SKILL_BASIC_ATTACK,
  {
    key: 'kiem_khi_chem',
    name: 'Kiếm Khí Trảm',
    description: 'Một đạo kiếm khí xé ngang trời — sát thương lớn, tốn 12 MP.',
    mpCost: 12,
    atkScale: 1.7,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: 'thanh_van',
  },
  {
    key: 'thuy_tieu_phu',
    name: 'Thuỷ Tiêu Phù',
    description: 'Phù thuỷ giúp ngừng chảy máu, hồi 25% HP, tốn 18 MP.',
    mpCost: 18,
    atkScale: 0.6,
    selfHealRatio: 0.25,
    selfBloodCost: 0,
    sect: 'huyen_thuy',
  },
  {
    key: 'huyet_te_chi_thuat',
    name: 'Huyết Tế Chi Thuật',
    description: 'Lấy 10% HP đổi sát thương cuồng bạo (×2.4), tốn 8 MP.',
    mpCost: 8,
    atkScale: 2.4,
    selfHealRatio: 0,
    selfBloodCost: 0.1,
    sect: 'tu_la',
  },
  // Thanh Vân — chiêu thượng thừa
  {
    key: 'tu_hanh_kiem_quyet',
    name: 'Tứ Hành Kiếm Quyết',
    description: 'Bốn đường kiếm dồn dập, sát thương mạnh, tốn 25 MP.',
    mpCost: 25,
    atkScale: 2.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: 'thanh_van',
  },
  {
    key: 'van_kiem_quy_tong',
    name: 'Vạn Kiếm Quy Tông',
    description: 'Tuyệt kỹ Thanh Vân — triệu vạn kiếm, sát thương bạo liệt, tốn 48 MP.',
    mpCost: 48,
    atkScale: 3.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: 'thanh_van',
  },
  // Huyền Thuỷ — tu tâm dưỡng tính
  {
    key: 'huyen_bang_khoa_tran',
    name: 'Huyền Băng Khoá Trận',
    description: 'Phong ấn đối thủ bằng băng linh, gây 1.4× sát thương, tốn 22 MP.',
    mpCost: 22,
    atkScale: 1.4,
    selfHealRatio: 0.15,
    selfBloodCost: 0,
    sect: 'huyen_thuy',
  },
  {
    key: 'thanh_lien_hoan_sinh',
    name: 'Thanh Liên Hoàn Sinh',
    description: 'Tuyệt kỹ cứu mạng — hồi 50% HP, tốn 45 MP.',
    mpCost: 45,
    atkScale: 0,
    selfHealRatio: 0.5,
    selfBloodCost: 0,
    sect: 'huyen_thuy',
  },
  // Tu La — tà đạo
  {
    key: 'tu_la_chan_that',
    name: 'Tu La Chân Thật',
    description: 'Đốt 20% HP, sát thương ×3.2, tốn 20 MP.',
    mpCost: 20,
    atkScale: 3.2,
    selfHealRatio: 0,
    selfBloodCost: 0.2,
    sect: 'tu_la',
  },
  {
    key: 'huyet_ma_giang_the',
    name: 'Huyết Ma Giáng Thế',
    description: 'Tuyệt kỹ Tu La — triệu huyết ma, sát thương ×4.5, đổi 30% HP, tốn 50 MP.',
    mpCost: 50,
    atkScale: 4.5,
    selfHealRatio: 0,
    selfBloodCost: 0.3,
    sect: 'tu_la',
  },

  // ===================================================================
  // Phase 10 PR-2 — Skill Pack 1 (+15 skill, Ngũ Hành)
  //
  // Mục tiêu: lấp 5 hệ Kim/Mộc/Thuỷ/Hoả/Thổ × (≥1 active + ≥1 passive)
  // làm pool cho phase 11 Spiritual Root + Elemental Combat. Stat budget
  // tuân `BALANCE_MODEL.md` §4: atkScale ≤ 5, mpCost reasonable per
  // unlockRealm tier (luyenkhi mpMax ~50 → cap 20, truc_co ~150 → 40,
  // kim_dan ~300 → 80), selfHealRatio ≤ 0.5, selfBloodCost ≤ 0.30.
  //
  // Tier mục tiêu (early → mid):
  //   active light (atkScale 1.4–1.7)  → unlockRealm: luyenkhi
  //   active heavy (atkScale 2.4–3.0)  → unlockRealm: truc_co
  //   passive               (atkScale 0) → unlockRealm: luyenkhi/truc_co
  //
  // Combat runtime KHÔNG đọc `element` ở PR này — element/role/type chỉ
  // là metadata forward-compat (xem comment trên `SkillDef`). Test bound
  // trong `skills-balance.test.ts` (deterministic guard).
  // ===================================================================

  // ----- Vô hệ — basic util (early game, ai cũng dùng) -----
  {
    key: 'ngung_thien_chuong',
    name: 'Ngưng Thiên Chưởng',
    description: 'Thuỷ chưởng cơ bản, vận khí qua đan điền — sát thương 1.4×, tốn 6 MP.',
    mpCost: 6,
    atkScale: 1.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ----- Hệ KIM (kim → mộc) -----
  // Sát thương xuyên giáp + buff atk passive.
  {
    key: 'kim_quang_tram',
    name: 'Kim Quang Trảm',
    description: 'Đạo kim quang sắc lạnh xuyên giáp địch — sát thương 1.7×, tốn 12 MP.',
    mpCost: 12,
    atkScale: 1.7,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 1,
  },
  {
    key: 'kim_phong_phap_quyet',
    name: 'Kim Phong Pháp Quyết',
    description: 'Pháp quyết Trúc Cơ — vạn mảnh kim phong xé tan đối thủ, sát thương 2.5×, tốn 28 MP.',
    mpCost: 28,
    atkScale: 2.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },
  {
    key: 'kim_cuong_huyen_the',
    name: 'Kim Cương Huyền Thể',
    description: 'Bí thuật Kim hệ — luyện thân thể như kim cương, gia tăng sát thương xuyên giáp lâu dài (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 0,
  },

  // ----- Hệ MỘC (mộc → thổ) -----
  // Hồi máu + DOT độc tố + regen passive.
  {
    key: 'moc_linh_truong_dieu',
    name: 'Mộc Linh Trướng Diệu',
    description: 'Linh khí mộc hệ bao phủ thân — sát thương nhẹ 1.2× và hồi 15% HP, tốn 14 MP.',
    mpCost: 14,
    atkScale: 1.2,
    selfHealRatio: 0.15,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 2,
  },
  {
    key: 'doc_lam_phu_mao',
    name: 'Độc Lâm Phù Mão',
    description: 'Phù chú mộc độc gieo lên địch — sát thương 1.5× kèm tiêu hao tinh khí dài hạn, tốn 20 MP.',
    mpCost: 20,
    atkScale: 1.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'DEBUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 2,
  },
  {
    key: 'thanh_moc_hoi_xuan',
    name: 'Thanh Mộc Hồi Xuân',
    description: 'Mộc khí xanh tươi tự động hồi linh khí mỗi lượt cho người tu Mộc hệ (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ----- Hệ THUỶ (thuỷ → hoả) -----
  // Control freeze + heal-self + speed passive.
  {
    key: 'thuy_kinh_phong_an',
    name: 'Thuỷ Kính Phong Ấn',
    description: 'Băng kính phong toả đối thủ một lượt — sát thương 1.5×, tốn 18 MP.',
    mpCost: 18,
    atkScale: 1.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 2,
  },
  {
    key: 'huyen_thuy_quan_dinh',
    name: 'Huyền Thuỷ Quán Đỉnh',
    description: 'Thuỷ linh quán đỉnh — sát thương 0.8× và hồi 30% HP cho bản thân, tốn 32 MP.',
    mpCost: 32,
    atkScale: 0.8,
    selfHealRatio: 0.3,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },
  {
    key: 'thuy_thuan_van_hanh',
    name: 'Thuỷ Thuận Vân Hành',
    description: 'Tâm pháp Thuỷ hệ — bước chân nhẹ như mây nước, tăng tốc độ né tránh (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ----- Hệ HOẢ (hoả → kim) -----
  // Burst sát thương + DOT lửa + crit passive.
  {
    key: 'hoa_xa_phun_diem',
    name: 'Hoả Xà Phun Diễm',
    description: 'Hoả xà phun lửa thiêu đối thủ — sát thương 1.6×, tốn 13 MP.',
    mpCost: 13,
    atkScale: 1.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 1,
  },
  {
    key: 'hoa_long_phen_thien',
    name: 'Hoả Long Phến Thiên',
    description: 'Hoả long thiêu đốt cả trời — sát thương bùng nổ 2.8×, tốn 38 MP.',
    mpCost: 38,
    atkScale: 2.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 4,
  },
  {
    key: 'hoa_long_huyet_man',
    name: 'Hoả Long Huyết Mạch',
    description: 'Tâm pháp Hoả hệ — huyết mạch hoả linh thiêu rực, tăng tỉ lệ bạo kích (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 0,
  },

  // ----- Hệ THỔ (thổ → thuỷ) -----
  // Defense buff + counter-attack + def passive.
  {
    key: 'thach_giap_ho_than',
    name: 'Thạch Giáp Hộ Thân',
    description: 'Thổ khí ngưng tụ thành thạch giáp — sát thương phản đòn 1.3×, tốn 10 MP.',
    mpCost: 10,
    atkScale: 1.3,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 1,
  },
  {
    key: 'hoang_dia_chan_long',
    name: 'Hoàng Địa Chấn Long',
    description: 'Thổ long chấn động — sát thương 2.4× phá phòng ngự đối thủ, tốn 26 MP.',
    mpCost: 26,
    atkScale: 2.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },
  {
    key: 'hau_tho_an_son',
    name: 'Hậu Thổ Ấn Sơn',
    description: 'Tâm pháp Thổ hệ — như sơn mạch trầm trọng, gia tăng phòng ngự dài hạn (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ===================================================================
  // Phase 10 PR-2 v2 — Skill Pack Ngũ Hành expansion (+10 skill)
  //
  // Mục tiêu: nâng coverage mỗi hệ Ngũ Hành lên ≥ 2 ACTIVE + ≥ 2 PASSIVE
  // và mở tier kim_dan (order=3) làm endgame layer cho Phase 11 progression
  // (currently truc_co order=2 là tier cao nhất). Catalog-only — Phase 11.2.B
  // `applyMasteryEffect` đã wire generic nên skill mới tự inherit mastery
  // system + Phase 11.3.B element multiplier wire.
  //
  // Stat budget (BALANCE_MODEL §4):
  //   kim_dan ULT: atkScale 3.4–3.5, mpCost 60–70, cooldown 4–5,
  //                selfHealRatio ≤ 0.4, selfBloodCost ≤ 0.1.
  //   mid passive: atkScale 0, mpCost 0, cooldown 0 (ràng buộc test passive).
  //
  // Mỗi hệ thêm: 1× kim_dan ACTIVE (ULT) + 1× mid PASSIVE bù role gap.
  // ===================================================================

  // ----- Hệ KIM — endgame ULT + mid passive sharpness -----
  {
    key: 'kim_kiep_luan_chuyen',
    name: 'Kim Kiếp Luân Chuyển',
    description: 'ULT Kim hệ Kim Đan — đại kim luân xoay vần chém vạn vật, sát thương 3.4×, tốn 70 MP.',
    mpCost: 70,
    atkScale: 3.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'kim_dan',
    cooldownTurns: 5,
  },
  {
    key: 'kim_phong_lien_hoa',
    name: 'Kim Phong Liên Hoa',
    description: 'Tâm pháp Kim hệ — kim quang sắc bén tự động mài giũa binh khí, tăng độ sắc bén dài hạn (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ----- Hệ MỘC — endgame heal-combo + mid passive DOT poison -----
  {
    key: 'moc_huyen_thien_dia',
    name: 'Mộc Huyền Thiên Địa',
    description: 'ULT Mộc hệ Kim Đan — sinh khí cây cối ôm trọn thiên địa, sát thương 2.0× và hồi 40% HP, tốn 65 MP.',
    mpCost: 65,
    atkScale: 2,
    selfHealRatio: 0.4,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'kim_dan',
    cooldownTurns: 4,
  },
  {
    key: 'moc_lam_co_thuy',
    name: 'Mộc Lâm Cổ Thụy',
    description: 'Tâm pháp Mộc hệ — phun phấn mộc độc trong lúc giao đấu, gây sát thương duy trì lên đối thủ (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'PASSIVE',
    role: 'DEBUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 0,
  },

  // ----- Hệ THUỶ — endgame control combo + mid passive MP regen -----
  {
    key: 'thuy_long_thien_thai',
    name: 'Thuỷ Long Thiên Thái',
    description: 'ULT Thuỷ hệ Kim Đan — thuỷ long Thiên Thái đảo chiều dòng chảy, phong toả + sát thương 2.6×, tốn 60 MP.',
    mpCost: 60,
    atkScale: 2.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'kim_dan',
    cooldownTurns: 5,
  },
  {
    key: 'thuy_huyen_thanh_tinh',
    name: 'Thuỷ Huyền Thanh Tịnh',
    description: 'Tâm pháp Thuỷ hệ — thuỷ linh thanh tịnh hồi linh khí mỗi lượt, tăng tốc độ hồi MP dài hạn (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 0,
  },

  // ----- Hệ HOẢ — endgame burst (huyết tế nhẹ) + mid passive burn DOT -----
  {
    key: 'hoa_thien_chu_tuoc',
    name: 'Hoả Thiên Chu Tước',
    description: 'ULT Hoả hệ Kim Đan — Chu Tước thiêu trời, đốt 10% HP đổi sát thương 3.4×, tốn 70 MP.',
    mpCost: 70,
    atkScale: 3.4,
    selfHealRatio: 0,
    selfBloodCost: 0.1,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'kim_dan',
    cooldownTurns: 5,
  },
  {
    key: 'hoa_thieu_chau_van',
    name: 'Hoả Thiêu Chu Vân',
    description: 'Tâm pháp Hoả hệ — hoả linh ngấm vào kinh mạch, mỗi đòn đánh đốt thêm chu vân lên đối thủ (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'PASSIVE',
    role: 'DEBUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 0,
  },

  // ----- Hệ THỔ — endgame area dmg + mid passive knockback resist -----
  {
    key: 'tho_huyet_son_quan',
    name: 'Thổ Huyết Sơn Quân',
    description: 'ULT Thổ hệ Kim Đan — sơn mạch chấn động đập tan đối thủ, sát thương 2.8×, tốn 65 MP.',
    mpCost: 65,
    atkScale: 2.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'kim_dan',
    cooldownTurns: 5,
  },
  {
    key: 'tho_quan_dia_man',
    name: 'Thổ Quán Địa Mạn',
    description: 'Tâm pháp Thổ hệ — như sơn mạch ăn sâu vào lòng đất, kháng đẩy lùi và choáng dài hạn (passive).',
    mpCost: 0,
    atkScale: 0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'PASSIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 0,
  },

  // ===================================================================
  // Phase 11 nâng cao §2 — Skill Pack Ngũ Hành expansion v3 (+10 skill)
  //
  // Mục tiêu (theo `XuanToi_Phase11_NangCao_Report.docx` §2 "Skill học theo
  // Ngũ Hành"):
  //   1. Mở tier `nguyen_anh` (order=4) làm endgame layer mới — mỗi hệ +1
  //      ACTIVE ULT (atkScale ≤ 4.0, mpCost ≤ 80, cooldown ≤ 6).
  //   2. Lấp role gap mid-tier — mỗi hệ thêm 1 ACTIVE truc_co tier covering
  //      role chưa có sẵn:
  //        Kim → HEAL (hiện chỉ DAMAGE pure)
  //        Mộc → DAMAGE pure (hiện HEAL/DEBUFF/HEAL_ULT)
  //        Thuỷ → DAMAGE pure (hiện CONTROL/HEAL/CONTROL_ULT)
  //        Hoả → BUFF (hiện DAMAGE pure ×3)
  //        Thổ → CONTROL (hiện BUFF/DAMAGE/DAMAGE_ULT)
  //
  // Stat budget vẫn theo `BALANCE_MODEL.md` §4 + `balance-dials.ts`:
  //   - SKILL_ATK_SCALE_HARD_CAP = 5
  //   - SKILL_MP_COST_HARD_CAP = 80
  //   - SKILL_SELF_HEAL_HARD_CAP = 0.5
  //   - SKILL_SELF_BLOOD_HARD_CAP = 0.3
  //   - SKILL_COOLDOWN_HARD_CAP = 6
  //
  // Element multiplier wire (Phase 11.3.B + Phase 11 nâng cao §3 PR #399)
  // tự áp dụng — KHÔNG cần thay đổi runtime. Test bound trong
  // `skills-balance.test.ts` (thêm invariant nguyen_anh tier coverage +
  // role variety per element).
  // ===================================================================

  // ----- Hệ KIM — nguyen_anh ULT + truc_co HEAL role-fill -----
  {
    key: 'kim_quang_dao_thien',
    name: 'Kim Quang Đảo Thiên',
    description:
      'ULT Kim hệ Nguyên Anh — kim quang đảo lộn càn khôn, vạn vật đều bị chém vụn, sát thương 4.0×, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nguyen_anh',
    cooldownTurns: 6,
  },
  {
    key: 'kim_loan_y_tham_phap',
    name: 'Kim Loan Y Thẩm Pháp',
    description:
      'Bí thuật Kim hệ Trúc Cơ — kim loan đan kết nối linh khí trị thương, sát thương 0.7× và hồi 28% HP, tốn 30 MP.',
    mpCost: 30,
    atkScale: 0.7,
    selfHealRatio: 0.28,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },

  // ----- Hệ MỘC — nguyen_anh ULT + truc_co DAMAGE pure role-fill -----
  {
    key: 'moc_thuong_co_lam_thien',
    name: 'Mộc Thượng Cổ Lâm Thiên',
    description:
      'ULT Mộc hệ Nguyên Anh — vạn cổ lâm sơn nuốt trọn đối thủ, sát thương 3.6× và hồi 30% HP, tốn 78 MP.',
    mpCost: 78,
    atkScale: 3.6,
    selfHealRatio: 0.3,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'nguyen_anh',
    cooldownTurns: 5,
  },
  {
    key: 'moc_kinh_thuong_thien',
    name: 'Mộc Kình Thương Thiên',
    description:
      'Pháp quyết Mộc hệ Trúc Cơ — mộc kình hoá thương sắc nhọn xuyên không, sát thương 2.6×, tốn 30 MP.',
    mpCost: 30,
    atkScale: 2.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },

  // ----- Hệ THUỶ — nguyen_anh ULT + truc_co DAMAGE pure role-fill -----
  {
    key: 'thuy_thien_dong_chuong',
    name: 'Thuỷ Thiên Động Chưởng',
    description:
      'ULT Thuỷ hệ Nguyên Anh — thiên hà động chuyển ngàn vạn thuỷ long ào tới, sát thương 3.8× và phong toả, tốn 75 MP.',
    mpCost: 75,
    atkScale: 3.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'nguyen_anh',
    cooldownTurns: 6,
  },
  {
    key: 'thuy_kinh_phong_dao',
    name: 'Thuỷ Kình Phong Đao',
    description:
      'Pháp quyết Thuỷ hệ Trúc Cơ — thuỷ kình ngưng tụ thành đao chém vạn vật, sát thương 2.7×, tốn 32 MP.',
    mpCost: 32,
    atkScale: 2.7,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },

  // ----- Hệ HOẢ — nguyen_anh ULT + truc_co BUFF role-fill -----
  {
    key: 'hoa_phuong_de_quan',
    name: 'Hoả Phượng Đế Quân',
    description:
      'ULT Hoả hệ Nguyên Anh — Phượng Hoàng Đế Quân giáng lâm, đốt 15% HP đổi sát thương 4.0×, tốn 78 MP.',
    mpCost: 78,
    atkScale: 4,
    selfHealRatio: 0,
    selfBloodCost: 0.15,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nguyen_anh',
    cooldownTurns: 6,
  },
  {
    key: 'hoa_diem_phap_y',
    name: 'Hoả Diễm Pháp Y',
    description:
      'Pháp y Hoả hệ Trúc Cơ — hoả linh ngưng tụ quanh thân, vận khí tăng sát thương lâu dài, sát thương 1.0× tốn 24 MP (active buff).',
    mpCost: 24,
    atkScale: 1,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 4,
  },

  // ----- Hệ THỔ — nguyen_anh ULT + truc_co CONTROL role-fill -----
  {
    key: 'tho_van_co_trach_thien',
    name: 'Thổ Vạn Cổ Trạch Thiên',
    description:
      'ULT Thổ hệ Nguyên Anh — vạn cổ địa trạch ép trời đè đất, sát thương 3.6×, tốn 76 MP.',
    mpCost: 76,
    atkScale: 3.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nguyen_anh',
    cooldownTurns: 5,
  },
  {
    key: 'tho_huyen_son_phong_an',
    name: 'Thổ Huyền Sơn Phong Ấn',
    description:
      'Pháp quyết Thổ hệ Trúc Cơ — thổ trầm ngưng kết thành sơn ấn phong toả đối thủ, sát thương 2.0×, tốn 28 MP.',
    mpCost: 28,
    atkScale: 2,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
  },
];

export function skillByKey(key: string): SkillDef | undefined {
  return SKILLS.find((s) => s.key === key);
}

export function skillsForSect(sect: SectKey | null): SkillDef[] {
  return SKILLS.filter((s) => s.sect === null || s.sect === sect);
}

/**
 * Skill có thể chọn ở combat picker — chỉ ACTIVE (PASSIVE skill được áp
 * dụng tự động ở phase 11 buff system, không hiển thị ở picker).
 *
 * Phase 10 PR-2: introduce helper này để FE picker (BossView, DungeonView)
 * không show passive skill catalog mới. Tách khỏi `skillsForSect` để giữ
 * backward-compat (test cũ vẫn pass).
 */
export function activeSkillsForSect(sect: SectKey | null): SkillDef[] {
  return skillsForSect(sect).filter((s) => (s.type ?? 'ACTIVE') === 'ACTIVE');
}

/** Trả về tất cả skill (cả ACTIVE + PASSIVE) thuộc một element nhất định. */
export function skillsForElement(element: ElementKey | null): SkillDef[] {
  return SKILLS.filter((s) => (s.element ?? null) === element);
}

export interface CombatActor {
  name: string;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  power: number;
  spirit: number;
  speed: number;
}

/** RNG seeded — server tự cấp Math.random; client chỉ display. */
export function rollDamage(atk: number, def: number, scale: number): number {
  const base = atk * scale - def * 0.5;
  const variance = 0.85 + Math.random() * 0.3; // 0.85..1.15
  return Math.max(1, Math.round(base * variance));
}

export const STAMINA_PER_ACTION = 5;
export const STAMINA_REGEN_PER_TICK = 3;
