/**
 * Phase 13.2.D + 14.0.F — Live Ops cron config.
 *
 * Đọc env config cho 2 cron job (territory weekly cycle + sect season
 * snapshot). Default ENABLED=false ở local/test để không nổ Redis worker
 * khi chạy unit test / dev không cần. Production override `*_ENABLED=true`
 * trong env.
 *
 * Ngoài ENABLED + cron expression, còn có:
 *   - TZ — timezone cho BullMQ repeat. Mặc định `UTC` để khớp ISO week
 *     boundary mà territory/season helper dùng (Mon 00:00 UTC).
 *   - LEASE_TTL_SEC — TTL Redis lease (xem `liveops-cron.lease.ts`). Mặc
 *     định 300s (5 phút) — đủ để 1 cycle chạy xong (settle + decay +
 *     reward grant ~ <30s). Ngắn hơn thời lượng max của cron interval.
 */

export interface LiveOpsCronConfig {
  /** Territory cron enabled toggle. */
  readonly territoryEnabled: boolean;
  /** Cron expression (BullMQ pattern: minute hour dom month dow). */
  readonly territoryCron: string;
  /** Sect season cron enabled toggle. */
  readonly sectSeasonEnabled: boolean;
  readonly sectSeasonCron: string;
  /** Timezone cho cả 2 cron job. */
  readonly timezone: string;
  /** TTL Redis lease (giây). 0 = disable lease (test/dev). */
  readonly leaseTtlSec: number;
}

/**
 * Mặc định territory chạy 00:05 mỗi thứ Hai THEO TIMEZONE
 * {@link LIVEOPS_CRON_DEFAULT_TZ} → chốt period TUẦN TRƯỚC.
 *
 * Tại sao 00:05 thay vì 00:00? Buffer 5 phút để avoid race với job khác
 * boundary (vd Sect War weekly recalc cũng chốt theo Mon 00:00).
 *
 * Phase 15.7 — default tz đổi sang `Asia/Ho_Chi_Minh` để khớp helper
 * `previousTerritoryPeriodKey()` (TZ-aware ICT, post-#517 hotfix). Cron
 * sẽ fire Mon 00:05 ICT = Sun 17:05 UTC — chính xác 5 phút sau khi tuần
 * mới start theo ICT.
 */
export const TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT = '5 0 * * 1';

/**
 * Mặc định sect season snapshot 00:15 mỗi ngày THEO TIMEZONE
 * {@link LIVEOPS_CRON_DEFAULT_TZ} → catch những season vừa kết thúc
 * (`endsAt <= now`). Snapshot idempotent qua UNIQUE `seasonKey` nên
 * chạy lại nhiều lần cùng season cũng OK.
 *
 * Phase 15.7 — fire 00:15 ICT (= 17:15 UTC previous day) khi tz default
 * là `Asia/Ho_Chi_Minh`. Khớp với SECT_SEASONS catalog (mọi season
 * `endsAtIso` rơi vào Mon 00:00 ICT).
 */
export const SECT_SEASON_SNAPSHOT_CRON_DEFAULT = '15 0 * * *';

/**
 * Phase 15.7 — Default timezone cho cả 2 cron job (territory + sect
 * season). Đổi từ `UTC` sang `Asia/Ho_Chi_Minh` để khớp:
 *   - `territoryPeriodKeyForDate()` / `previousTerritoryPeriodKey()`
 *     (TZ-aware ICT, post-#517).
 *   - `SECT_SEASONS[*].endsAtIso` rơi vào Mon 00:00 ICT.
 *   - `MISSION_RESET_TZ` / `SECT_WAR_DEFAULT_TZ` đã là ICT.
 *
 * Override qua env `SECT_TERRITORY_CRON_TZ` (priority cao nhất) hoặc
 * `TERRITORY_CRON_TZ` (legacy alias).
 */
export const LIVEOPS_CRON_DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

function readBool(env: NodeJS.ProcessEnv, key: string, fallback = false): boolean {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  return TRUE_VALUES.has(v.toLowerCase());
}

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  return v;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Đọc {@link LiveOpsCronConfig} từ `process.env` (hoặc env injection).
 *
 * Convention naming env (mirror `MISSION_RESET_TZ`):
 *   - `TERRITORY_CRON_ENABLED` — `'true'|'1'|'yes'|'on'` ⇒ enabled.
 *   - `TERRITORY_WEEKLY_SETTLE_CRON` — cron expression.
 *   - `SECT_TERRITORY_CRON_TZ` — IANA timezone (vd `UTC`,
 *     `Asia/Ho_Chi_Minh`). Phase 15.7 unified env cho cả 2 cron.
 *   - `TERRITORY_CRON_TZ` — legacy alias (Phase 13.2.D / 14.0.F),
 *     vẫn supported nhưng `SECT_TERRITORY_CRON_TZ` priority cao hơn
 *     khi cả 2 set.
 *   - `SECT_SEASON_CRON_ENABLED` — `'true'|'1'|'yes'|'on'` ⇒ enabled.
 *   - `SECT_SEASON_SNAPSHOT_CRON` — cron expression.
 *   - `LIVEOPS_CRON_LEASE_TTL_SEC` — TTL Redis lease (giây).
 *
 * Default timezone đổi từ `UTC` (Phase 14.0.F) → `Asia/Ho_Chi_Minh`
 * (Phase 15.7) để khớp helper TZ-aware sau hotfix #517.
 */
export function readLiveOpsCronConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveOpsCronConfig {
  // Phase 15.7 — `SECT_TERRITORY_CRON_TZ` là env mới ưu tiên cao nhất.
  // Fall back về `TERRITORY_CRON_TZ` legacy nếu chưa set, cuối cùng là
  // `LIVEOPS_CRON_DEFAULT_TZ` (`Asia/Ho_Chi_Minh`).
  const tz =
    env.SECT_TERRITORY_CRON_TZ &&
    env.SECT_TERRITORY_CRON_TZ.trim() !== ''
      ? env.SECT_TERRITORY_CRON_TZ
      : readString(env, 'TERRITORY_CRON_TZ', LIVEOPS_CRON_DEFAULT_TZ);

  return {
    territoryEnabled: readBool(env, 'TERRITORY_CRON_ENABLED', false),
    territoryCron: readString(
      env,
      'TERRITORY_WEEKLY_SETTLE_CRON',
      TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT,
    ),
    sectSeasonEnabled: readBool(env, 'SECT_SEASON_CRON_ENABLED', false),
    sectSeasonCron: readString(
      env,
      'SECT_SEASON_SNAPSHOT_CRON',
      SECT_SEASON_SNAPSHOT_CRON_DEFAULT,
    ),
    timezone: tz,
    leaseTtlSec: readInt(env, 'LIVEOPS_CRON_LEASE_TTL_SEC', 300),
  };
}
