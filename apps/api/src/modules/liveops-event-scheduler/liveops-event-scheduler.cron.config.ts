/**
 * Phase 15.1–15.2 — Config cho cron tick recompute LiveOps Event Scheduler.
 *
 * Default ENABLED=false ở local/test (mirror `liveops-cron.config`). Khi
 * production, set `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true` để cron
 * chạy 5 phút/lần. Admin vẫn có thể force-run qua endpoint
 * `/admin/liveops/events/recompute-status` bất kể flag.
 *
 * Env keys:
 *   - `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED` — `'true'|'1'|'yes'|'on'` ⇒ enable.
 *   - `LIVEOPS_EVENT_SCHEDULER_CRON` — cron expression. Default `*\/5 * * * *`.
 *   - `LIVEOPS_EVENT_SCHEDULER_CRON_TZ` — IANA timezone. Default `UTC`.
 *   - `LIVEOPS_EVENT_SCHEDULER_LEASE_TTL_SEC` — TTL Redis lease. Default 60s.
 */

import { LIVEOPS_EVENT_RECOMPUTE_CRON_DEFAULT } from './liveops-event-scheduler.queue';

export interface LiveOpsEventSchedulerCronConfig {
  readonly enabled: boolean;
  readonly cron: string;
  readonly timezone: string;
  readonly leaseTtlSec: number;
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

function readBool(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback = false,
): boolean {
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

export function readLiveOpsEventSchedulerCronConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveOpsEventSchedulerCronConfig {
  return {
    enabled: readBool(env, 'LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED', false),
    cron: readString(
      env,
      'LIVEOPS_EVENT_SCHEDULER_CRON',
      LIVEOPS_EVENT_RECOMPUTE_CRON_DEFAULT,
    ),
    timezone: readString(env, 'LIVEOPS_EVENT_SCHEDULER_CRON_TZ', 'UTC'),
    leaseTtlSec: readInt(env, 'LIVEOPS_EVENT_SCHEDULER_LEASE_TTL_SEC', 60),
  };
}
