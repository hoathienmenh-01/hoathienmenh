/**
 * Phase 16.6 — Economy Anti-cheat cron config.
 *
 * 2 cron job:
 *   - Ledger Checker (`LEDGER_CHECKER_CRON`) — daily invariant scan.
 *   - Economy Anomaly Scanner (`ECONOMY_ANOMALY_CRON`) — daily/6h windowed.
 *
 * Cả 2 default DISABLED ở local/test (mirror `liveops-cron.config.ts`
 * convention). Production override `*_ENABLED=true` để cron tự chạy
 * theo schedule. Admin force-run qua endpoint `POST /admin/economy/...`.
 */

export interface EconomyAnticheatCronConfig {
  /** Ledger Checker cron toggle. Default false. */
  readonly ledgerCheckerEnabled: boolean;
  /** Cron expression. Default `'0 1 * * *'` = 01:00 UTC mỗi ngày. */
  readonly ledgerCheckerCron: string;
  /** Anomaly Scanner cron toggle. Default false. */
  readonly anomalyScannerEnabled: boolean;
  /** Cron expression. Default `'0 2 * * *'` = 02:00 UTC mỗi ngày. */
  readonly anomalyScannerCron: string;
  /** Timezone. Default UTC. */
  readonly timezone: string;
}

/**
 * Default ledger checker chạy 01:00 UTC mỗi ngày — sau midnight reset
 * (RewardCap dayBucket xoay 00:00 default TZ). Buffer 1h để các grant
 * cuối ngày trước hoàn tất ledger flush trước khi check invariant.
 */
export const LEDGER_CHECKER_CRON_DEFAULT = '0 1 * * *';

/**
 * Default anomaly scanner chạy 02:00 UTC mỗi ngày — sau ledger checker
 * 1h. Đảm bảo ledger checker xong trước (anomaly scanner đôi khi cần
 * dữ liệu ledger sạch để giảm noise).
 */
export const ANOMALY_SCANNER_CRON_DEFAULT = '0 2 * * *';

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

export function readEconomyAnticheatCronConfig(
  env: NodeJS.ProcessEnv = process.env,
): EconomyAnticheatCronConfig {
  return {
    ledgerCheckerEnabled: readBool(env, 'LEDGER_CHECKER_CRON_ENABLED', false),
    ledgerCheckerCron: readString(
      env,
      'LEDGER_CHECKER_CRON_SCHEDULE',
      LEDGER_CHECKER_CRON_DEFAULT,
    ),
    anomalyScannerEnabled: readBool(env, 'ECONOMY_ANOMALY_CRON_ENABLED', false),
    anomalyScannerCron: readString(
      env,
      'ECONOMY_ANOMALY_CRON_SCHEDULE',
      ANOMALY_SCANNER_CRON_DEFAULT,
    ),
    timezone: readString(env, 'ECONOMY_ANTICHEAT_CRON_TZ', 'UTC'),
  };
}

/** Queue name. */
export const LEDGER_CHECKER_QUEUE = 'ledger-checker-cron';
export const LEDGER_CHECKER_JOB = 'daily-check';

export const ANOMALY_SCANNER_QUEUE = 'anomaly-scanner-cron';
export const ANOMALY_SCANNER_JOB = 'daily-scan';
