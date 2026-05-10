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

/**
 * Drop table entry — single rollable row trong loot table.
 *
 * Sống trong `combat.ts` (không phải `items.ts`) để `MonsterDef.lootTable`
 * có thể tham chiếu mà không tạo circular import (`items.ts` đã import
 * `ElementKey` từ `combat.ts`). Helper roll thực tế (`rollDungeonLoot`,
 * `rollMonsterLoot`) vẫn ở `items.ts` vì cần `itemByKey` để validate.
 */
export interface LootEntry {
  itemKey: string;
  weight: number;
  qtyMin: number;
  qtyMax: number;
}

export interface RolledLoot {
  itemKey: string;
  qty: number;
}

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
  /**
   * **Phase 12.4** — per-monster loot table override. Khi defined +
   * non-empty, `DungeonRunService.nextEncounter` (và tương tự ở
   * `CombatService` WON path) **ưu tiên** roll từ table này thay vì
   * `DUNGEON_LOOT[dungeon.key]`. Mục đích: cho boss/elite có drop chain
   * thematic riêng (vd boss endgame `cuu_la_huyen_quan` drop pity
   * `linh_can_dan` weight cao hơn dungeon-level fallback).
   *
   * Resolve:
   *   - `monster.lootTable` defined + length > 0 → roll qua `rollMonsterLoot`.
   *   - else → fallback `rollDungeonLoot(dungeon.key, n)` (existing path).
   *
   * Validation (vitest items-monster-loot.test.ts):
   *   - `weight > 0` mọi entry.
   *   - `qtyMin ≥ 1`, `qtyMin ≤ qtyMax`.
   *   - `itemKey` resolve qua `itemByKey` (no orphan ref).
   *
   * Không define = identity (dungeon-level fallback). Convention: chỉ override
   * cho monster `monsterType ∈ {ELITE, BOSS}` để tránh boss-loot leak vào
   * BEAST routine drop.
   */
  lootTable?: readonly LootEntry[];
  /**
   * **Phase 14.2.A** — optional Ngũ Hành combat resist. Map skill element →
   * multiplier `≤ 1` (giảm sát thương chịu vào). Khác với `element`
   * (monster's own affinity) — `elementalResist` là **kháng** vs incoming
   * skill element. Vd boss băng `huyen_bang_kiep_lang` có `element='thuy'` +
   * `elementalResist={ hoa: 0.85 }` (kháng 15% sát thương Hoả).
   *
   * Convention:
   *   - `1.0` hoặc undefined = neutral (không kháng).
   *   - `< 1` = monster resist (giảm sát thương).
   *   - `> 1` = vulnerability (Phase 14.2.A foundation chưa wire weakness;
   *     reserved cho future PR).
   *
   * Floor `ELEMENT_MONSTER_RESIST_FLOOR=0.7` ở `elemental.ts` — catalog
   * không nên đặt resist quá mạnh (giảm > 30% damage) ở foundation phase.
   * Combat runtime đọc qua `composeMonsterElementalResist`.
   *
   * Không define = không kháng (legacy + foundation default — fallback neutral).
   */
  elementalResist?: Partial<Record<ElementKey, number>>;
}

/**
 * **Phase 12.2.B** — DungeonRun completion reward (deterministic). Khác với
 * `DUNGEON_LOOT` (per-encounter random drop trong combat flow), `runReward`
 * là **bonus một-lần** khi player hoàn tất hết encounter trong run + claim
 * via `POST /dungeon-runs/:runId/claim`.
 *
 * Cộng atomic qua `CurrencyService.applyTx` (linhThach/tienNgoc với
 * `reason='DUNGEON_RUN_REWARD'` + `refType='DungeonRun'` + `refId=runId`)
 * + `InventoryService.grantTx` (items với cùng `reason`/`refType`/`refId`)
 * + `tx.character.update({ exp: { increment } })` cho exp (giống QUEST_CLAIM
 * pattern). CAS guard `DungeonRun.claimedAt=null` đảm bảo idempotent — race
 * 2 claim cùng runId, đúng 1 winner ghi 1 ledger row / runId.
 */
export interface DungeonRunReward {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
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
   *
   * **Phase 14.2.D legacy alias**: vẫn giữ field `element` để không vỡ
   * dữ liệu cũ + downstream consumer (FE/API). Field mới
   * `dominantElement` (Phase 14.2.D) override `element` nếu set; helper
   * `getDungeonElementProfile()` consume cả 2.
   */
  element?: ElementKey | null;
  /**
   * **Phase 14.2.D** — Ngũ Hành chủ đạo của dungeon, dùng cho UI badge +
   * filter + identity panel. Mặc định fallback sang `element` (legacy)
   * khi không set; designer có thể override để rebrand dungeon mà không
   * cần đụng `element` (forward-compat). `null` = dungeon vô hệ.
   */
  dominantElement?: ElementKey | null;
  /**
   * **Phase 14.2.D** — Ngũ Hành khuyến nghị player dùng để clear nhanh.
   * Mặc định = `elementCounter(dominantElement)` (vd dominant=tho →
   * recommended=moc). Designer có thể override (vd dungeon vô hệ vẫn
   * có recommendation cụ thể, hoặc reverse-engineering boss design).
   * `null` = no recommendation (UI ẩn hint).
   */
  recommendedCounterElement?: ElementKey | null;
  /**
   * **Phase 14.2.D** — Ngũ Hành flavor cho reward, dùng cho UI hint
   * "loot dungeon thiên về hệ X". Mặc định = `dominantElement` (loot
   * cùng hệ với dungeon). Designer có thể override để align với
   * `runReward` actual content.
   */
  rewardElementHint?: ElementKey | null;
  /** Region key — phase 10 PR-3 grouping. */
  regionKey?: string | null;
  /**
   * Daily entry limit — phase 10 PR-3 metadata. Phase 12.2.A `combat.service`
   * (single-encounter flow) + Phase 12.2.B `DungeonRunService` (multi-encounter
   * runtime) đều enforce server-side. `null` / undefined = không giới hạn.
   */
  dailyLimit?: number;
  /**
   * **Phase 12.2.B** — Completion bonus khi player clear toàn bộ encounter +
   * claim. Reward grant atomic qua ledger (xem `DungeonRunReward` doc).
   * `null` / undefined = chỉ có per-encounter random loot, không bonus claim
   * (legacy or single-boss endgame placeholder).
   */
  runReward?: DungeonRunReward;
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
  { key: 'tinh_thiet_kiem_linh', name: 'Tinh Thiết Kiếm Linh', level: 11, hp: 570,  atk: 70, def: 26, speed: 12, expDrop: 430,  linhThachDrop: 125, element: 'kim', monsterType: 'SPIRIT',   regionKey: 'kim_son_mach', elementalResist: { kim: 0.9 } },
  { key: 'kim_dieu_thuong_phong',name: 'Kim Điêu Thượng Phong',level: 14, hp: 920,  atk: 105,def: 42, speed: 16, expDrop: 720,  linhThachDrop: 195, element: 'kim', monsterType: 'ELITE',    regionKey: 'kim_son_mach', questTargetIds: ['kim_dan_yeu_thu'], elementalResist: { kim: 0.85 },
    lootTable: [
      // Phase 12.4 — ELITE override: bias toward themed weapon + nâng skill_book
      // weight (3 → 5) so với dungeon-level fallback. Higher tinh_thiet qty
      // (3-6 vs 2-5) reward player kill được elite encounter. Convention: giữ
      // skill_book ở vị trí cuối + parity với DUNGEON_LOOT.kim_son_mach (last
      // bucket) để invariant random=0.99 trong combat.service.test vẫn hit.
      { itemKey: 'than_phong_kiem', weight: 8, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'tinh_thiet', weight: 25, qtyMin: 3, qtyMax: 6 },
      { itemKey: 'co_thien_dan', weight: 15, qtyMin: 2, qtyMax: 3 },
      { itemKey: 'skill_book_kim_quang_tram', weight: 5, qtyMin: 1, qtyMax: 1 },
    ],
  },

  // Region: Mộc Huyền Lâm (Hệ MỘC, luyện khí cao → trúc cơ; rừng cổ)
  { key: 'thanh_mang_xa',        name: 'Thanh Mang Xà',        level: 4,  hp: 110,  atk: 17, def: 6,  speed: 12, expDrop: 60,   linhThachDrop: 22, element: 'moc', monsterType: 'BEAST',    regionKey: 'moc_huyen_lam' },
  { key: 'tang_diep_yeu_phu',    name: 'Tàng Diệp Yêu Phụ',    level: 6,  hp: 180,  atk: 24, def: 11, speed: 9,  expDrop: 115,  linhThachDrop: 34, element: 'moc', monsterType: 'HUMANOID', regionKey: 'moc_huyen_lam' },
  { key: 'co_thu_chi_linh',      name: 'Cổ Thụ Chi Linh',      level: 8,  hp: 320,  atk: 30, def: 28, speed: 5,  expDrop: 215,  linhThachDrop: 60, element: 'moc', monsterType: 'SPIRIT',   regionKey: 'moc_huyen_lam', elementalResist: { moc: 0.9 } },
  { key: 'thien_la_co_yeu',      name: 'Thiên La Cổ Yêu',      level: 11, hp: 620,  atk: 64, def: 32, speed: 10, expDrop: 460,  linhThachDrop: 130,element: 'moc', monsterType: 'ELITE',    regionKey: 'moc_huyen_lam', elementalResist: { moc: 0.85 } },

  // Region: Thuỷ Long Uyên (Hệ THUỶ, trúc cơ → kim đan; hồ sâu)
  { key: 'thuy_lan_yeu',         name: 'Thuỷ Lân Yêu',         level: 6,  hp: 195,  atk: 25, def: 10, speed: 12, expDrop: 125,  linhThachDrop: 38, element: 'thuy', monsterType: 'BEAST',    regionKey: 'thuy_long_uyen' },
  { key: 'han_tinh_quy_phach',   name: 'Hàn Tinh Quỷ Phách',   level: 9,  hp: 380,  atk: 44, def: 22, speed: 11, expDrop: 290,  linhThachDrop: 88, element: 'thuy', monsterType: 'SPIRIT',   regionKey: 'thuy_long_uyen' },
  { key: 'huyen_thuy_giao_long', name: 'Huyền Thuỷ Giao Long', level: 13, hp: 820,  atk: 95, def: 42, speed: 14, expDrop: 640,  linhThachDrop: 175,element: 'thuy', monsterType: 'ELITE',    regionKey: 'thuy_long_uyen', elementalResist: { thuy: 0.85 } },
  { key: 'thuy_thanh_long_vuong',name: 'Thuỷ Thanh Long Vương',level: 17, hp: 1450, atk: 140,def: 56, speed: 13, expDrop: 1100, linhThachDrop: 320,element: 'thuy', monsterType: 'BOSS',     regionKey: 'thuy_long_uyen', elementalResist: { thuy: 0.8, hoa: 0.9 },
    lootTable: [
      // Phase 12.4 — BOSS override: equipment + skill_book pity weight 6
      // (vs dungeon weight 3). han_ngoc qty boost 2-4 (vs 1-3) reward
      // boss-only kill.
      { itemKey: 'cuu_u_bi_thuong', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'han_thiet_giap', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'han_ngoc', weight: 30, qtyMin: 2, qtyMax: 4 },
      { itemKey: 'skill_book_thuy_kinh_phong_an', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'co_thien_dan', weight: 20, qtyMin: 2, qtyMax: 4 },
    ],
  },

  // Region: Hoả Diệm Sơn (Hệ HOẢ, kim đan → nguyên anh; núi lửa)
  { key: 'hoa_yen_thu',          name: 'Hoả Yến Thử',          level: 9,  hp: 320,  atk: 50, def: 14, speed: 15, expDrop: 240,  linhThachDrop: 70, element: 'hoa', monsterType: 'BEAST',    regionKey: 'hoa_diem_son' },
  { key: 'xich_diem_yeu_xa',     name: 'Xích Diệm Yêu Xà',     level: 12, hp: 580,  atk: 78, def: 30, speed: 14, expDrop: 470,  linhThachDrop: 145,element: 'hoa', monsterType: 'BEAST',    regionKey: 'hoa_diem_son' },
  { key: 'hoa_long_chi_linh',    name: 'Hoả Long Chi Linh',    level: 16, hp: 1280, atk: 130,def: 50, speed: 13, expDrop: 990,  linhThachDrop: 270,element: 'hoa', monsterType: 'ELITE',    regionKey: 'hoa_diem_son', elementalResist: { hoa: 0.85 } },
  { key: 'chu_tuoc_huyet_dieu',  name: 'Chu Tước Huyết Điêu',  level: 19, hp: 1800, atk: 175,def: 65, speed: 17, expDrop: 1450, linhThachDrop: 410,element: 'hoa', monsterType: 'BOSS',     regionKey: 'hoa_diem_son', elementalResist: { hoa: 0.8 },
    lootTable: [
      // Phase 12.4 — BOSS override: rare TIEN weapon `tu_la_dao` weight 5
      // (vs dungeon weight 2). yeu_dan qty boost 3-5 (vs 2-5). Skill book
      // pity weight 6 cho boss kill.
      { itemKey: 'tu_la_dao', weight: 5, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'cuu_la_giap', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'yeu_dan', weight: 30, qtyMin: 3, qtyMax: 5 },
      { itemKey: 'cuu_huyen_dan', weight: 15, qtyMin: 2, qtyMax: 3 },
      { itemKey: 'skill_book_hoa_xa_phun_diem', weight: 6, qtyMin: 1, qtyMax: 1 },
    ],
  },

  // Region: Hoàng Thổ Huyệt (Hệ THỔ, kim đan → nguyên anh; mỏ thổ + tank)
  { key: 'thach_quang_yeu_thu',  name: 'Thạch Quang Yêu Thú',  level: 10, hp: 540,  atk: 48, def: 50, speed: 5,  expDrop: 380,  linhThachDrop: 110,element: 'tho', monsterType: 'BEAST',    regionKey: 'hoang_tho_huyet' },
  { key: 'hoang_tho_cu_yeu',     name: 'Hoàng Thổ Cự Yêu',     level: 13, hp: 880,  atk: 78, def: 70, speed: 6,  expDrop: 660,  linhThachDrop: 180,element: 'tho', monsterType: 'ELITE',    regionKey: 'hoang_tho_huyet', questTargetIds: ['hoang_tho_quy'], elementalResist: { tho: 0.85 } },
  { key: 'thach_long_co_giap',   name: 'Thạch Long Cổ Giáp',   level: 17, hp: 1500, atk: 130,def: 110,speed: 7,  expDrop: 1180, linhThachDrop: 330,element: 'tho', monsterType: 'BOSS',     regionKey: 'hoang_tho_huyet', elementalResist: { tho: 0.8 } },
  { key: 'tho_dia_lao_tu',       name: 'Thổ Địa Lão Tử',       level: 20, hp: 2200, atk: 165,def: 130,speed: 8,  expDrop: 1700, linhThachDrop: 480,element: 'tho', monsterType: 'BOSS',     regionKey: 'hoang_tho_huyet', elementalResist: { tho: 0.8, moc: 0.9 },
    lootTable: [
      // Phase 12.4 — BOSS override (final boss hoang_tho_huyet): equipment
      // weight 6 + skill book pity 6 + cuu_huyen_dan tier-up (weight 18 vs
      // dungeon 14). phu_van_ngoc qty boost 2-4 (vs 1-3).
      { itemKey: 'than_lan_giap', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'yeu_phach_giap', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'phu_van_ngoc', weight: 30, qtyMin: 2, qtyMax: 4 },
      { itemKey: 'cuu_huyen_dan', weight: 18, qtyMin: 2, qtyMax: 3 },
      { itemKey: 'skill_book_thach_giap_ho_than', weight: 6, qtyMin: 1, qtyMax: 1 },
    ],
  },

  // Phase-10 cross-region BOSS (mid-late, kim đan đỉnh, mixed encounter)
  { key: 'cuu_la_huyen_quan',    name: 'Cửu La Huyền Quân',    level: 18, hp: 1700, atk: 160,def: 80, speed: 14, expDrop: 1380, linhThachDrop: 390,element: 'kim',  monsterType: 'BOSS',    regionKey: 'kim_son_mach', elementalResist: { kim: 0.8, hoa: 0.9 },
    lootTable: [
      // Phase 12.4 — BOSS override (cuu_la_dien single-boss endgame): tier-up
      // mọi rare drop từ dungeon-level. than_dan/tien_huyen_kiem/giap weight
      // x2-3, linh_can_dan pity weight 3 (vs dungeon 1) reward endgame kill.
      { itemKey: 'than_dan', weight: 3, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'tien_huyen_kiem', weight: 4, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'tien_huyen_giap', weight: 4, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'tien_kim_sa', weight: 12, qtyMin: 1, qtyMax: 3 },
      { itemKey: 'cuu_thien_dan', weight: 10, qtyMin: 1, qtyMax: 2 },
      { itemKey: 'linh_can_dan', weight: 3, qtyMin: 1, qtyMax: 1 },
    ],
  },

  // ═════════════════════════════════════════════════════════════════════
  // Phase 12 Story Foundation Late-game wire — Trúc Cơ → Nguyên Anh story monster
  //
  // Wire 8 placeholder targetId từ Story PR-1/Foundation Extension catalog
  // (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`,
  // `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) vào
  // monster catalog. Khác PR-6 (alias `questTargetIds`): các placeholder này
  // là entity riêng (linh ảnh / tâm ma / sát thủ tâm cảnh) — `MonsterDef.key`
  // match thẳng placeholder để kill hook auto-track không cần wire alias.
  //
  // Stat curve theo SPIRIT/HUMANOID tier mid (BALANCE_MODEL.md §5.1) +
  // **Phase 12.5 dungeon balance tuning** (xem BALANCE_MODEL.md §5.4
  // "Phase 12.5 — Late-game story monster tuning" appendix):
  //   - Trúc Cơ realm 2 (level 5-7): exp 100-175, lt 32-55. SPIRIT mềm hơn
  //     BEAST cùng level (đại diện cho "linh ảnh / tâm ma" intangible).
  //   - Kim Đan realm 3 (level 11): ELITE assassin burst-glass (low HP / high
  //     ATK + speed = 17 max in dungeon).
  //   - Nguyên Anh realm 4 (level 15-16): ELITE tâm ma tank/pressure (def
  //     cao) + BOSS huyết khí endgame (~10+ hit player đúng tier).
  //
  // ELITE/BOSS có `lootTable` override (themed equipment + skill_book pity)
  // theo convention Phase 12.4 (xem `items-monster-loot.test.ts`).
  // ═════════════════════════════════════════════════════════════════════

  // Trúc Cơ tier (realm 2) — Linh Tuyền Động / Tâm Cảnh / Vô Trụ Cốc spirits.
  // SPIRIT type → "linh ảnh / tâm ma" intangible: HP/DEF nhẹ hơn BEAST
  // cùng level. Phase 12.5 nerf nhẹ tich_linh_anh (hp 150→130, def 8→6) để
  // killable ~2-3 hit cho Trúc Cơ early; bump tam_ma_anh (hp 195→215, atk
  // 26→30, def 10→12) để khó hơn tich_linh_anh + match peer thi_quy lvl 6
  // SPIRIT (hp 200/28/12) — story tâm ma pressure.
  { key: 'tich_linh_anh',     name: 'Tịch Linh Ảnh',     level: 5,  hp: 130,  atk: 20, def: 6,  speed: 11, expDrop: 100, linhThachDrop: 32, element: null,  monsterType: 'SPIRIT',   regionKey: 'hac_lam' },
  { key: 'tam_ma_anh',        name: 'Tâm Ma Ảnh',        level: 6,  hp: 215,  atk: 30, def: 12, speed: 10, expDrop: 145, linhThachDrop: 48, element: null,  monsterType: 'SPIRIT',   regionKey: 'hac_lam' },
  { key: 'tich_linh_quy',     name: 'Tịch Linh Quỷ',     level: 7,  hp: 250,  atk: 32, def: 14, speed: 10, expDrop: 175, linhThachDrop: 55, element: 'moc', monsterType: 'SPIRIT',   regionKey: 'moc_huyen_lam' },

  // Kim Đan tier (realm 3) — Tịch Thiên Điện assassin (ELITE kim_dan).
  // Phase 12.5 promote HUMANOID→ELITE + burst-glass tuning (hp 580→480, atk
  // 75→95, speed 14→17 = max in kim_son_mach for assassin agility, def
  // 24→22 thinner armor) + add lootTable override (TIEN kim weapon
  // `than_phong_kiem` shared với kim_dieu_thuong_phong + tinh_thiet boost +
  // skill_book_kim_quang_tram pity). Player Kim Đan đối mặt burst nhưng có
  // thể killable 4-5 hit nếu đủ atk.
  { key: 'tich_thien_sat_thu',name: 'Tịch Thiên Sát Thủ',level: 11, hp: 480,  atk: 95, def: 22, speed: 17, expDrop: 480, linhThachDrop: 145,element: 'kim', monsterType: 'ELITE', regionKey: 'kim_son_mach', elementalResist: { kim: 0.85 },
    lootTable: [
      // Phase 12.5 — ELITE override: bias toward themed kim weapon + tinh_thiet
      // boost (qty 2-5 vs dungeon 1-3). skill_book_kim_quang_tram pity weight 6
      // (vs dungeon 3) cho assassin kill chain. Khác kim_dieu_thuong_phong:
      // assassin không drop co_thien_dan (giữ thị trường pill ổn định).
      { itemKey: 'than_phong_kiem', weight: 7, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'tinh_thiet', weight: 22, qtyMin: 2, qtyMax: 5 },
      { itemKey: 'co_thien_dan', weight: 14, qtyMin: 1, qtyMax: 2 },
      { itemKey: 'skill_book_kim_quang_tram', weight: 6, qtyMin: 1, qtyMax: 1 },
    ],
  },

  // Nguyên Anh tier (realm 4) — tâm ma / ký ức / chấp niệm / huyết khí.
  //
  // tam_ma_nguyen_anh: SPIRIT→ELITE promotion (Phase 12.5). Lvl 14→15, hp
  // 940→1100, def 38→56 cho tank/pressure flavor. Mid-tier giữa lvl 13 ELITE
  // hoang_tho_cu_yeu (hp 880) và lvl 17 BOSS thach_long_co_giap (hp 1500).
  // +lootTable: yeu_phach_giap (shared với tho_dia_lao_tu) + phu_van_ngoc
  // boost + cuu_huyen_dan (TIEN pill) + skill_book_thach_giap_ho_than pity.
  //
  // chap_niem_anh: giữ nguyên — SPIRIT mid Nguyên Anh stat trung-cao
  // (combat runtime chưa support debuff/control flavor mà placeholder name
  // ngụ ý; chờ Phase 13+ status effect system mới wire — lúc đó re-tune).
  //
  // ky_uc_meo: **giữ nguyên** stat lvl 14 SPIRIT (Nguyên Anh tier) trong
  // moc_huyen_lam (recommendedRealm `truc_co`) — **STORY-HARD ENCOUNTER
  // INTENTIONAL TIER GAP**. Quest `nguyen_anh_grind_01` (requiredRealmOrder
  // 4) yêu cầu kill 6 ky_uc_meo nên monster phải Nguyên Anh-tier; nhưng
  // moc_huyen_lam là Trúc Cơ dungeon. Trade-off: Trúc Cơ player vào dungeon
  // sẽ wipe ở encounter cuối ky_uc_meo — design intentional ("story phản
  // chiếu nỗi đau sư tỷ" — không phải farm spot cho realm Trúc Cơ).
  // Nguyên Anh player có thể clear toàn dungeon dễ dàng (acceptable: kim
  // dan/nguyên anh player thường skip Trúc Cơ dungeon, chỉ vào để kill
  // ky_uc_meo cho story quest). Document ở BALANCE_MODEL §5.4 appendix.
  //
  // huyet_anh: HUMANOID→BOSS promotion (Phase 12.5). Lvl 15→16, hp
  // 1080→1700, atk 115→145, def 40→70, speed 13→14, exp/lt buff. Endgame
  // story BOSS "hardest in 8-pack" — tank ~10+ hit cho Nguyên Anh player.
  // Mid-tier giữa lvl 17 BOSS thach_long_co_giap (1500) và lvl 20 BOSS
  // tho_dia_lao_tu final (2200). +lootTable: themed huyết equipment
  // (huyet_phach_giap + mau_huyet_dai) + phu_van_ngoc + cuu_huyen_dan +
  // skill_book pity + linh_can_dan rare pity (parity cuu_la_huyen_quan
  // endgame BOSS, weight 2/60 ≈ 3.3%).
  { key: 'tam_ma_nguyen_anh', name: 'Tâm Ma Nguyên Anh', level: 15, hp: 1100, atk: 110, def: 56, speed: 11, expDrop: 880, linhThachDrop: 235, element: null,  monsterType: 'ELITE', regionKey: 'hoang_tho_huyet',
    lootTable: [
      // Phase 12.5 — ELITE override: tank tâm ma pressure → tho-themed armor
      // + phu_van_ngoc boost + skill_book pity. Không drop linh_can_dan (giữ
      // rare pity cho BOSS huyet_anh + cuu_la_huyen_quan endgame only).
      { itemKey: 'yeu_phach_giap', weight: 7, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'phu_van_ngoc', weight: 25, qtyMin: 2, qtyMax: 4 },
      { itemKey: 'cuu_huyen_dan', weight: 16, qtyMin: 2, qtyMax: 3 },
      { itemKey: 'skill_book_thach_giap_ho_than', weight: 6, qtyMin: 1, qtyMax: 1 },
    ],
  },
  { key: 'chap_niem_anh',     name: 'Chấp Niệm Ảnh',     level: 15, hp: 1050, atk: 110, def: 42, speed: 12, expDrop: 850, linhThachDrop: 230, element: null,  monsterType: 'SPIRIT',   regionKey: 'hoang_tho_huyet' },
  { key: 'ky_uc_meo',         name: 'Ký Ức Méo',         level: 14, hp: 920,  atk: 95,  def: 36, speed: 11, expDrop: 720, linhThachDrop: 195, element: 'moc', monsterType: 'SPIRIT',   regionKey: 'moc_huyen_lam' },
  { key: 'huyet_anh',         name: 'Huyết Ảnh',         level: 16, hp: 1700, atk: 145, def: 70, speed: 14, expDrop: 1350, linhThachDrop: 380, element: null,  monsterType: 'BOSS', regionKey: 'hoang_tho_huyet',
    lootTable: [
      // Phase 12.5 — BOSS override (story endgame hardest in 8-pack): themed
      // huyết equipment (huyet_phach_giap + mau_huyet_dai) weight 5 mỗi (TIEN
      // tier rare drop). phu_van_ngoc boost qty 2-4. cuu_huyen_dan pity 18.
      // skill_book pity 6. linh_can_dan rare pity weight 2 (~3.3%) parity
      // với cuu_la_huyen_quan endgame BOSS.
      { itemKey: 'huyet_phach_giap', weight: 5, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'mau_huyet_dai', weight: 5, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'phu_van_ngoc', weight: 24, qtyMin: 2, qtyMax: 4 },
      { itemKey: 'cuu_huyen_dan', weight: 18, qtyMin: 2, qtyMax: 3 },
      { itemKey: 'skill_book_thach_giap_ho_than', weight: 6, qtyMin: 1, qtyMax: 1 },
      { itemKey: 'linh_can_dan', weight: 2, qtyMin: 1, qtyMax: 1 },
    ],
  },
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
    runReward: { linhThach: 50, exp: 100, items: [{ itemKey: 'huyet_chi_dan', qty: 1 }] },
  },
  {
    key: 'hac_lam',
    name: 'Hắc Lâm',
    description: 'Hắc lâm âm khí dày đặc, thi quỷ và yêu xà nương bóng tối.',
    recommendedRealm: 'truc_co',
    // Phase 12 Story Foundation Late-game wire — thêm `tich_linh_anh` (lvl 5) +
    // `tam_ma_anh` (lvl 6) story SPIRIT placeholder (xem `combat.test.ts >
    // Phase 12 Story late-game placeholder reachable in DUNGEONS.monsters[]`).
    monsters: ['hac_yeu_xa', 'thi_quy', 'hac_lam_ma', 'tich_linh_anh', 'tam_ma_anh'],
    staminaEntry: 18,
    element: 'moc',
    regionKey: 'hac_lam',
    dailyLimit: 4,
    runReward: { linhThach: 120, exp: 250, items: [{ itemKey: 'huyet_tinh', qty: 1 }] },
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
    runReward: { linhThach: 250, tienNgoc: 1, exp: 600, items: [{ itemKey: 'co_thien_dan', qty: 1 }] },
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
    // Phase 12 Story Foundation Late-game wire — thêm `tich_thien_sat_thu` (lvl 11
    // HUMANOID kim đan) cho placeholder Kim Đan story chain.
    monsters: ['kim_quang_thach_giap', 'huyen_kim_lang_thu', 'tinh_thiet_kiem_linh', 'kim_dieu_thuong_phong', 'tich_thien_sat_thu'],
    staminaEntry: 32,
    element: 'kim',
    regionKey: 'kim_son_mach',
    dailyLimit: 3,
    runReward: { linhThach: 280, tienNgoc: 1, exp: 650, items: [{ itemKey: 'tinh_thiet', qty: 1 }] },
  },
  {
    key: 'moc_huyen_lam',
    name: 'Mộc Huyền Lâm',
    description: 'Rừng cổ thiên niên — cổ thụ chi linh và thiên la cổ yêu nương theo huyết khí ngàn năm.',
    recommendedRealm: 'truc_co',
    // Phase 12 Story Foundation Late-game wire — thêm `tich_linh_quy` (lvl 7
    // SPIRIT moc, Trúc Cơ) + `ky_uc_meo` (lvl 14 SPIRIT moc, Nguyên Anh tier
    // đặt cuối list cho story-driven hard-encounter; player Trúc Cơ phải đợi
    // lên Kim Đan/Nguyên Anh mới qua dễ — narrative-driven, không grind farm).
    monsters: ['thanh_mang_xa', 'tang_diep_yeu_phu', 'co_thu_chi_linh', 'thien_la_co_yeu', 'tich_linh_quy', 'ky_uc_meo'],
    staminaEntry: 22,
    element: 'moc',
    regionKey: 'moc_huyen_lam',
    dailyLimit: 4,
    runReward: { linhThach: 150, exp: 320, items: [{ itemKey: 'linh_thao', qty: 2 }] },
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
    runReward: { linhThach: 280, tienNgoc: 1, exp: 650, items: [{ itemKey: 'han_ngoc', qty: 1 }] },
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
    runReward: { linhThach: 500, tienNgoc: 2, exp: 1200, items: [{ itemKey: 'yeu_dan', qty: 1 }] },
  },
  {
    key: 'hoang_tho_huyet',
    name: 'Hoàng Thổ Huyệt',
    description: 'Huyệt thổ ngàn năm — Thạch Long Cổ Giáp và Thổ Địa Lão Tử trấn giữ kho tàng địa mạch.',
    recommendedRealm: 'nguyen_anh',
    // Phase 12 Story Foundation Late-game wire — thêm 3 placeholder Nguyên Anh
    // tier (`tam_ma_nguyen_anh` lvl 14, `chap_niem_anh` lvl 15, `huyet_anh` lvl
    // 15) cho story chain tâm ma / chấp niệm / huyết ảnh end-game. Đặt sau boss
    // `tho_dia_lao_tu` để run flow boss → mini-encounter chain → optional claim.
    monsters: ['thach_quang_yeu_thu', 'hoang_tho_cu_yeu', 'thach_long_co_giap', 'tho_dia_lao_tu', 'tam_ma_nguyen_anh', 'chap_niem_anh', 'huyet_anh'],
    staminaEntry: 48,
    element: 'tho',
    regionKey: 'hoang_tho_huyet',
    dailyLimit: 2,
    runReward: { linhThach: 600, tienNgoc: 2, exp: 1400, items: [{ itemKey: 'co_thien_dan', qty: 2 }] },
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
    runReward: { linhThach: 1000, tienNgoc: 5, exp: 2500, items: [{ itemKey: 'cuu_huyen_dan', qty: 1 }] },
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

/**
 * Phase 12 Story discoverability helper — trả về danh sách dungeon mà player
 * có thể gặp `placeholderId` qua `DungeonRunService.nextEncounter`. Resolve
 * theo 2 đường:
 *
 *  1. **Direct key match**: dungeon `monsters[]` chứa thẳng `placeholderId`
 *     (vd 8 placeholder Phase 12 Story late-game `tich_linh_anh` /
 *     `tam_ma_anh` / ... — wire qua `MonsterDef.key === placeholder`).
 *  2. **Alias match qua `MonsterDef.questTargetIds`**: dungeon `monsters[]`
 *     chứa monster có `questTargetIds.includes(placeholderId)` (vd 7
 *     placeholder PR-6 critical-path: `son_thu_lon` → alias `son_thu`,
 *     `da_quan` → alias `son_tac_dau_muc`, ...).
 *
 * Dùng cho FE QuestView "📍 Tìm tại: {dungeonNames}" hint cho `kill+monster`
 * step. Server-authoritative — FE chỉ render từ shared catalog data, KHÔNG
 * tự suy luận. Dedupe theo `dungeon.key` (1 placeholder có thể alias qua N
 * monster cùng dungeon).
 *
 * Trả về mảng rỗng nếu placeholder chưa wire vào dungeon nào (orphan
 * placeholder — invariant test `dungeons-balance.test.ts` ngăn drift).
 */
export function findDungeonsForQuestPlaceholder(
  placeholderId: string,
): DungeonDef[] {
  const found = new Map<string, DungeonDef>();
  for (const d of DUNGEONS) {
    for (const monsterKey of d.monsters) {
      if (monsterKey === placeholderId) {
        found.set(d.key, d);
        break;
      }
      const m = monsterByKey(monsterKey);
      if (m?.questTargetIds?.includes(placeholderId)) {
        found.set(d.key, d);
        break;
      }
    }
  }
  return Array.from(found.values());
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
  /**
   * **Phase 14.2.C — Elemental Skill Tree Expansion.** Skill identity tag
   * dùng cho UI tooltip + combat runtime side-effect dispatch.
   *
   * Các giá trị `SkillTag`:
   *   - `HEAL`    → kết hợp với `selfHealRatio` hồi HP (đã có sẵn pipeline).
   *   - `DOT`     → wire `monsterDot` lên encounter state (mỗi lượt thiêu/độc
   *     thêm `floor(atkScale × effPower × DOT_RATIO)` HP cho 3 lượt tới).
   *   - `BURST`   → identity-only (atkScale lớn, không side-effect).
   *   - `SHIELD`  → wire `playerShield` lên encounter state (hấp thu monster
   *     reply lượt kế tiếp = `floor(hpMax × SHIELD_RATIO)`).
   *   - `CRIT`    → identity-only (atkScale tier ULT, gameplay flavor).
   *   - `CONTROL` → identity-only (effect đã có pattern qua `debuff_root_thuy`
   *     etc; runtime hiện chưa dispatch tự động từ skill).
   *
   * Optional, additive — legacy skill không khai báo → tags=`[]` → không có
   * side-effect mới (backward-compat). Validator
   * `validateSkillElementIdentity()` ở `elemental-skills.ts` enforce element
   * non-null khi tag DOT/SHIELD/CONTROL.
   */
  tags?: readonly SkillTag[];
}

/**
 * Phase 14.2.C — Skill identity tag.
 * @see SkillDef.tags
 */
export const SKILL_TAGS = [
  'HEAL',
  'DOT',
  'BURST',
  'SHIELD',
  'CRIT',
  'CONTROL',
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

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
    // Phase 14.2.C — backfill identity tag (role đã CONTROL từ trước, tag
    // chỉ là metadata thêm để FE/coverage check pickup).
    tags: ['CONTROL'],
  },

  // =====================================================================
  // Phase 14.2.C — Elemental Skill Tree Expansion (11 signature skills)
  // ---------------------------------------------------------------------
  // Mỗi skill mang `tags` rõ ràng — combat runtime dispatch side-effect:
  //   - DOT  → encounter state `monsterDot` (3 lượt thiêu/độc).
  //   - SHIELD → encounter state `playerShield` (hấp thu monster reply).
  //   - HEAL/BURST/CRIT/CONTROL → identity-only (gameplay flavor).
  // Xem `elemental-skills.ts` (catalog identity + dial) và
  // `BALANCE_MODEL §4.7` cho rationale.
  // =====================================================================

  // ----- Mộc — Hồi phục / Độc / Sinh trưởng -----
  {
    key: 'moc_xuan_phong_phuc_sinh',
    name: 'Xuân Phong Phục Sinh',
    description:
      'Hơi xuân Mộc hệ thấm vào kinh mạch — sát thương 1.0× kèm hồi 25% HP, dưỡng thương dài lâu.',
    mpCost: 22,
    atkScale: 1.0,
    selfHealRatio: 0.25,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 3,
    tags: ['HEAL'],
  },
  {
    key: 'moc_doc_van_truong',
    name: 'Mộc Độc Vạn Trường',
    description:
      'Phù chú độc tố lan trên thân địch — đánh 1.5× và tiếp tục bào mòn linh hồn 3 lượt sau (DOT 15%/lượt).',
    mpCost: 26,
    atkScale: 1.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'DEBUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 2,
    tags: ['DOT'],
  },
  {
    key: 'moc_thien_sinh_chu',
    name: 'Thiên Sinh Diệu Chú',
    description:
      'Khẩu quyết sinh trưởng — sát thương nhẹ 0.8× nhưng hồi 28% HP cho bản thân, gốc rễ vạn vật.',
    mpCost: 28,
    atkScale: 0.8,
    selfHealRatio: 0.28,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'truc_co',
    cooldownTurns: 4,
    tags: ['HEAL'],
  },

  // ----- Hoả — Bùng nổ / Thiêu đốt -----
  {
    key: 'hoa_phen_diem_kiep',
    name: 'Phần Diệm Hoả Kiếp',
    description:
      'Tâm hoả tụ thành kiếp tai — bùng nổ 2.6× sát thương trong 1 đòn. Ngọn lửa hư không, một kích định.',
    mpCost: 38,
    atkScale: 2.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 4,
    tags: ['BURST'],
  },
  {
    key: 'hoa_thieu_diem_phap',
    name: 'Thiêu Diệm Phù Pháp',
    description:
      'Phù chú lửa khắc ấn lên đối thủ — đánh 1.5× kèm vết bỏng 3 lượt (DOT 15%/lượt) khó dập.',
    mpCost: 24,
    atkScale: 1.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DEBUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 2,
    tags: ['DOT'],
  },

  // ----- Thổ — Khiên / Giảm sát thương -----
  {
    key: 'tho_kim_son_ho_phap',
    name: 'Kim Sơn Hộ Pháp',
    description:
      'Hô triệu khối thạch sơn bao quanh — sát thương 0.5× nhưng tạo khiên đá hấp thu 10% HP của bản thân ở lượt kế.',
    mpCost: 20,
    atkScale: 0.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 3,
    tags: ['SHIELD'],
  },
  {
    key: 'tho_huyen_thach_trong_giap',
    name: 'Huyền Thạch Trọng Giáp',
    description:
      'Trọng giáp huyền thạch áo lên thân — đánh nhẹ 0.4× nhưng dựng khiên cứng 10% HP, bộ pháp Thổ hệ vững như sơn nhạc.',
    mpCost: 24,
    atkScale: 0.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'truc_co',
    cooldownTurns: 4,
    tags: ['SHIELD'],
  },

  // ----- Kim — Xuyên giáp / Chí mạng -----
  {
    key: 'kim_xuyen_giap_thien_thich',
    name: 'Xuyên Giáp Thiên Thích',
    description:
      'Kim quang nhọn tựa thiên trâm — sát thương 1.8× xuyên giáp địch, đòn chí mạng khi đúng kẽ hở.',
    mpCost: 24,
    atkScale: 1.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 2,
    tags: ['CRIT'],
  },
  {
    key: 'kim_phong_nhan_quyet',
    name: 'Phong Nhận Quyết',
    description:
      'Đao quyết Kim hệ — luồng kim phong xé không gian, sát thương 2.4× chuyên trị địch giáp dày.',
    mpCost: 32,
    atkScale: 2.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
    tags: ['CRIT', 'BURST'],
  },

  // ----- Thuỷ — Khống chế / Hồi linh lực -----
  {
    key: 'thuy_lam_dieu_quyet',
    name: 'Lam Diệu Pháp Quyết',
    description:
      'Sương lam Thuỷ hệ làm chậm bước địch — đánh 1.4× kèm chấn động kinh mạch, đối thủ nặng nề ở lượt sau.',
    mpCost: 22,
    atkScale: 1.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'luyenkhi',
    cooldownTurns: 2,
    tags: ['CONTROL'],
  },
  {
    key: 'thuy_lam_quy_thuy_tam',
    name: 'Lam Quy Thuỷ Tâm',
    description:
      'Tâm pháp Thuỷ hệ ôn dưỡng linh hồn — sát thương 0.8× và hồi 18% HP. Linh tuyền không cạn, người tu Thuỷ hệ trường tồn.',
    mpCost: 18,
    atkScale: 0.8,
    selfHealRatio: 0.18,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'truc_co',
    cooldownTurns: 3,
    tags: ['HEAL'],
  },

  // =====================================================================
  // Content Scale 2 — High-Realm Skills Pack (25 skills, Phase 14.4 layer)
  // ---------------------------------------------------------------------
  // Bộ skill cảnh giới cao late-game cho 4 tier:
  //   - Nhân Tiên (order 10)   → unlockRealm: 'nhan_tien'   — 5 skills.
  //   - Tiên Giới (order 13+)  → unlockRealm: 'huyen_tien'  — 5 skills.
  //   - Hỗn Nguyên (order 18+) → unlockRealm: 'thanh_nhan'  — 5 skills.
  //   - Vĩnh Hằng (order 25+)  → unlockRealm: 'vo_chung'    — 5 skills.
  //   - Neutral / Special      → element=null               — 5 skills.
  //
  // Mỗi tier cover đủ 5 hệ Ngũ Hành theo identity:
  //   - Kim   → CRIT/BURST     (xuyên giáp, chí mạng)
  //   - Mộc   → HEAL/DOT       (hồi máu, độc tố)
  //   - Thuỷ  → CONTROL/HEAL   (khống chế, hồi linh khí)
  //   - Hoả   → BURST/DOT      (bộc phát, thiêu đốt)
  //   - Thổ   → SHIELD         (khiên hộ thân)
  //
  // Stat budget tuân `BALANCE_MODEL §4` hard caps:
  //   - atkScale ≤ 5 (ULT damage 4.0–4.8)
  //   - mpCost ≤ 80 (ULT 70–80)
  //   - selfHealRatio ≤ 0.5 (ULT heal 0.40–0.50)
  //   - selfBloodCost ≤ 0.3 (huyết tế 0.10–0.20)
  //   - cooldownTurns ≤ 6 (ULT 5–6)
  //
  // Arena/PvE balance: KHÔNG one-shot, KHÔNG bypass shield-cap, dùng
  // tag pattern hiện có (DOT/SHIELD dispatch combat runtime side-effect
  // identical với Phase 14.2.C). Skill chỉ mở khi đủ realm — Arena hiện
  // tại không cấm cụ thể skill nào, chỉ snapshot static, deterministic
  // qua seeded RNG.
  // =====================================================================

  // ----- Nhân Tiên (order 10) — 5 skills, 1 ACTIVE per element -----
  {
    key: 'kim_nhan_tien_pho_thien_kiep',
    name: 'Phổ Thiên Kim Kiếp',
    description:
      'ULT Nhân Tiên Kim hệ — kim quang phổ thiên giáng kiếp, sát thương 4.2× xuyên giáp chí mạng, tốn 78 MP.',
    mpCost: 78,
    atkScale: 4.2,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 5,
    tags: ['CRIT', 'BURST'],
  },
  {
    key: 'moc_nhan_tien_van_lam_sinh_co',
    name: 'Vạn Lâm Sinh Cơ',
    description:
      'Bí thuật Nhân Tiên Mộc hệ — vạn lâm hồi xuân thấm vào kinh mạch, sát thương 2.0× và hồi 40% HP, tốn 70 MP.',
    mpCost: 70,
    atkScale: 2.0,
    selfHealRatio: 0.4,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 5,
    tags: ['HEAL'],
  },
  {
    key: 'thuy_nhan_tien_thuy_kiep_phong_an',
    name: 'Thuỷ Kiếp Phong Ấn',
    description:
      'ULT Nhân Tiên Thuỷ hệ — phong ấn vạn vật bằng thuỷ kiếp, sát thương 3.6× kèm khống chế lượt sau, tốn 72 MP.',
    mpCost: 72,
    atkScale: 3.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 6,
    tags: ['CONTROL'],
  },
  {
    key: 'hoa_nhan_tien_pho_diem_van_thien',
    name: 'Phổ Diễm Vạn Thiên',
    description:
      'ULT Nhân Tiên Hoả hệ — đốt 10% HP đổi sát thương 4.4× phổ diễm vạn thiên kèm vết bỏng, tốn 78 MP.',
    mpCost: 78,
    atkScale: 4.4,
    selfHealRatio: 0,
    selfBloodCost: 0.1,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 6,
    tags: ['BURST', 'DOT'],
  },
  {
    key: 'tho_nhan_tien_kim_son_huyen_giap',
    name: 'Kim Sơn Huyền Giáp',
    description:
      'Bí thuật Nhân Tiên Thổ hệ — huyền giáp kim sơn ôm trọn thân, sát thương 0.8× và dựng khiên đá hấp thu lượt sau, tốn 60 MP.',
    mpCost: 60,
    atkScale: 0.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 5,
    tags: ['SHIELD'],
  },

  // ----- Tiên Giới (order 13+, anchor 'huyen_tien') — 5 skills -----
  {
    key: 'kim_tien_gioi_thien_quang_xuyen_van',
    name: 'Thiên Quang Xuyên Vạn',
    description:
      'ULT Tiên Giới Kim hệ — vạn đạo kim quang xuyên không phá vạn pháp, sát thương 4.4× chí mạng, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 6,
    tags: ['CRIT'],
  },
  {
    key: 'moc_tien_gioi_co_lam_thuong_truong',
    name: 'Cổ Lâm Thương Trường',
    description:
      'Pháp quyết Tiên Giới Mộc hệ — gieo vạn cổ độc lâm trên thân địch, sát thương 2.6× kèm độc tố hao mòn 3 lượt, tốn 70 MP.',
    mpCost: 70,
    atkScale: 2.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'DEBUFF',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 4,
    tags: ['DOT'],
  },
  {
    key: 'thuy_tien_gioi_thien_ha_dao_chuyen',
    name: 'Thiên Hà Đảo Chuyển',
    description:
      'ULT Tiên Giới Thuỷ hệ — thiên hà đảo chuyển hồi linh khí, sát thương 1.4× và hồi 42% HP, tốn 68 MP.',
    mpCost: 68,
    atkScale: 1.4,
    selfHealRatio: 0.42,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 5,
    tags: ['HEAL'],
  },
  {
    key: 'hoa_tien_gioi_chu_tuoc_phan_thien',
    name: 'Chu Tước Phần Thiên',
    description:
      'ULT Tiên Giới Hoả hệ — Chu Tước thiêu đốt cả thiên giới bằng hoả vũ, sát thương 4.6×, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 6,
    tags: ['BURST'],
  },
  {
    key: 'tho_tien_gioi_huyen_son_dia_phong',
    name: 'Huyền Sơn Địa Phong',
    description:
      'Pháp quyết Tiên Giới Thổ hệ — sơn mạch huyền địa phong toả đối thủ, sát thương 3.0× kèm khống chế bước, tốn 65 MP.',
    mpCost: 65,
    atkScale: 3.0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 5,
    tags: ['CONTROL'],
  },

  // ----- Hỗn Nguyên (order 18+, anchor 'thanh_nhan') — 5 skills -----
  {
    key: 'kim_hon_nguyen_kim_kiep_dao_thien',
    name: 'Kim Kiếp Đảo Thiên',
    description:
      'ULT Hỗn Nguyên Kim hệ — kim kiếp đảo lộn càn khôn, vạn vật bị tan trong kim quang, sát thương 4.6× chí mạng, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 6,
    tags: ['CRIT', 'BURST'],
  },
  {
    key: 'moc_hon_nguyen_thien_dia_long_lac',
    name: 'Thiên Địa Long Lạc',
    description:
      'Bí thuật Hỗn Nguyên Mộc hệ — vạn vật sinh trưởng từ hồng hoang, sát thương 2.4× và hồi 45% HP, tốn 76 MP.',
    mpCost: 76,
    atkScale: 2.4,
    selfHealRatio: 0.45,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 5,
    tags: ['HEAL'],
  },
  {
    key: 'thuy_hon_nguyen_van_thuy_quy_nguyen',
    name: 'Vạn Thuỷ Quy Nguyên',
    description:
      'ULT Hỗn Nguyên Thuỷ hệ — vạn thuỷ quy về cội nguyên đại đạo, sát thương 4.0× kèm khống chế nặng, tốn 78 MP.',
    mpCost: 78,
    atkScale: 4.0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 6,
    tags: ['CONTROL'],
  },
  {
    key: 'hoa_hon_nguyen_chu_tuoc_thien_phan',
    name: 'Chu Tước Thiên Phần',
    description:
      'ULT Hỗn Nguyên Hoả hệ — đốt 15% HP đổi sát thương 4.7× thiêu trọn càn khôn, tốn 78 MP.',
    mpCost: 78,
    atkScale: 4.7,
    selfHealRatio: 0,
    selfBloodCost: 0.15,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 6,
    tags: ['BURST', 'DOT'],
  },
  {
    key: 'tho_hon_nguyen_dia_thien_son_quan',
    name: 'Địa Thiên Sơn Quân',
    description:
      'Bí thuật Hỗn Nguyên Thổ hệ — sơn quân địa thiên hộ thân vững như đại đạo, sát thương 1.0× và dựng khiên cứng lượt sau, tốn 70 MP.',
    mpCost: 70,
    atkScale: 1.0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 5,
    tags: ['SHIELD'],
  },

  // ----- Vĩnh Hằng (order 25+, anchor 'vo_chung') — 5 skills -----
  {
    key: 'kim_vinh_hang_thien_kiem_quy_tong',
    name: 'Thiên Kiếm Quy Tông',
    description:
      'ULT Vĩnh Hằng Kim hệ — vạn kiếm quy tông từ vô chung đến vô thuỷ, sát thương 4.8× xuyên giáp tuyệt đối, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.8,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'kim',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['CRIT', 'BURST'],
  },
  {
    key: 'moc_vinh_hang_van_co_sinh_chu',
    name: 'Vạn Cổ Sinh Chú',
    description:
      'ULT Vĩnh Hằng Mộc hệ — vạn cổ sinh chú trường tồn ngũ hành, sát thương 3.0× và hồi 50% HP, tốn 80 MP.',
    mpCost: 80,
    atkScale: 3.0,
    selfHealRatio: 0.5,
    selfBloodCost: 0,
    sect: null,
    element: 'moc',
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['HEAL'],
  },
  {
    key: 'thuy_vinh_hang_thien_ha_dao_lang',
    name: 'Thiên Hà Đảo Lãng',
    description:
      'ULT Vĩnh Hằng Thuỷ hệ — thiên hà đảo lãng cuốn vạn linh, sát thương 4.4× kèm khống chế tuyệt đối, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'thuy',
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['CONTROL'],
  },
  {
    key: 'hoa_vinh_hang_kiep_diem_thieu_thien',
    name: 'Kiếp Diễm Thiêu Thiên',
    description:
      'ULT Vĩnh Hằng Hoả hệ — đốt 20% HP đổi sát thương 4.8× kiếp diễm thiêu thiên trọn cõi, tốn 80 MP.',
    mpCost: 80,
    atkScale: 4.8,
    selfHealRatio: 0,
    selfBloodCost: 0.2,
    sect: null,
    element: 'hoa',
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['BURST'],
  },
  {
    key: 'tho_vinh_hang_huyen_dia_kim_can_giap',
    name: 'Huyền Địa Kim Cang Giáp',
    description:
      'ULT Vĩnh Hằng Thổ hệ — kim cang huyền địa giáp bất hoại che chở vạn pháp, sát thương 1.4× và dựng khiên ngàn năm, tốn 78 MP.',
    mpCost: 78,
    atkScale: 1.4,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: 'tho',
    type: 'ACTIVE',
    role: 'BUFF',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['SHIELD'],
  },

  // ----- Neutral / Special (element=null) — 5 skills mixed realms -----
  {
    key: 'tien_anh_quyet_kiem',
    name: 'Tiên Anh Quyết Kiếm',
    description:
      'Bí thuật vô hệ Nhân Tiên — kiếm quyết tiên anh phá vạn ma, sát thương 4.0× chí mạng, tốn 70 MP.',
    mpCost: 70,
    atkScale: 4.0,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'nhan_tien',
    cooldownTurns: 5,
    tags: ['CRIT'],
  },
  {
    key: 'huyen_thien_van_phap_kinh',
    name: 'Huyền Thiên Vạn Pháp Kinh',
    description:
      'Bí thuật vô hệ Tiên Giới — vạn pháp huyền thiên hộ thân, sát thương 1.8× và hồi 30% HP, tốn 60 MP.',
    mpCost: 60,
    atkScale: 1.8,
    selfHealRatio: 0.3,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'huyen_tien',
    cooldownTurns: 5,
    tags: ['HEAL'],
  },
  {
    key: 'chuan_thanh_dao_quan_kiem',
    name: 'Chuẩn Thánh Đạo Quân Kiếm',
    description:
      'ULT vô hệ Hỗn Nguyên — đạo quân kiếm chuẩn thánh phá vạn pháp, sát thương 4.5× xuyên đại đạo, tốn 75 MP.',
    mpCost: 75,
    atkScale: 4.5,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'DAMAGE',
    unlockRealm: 'thanh_nhan',
    cooldownTurns: 6,
    tags: ['BURST', 'CRIT'],
  },
  {
    key: 'dao_quan_van_phap_quy',
    name: 'Đạo Quân Vạn Pháp Quy',
    description:
      'ULT vô hệ Hỗn Nguyên cao — vạn pháp quy nguyên đạo quân, sát thương 3.6× kèm khống chế trận pháp, tốn 70 MP.',
    mpCost: 70,
    atkScale: 3.6,
    selfHealRatio: 0,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'CONTROL',
    unlockRealm: 'dao_quan',
    cooldownTurns: 6,
  },
  {
    key: 'vinh_hang_dao_tam_an',
    name: 'Vĩnh Hằng Đạo Tâm Ấn',
    description:
      'Bí thuật vô hệ Vĩnh Hằng — đạo tâm ấn vĩnh hằng tự tu, sát thương 2.0× và hồi 45% HP, tốn 70 MP.',
    mpCost: 70,
    atkScale: 2.0,
    selfHealRatio: 0.45,
    selfBloodCost: 0,
    sect: null,
    element: null,
    type: 'ACTIVE',
    role: 'HEAL',
    unlockRealm: 'vo_chung',
    cooldownTurns: 6,
    tags: ['HEAL'],
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

/**
 * Roll damage với variance ±15%. Server-authoritative; client chỉ display.
 *
 * **Phase 14.1.A** — `rng` optional. Default `Math.random` cho backward
 * compat (toàn bộ call site cũ hoạt động nguyên vẹn). Caller deterministic
 * (Arena prep, replay verify, test) inject seeded RNG qua
 * `createSeededRng(seed).next` — xem `combat-rng.ts`.
 *
 * @param atk    Attacker effective ATK (đã compose talent/buff/element).
 * @param def    Defender effective DEF.
 * @param scale  Skill atkScale (basic attack = 1.0).
 * @param rng    Optional seeded RNG. Default `Math.random` (legacy).
 */
export function rollDamage(
  atk: number,
  def: number,
  scale: number,
  rng: () => number = Math.random,
): number {
  const base = atk * scale - def * 0.5;
  const variance = 0.85 + rng() * 0.3; // 0.85..1.15
  return Math.max(1, Math.round(base * variance));
}

export const STAMINA_PER_ACTION = 5;
export const STAMINA_REGEN_PER_TICK = 3;
