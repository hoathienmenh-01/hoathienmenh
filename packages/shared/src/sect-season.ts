/**
 * Sect Season (Mùa Tông Môn) — Phase 13.2.A foundation + Phase 13.2.B
 * milestone claim helpers.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration. Catalog
 * snapshot:
 *   - Định nghĩa season catalog (4-tuần / season, stable key `season_YYYY_sN`).
 *   - Định nghĩa personal milestone catalog (5 mốc tiến độ cá nhân theo
 *     contribution points trong season).
 *   - Helper `currentSectSeason(now, tz)` / `sectSeasonByKey(key)` /
 *     `sectSeasonWeekKeys(season)` / `sectSeasonAchievedMilestones(points)`.
 *   - Phase 13.2.B: `sectSeasonClaimableMilestones` (achieved AND not yet
 *     claimed) + `sectSeasonRewardSummary` formatter helpers cho FE.
 *   - Validation invariants — runtime claim được implement ở Phase 13.2.B
 *     trong `SectSeasonService.claimMilestone` (CAS guard qua DB UNIQUE).
 *
 * Bối cảnh:
 *   - Sect War tuần lễ (Phase 13.1.A) đã có; Sect Missions/Shop (13.1.B) đã
 *     có. Phase 13.2.A foundation đứng trên top như một "long-form season"
 *     view: cộng dồn `SectWarContribution` qua nhiều tuần (default 4 tuần)
 *     → ra leaderboard + personal milestone progress.
 *   - Phase 13.2.B build trên foundation đó: thêm reward claim per-milestone
 *     thông qua `SectSeasonClaim` table (UNIQUE `(characterId, seasonKey,
 *     milestoneKey)` chống double claim + race condition).
 *   - KHÔNG đụng `SectWarContribution` schema, KHÔNG sửa weekly reward.
 *
 * Out-of-scope (Phase 13.2.C+):
 *   - PvP realtime, auction, diplomacy, alliance, sect-vs-sect war.
 *   - Editor CMS lớn cho season catalog (admin tool drag-drop, schedule cron).
 *   - Per-season milestone customization (Phase 13.2.A/B dùng common milestone
 *     catalog cho mọi season để giữ FE đơn giản).
 *   - Season-end snapshot/archive cron rollover.
 *
 * Anti-abuse / safety:
 *   - Season key ổn định YYYY_sN — không reuse across years.
 *   - Catalog timezone fix `Asia/Ho_Chi_Minh` để khớp Sect War weekly reset.
 *   - Milestone monotonic increasing (points strictly higher → reward không
 *     được giảm); validate ở test guard.
 *   - Claim window: chỉ claim được milestone trong season còn active hoặc đã
 *     kết thúc nhưng chưa expire (Phase 13.2.B cho phép claim mọi season key
 *     trong catalog — server-authoritative kiểm `personalPoints` snapshot).
 *   - Reward grant scale economy-safe: tổng 5 milestone < 25k linhThach +
 *     1k tienNgoc < weekly Sect War top tier — tránh inflation (BALANCE_MODEL).
 */

import { SECT_WAR_DEFAULT_TZ, sectWarWeekKey } from './sect-war';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type SectSeasonValidationCode =
  | 'INVALID_KEY'
  | 'INVALID_DATES'
  | 'INVALID_DURATION'
  | 'INVALID_MILESTONE_KEY'
  | 'INVALID_MILESTONE_REWARD'
  | 'INVALID_MILESTONE_POINTS'
  | 'NON_MONOTONIC_MILESTONES';

/**
 * Reward grant slice cho milestone catalog. Phase 13.2.A KHÔNG implement
 * runtime grant — đây chỉ là metadata FE render preview. Title/buff/items
 * placeholder cho 13.2.B+.
 */
export interface SectSeasonRewardGrant {
  readonly linhThach?: number;
  readonly tienNgoc?: number;
  readonly items?: ReadonlyArray<{ readonly itemKey: string; readonly qty: number }>;
  readonly titleKey?: string;
  readonly buffKey?: string;
}

export interface SectSeasonMilestoneDef {
  /** Stable milestone key — đừng rename sau khi production. */
  readonly key: string;
  /** Personal contribution points cần đạt trong season (>=1). */
  readonly requiredPoints: number;
  /** Reward grant payload (preview-only Phase 13.2.A). */
  readonly reward: SectSeasonRewardGrant;
  /** i18n key cho FE render label / desc. */
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
}

export interface SectSeasonDef {
  /** Stable season key — chuỗi `season_YYYY_sN` (vd `season_2026_s2`). */
  readonly key: string;
  /** UTC ISO của Monday 00:00 trong `timezone` — start (inclusive). */
  readonly startsAtIso: string;
  /** UTC ISO của Monday 00:00 trong `timezone` — end (exclusive). */
  readonly endsAtIso: string;
  /** Số tuần ISO span — fix 4 cho Phase 13.2.A. */
  readonly durationWeeks: number;
  /** Timezone dùng để compute weekly cutoff. */
  readonly timezone: string;
  /** i18n key cho label / desc — vd `sectSeason.season.season_2026_s2.label`. */
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
}

/**
 * Hàng leaderboard season — sect aggregate cộng dồn qua nhiều tuần.
 *
 * `points` = tổng `SectWarContribution.points` của mọi character thuộc
 * sect đó trong các weekKeys thuộc season. `weeksContributed` là số tuần
 * sect có ít nhất 1 row contribution (ổn định / activity heuristic).
 */
export interface SectSeasonLeaderboardRow {
  readonly rank: number;
  readonly sectId: string;
  readonly sectName: string;
  readonly points: number;
  readonly contributors: number;
  readonly weeksContributed: number;
}

export interface SectSeasonLeaderboardView {
  readonly seasonKey: string;
  readonly rows: ReadonlyArray<SectSeasonLeaderboardRow>;
}

/**
 * Personal status view — phục vụ FE render milestone progress + countdown.
 *
 *   - `personalPoints` = SUM `SectWarContribution.points` cho character trong
 *     season window (mọi activityKey).
 *   - `achievedMilestoneKeys` = milestone đã đạt (points >= requiredPoints).
 *   - `nextMilestone` = milestone tiếp theo chưa đạt (null nếu đã clear hết).
 *   - `weeksContributed` = distinct `weekKey` có row của character (0..durationWeeks).
 */
export interface SectSeasonMyStatusView {
  readonly seasonKey: string;
  readonly hasSect: boolean;
  readonly sectId: string | null;
  readonly sectName: string | null;
  readonly personalPoints: number;
  readonly weeksContributed: number;
  readonly achievedMilestoneKeys: ReadonlyArray<string>;
  readonly nextMilestoneKey: string | null;
  /**
   * Phase 13.2.B — milestone đã claim (có row `SectSeasonClaim`).
   * Subset của `achievedMilestoneKeys` (claim chỉ chạy được sau khi đạt).
   */
  readonly claimedMilestoneKeys: ReadonlyArray<string>;
  /**
   * Phase 13.2.B — milestone đạt nhưng chưa claim (achieved \ claimed).
   * FE render claim button enabled cho mọi key trong list này.
   */
  readonly claimableMilestoneKeys: ReadonlyArray<string>;
}

/**
 * Phase 13.2.B — kết quả của 1 lần claim thành công.
 *
 * `granted` snapshot reward thực tế đã trao (linhThach/tienNgoc/items),
 * dùng cho FE render reward toast/modal. `claimedAt` là server timestamp
 * (UTC ISO) — KHÔNG dùng client clock.
 */
export interface SectSeasonClaimResult {
  readonly seasonKey: string;
  readonly milestoneKey: string;
  readonly granted: {
    readonly linhThach: number;
    readonly tienNgoc: number;
    readonly items: ReadonlyArray<{ readonly itemKey: string; readonly qty: number }>;
    readonly titleKey: string | null;
    readonly buffKey: string | null;
  };
  readonly pointsAtClaim: number;
  readonly claimedAtIso: string;
}

/**
 * Phase 13.2.B — milestone catalog view DTO (response của
 * `GET /sect-season/milestones`). Chỉ là snapshot catalog `SECT_SEASON_MILESTONES`
 * cho FE — server không cần hit DB cho endpoint này.
 */
export interface SectSeasonMilestonesView {
  readonly milestones: ReadonlyArray<SectSeasonMilestoneDef>;
}

// ────────────────────────────────────────────────────────────────────────
// History snapshot + Hall of Fame types (Phase 13.2.C)
// ────────────────────────────────────────────────────────────────────────

/**
 * Phase 13.2.C — Snapshot 1 row sect rank trong season đã chốt.
 *
 * Mirror runtime `SectSeasonSectRank` schema. `sectName` snapshot tên tại
 * thời điểm finalize (không follow rename về sau — audit-correct).
 */
export interface SectSeasonHistorySectEntry {
  readonly rank: number;
  readonly sectId: string;
  readonly sectName: string;
  readonly points: number;
  readonly contributors: number;
  readonly weeksContributed: number;
}

/**
 * Phase 13.2.C — Snapshot 1 row top contributor cá nhân trong season đã
 * chốt. Mirror runtime `SectSeasonTopMember` schema.
 *
 * `sectId`/`sectName` nullable: character không có sect tại lúc finalize
 * (vd rời sect giữa season nhưng trước đó đã ghi điểm). Phase 13.2.C
 * không attempt re-attribute — snapshot tên + sect ngay tại finalize.
 */
export interface SectSeasonHistoryMemberEntry {
  readonly rank: number;
  readonly characterId: string;
  readonly characterName: string;
  readonly sectId: string | null;
  readonly sectName: string | null;
  readonly points: number;
}

/**
 * Phase 13.2.C — Summary 1 season đã chốt cho list view.
 *
 * Denormalized champion (rank-1 sect) + mvp (rank-1 cá nhân) trực tiếp
 * trong row để FE list không cần fetch detail từng season. Detail view
 * (full leaderboard + topMembers) gọi qua `GET /sect-season/history/:key`.
 *
 * `champion`/`mvp` null nếu season hoàn toàn không có contribution
 * (snapshot empty — vẫn được tạo với totals=0 để mark "đã chốt").
 */
export interface SectSeasonHistorySummary {
  readonly seasonKey: string;
  /** ISO timestamp lúc tạo snapshot. */
  readonly finalizedAt: string;
  readonly totalSects: number;
  readonly totalContributors: number;
  readonly totalPoints: number;
  readonly champion: SectSeasonHistorySectEntry | null;
  readonly mvp: SectSeasonHistoryMemberEntry | null;
}

/**
 * Phase 13.2.C — Detail view 1 season đã chốt: full top-N sect leaderboard
 * + top-N cá nhân. Sort theo `rank` ascending.
 */
export interface SectSeasonHistoryView {
  readonly seasonKey: string;
  readonly finalizedAt: string;
  readonly totalSects: number;
  readonly totalContributors: number;
  readonly totalPoints: number;
  readonly sects: ReadonlyArray<SectSeasonHistorySectEntry>;
  readonly topMembers: ReadonlyArray<SectSeasonHistoryMemberEntry>;
}

/**
 * Phase 13.2.C — List view: tất cả season đã chốt + summary mỗi season.
 *
 * Order: `finalizedAt` descending (newest first) — UX bias toward recent
 * memorable seasons.
 */
export interface SectSeasonHistoryListView {
  readonly seasons: ReadonlyArray<SectSeasonHistorySummary>;
}

/**
 * Phase 13.2.C — Aggregated Hall of Fame entry cho 1 sect across multiple
 * seasons.
 *
 *   - `championships` = số lần sect đứng rank-1 trong các season đã chốt.
 *   - `podiums`       = số lần sect đứng top-3.
 *   - `appearances`   = số season sect có rank row (top-N theo
 *     `LEADERBOARD_TOP`).
 *   - `totalPoints`   = tổng `points` cộng dồn qua mọi season đã chốt.
 *   - `bestRank`      = rank tốt nhất từng đạt (1 = best).
 *   - `latestSeasonKey` = season key gần nhất sect xuất hiện (cho UX badge).
 */
export interface SectHallOfFameSectEntry {
  readonly sectId: string;
  readonly sectName: string;
  readonly championships: number;
  readonly podiums: number;
  readonly appearances: number;
  readonly bestRank: number;
  readonly totalPoints: number;
  readonly latestSeasonKey: string;
}

/**
 * Phase 13.2.C — Aggregated Hall of Fame entry cho 1 character across
 * multiple seasons.
 *
 *   - `mvps`            = số lần character đứng rank-1 cá nhân.
 *   - `podiums`         = số lần character đứng top-3 cá nhân.
 *   - `appearances`     = số season có row trong `SectSeasonTopMember`
 *     (= số lần lọt top-N).
 *   - `totalPoints`     = tổng `points` cộng dồn qua mọi season đã chốt
 *     (chỉ cộng từ row đã lọt top-N — KHÔNG aggregate full
 *     `SectWarContribution` để tránh phụ thuộc dữ liệu thô).
 *   - `latestSeasonKey` / `latestSectName` = season + sect gần nhất
 *     (cho UX badge: "current sect" + "last seen").
 */
export interface SectHallOfFameMemberEntry {
  readonly characterId: string;
  readonly characterName: string;
  readonly mvps: number;
  readonly podiums: number;
  readonly appearances: number;
  readonly bestRank: number;
  readonly totalPoints: number;
  readonly latestSeasonKey: string;
  readonly latestSectName: string | null;
}

/**
 * Phase 13.2.C — Hall of Fame view aggregate.
 *
 * Order:
 *   - `sects`: championships desc → podiums desc → totalPoints desc →
 *     sectName asc.
 *   - `members`: mvps desc → podiums desc → totalPoints desc →
 *     characterName asc.
 *
 * Caller có thể slice client-side (vd top 10) — server trả full list nhưng
 * size luôn bounded vì `SectSeasonSectRank` / `SectSeasonTopMember` đã
 * top-N per season (= LEADERBOARD_TOP * #seasons finalized).
 */
export interface SectHallOfFameView {
  readonly sects: ReadonlyArray<SectHallOfFameSectEntry>;
  readonly members: ReadonlyArray<SectHallOfFameMemberEntry>;
  readonly totalSeasonsFinalized: number;
}

/**
 * Phase 13.2.C — Compact entry types cho FE rendering. Re-export alias để
 * khớp tên trong spec PR. Caller có thể dùng `SectHallOfFameEntry` như
 * union nếu component generic.
 */
export type SectHallOfFameEntry = SectHallOfFameSectEntry | SectHallOfFameMemberEntry;

/**
 * Phase 13.2.C — Số lượng top member / season được snapshot. Match
 * `LEADERBOARD_TOP` của Sect War để FE rendering đồng nhất (top 10 sect +
 * top 10 cá nhân / season đã chốt).
 */
export const SECT_SEASON_TOP_MEMBERS = 10;

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Default timezone — match Sect War + Mission reset (Asia/Ho_Chi_Minh).
 * Đồng nhất với weekly loop để boundary 00:00 ICT khớp.
 */
export const SECT_SEASON_DEFAULT_TZ = SECT_WAR_DEFAULT_TZ;

/**
 * Số tuần / season — Phase 13.2.A fix 4. Mở rộng (8/12) ở phase sau nếu cần.
 */
export const SECT_SEASON_WEEKS = 4;

/**
 * Sect Season catalog — Phase 13.2.A.
 *
 * 13 seasons × 4 tuần ≈ 1 năm coverage (2026-03-30 → 2027-03-28). Mọi
 * `startsAtIso` = Monday 00:00 ICT (Sunday 17:00 UTC). Mỗi season nối liền
 * season trước (endsAtIso = next.startsAtIso) — không gap.
 *
 * Stable order: oldest → newest. KHÔNG remove entry cũ (lịch sử leaderboard
 * còn reference seasonKey trong audit/replay).
 */
export const SECT_SEASONS: readonly SectSeasonDef[] = [
  {
    key: 'season_2026_s1',
    startsAtIso: '2026-03-29T17:00:00.000Z', // Mon 2026-03-30 ICT
    endsAtIso: '2026-04-26T17:00:00.000Z', // Mon 2026-04-27 ICT
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s1.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s1.desc',
  },
  {
    key: 'season_2026_s2',
    startsAtIso: '2026-04-26T17:00:00.000Z',
    endsAtIso: '2026-05-24T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s2.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s2.desc',
  },
  {
    key: 'season_2026_s3',
    startsAtIso: '2026-05-24T17:00:00.000Z',
    endsAtIso: '2026-06-21T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s3.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s3.desc',
  },
  {
    key: 'season_2026_s4',
    startsAtIso: '2026-06-21T17:00:00.000Z',
    endsAtIso: '2026-07-19T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s4.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s4.desc',
  },
  {
    key: 'season_2026_s5',
    startsAtIso: '2026-07-19T17:00:00.000Z',
    endsAtIso: '2026-08-16T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s5.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s5.desc',
  },
  {
    key: 'season_2026_s6',
    startsAtIso: '2026-08-16T17:00:00.000Z',
    endsAtIso: '2026-09-13T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s6.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s6.desc',
  },
  {
    key: 'season_2026_s7',
    startsAtIso: '2026-09-13T17:00:00.000Z',
    endsAtIso: '2026-10-11T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s7.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s7.desc',
  },
  {
    key: 'season_2026_s8',
    startsAtIso: '2026-10-11T17:00:00.000Z',
    endsAtIso: '2026-11-08T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s8.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s8.desc',
  },
  {
    key: 'season_2026_s9',
    startsAtIso: '2026-11-08T17:00:00.000Z',
    endsAtIso: '2026-12-06T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s9.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s9.desc',
  },
  {
    key: 'season_2026_s10',
    startsAtIso: '2026-12-06T17:00:00.000Z',
    endsAtIso: '2027-01-03T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2026_s10.label',
    descriptionI18nKey: 'sectSeason.season.season_2026_s10.desc',
  },
  {
    key: 'season_2027_s1',
    startsAtIso: '2027-01-03T17:00:00.000Z',
    endsAtIso: '2027-01-31T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2027_s1.label',
    descriptionI18nKey: 'sectSeason.season.season_2027_s1.desc',
  },
  {
    key: 'season_2027_s2',
    startsAtIso: '2027-01-31T17:00:00.000Z',
    endsAtIso: '2027-02-28T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2027_s2.label',
    descriptionI18nKey: 'sectSeason.season.season_2027_s2.desc',
  },
  {
    key: 'season_2027_s3',
    startsAtIso: '2027-02-28T17:00:00.000Z',
    endsAtIso: '2027-03-28T17:00:00.000Z',
    durationWeeks: SECT_SEASON_WEEKS,
    timezone: SECT_SEASON_DEFAULT_TZ,
    labelI18nKey: 'sectSeason.season.season_2027_s3.label',
    descriptionI18nKey: 'sectSeason.season.season_2027_s3.desc',
  },
];

/**
 * Personal milestone catalog — chia sẻ giữa mọi season trong Phase 13.2.A.
 *
 * 5 mốc points, increasing strict. Order stable: bronze → silver → gold →
 * platinum → diamond. Reward grant Phase 13.2.A là metadata preview-only —
 * KHÔNG implement runtime claim trong PR này.
 *
 * Balance philosophy (BALANCE_MODEL.md §sect-season):
 *   - Bronze (100 pts): đạt nhanh trong 1-2 ngày active → onboarding hook.
 *   - Silver (500 pts): ~1 tuần active đầy đủ.
 *   - Gold (1500 pts): ~2-3 tuần active (≈ nửa season).
 *   - Platinum (3500 pts): full season active + boss/quest top.
 *   - Diamond (7500 pts): exceptional grind ≥ 7000 contribution = top 5%.
 *
 * Reward grant scale theo dial ECONOMY_MODEL §weekly: linhThach ratio ~1:5
 * vs LT/contribution. Tổng grant cả 5 milestone < 25k LT — an toàn economy.
 */
export const SECT_SEASON_MILESTONES: readonly SectSeasonMilestoneDef[] = [
  {
    key: 'milestone_bronze',
    requiredPoints: 100,
    reward: { linhThach: 200 },
    labelI18nKey: 'sectSeason.milestone.milestone_bronze.label',
    descriptionI18nKey: 'sectSeason.milestone.milestone_bronze.desc',
  },
  {
    key: 'milestone_silver',
    requiredPoints: 500,
    reward: { linhThach: 1000, tienNgoc: 50 },
    labelI18nKey: 'sectSeason.milestone.milestone_silver.label',
    descriptionI18nKey: 'sectSeason.milestone.milestone_silver.desc',
  },
  {
    key: 'milestone_gold',
    requiredPoints: 1500,
    reward: { linhThach: 2500, tienNgoc: 150 },
    labelI18nKey: 'sectSeason.milestone.milestone_gold.label',
    descriptionI18nKey: 'sectSeason.milestone.milestone_gold.desc',
  },
  {
    key: 'milestone_platinum',
    requiredPoints: 3500,
    reward: { linhThach: 5000, tienNgoc: 300 },
    labelI18nKey: 'sectSeason.milestone.milestone_platinum.label',
    descriptionI18nKey: 'sectSeason.milestone.milestone_platinum.desc',
  },
  {
    key: 'milestone_diamond',
    requiredPoints: 7500,
    reward: { linhThach: 10000, tienNgoc: 500 },
    labelI18nKey: 'sectSeason.milestone.milestone_diamond.label',
    descriptionI18nKey: 'sectSeason.milestone.milestone_diamond.desc',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Lookup season def theo key. Trả undefined nếu không tồn tại
 * (KHÔNG throw — caller decide).
 */
export function sectSeasonByKey(key: string): SectSeasonDef | undefined {
  return SECT_SEASONS.find((s) => s.key === key);
}

/**
 * Lookup milestone def theo key. Trả undefined nếu không tồn tại.
 */
export function sectSeasonMilestoneByKey(
  key: string,
): SectSeasonMilestoneDef | undefined {
  return SECT_SEASON_MILESTONES.find((m) => m.key === key);
}

/**
 * Find season chứa `now` (startsAt ≤ now < endsAt).
 *
 * Trả undefined nếu `now` nằm ngoài mọi season trong catalog (vd trước
 * season đầu hoặc sau season cuối). Caller (FE/API) decide fallback —
 * Phase 13.2.A trả `null` cho `data.season`.
 *
 * Note: catalog stable order (oldest → newest), nên linear scan O(n) với
 * n ≈ 13 OK. Không cần binary search trong Phase 13.2.A.
 */
export function currentSectSeason(now: Date): SectSeasonDef | undefined {
  const t = now.getTime();
  for (const s of SECT_SEASONS) {
    const start = new Date(s.startsAtIso).getTime();
    const end = new Date(s.endsAtIso).getTime();
    if (t >= start && t < end) return s;
  }
  return undefined;
}

/**
 * Compute danh sách `weekKey` (ISO week, format `YYYY-Www`) thuộc season.
 *
 * Length = `season.durationWeeks`. Dùng cho leaderboard/me query
 * (`SectWarContribution.weekKey IN (...)`) — đảm bảo aggregation chính
 * xác kể cả khi row được insert trễ (vd boss claim retry sang tuần sau).
 *
 * Implementation: step `season.startsAtIso` lên +7 ngày × durationWeeks
 * lần, mỗi step dùng `sectWarWeekKey()` để compute (consistent timezone).
 * Cộng `+60_000ms` margin để tránh edge case Monday 00:00:00 UTC ICT-aware
 * boundary precision (helper sectWarWeekKey hoạt động đúng nhưng margin
 * an toàn hơn cho tương lai DST nếu đổi tz).
 */
export function sectSeasonWeekKeys(season: SectSeasonDef): string[] {
  const keys: string[] = [];
  const start = new Date(season.startsAtIso).getTime();
  for (let w = 0; w < season.durationWeeks; w++) {
    const t = start + w * 7 * 86_400_000 + 60_000;
    keys.push(sectWarWeekKey(new Date(t), season.timezone));
  }
  return keys;
}

/**
 * Trả về danh sách milestone đã đạt (`requiredPoints ≤ personalPoints`).
 *
 * Order stable theo `SECT_SEASON_MILESTONES` (catalog order = ascending
 * requiredPoints). Caller dùng cho FE render check icon + audit log.
 */
export function sectSeasonAchievedMilestones(
  personalPoints: number,
): SectSeasonMilestoneDef[] {
  if (!Number.isFinite(personalPoints) || personalPoints < 0) return [];
  return SECT_SEASON_MILESTONES.filter((m) => personalPoints >= m.requiredPoints);
}

/**
 * Trả milestone tiếp theo chưa đạt (null nếu đã clear hết). Dùng cho FE
 * render "next goal" hint.
 */
export function sectSeasonNextMilestone(
  personalPoints: number,
): SectSeasonMilestoneDef | null {
  if (!Number.isFinite(personalPoints)) return null;
  for (const m of SECT_SEASON_MILESTONES) {
    if (personalPoints < m.requiredPoints) return m;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Validation (catalog invariants — runtime check + test guard)
// ────────────────────────────────────────────────────────────────────────

/**
 * Validate single SectSeasonDef.
 *
 * Rules:
 *   - key match `season_YYYY_sN` regex.
 *   - startsAt < endsAt (ISO parsable).
 *   - durationWeeks >= 1.
 *   - (endsAt - startsAt) ≈ durationWeeks * 7d (±1 day tolerance for DST).
 */
export function validateSectSeason(
  def: SectSeasonDef,
): SectSeasonValidationCode | null {
  if (!/^season_\d{4}_s\d+$/.test(def.key)) return 'INVALID_KEY';
  const start = Date.parse(def.startsAtIso);
  const end = Date.parse(def.endsAtIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'INVALID_DATES';
  if (start >= end) return 'INVALID_DATES';
  if (!Number.isFinite(def.durationWeeks) || def.durationWeeks < 1) {
    return 'INVALID_DURATION';
  }
  const expectedMs = def.durationWeeks * 7 * 86_400_000;
  const actualMs = end - start;
  // ±1 day tolerance (DST defensiveness; Asia/Ho_Chi_Minh không DST nên 0).
  if (Math.abs(actualMs - expectedMs) > 86_400_000) return 'INVALID_DURATION';
  return null;
}

/**
 * Validate single SectSeasonMilestoneDef.
 *
 * Rules:
 *   - key match `milestone_[a-z0-9_]+` regex.
 *   - requiredPoints >= 1.
 *   - reward có ít nhất 1 grant (linhThach > 0 OR tienNgoc > 0 OR items
 *     hoặc title/buff — placeholder cho 13.2.B+).
 */
export function validateSectSeasonMilestone(
  def: SectSeasonMilestoneDef,
): SectSeasonValidationCode | null {
  if (!/^milestone_[a-z][a-z0-9_]*$/.test(def.key)) return 'INVALID_MILESTONE_KEY';
  if (!Number.isFinite(def.requiredPoints) || def.requiredPoints < 1) {
    return 'INVALID_MILESTONE_POINTS';
  }
  const r = def.reward;
  const hasLinhThach = (r.linhThach ?? 0) > 0;
  const hasTienNgoc = (r.tienNgoc ?? 0) > 0;
  const hasItems = (r.items?.length ?? 0) > 0;
  const hasTitle = !!r.titleKey;
  const hasBuff = !!r.buffKey;
  if (!hasLinhThach && !hasTienNgoc && !hasItems && !hasTitle && !hasBuff) {
    return 'INVALID_MILESTONE_REWARD';
  }
  return null;
}

/**
 * Validate full milestone catalog: monotonic increasing requiredPoints.
 *
 * Bảo đảm milestone N+1 yêu cầu nhiều points hơn milestone N — đơn giản hóa
 * UX render + tránh edge case "milestone không thể đạt".
 */
export function validateSectSeasonMilestonesMonotonic(
  defs: ReadonlyArray<SectSeasonMilestoneDef>,
): SectSeasonValidationCode | null {
  for (let i = 1; i < defs.length; i++) {
    if (defs[i].requiredPoints <= defs[i - 1].requiredPoints) {
      return 'NON_MONOTONIC_MILESTONES';
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Phase 13.2.B — claim helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Trả mảng milestone đạt nhưng chưa claim — input là `personalPoints` +
 * tập key đã claim. Pure helper, dùng cho FE render claim button enabled
 * state và server cross-check trước khi gọi `claimMilestone`.
 *
 * Order stable theo catalog (ascending requiredPoints) → FE render top-down.
 */
export function sectSeasonClaimableMilestones(
  personalPoints: number,
  claimedKeys: ReadonlyArray<string>,
): SectSeasonMilestoneDef[] {
  const achieved = sectSeasonAchievedMilestones(personalPoints);
  if (achieved.length === 0) return [];
  const claimed = new Set(claimedKeys);
  return achieved.filter((m) => !claimed.has(m.key));
}

/**
 * Tổng hợp reward grant thành object dễ hiển thị (FE toast / modal).
 *
 * Default 0/[]/null cho field optional → FE không cần defensive check.
 * KHÔNG dùng cho currency apply (server gọi trực tiếp `def.reward`).
 */
export function sectSeasonRewardSummary(reward: SectSeasonRewardGrant): {
  linhThach: number;
  tienNgoc: number;
  items: ReadonlyArray<{ itemKey: string; qty: number }>;
  titleKey: string | null;
  buffKey: string | null;
} {
  return {
    linhThach: reward.linhThach ?? 0,
    tienNgoc: reward.tienNgoc ?? 0,
    items: reward.items?.map((it) => ({ itemKey: it.itemKey, qty: it.qty })) ?? [],
    titleKey: reward.titleKey ?? null,
    buffKey: reward.buffKey ?? null,
  };
}
