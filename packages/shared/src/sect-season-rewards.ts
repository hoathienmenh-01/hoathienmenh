/**
 * Phase 15.7 — Sect Season Champion / MVP reward catalog.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration ở
 * file này. Runtime grant ở
 * `apps/api/src/modules/sect-season/sect-season-reward.service.ts`.
 *
 * Mục tiêu:
 *   - **Champion Sect**: sect rank 1 cuối season → mỗi member của sect
 *     champion (snapshot tại thời điểm finalize) được tặng mail thưởng
 *     `linhThach` + `exp` (KHÔNG `tienNgoc`, KHÔNG title runtime — defer
 *     phase sau).
 *   - **MVP Member**: top-1 cá nhân (snapshot `mvpCharacterId` của
 *     `SectSeasonSnapshot`) → tặng riêng mail thưởng cao hơn champion
 *     member (vì là individual achievement). 1 mail / season cho duy
 *     nhất MVP.
 *
 * Idempotency: server-side qua DB UNIQUE composite
 * `(seasonKey, rewardType, characterId)` ở
 * `SectSeasonRewardGrant`. Catalog file này pure — chỉ dùng để render
 * preview FE + reward def lookup ở runtime.
 *
 * Tie-break (deterministic):
 *   - Champion: sect đầu tiên trong `topSects[]` đã được sort theo
 *     `points DESC, contributors DESC, sectId ASC` ở snapshot service.
 *     Catalog không cần thêm rule.
 *   - MVP: character đầu tiên trong `topMembers[]` đã được sort
 *     `points DESC, characterId ASC`. Catalog không cần thêm rule.
 *   Helper {@link compareSectRankTie} / {@link compareMemberRankTie}
 *   exposed cho test invariant.
 *
 * Anti-abuse / balance:
 *   - Cap envelope cứng:
 *     - Champion `linhThach` ≤ {@link SECT_SEASON_CHAMPION_LINH_THACH_CAP}
 *       (5000 / member / season).
 *     - Champion `exp` ≤ {@link SECT_SEASON_CHAMPION_EXP_CAP}
 *       (2500 / member / season).
 *     - MVP `linhThach` ≤ {@link SECT_SEASON_MVP_LINH_THACH_CAP}
 *       (15000 / season — chỉ 1 character).
 *     - MVP `exp` ≤ {@link SECT_SEASON_MVP_EXP_CAP}
 *       (7500 / season).
 *     - Item entries cap: ≤ 3 / reward def, qty ≤ 5 / entry — match
 *       Territory owner reward conservative envelope.
 *   - Reward KHÔNG issue `tienNgoc` (premium currency) ở Phase 15.7 —
 *     defer cho admin manual grant nếu cần special event.
 *   - Reward KHÔNG issue title / buff runtime (defer phase sau khi có
 *     admin moderation).
 *
 * Source of truth:
 *   - `docs/BALANCE_MODEL.md` §sect-season § champion/MVP dial table.
 *   - `docs/ECONOMY_MODEL.md` §sources/sinks LinhThach (sect season cap).
 *   - `docs/CHANGELOG.md` Phase 15.7 entry.
 */

import { itemByKey } from './items';

// ────────────────────────────────────────────────────────────────────────
// Caps
// ────────────────────────────────────────────────────────────────────────

/** Cap linhThach champion / member / season. Vượt → catalog invariant fail. */
export const SECT_SEASON_CHAMPION_LINH_THACH_CAP = 5000;
/** Cap EXP champion / member / season. */
export const SECT_SEASON_CHAMPION_EXP_CAP = 2500;
/** Cap số item entry / champion reward def. */
export const SECT_SEASON_CHAMPION_ITEM_ENTRIES_CAP = 3;
/** Cap qty / entry champion. */
export const SECT_SEASON_CHAMPION_ITEM_QTY_CAP = 5;

/** Cap linhThach MVP / season (chỉ 1 character). */
export const SECT_SEASON_MVP_LINH_THACH_CAP = 15000;
/** Cap EXP MVP / season. */
export const SECT_SEASON_MVP_EXP_CAP = 7500;
/** Cap số item entry / MVP reward def. */
export const SECT_SEASON_MVP_ITEM_ENTRIES_CAP = 3;
/** Cap qty / entry MVP. */
export const SECT_SEASON_MVP_ITEM_QTY_CAP = 5;

/**
 * Cap số member nhận champion reward / sect / season. Sect quá đông member
 * sẽ bị truncate xuống cap này — list chọn theo `joinedAt ASC` (member
 * gắn bó lâu nhất ưu tiên), tie-break `characterId ASC`.
 *
 * Mục đích: tránh sect rỗng-add-bot-1000-member exploit; cap cũng giúp
 * giới hạn batch mail size cho mỗi grant run.
 */
export const SECT_SEASON_CHAMPION_MEMBER_CAP = 100;

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type SectSeasonRewardType = 'CHAMPION' | 'MVP';

export interface SectSeasonRewardItem {
  readonly itemKey: string;
  readonly qty: number;
}

/**
 * Reward def chung cho cả Champion + MVP. KHÔNG có `tienNgoc` /
 * `titleKey` / `buffKey` — Phase 15.7 chỉ grant linhThach + exp + items
 * (mirror Territory owner reward).
 */
export interface SectSeasonRewardDef {
  readonly linhThach: number;
  readonly exp: number;
  readonly itemRewards: ReadonlyArray<SectSeasonRewardItem>;
  /** i18n key cho mail subject (vd `sectSeason.championReward.subject`). */
  readonly subjectI18nKey: string;
  /** i18n key cho mail body. */
  readonly bodyI18nKey: string;
  /** Fallback subject vi/en — backend mail không cần vue-i18n context. */
  readonly subjectVi: string;
  readonly subjectEn: string;
  readonly bodyVi: string;
  readonly bodyEn: string;
}

// ────────────────────────────────────────────────────────────────────────
// Catalog (1 reward def shared across mọi season — Phase 15.7 minimal scope)
// ────────────────────────────────────────────────────────────────────────

/**
 * Phase 15.7 — Champion Sect Season reward (per-member của sect rank-1).
 *
 * Balance philosophy:
 *   - Mỗi season ≈ 4 tuần. Champion sect chia đều reward cho member.
 *   - Per-member cap 5000 LT ≈ 1.25k LT / tuần — nhỏ hơn weekly Sect
 *     War tier-1 reward (5k LT / tuần), tránh phá income chính.
 *   - Item: 2× `linh_lo_dan` (mid-tier consumable, neutral economy),
 *     KHÔNG drop equip cao cấp.
 */
export const SECT_SEASON_CHAMPION_REWARD: SectSeasonRewardDef = {
  linhThach: 5000,
  exp: 2000,
  itemRewards: [{ itemKey: 'linh_lo_dan', qty: 2 }],
  subjectI18nKey: 'sectSeason.championReward.subject',
  bodyI18nKey: 'sectSeason.championReward.body',
  subjectVi: 'Vinh Quang Tông Môn — Phần Thưởng Mùa',
  subjectEn: 'Sect Champion Season Reward',
  bodyVi:
    'Tông môn của bạn đứng đầu mùa giải vừa qua! Mỗi đệ tử nhận được phần thưởng vinh danh.',
  bodyEn:
    'Your sect ranked #1 this season! Every member receives a glory reward.',
};

/**
 * Phase 15.7 — MVP Member reward (top-1 cá nhân toàn season).
 *
 * Balance philosophy:
 *   - Chỉ 1 character / season. Reward cao hơn champion per-member để
 *     reward individual exceptional grind.
 *   - Per-season cap 15000 LT ≈ 3.75k LT / tuần — vẫn dưới full weekly
 *     SectWar grand prize. KHÔNG add tienNgoc.
 *   - Item: 1× `co_thien_dan` (high-tier consumable, marker of MVP
 *     status). KHÔNG drop title/buff runtime.
 */
export const SECT_SEASON_MVP_REWARD: SectSeasonRewardDef = {
  linhThach: 15000,
  exp: 6000,
  itemRewards: [{ itemKey: 'co_thien_dan', qty: 1 }],
  subjectI18nKey: 'sectSeason.mvpReward.subject',
  bodyI18nKey: 'sectSeason.mvpReward.body',
  subjectVi: 'Cá Nhân Xuất Sắc Nhất Mùa — Phần Thưởng MVP',
  subjectEn: 'Season MVP Reward',
  bodyVi:
    'Bạn là người đóng góp xuất sắc nhất mùa giải vừa qua! Phần thưởng vinh danh dành riêng cho bạn.',
  bodyEn: 'You are the season MVP! A special reward has been granted to you.',
};

// ────────────────────────────────────────────────────────────────────────
// Tie-break helpers
// ────────────────────────────────────────────────────────────────────────

export interface SectRankTuple {
  readonly sectId: string;
  readonly points: number;
  readonly contributors: number;
}

export interface MemberRankTuple {
  readonly characterId: string;
  readonly points: number;
}

/**
 * Tie-break sect rank deterministic:
 *   1. `points DESC`
 *   2. `contributors DESC` (sect đông và active hơn được ưu tiên)
 *   3. `sectId ASC` (lexicographic — ổn định, không depend wall time).
 *
 * Trả về số âm/dương tương thích `Array.sort` — 1.compare(2) < 0 nghĩa
 * là 1 đứng trước 2 (rank thấp hơn = rank tốt hơn).
 */
export function compareSectRankTie(a: SectRankTuple, b: SectRankTuple): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.contributors !== b.contributors) return b.contributors - a.contributors;
  return a.sectId < b.sectId ? -1 : a.sectId > b.sectId ? 1 : 0;
}

/**
 * Tie-break member rank deterministic:
 *   1. `points DESC`
 *   2. `characterId ASC` (lexicographic).
 *
 * KHÔNG dùng `createdAt` — character có thể được rename/reassign sect ở
 * Phase tương lai; `characterId` là PK ổn định.
 */
export function compareMemberRankTie(
  a: MemberRankTuple,
  b: MemberRankTuple,
): number {
  if (a.points !== b.points) return b.points - a.points;
  return a.characterId < b.characterId
    ? -1
    : a.characterId > b.characterId
      ? 1
      : 0;
}

// ────────────────────────────────────────────────────────────────────────
// Invariants
// ────────────────────────────────────────────────────────────────────────

export type SectSeasonRewardValidationCode =
  | 'NEGATIVE_LINH_THACH'
  | 'OVER_CAP_LINH_THACH'
  | 'NEGATIVE_EXP'
  | 'OVER_CAP_EXP'
  | 'TOO_MANY_ITEM_ENTRIES'
  | 'INVALID_ITEM_KEY'
  | 'NEGATIVE_ITEM_QTY'
  | 'OVER_CAP_ITEM_QTY'
  | 'EMPTY_REWARD'
  | 'INVALID_I18N_KEY'
  | 'EMPTY_FALLBACK_TEXT';

export interface SectSeasonRewardValidationIssue {
  readonly rewardType: SectSeasonRewardType;
  readonly code: SectSeasonRewardValidationCode;
  readonly detail: string;
}

function validateSingleRewardDef(
  rewardType: SectSeasonRewardType,
  def: SectSeasonRewardDef,
  caps: {
    readonly linhThachCap: number;
    readonly expCap: number;
    readonly itemEntriesCap: number;
    readonly itemQtyCap: number;
  },
): SectSeasonRewardValidationIssue[] {
  const issues: SectSeasonRewardValidationIssue[] = [];

  if (def.linhThach < 0) {
    issues.push({
      rewardType,
      code: 'NEGATIVE_LINH_THACH',
      detail: `linhThach=${def.linhThach}`,
    });
  } else if (def.linhThach > caps.linhThachCap) {
    issues.push({
      rewardType,
      code: 'OVER_CAP_LINH_THACH',
      detail: `linhThach=${def.linhThach} > cap=${caps.linhThachCap}`,
    });
  }

  if (def.exp < 0) {
    issues.push({
      rewardType,
      code: 'NEGATIVE_EXP',
      detail: `exp=${def.exp}`,
    });
  } else if (def.exp > caps.expCap) {
    issues.push({
      rewardType,
      code: 'OVER_CAP_EXP',
      detail: `exp=${def.exp} > cap=${caps.expCap}`,
    });
  }

  if (def.itemRewards.length > caps.itemEntriesCap) {
    issues.push({
      rewardType,
      code: 'TOO_MANY_ITEM_ENTRIES',
      detail: `entries=${def.itemRewards.length} > cap=${caps.itemEntriesCap}`,
    });
  }

  for (const it of def.itemRewards) {
    if (!itemByKey(it.itemKey)) {
      issues.push({
        rewardType,
        code: 'INVALID_ITEM_KEY',
        detail: `itemKey=${it.itemKey}`,
      });
    }
    if (it.qty < 0) {
      issues.push({
        rewardType,
        code: 'NEGATIVE_ITEM_QTY',
        detail: `${it.itemKey} qty=${it.qty}`,
      });
    } else if (it.qty > caps.itemQtyCap) {
      issues.push({
        rewardType,
        code: 'OVER_CAP_ITEM_QTY',
        detail: `${it.itemKey} qty=${it.qty} > cap=${caps.itemQtyCap}`,
      });
    }
  }

  if (def.linhThach === 0 && def.exp === 0 && def.itemRewards.length === 0) {
    issues.push({
      rewardType,
      code: 'EMPTY_REWARD',
      detail: 'reward def has no LT, no EXP, no items',
    });
  }

  // i18n key sanity: phải start với `sectSeason.` để giữ namespace ổn định.
  if (!def.subjectI18nKey.startsWith('sectSeason.')) {
    issues.push({
      rewardType,
      code: 'INVALID_I18N_KEY',
      detail: `subjectI18nKey=${def.subjectI18nKey}`,
    });
  }
  if (!def.bodyI18nKey.startsWith('sectSeason.')) {
    issues.push({
      rewardType,
      code: 'INVALID_I18N_KEY',
      detail: `bodyI18nKey=${def.bodyI18nKey}`,
    });
  }

  if (
    def.subjectVi.trim() === '' ||
    def.subjectEn.trim() === '' ||
    def.bodyVi.trim() === '' ||
    def.bodyEn.trim() === ''
  ) {
    issues.push({
      rewardType,
      code: 'EMPTY_FALLBACK_TEXT',
      detail: 'one of subjectVi/subjectEn/bodyVi/bodyEn is empty',
    });
  }

  return issues;
}

/**
 * Validate cả 2 reward catalog (Champion + MVP) cùng lúc. Trả về list
 * issues — dùng cho test invariant + admin status endpoint.
 */
export function validateSectSeasonRewards(): ReadonlyArray<SectSeasonRewardValidationIssue> {
  const championIssues = validateSingleRewardDef(
    'CHAMPION',
    SECT_SEASON_CHAMPION_REWARD,
    {
      linhThachCap: SECT_SEASON_CHAMPION_LINH_THACH_CAP,
      expCap: SECT_SEASON_CHAMPION_EXP_CAP,
      itemEntriesCap: SECT_SEASON_CHAMPION_ITEM_ENTRIES_CAP,
      itemQtyCap: SECT_SEASON_CHAMPION_ITEM_QTY_CAP,
    },
  );
  const mvpIssues = validateSingleRewardDef('MVP', SECT_SEASON_MVP_REWARD, {
    linhThachCap: SECT_SEASON_MVP_LINH_THACH_CAP,
    expCap: SECT_SEASON_MVP_EXP_CAP,
    itemEntriesCap: SECT_SEASON_MVP_ITEM_ENTRIES_CAP,
    itemQtyCap: SECT_SEASON_MVP_ITEM_QTY_CAP,
  });
  return [...championIssues, ...mvpIssues];
}

/**
 * Lookup reward def theo type. KHÔNG throw — caller chịu trách nhiệm
 * fallback (vd skip grant) nếu type lạ.
 */
export function sectSeasonRewardByType(
  rewardType: SectSeasonRewardType,
): SectSeasonRewardDef {
  return rewardType === 'CHAMPION'
    ? SECT_SEASON_CHAMPION_REWARD
    : SECT_SEASON_MVP_REWARD;
}
