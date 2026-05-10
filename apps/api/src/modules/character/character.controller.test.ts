import { describe, it, expect, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import {
  CharacterController,
  PROFILE_RATE_LIMIT_MAX,
  PROFILE_RATE_LIMIT_WINDOW_MS,
} from './character.controller';
import { InMemorySlidingWindowRateLimiter } from '../../common/rate-limiter';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService, PublicProfileView } from './character.service';

/**
 * Controller-level rate-limit test cho `GET /character/profile/:id` (M11).
 * Không cần Postgres — service được mock + limiter in-memory state riêng cho mỗi test.
 */

const STUB_PROFILE: PublicProfileView = {
  id: 'p1',
  name: 'Đạo Hữu',
  realmKey: 'phamnhan',
  realmStage: 0,
  level: 1,
  power: 14,
  spirit: 8,
  speed: 12,
  luck: 5,
  sectId: null,
  sectKey: null,
  sectName: null,
  role: 'PLAYER',
  createdAt: new Date('2026-04-28T00:00:00Z').toISOString(),
};

function makeReq(ip: string): Request {
  return {
    cookies: { xt_access: 'fake-access-cookie' },
    ip,
  } as unknown as Request;
}

function makeController(opts: { max: number }) {
  const auth = {
    userIdFromAccess: async (token: string | undefined) => (token ? 'u1' : null),
  } as unknown as AuthService;
  let calls = 0;
  const chars = {
    findPublicProfile: async (_id: string) => {
      calls += 1;
      return STUB_PROFILE;
    },
  } as unknown as CharacterService;
  const limiter = new InMemorySlidingWindowRateLimiter(
    PROFILE_RATE_LIMIT_WINDOW_MS,
    opts.max,
  );
  const controller = new CharacterController(
    chars,
    auth,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    limiter,
  );
  return {
    controller,
    limiter,
    getCalls: () => calls,
  };
}

describe('CharacterController.profile — anti-scrape rate limit (M11)', () => {
  let h: ReturnType<typeof makeController>;

  beforeEach(() => {
    h = makeController({ max: 3 });
  });

  it('cho phép tối đa max request/IP rồi RATE_LIMITED ở request thứ (max+1)', async () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 3; i++) {
      const res = await h.controller.profile(makeReq(ip), 'p1');
      expect(res.ok).toBe(true);
    }
    let caught: HttpException | null = null;
    try {
      await h.controller.profile(makeReq(ip), 'p1');
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = caught?.getResponse() as { ok: false; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    // Khi RATE_LIMITED không được call DB.
    expect(h.getCalls()).toBe(3);
  });

  it('IP khác KHÔNG bị limit chéo (per-IP isolation)', async () => {
    const ipA = '203.0.113.11';
    const ipB = '203.0.113.12';
    for (let i = 0; i < 3; i++) {
      await h.controller.profile(makeReq(ipA), 'p1');
    }
    // ipA exhausted, but ipB still has full budget.
    for (let i = 0; i < 3; i++) {
      const res = await h.controller.profile(makeReq(ipB), 'p1');
      expect(res.ok).toBe(true);
    }
    expect(h.getCalls()).toBe(6);
  });
});

describe('CharacterController.profile — limiter constants', () => {
  it('giá trị mặc định là 120 req/IP/15 phút (đủ cho leaderboard top 50 + chat tap-name)', () => {
    expect(PROFILE_RATE_LIMIT_MAX).toBe(120);
    expect(PROFILE_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
