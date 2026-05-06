import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import {
  type TribulationAttemptLogView,
  type TribulationService,
} from './tribulation.service';

/**
 * Phase 11.6.F — controller-level test cho `GET /character/tribulation/log`.
 * Service được mock; verify auth gate, character gate, query parsing, response shape.
 */

function stubLog(
  overrides: Partial<TribulationAttemptLogView> = {},
): TribulationAttemptLogView {
  return {
    id: 'log_1',
    tribulationKey: 'kim_dan_to_nguyen_anh_minor_lei',
    fromRealmKey: 'kim_dan',
    toRealmKey: 'nguyen_anh',
    severity: 'minor',
    type: 'lei',
    success: false,
    wavesCompleted: 1,
    totalDamage: 800,
    finalHp: 0,
    hpInitial: 100,
    expBefore: '120000',
    expAfter: '60000',
    expLoss: '60000',
    taoMaActive: false,
    taoMaExpiresAt: null,
    cooldownAt: '2026-05-02T01:00:00.000Z',
    linhThachReward: 0,
    expBonusReward: '0',
    titleKeyReward: null,
    attemptIndex: 1,
    taoMaRoll: 0.5,
    createdAt: '2026-05-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeReq(opts?: {
  cookieToken?: string | null;
}): Request {
  return {
    cookies:
      opts?.cookieToken === null ? {} : { xt_access: opts?.cookieToken ?? 'tk' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  userIdFromAccess?: (token: string | undefined) => Promise<string | null>;
  character?: { id: string } | null;
  tribulation?: Partial<TribulationService> | null;
}

function makeController(opts: ControllerOpts = {}) {
  const auth = {
    userIdFromAccess:
      opts.userIdFromAccess ??
      (async (token: string | undefined) => (token ? 'u1' : null)),
  } as unknown as AuthService;
  const character =
    opts.character === undefined ? { id: 'c1' } : opts.character;
  const chars = {
    findByUser: async (_userId: string) => character,
  } as unknown as CharacterService;
  const tribulation =
    opts.tribulation === null
      ? undefined
      : (opts.tribulation as TribulationService | undefined);
  const controller = new CharacterController(
    chars,
    auth,
    undefined, // spiritualRoot
    undefined, // cultivationMethod
    undefined, // characterSkill
    undefined, // gem
    undefined, // refine
    tribulation,
    undefined, // achievement
    undefined, // talent
    undefined, // alchemy
    undefined, // title
    undefined, // buff
    undefined, // profileLimiter
  );
  return { controller };
}

describe('CharacterController.tribulationLog — Phase 11.6.F', () => {
  it('happy path → return rows + limit echo, default limit=20', async () => {
    let receivedCharId: string | null = null;
    let receivedLimit: number | undefined;
    const tribulation = {
      listAttemptLogs: async (charId: string, limit?: number) => {
        receivedCharId = charId;
        receivedLimit = limit;
        return [stubLog()];
      },
    } as unknown as TribulationService;
    const { controller } = makeController({ tribulation });

    const res = (await controller.tribulationLog(makeReq())) as {
      ok: true;
      data: { rows: TribulationAttemptLogView[]; limit: number };
    };

    expect(res.ok).toBe(true);
    expect(res.data.rows).toHaveLength(1);
    expect(res.data.rows[0]!.tribulationKey).toBe(
      'kim_dan_to_nguyen_anh_minor_lei',
    );
    expect(res.data.limit).toBe(20);
    expect(receivedCharId).toBe('c1');
    expect(receivedLimit).toBe(20);
  });

  it('?limit=5 → forward 5 to service + echo', async () => {
    let receivedLimit: number | undefined;
    const tribulation = {
      listAttemptLogs: async (_id: string, limit?: number) => {
        receivedLimit = limit;
        return [];
      },
    } as unknown as TribulationService;
    const { controller } = makeController({ tribulation });

    const res = (await controller.tribulationLog(makeReq(), '5')) as {
      ok: true;
      data: { rows: TribulationAttemptLogView[]; limit: number };
    };

    expect(receivedLimit).toBe(5);
    expect(res.data.limit).toBe(5);
  });

  it('?limit=999 → cap về 100 (MAX) trước khi forward', async () => {
    let receivedLimit: number | undefined;
    const tribulation = {
      listAttemptLogs: async (_id: string, limit?: number) => {
        receivedLimit = limit;
        return [];
      },
    } as unknown as TribulationService;
    const { controller } = makeController({ tribulation });

    const res = (await controller.tribulationLog(makeReq(), '999')) as {
      ok: true;
      data: { rows: TribulationAttemptLogView[]; limit: number };
    };

    expect(receivedLimit).toBe(100);
    expect(res.data.limit).toBe(100);
  });

  it('?limit=abc/0/-5 → fallback default 20', async () => {
    const tribulation = {
      listAttemptLogs: async (_id: string, _limit?: number) => [],
    } as unknown as TribulationService;
    const { controller } = makeController({ tribulation });

    for (const bad of ['abc', '0', '-5', '']) {
      const res = (await controller.tribulationLog(makeReq(), bad)) as {
        ok: true;
        data: { limit: number };
      };
      expect(res.data.limit).toBe(20);
    }
  });

  it('UNAUTHENTICATED khi không có cookie/userId → throw 401', async () => {
    const tribulation = {
      listAttemptLogs: async () => [],
    } as unknown as TribulationService;
    const { controller } = makeController({
      tribulation,
      userIdFromAccess: async () => null,
    });

    await expect(
      controller.tribulationLog(makeReq({ cookieToken: null })),
    ).rejects.toBeInstanceOf(HttpException);
    try {
      await controller.tribulationLog(makeReq({ cookieToken: null }));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }
  });

  it('TRIBULATION_UNAVAILABLE khi service không inject → throw 501', async () => {
    const { controller } = makeController({ tribulation: null });
    try {
      await controller.tribulationLog(makeReq());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
  });

  it('NO_CHARACTER khi user chưa tạo character → throw 404', async () => {
    const tribulation = {
      listAttemptLogs: async () => [],
    } as unknown as TribulationService;
    const { controller } = makeController({
      tribulation,
      character: null,
    });
    try {
      await controller.tribulationLog(makeReq());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });

  it('multi-row response → preserve order + BigInt-as-string passthrough', async () => {
    const tribulation = {
      listAttemptLogs: async () => [
        stubLog({ id: 'log_3', attemptIndex: 3, success: true }),
        stubLog({ id: 'log_2', attemptIndex: 2 }),
        stubLog({ id: 'log_1', attemptIndex: 1 }),
      ],
    } as unknown as TribulationService;
    const { controller } = makeController({ tribulation });

    const res = (await controller.tribulationLog(makeReq())) as {
      ok: true;
      data: { rows: TribulationAttemptLogView[] };
    };
    expect(res.data.rows.map((r) => r.id)).toEqual([
      'log_3',
      'log_2',
      'log_1',
    ]);
    expect(res.data.rows[0]!.success).toBe(true);
    expect(typeof res.data.rows[0]!.expBefore).toBe('string');
  });
});
