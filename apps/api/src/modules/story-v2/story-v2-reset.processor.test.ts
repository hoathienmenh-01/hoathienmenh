/**
 * Pure-unit tests cho `StoryV2ResetProcessor.process` — verify reset job
 * delegation to `Phase33StoryService.resetExpiredQuests()`.
 *
 * Mocked service (no Redis/DB). Mirror `mission.processor.test.ts` pattern.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { StoryV2ResetProcessor } from './story-v2-reset.processor';
import type { Phase33StoryService } from './story-v2.service';

function makeFakeStoryV2(opts?: {
  resetCount?: number;
  resetError?: Error;
}): {
  resetExpiredQuests: ReturnType<typeof vi.fn>;
} {
  return {
    resetExpiredQuests: opts?.resetError
      ? vi.fn().mockRejectedValue(opts.resetError)
      : vi.fn().mockResolvedValue(opts?.resetCount ?? 0),
  };
}

function makeJob(name: string): Job {
  return { name } as unknown as Job;
}

describe('StoryV2ResetProcessor.process', () => {
  it('job name "reset" → gọi resetExpiredQuests()', async () => {
    const svc = makeFakeStoryV2({ resetCount: 5 });
    const processor = new StoryV2ResetProcessor(
      svc as unknown as Phase33StoryService,
    );
    await processor.process(makeJob('reset'));
    expect(svc.resetExpiredQuests).toHaveBeenCalledOnce();
  });

  it('job name khác "reset" → KHÔNG gọi resetExpiredQuests()', async () => {
    const svc = makeFakeStoryV2();
    const processor = new StoryV2ResetProcessor(
      svc as unknown as Phase33StoryService,
    );
    await processor.process(makeJob('prune'));
    expect(svc.resetExpiredQuests).not.toHaveBeenCalled();
  });

  it('resetExpiredQuests throw → propagate error (BullMQ retry)', async () => {
    const err = new Error('DB connection lost');
    const svc = makeFakeStoryV2({ resetError: err });
    const processor = new StoryV2ResetProcessor(
      svc as unknown as Phase33StoryService,
    );
    await expect(processor.process(makeJob('reset'))).rejects.toThrow(
      'DB connection lost',
    );
  });

  it('resetExpiredQuests trả 0 → không throw (no-op)', async () => {
    const svc = makeFakeStoryV2({ resetCount: 0 });
    const processor = new StoryV2ResetProcessor(
      svc as unknown as Phase33StoryService,
    );
    await processor.process(makeJob('reset'));
    expect(svc.resetExpiredQuests).toHaveBeenCalledOnce();
  });
});
