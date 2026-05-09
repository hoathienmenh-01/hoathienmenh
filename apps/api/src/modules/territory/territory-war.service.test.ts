/**
 * Phase 14.0.D — TerritoryWarService integration tests.
 *
 * Cover:
 *  - getCurrentTerritoryWarState: empty DB → 9 region với standings rỗng,
 *    contested=false, period window deterministic.
 *  - getCurrentTerritoryWarState: 2 sect cùng region → top sort DESC điểm
 *    + tie-break ASC sectId.
 *  - getRegionWarStatus: invalid regionKey → REGION_INVALID.
 *  - getRegionWarStatus: trả top10 + recent settlements + owner snapshot.
 *  - getWarHistory: trả entries DESC settledAt, group theo periodKey.
 *  - settleCurrentPeriod: idempotent (call 2 lần → snapshot id giữ nguyên).
 *  - settleCurrentPeriod: region không có influence → liệt kê trong
 *    `skippedRegions[]`, owners không đổi.
 *  - settleCurrentPeriod: settledBy được lưu vào snapshot row.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  MAP_REGIONS,
  REGION_KEYS,
  currentTerritoryPeriodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError, TerritoryService } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';
import { TerritoryWarService } from './territory-war.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let territory: TerritoryService;
let settlement: TerritorySettlementService;
let war: TerritoryWarService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  settlement = new TerritorySettlementService(prisma);
  territory = new TerritoryService(prisma, settlement);
  war = new TerritoryWarService(prisma, settlement);
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

describe('TerritoryWarService.getCurrentTerritoryWarState', () => {
  it('empty DB → 9 region với standings rỗng, contested=false', async () => {
    const state = await war.getCurrentTerritoryWarState();
    expect(state.regions).toHaveLength(MAP_REGIONS.length);
    for (const r of state.regions) {
      expect(r.topStandings).toEqual([]);
      expect(r.contested).toBe(false);
      expect(r.totalPoints).toBe(0);
      expect(r.leaderSectId).toBeNull();
      expect(r.currentOwnerSectId).toBeNull();
    }
    // periodKey hợp lệ + window deterministic.
    expect(state.periodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(state.previousPeriodKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof state.startsAt).toBe('string');
    expect(typeof state.endsAt).toBe('string');
    expect(state.timeRemainingMs).toBeGreaterThanOrEqual(0);
    // Region order ASC theo sortOrder.
    const sortOrders = state.regions.map((r) => r.sortOrder);
    const sorted = [...sortOrders].sort((a, b) => a - b);
    expect(sortOrders).toEqual(sorted);
  });

  it('2 sect cùng region → standings sort DESC points, ASC sectId tie-break', async () => {
    const sectA = await makeSect('A-' + nextSuffix());
    const sectB = await makeSect('B-' + nextSuffix());
    // Same points → tie-break ASC sectId.
    await seedInfluence(sectA.id, 'son_coc', 1);
    await seedInfluence(sectB.id, 'son_coc', 1);

    const state = await war.getCurrentTerritoryWarState();
    const son = state.regions.find((r) => r.regionKey === 'son_coc')!;
    expect(son.topStandings.length).toBe(2);
    expect(son.contested).toBe(true);
    const sortedIds = [sectA.id, sectB.id].sort((a, b) => a.localeCompare(b));
    expect(son.topStandings[0].sectId).toBe(sortedIds[0]);
    expect(son.topStandings[1].sectId).toBe(sortedIds[1]);
    expect(son.topStandings[0].rank).toBe(1);
    expect(son.topStandings[0].isLeader).toBe(true);
    expect(son.topStandings[1].isLeader).toBe(false);
    expect(son.leadMargin).toBe(0);
  });

  it('points DESC quyết định leader, lead margin = pts1 - pts2', async () => {
    const sectHi = await makeSect('Hi-' + nextSuffix());
    const sectLo = await makeSect('Lo-' + nextSuffix());
    await seedInfluence(sectHi.id, 'son_coc', 3);
    await seedInfluence(sectLo.id, 'son_coc', 1);

    const state = await war.getCurrentTerritoryWarState();
    const son = state.regions.find((r) => r.regionKey === 'son_coc')!;
    expect(son.topStandings[0].sectId).toBe(sectHi.id);
    expect(son.topStandings[1].sectId).toBe(sectLo.id);
    expect(son.topStandings[0].points).toBeGreaterThan(
      son.topStandings[1].points,
    );
    expect(son.leadMargin).toBe(
      son.topStandings[0].points - son.topStandings[1].points,
    );
  });

  it('region đã settle → currentOwnerSectId được expose', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);
    await settlement.settleRegion('son_coc', '2026-W22', {
      settledBy: 'admin1',
    });

    const state = await war.getCurrentTerritoryWarState();
    const son = state.regions.find((r) => r.regionKey === 'son_coc')!;
    expect(son.currentOwnerSectId).toBe(sect.id);
    expect(son.currentOwnerSectName).toBe(sect.name);
    expect(son.currentOwnerPeriodKey).toBe('2026-W22');
  });
});

describe('TerritoryWarService.getRegionWarStatus', () => {
  it('regionKey invalid → throw REGION_INVALID', async () => {
    await expect(
      war.getRegionWarStatus('not_a_region'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('region rỗng → standings empty + recentSettlements empty', async () => {
    const status = await war.getRegionWarStatus('son_coc');
    expect(status.regionKey).toBe('son_coc');
    expect(status.standings).toEqual([]);
    expect(status.contested).toBe(false);
    expect(status.recentSettlements).toEqual([]);
    expect(status.currentOwnerSectId).toBeNull();
  });

  it('region có influence → top10 + owner snapshot khi đã settle', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 2);
    await settlement.settleRegion('son_coc', '2026-W22', {
      settledBy: 'admin1',
    });

    const status = await war.getRegionWarStatus('son_coc');
    expect(status.standings.length).toBeGreaterThan(0);
    expect(status.standings[0].sectId).toBe(sect.id);
    expect(status.standings[0].sectName).toBe(sect.name);
    expect(status.standings[0].rank).toBe(1);
    expect(status.standings[0].isLeader).toBe(true);
    expect(status.recentSettlements.length).toBe(1);
    expect(status.recentSettlements[0].periodKey).toBe('2026-W22');
    expect(status.currentOwnerSectId).toBe(sect.id);
  });
});

describe('TerritoryWarService.getWarHistory', () => {
  it('chưa có settlement → entries empty', async () => {
    const h = await war.getWarHistory();
    expect(h.entries).toEqual([]);
  });

  it('settle 2 period → entries DESC settledAt, mỗi period 1 entry', async () => {
    const sectA = await makeSect();
    await seedInfluence(sectA.id, 'son_coc', 2);
    await settlement.settleRegion('son_coc', '2026-W22');

    const sectB = await makeSect();
    await seedInfluence(sectB.id, 'kim_son_mach', 1);
    await settlement.settleRegion('kim_son_mach', '2026-W23');

    const h = await war.getWarHistory();
    expect(h.entries.length).toBe(2);
    // DESC theo settledAt → W23 đến trước W22.
    expect(h.entries[0].periodKey).toBe('2026-W23');
    expect(h.entries[1].periodKey).toBe('2026-W22');
    expect(h.entries[0].snapshots.length).toBe(1);
    expect(h.entries[0].snapshots[0].regionKey).toBe('kim_son_mach');
    expect(h.entries[1].snapshots[0].regionKey).toBe('son_coc');
  });

  it('limit cap về HISTORY_MAX (32) khi truyền giá trị quá lớn', async () => {
    const h = await war.getWarHistory(9999);
    expect(h.entries).toEqual([]);
  });
});

describe('TerritoryWarService.settleCurrentPeriod', () => {
  it('region rỗng → skipped, owner không đổi', async () => {
    const res = await war.settleCurrentPeriod({ settledBy: 'admin1' });
    expect(res.snapshots).toEqual([]);
    expect(res.skippedRegions.length).toBe(MAP_REGIONS.length);
    expect(res.ownersAfter.length).toBe(REGION_KEYS.length);
    for (const o of res.ownersAfter) {
      expect(o.ownerSectId).toBeNull();
    }
  });

  it('có influence → ghi snapshot + ownersAfter có chủ', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    const res = await war.settleCurrentPeriod({ settledBy: 'admin1' });
    expect(res.snapshots.length).toBe(1);
    expect(res.snapshots[0].regionKey).toBe('son_coc');
    expect(res.snapshots[0].winnerSectId).toBe(sect.id);
    expect(res.snapshots[0].settledBy).toBe('admin1');
    expect(res.skippedRegions.length).toBe(MAP_REGIONS.length - 1);
    const owner = res.ownersAfter.find((o) => o.regionKey === 'son_coc')!;
    expect(owner.ownerSectId).toBe(sect.id);
    expect(owner.periodKey).toBe(currentTerritoryPeriodKey());
  });

  it('idempotent: gọi 2 lần → cùng snapshot id, không double-insert', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);

    const a = await war.settleCurrentPeriod();
    const b = await war.settleCurrentPeriod();
    expect(a.snapshots.length).toBe(1);
    expect(b.snapshots.length).toBe(1);
    expect(a.snapshots[0].id).toBe(b.snapshots[0].id);

    const allSnaps = await prisma.sectTerritorySettlementSnapshot.findMany({
      where: { regionKey: 'son_coc' },
    });
    expect(allSnaps).toHaveLength(1);
  });

  it('settledBy null khi caller không truyền', async () => {
    const sect = await makeSect();
    await seedInfluence(sect.id, 'son_coc', 1);
    const res = await war.settleCurrentPeriod();
    expect(res.snapshots[0].settledBy).toBeNull();
  });
});
