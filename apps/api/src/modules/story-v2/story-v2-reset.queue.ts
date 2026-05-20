/**
 * Phase 33.4 — Queue + scheduler constants cho Story V2 daily/weekly reset.
 *
 * Follow `mission.queue.ts` pattern: BullMQ recurring job, Redis-backed.
 *
 * - Quét mỗi 10 phút, reset CLAIMED daily/weekly quests có `windowEnd <= now`
 *   về AVAILABLE (cho phép player re-accept + re-claim).
 * - Interval 10 phút (giống mission reset) — đủ nhỏ để player không phải đợi
 *   cửa sổ mới quá lâu, đủ lớn để không spam Redis.
 */
export const STORY_V2_RESET_QUEUE = 'story-v2-reset';

/** 10 phút — same resolution as mission reset. */
export const STORY_V2_RESET_INTERVAL_MS = 10 * 60 * 1000;
