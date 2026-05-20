/**
 * Pure-unit tests cho `StoryV2ResetScheduler.onModuleInit` — ghost cleanup +
 * recurring add cho BullMQ story-v2-reset queue (`reset` job).
 *
 * Mirror `mission.scheduler.test.ts` pattern. Mocked Queue (no Redis).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { StoryV2ResetScheduler } from './story-v2-reset.scheduler';
import { STORY_V2_RESET_INTERVAL_MS } from './story-v2-reset.queue';

type RepeatableJob = { name: string; key: string };

interface FakeQueue {
  getRepeatableJobs: ReturnType<typeof vi.fn>;
  removeRepeatableByKey: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
}

function makeFakeQueue(opts?: {
  existing?: RepeatableJob[];
}): FakeQueue {
  const existing = opts?.existing ?? [];
  return {
    getRepeatableJobs: vi.fn().mockResolvedValue(existing),
    removeRepeatableByKey: vi.fn().mockResolvedValue(true),
    add: vi.fn().mockResolvedValue({ id: 'fake-job-id' }),
  };
}

function makeScheduler(queue: FakeQueue): StoryV2ResetScheduler {
  return new StoryV2ResetScheduler(queue as unknown as Queue);
}

describe('StoryV2ResetScheduler.onModuleInit', () => {
  it('queue rỗng: chỉ gọi add("reset", ...) với interval từ story-v2-reset.queue', async () => {
    const q = makeFakeQueue();
    const svc = makeScheduler(q);
    await svc.onModuleInit();
    expect(q.getRepeatableJobs).toHaveBeenCalledOnce();
    expect(q.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(q.add).toHaveBeenCalledOnce();
    const [name, payload, opts] = q.add.mock.calls[0];
    expect(name).toBe('reset');
    expect(payload).toEqual({});
    expect(opts).toMatchObject({
      repeat: { every: STORY_V2_RESET_INTERVAL_MS },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    });
  });

  it("ghost cleanup: remove repeatable 'reset' jobs trước khi add", async () => {
    const existing: RepeatableJob[] = [
      { name: 'reset', key: 'repeat:old-1' },
      { name: 'reset', key: 'repeat:old-2' },
    ];
    const q = makeFakeQueue({ existing });
    const svc = makeScheduler(q);
    await svc.onModuleInit();
    expect(q.removeRepeatableByKey).toHaveBeenCalledTimes(2);
    expect(q.removeRepeatableByKey).toHaveBeenCalledWith('repeat:old-1');
    expect(q.removeRepeatableByKey).toHaveBeenCalledWith('repeat:old-2');
    expect(q.add).toHaveBeenCalledOnce();
  });

  it("không remove repeatable job khác tên (vd 'prune')", async () => {
    const existing: RepeatableJob[] = [
      { name: 'reset', key: 'repeat:reset-1' },
      { name: 'prune', key: 'repeat:prune-1' },
    ];
    const q = makeFakeQueue({ existing });
    const svc = makeScheduler(q);
    await svc.onModuleInit();
    expect(q.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(q.removeRepeatableByKey).toHaveBeenCalledWith('repeat:reset-1');
  });
});
