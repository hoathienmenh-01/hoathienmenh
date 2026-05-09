/**
 * Phase 13.2.D + 14.0.F — `LiveOpsCronScheduler` unit tests.
 *
 * Test pure-unit (mock Queue stubs). Cover:
 *   - enabled=true → register repeat với pattern + tz.
 *   - enabled=false → KHÔNG register repeat (xoá cũ nếu có).
 *   - register lại idempotent: xoá cũ trước khi add lại.
 */
import { describe, expect, it } from 'vitest';
import type { Queue, RepeatableJob } from 'bullmq';
import { LiveOpsCronScheduler } from './liveops-cron.scheduler';
import {
  SECT_SEASON_SNAPSHOT_JOB,
  TERRITORY_WEEKLY_CYCLE_JOB,
} from './liveops-cron.queue';

interface MockQueue {
  added: Array<{ name: string; opts: unknown }>;
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
    },
    getRepeatableJobs: async () => state.repeatables,
    removeRepeatableByKey: async (key: string) => {
      state.removedKeys.push(key);
      state.repeatables = state.repeatables.filter((j) => j.key !== key);
    },
  } as unknown as Queue;
  return { q, state };
}

describe('LiveOpsCronScheduler.scheduleRecurring', () => {
  it('territory enabled → register repeat job với pattern + tz', async () => {
    const t = makeQueue();
    const s = makeQueue();
    const sched = new LiveOpsCronScheduler(t.q, s.q);
    await sched.scheduleRecurring({
      territoryEnabled: true,
      territoryCron: '5 0 * * 1',
      sectSeasonEnabled: false,
      sectSeasonCron: '15 0 * * *',
      timezone: 'UTC',
      leaseTtlSec: 300,
    });
    expect(t.state.added).toHaveLength(1);
    expect(t.state.added[0].name).toBe(TERRITORY_WEEKLY_CYCLE_JOB);
    expect(t.state.added[0].opts).toMatchObject({
      repeat: { pattern: '5 0 * * 1', tz: 'UTC' },
    });
    // sect-season disabled → KHÔNG add.
    expect(s.state.added).toHaveLength(0);
  });

  it('disabled → KHÔNG register repeat (xoá cũ nếu có)', async () => {
    const t = makeQueue([
      { name: TERRITORY_WEEKLY_CYCLE_JOB, key: 'tk1' } as RepeatableJob,
    ]);
    const s = makeQueue();
    const sched = new LiveOpsCronScheduler(t.q, s.q);
    await sched.scheduleRecurring({
      territoryEnabled: false,
      territoryCron: '5 0 * * 1',
      sectSeasonEnabled: false,
      sectSeasonCron: '15 0 * * *',
      timezone: 'UTC',
      leaseTtlSec: 300,
    });
    expect(t.state.added).toHaveLength(0);
    // Xoá repeat cũ
    expect(t.state.removedKeys).toContain('tk1');
  });

  it('register lại idempotent: xoá cũ trước khi add lại', async () => {
    const t = makeQueue([
      { name: TERRITORY_WEEKLY_CYCLE_JOB, key: 'tk1' } as RepeatableJob,
    ]);
    const s = makeQueue([
      { name: SECT_SEASON_SNAPSHOT_JOB, key: 'sk1' } as RepeatableJob,
    ]);
    const sched = new LiveOpsCronScheduler(t.q, s.q);
    await sched.scheduleRecurring({
      territoryEnabled: true,
      territoryCron: '5 0 * * 1',
      sectSeasonEnabled: true,
      sectSeasonCron: '15 0 * * *',
      timezone: 'UTC',
      leaseTtlSec: 300,
    });
    // Xoá cũ
    expect(t.state.removedKeys).toContain('tk1');
    expect(s.state.removedKeys).toContain('sk1');
    // Thêm mới
    expect(t.state.added).toHaveLength(1);
    expect(s.state.added).toHaveLength(1);
  });
});
