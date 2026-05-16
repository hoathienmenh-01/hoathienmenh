/**
 * Phase 17.2 — BackupScheduler unit tests.
 *
 * Cover:
 *   - cả 2 cron disabled (default) → KHÔNG register repeat job.
 *   - backup enabled → register `backup-run` với pattern + tz.
 *   - verify enabled → register `backup-verify` với pattern + tz.
 *   - register lại idempotent: xoá repeat cũ trùng tên trước khi add.
 *   - duplicate / race protection: gọi scheduleRecurring 2 lần → vẫn 1 repeat job.
 */
import { describe, expect, it } from 'vitest';
import type { Queue, RepeatableJob } from 'bullmq';
import { BackupScheduler } from './backup.scheduler';
import {
  BACKUP_RUN_JOB,
  BACKUP_VERIFY_JOB,
} from './backup.queue';
import type { BackupConfig } from './backup.config';

interface MockQueue {
  added: Array<{ name: string; opts: any }>;
  removedKeys: string[];
  repeatables: RepeatableJob[];
}

function makeQueue(initial: RepeatableJob[] = []): {
  q: Queue;
  state: MockQueue;
} {
  const state: MockQueue = {
    added: [],
    removedKeys: [],
    repeatables: [...initial],
  };
  const q = {
    add: async (name: string, _data: unknown, opts: unknown) => {
      state.added.push({ name, opts });
      state.repeatables.push({
        name,
        key: `key-${name}-${state.repeatables.length}`,
        id: null,
        endDate: null,
        tz: null,
        pattern: null,
        next: 0,
      } as unknown as RepeatableJob);
    },
    getRepeatableJobs: async () => state.repeatables,
    removeRepeatableByKey: async (key: string) => {
      state.removedKeys.push(key);
      state.repeatables = state.repeatables.filter((j) => j.key !== key);
    },
  } as unknown as Queue;
  return { q, state };
}

const DISABLED_CFG: BackupConfig = {
  backupEnabled: false,
  backupSchedule: '0 3 * * 0',
  verifyEnabled: false,
  verifySchedule: '0 4 * * 0',
  timezone: 'Asia/Ho_Chi_Minh',
  backupDir: './backups',
  retentionDays: 0,
  offsiteUploadEnabled: false,
  alertConsecutiveFailures: 0,
};

describe('Phase 17.2 — BackupScheduler.scheduleRecurring', () => {
  it('cả 2 cron disabled → KHÔNG register repeat job', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    await scheduler.scheduleRecurring(DISABLED_CFG);
    expect(state.added).toHaveLength(0);
  });

  it('backup enabled + verify disabled → register chỉ backup-run', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    await scheduler.scheduleRecurring({
      ...DISABLED_CFG,
      backupEnabled: true,
    });
    expect(state.added).toHaveLength(1);
    expect(state.added[0].name).toBe(BACKUP_RUN_JOB);
    expect(state.added[0].opts.repeat).toEqual({
      pattern: '0 3 * * 0',
      tz: 'Asia/Ho_Chi_Minh',
    });
  });

  it('verify enabled + backup disabled → register chỉ backup-verify', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    await scheduler.scheduleRecurring({
      ...DISABLED_CFG,
      verifyEnabled: true,
    });
    expect(state.added).toHaveLength(1);
    expect(state.added[0].name).toBe(BACKUP_VERIFY_JOB);
  });

  it('cả 2 enabled → register cả 2', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    await scheduler.scheduleRecurring({
      ...DISABLED_CFG,
      backupEnabled: true,
      verifyEnabled: true,
    });
    const names = state.added.map((a) => a.name).sort();
    expect(names).toEqual([BACKUP_RUN_JOB, BACKUP_VERIFY_JOB].sort());
  });

  it('gọi scheduleRecurring 2 lần → xoá repeat cũ trước khi add lại (idempotent)', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    const enabledCfg: BackupConfig = {
      ...DISABLED_CFG,
      backupEnabled: true,
      verifyEnabled: true,
    };
    await scheduler.scheduleRecurring(enabledCfg);
    await scheduler.scheduleRecurring(enabledCfg);
    // 2 lần add cho mỗi job (mỗi schedule call) nhưng đã remove cũ trước.
    expect(state.added.length).toBe(4);
    expect(state.removedKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('disable một cron sau khi đã enable → xoá repeat job đó', async () => {
    const { q, state } = makeQueue();
    const scheduler = new BackupScheduler(q);
    await scheduler.scheduleRecurring({
      ...DISABLED_CFG,
      backupEnabled: true,
      verifyEnabled: true,
    });
    state.removedKeys = []; // reset
    state.added = [];
    await scheduler.scheduleRecurring({
      ...DISABLED_CFG,
      backupEnabled: false,
      verifyEnabled: true,
    });
    expect(state.added.map((a) => a.name)).toEqual([BACKUP_VERIFY_JOB]);
    // backup-run repeat cũ phải bị removed
    expect(state.removedKeys.length).toBeGreaterThan(0);
  });
});
