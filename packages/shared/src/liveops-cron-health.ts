/**
 * Phase 15.8 — Live Ops cron health status helper.
 *
 * Pure-fn để FE/BE share cùng định nghĩa "cron có khoẻ không". Caller
 * cung cấp:
 *   - `enabled` — cron có bật ENV không.
 *   - `lastRunAt` — thời điểm gần nhất cron job được trigger (success
 *     hay fail đều tính). `null` nếu chưa chạy lần nào.
 *   - `lastSuccessAt` — gần nhất cron commit DB thành công. `null`
 *     nếu chưa có lần thành công.
 *   - `lastErrorAt` — gần nhất cron throw / catch error. `null` nếu
 *     chưa fail.
 *   - `maxSilenceMs` — ngưỡng (ms) để coi "quá lâu chưa run thật" →
 *     `STALE`. Caller chọn theo chu kỳ cron (vd weekly = 8 ngày,
 *     daily = 2 ngày).
 *   - `now` — current time (Date) — inject để unit test deterministic.
 *
 * Status quy tắc (ưu tiên trên xuống):
 *   - `DISABLED` — `enabled === false`. Không emit warning.
 *   - `DEGRADED` — `lastErrorAt > lastSuccessAt` (hoặc chưa có
 *     success). Cron đã chạy nhưng fail.
 *   - `STALE` — đã quá `maxSilenceMs` mà chưa có success mới. Có thể
 *     do worker chết, queue tắc, lease stuck.
 *   - `OK` — mọi thứ healthy.
 *
 * Status `UNKNOWN` chỉ dùng khi caller chưa biết enabled — KHÔNG
 * pass qua helper này (caller fail-soft tự chọn).
 */

export type LiveOpsCronHealthStatus =
  | 'OK'
  | 'STALE'
  | 'DISABLED'
  | 'DEGRADED';

export interface LiveOpsCronHealthInput {
  readonly enabled: boolean;
  readonly lastRunAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorAt: Date | null;
  readonly maxSilenceMs: number;
  readonly now: Date;
}

export interface LiveOpsCronHealth {
  readonly status: LiveOpsCronHealthStatus;
  /**
   * Hint cho admin / log nếu `status !== OK`. Format ngắn gọn —
   * UI render trực tiếp hoặc dịch qua i18n key.
   */
  readonly staleReason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recommended silence threshold cho territory weekly cron (settle Mon
 * 00:05 ICT). Cho 8 ngày trước khi báo STALE — 1 tuần + buffer.
 */
export const TERRITORY_CRON_MAX_SILENCE_MS = 8 * DAY_MS;

/**
 * Recommended silence threshold cho sect season cron (run daily nhưng
 * chỉ commit khi có season mới end). Cho 2 ngày — daily run nên
 * cron status check thấy gì cũng phải <48h.
 */
export const SECT_SEASON_CRON_MAX_SILENCE_MS = 2 * DAY_MS;

export function computeLiveOpsCronHealth(
  input: LiveOpsCronHealthInput,
): LiveOpsCronHealth {
  if (!input.enabled) {
    return {
      status: 'DISABLED',
      staleReason: 'cron disabled via env',
    };
  }

  // DEGRADED — last error sau last success (hoặc chưa có success nào
  // nhưng đã từng fail). Đây là tín hiệu cron đang chạy nhưng commit
  // fail; admin cần xem log.
  if (input.lastErrorAt) {
    if (!input.lastSuccessAt) {
      return {
        status: 'DEGRADED',
        staleReason: `cron has only errored (last error at ${input.lastErrorAt.toISOString()})`,
      };
    }
    if (input.lastErrorAt.getTime() > input.lastSuccessAt.getTime()) {
      return {
        status: 'DEGRADED',
        staleReason: `last error (${input.lastErrorAt.toISOString()}) newer than last success (${input.lastSuccessAt.toISOString()})`,
      };
    }
  }

  // STALE — chưa từng commit thành công hoặc đã quá ngưỡng.
  if (!input.lastSuccessAt) {
    // Cron đã enable nhưng chưa từng success → STALE (boot fresh).
    return {
      status: 'STALE',
      staleReason: 'cron enabled but never recorded a successful run',
    };
  }
  const silentMs = input.now.getTime() - input.lastSuccessAt.getTime();
  if (silentMs > input.maxSilenceMs) {
    const silentDays = Math.floor(silentMs / DAY_MS);
    return {
      status: 'STALE',
      staleReason: `no successful run for ${silentDays} days (since ${input.lastSuccessAt.toISOString()})`,
    };
  }

  return { status: 'OK', staleReason: null };
}
