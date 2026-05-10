/**
 * Phase 15.3.A — controller-level tests cho LiveOpsEventsPublicController.
 *
 * Pure unit tests stubbing AuthService + LiveOpsEventSchedulerService +
 * PrismaService. Verify HTTP error mapping (404/409/422) + happy paths.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import {
  LiveOpsEventSchedulerError,
  type LiveOpsActiveEventPublicView,
  type LiveOpsClaimResult,
  type LiveOpsEventSchedulerService,
} from './liveops-event-scheduler.service';
import { LiveOpsEventsPublicController } from './liveops-events-public.controller';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

interface Stubs {
  authedUserId?: string | null;
  characterId?: string | null;
  active?: LiveOpsActiveEventPublicView[];
  claimImpl?: (
    characterId: string,
    eventKey: string,
  ) => Promise<LiveOpsClaimResult>;
  /** Phase 15.4 — gi\u1ea3 l\u1eadp LIVEOPS_*_ENABLED=false. */
  flagDisabled?: boolean;
}

function makeController(opts: Stubs = {}): LiveOpsEventsPublicController {
  const auth = {
    userIdFromAccess: async (token: string | undefined) =>
      token
        ? opts.authedUserId === undefined
          ? 'u1'
          : opts.authedUserId
        : null,
  } as unknown as AuthService;

  const prisma = {
    character: {
      findUnique: async () =>
        opts.characterId === undefined
          ? { id: 'char-1' }
          : opts.characterId === null
            ? null
            : { id: opts.characterId },
    },
  } as unknown as PrismaService;

  const events = {
    getActiveEventsPublic: async () => opts.active ?? [],
    claimEventReward:
      opts.claimImpl ??
      (async () => ({
        eventKey: 'fest-1',
        claimedAt: '2026-04-30T00:00:00Z',
        granted: { linhThach: 100, tienNgoc: 0, items: [] },
      })),
  } as unknown as LiveOpsEventSchedulerService;

  // Phase 15.4 — stub feature flags: mặc định on cho tests cũ.
  const featureFlags = {
    isEnabled: async () => !opts.flagDisabled,
    requireEnabled: async () => {
      if (opts.flagDisabled) {
        const { HttpException, HttpStatus } = await import('@nestjs/common');
        throw new HttpException(
          { ok: false, error: { code: 'FEATURE_DISABLED', message: 'disabled' } },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    },
  } as unknown as import('../feature-flag/feature-flag.service').FeatureFlagService;
  return new LiveOpsEventsPublicController(events, auth, prisma, featureFlags);
}

describe('LiveOpsEventsPublicController.listActive', () => {
  it('anonymous → returns active list with claimable=false', async () => {
    const stubList: LiveOpsActiveEventPublicView[] = [
      {
        key: 'fest-1',
        type: 'FESTIVAL_GIFT',
        title: 'Test',
        description: '',
        startsAt: '2026-04-29T00:00:00Z',
        endsAt: '2026-05-01T00:00:00Z',
        publicConfig: { multiplier: null, reward: null },
        claimable: false,
        runtimeSupported: true,
      },
    ];
    const c = makeController({ authedUserId: null, active: stubList });
    const r = await c.listActive(makeReq(undefined));
    expect(r).toEqual({ ok: true, data: stubList });
  });

  it('authed → calls service with characterId', async () => {
    const c = makeController({ active: [] });
    const r = await c.listActive(makeReq('valid'));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });
});

describe('LiveOpsEventsPublicController.claim', () => {
  it('401 UNAUTHENTICATED khi không cookie', async () => {
    const c = makeController();
    await expect(c.claim(makeReq(undefined), 'fest-1')).rejects.toThrow(
      HttpException,
    );
  });

  it('404 NO_CHARACTER khi char chưa tạo', async () => {
    const c = makeController({ characterId: null });
    try {
      await c.claim(makeReq('valid'), 'fest-1');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((e as HttpException).getResponse()).toMatchObject({
        ok: false,
        error: { code: 'NO_CHARACTER' },
      });
    }
  });

  it('happy path → 200 ok với granted reward', async () => {
    const c = makeController();
    const r = await c.claim(makeReq('valid'), 'fest-1');
    expect(r.ok).toBe(true);
    expect(r.data.eventKey).toBe('fest-1');
    expect(r.data.granted.linhThach).toBe(100);
  });

  it('EVENT_NOT_FOUND → 404', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new LiveOpsEventSchedulerError('EVENT_NOT_FOUND');
      },
    });
    try {
      await c.claim(makeReq('valid'), 'fest-1');
      expect.fail('expected throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((e as HttpException).getResponse()).toMatchObject({
        error: { code: 'EVENT_NOT_FOUND' },
      });
    }
  });

  it('EVENT_NOT_ACTIVE / EVENT_NOT_CLAIMABLE / EVENT_ALREADY_CLAIMED → 409', async () => {
    for (const code of [
      'EVENT_NOT_ACTIVE' as const,
      'EVENT_NOT_CLAIMABLE' as const,
      'EVENT_ALREADY_CLAIMED' as const,
    ]) {
      const c = makeController({
        claimImpl: async () => {
          throw new LiveOpsEventSchedulerError(code);
        },
      });
      try {
        await c.claim(makeReq('valid'), 'fest-1');
        expect.fail('expected throw for ' + code);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((e as HttpException).getResponse()).toMatchObject({
          error: { code },
        });
      }
    }
  });

  it('EVENT_REWARD_OVER_CAP → 422', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new LiveOpsEventSchedulerError('EVENT_REWARD_OVER_CAP');
      },
    });
    try {
      await c.claim(makeReq('valid'), 'fest-1');
      expect.fail('expected throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  });

  it('eventKey rỗng → INVALID_INPUT 400', async () => {
    const c = makeController();
    await expect(c.claim(makeReq('valid'), '')).rejects.toThrow(HttpException);
  });

  it('unknown error rethrow', async () => {
    const boom = new Error('boom');
    const c = makeController({
      claimImpl: async () => {
        throw boom;
      },
    });
    await expect(c.claim(makeReq('valid'), 'fest-1')).rejects.toBe(boom);
  });
});
