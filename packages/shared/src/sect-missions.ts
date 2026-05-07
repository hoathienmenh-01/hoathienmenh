/**
 * Sect Missions (Nhiệm vụ Tông Môn) — Phase 13.1.B catalog & helpers.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration.
 *
 * Mục tiêu PR (file 13.1.B Phase A):
 *   - Định nghĩa Sect Mission catalog (DAILY/WEEKLY) — riêng với MISSIONS
 *     thường (`missions.ts`) vì:
 *       - Mission Tông Môn yêu cầu character phải có `sectId` mới claim được.
 *       - Reward chính là `rewardContribution` (cộng vào
 *         `Character.sectContribBalance` — spendable currency cho Sect Shop).
 *       - Progress derive từ `SectWarContribution` (đã ghi từ gameplay hooks
 *         dungeon/boss/quest/daily login) hoặc từ Character snapshot
 *         (breakthrough). KHÔNG có `MissionProgress`-style row riêng — tránh
 *         double-source-of-truth.
 *   - Period key compute: `YYYY-MM-DD` (DAILY) / `YYYY-Www` (WEEKLY) theo
 *     `Asia/Ho_Chi_Minh` để khớp với mission/sect-war reset.
 *
 * Anti-abuse:
 *   - Mỗi (characterId, missionKey, periodKey) chỉ claim 1 lần
 *     (DB UNIQUE — xem `SectMissionClaim` trong schema).
 *   - Server-authoritative; FE chỉ render từ catalog + status hiện tại.
 *   - Character không có sect → reject claim (`SECT_REQUIRED`).
 */

import { sectWarWeekKey, SECT_WAR_DEFAULT_TZ } from './sect-war';
import { localPartsInTz } from './liveops';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type SectMissionCadence = 'DAILY' | 'WEEKLY';

/**
 * Mission goal kind — quyết định cách derive `currentAmount`.
 *
 *   - `dungeon_clear`: count `SectWarContribution` activityKey=`dungeon_clear`
 *     trong period window (theo cadence).
 *   - `boss_participate`: count distinct boss participation
 *     (`SectWarContribution` activityKey=`boss_participation`).
 *   - `boss_damage`: sum points contribution `boss_top_damage` trong period
 *     (proxy cho damage volume — points scale theo damage rank).
 *   - `quest_complete`: count `SectWarContribution` activityKey=`quest_complete`.
 *   - `breakthrough_success`: count `Character.realmStage` advancement events.
 *     Phase 13.1.B: derive từ count `SectWarContribution` activityKey
 *     `breakthrough_success` (mới). Hook ghi point vào contribution khi
 *     breakthrough success → mission progress tự derive.
 */
export type SectMissionGoalKind =
  | 'dungeon_clear'
  | 'boss_participate'
  | 'boss_damage'
  | 'quest_complete'
  | 'breakthrough_success';

export interface SectMissionRewardItem {
  readonly itemKey: string;
  readonly qty: number;
}

export interface SectMissionDef {
  /** Stable key (DB identifier). Đừng rename sau khi production. */
  readonly key: string;
  readonly cadence: SectMissionCadence;
  readonly goalKind: SectMissionGoalKind;
  /** Số đơn vị cần đạt để claim (>= 1). */
  readonly target: number;
  /** Điểm cống hiến cộng vào balance khi claim (>= 0). */
  readonly rewardContribution: number;
  /** Optional currency reward (cộng qua CurrencyService). */
  readonly rewardLinhThach?: number;
  /** Optional item reward (qua InventoryService). */
  readonly rewardItems?: ReadonlyArray<SectMissionRewardItem>;
  /** i18n key cho FE render label / desc / hint. */
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
  readonly rewardHintI18nKey: string;
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Phase 13.1.B initial sect mission catalog. Order stable: 3 daily → 2 weekly.
 *
 * Balance philosophy (BALANCE_MODEL.md §sect-mission):
 *   - DAILY: 25-40 contribution per mission, đạt nhanh trong 1 phiên gameplay.
 *   - WEEKLY: 100-200 contribution mỗi mission, đòi hỏi multiple session.
 *   - Daily total ≈ 100 contribution; weekly total ≈ 300 contribution
 *     ⇒ player active mỗi tuần đạt ~700-1000 contribution → đủ mua 1-2
 *     Sect Shop entry mid-tier (xem `sect-shop.ts`).
 *   - Cộng dồn `Character.sectContribLifetime` cho audit/leaderboard sau.
 */
export const SECT_MISSIONS: readonly SectMissionDef[] = [
  {
    key: 'sect_daily_dungeon_3',
    cadence: 'DAILY',
    goalKind: 'dungeon_clear',
    target: 3,
    rewardContribution: 30,
    labelI18nKey: 'sectMission.daily_dungeon_3.label',
    descriptionI18nKey: 'sectMission.daily_dungeon_3.desc',
    rewardHintI18nKey: 'sectMission.daily_dungeon_3.rewardHint',
  },
  {
    key: 'sect_daily_boss_participate',
    cadence: 'DAILY',
    goalKind: 'boss_participate',
    target: 1,
    rewardContribution: 40,
    labelI18nKey: 'sectMission.daily_boss_participate.label',
    descriptionI18nKey: 'sectMission.daily_boss_participate.desc',
    rewardHintI18nKey: 'sectMission.daily_boss_participate.rewardHint',
  },
  {
    key: 'sect_daily_boss_damage',
    cadence: 'DAILY',
    goalKind: 'boss_damage',
    target: 25, // ≈ điểm contribution boss_top_damage 1 lần (rank cao).
    rewardContribution: 35,
    labelI18nKey: 'sectMission.daily_boss_damage.label',
    descriptionI18nKey: 'sectMission.daily_boss_damage.desc',
    rewardHintI18nKey: 'sectMission.daily_boss_damage.rewardHint',
  },
  {
    key: 'sect_weekly_quest_5',
    cadence: 'WEEKLY',
    goalKind: 'quest_complete',
    target: 5,
    rewardContribution: 150,
    rewardLinhThach: 500,
    labelI18nKey: 'sectMission.weekly_quest_5.label',
    descriptionI18nKey: 'sectMission.weekly_quest_5.desc',
    rewardHintI18nKey: 'sectMission.weekly_quest_5.rewardHint',
  },
  {
    key: 'sect_weekly_breakthrough_1',
    cadence: 'WEEKLY',
    goalKind: 'breakthrough_success',
    target: 1,
    rewardContribution: 200,
    rewardLinhThach: 800,
    labelI18nKey: 'sectMission.weekly_breakthrough_1.label',
    descriptionI18nKey: 'sectMission.weekly_breakthrough_1.desc',
    rewardHintI18nKey: 'sectMission.weekly_breakthrough_1.rewardHint',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Lookup mission def theo key. Trả undefined nếu không tồn tại. */
export function sectMissionByKey(key: string): SectMissionDef | undefined {
  return SECT_MISSIONS.find((m) => m.key === key);
}

/** Filter missions theo cadence. */
export function sectMissionsByCadence(
  cadence: SectMissionCadence,
): SectMissionDef[] {
  return SECT_MISSIONS.filter((m) => m.cadence === cadence);
}

/**
 * Compute period key (idempotency dedup) cho mission cadence.
 *
 *   - DAILY → `YYYY-MM-DD` (theo timezone, local date).
 *   - WEEKLY → `YYYY-Www` (ISO week, reuse `sectWarWeekKey`).
 *
 * Default timezone match `SECT_WAR_DEFAULT_TZ` (Asia/Ho_Chi_Minh) để mọi
 * reset (mission/dungeon/sect-war/sect-mission) cùng mốc 00:00 ICT.
 */
export function sectMissionPeriodKey(
  cadence: SectMissionCadence,
  now: Date,
  timezone: string = SECT_WAR_DEFAULT_TZ,
): string {
  if (cadence === 'WEEKLY') return sectWarWeekKey(now, timezone);
  const parts = localPartsInTz(now, timezone);
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${parts.year}-${m}-${d}`;
}
