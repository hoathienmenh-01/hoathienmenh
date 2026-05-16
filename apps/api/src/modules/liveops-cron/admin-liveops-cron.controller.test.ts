/**
 * Phase 13.2.D + 14.0.F — AdminLiveOpsCronController unit tests.
 *
 * Test pure-unit (instantiate controller trực tiếp + bypass `AdminGuard`
 * — guard logic test riêng ở `admin.guard.test.ts`). Cover:
 *   - runWeeklyCycle: ok với periodKey override + fallback default.
 *   - runWeeklyCycle: PERIOD_INVALID khi periodKey malformed.
 *   - runWeeklyCycle: triggeredBy = req.userId (audit trail).
 *   - runTerritoryNow / runSectSeasonNow: ok + PERIOD_INVALID.
 *   - audit row được ghi (qua prisma mock spy).
 *
 * Auth (cookie + ADMIN_ONLY) test ở `admin.guard.test.ts` — controller
 * này giả định guard đã pass (đã có `req.userId` + `req.role`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminLiveOpsCronController } from './admin-liveops-cron.controller';
import type {
  LiveOpsCronService,
  SectSeasonCycleSummary,
  TerritoryCycleSummary,
  WeeklyCycleSummary,
} from './liveops-cron.service';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

interface ControllerStubs {
  runWeeklyCycle?: LiveOpsCronService['runWeeklyCycle'];
  runTerritoryCycle?: LiveOpsCronService['runTerritoryCycle'];
  runSectSeasonCycle?: LiveOpsCronService['runSectSeasonCycle'];
  auditCreated?: { count: number; actions: string[] };
}

function emptyTerritory(periodKey: string): TerritoryCycleSummary {
  return {
    periodKey,
    territorySettled: 0,
    territorySkipped: 0,
    territoryDecaySkipped: false,
    territoryDecayDelta: 0,
    rewardMailsCreated: 0,
    rewardSkippedAlreadyGranted: 0,
    errors: [],
  };
}

function emptySectSeason(): SectSeasonCycleSummary {
  return {
    seasonSnapshotsCreated: 0,
    seasonSnapshotsSkipped: 0,
    seasonsProcessed: [],
    championMailsCreated: 0,
    championAlreadyGranted: 0,
    mvpMailsCreated: 0,
    mvpAlreadyGranted: 0,
    errors: [],
  };
}

function makeController(stubs: ControllerStubs = {}): {
  c: AdminLiveOpsCronController;
  audit: { count: number; actions: string[] };
} {
  const audit = stubs.auditCreated ?? { count: 0, actions: [] };
  const cronService = {
    runWeeklyCycle:
      stubs.runWeeklyCycle ??
      (async (opts): Promise<WeeklyCycleSummary> => ({
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        skippedAlreadyDone: false,
        territory: emptyTerritory(opts?.periodKey ?? '2026-W01'),
        sectSeason: emptySectSeason(),
        triggeredBy: opts?.triggeredBy ?? null,
      })),
    runTerritoryCycle:
      stubs.runTerritoryCycle ??
      (async (opts): Promise<TerritoryCycleSummary> =>
        emptyTerritory(opts?.periodKey ?? '2026-W01')),
    runSectSeasonCycle:
      stubs.runSectSeasonCycle ??
      (async (): Promise<SectSeasonCycleSummary> => emptySectSeason()),
  } as unknown as LiveOpsCronService;
  const prisma = {
    adminAuditLog: {
      create: async (input: { data: { action: string } }) => {
        audit.count++;
        audit.actions.push(input.data.action);
        return {};
      },
    },
  } as unknown as ConstructorParameters<typeof AdminLiveOpsCronController>[1];
  return {
    c: new AdminLiveOpsCronController(cronService, prisma),
    audit,
  };
}

describe('AdminLiveOpsCronController.runWeeklyCycle', () => {
  it('ok với periodKey override → triggeredBy = req.userId', async () => {
    let captured: { periodKey?: string; triggeredBy?: string | null } = {};
    const { c, audit } = makeController({
      runWeeklyCycle: async (opts) => {
        captured = {
          periodKey: opts?.periodKey,
          triggeredBy: opts?.triggeredBy ?? null,
        };
        return {
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
          skippedAlreadyDone: false,
          territory: emptyTerritory(opts?.periodKey ?? '2026-W01'),
          sectSeason: emptySectSeason(),
          triggeredBy: opts?.triggeredBy ?? null,
        };
      },
    });
    const r = await c.runWeeklyCycle(makeReq('admin42'), {
      periodKey: '2026-W19',
      bypassLease: true,
    });
    expect(r.ok).toBe(true);
    expect(r.data.territory.periodKey).toBe('2026-W19');
    expect(captured.periodKey).toBe('2026-W19');
    expect(captured.triggeredBy).toBe('admin42');
    expect(audit.count).toBe(1);
  });

  it('PERIOD_INVALID 400 khi periodKey malformed', async () => {
    const { c, audit } = makeController();
    await expect(
      c.runWeeklyCycle(makeReq(), { periodKey: 'not-a-period' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.count).toBe(0);
  });

  it('INVALID_INPUT khi body có key extra', async () => {
    const { c } = makeController();
    await expect(
      c.runWeeklyCycle(makeReq(), {
        periodKey: '2026-W19',
        evilKey: 'x',
      } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('default periodKey → service tự fallback (controller không validate)', async () => {
    const { c, audit } = makeController();
    const r = await c.runWeeklyCycle(makeReq(), {});
    expect(r.ok).toBe(true);
    expect(audit.count).toBe(1);
  });
});

describe('AdminLiveOpsCronController.runTerritoryNow', () => {
  it('ok với periodKey override', async () => {
    const { c, audit } = makeController({
      runTerritoryCycle: async (opts) => ({
        ...emptyTerritory(opts?.periodKey ?? '2026-W01'),
        rewardMailsCreated: 3,
      }),
    });
    const r = await c.runTerritoryNow(makeReq(), { periodKey: '2026-W20' });
    expect(r.data.periodKey).toBe('2026-W20');
    expect(r.data.rewardMailsCreated).toBe(3);
    expect(audit.count).toBe(1);
  });

  it('PERIOD_INVALID khi malformed', async () => {
    const { c } = makeController();
    await expect(
      c.runTerritoryNow(makeReq(), { periodKey: 'xyz' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('AdminLiveOpsCronController.runSectSeasonNow', () => {
  it('ok summary returned + audit ghi', async () => {
    const { c, audit } = makeController({
      runSectSeasonCycle: async () => ({
        seasonSnapshotsCreated: 2,
        seasonSnapshotsSkipped: 1,
        seasonsProcessed: ['season_2026_s1', 'season_2026_s2', 'season_2026_s3'],
        championMailsCreated: 0,
        championAlreadyGranted: 0,
        mvpMailsCreated: 0,
        mvpAlreadyGranted: 0,
        errors: [],
      }),
    });
    const r = await c.runSectSeasonNow(makeReq(), {});
    expect(r.data.seasonSnapshotsCreated).toBe(2);
    expect(r.data.seasonSnapshotsSkipped).toBe(1);
    expect(r.data.seasonsProcessed).toHaveLength(3);
    expect(audit.count).toBe(1);
  });

  it('audit fail-soft KHÔNG block return', async () => {
    let throws = 0;
    const { c } = makeController({
      runSectSeasonCycle: async () => emptySectSeason(),
    });
    // Override prisma mock to throw — verify return value still ok.
    (c as unknown as {
      prisma: {
        adminAuditLog: { create: () => Promise<unknown> };
      };
    }).prisma = {
      adminAuditLog: {
        create: async () => {
          throws++;
          throw new Error('audit DB down');
        },
      },
    };
    const r = await c.runSectSeasonNow(makeReq(), {});
    expect(r.ok).toBe(true);
    expect(throws).toBe(1);
  });
});

/**
 * Phase Audit-1 — lock audit log action codes vào string đã document
 * trong `docs/API.md` / `docs/CHANGELOG.md` / `docs/LIVE_OPS_MODEL.md`.
 *
 * Đổi tên action ở controller phải kéo theo update cả 3 doc — test này
 * giúp catch docs lệch sớm thay vì để escape vào production audit log
 * (downstream BI/SIEM filter theo action string).
 */
describe('AdminLiveOpsCronController — audit action codes contract', () => {
  it('runWeeklyCycle ghi audit ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE', async () => {
    const { c, audit } = makeController();
    await c.runWeeklyCycle(makeReq(), { periodKey: '2026-W19' });
    expect(audit.actions).toEqual(['ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE']);
  });

  it('runTerritoryNow ghi audit ADMIN_TERRITORY_CRON_RUN', async () => {
    const { c, audit } = makeController();
    await c.runTerritoryNow(makeReq(), { periodKey: '2026-W19' });
    expect(audit.actions).toEqual(['ADMIN_TERRITORY_CRON_RUN']);
  });

  it('runSectSeasonNow ghi audit ADMIN_SECT_SEASON_CRON_RUN', async () => {
    const { c, audit } = makeController();
    await c.runSectSeasonNow(makeReq(), {});
    expect(audit.actions).toEqual(['ADMIN_SECT_SEASON_CRON_RUN']);
  });
});

/**
 * Phase 15.7 — Status endpoint contract.
 *
 * `territoryCronStatus` / `sectSeasonCronStatus` đọc cron config + last
 * snapshot/decay/reward/grant rows từ DB. Read-only, KHÔNG audit. Test
 * verify shape return + tolerance khi DB rỗng (lastSnapshot=null...).
 */
function makeStatusController(stubs: {
  settlementRow?: { periodKey: string; settledAt: Date } | null;
  decayRow?: { periodKey: string; triggeredAt: Date } | null;
  rewardRow?: { periodKey: string; grantedAt: Date } | null;
  snapshotRow?: { seasonKey: string; finalizedAt: Date } | null;
  champRow?: { seasonKey: string; grantedAt: Date } | null;
  mvpRow?: { seasonKey: string; grantedAt: Date } | null;
  /** Phase 15.8 — LiveOpsCronRunLog rows keyed by cronKey + filter. */
  cronRunLogs?: Record<
    string,
    Array<{ finishedAt: Date | null; startedAt: Date; success: boolean }>
  >;
}) {
  const cronService = {
    runWeeklyCycle: async () => {
      throw new Error('not used');
    },
    runTerritoryCycle: async () => {
      throw new Error('not used');
    },
    runSectSeasonCycle: async () => {
      throw new Error('not used');
    },
  } as unknown as LiveOpsCronService;
  const runLogs = stubs.cronRunLogs ?? {};
  type RunRow = {
    finishedAt: Date | null;
    startedAt: Date;
    success: boolean;
  };
  const filterRows = (
    cronKey: string,
    where: {
      cronKey?: string;
      success?: boolean;
      finishedAt?: { not: null } | Date | null;
    } = {},
  ): RunRow[] => {
    const rows = runLogs[cronKey] ?? [];
    return rows.filter((r) => {
      if (where.success !== undefined && r.success !== where.success) {
        return false;
      }
      if (
        where.finishedAt &&
        typeof where.finishedAt === 'object' &&
        'not' in where.finishedAt &&
        where.finishedAt.not === null
      ) {
        return r.finishedAt !== null;
      }
      return true;
    });
  };
  const prisma = {
    sectTerritorySettlementSnapshot: {
      findFirst: async () => stubs.settlementRow ?? null,
    },
    sectTerritoryDecayLog: {
      findFirst: async () => stubs.decayRow ?? null,
    },
    territoryOwnerRewardGrant: {
      findFirst: async () => stubs.rewardRow ?? null,
    },
    sectSeasonSnapshot: {
      findFirst: async () => stubs.snapshotRow ?? null,
    },
    sectSeasonRewardGrant: {
      findFirst: async (args?: { where?: { rewardType?: string } }) => {
        const t = args?.where?.rewardType;
        if (t === 'CHAMPION') return stubs.champRow ?? null;
        if (t === 'MVP') return stubs.mvpRow ?? null;
        return null;
      },
    },
    liveOpsCronRunLog: {
      findFirst: async (args?: {
        where?: {
          cronKey?: string;
          success?: boolean;
          finishedAt?: { not: null } | null;
        };
        orderBy?: unknown;
      }) => {
        const cronKey = args?.where?.cronKey ?? '';
        const rows = filterRows(cronKey, args?.where);
        if (rows.length === 0) return null;
        // Return most recent by finishedAt (fallback startedAt) desc.
        const sorted = [...rows].sort((a, b) => {
          const av = (a.finishedAt ?? a.startedAt).getTime();
          const bv = (b.finishedAt ?? b.startedAt).getTime();
          return bv - av;
        });
        return sorted[0];
      },
    },
    adminAuditLog: { create: async () => ({}) },
  } as unknown as ConstructorParameters<typeof AdminLiveOpsCronController>[1];
  return new AdminLiveOpsCronController(cronService, prisma);
}

describe('AdminLiveOpsCronController.territoryCronStatus', () => {
  it('DB rỗng → trả last* = null nhưng vẫn có config + previousPeriodKey', async () => {
    const c = makeStatusController({});
    const r = await c.territoryCronStatus();
    expect(r.ok).toBe(true);
    expect(typeof r.data.enabled).toBe('boolean');
    expect(typeof r.data.cron).toBe('string');
    expect(typeof r.data.timezone).toBe('string');
    expect(typeof r.data.previousPeriodKey).toBe('string');
    expect(r.data.lastSettlement).toBeNull();
    expect(r.data.lastDecay).toBeNull();
    expect(r.data.lastReward).toBeNull();
    // Phase 15.8 — health field present, defaults to STALE when never run.
    expect(['OK', 'STALE', 'DEGRADED', 'DISABLED']).toContain(
      r.data.health.status,
    );
    expect(r.data.health.lastRunAt).toBeNull();
    expect(r.data.health.lastSuccessAt).toBeNull();
    expect(r.data.health.lastErrorAt).toBeNull();
    expect(r.data.health.nextExpectedRunAt).toBeNull();
  });

  it('DB có data → trả last* serialize ISO string', async () => {
    const c = makeStatusController({
      settlementRow: {
        periodKey: '2026-W19',
        settledAt: new Date('2026-05-11T00:05:00Z'),
      },
      decayRow: {
        periodKey: '2026-W19',
        triggeredAt: new Date('2026-05-11T00:06:00Z'),
      },
      rewardRow: {
        periodKey: '2026-W19',
        grantedAt: new Date('2026-05-11T00:07:00Z'),
      },
    });
    const r = await c.territoryCronStatus();
    expect(r.data.lastSettlement).toEqual({
      periodKey: '2026-W19',
      settledAt: '2026-05-11T00:05:00.000Z',
    });
    expect(r.data.lastDecay).toEqual({
      periodKey: '2026-W19',
      appliedAt: '2026-05-11T00:06:00.000Z',
    });
    expect(r.data.lastReward).toEqual({
      periodKey: '2026-W19',
      grantedAt: '2026-05-11T00:07:00.000Z',
    });
  });
});

describe('AdminLiveOpsCronController.sectSeasonCronStatus', () => {
  it('DB rỗng → last* null, vẫn có config', async () => {
    const c = makeStatusController({});
    const r = await c.sectSeasonCronStatus();
    expect(r.ok).toBe(true);
    expect(r.data.lastSnapshot).toBeNull();
    expect(r.data.lastChampionGrant).toBeNull();
    expect(r.data.lastMvpGrant).toBeNull();
    expect(typeof r.data.enabled).toBe('boolean');
    expect(typeof r.data.timezone).toBe('string');
  });

  it('DB có data → snapshot + champion + MVP serialize đúng', async () => {
    const c = makeStatusController({
      snapshotRow: {
        seasonKey: 'season_2026_s1',
        finalizedAt: new Date('2026-04-27T00:15:00Z'),
      },
      champRow: {
        seasonKey: 'season_2026_s1',
        grantedAt: new Date('2026-04-27T00:16:00Z'),
      },
      mvpRow: {
        seasonKey: 'season_2026_s1',
        grantedAt: new Date('2026-04-27T00:17:00Z'),
      },
    });
    const r = await c.sectSeasonCronStatus();
    expect(r.data.lastSnapshot).toEqual({
      seasonKey: 'season_2026_s1',
      finalizedAt: '2026-04-27T00:15:00.000Z',
    });
    expect(r.data.lastChampionGrant).toEqual({
      seasonKey: 'season_2026_s1',
      grantedAt: '2026-04-27T00:16:00.000Z',
    });
    expect(r.data.lastMvpGrant).toEqual({
      seasonKey: 'season_2026_s1',
      grantedAt: '2026-04-27T00:17:00.000Z',
    });
  });
});

/**
 * Phase 15.8 — cron health computation. Uses `LiveOpsCronRunLog` rows
 * (mocked via cronRunLogs) + shared `computeLiveOpsCronHealth` helper.
 * Status thresholds: territory ≥ 8 days = STALE, sect-season ≥ 2 days.
 */
describe('Phase 15.8 — territoryCronStatus.health', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.TERRITORY_CRON_ENABLED = 'true';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  it('OK khi recent success', async () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const c = makeStatusController({
      cronRunLogs: {
        territory: [
          { startedAt: recent, finishedAt: recent, success: true },
        ],
      },
    });
    const r = await c.territoryCronStatus();
    expect(r.data.health.status).toBe('OK');
    expect(r.data.health.staleReason).toBeNull();
    expect(r.data.health.lastSuccessAt).toBe(recent.toISOString());
    expect(r.data.health.lastErrorAt).toBeNull();
  });

  it('STALE khi success quá 8 ngày', async () => {
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const c = makeStatusController({
      cronRunLogs: {
        territory: [{ startedAt: old, finishedAt: old, success: true }],
      },
    });
    const r = await c.territoryCronStatus();
    expect(r.data.health.status).toBe('STALE');
    expect(r.data.health.staleReason).toMatch(/no successful run/i);
  });

  it('DEGRADED khi error mới hơn success', async () => {
    const oldOk = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recentErr = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const c = makeStatusController({
      cronRunLogs: {
        territory: [
          { startedAt: oldOk, finishedAt: oldOk, success: true },
          { startedAt: recentErr, finishedAt: recentErr, success: false },
        ],
      },
    });
    const r = await c.territoryCronStatus();
    expect(r.data.health.status).toBe('DEGRADED');
    expect(r.data.health.lastErrorAt).toBe(recentErr.toISOString());
  });

  it('STALE khi chưa từng run + cron enabled', async () => {
    const c = makeStatusController({});
    const r = await c.territoryCronStatus();
    expect(r.data.enabled).toBe(true);
    expect(r.data.health.status).toBe('STALE');
    expect(r.data.health.staleReason).toMatch(/never recorded/i);
  });

  it('DISABLED khi cron disabled (không báo STALE)', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'false';
    const c = makeStatusController({});
    const r = await c.territoryCronStatus();
    expect(r.data.enabled).toBe(false);
    expect(r.data.health.status).toBe('DISABLED');
  });
});

describe('Phase 15.8 — sectSeasonCronStatus.health', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.SECT_SEASON_CRON_ENABLED = 'true';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  it('OK khi recent success daily cron (<2 ngày)', async () => {
    const recent = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12h ago
    const c = makeStatusController({
      cronRunLogs: {
        'sect-season': [
          { startedAt: recent, finishedAt: recent, success: true },
        ],
      },
    });
    const r = await c.sectSeasonCronStatus();
    expect(r.data.health.status).toBe('OK');
  });

  it('STALE khi sect-season success quá 2 ngày', async () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const c = makeStatusController({
      cronRunLogs: {
        'sect-season': [
          { startedAt: old, finishedAt: old, success: true },
        ],
      },
    });
    const r = await c.sectSeasonCronStatus();
    expect(r.data.health.status).toBe('STALE');
  });
});

/**
 * Phase 15.8 — Composite cron health overview endpoint. Trả về snapshot
 * health của territory + sect-season + weekly trong 1 request. Worst
 * status được tính bằng `pickWorstCronHealthStatus`.
 */
describe('Phase 15.8 — cronHealthOverview', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('shape: trả 3 cron entries + worstStatus + checkedAt ISO', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'true';
    process.env.SECT_SEASON_CRON_ENABLED = 'true';
    const c = makeStatusController({});
    const r = await c.cronHealthOverview();
    expect(r.ok).toBe(true);
    expect(typeof r.data.checkedAt).toBe('string');
    expect(r.data.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.data.crons.map((x) => x.cronKey).sort()).toEqual(
      ['sect-season', 'territory', 'weekly'].sort(),
    );
    expect(['OK', 'STALE', 'DEGRADED', 'DISABLED']).toContain(
      r.data.worstStatus,
    );
    for (const entry of r.data.crons) {
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.cron).toBe('string');
      expect(typeof entry.timezone).toBe('string');
      expect(typeof entry.maxSilenceMs).toBe('number');
      expect(entry.maxSilenceMs).toBeGreaterThan(0);
    }
  });

  it('worstStatus DEGRADED khi 1 cron DEGRADED + còn lại OK', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'true';
    process.env.SECT_SEASON_CRON_ENABLED = 'true';
    const recentOk = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentErr = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const oldOk = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const c = makeStatusController({
      cronRunLogs: {
        territory: [
          { startedAt: recentOk, finishedAt: recentOk, success: true },
        ],
        'sect-season': [
          { startedAt: oldOk, finishedAt: oldOk, success: true },
          {
            startedAt: recentErr,
            finishedAt: recentErr,
            success: false,
          },
        ],
        weekly: [
          { startedAt: recentOk, finishedAt: recentOk, success: true },
        ],
      },
    });
    const r = await c.cronHealthOverview();
    expect(r.data.worstStatus).toBe('DEGRADED');
    const sectEntry = r.data.crons.find(
      (x) => x.cronKey === 'sect-season',
    );
    expect(sectEntry?.status).toBe('DEGRADED');
  });

  it('worstStatus DISABLED khi tất cả disabled', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'false';
    process.env.SECT_SEASON_CRON_ENABLED = 'false';
    const c = makeStatusController({});
    const r = await c.cronHealthOverview();
    expect(r.data.worstStatus).toBe('DISABLED');
    for (const entry of r.data.crons) {
      expect(entry.enabled).toBe(false);
      expect(entry.status).toBe('DISABLED');
    }
  });

  it('worstStatus STALE khi enabled nhưng chưa từng run', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'true';
    process.env.SECT_SEASON_CRON_ENABLED = 'true';
    const c = makeStatusController({});
    const r = await c.cronHealthOverview();
    // Enabled crons + chưa có run log nào → STALE; weekly chia sẻ
    // territory enable.
    expect(['STALE']).toContain(r.data.worstStatus);
  });

  it('weekly entry dùng WEEKLY_CRON_MAX_SILENCE_MS = 8 ngày', async () => {
    process.env.TERRITORY_CRON_ENABLED = 'true';
    const c = makeStatusController({});
    const r = await c.cronHealthOverview();
    const weekly = r.data.crons.find((x) => x.cronKey === 'weekly');
    expect(weekly).toBeTruthy();
    expect(weekly!.maxSilenceMs).toBe(8 * 24 * 60 * 60 * 1000);
  });
});
