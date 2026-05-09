/**
 * Phase 14.0.B — AdminTerritoryController unit tests.
 *
 * Test pure-unit (instantiate trực tiếp + bypass `AdminGuard` — guard logic
 * test riêng ở `admin.guard.test.ts`). Cover:
 *  - settleAll: ok với periodKey explicit + fallback (`previousTerritoryPeriodKey`)
 *  - settleAll: PERIOD_INVALID khi periodKey malformed
 *  - settleOne: ok cho region rỗng → trả `skipped: true`
 *  - settleOne: REGION_INVALID 404 / PERIOD_INVALID 400
 *  - service throw → mapping HttpException correct
 *  - settledBy phụ thuộc `req.userId` (audit trail)
 *
 * Auth (cookie + ADMIN_ONLY) test ở `admin.guard.test.ts` — controller này
 * giả định guard đã pass.
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import {
  isTerritoryPeriodKey,
  previousTerritoryPeriodKey,
  type TerritorySettlementRunResult,
  type TerritorySettlementSnapshotView,
} from '@xuantoi/shared';
import { AdminTerritoryController } from './admin-territory.controller';
import { TerritoryError } from './territory.service';
import type { TerritoryDecayService } from './territory-decay.service';
import type { TerritoryRewardService } from './territory-reward.service';
import type { TerritorySettlementService } from './territory-settlement.service';
import type { TerritoryWarService } from './territory-war.service';

type AdminReq = Request & { userId?: string };

function makeReq(opts: { userId?: string } = {}): AdminReq {
  return {
    userId: opts.userId ?? 'admin1',
    cookies: {},
  } as unknown as AdminReq;
}

interface ServiceStubs {
  settleAllRegions?: TerritorySettlementService['settleAllRegions'];
  settleRegion?: TerritorySettlementService['settleRegion'];
  decay?: TerritoryDecayService['decay'];
  getDecayHistory?: TerritoryDecayService['getDecayHistory'];
  settleCurrentPeriod?: TerritoryWarService['settleCurrentPeriod'];
  grantWeeklyOwnerRewardMail?: TerritoryRewardService['grantWeeklyOwnerRewardMail'];
}

function makeController(stubs: ServiceStubs = {}): AdminTerritoryController {
  const settlement = {
    settleAllRegions:
      stubs.settleAllRegions ??
      (async (periodKey: string): Promise<TerritorySettlementRunResult> => ({
        periodKey,
        settledAt: new Date().toISOString(),
        snapshots: [],
        skippedRegions: [],
      })),
    settleRegion:
      stubs.settleRegion ??
      (async () => ({ snapshot: null, skipped: true })),
  } as unknown as TerritorySettlementService;
  const decayService = {
    decay:
      stubs.decay ??
      (async ({ periodKey, decayBps }) => ({
        periodKey,
        decayBps: decayBps ?? 2500,
        skipped: false,
        rowsAffected: 0,
        pointsBefore: 0,
        pointsAfter: 0,
        delta: 0,
        triggeredAt: new Date().toISOString(),
      })),
    getDecayHistory: stubs.getDecayHistory ?? (async () => []),
  } as unknown as TerritoryDecayService;
  const warService = {
    settleCurrentPeriod:
      stubs.settleCurrentPeriod ??
      (async (opts) => ({
        periodKey: '2026-W23',
        settledAt: new Date().toISOString(),
        snapshots: [],
        skippedRegions: [],
        ownersAfter: [],
        // Echo settledBy nếu test cần verify (ignored bởi non-spy stub).
        ...((opts?.settledBy ? {} : {}) as Record<string, never>),
      })),
  } as unknown as TerritoryWarService;
  const rewardService = {
    grantWeeklyOwnerRewardMail:
      stubs.grantWeeklyOwnerRewardMail ??
      (async (periodKey: string, opts?: { dryRun?: boolean }) => ({
        periodKey,
        regionsProcessed: 9,
        mailsCreated: 0,
        skippedAlreadyGranted: 0,
        skippedNoWinner: 9,
        skippedNoMembers: 0,
        dryRun: opts?.dryRun === true,
        regions: [],
      })),
  } as unknown as TerritoryRewardService;
  return new AdminTerritoryController(
    settlement,
    decayService,
    warService,
    rewardService,
  );
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  let err: HttpException | null = null;
  try {
    await p;
  } catch (e) {
    err = e as HttpException;
  }
  expect(err).toBeInstanceOf(HttpException);
  expect(err!.getStatus()).toBe(status);
  expect(err!.getResponse()).toMatchObject({ ok: false, error: { code } });
}

const sampleSnapshot: TerritorySettlementSnapshotView = {
  id: 'snap1',
  regionKey: 'son_coc',
  periodKey: '2026-W23',
  winnerSectId: 'sect1',
  winnerSectName: 'WinSect',
  winnerPoints: 24,
  runnerUpSectId: null,
  runnerUpSectName: null,
  runnerUpPoints: 0,
  totalSects: 1,
  totalPoints: 24,
  settledAt: new Date().toISOString(),
  settledBy: 'admin1',
};

describe('AdminTerritoryController.settleAll', () => {
  it('ok với periodKey explicit — service nhận đúng args + req.userId', async () => {
    const calls: Array<[string, { settledBy?: string | null }]> = [];
    const c = makeController({
      settleAllRegions: (async (periodKey, opts) => {
        calls.push([periodKey, opts ?? {}]);
        return {
          periodKey,
          settledAt: new Date().toISOString(),
          snapshots: [sampleSnapshot],
          skippedRegions: [],
        };
      }) as TerritorySettlementService['settleAllRegions'],
    });
    const r = await c.settleAll({ periodKey: '2026-W23' }, makeReq({ userId: 'admin99' }));
    expect(r.ok).toBe(true);
    expect(r.data.snapshots).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('2026-W23');
    expect(calls[0][1].settledBy).toBe('admin99');
  });

  it('periodKey thiếu → fallback previousTerritoryPeriodKey()', async () => {
    const calls: Array<string> = [];
    const c = makeController({
      settleAllRegions: (async (periodKey) => {
        calls.push(periodKey);
        return {
          periodKey,
          settledAt: new Date().toISOString(),
          snapshots: [],
          skippedRegions: [],
        };
      }) as TerritorySettlementService['settleAllRegions'],
    });
    await c.settleAll({}, makeReq());
    expect(calls).toHaveLength(1);
    const fallback = previousTerritoryPeriodKey();
    expect(calls[0]).toBe(fallback);
    expect(isTerritoryPeriodKey(fallback)).toBe(true);
  });

  it('periodKey malformed → 400 PERIOD_INVALID', async () => {
    const c = makeController();
    await expectHttpError(
      c.settleAll({ periodKey: 'bad-period' }, makeReq()),
      400,
      'PERIOD_INVALID',
    );
  });

  it('periodKey unknown query field → 400 INVALID_INPUT (zod strict)', async () => {
    const c = makeController();
    await expectHttpError(
      c.settleAll({ periodKey: '2026-W23', extra: 'x' }, makeReq()),
      400,
      'INVALID_INPUT',
    );
  });

  it('service throw PERIOD_INVALID → 400', async () => {
    const c = makeController({
      settleAllRegions: (async () => {
        throw new TerritoryError('PERIOD_INVALID');
      }) as TerritorySettlementService['settleAllRegions'],
    });
    await expectHttpError(
      c.settleAll({ periodKey: '2026-W23' }, makeReq()),
      400,
      'PERIOD_INVALID',
    );
  });
});

describe('AdminTerritoryController.settleOne', () => {
  it('ok cho region rỗng → trả skipped=true', async () => {
    const c = makeController({
      settleRegion: (async () => ({ snapshot: null, skipped: true })) as
        TerritorySettlementService['settleRegion'],
    });
    const r = await c.settleOne(
      'son_coc',
      { periodKey: '2026-W23' },
      makeReq(),
    );
    expect(r.ok).toBe(true);
    expect(r.data.skipped).toBe(true);
    expect(r.data.snapshot).toBeNull();
    expect(r.data.regionKey).toBe('son_coc');
    expect(r.data.periodKey).toBe('2026-W23');
  });

  it('ok cho region có winner → trả snapshot', async () => {
    const c = makeController({
      settleRegion: (async () => ({
        snapshot: sampleSnapshot,
        skipped: false,
      })) as TerritorySettlementService['settleRegion'],
    });
    const r = await c.settleOne(
      'son_coc',
      { periodKey: '2026-W23' },
      makeReq(),
    );
    expect(r.ok).toBe(true);
    expect(r.data.skipped).toBe(false);
    expect(r.data.snapshot?.winnerSectId).toBe('sect1');
  });

  it('truyền req.userId vào settledBy', async () => {
    const calls: Array<{ regionKey: string; settledBy: string | null }> = [];
    const c = makeController({
      settleRegion: (async (regionKey, _periodKey, opts) => {
        calls.push({
          regionKey,
          settledBy: opts?.settledBy ?? null,
        });
        return { snapshot: null, skipped: true };
      }) as TerritorySettlementService['settleRegion'],
    });
    await c.settleOne(
      'son_coc',
      { periodKey: '2026-W23' },
      makeReq({ userId: 'admin42' }),
    );
    expect(calls[0].settledBy).toBe('admin42');
  });

  it('REGION_INVALID → 404', async () => {
    const c = makeController({
      settleRegion: (async () => {
        throw new TerritoryError('REGION_INVALID');
      }) as TerritorySettlementService['settleRegion'],
    });
    await expectHttpError(
      c.settleOne('not_a_region', { periodKey: '2026-W23' }, makeReq()),
      404,
      'REGION_INVALID',
    );
  });

  it('PERIOD_INVALID query bị reject 400 trước khi gọi service', async () => {
    const calls: Array<string> = [];
    const c = makeController({
      settleRegion: (async (regionKey) => {
        calls.push(regionKey);
        return { snapshot: null, skipped: true };
      }) as TerritorySettlementService['settleRegion'],
    });
    await expectHttpError(
      c.settleOne('son_coc', { periodKey: 'bad' }, makeReq()),
      400,
      'PERIOD_INVALID',
    );
    expect(calls).toHaveLength(0);
  });

  it('manual_xx period → ok (admin override)', async () => {
    const calls: Array<string> = [];
    const c = makeController({
      settleRegion: (async (_r, periodKey) => {
        calls.push(periodKey);
        return { snapshot: null, skipped: true };
      }) as TerritorySettlementService['settleRegion'],
    });
    const r = await c.settleOne(
      'son_coc',
      { periodKey: 'manual_admin_001' },
      makeReq(),
    );
    expect(r.ok).toBe(true);
    expect(calls[0]).toBe('manual_admin_001');
  });

  it('service throw error khác → rethrow nguyên (giữ stack)', async () => {
    const c = makeController({
      settleRegion: (async () => {
        throw new Error('boom');
      }) as TerritorySettlementService['settleRegion'],
    });
    let err: unknown = null;
    try {
      await c.settleOne(
        'son_coc',
        { periodKey: '2026-W23' },
        makeReq(),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
  });
});

describe('AdminTerritoryController.settleWarCurrent', () => {
  it('ok → service nhận req.userId vào settledBy + return data', async () => {
    const calls: Array<{ settledBy: string | null }> = [];
    const c = makeController({
      settleCurrentPeriod: (async (opts) => {
        calls.push({ settledBy: opts?.settledBy ?? null });
        return {
          periodKey: '2026-W23',
          settledAt: new Date().toISOString(),
          snapshots: [sampleSnapshot],
          skippedRegions: ['kim_son_mach'],
          ownersAfter: [],
        };
      }) as TerritoryWarService['settleCurrentPeriod'],
    });
    const r = await c.settleWarCurrent(makeReq({ userId: 'admin77' }));
    expect(r.ok).toBe(true);
    expect(r.data.snapshots).toHaveLength(1);
    expect(r.data.skippedRegions).toEqual(['kim_son_mach']);
    expect(calls).toHaveLength(1);
    expect(calls[0].settledBy).toBe('admin77');
  });

  it('service throw PERIOD_INVALID → 400', async () => {
    const c = makeController({
      settleCurrentPeriod: (async () => {
        throw new TerritoryError('PERIOD_INVALID');
      }) as TerritoryWarService['settleCurrentPeriod'],
    });
    await expectHttpError(
      c.settleWarCurrent(makeReq()),
      400,
      'PERIOD_INVALID',
    );
  });

  it('service throw error khác → rethrow nguyên', async () => {
    const c = makeController({
      settleCurrentPeriod: (async () => {
        throw new Error('boom');
      }) as TerritoryWarService['settleCurrentPeriod'],
    });
    let err: unknown = null;
    try {
      await c.settleWarCurrent(makeReq());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
  });
});

describe('AdminTerritoryController.grantWeeklyOwnerReward (Phase 14.0.E)', () => {
  it('ok với periodKey explicit + dryRun=false (default)', async () => {
    const calls: Array<{ periodKey: string; dryRun: boolean | undefined }> = [];
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async (periodKey, opts) => {
        calls.push({ periodKey, dryRun: opts?.dryRun });
        return {
          periodKey,
          regionsProcessed: 9,
          mailsCreated: 5,
          skippedAlreadyGranted: 0,
          skippedNoWinner: 4,
          skippedNoMembers: 0,
          dryRun: false,
          regions: [],
        };
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    const r = await c.grantWeeklyOwnerReward(
      { periodKey: '2026-W23' },
      makeReq({ userId: 'admin99' }),
    );
    expect(r.ok).toBe(true);
    expect(r.data.mailsCreated).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0].periodKey).toBe('2026-W23');
    expect(calls[0].dryRun).toBe(false);
  });

  it('periodKey thiếu → fallback previousTerritoryPeriodKey()', async () => {
    const calls: Array<string> = [];
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async (periodKey) => {
        calls.push(periodKey);
        return {
          periodKey,
          regionsProcessed: 9,
          mailsCreated: 0,
          skippedAlreadyGranted: 0,
          skippedNoWinner: 9,
          skippedNoMembers: 0,
          dryRun: false,
          regions: [],
        };
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    const r = await c.grantWeeklyOwnerReward({}, makeReq());
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(isTerritoryPeriodKey(calls[0])).toBe(true);
    // Fallback phải là tuần trước (deterministic helper từ shared).
    expect(calls[0]).toBe(previousTerritoryPeriodKey());
  });

  it('dryRun string "true" → forwarded as boolean true', async () => {
    const calls: Array<{ dryRun: boolean | undefined }> = [];
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async (periodKey, opts) => {
        calls.push({ dryRun: opts?.dryRun });
        return {
          periodKey,
          regionsProcessed: 9,
          mailsCreated: 0,
          skippedAlreadyGranted: 0,
          skippedNoWinner: 9,
          skippedNoMembers: 0,
          dryRun: true,
          regions: [],
        };
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    const r = await c.grantWeeklyOwnerReward(
      { periodKey: '2026-W23', dryRun: 'true' },
      makeReq(),
    );
    expect(r.ok).toBe(true);
    expect(calls[0].dryRun).toBe(true);
  });

  it('dryRun=true (boolean) → forwarded as true', async () => {
    const calls: Array<{ dryRun: boolean | undefined }> = [];
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async (periodKey, opts) => {
        calls.push({ dryRun: opts?.dryRun });
        return {
          periodKey,
          regionsProcessed: 9,
          mailsCreated: 0,
          skippedAlreadyGranted: 0,
          skippedNoWinner: 9,
          skippedNoMembers: 0,
          dryRun: true,
          regions: [],
        };
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    await c.grantWeeklyOwnerReward(
      { periodKey: '2026-W23', dryRun: true },
      makeReq(),
    );
    expect(calls[0].dryRun).toBe(true);
  });

  it('periodKey malformed → 400 PERIOD_INVALID', async () => {
    const c = makeController();
    await expectHttpError(
      c.grantWeeklyOwnerReward(
        { periodKey: 'NOT-A-WEEK' },
        makeReq(),
      ),
      400,
      'PERIOD_INVALID',
    );
  });

  it('unknown body field → 400 INVALID_INPUT (zod strict)', async () => {
    const c = makeController();
    await expectHttpError(
      c.grantWeeklyOwnerReward(
        { periodKey: '2026-W23', evil: 'yes' } as unknown,
        makeReq(),
      ),
      400,
      'INVALID_INPUT',
    );
  });

  it('forwards req.userId vào triggeredBy (audit trail)', async () => {
    const calls: Array<{ triggeredBy: string | null | undefined }> = [];
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async (periodKey, opts) => {
        calls.push({ triggeredBy: opts?.triggeredBy });
        return {
          periodKey,
          regionsProcessed: 9,
          mailsCreated: 0,
          skippedAlreadyGranted: 0,
          skippedNoWinner: 9,
          skippedNoMembers: 0,
          dryRun: false,
          regions: [],
        };
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    await c.grantWeeklyOwnerReward(
      { periodKey: '2026-W23' },
      makeReq({ userId: 'admin42' }),
    );
    expect(calls[0].triggeredBy).toBe('admin42');
  });

  it('service throw PERIOD_INVALID → 400', async () => {
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async () => {
        throw new TerritoryError('PERIOD_INVALID');
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    await expectHttpError(
      c.grantWeeklyOwnerReward({ periodKey: '2026-W23' }, makeReq()),
      400,
      'PERIOD_INVALID',
    );
  });

  it('service throw error khác → rethrow nguyên', async () => {
    const c = makeController({
      grantWeeklyOwnerRewardMail: (async () => {
        throw new Error('boom');
      }) as TerritoryRewardService['grantWeeklyOwnerRewardMail'],
    });
    let err: unknown = null;
    try {
      await c.grantWeeklyOwnerReward({ periodKey: '2026-W23' }, makeReq());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
  });
});
