/**
 * Boss đại hội — Phase 7 baseline + Phase 10 PR-5 Boss Pack 1 (Ngũ Hành).
 *
 * Hệ thống world boss:
 * - Cron tự spawn theo rotation, sống đến khi bị giết hoặc hết thời gian.
 * - Mọi người đánh chung, server ghi nhận tổng sát thương per character.
 * - Boss chết → phân thưởng theo BXH (top 1 / top 2-3 / top 4-10 / all).
 *
 * Phase 10 PR-5 catalog: +10 named boss tổ chức theo realm tier (truc_co
 * → kim_dan → nguyen_anh → hoa_than → luyen_hu → hop_the) × Ngũ Hành
 * (kim/moc/thuy/hoa/tho + null cross-element endgame). `BossDef` extend
 * **forward-compat**:
 *   - `level?` (BALANCE_MODEL.md §5.1 monster level curve, dùng cho AI
 *     moveset compose ở phase 11.3 + reward weight curve).
 *   - `element?: ElementKey | null` (Ngũ Hành affinity cho phase 11.3
 *     `elementMultiplier` damage modifier).
 *   - `regionKey?` (group boss theo region — UI map view phase 12,
 *     consistent với `MonsterDef.regionKey` / `DungeonDef.regionKey`).
 *   - `monsterType?` luôn = `'BOSS'` (consistent với `MonsterType` ở
 *     `combat.ts`, dùng cho AI moveset ở phase 11.3).
 *   - `lowDropPool?` (top 4-10 reward — phase 12 BossRewardService sẽ wire
 *     pity / share-ratio reward distribute, hiện chỉ catalog).
 *
 * Combat / boss runtime KHÔNG đổi ở PR-5 (vẫn formula `damage = atk * scale
 * - def * 0.5` không read element). Phase 11.3 sẽ wire `element` thành damage
 * modifier; phase 12 sẽ wire `lowDropPool` + pity vào `BossRewardService`.
 */

import type { ElementKey, MonsterType } from './combat';

export interface BossDef {
  key: string;
  name: string;
  description: string;
  /** Mức cảnh giới khuyến nghị (text) — chỉ hiển thị. */
  recommendedRealm: string;
  baseMaxHp: number;
  atk: number;
  def: number;
  /** Linh thạch reward gốc (sẽ phân theo rank). */
  baseRewardLinhThach: number;
  /** Top-1 chắc chắn nhận 1 item từ list này (random). */
  topDropPool: readonly string[];
  /** Top 2-3 nhận. */
  midDropPool: readonly string[];

  /**
   * **Forward-compat phase 10 PR-5** — boss level. Phase 11.3 sẽ dùng để
   * compose AI moveset (skill picker by level + element) + reward weight
   * curve theo `BALANCE_MODEL.md §6.1`. Default null = legacy entry.
   */
  level?: number;
  /**
   * **Forward-compat phase 10 PR-5** — Ngũ Hành affinity của boss. Combat
   * runtime hiện KHÔNG đọc field này; phase 11.3 sẽ wire qua
   * `elementMultiplier(skill.element, target.element)` ở `BALANCE_MODEL.md`
   * §4.2. `null` = vô hệ / cross-element endgame.
   */
  element?: ElementKey | null;
  /**
   * **Forward-compat phase 10 PR-5** — region key cho UI map view phase 12.
   * Consistent với `MonsterDef.regionKey` / `DungeonDef.regionKey`. Boss
   * cross-region (e.g. world boss endgame) có thể `null`.
   */
  regionKey?: string | null;
  /**
   * **Forward-compat phase 10 PR-5** — luôn `'BOSS'` cho boss catalog;
   * align với `MonsterType` ở `combat.ts` để AI moveset compose phase 11.3
   * có thể treat boss như monster type=BOSS.
   */
  monsterType?: Extract<MonsterType, 'BOSS'>;
  /**
   * **Forward-compat phase 10 PR-5** — top 4-10 damage rank reward pool.
   * Phase 12 `BossRewardService` sẽ wire pity / share-ratio. Hiện chỉ
   * metadata; legacy boss có thể empty hoặc undefined → fallback qua
   * `midDropPool` ở runtime cũ.
   */
  lowDropPool?: readonly string[];
}

export const BOSSES: readonly BossDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // Legacy bosses (Phase 7 baseline) — +element/regionKey/level metadata
  // (forward-compat) cho phase 11.3 elementMultiplier và phase 12 region UI.
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'yeu_vuong_tho_huyet',
    name: 'Yêu Vương Thổ Huyết',
    description: 'Cổ yêu trăm năm tỉnh giấc, hắc khí ngút trời.',
    recommendedRealm: 'truc_co',
    baseMaxHp: 120000,
    atk: 90,
    def: 30,
    baseRewardLinhThach: 30000,
    topDropPool: ['tien_huyen_kiem', 'tien_huyen_giap'],
    midDropPool: ['than_dan', 'co_thien_dan'],
    level: 12,
    element: 'tho',
    regionKey: 'hoang_tho_huyet',
    monsterType: 'BOSS',
    // Phase 11.2.D+++ — skill_book_thach_giap_ho_than (hệ Thổ) added to
    // lowDropPool (forward-compat phase 12 BossRewardService pity wire).
    lowDropPool: ['huyet_tinh', 'co_thien_dan', 'skill_book_thach_giap_ho_than'],
  },
  {
    key: 'huyet_long_quan',
    name: 'Huyết Long Quân',
    description: 'Yêu long ngậm châu đỏ, mỗi vảy đều là phá thiên.',
    recommendedRealm: 'kim_dan',
    baseMaxHp: 240000,
    atk: 130,
    def: 50,
    baseRewardLinhThach: 60000,
    topDropPool: ['tien_huyen_kiem', 'tien_huyen_giap'],
    midDropPool: ['than_dan', 'co_thien_dan', 'huyet_phach_giap'],
    level: 16,
    element: 'hoa',
    regionKey: 'hoa_diem_son',
    monsterType: 'BOSS',
    // Phase 11.2.D+++ — skill_book_hoa_xa_phun_diem (hệ Hỏa) added.
    lowDropPool: ['huyet_tinh', 'yeu_dan', 'cuu_huyen_dan', 'skill_book_hoa_xa_phun_diem'],
  },

  // ═════════════════════════════════════════════════════════════════════
  // Phase 10 PR-5 — Boss Pack 1 (+10 named boss, Ngũ Hành)
  //
  // Ordering: append-only theo monotonic power curve (test enforce
  // `boss.test.ts` "mid-tier mạnh hơn entry-tier"). Realm tier:
  //   kim_dan → nguyen_anh → hoa_than → luyen_hu → hop_the.
  //
  // Element coverage (test enforce trong `boss-balance.test.ts`): mỗi
  // Ngũ Hành (kim/moc/thuy/hoa/tho) ≥ 2 boss; null cross-element ≥ 1.
  //
  // HP curve (BALANCE_MODEL.md §6.1):
  //   Sect-level (truc_co/kim_dan)  : 100k..500k
  //   World pham (nguyen_anh/hoa_than): 500k..1.5M (early world)
  //   World late pham (hoa_than+)    : 1.5M..3M (mid world)
  //
  // Atk band: ~hp / 6500 (xấp xỉ "kill in ~12 turn ở 50% atk hit rate").
  // Reward band: ~hp / 4 (boss reward tier > dungeon, BALANCE_MODEL §7.1).
  // ═════════════════════════════════════════════════════════════════════

  // Tier truc_co/kim_dan (sect-level + world pham early) ───────────────
  {
    key: 'moc_dinh_co_yeu',
    name: 'Mộc Đỉnh Cổ Yêu',
    description:
      'Yêu hậu Hắc Lâm — cổ thụ vạn năm thành tinh, gốc rễ xuyên thấu địa mạch, khí mộc hắc đậm đặc.',
    recommendedRealm: 'kim_dan',
    baseMaxHp: 280000,
    atk: 145,
    def: 55,
    baseRewardLinhThach: 75000,
    topDropPool: ['cuu_u_bi_thuong', 'linh_van_bao'],
    midDropPool: ['huyet_phach_giap', 'co_thien_dan', 'cuu_huyen_dan'],
    // Phase 11.2.D+++ — skill_book_moc_linh_truong_dieu (hệ Mộc) added.
    lowDropPool: ['linh_thao', 'huyet_tinh', 'tieu_phuc_dan', 'skill_book_moc_linh_truong_dieu'],
    level: 18,
    element: 'moc',
    regionKey: 'moc_huyen_lam',
    monsterType: 'BOSS',
  },
  {
    key: 'thuy_thanh_long_de',
    name: 'Thuỷ Thanh Long Đế',
    description:
      'Long đế Thuỷ Long Uyên — long khí xanh thẫm bao trùm hồ vạn trượng, hơi lạnh ngưng tụ thành băng phách.',
    recommendedRealm: 'kim_dan',
    baseMaxHp: 340000,
    atk: 165,
    def: 60,
    baseRewardLinhThach: 95000,
    topDropPool: ['han_thiet_giap', 'cuu_u_bi_thuong'],
    midDropPool: ['huyet_phach_giap', 'cuu_huyen_dan', 'co_thien_dan'],
    // Phase 11.2.D+++ — skill_book_thuy_kinh_phong_an (hệ Thủy) added.
    lowDropPool: ['han_ngoc', 'huyet_tinh', 'tieu_phuc_dan', 'skill_book_thuy_kinh_phong_an'],
    level: 20,
    element: 'thuy',
    regionKey: 'thuy_long_uyen',
    monsterType: 'BOSS',
  },
  {
    key: 'kim_phach_long_dieu',
    name: 'Kim Phách Long Điêu',
    description:
      'Điêu vương Kim Sơn Mạch — móng kim cương xé toạc kim đan, một tiếng kêu kim quang nổ tung hư không.',
    recommendedRealm: 'kim_dan',
    baseMaxHp: 400000,
    atk: 180,
    def: 65,
    baseRewardLinhThach: 115000,
    topDropPool: ['tien_huyen_kiem', 'tien_huyen_giap'],
    midDropPool: ['huyet_phach_giap', 'cuu_huyen_dan', 'co_thien_dan'],
    // Phase 11.2.D+++ — skill_book_kim_quang_tram (hệ Kim) added.
    lowDropPool: ['tinh_thiet', 'huyet_tinh', 'cuu_huyen_dan', 'skill_book_kim_quang_tram'],
    level: 22,
    element: 'kim',
    regionKey: 'kim_son_mach',
    monsterType: 'BOSS',
  },

  // Tier nguyen_anh (world pham mid) ────────────────────────────────────
  {
    key: 'chu_tuoc_huyet_de',
    name: 'Chu Tước Huyết Đế',
    description:
      'Hoả đế Hoả Diệm Sơn — hồng vũ cháy rực ngàn dặm, mỗi sải cánh đốt cháy vạn pháp đan sĩ.',
    recommendedRealm: 'nguyen_anh',
    baseMaxHp: 540000,
    atk: 230,
    def: 80,
    baseRewardLinhThach: 155000,
    topDropPool: ['than_phong_kiem', 'tien_huyen_giap', 'tien_van_dai'],
    midDropPool: ['cuu_u_bi_thuong', 'cuu_thien_dan', 'tien_van_dan'],
    // Phase 11.2.D+++ — skill_book_hoa_xa_phun_diem (hệ Hỏa) added.
    lowDropPool: ['yeu_dan', 'huyet_tinh', 'cuu_huyen_dan', 'skill_book_hoa_xa_phun_diem'],
    level: 26,
    element: 'hoa',
    regionKey: 'hoa_diem_son',
    monsterType: 'BOSS',
  },
  {
    key: 'thach_long_co_de',
    name: 'Thạch Long Cổ Đế',
    description:
      'Cổ đế Hoàng Thổ Huyệt — long thân thạch giáp dày như núi, tâm địa mạch bùng cháy hoàng quang.',
    recommendedRealm: 'nguyen_anh',
    baseMaxHp: 660000,
    atk: 260,
    def: 110,
    baseRewardLinhThach: 195000,
    topDropPool: ['tien_huyen_giap', 'tien_van_dai', 'hoang_tho_huyet_phu'],
    midDropPool: ['han_thiet_giap', 'cuu_thien_dan', 'tien_van_dan'],
    // Phase 11.2.D+++ — skill_book_thach_giap_ho_than (hệ Thổ) added.
    lowDropPool: ['phu_van_ngoc', 'huyet_tinh', 'cuu_huyen_dan', 'skill_book_thach_giap_ho_than'],
    level: 28,
    element: 'tho',
    regionKey: 'hoang_tho_huyet',
    monsterType: 'BOSS',
  },
  {
    key: 'cuu_u_yeu_hau',
    name: 'Cửu U Yêu Hậu',
    description:
      'Yêu hậu Mộc Huyền Lâm thâm xứ — vạn dây huyết đằng vây quanh, ngàn năm hấp thụ huyết khí tu sĩ lạc lối.',
    recommendedRealm: 'nguyen_anh',
    baseMaxHp: 780000,
    atk: 290,
    def: 115,
    baseRewardLinhThach: 235000,
    topDropPool: ['than_phong_kiem', 'tien_van_hai', 'moc_huyen_lam_phu'],
    midDropPool: ['cuu_u_bi_thuong', 'cuu_thien_dan', 'tien_van_dan'],
    // Phase 11.2.D+++ — skill_book_moc_linh_truong_dieu (hệ Mộc) added.
    lowDropPool: ['linh_thao', 'yeu_dan', 'cuu_huyen_dan', 'skill_book_moc_linh_truong_dieu'],
    level: 30,
    element: 'moc',
    regionKey: 'moc_huyen_lam',
    monsterType: 'BOSS',
  },

  // Tier hoa_than (world late pham) ─────────────────────────────────────
  {
    key: 'cuu_la_thien_de',
    name: 'Cửu La Thiên Đế',
    description:
      'Thiên đế Cửu La Điện — kim quang chí dương trấn áp ma đạo, một ý niệm phá vỡ vạn pháp.',
    recommendedRealm: 'hoa_than',
    baseMaxHp: 980000,
    atk: 340,
    def: 125,
    baseRewardLinhThach: 295000,
    topDropPool: ['than_phong_kiem', 'than_lan_giap', 'cuu_la_dien_phu'],
    // Phase 11.3.D++ — boss tier ≥ Hóa Thần drop `linh_can_dan` (Linh Căn
    // Reroll consumable, TIEN quality 5000 LT shop). midDropPool = top 2-3
    // reward (server `pickRandom`), ≈ 1/(N+1) chance per top 2-3 player.
    midDropPool: ['tien_huyen_kiem', 'cuu_thien_dan', 'tien_van_dan', 'linh_can_dan'],
    // Phase 11.2.D+++ — skill_book_kim_quang_tram (hệ Kim, boss element=kim).
    lowDropPool: ['tien_kim_sa', 'tinh_thiet', 'cuu_huyen_dan', 'skill_book_kim_quang_tram'],
    level: 32,
    element: 'kim',
    regionKey: 'cuu_la_dien',
    monsterType: 'BOSS',
  },
  {
    key: 'hoa_long_to_su',
    name: 'Hoả Long Tổ Sư',
    description:
      'Tổ sư hoả long Hoả Diệm Sơn cổ — vẫy đuôi nung chảy thiên thạch, lửa tổ thiêu rụi đại la.',
    recommendedRealm: 'hoa_than',
    baseMaxHp: 1250000,
    atk: 380,
    def: 140,
    baseRewardLinhThach: 380000,
    topDropPool: ['than_phong_kiem', 'than_lan_giap', 'than_loi_dai'],
    // Phase 11.3.D++ — boss tier ≥ Hóa Thần drop `linh_can_dan`.
    midDropPool: ['tien_huyen_giap', 'cuu_thien_dan', 'nhan_tien_dan', 'linh_can_dan'],
    // Phase 11.2.D+++ — skill_book_hoa_xa_phun_diem (hệ Hỏa) added.
    lowDropPool: ['yeu_dan', 'tien_kim_sa', 'cuu_huyen_dan', 'skill_book_hoa_xa_phun_diem'],
    level: 34,
    element: 'hoa',
    regionKey: 'hoa_diem_son',
    monsterType: 'BOSS',
  },

  // Tier luyen_hu (world late) ──────────────────────────────────────────
  {
    key: 'bang_phach_long_de',
    name: 'Băng Phách Long Đế',
    description:
      'Long đế băng phách Thuỷ Long Uyên cực bắc — vạn dặm băng vực ngưng kết, hơi thở đóng băng cả thần thức.',
    recommendedRealm: 'luyen_hu',
    baseMaxHp: 1650000,
    atk: 440,
    def: 160,
    baseRewardLinhThach: 480000,
    // Phase 11.3.D++ — boss tier Luyện Hư (≥ Hóa Thần) vừa topDropPool vừa
    // midDropPool drop `linh_can_dan` — endgame supply chain cho Linh Căn reroll.
    topDropPool: ['than_lan_giap', 'than_linh_tram', 'than_loi_dai', 'linh_can_dan'],
    midDropPool: ['tien_huyen_giap', 'nhan_tien_dan', 'cuu_thien_dan', 'linh_can_dan'],
    // Phase 11.2.D+++ — skill_book_thuy_kinh_phong_an (hệ Thủy) added.
    lowDropPool: ['han_ngoc', 'phu_van_ngoc', 'cuu_huyen_dan', 'skill_book_thuy_kinh_phong_an'],
    level: 38,
    element: 'thuy',
    regionKey: 'thuy_long_uyen',
    monsterType: 'BOSS',
  },

  // Tier hop_the (cross-element world boss endgame) ─────────────────────
  {
    key: 'hon_nguyen_yeu_to',
    name: 'Hỗn Nguyên Yêu Tổ',
    description:
      'Yêu tổ Hỗn Nguyên — vạn năm tu hấp thụ ngũ hành, không hệ riêng nhưng hệ nào cũng tinh thông, biểu tượng đại đạo vô thường.',
    recommendedRealm: 'hop_the',
    baseMaxHp: 2400000,
    atk: 540,
    def: 185,
    baseRewardLinhThach: 680000,
    // Phase 11.3.D++ — boss tier Hợp Thể (endgame cross-element) có cả top &
    // mid drop `linh_can_dan` — chance cao nhất cho top players.
    topDropPool: ['than_lan_giap', 'than_linh_tram', 'than_loi_dai', 'than_phach_chau', 'linh_can_dan'],
    midDropPool: ['than_phong_kiem', 'nhan_tien_dan', 'tien_van_dan', 'linh_can_dan'],
    // Phase 11.2.D+++ — cross-element endgame boss carry full Skill Book
    // Pack 1 (5 element basic) ở lowDropPool — Phase 12 pity sẽ phân phối
    // top 4-10 player; nguồn dual với DUNGEON_LOOT cho late-game farm.
    lowDropPool: [
      'tien_kim_sa',
      'phu_van_ngoc',
      'han_ngoc',
      'skill_book_kim_quang_tram',
      'skill_book_moc_linh_truong_dieu',
      'skill_book_thuy_kinh_phong_an',
      'skill_book_hoa_xa_phun_diem',
      'skill_book_thach_giap_ho_than',
    ],
    level: 44,
    element: null,
    regionKey: null,
    monsterType: 'BOSS',
  },
];

export function bossByKey(key: string): BossDef | undefined {
  return BOSSES.find((b) => b.key === key);
}

/** Rotation theo index — server lưu state ngoài hoặc derive từ count. */
export function pickBossByRotation(seed: number): BossDef {
  return BOSSES[seed % BOSSES.length];
}

/**
 * Phase 10 PR-5 helper — filter boss theo Ngũ Hành element. `null` =
 * cross-element / vô hệ. Phase 11.3 (`elementMultiplier`) sẽ cần helper
 * này cho boss spawn picker theo player spiritualRoot affinity.
 */
export function bossesByElement(element: ElementKey | null): BossDef[] {
  return BOSSES.filter((b) => (b.element ?? null) === element);
}

/**
 * Phase 10 PR-5 helper — filter boss theo regionKey. Phase 12.6
 * `BossService.heartbeat` dùng helper này để rotate boss theo region
 * (mỗi region 1 spawn slot ACTIVE — partial unique index DB-level
 * `WorldBoss_status_region_active_unique`). `null` regionKey trong
 * catalog (vd `hon_nguyen_yeu_to`) map sang `WORLD_BOSS_REGION_KEY` =
 * 'world' ở runtime DB layer (xem `bossSpawnRegions()`).
 */
export function bossesByRegion(regionKey: string): BossDef[] {
  if (regionKey === WORLD_BOSS_REGION_KEY) {
    return BOSSES.filter((b) => !b.regionKey);
  }
  return BOSSES.filter((b) => b.regionKey === regionKey);
}

/**
 * Phase 12.6 — DB regionKey constant cho cross-region "world" boss
 * (legacy `BossDef.regionKey === null`). `WorldBoss.regionKey` ở Prisma
 * layer là `String NOT NULL DEFAULT 'world'`, nên catalog null phải map
 * về 'world' trước khi insert. Cũng dùng làm fallback default cho
 * `adminSpawn` khi không truyền regionKey.
 */
export const WORLD_BOSS_REGION_KEY = 'world';

/**
 * Phase 12.6 — danh sách distinct region có ≥1 boss spawn-able trong
 * `BOSSES` catalog. Heartbeat loop iterate list này để check ACTIVE +
 * spawn boss thiếu per region. `null` regionKey trong catalog (cross-
 * region world boss) map về `WORLD_BOSS_REGION_KEY = 'world'`. Output
 * sorted để deterministic test + heartbeat ordering.
 */
export function bossSpawnRegions(): string[] {
  const set = new Set<string>();
  for (const boss of BOSSES) {
    set.add(boss.regionKey ?? WORLD_BOSS_REGION_KEY);
  }
  return Array.from(set).sort();
}

/**
 * Phase 10 PR-5 helper — filter boss theo recommendedRealm tier (FE bucket
 * UI). Boss panel hiện list flat; phase 11+ sẽ group theo realm tier.
 */
export function bossesByRealm(realmKey: string): BossDef[] {
  return BOSSES.filter((b) => b.recommendedRealm === realmKey);
}

/** Rate-limit attack 1.5s per character. */
export const BOSS_ATTACK_COOLDOWN_MS = 1500;

/** Mỗi đòn tốn 8 stamina + skill mp riêng. */
export const BOSS_STAMINA_PER_HIT = 8;

/** Boss sống tối đa N phút — sau đó EXPIRED và phân thưởng. */
export const BOSS_LIFETIME_MS = 30 * 60 * 1000;

/** Cooldown sau khi boss chết/hết hạn → spawn boss mới. */
export const BOSS_RESPAWN_DELAY_MS = 30 * 60 * 1000;

/** Reward distribution theo rank. */
export interface RewardSlice {
  rank: number;
  characterId: string;
  characterName: string;
  damage: string; // bigint string
  linhThach: string; // bigint string
  items: { itemKey: string; qty: number }[];
}
