/**
 * Phase 12.10.A — NPC Affinity & Relationship Foundation.
 *
 * Catalog tĩnh `NPC_AFFINITY` định nghĩa per-NPC config:
 *   - `initialScore`: điểm thân thiện khởi đầu (default 0).
 *   - `minScore` / `maxScore`: cap min/max — server clamp khi `addAffinityTx`.
 *   - `unlockHints[]`: hint cho FE biết tier nào mở khoá gì (UI tooltip).
 *
 * Tier mốc unlock (universal — mọi NPC dùng chung) ở `AFFINITY_TIERS`. Mỗi
 * tier có `minScore` (inclusive lower bound). Helper `affinityTierForScore()`
 * picks tier cao nhất mà `score >= tier.minScore`.
 *
 * Catalog NÀY:
 *   - KHÔNG ghi DB ở đây (runtime persistence ở `CharacterNpcAffinity`).
 *   - KHÔNG mở rộng `NPCS` catalog — giữ tách rời để dialogue/quest có thể
 *     reference 1 NPC bất kể NPC đó có affinity config hay không.
 *
 * Story dialogue integration:
 *   - Effect `change_affinity { npcKey, delta }` (story-dialogues.ts) gọi
 *     `NpcAffinityService.addAffinityTx()` trong cùng transaction với các
 *     effect khác — atomic.
 *   - Condition `affinity_min { npcKey, score }` (story-dialogues.ts) lookup
 *     `CharCtx.affinityByNpc[npcKey]` — gate node/choice theo điểm hiện tại.
 *
 * Design refs:
 *   - `docs/story/PHASE12_STORY_PROGRESS.md` (sẽ update Phase 12.10.A row).
 *   - `BALANCE_MODEL.md` cap reward — affinity grant per choice nhỏ (≤ 10).
 */

import { NPCS } from './npcs';

/**
 * Tier key — universal, mọi NPC dùng chung. Nếu thêm tier mới, nhớ cập nhật
 * `AFFINITY_TIERS` (helper `affinityTierForScore` lookup theo `minScore`).
 */
export type AffinityTierKey = 'xa_la' | 'quen_biet' | 'ban_huu' | 'tri_giao' | 'tri_ky';

export interface AffinityTierDef {
  /** Stable key — không đổi sau khi merge. */
  key: AffinityTierKey;
  /** Display label tiếng Việt. */
  label: string;
  /** Display label tiếng Anh (FE i18n fallback). */
  labelEn: string;
  /**
   * Inclusive lower-bound — `score >= minScore` thuộc tier này. Tiers ordered
   * tăng dần theo `minScore`. `xa_la.minScore` ≤ 0 để cover negative range.
   */
  minScore: number;
  /** 0-based order trong tier ladder (xa_la = 0 thấp nhất, tri_ky = 4 cao nhất). */
  order: number;
}

/**
 * Universal tier ladder. CHỐT: KHÔNG đổi `key` sau khi go-live (DB row có
 * thể reference qua effect history). Có thể thêm tier mới CUỐI ladder.
 *
 * Score range total: `[-100, 200]` (cap NpcAffinityDef defaults). `xa_la`
 * cover toàn bộ negative range tới quen_biet threshold.
 */
export const AFFINITY_TIERS: readonly AffinityTierDef[] = [
  { key: 'xa_la', label: 'Xa Lạ', labelEn: 'Stranger', minScore: -1000, order: 0 },
  { key: 'quen_biet', label: 'Quen Biết', labelEn: 'Acquaintance', minScore: 10, order: 1 },
  { key: 'ban_huu', label: 'Bằng Hữu', labelEn: 'Companion', minScore: 30, order: 2 },
  { key: 'tri_giao', label: 'Tri Giao', labelEn: 'Confidant', minScore: 60, order: 3 },
  { key: 'tri_ky', label: 'Tri Kỷ', labelEn: 'Soulbound', minScore: 100, order: 4 },
] as const;

/**
 * Hint cho FE biết tier này mở khoá gì (vd dialogue, quest, gift). Hiển
 * thị trên relationship panel cho player thấy "đường đi" của quan hệ.
 */
export interface AffinityUnlockHint {
  /** Tier mở khoá nội dung này. */
  tierKey: AffinityTierKey;
  /** Mô tả tiếng Việt cho FE tooltip / panel. */
  description: string;
  /** Mô tả tiếng Anh (i18n fallback). */
  descriptionEn: string;
}

export interface NpcAffinityDef {
  /** Match `NPCS[].key` — invariant test verify reference tồn tại. */
  npcKey: string;
  /** Score khởi đầu khi character chưa có row (lazy create với value này). */
  initialScore: number;
  /** Lower bound — `addAffinityTx` clamp `newScore = max(minScore, ...)`. */
  minScore: number;
  /** Upper bound — `addAffinityTx` clamp `newScore = min(maxScore, ...)`. */
  maxScore: number;
  /** Tier hint cho FE — sort theo `tierKey` order tăng dần. */
  unlockHints: readonly AffinityUnlockHint[];
}

/**
 * Catalog NPC trụ cột — mỗi NPC có cap min/max khác nhau theo bản chất:
 *   - Lăng Vân Sinh / Mộc Thanh Y (Hoa Thiên — đồng môn): `[-50, 200]`,
 *     khó giận lâu, có thể đạt `tri_ky`.
 *   - Hàn Dạ (rival): `[-100, 150]`, có thể trở thành `tri_giao` nhưng
 *     hiếm khi `tri_ky` (tính cách lạnh).
 *   - Tô Nguyệt Ly (mysterious): `[-50, 200]`.
 *   - Huyết La Sát (ma tu): `[-100, 100]`, trust tối đa `tri_ky` nhưng
 *     đáy thấp -100 (kẻ thù).
 *
 * Cap reward delta per choice ≤ `AFFINITY_DELTA_CAP_PER_CHOICE` (validator
 * test invariant) — tránh single dialogue bypass cả ladder.
 */
export const NPC_AFFINITY: readonly NpcAffinityDef[] = [
  {
    npcKey: 'npc_lang_van_sinh',
    initialScore: 0,
    minScore: -50,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở dialogue chia sẻ về Hoa Thiên Môn xưa.',
        descriptionEn: 'Unlocks dialogue about the old Hoa Thiên Sect.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Chưởng môn truyền ấn ký Hoa Thiên Sơn — secret bí cảnh.',
        descriptionEn: 'Sect master entrusts the Hoa Thiên Mountain seal — secret realm.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Hé lộ chân tướng Hạt Giống Vô Danh.',
        descriptionEn: 'Reveals the truth behind the Seed of the Nameless.',
      },
      {
        tierKey: 'tri_ky',
        description: 'Truyền thừa tâm pháp Hoa Thiên đời cuối.',
        descriptionEn: 'Inherits the final-generation Hoa Thiên heart-method.',
      },
    ],
  },
  {
    npcKey: 'npc_moc_thanh_y',
    initialScore: 0,
    minScore: -50,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Đại sư tỷ chia sẻ kinh nghiệm tu luyện sơ căn.',
        descriptionEn: 'Senior sister shares early-stage cultivation insights.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Cùng bàn luận thuật luyện đan Mộc hệ.',
        descriptionEn: 'Discuss Wood-element alchemy together.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Tin tưởng kể về Tịch Linh Chủng đang ăn mòn nàng.',
        descriptionEn: 'Trusts you with the truth of the Nether Spirit Seed corroding her.',
      },
    ],
  },
  {
    npcKey: 'npc_han_da',
    initialScore: 0,
    minScore: -100,
    maxScore: 150,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Hàn Dạ chấp nhận tỷ thí kiếm pháp.',
        descriptionEn: 'Hàn Dạ accepts a sword-art duel.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Cùng luyện kiếm — unlock một chiêu Huyền Kiếm.',
        descriptionEn: 'Spar together — unlocks a Huyền Kiếm sword art.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Hàn Dạ kể về sư tổ Huyền Kiếm Tông và mối thù xưa.',
        descriptionEn: 'Hàn Dạ shares the lore of his sect master and ancient feud.',
      },
    ],
  },
  {
    npcKey: 'npc_to_nguyet_ly',
    initialScore: 0,
    minScore: -50,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Tô Nguyệt Ly hé lộ thân phận hậu nhân Hoa Thiên lưu đày.',
        descriptionEn: 'Tô Nguyệt Ly hints at her exiled Hoa Thiên lineage.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Hợp tác tìm di tích Hoa Thiên đã bị xoá khỏi lịch sử.',
        descriptionEn: 'Cooperate to recover Hoa Thiên relics erased from history.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Tô Nguyệt Ly chia sẻ bản đồ Hoa Thiên Cổ Mộ.',
        descriptionEn: 'Tô Nguyệt Ly shares the map of the Ancient Hoa Thiên Tomb.',
      },
    ],
  },
  {
    npcKey: 'npc_huyet_la_sat',
    initialScore: 0,
    minScore: -100,
    maxScore: 100,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Huyết La Sát ngừng coi con là kẻ thù.',
        descriptionEn: 'Huyết La Sát stops treating you as an enemy.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở moral choice ma đạo: tha / giết / hợp tác.',
        descriptionEn: 'Unlocks moral choice path: spare / slay / cooperate.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Huyết La Sát hé lộ mặt tối Hoa Thiên đã ruồng bỏ y.',
        descriptionEn: 'Huyết La Sát reveals the dark side of Hoa Thiên that exiled him.',
      },
    ],
  },

  {
    npcKey: 'npc_a_linh',
    initialScore: 10,
    minScore: -20,
    maxScore: 120,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở lời nhắc guided path đầu game và mẹo daily nhẹ.',
        descriptionEn: 'Unlocks early guided-path reminders and light daily tips.',
      },
      {
        tierKey: 'ban_huu',
        description: 'A Linh tặng tin đồn nhỏ về ngoại môn và Hạt Giống Vô Danh.',
        descriptionEn: 'A Linh shares small outer-court rumors about the Nameless Seed.',
      },
    ],
  },
  {
    npcKey: 'npc_van_kim_nuong',
    initialScore: 0,
    minScore: -50,
    maxScore: 150,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở dialogue chợ và lịch thương đội Vạn Bảo.',
        descriptionEn: 'Unlocks market dialogue and Vạn Bảo caravan timing.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Gợi ý escort/market hidden hooks không phá economy.',
        descriptionEn: 'Hints at escort/market hidden hooks without breaking economy.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Được xem sổ giao dịch nghi liên quan Tịch Thiên Điện.',
        descriptionEn: 'Grants access to ledgers suspected to involve Tịch Thiên Hall.',
      },
    ],
  },
  {
    npcKey: 'npc_bach_de_tu',
    initialScore: 0,
    minScore: -100,
    maxScore: 80,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Hé lộ mâu thuẫn giữa tiên luật và tự do tu tiên.',
        descriptionEn: 'Reveals tension between immortal law and cultivation freedom.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở nhánh nghi vấn Tiên Đình Bạch Đế.',
        descriptionEn: 'Unlocks suspicion hooks around the White Emperor Immortal Court.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_linh_su_gia',
    initialScore: -10,
    minScore: -150,
    maxScore: 60,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Sứ giả giải thích triết lý “yên tĩnh” của Tịch Thiên.',
        descriptionEn: 'The emissary explains Tịch Thiên’s philosophy of imposed stillness.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở manh mối về Tịch Linh Chủng trong cơ thể Mộc Thanh Y.',
        descriptionEn: 'Unlocks clues about the Nether Spirit Seed inside Mộc Thanh Y.',
      },
    ],
  },
  {
    npcKey: 'npc_huyet_ha_su_gia',
    initialScore: -5,
    minScore: -120,
    maxScore: 100,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở lời giải thích về Huyết Hà Ma Tông và chợ đen.',
        descriptionEn: 'Unlocks explanations of the Blood River sect and black market.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Gợi ý tuyến ma đạo không đồng nghĩa với ác tuyệt đối.',
        descriptionEn: 'Hints that demonic path does not always mean absolute evil.',
      },
    ],
  },
  {
    npcKey: 'npc_hoa_thien_dao_to',
    initialScore: 0,
    minScore: 0,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Nghe tàn niệm tổ sư về “vá thiên đạo”.',
        descriptionEn: 'Hear the founder remnant explain “mending heavenly dao.”',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở ký ức phong ấn Vô Đạo Chủng.',
        descriptionEn: 'Unlocks memories of the seal against the Dao-less Seed.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Tổ sư giao lời cảnh báo về quyền tự chọn đạo.',
        descriptionEn: 'The founder entrusts a warning about the right to choose one’s path.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_thien_dao_chu',
    initialScore: -50,
    minScore: -200,
    maxScore: 50,
    unlockHints: [
      {
        tierKey: 'xa_la',
        description: 'Chỉ nghe đạo âm đối nghịch, chưa thể tiếp cận bản thể.',
        descriptionEn: 'Only hears the opposing Dao-echo; the true body remains unreachable.',
      },
      {
        tierKey: 'quen_biet',
        description: 'Hiểu động cơ khoá đại đạo của phản diện tối cao.',
        descriptionEn: 'Understands why the final antagonist wants to lock the great Dao.',
      },
    ],
  },
  // ─── Phase 33 — Quyển II–IV NPC affinity config ───────────────────────────
  {
    npcKey: 'npc_luc_binh',
    initialScore: 0,
    minScore: -60,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở dialogue về xích phi thăng và Phi Thăng Doanh.',
        descriptionEn: 'Unlocks dialogue about ascension chains and the Ascension Camp.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở route giải phóng phạm nhân Phi Thăng Doanh.',
        descriptionEn: 'Unlocks the route to free Ascension Camp prisoners.',
      },
      {
        tierKey: 'tri_giao',
        description: 'Tiết lộ ký ức cảnh tiên giới phía sau.',
        descriptionEn: 'Reveals memory of the deeper immortal realm behind the camp.',
      },
    ],
  },
  {
    npcKey: 'npc_tich_thien_thanh_su',
    initialScore: -20,
    minScore: -120,
    maxScore: 120,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Mở lập luận triết học của Tịch Thiên Điện.',
        descriptionEn: 'Unlocks the philosophical argument of Tịch Thiên Hall.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở route tiết lộ chân tướng Vô Đạo Chung.',
        descriptionEn: 'Unlocks the route revealing the true nature of the Endless Bell.',
      },
    ],
  },
  {
    npcKey: 'npc_dao_vuc_chi_tam',
    initialScore: 0,
    minScore: -80,
    maxScore: 200,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Đạo Vực sinh linh tin tưởng người chơi và tự nói nguyện vọng.',
        descriptionEn: 'Dao Domain lives trust the player and voice their wishes.',
      },
      {
        tierKey: 'ban_huu',
        description: 'Mở route luật mềm cho Đạo Vực Hoa Thiên.',
        descriptionEn: 'Unlocks the soft-law route for the Hoa Thiên Dao Domain.',
      },
    ],
  },
  {
    npcKey: 'npc_nguyen_linh_nu',
    initialScore: 0,
    minScore: -80,
    maxScore: 220,
    unlockHints: [
      {
        tierKey: 'ban_huu',
        description: 'Mở route Đạo Liên Hoa Thiên tiến hóa khỏi Bản Nguyên Hải.',
        descriptionEn: 'Unlocks the route for the Hoa Thiên Dao Lotus to evolve from the Origin Sea.',
      },
    ],
  },
  {
    npcKey: 'npc_huyen_huyen_giam_quan',
    initialScore: 0,
    minScore: -50,
    maxScore: 150,
    unlockHints: [
      {
        tierKey: 'quen_biet',
        description: 'Đọc câu khắc Huyền Huyền dành riêng cho đạo người chơi.',
        descriptionEn: 'Reads the Huyền Huyền inscription tailored to the player’s dao.',
      },
    ],
  },
  {
    npcKey: 'npc_vo_thuy_lao_nhan',
    initialScore: 10,
    minScore: -50,
    maxScore: 180,
    unlockHints: [
      {
        tierKey: 'ban_huu',
        description: 'Tiết lộ khởi đầu thật của người chơi.',
        descriptionEn: 'Reveals the player’s true beginning.',
      },
    ],
  },
  {
    npcKey: 'npc_vo_chung_dong_tu',
    initialScore: 0,
    minScore: -60,
    maxScore: 180,
    unlockHints: [
      {
        tierKey: 'ban_huu',
        description: 'Mở thư từ ngươi-tương-lai và Tịch Thiên Thánh Sứ tương lai.',
        descriptionEn: 'Unlocks letters from future-self and future Tịch Thiên Saint Envoy.',
      },
    ],
  },
] as const;

/** Cap delta tuyệt đối / 1 dialogue choice — ngăn farm khi catalog tự ý tăng. */
export const AFFINITY_DELTA_CAP_PER_CHOICE = 20;

/** Cap delta tuyệt đối / 1 quest reward — quest pacing ≤ dialogue × 2. */
export const AFFINITY_DELTA_CAP_PER_QUEST_REWARD = 40;

// ============================================================================
// Helpers — pure (không đụng runtime). Service consume.
// ============================================================================

/**
 * Lookup tier cao nhất mà `score >= tier.minScore`. Trả tier `xa_la` (order
 * 0) nếu score thấp hơn mọi tier (xa_la cover negative range).
 *
 * Performance: tier list nhỏ (5 phần tử) → O(N) loop. Không cần memoize.
 */
export function affinityTierForScore(score: number): AffinityTierDef {
  let best: AffinityTierDef = AFFINITY_TIERS[0];
  for (const t of AFFINITY_TIERS) {
    if (score >= t.minScore && t.order >= best.order) best = t;
  }
  return best;
}

/**
 * Lookup tier kế tiếp (order = current + 1) cho UI hint "còn X điểm tới
 * `<tier>` ". Trả `null` nếu đã ở tier cao nhất (`tri_ky`).
 */
export function nextAffinityTierForScore(score: number): AffinityTierDef | null {
  const cur = affinityTierForScore(score);
  return AFFINITY_TIERS.find((t) => t.order === cur.order + 1) ?? null;
}

/** Lookup catalog entry theo `npcKey`. */
export function npcAffinityDefForKey(npcKey: string): NpcAffinityDef | undefined {
  return NPC_AFFINITY.find((d) => d.npcKey === npcKey);
}

/**
 * Clamp score vào `[minScore, maxScore]` của NPC. Nếu npcKey không có catalog
 * entry, trả raw score (caller validate trước).
 */
export function clampAffinityScore(npcKey: string, score: number): number {
  const def = npcAffinityDefForKey(npcKey);
  if (!def) return score;
  if (score < def.minScore) return def.minScore;
  if (score > def.maxScore) return def.maxScore;
  return score;
}

/**
 * Validate catalog — invariant test pin-down các điểm dễ break:
 *   1. Mọi `npcKey` ∈ `NPCS`.
 *   2. KHÔNG duplicate `npcKey`.
 *   3. `minScore < maxScore`.
 *   4. `minScore <= initialScore <= maxScore`.
 *   5. Tier order tăng đều 0..N, `key` unique, `minScore` strictly tăng.
 *   6. `unlockHints[].tierKey` hợp lệ.
 *
 * Trả mảng error string; rỗng = OK.
 */
export function validateNpcAffinityCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const tierKeys = new Set(AFFINITY_TIERS.map((t) => t.key));

  // Tier ladder integrity.
  const sortedByOrder = [...AFFINITY_TIERS].sort((a, b) => a.order - b.order);
  let prevMin = -Infinity;
  let expectedOrder = 0;
  const seenTierKeys = new Set<string>();
  for (const t of sortedByOrder) {
    if (t.order !== expectedOrder) {
      errs.push(`Tier ${t.key} order ${t.order} expected ${expectedOrder}`);
    }
    expectedOrder += 1;
    if (seenTierKeys.has(t.key)) {
      errs.push(`Duplicate tier key: ${t.key}`);
    }
    seenTierKeys.add(t.key);
    if (t.minScore <= prevMin) {
      errs.push(`Tier ${t.key} minScore ${t.minScore} not strictly > prev ${prevMin}`);
    }
    prevMin = t.minScore;
  }

  // Per-NPC entries.
  const seenNpcs = new Set<string>();
  for (const def of NPC_AFFINITY) {
    if (seenNpcs.has(def.npcKey)) {
      errs.push(`Duplicate affinity entry: ${def.npcKey}`);
    }
    seenNpcs.add(def.npcKey);
    if (!npcKeys.has(def.npcKey)) {
      errs.push(`Affinity ${def.npcKey} references unknown NPC`);
    }
    if (def.minScore >= def.maxScore) {
      errs.push(`Affinity ${def.npcKey} minScore ${def.minScore} >= maxScore ${def.maxScore}`);
    }
    if (def.initialScore < def.minScore || def.initialScore > def.maxScore) {
      errs.push(
        `Affinity ${def.npcKey} initialScore ${def.initialScore} out of bounds [${def.minScore},${def.maxScore}]`,
      );
    }
    for (const hint of def.unlockHints) {
      if (!tierKeys.has(hint.tierKey)) {
        errs.push(`Affinity ${def.npcKey} hint references unknown tier ${hint.tierKey}`);
      }
      if (hint.description.length === 0) {
        errs.push(`Affinity ${def.npcKey} hint ${hint.tierKey} has empty description`);
      }
    }
  }

  return errs;
}
