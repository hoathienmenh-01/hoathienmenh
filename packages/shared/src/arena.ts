/**
 * Phase 14.1.B — Async Arena Foundation (shared types).
 *
 * Pure type / config helpers cho Arena PvP bất đồng bộ. Module này KHÔNG
 * runtime hook, KHÔNG IO, KHÔNG `Math.random`. Tất cả combat resolution
 * deterministic đi qua {@link resolveCombatWithSnapshot} (Phase 14.1.A —
 * `combat-snapshot.ts`).
 *
 * Scope (PR Phase 14.1.B):
 *   - Arena profile shape + default rating.
 *   - Opponent summary shape (FE list view).
 *   - Match status enum.
 *   - Match result + rating delta config (đơn giản: win +10 / lose -5).
 *   - Daily limit config (optional cap số trận/ngày).
 *
 * KHÔNG làm trong Phase 14.1.B:
 *   - Season ELO / decay / placement.
 *   - Reward lớn (mail end-season, item drop, currency drop).
 *   - Anti-wintrade / smurf / collusion detection.
 *   - Realtime defender notification.
 *
 * Defer Phase 14.1.C (Arena Season + ELO + Reward).
 *
 * @module arena
 */

/* ---------------------------------------------------------------------------
 * Match status
 * ------------------------------------------------------------------------- */

/**
 * Lifecycle của 1 Arena match.
 *
 *   - `PENDING`: server đã accept request và tạo row, đang resolve. Trong
 *     Phase 14.1.B, resolve được thực hiện synchronous trong cùng request
 *     handler — `PENDING` chỉ tồn tại trong window giữa `prisma.create` và
 *     `prisma.update(result)` (≤ 1 transaction). Future async worker có
 *     thể dùng `PENDING` row để track in-flight match.
 *   - `RESOLVED`: match đã có result (winner/draw + battle log).
 *   - `CANCELLED`: match bị huỷ trước khi resolve (vd race condition,
 *     defender chuyển character, anti-wintrade hint). Phase 14.1.B chưa
 *     emit status này — reserved cho 14.1.C.
 */
export type ArenaMatchStatus = 'PENDING' | 'RESOLVED' | 'CANCELLED';

export const ARENA_MATCH_STATUSES: readonly ArenaMatchStatus[] = [
  'PENDING',
  'RESOLVED',
  'CANCELLED',
];

export function isArenaMatchStatus(value: unknown): value is ArenaMatchStatus {
  return (
    typeof value === 'string' &&
    (ARENA_MATCH_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Winner enum cho match result. Đồng bộ với
 * {@link import('./combat-snapshot').CombatWinner} nhưng wrapped để
 * rõ ràng từ Arena context (không leak combat-snapshot type ra ngoài
 * boundary FE — FE consume `ArenaMatchResult`).
 */
export type ArenaMatchOutcome = 'ATTACKER_WIN' | 'DEFENDER_WIN' | 'DRAW';

export const ARENA_MATCH_OUTCOMES: readonly ArenaMatchOutcome[] = [
  'ATTACKER_WIN',
  'DEFENDER_WIN',
  'DRAW',
];

/* ---------------------------------------------------------------------------
 * Rating config (đơn giản — defer ELO Glicko sang Phase 14.1.C)
 * ------------------------------------------------------------------------- */

/**
 * Rating mặc định khi profile được lazy-create. Phase 14.1.B chưa làm
 * placement match — mọi profile mới start ở 1000.
 */
export const ARENA_RATING_DEFAULT = 1000;

/**
 * Sàn rating (không cho âm). Trừ điểm khi thua nhưng floor = 0.
 */
export const ARENA_RATING_FLOOR = 0;

/**
 * Trần rating Phase 14.1.B (sanity cap — defer hard cap thật cho 14.1.C
 * khi có ELO scaled). Đặt cap để verify migration không drift.
 */
export const ARENA_RATING_CEILING = 5000;

/**
 * Rating delta khi attacker WIN (cộng cho attacker). Phase 14.1.B đơn giản
 * +10. Phase 14.1.C sẽ thay bằng Glicko-2 formula scaled theo skill gap.
 */
export const ARENA_RATING_WIN_DELTA = 10;

/**
 * Rating delta khi attacker LOSE (trừ attacker). Phase 14.1.B đơn giản -5.
 * Phase 14.1.C sẽ scale theo skill gap.
 */
export const ARENA_RATING_LOSE_DELTA = -5;

/**
 * Rating delta khi DRAW (cả 2 không đổi). Phase 14.1.B emit explicit để
 * test-stable + audit.
 */
export const ARENA_RATING_DRAW_DELTA = 0;

/**
 * Rating delta cho defender. Defender không tự attack nên Phase 14.1.B
 * chỉ apply nửa magnitude — defender vẫn cảm nhận impact PvP nhưng không
 * bị grind nặng khi đang offline. Phase 14.1.C sẽ scale theo full ELO.
 */
export const ARENA_RATING_DEFENDER_WIN_DELTA = 5; // attacker thua → defender +5
export const ARENA_RATING_DEFENDER_LOSE_DELTA = -3; // attacker thắng → defender -3
export const ARENA_RATING_DEFENDER_DRAW_DELTA = 0;

export interface ArenaRatingDelta {
  /** Delta áp lên attacker.rating sau resolve. */
  attacker: number;
  /** Delta áp lên defender.rating sau resolve. */
  defender: number;
}

/**
 * Pure helper: tính rating delta theo outcome. Không state, không IO.
 */
export function arenaRatingDeltaFor(outcome: ArenaMatchOutcome): ArenaRatingDelta {
  if (outcome === 'ATTACKER_WIN') {
    return {
      attacker: ARENA_RATING_WIN_DELTA,
      defender: ARENA_RATING_DEFENDER_LOSE_DELTA,
    };
  }
  if (outcome === 'DEFENDER_WIN') {
    return {
      attacker: ARENA_RATING_LOSE_DELTA,
      defender: ARENA_RATING_DEFENDER_WIN_DELTA,
    };
  }
  return {
    attacker: ARENA_RATING_DRAW_DELTA,
    defender: ARENA_RATING_DEFENDER_DRAW_DELTA,
  };
}

/**
 * Clamp rating về `[ARENA_RATING_FLOOR, ARENA_RATING_CEILING]`. Pure
 * helper dùng trong service khi update profile.
 */
export function clampArenaRating(value: number): number {
  if (!Number.isFinite(value)) return ARENA_RATING_DEFAULT;
  if (value < ARENA_RATING_FLOOR) return ARENA_RATING_FLOOR;
  if (value > ARENA_RATING_CEILING) return ARENA_RATING_CEILING;
  return Math.round(value);
}

/* ---------------------------------------------------------------------------
 * Daily limit config
 * ------------------------------------------------------------------------- */

/**
 * Config cho giới hạn số trận attack mỗi ngày. Phase 14.1.B đơn giản:
 * dùng 1 cap chung (không phân tier / VIP / sect bonus).
 *
 *   - `maxAttacksPerDay`: số trận tối đa attacker có thể gửi mỗi ngày
 *     (theo `dayBucket` server tz — xem {@link arenaDayBucket}). 0 = vô
 *     hạn (skip enforcement).
 *   - `tz`: IANA timezone dùng để tính day bucket. Default Asia/Ho_Chi_Minh.
 *
 * Có thể override qua env (apps/api) — Phase 14.1.B mặc định 10/ngày.
 */
export interface ArenaDailyLimitConfig {
  maxAttacksPerDay: number;
  tz: string;
}

export const ARENA_DAILY_LIMIT_DEFAULT: ArenaDailyLimitConfig = {
  maxAttacksPerDay: 10,
  tz: 'Asia/Ho_Chi_Minh',
};

/**
 * Trả về day-bucket key (YYYY-MM-DD) cho 1 thời điểm dưới timezone cho
 * trước. Dùng để compare với `lastAttackDayBucket` trên `ArenaProfile` —
 * khi sang ngày mới, server reset `attacksToday = 0`.
 *
 * Pure: cùng `(at, tz)` → cùng output. Cùng cơ chế với
 * `mission.service.dayBucketFor` (Phase 12.2.A) nhưng standalone để tránh
 * cyclic import — Arena không phụ thuộc Mission.
 */
export function arenaDayBucket(at: Date, tz = ARENA_DAILY_LIMIT_DEFAULT.tz): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA returns YYYY-MM-DD natively.
  return fmt.format(at);
}

/* ---------------------------------------------------------------------------
 * Profile + opponent summary (FE-friendly view shapes)
 * ------------------------------------------------------------------------- */

/**
 * Tier name placeholder Phase 14.1.B. Server hiện tại không phân tier —
 * trả về `'unranked'` cho mọi profile. Phase 14.1.C sẽ map rating → tier
 * (BRONZE/SILVER/GOLD/...). FE consume tier-aware nhưng phải tolerate
 * `'unranked'`.
 */
export type ArenaRankTier = 'unranked' | 'bronze' | 'silver' | 'gold' | 'master';

export const ARENA_RANK_TIERS: readonly ArenaRankTier[] = [
  'unranked',
  'bronze',
  'silver',
  'gold',
  'master',
];

/**
 * Phase 14.1.B placeholder mapping — toàn rating bucket = `'unranked'`.
 * Phase 14.1.C sẽ implement breakpoints + balance.
 */
export function arenaRankTierFor(_rating: number): ArenaRankTier {
  return 'unranked';
}

/**
 * Profile view dùng cho FE (`GET /arena/profile`). BigInt-free, Date cast
 * → ISO string. Server-side row type (`ArenaProfile`) có thêm internal
 * field (`defenseSnapshotJson`) không leak ra view.
 */
export interface ArenaProfileSummary {
  characterId: string;
  characterName: string;
  rating: number;
  tier: ArenaRankTier;
  wins: number;
  losses: number;
  draws: number;
  attacksToday: number;
  attacksRemaining: number;
  /** Day bucket hiện tại (server tz). FE hiển thị "đã đánh hôm nay". */
  todayBucket: string;
  /** ISO string — tạo profile lần đầu. */
  createdAt: string;
  /** ISO string — last update. */
  updatedAt: string;
}

/**
 * Opponent view ngắn gọn (`GET /arena/opponents`). KHÔNG leak snapshot
 * raw — defender snapshot được build server-side mỗi khi attack được
 * gửi (avoid stale defense snapshot drift).
 */
export interface ArenaOpponentSummary {
  characterId: string;
  characterName: string;
  realmKey: string;
  realmStage: number;
  rating: number;
  tier: ArenaRankTier;
  wins: number;
  losses: number;
  /** Sect display name (nullable nếu defender chưa join sect). */
  sectName: string | null;
}

/* ---------------------------------------------------------------------------
 * Match result (FE view)
 * ------------------------------------------------------------------------- */

/**
 * Battle log line đơn giản hoá cho FE — mirror subset của
 * {@link import('./combat-snapshot').CombatRoundLog} nhưng cast field
 * cần thiết cho UI replay basic. Server có thể trả full log qua
 * `battleLogJson` riêng nếu FE cần debug detail (Phase 14.1.B chưa wire
 * detail UI — chỉ summary).
 */
export interface ArenaBattleLogLine {
  round: number;
  attackerSide: 'attacker' | 'defender';
  attackerName: string;
  defenderName: string;
  finalDamage: number;
  attackerHp: number;
  defenderHp: number;
}

/**
 * Match result trả về sau `POST /arena/matches` resolve (đồng thời lưu
 * trong `ArenaMatch.result`). Pure data — server cũng dùng shape này khi
 * trả `GET /arena/matches/history`.
 */
export interface ArenaMatchResult {
  matchId: string;
  status: ArenaMatchStatus;
  outcome: ArenaMatchOutcome;
  attackerCharacterId: string;
  attackerName: string;
  defenderCharacterId: string;
  defenderName: string;
  /** Numeric seed dùng resolve — phục vụ replay verify ngoài client. */
  seed: number;
  /** Rating delta áp dụng cho 2 side. */
  ratingDelta: ArenaRatingDelta;
  /** Attacker rating sau khi apply delta (clamped). */
  attackerRatingAfter: number;
  /** Defender rating sau khi apply delta (clamped). */
  defenderRatingAfter: number;
  /** Tổng damage attacker đã gây. */
  totalAttackerDamage: number;
  /** Tổng damage defender đã phản kích. */
  totalDefenderDamage: number;
  /** Số round combat đã chạy. */
  rounds: number;
  /** Battle log condensed cho FE. */
  battleLog: readonly ArenaBattleLogLine[];
  /** ISO string — created. */
  createdAt: string;
  /** ISO string — resolved. `null` nếu status='PENDING' (chưa resolve). */
  resolvedAt: string | null;
}

/* ---------------------------------------------------------------------------
 * Error codes (re-exported cho FE consume)
 * ------------------------------------------------------------------------- */

export type ArenaErrorCode =
  | 'NO_CHARACTER'
  | 'DEFENDER_NOT_FOUND'
  | 'CANNOT_ATTACK_SELF'
  | 'INVALID_INPUT'
  | 'DAILY_LIMIT_REACHED'
  | 'UNAUTHENTICATED';

export const ARENA_ERROR_CODES: readonly ArenaErrorCode[] = [
  'NO_CHARACTER',
  'DEFENDER_NOT_FOUND',
  'CANNOT_ATTACK_SELF',
  'INVALID_INPUT',
  'DAILY_LIMIT_REACHED',
  'UNAUTHENTICATED',
];

export function isArenaErrorCode(value: unknown): value is ArenaErrorCode {
  return (
    typeof value === 'string' &&
    (ARENA_ERROR_CODES as readonly string[]).includes(value)
  );
}
