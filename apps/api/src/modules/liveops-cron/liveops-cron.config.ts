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
 * Mặc định territory chạy 00:05 UTC mỗi thứ Hai → chốt period TUẦN TRƯỚC.
 * Tại sao 00:05 thay vì 00:00? Buffer 5 phút để avoid race với job khác
 * boundary (vd Sect War weekly recalc cũng chốt theo Mon 00:00).
 */
export const TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT = '5 0 * * 1';

/**
 * Mặc định sect season snapshot 00:15 UTC mỗi ngày → catch những season
 * vừa kết thúc (`endsAt <= now`). Snapshot idempotent qua UNIQUE
 * `seasonKey` nên chạy lại nhiều lần cùng season cũng OK.
 */
export const SECT_SEASON_SNAPSHOT_CRON_DEFAULT = '15 0 * * *';

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
 *   - `TERRITORY_CRON_TZ` — IANA timezone (vd `UTC`, `Asia/Ho_Chi_Minh`).
 *   - `SECT_SEASON_CRON_ENABLED` — `'true'|'1'|'yes'|'on'` ⇒ enabled.
 *   - `SECT_SEASON_SNAPSHOT_CRON` — cron expression.
 *   - `LIVEOPS_CRON_LEASE_TTL_SEC` — TTL Redis lease (giây).
 */
export function readLiveOpsCronConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveOpsCronConfig {
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
    timezone: readString(env, 'TERRITORY_CRON_TZ', 'UTC'),
    leaseTtlSec: readInt(env, 'LIVEOPS_CRON_LEASE_TTL_SEC', 300),
  };
}
