/**
 * Phase 15.3.A — `apps/web/src/api/liveops.ts` client tests.
 *
 * Cover:
 *   - `getActiveLiveOpsEvents` happy path → unwraps `{ ok: true, data: [...] }`.
 *   - `getActiveLiveOpsEvents` fail-soft on rejection / `{ ok: false }`.
 *   - `claimLiveOpsEventReward` happy path → unwraps + POST đúng URL.
 *   - `claimLiveOpsEventReward` throws khi response `{ ok: false, error.code }`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

import {
  claimLiveOpsEventReward,
  getActiveLiveOpsEvents,
  type LiveOpsActiveEventPublicView,
  type LiveOpsClaimResult,
} from '@/api/liveops';

const SAMPLE_EVENT: LiveOpsActiveEventPublicView = {
  key: 'event_gift_1',
  type: 'FESTIVAL_GIFT',
  title: 'Lễ hội',
  description: 'desc',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  publicConfig: { multiplier: null, reward: { linhThach: 100, tienNgoc: 0, items: [] } },
  claimable: true,
  runtimeSupported: true,
};

describe('apps/web/src/api/liveops', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getActiveLiveOpsEvents', () => {
    it('returns array on { ok: true, data: [...] }', async () => {
      getMock.mockResolvedValueOnce({ data: { ok: true, data: [SAMPLE_EVENT] } });
      const r = await getActiveLiveOpsEvents();
      expect(getMock).toHaveBeenCalledWith('/liveops/events/active');
      expect(r).toEqual([SAMPLE_EVENT]);
    });

    it('returns [] on rejection (network error / 500)', async () => {
      getMock.mockRejectedValueOnce(new Error('boom'));
      const r = await getActiveLiveOpsEvents();
      expect(r).toEqual([]);
    });

    it('returns [] on { ok: false }', async () => {
      getMock.mockResolvedValueOnce({
        data: { ok: false, error: { code: 'UNKNOWN', message: 'x' } },
      });
      const r = await getActiveLiveOpsEvents();
      expect(r).toEqual([]);
    });
  });

  describe('claimLiveOpsEventReward', () => {
    it('POST /liveops/events/:key/claim → unwraps data', async () => {
      const result: LiveOpsClaimResult = {
        eventKey: 'event_gift_1',
        claimedAt: '2026-08-01T05:00:00.000Z',
        granted: { linhThach: 100, tienNgoc: 0, items: [] },
      };
      postMock.mockResolvedValueOnce({ data: { ok: true, data: result } });
      const r = await claimLiveOpsEventReward('event_gift_1');
      expect(postMock).toHaveBeenCalledWith(
        '/liveops/events/event_gift_1/claim',
        {},
      );
      expect(r).toEqual(result);
    });

    it('throws Error with envelope error.code khi { ok: false }', async () => {
      postMock.mockResolvedValueOnce({
        data: { ok: false, error: { code: 'EVENT_ALREADY_CLAIMED', message: 'x' } },
      });
      await expect(
        claimLiveOpsEventReward('event_gift_1'),
      ).rejects.toThrowError('EVENT_ALREADY_CLAIMED');
    });

    it('encodes event key segment so dấu / không phá URL', async () => {
      const result: LiveOpsClaimResult = {
        eventKey: 'evt with space',
        claimedAt: '2026-08-01T05:00:00.000Z',
        granted: { linhThach: 1, tienNgoc: 0, items: [] },
      };
      postMock.mockResolvedValueOnce({ data: { ok: true, data: result } });
      await claimLiveOpsEventReward('evt with space');
      expect(postMock).toHaveBeenCalledWith(
        '/liveops/events/evt%20with%20space/claim',
        {},
      );
    });
  });
});
