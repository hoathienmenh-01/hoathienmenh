/**
 * Phase 13.2.D + 14.0.F — LiveOpsCronService integration tests.
 *
 * Cover:
 *   - runTerritoryCycle: settle previous period → decay → grant reward
 *     mail. Tất cả idempotent qua DB UNIQUE.
 *   - runTerritoryCycle gọi 2 lần KHÔNG double mail (skippedAlreadyGranted).
 *   - runTerritoryCycle song song (Promise.all) chỉ tạo 1 settlement
 *     snapshot per region (DB UNIQUE guard P2002).
 *   - runSectSeasonCycle snapshot mọi season ended; idempotent qua
 *     UNIQUE seasonKey.
 *   - runWeeklyCycle = territory + sectSeason combo, summary đầy đủ.
 *   - bypassLease=true cho phép admin force-run ngay cả khi lease bận.
 *
 * Race-safety: dùng `LiveOpsCronLease` no-op (Redis null) — DB unique
 * guard mới là final barrier.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { previousTerritoryPeriodKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritorySettlementService } from '../territory/territory-settlement.service';
import { TerritoryDecayService } from '../territory/territory-decay.service';
import { TerritoryRewardService } from '../territory/territory-reward.service';
import { SectSeasonHistoryService } from '../sect-season/sect-season-history.service';
import { LiveOpsCronLease } from './liveops-cron.lease';
import { LiveOpsCronService } from './liveops-cron.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let cron: LiveOpsCronService;

const PERIOD = '2026-W19';
// Mốc nằm SAU S1 (S1 ends 2026-04-26 ICT) nhưng TRƯỚC S2 ends.
// → Chỉ S1 ended ở mốc này.
const AFTER_S1_ONLY = new Date('2026-04-27T00:00:00+07:00');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const settlement = new TerritorySettlementService(prisma);
  const decay = new TerritoryDecayService(prisma);
  const reward = new TerritoryRewardService(prisma);
  const seasonHistory = new SectSeasonHistoryService(prisma);
  // Lease no-op (Redis null) — DB UNIQUE guard mới là final barrier.
  const lease = new LiveOpsCronLease(null);
  cron = new LiveOpsCronService(
    prisma,
    settlement,
    decay,
    reward,
    seasonHistory,
    lease,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
  // Sect season snapshot tables không có FK → wipe explicit.
  await prisma.sectSeasonTopMember.deleteMany({});
  await prisma.sectSeasonSectRank.deleteMany({});
  await prisma.sectSeasonSnapshot.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(name?: string) {
  return prisma.sect.create({
    data: {
      name: name ?? `S-${nextSuffix()}`,
      description: 'Test sect',
    },
  });
}

async function settleRegionForSect(
  regionKey: string,
  periodKey: string,
  sect: { id: string; name: string },
) {
  return prisma.sectTerritorySettlementSnapshot.create({
    data: {
      regionKey,
      periodKey,
      winnerSectId: sect.id,
      winnerSectName: sect.name,
      winnerPoints: 100,
      runnerUpSectId: null,
      runnerUpSectName: null,
      runnerUpPoints: 0,
      totalSects: 1,
      totalPoints: 100,
      settledBy: null,
    },
  });
}

describe('LiveOpsCronService.runTerritoryCycle', () => {
  it('settle previous period → decay → grant reward mail trong 1 cycle', async () => {
    const sect = await makeSect();
    // Pre-seed snapshot 1 region để reward grant có winner.
    await settleRegionForSect('son_coc', PERIOD, sect);
    // Member để reward grant tạo mail.
    const m = await makeUserChar(prisma, { sectId: sect.id });

    const r = await cron.runTerritoryCycle({ periodKey: PERIOD });

    expect(r.periodKey).toBe(PERIOD);
    // son_coc đã có snapshot pre-seeded → settleRegion fast-path
    // return existing → counted vào snapshots[]. 8 region còn lại
    // không có influence → skipped.
    expect(r.territorySettled).toBe(1);
    expect(r.territorySkipped).toBeGreaterThan(0);

    // Decay first run KHÔNG skip (chưa có log) → decaySkipped=false.
    expect(r.territoryDecaySkipped).toBe(false);

    // Reward mail: 1 mail cho member của son_coc winner sect.
    expect(r.rewardMailsCreated).toBe(1);
    expect(r.rewardSkippedAlreadyGranted).toBe(0);
    expect(r.errors).toHaveLength(0);

    // Verify mail thực sự tồn tại
    const mails = await prisma.mail.findMany({
      where: { recipientId: m.characterId },
    });
    expect(mails).toHaveLength(1);

    // Verify decay log
    const decayLog = await prisma.sectTerritoryDecayLog.findUnique({
      where: { periodKey: PERIOD },
    });
    expect(decayLog).not.toBeNull();
  });

  it('idempotent: chạy 2 lần KHÔNG tạo mail trùng', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    const m = await makeUserChar(prisma, { sectId: sect.id });

    const r1 = await cron.runTerritoryCycle({ periodKey: PERIOD });
    expect(r1.rewardMailsCreated).toBe(1);

    const r2 = await cron.runTerritoryCycle({ periodKey: PERIOD });
    // Lần 2: reward mail đã grant → skipped.
    expect(r2.rewardMailsCreated).toBe(0);
    expect(r2.rewardSkippedAlreadyGranted).toBe(1);
    // Decay log đã tồn tại → skipped.
    expect(r2.territoryDecaySkipped).toBe(true);

    const mails = await prisma.mail.findMany({
      where: { recipientId: m.characterId },
    });
    // Vẫn chỉ 1 mail (idempotent).
    expect(mails).toHaveLength(1);
  });

  it('chạy song song KHÔNG double settlement (DB UNIQUE guard)', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    await makeUserChar(prisma, { sectId: sect.id });

    // 3 promise concurrent — chỉ 1 leader thực sự tạo mail mới, others
    // skip via P2002.
    const results = await Promise.all([
      cron.runTerritoryCycle({ periodKey: PERIOD }),
      cron.runTerritoryCycle({ periodKey: PERIOD }),
      cron.runTerritoryCycle({ periodKey: PERIOD }),
    ]);

    const totalMails = results.reduce((s, r) => s + r.rewardMailsCreated, 0);
    expect(totalMails).toBe(1);

    // Decay log: UNIQUE periodKey → chỉ 1 row.
    const decayLogs = await prisma.sectTerritoryDecayLog.findMany({
      where: { periodKey: PERIOD },
    });
    expect(decayLogs).toHaveLength(1);

    // Settlement snapshot: chỉ 1 row per region (UNIQUE).
    const snapshots = await prisma.sectTerritorySettlementSnapshot.findMany({
      where: { periodKey: PERIOD, regionKey: 'son_coc' },
    });
    expect(snapshots).toHaveLength(1);

    // Reward grant rows: 1 row per (period, region, character).
    const grants = await prisma.territoryOwnerRewardGrant.findMany({
      where: { periodKey: PERIOD, regionKey: 'son_coc' },
    });
    expect(grants).toHaveLength(1);
  });

  it('default periodKey = previousTerritoryPeriodKey()', async () => {
    const r = await cron.runTerritoryCycle();
    expect(r.periodKey).toBe(previousTerritoryPeriodKey());
  });
});

describe('LiveOpsCronService.runSectSeasonCycle', () => {
  it('snapshot mọi season đã ended idempotent', async () => {
    const r1 = await cron.runSectSeasonCycle({ now: AFTER_S1_ONLY });
    // S1 đã end ở mốc này → chỉ S1 được snapshot mới.
    expect(r1.seasonSnapshotsCreated).toBe(1);
    expect(r1.seasonSnapshotsSkipped).toBe(0);
    expect(r1.seasonsProcessed).toContain('season_2026_s1');

    // Lần 2: snapshot đã tồn tại → skipped.
    const r2 = await cron.runSectSeasonCycle({ now: AFTER_S1_ONLY });
    expect(r2.seasonSnapshotsCreated).toBe(0);
    expect(r2.seasonSnapshotsSkipped).toBe(1);

    const persisted = await prisma.sectSeasonSnapshot.findMany();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].seasonKey).toBe('season_2026_s1');
  });

  it('chưa season nào ended → snapshot 0', async () => {
    // Mốc TRƯỚC S1 startsAt (2026-03-29T17:00Z).
    const before = new Date('2025-01-01T00:00:00Z');
    const r = await cron.runSectSeasonCycle({ now: before });
    expect(r.seasonSnapshotsCreated).toBe(0);
    expect(r.seasonSnapshotsSkipped).toBe(0);
    expect(r.seasonsProcessed).toHaveLength(0);
  });
});

describe('LiveOpsCronService.runWeeklyCycle', () => {
  it('combo summary territory + sect season', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    await makeUserChar(prisma, { sectId: sect.id });

    const r = await cron.runWeeklyCycle({
      periodKey: PERIOD,
      now: AFTER_S1_ONLY,
      triggeredBy: 'admin1',
    });

    expect(r.skippedAlreadyDone).toBe(false);
    expect(r.triggeredBy).toBe('admin1');
    expect(r.territory.periodKey).toBe(PERIOD);
    expect(r.territory.rewardMailsCreated).toBe(1);
    expect(r.sectSeason.seasonSnapshotsCreated).toBe(1);
    expect(r.startedAt).toBeTruthy();
    expect(r.finishedAt).toBeTruthy();
  });

  it('bypassLease=true skip lease check (admin force-run)', async () => {
    const r = await cron.runWeeklyCycle({
      periodKey: PERIOD,
      now: AFTER_S1_ONLY,
      bypassLease: true,
      triggeredBy: 'admin1',
    });
    // Không có sect/winner → 0 mail nhưng vẫn complete OK.
    expect(r.skippedAlreadyDone).toBe(false);
    expect(r.territory.rewardMailsCreated).toBe(0);
  });
});
