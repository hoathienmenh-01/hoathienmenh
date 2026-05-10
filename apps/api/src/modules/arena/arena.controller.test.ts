/**
 * Phase 15.4 — ArenaController runtime gate test.
 *
 * Cover: ARENA_ENABLED=false → POST /arena/matches throws 503
 * FEATURE_DISABLED. Service không bị gọi. Các endpoint khác không gate
 * (profile/opponents/history) — không test ở đây vì cần mocks DB phức tạp.
 *
 * Đây là unit test pure (không cần DB). DB integration cho arena
 * gameplay flow đã có ở `arena.service.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ArenaController } from './arena.controller';
import type { ArenaService } from './arena.service';
import type { ArenaSeasonService } from './arena-season.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';
import type { FeatureFlagService } from '../feature-flag/feature-flag.service';

function makeController(opts: { flagOff?: boolean }) {
  const arena = {
    createMatch: vi.fn(async () => ({})),
  } as unknown as ArenaService;
  const arenaSeason = {} as ArenaSeasonService;
  const auth = {
    userIdFromAccess: async (t: string | undefined) => (t ? 'u1' : null),
  } as unknown as AuthService;
  const prisma = {
    character: { findUnique: async () => ({ id: 'c1' }) },
  } as unknown as PrismaService;
  const featureFlags = {
    requireEnabled: async () => {
      if (opts.flagOff) {
        throw new HttpException(
          {
            ok: false,
            error: {
              code: 'FEATURE_DISABLED',
              message: 'Feature disabled: ARENA_ENABLED',
            },
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    },
    isEnabled: async () => !opts.flagOff,
  } as unknown as FeatureFlagService;
  return {
    c: new ArenaController(arena, arenaSeason, auth, prisma, featureFlags),
    arena,
  };
}

function req(): Request {
  return { cookies: { xt_access: 'valid' } } as unknown as Request;
}

describe('ArenaController.createMatch — Phase 15.4 runtime gate', () => {
  it('flag off → 503 FEATURE_DISABLED, service không bị gọi', async () => {
    const { c, arena } = makeController({ flagOff: true });
    try {
      await c.createMatch(req(), {
        defenderCharacterId: 'd1',
      });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect((e as HttpException).getResponse()).toMatchObject({
        ok: false,
        error: { code: 'FEATURE_DISABLED' },
      });
    }
    expect(arena.createMatch).not.toHaveBeenCalled();
  });
});
