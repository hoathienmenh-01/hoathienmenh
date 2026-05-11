/**
 * Phase 16.1.B — Economy Range Report shared catalog (pure, no IO).
 *
 * Catalog các mapping + helper mà `EconomyRangeReportService` (apps/api)
 * + Admin Economy Report panel (apps/web) cùng dùng:
 *   - `CurrencyLedger.reason` → `EconomyReportSource` bucket (tag báo cáo).
 *   - `EconomyReportSource` → high-level category (in / out / neutral).
 *   - Date range validator (UTC, max 31 days, default = last 7 days).
 *
 * Pure — KHÔNG đọc env, KHÔNG mutate Prisma. Test 100% deterministic.
 *
 * Source-of-truth report shape: `docs/ECONOMY_MODEL.md` §Range Report
 * (Phase 16.1.B).
 *
 * Phase 16.1.B chính sách: detection + reporting only. KHÔNG auto-ban,
 * KHÔNG auto-rollback, KHÔNG block transaction. Admin review thủ công
 * sau khi đọc report.
 */

/**
 * High-level bucket nhóm `CurrencyLedger.reason` thành category report
 * dễ đọc cho admin. 1 reason → 1 bucket (mapping `LEDGER_REASON_TO_SOURCE`).
 *
 * Unknown reason → `'OTHER'` (admin xem detail breakdown để debug —
 * KHÔNG silently drop để giữ invariant `Σ in = Σ ledger>0`,
 * `Σ out = Σ ledger<0`).
 */
export const ECONOMY_REPORT_SOURCES = [
  'MARKET',
  'SHOP',
  'SECT_SHOP',
  'REFORGE_ENCHANT',
  'ADMIN_GRANT',
  'TOPUP',
  'LIVEOPS_REWARD',
  'DAILY_LOGIN',
  'DUNGEON_REWARD',
  'BOSS_REWARD',
  'TERRITORY_REWARD',
  'SECT_SEASON_REWARD',
  'SECT_WAR_REWARD',
  'MISSION_REWARD',
  'QUEST_REWARD',
  'GIFTCODE_REWARD',
  'MAIL_REWARD',
  'TRIBULATION_REWARD',
  'STORY_REWARD',
  'NPC_REWARD',
  'ACHIEVEMENT_REWARD',
  'COMBAT_LOOT',
  'CULTIVATION',
  'SKILL_SPEND',
  'REFINE_SPEND',
  'ALCHEMY_SPEND',
  'GEM_SPEND',
  'INITIAL',
  'OTHER',
] as const;

export type EconomyReportSource = (typeof ECONOMY_REPORT_SOURCES)[number];

const SOURCE_SET = new Set<string>(ECONOMY_REPORT_SOURCES);

export function isEconomyReportSource(v: unknown): v is EconomyReportSource {
  return typeof v === 'string' && SOURCE_SET.has(v);
}

/**
 * Map `CurrencyLedger.reason` (DB string) → `EconomyReportSource` bucket.
 *
 * Phase 16.1.B: bucket được chọn để admin nhìn report nhanh hiểu được
 * nhóm sink/source nào nóng. Mapping additive — reason mới thêm sau
 * sẽ rơi vào `'OTHER'` cho tới khi extend bảng này.
 *
 * Lý do KHÔNG dùng prefix-match (vd `'SECT_*'`): muốn explicit để
 * không vô tình gom 1 reason mới vào sai bucket.
 */
export const LEDGER_REASON_TO_SOURCE: Readonly<
  Record<string, EconomyReportSource>
> = Object.freeze({
  MARKET_BUY: 'MARKET',
  MARKET_SELL: 'MARKET',
  SHOP_BUY: 'SHOP',
  SECT_SHOP_BUY: 'SECT_SHOP',
  SECT_CONTRIBUTE: 'SECT_SHOP',
  EQUIPMENT_REFORGE: 'REFORGE_ENCHANT',
  EQUIPMENT_REFORGE_COST: 'REFORGE_ENCHANT',
  EQUIPMENT_ENCHANT: 'REFORGE_ENCHANT',
  EQUIPMENT_ENCHANT_COST: 'REFORGE_ENCHANT',
  ADMIN_GRANT: 'ADMIN_GRANT',
  ADMIN_REVOKE: 'ADMIN_GRANT',
  ADMIN_TOPUP_APPROVE: 'TOPUP',
  LIVEOPS_FESTIVAL_GIFT_REWARD: 'LIVEOPS_REWARD',
  DAILY_LOGIN: 'DAILY_LOGIN',
  DUNGEON_LOOT: 'DUNGEON_REWARD',
  DUNGEON_RUN_REWARD: 'DUNGEON_REWARD',
  STORY_DUNGEON_REWARD: 'DUNGEON_REWARD',
  BOSS_REWARD: 'BOSS_REWARD',
  COMBAT_LOOT: 'COMBAT_LOOT',
  SECT_SEASON_REWARD: 'SECT_SEASON_REWARD',
  SECT_WAR_REWARD: 'SECT_WAR_REWARD',
  SECT_MISSION_CLAIM: 'MISSION_REWARD',
  MISSION_CLAIM: 'MISSION_REWARD',
  QUEST_CLAIM: 'QUEST_REWARD',
  GIFTCODE_REDEEM: 'GIFTCODE_REWARD',
  MAIL_CLAIM: 'MAIL_REWARD',
  TRIBULATION_REWARD: 'TRIBULATION_REWARD',
  TRIBULATION_SUPPORT_CONSUME: 'TRIBULATION_REWARD',
  STORY_DIALOGUE_REWARD: 'STORY_REWARD',
  NPC_GIFT: 'NPC_REWARD',
  NPC_SHOP_BUY: 'NPC_REWARD',
  NPC_RELATIONSHIP_CHAIN_REWARD: 'NPC_REWARD',
  ACHIEVEMENT_REWARD: 'ACHIEVEMENT_REWARD',
  SKILL_LEARN: 'SKILL_SPEND',
  SKILL_UPGRADE: 'SKILL_SPEND',
  REFINE: 'REFINE_SPEND',
  REFINE_MATERIAL: 'REFINE_SPEND',
  REFINE_PROTECTION: 'REFINE_SPEND',
  ALCHEMY_COST: 'ALCHEMY_SPEND',
  ALCHEMY_FURNACE_UPGRADE: 'ALCHEMY_SPEND',
  ALCHEMY_INPUT: 'ALCHEMY_SPEND',
  ALCHEMY_OUTPUT: 'ALCHEMY_SPEND',
  GEM_COMBINE: 'GEM_SPEND',
  GEM_SOCKET: 'GEM_SPEND',
  GEM_UNSOCKET: 'GEM_SPEND',
  SPIRITUAL_ROOT_REROLL: 'SKILL_SPEND',
  INITIAL: 'INITIAL',
});

/**
 * Phân loại reason chưa biết → 'OTHER'. Trả về `EconomyReportSource`
 * deterministic. Caller có thể log unknown reason để admin biết thêm
 * mapping (KHÔNG throw — silent fail-soft).
 */
export function reasonToReportSource(reason: string): EconomyReportSource {
  const mapped = LEDGER_REASON_TO_SOURCE[reason];
  return mapped ?? 'OTHER';
}

// ---------- Date range ----------

/**
 * Max range cho 1 query report = 31 ngày (chống query nặng trên
 * `CurrencyLedger` index `(reason, createdAt)`). Tăng cap sau khi
 * benchmark + thêm pagination nếu cần.
 */
export const ECONOMY_REPORT_MAX_RANGE_DAYS = 31;

/**
 * Default range nếu admin không truyền from/to = last 7 days (inclusive
 * today). Đủ overview tuần, không quá nặng.
 */
export const ECONOMY_REPORT_DEFAULT_RANGE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EconomyReportRange {
  /** ISO date string, e.g. '2026-05-01' (UTC). */
  readonly from: string;
  /** ISO date string, e.g. '2026-05-07' (UTC, inclusive). */
  readonly to: string;
  /** UTC Date object - start of `from` day (00:00:00). */
  readonly fromDate: Date;
  /** UTC Date object - end of `to` day (next day 00:00:00, exclusive bound). */
  readonly toDateExclusive: Date;
  /** Number of days in range (inclusive both ends). */
  readonly days: number;
}

export type EconomyReportRangeError =
  | 'INVALID_FROM'
  | 'INVALID_TO'
  | 'FROM_AFTER_TO'
  | 'RANGE_TOO_LARGE';

export interface EconomyReportRangeResult {
  readonly ok: boolean;
  readonly range?: EconomyReportRange;
  readonly error?: EconomyReportRangeError;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDateUtc(s: string): Date | null {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  // Reject overflow like 2026-02-30 (Date wraps silently).
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== mo ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
}

/**
 * Validate + normalize 1 cặp from/to (ISO date `YYYY-MM-DD`) thành
 * `EconomyReportRange`. Cả 2 đều UTC (đơn giản hoá multi-shard /
 * comparison; admin team đã quen UTC ledger trong RUNBOOK).
 *
 * Rule:
 *   - `from`/`to` không truyền → default = `[now - 6d, now]` (7d).
 *   - `from > to` → error `FROM_AFTER_TO`.
 *   - `range > ECONOMY_REPORT_MAX_RANGE_DAYS` → error `RANGE_TOO_LARGE`.
 *   - Date `YYYY-MM-DD` format invalid → error `INVALID_FROM` / `INVALID_TO`.
 */
export function parseEconomyReportRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  now: Date = new Date(),
): EconomyReportRangeResult {
  const todayUtc = startOfUtcDay(now);

  let toDate: Date;
  if (toRaw === undefined || toRaw === null || toRaw === '') {
    toDate = todayUtc;
  } else {
    const parsed = parseIsoDateUtc(toRaw);
    if (!parsed) return { ok: false, error: 'INVALID_TO' };
    toDate = parsed;
  }

  let fromDate: Date;
  if (fromRaw === undefined || fromRaw === null || fromRaw === '') {
    fromDate = new Date(
      toDate.getTime() - (ECONOMY_REPORT_DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY,
    );
  } else {
    const parsed = parseIsoDateUtc(fromRaw);
    if (!parsed) return { ok: false, error: 'INVALID_FROM' };
    fromDate = parsed;
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'FROM_AFTER_TO' };
  }

  const days =
    Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;

  if (days > ECONOMY_REPORT_MAX_RANGE_DAYS) {
    return { ok: false, error: 'RANGE_TOO_LARGE' };
  }

  const toDateExclusive = new Date(toDate.getTime() + MS_PER_DAY);

  return {
    ok: true,
    range: {
      from: toIsoDateString(fromDate),
      to: toIsoDateString(toDate),
      fromDate,
      toDateExclusive,
      days,
    },
  };
}

// ---------- Report DTO shapes ----------

/**
 * Shape trả về của `GET /admin/economy/range-report`. Server (apps/api)
 * + FE (apps/web AdminView) cùng dùng — sửa shape phải đụng cả 2.
 */
export interface EconomyReportSourceRow {
  /** Source bucket key (`EconomyReportSource`). */
  readonly source: EconomyReportSource;
  /** Σ delta > 0 (in flow) per currency, as string (BigInt serialize). */
  readonly inLinhThach: string;
  /** Σ |delta| < 0 (out flow) per currency, as string. */
  readonly outLinhThach: string;
  /** Net = in - out (signed), as string. */
  readonly netLinhThach: string;
  /** Σ delta > 0 of tienNgoc (Number — không bao giờ vượt 2^53 cho 1 báo cáo 31 ngày). */
  readonly inTienNgoc: number;
  readonly outTienNgoc: number;
  readonly netTienNgoc: number;
  /** Số dòng ledger raw matched bucket (debug aid). */
  readonly entryCount: number;
}

export interface EconomyReportTopDeltaRow {
  readonly characterId: string;
  readonly characterName: string | null;
  readonly userEmail: string | null;
  /** Net = in - out trong range, as string. */
  readonly netLinhThach: string;
  readonly inLinhThach: string;
  readonly outLinhThach: string;
}

export interface EconomyReportAnomalySummary {
  readonly openCount: number;
  readonly acknowledgedCount: number;
  readonly resolvedCount: number;
  readonly latestSeverity: 'INFO' | 'WARN' | 'CRITICAL' | null;
  readonly latestCreatedAt: string | null;
}

export interface EconomyReportLatestRun {
  readonly id: string;
  readonly dayBucket: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface EconomyReportResponse {
  readonly range: {
    readonly from: string;
    readonly to: string;
    readonly days: number;
  };
  readonly bySource: ReadonlyArray<EconomyReportSourceRow>;
  /** Tổng in (Σ delta > 0) linhThach cho range, BigInt-as-string. */
  readonly totalInLinhThach: string;
  readonly totalOutLinhThach: string;
  readonly totalNetLinhThach: string;
  readonly totalInTienNgoc: number;
  readonly totalOutTienNgoc: number;
  readonly totalNetTienNgoc: number;
  /** Top 10 character net delta (linhThach), sorted DESC theo |net|. */
  readonly topCharacterDelta: ReadonlyArray<EconomyReportTopDeltaRow>;
  /** Volume = Σ |MARKET_BUY out| (giá trị tiền chuyển qua market). */
  readonly marketVolume: string;
  readonly shopSpend: string;
  readonly sectShopSpend: string;
  readonly reforgeEnchantSpend: string;
  readonly adminGrantTotal: string;
  readonly topupTotal: string;
  readonly liveOpsRewardTotal: string;
  readonly dailyLoginRewardTotal: string;
  readonly dungeonRewardTotal: string;
  readonly bossRewardTotal: string;
  readonly territoryRewardTotal: string;
  readonly sectSeasonRewardTotal: string;
  readonly anomalySummary: EconomyReportAnomalySummary;
  readonly latestLedgerCheckRun: EconomyReportLatestRun | null;
  readonly generatedAt: string;
}
