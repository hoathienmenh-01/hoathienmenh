/**
 * Phase 35.1 — CoCultivationController pure-unit test.
 *
 * Bypass session auth (covered ở AuthService unit test). Validate:
 *   - Controller wraps service `{ ok: true, data }` shape.
 *   - Map CoCultivationError → HTTP status đúng.
 *   - Input schema reject invalid body / query.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { CoCultivationController } from './co-cultivation.controller';
import {
  CoCultivationError,
  CoCultivationService,
} from './co-cultivation.service';
import type { AuthService } from '../auth/auth.service';

function makeAuth(userId = 'u-1'): AuthService {
  return {
    userIdFromAccess: vi.fn(async () => userId),
  } as unknown as AuthService;
}

function makeReq(): Request {
  return { cookies: { xt_access: 'tok' } } as unknown as Request;
}

function makeSvc(
  overrides: Partial<{
    requestSession: CoCultivationService['requestSession'];
    acceptSession: CoCultivationService['acceptSession'];
    cancelSession: CoCultivationService['cancelSession'];
    completeSession: CoCultivationService['completeSession'];
    getStatus: CoCultivationService['getStatus'];
    getHistory: CoCultivationService['getHistory'];
  }> = {},
): CoCultivationService {
  return {
    requestSession: overrides.requestSession ?? vi.fn(),
    acceptSession: overrides.acceptSession ?? vi.fn(),
    cancelSession: overrides.cancelSession ?? vi.fn(),
    completeSession: overrides.completeSession ?? vi.fn(),
    getStatus: overrides.getStatus ?? vi.fn(),
    getHistory: overrides.getHistory ?? vi.fn(),
  } as unknown as CoCultivationService;
}

describe('CoCultivationController', () => {
  it('GET status wraps service response', async () => {
    const svc = makeSvc({
      getStatus: vi.fn(async () => ({
        active: null,
        today: {
          userId: 'u-1',
          dateKey: '2025-01-01',
          sessionsCompleted: 1,
          totalBuffSeconds: 600,
          totalBonusExp: '5',
          remainingSessions: 2,
          remainingBuffSeconds: 1200,
        },
      })),
    });
    const ctl = new CoCultivationController(svc, makeAuth());
    const res = await ctl.status(makeReq());
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ active: null }),
    });
  });

  it('POST sessions rejects invalid partnerUserId', async () => {
    const svc = makeSvc();
    const ctl = new CoCultivationController(svc, makeAuth());
    await expect(ctl.request(makeReq(), {})).rejects.toThrow(HttpException);
    await expect(
      ctl.request(makeReq(), { partnerUserId: '' }),
    ).rejects.toThrow(HttpException);
  });

  it('POST sessions wraps successful service call', async () => {
    const fakeRow = {
      id: 's1',
      initiatorUserId: 'u-1',
      partnerUserId: 'u-2',
      initiatorCharacterId: 'c1',
      partnerCharacterId: 'c2',
      status: 'PENDING' as const,
      durationSec: 600,
      buffPercent: 3,
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      rewardApplied: false,
      bonusExpGranted: '0',
      createdAt: new Date().toISOString(),
    };
    const svc = makeSvc({ requestSession: vi.fn(async () => fakeRow) });
    const ctl = new CoCultivationController(svc, makeAuth());
    const res = await ctl.request(makeReq(), { partnerUserId: 'u-2' });
    expect(res.ok).toBe(true);
    expect(res.data.session.id).toBe('s1');
  });

  it('maps SELF_NOT_ALLOWED → 403', async () => {
    const svc = makeSvc({
      requestSession: vi.fn(async () => {
        throw new CoCultivationError('SELF_NOT_ALLOWED');
      }),
    });
    const ctl = new CoCultivationController(svc, makeAuth());
    try {
      await ctl.request(makeReq(), { partnerUserId: 'u-self' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(403);
    }
  });

  it('maps DAILY_CAP_REACHED → 409', async () => {
    const svc = makeSvc({
      requestSession: vi.fn(async () => {
        throw new CoCultivationError('DAILY_CAP_REACHED');
      }),
    });
    const ctl = new CoCultivationController(svc, makeAuth());
    try {
      await ctl.request(makeReq(), { partnerUserId: 'u-2' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(409);
    }
  });

  it('maps NOT_FOUND → 404', async () => {
    const svc = makeSvc({
      acceptSession: vi.fn(async () => {
        throw new CoCultivationError('NOT_FOUND');
      }),
    });
    const ctl = new CoCultivationController(svc, makeAuth());
    try {
      await ctl.accept(makeReq(), 'sx');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(404);
    }
  });

  it('history rejects negative limit', async () => {
    const svc = makeSvc();
    const ctl = new CoCultivationController(svc, makeAuth());
    await expect(
      ctl.history(makeReq(), { limit: -1 }),
    ).rejects.toThrow(HttpException);
  });
});
