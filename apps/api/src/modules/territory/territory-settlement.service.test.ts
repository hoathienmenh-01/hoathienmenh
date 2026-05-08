/**
 * Phase 14.0.B — TerritorySettlementService integration tests.
 *
 * Cover:
 *  - settleRegion: success path (winner + runner-up + region state upsert)
 *  - settleRegion: idempotent (gọi lần 2 cùng periodKey không insert thêm)
 *  - settleRegion: skip empty region (region không có influence → no snapshot,
 *    no region state)
 *  - settleRegion: tie-break deterministic (cùng điểm → sectId.localeCompare ASC)
 *  - settleRegion: invalid regionKey / periodKey → throw TerritoryError
 *  - settleAllRegions: settle 9 region tuần tự, idempotent
 *  - getRegionHistory: trả current owner + N snapshot DESC theo settledAt
 *  - getOwnerStateMap: O(1) map lookup, region chưa settle không có entry
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { MAP_REGIONS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError, TerritoryService } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let territory: TerritoryService;
let settlement: TerritorySettlementService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  settlement = new TerritorySettlementService(prisma);
  territory = new TerritoryService(prisma, settlement);
});

beforeEach(async () => {
  await wipeAll(prisma);
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

async function seedInfluence(
  sectId: string,
  regionKey: string,
  count: number,
) {
  const u = await makeUserChar(prisma, { sectId });
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      await territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey,
        sourceKey: 'dungeon_clear',
        sourceId: `dr-${sectId}-${i}-${nextSuffix()}`,
      });
    }
  });
}

describe('TerritorySettlementService.settleRegion', () => {
  it('region rỗng → skipped=true, không ghi snapshot/region state', async () => {
    const res = await settlement.settleRegion('son_coc', '2026-W23');
    expect(res.skipped).toBe(true);
    expect(res.snapshot).toBeNull();
    const snaps = await prisma.sectTerritorySettlementSnapshot.findMany({});
    expect(snaps).toHaveLength(0);
    const states = await prisma.sectTerritoryRegionState.findMany({});
    expect(states).toHaveLength(0);
  });

  it('có influence → ghi snapshot + upsert region state với winner', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 2);

    const res = await settlement.settleRegion('son_coc', '2026-W23', {
      settledBy: 'admin1',
    });
    expect(res.skipped).toBe(false);
    expect(res.snapshot).not.toBeNull();
    expect(res.snapshot!.winnerSectId).toBe(sect.id);
    expect(res.snapshot!.winnerSectName).toBe(sect.name);
    expect(res.snapshot!.winnerPoints).toBeGreaterThan(0);
    expect(res.snapshot!.runnerUpSectId).toBeNull();
    expect(res.snapshot!.totalSects).toBe(1);
    expect(res.snapshot!.settledBy).toBe('admin1');

    const state = await prisma.sectTerritoryRegionState.findUnique({
      where: { regionKey: 'son_coc' },
    });
    expect(state).not.toBeNull();
    expect(state!.ownerSectId).toBe(sect.id);
    expect(state!.ownerSectName).toBe(sect.name);
    expect(state!.periodKey).toBe('2026-W23');
  });

  it('idempotent: gọi 2 lần cùng periodKey → chỉ 1 snapshot, return cùng row', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    const a = await settlement.settleRegion('son_coc', '2026-W23');
    const b = await settlement.settleRegion('son_coc', '2026-W23');
    expect(a.snapshot).not.toBeNull();
    expect(b.snapshot).not.toBeNull();
    expect(a.snapshot!.id).toBe(b.snapshot!.id);

    const snaps = await prisma.sectTerritorySettlementSnapshot.findMany({
      where: { regionKey: 'son_coc' },
    });
    expect(snaps).toHaveLength(1);
  });

  it('idempotent: kể cả khi influence tăng giữa 2 call cùng periodKey → snapshot lần 1 giữ nguyên', async () => {
    const sectA = await makeSect('A-' + nextSuffix());
    await seedInfluence(sectA.id, 'son_coc', 1);

    const a = await settlement.settleRegion('son_coc', '2026-W23');
    expect(a.snapshot!.winnerSectId).toBe(sectA.id);
    const aPts = a.snapshot!.winnerPoints;

    // Sau khi settle, sectB ghi nhiều điểm hơn — nhưng cùng periodKey → snapshot
    // KHÔNG đổi (idempotent qua UNIQUE).
    const sectB = await makeSect('B-' + nextSuffix());
    await seedInfluence(sectB.id, 'son_coc', 5);

    const b = await settlement.settleRegion('son_coc', '2026-W23');
    expect(b.snapshot!.id).toBe(a.snapshot!.id);
    expect(b.snapshot!.winnerSectId).toBe(sectA.id);
    expect(b.snapshot!.winnerPoints).toBe(aPts);
  });

  it('tie-break deterministic: 2 sect cùng điểm → sectId.localeCompare ASC thắng', async () => {
    // Tạo 2 sect với name có hậu tố determined để sectId khác nhau.
    // Insert sectZ trước (id ngẫu nhiên), sau đó sectA — nhưng id sinh bởi
    // cuid/uuid → so sánh string.localeCompare. Mình settle, rồi assert
    // winner = id nhỏ nhất theo localeCompare.
    const sect1 = await makeSect('S1-' + nextSuffix());
    const sect2 = await makeSect('S2-' + nextSuffix());

    await seedInfluence(sect1.id, 'son_coc', 1);
    await seedInfluence(sect2.id, 'son_coc', 1);

    const res = await settlement.settleRegion('son_coc', '2026-W23');
    expect(res.snapshot!.winnerSectId).toBe(
      [sect1.id, sect2.id].sort((a, b) => a.localeCompare(b))[0],
    );
    expect(res.snapshot!.runnerUpSectId).toBe(
      [sect1.id, sect2.id].sort((a, b) => a.localeCompare(b))[1],
    );
    expect(res.snapshot!.winnerPoints).toBe(res.snapshot!.runnerUpPoints);
  });

  it('điểm cao thắng, runner-up theo điểm (không tie-break)', async () => {
    const sectHi = await makeSect('Hi-' + nextSuffix());
    const sectLo = await makeSect('Lo-' + nextSuffix());
    await seedInfluence(sectHi.id, 'son_coc', 3);
    await seedInfluence(sectLo.id, 'son_coc', 1);

    const res = await settlement.settleRegion('son_coc', '2026-W23');
    expect(res.snapshot!.winnerSectId).toBe(sectHi.id);
    expect(res.snapshot!.runnerUpSectId).toBe(sectLo.id);
    expect(res.snapshot!.winnerPoints).toBeGreaterThan(res.snapshot!.runnerUpPoints);
  });

  it('regionKey invalid → throw TerritoryError(REGION_INVALID)', async () => {
    await expect(
      settlement.settleRegion('not_a_region', '2026-W23'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('periodKey invalid → throw TerritoryError(PERIOD_INVALID)', async () => {
    await expect(
      settlement.settleRegion('son_coc', 'bad-period'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('manual_xx period → ok (admin override)', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    const res = await settlement.settleRegion('son_coc', 'manual_test_001');
    expect(res.skipped).toBe(false);
    expect(res.snapshot!.periodKey).toBe('manual_test_001');
  });

  it('settle 2 period khác nhau → 2 snapshot, region state cập nhật theo lần sau', async () => {
    const sectA = await makeSect();
    await seedInfluence(sectA.id, 'son_coc', 2);

    const w22 = await settlement.settleRegion('son_coc', '2026-W22');
    expect(w22.snapshot!.periodKey).toBe('2026-W22');

    const sectB = await makeSect();
    await seedInfluence(sectB.id, 'son_coc', 5);
    const w23 = await settlement.settleRegion('son_coc', '2026-W23');
    expect(w23.snapshot!.periodKey).toBe('2026-W23');
    expect(w23.snapshot!.winnerSectId).toBe(sectB.id);

    const snaps = await prisma.sectTerritorySettlementSnapshot.findMany({
      where: { regionKey: 'son_coc' },
    });
    expect(snaps).toHaveLength(2);

    const state = await prisma.sectTerritoryRegionState.findUnique({
      where: { regionKey: 'son_coc' },
    });
    expect(state!.ownerSectId).toBe(sectB.id);
    expect(state!.periodKey).toBe('2026-W23');
  });
});

describe('TerritorySettlementService.settleAllRegions', () => {
  it('settle mọi region — region rỗng được liệt kê trong skippedRegions', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    const run = await settlement.settleAllRegions('2026-W23');
    expect(run.periodKey).toBe('2026-W23');
    expect(run.snapshots).toHaveLength(1);
    expect(run.snapshots[0].regionKey).toBe('son_coc');
    expect(run.skippedRegions.length).toBe(MAP_REGIONS.length - 1);
    // Mọi region khác son_coc đều phải có trong skipped.
    for (const r of MAP_REGIONS) {
      if (r.key === 'son_coc') continue;
      expect(run.skippedRegions).toContain(r.key);
    }
  });

  it('idempotent: gọi 2 lần cùng periodKey → chỉ 1 snapshot per region', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    await settlement.settleAllRegions('2026-W23');
    await settlement.settleAllRegions('2026-W23');

    const snaps = await prisma.sectTerritorySettlementSnapshot.findMany({});
    expect(snaps).toHaveLength(1);
  });

  it('periodKey invalid → throw TerritoryError(PERIOD_INVALID)', async () => {
    await expect(
      settlement.settleAllRegions('not-iso-week'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });
});

describe('TerritorySettlementService.getRegionHistory', () => {
  it('regionKey invalid → throw REGION_INVALID', async () => {
    await expect(
      settlement.getRegionHistory('not_a_region'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('region chưa từng settle → snapshots rỗng + currentOwner null', async () => {
    const h = await settlement.getRegionHistory('son_coc');
    expect(h.regionKey).toBe('son_coc');
    expect(h.snapshots).toHaveLength(0);
    expect(h.currentOwnerSectId).toBeNull();
    expect(h.currentOwnerSectName).toBeNull();
    expect(h.currentPeriodKey).toBeNull();
  });

  it('settle 2 period → snapshots desc theo settledAt + currentOwner = lần cuối', async () => {
    const sectA = await makeSect();
    await seedInfluence(sectA.id, 'son_coc', 2);
    await settlement.settleRegion('son_coc', '2026-W22');

    const sectB = await makeSect();
    await seedInfluence(sectB.id, 'son_coc', 5);
    await settlement.settleRegion('son_coc', '2026-W23');

    const h = await settlement.getRegionHistory('son_coc');
    expect(h.snapshots).toHaveLength(2);
    // DESC theo settledAt — W23 đến trước W22.
    expect(h.snapshots[0].periodKey).toBe('2026-W23');
    expect(h.snapshots[1].periodKey).toBe('2026-W22');
    expect(h.currentOwnerSectId).toBe(sectB.id);
    expect(h.currentPeriodKey).toBe('2026-W23');
  });

  it('limit clamp về 100 max', async () => {
    const h = await settlement.getRegionHistory('son_coc', 9999);
    // Chỉ smoke — empty region nhưng limit không throw.
    expect(h.snapshots).toHaveLength(0);
  });
});

describe('TerritorySettlementService.getOwnerStateMap', () => {
  it('chưa settle gì → map empty', async () => {
    const m = await settlement.getOwnerStateMap();
    expect(m.size).toBe(0);
  });

  it('settle 1 region → chỉ region đó có entry', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);
    await settlement.settleRegion('son_coc', '2026-W23');

    const m = await settlement.getOwnerStateMap();
    expect(m.size).toBe(1);
    expect(m.get('son_coc')?.ownerSectId).toBe(sect.id);
    expect(m.get('kim_son_mach')).toBeUndefined();
  });
});

describe('TerritoryService.getRegions — Phase 14.0.B owner enrichment', () => {
  it('region chưa settle → ownerSect* = null', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);
    const view = await territory.getRegions();
    const r = view.regions.find((x) => x.regionKey === 'son_coc')!;
    expect(r.ownerSectId).toBeNull();
    expect(r.ownerSectName).toBeNull();
    expect(r.ownerPeriodKey).toBeNull();
    expect(r.ownerSettledAt).toBeNull();
  });

  it('region đã settle → ownerSect* khớp snapshot', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);
    await settlement.settleRegion('son_coc', '2026-W23');

    const view = await territory.getRegions();
    const r = view.regions.find((x) => x.regionKey === 'son_coc')!;
    expect(r.ownerSectId).toBe(sect.id);
    expect(r.ownerSectName).toBe(sect.name);
    expect(r.ownerPeriodKey).toBe('2026-W23');
    expect(typeof r.ownerSettledAt).toBe('string');
  });
});
