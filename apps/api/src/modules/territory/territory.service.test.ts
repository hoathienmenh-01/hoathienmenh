/**
 * Phase 14.0.A — TerritoryService integration tests.
 *
 * Cover: addInfluenceTx idempotency / cap / no-sect / invalid region;
 * getRegions parity 9 region; getRegionLeaderboard ordering; getMyTerritory
 * personal view; daily/weekly cap rolling window.
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
import { TerritoryService, TerritoryError } from './territory.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let territory: TerritoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  territory = new TerritoryService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(prisma: PrismaService, leaderId: string | null = null) {
  return prisma.sect.create({
    data: {
      name: `S-${nextSuffix()}`,
      description: 'Test sect',
      leaderId,
    },
  });
}

describe('TerritoryService.addInfluenceTx', () => {
  it('character không có sect → no-op (return null, không insert row)', async () => {
    const u = await makeUserChar(prisma);
    const res = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      }),
    );
    expect(res).toBeNull();
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('character có sect → ghi 1 row influence với điểm + sect snapshot', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const res = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'kim_son_mach',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.regionKey).toBe('kim_son_mach');
    expect(res!.sectId).toBe(sect.id);
    expect(res!.points).toBeGreaterThan(0);

    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].regionKey).toBe('kim_son_mach');
    expect(rows[0].sourceKey).toBe('dungeon_clear');
    expect(rows[0].sourceId).toBe('dr-1');
    expect(rows[0].sectId).toBe(sect.id);
  });

  it('idempotency: cùng region + sourceKey + sourceId 2 lần → chỉ 1 row, lần 2 trả null', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const a = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'kim_son_mach',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-x',
      }),
    );
    const b = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'kim_son_mach',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-x',
      }),
    );
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(1);
  });

  it('region key không hợp lệ → no-op (skip safely)', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const res = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'not_a_region',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      }),
    );
    expect(res).toBeNull();
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('source key không hợp lệ → no-op', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const res = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'son_coc',
        // Cast: server cố tình bảo vệ runtime nếu hook thượng nguồn truyền key sai.
        sourceKey: 'invalid_source' as unknown as 'dungeon_clear',
        sourceId: 'x',
      }),
    );
    expect(res).toBeNull();
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('cùng (region, source, sourceId) — character khác sect: tách row riêng', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA = await makeUserChar(prisma, { sectId: sectA.id });
    const uB = await makeUserChar(prisma, { sectId: sectB.id });
    await prisma.$transaction(async (tx) => {
      await territory.addInfluenceTx(tx, {
        characterId: uA.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await territory.addInfluenceTx(tx, {
        characterId: uB.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
    });
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(2);
  });

  it('daily cap reached → reject (return null), không thêm row', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    // dungeon_clear: points=8, dailyCap=60. Bơm 7 lần (56 pts) = sát cap.
    // Lần 8 (8 pts): 56 + 8 = 64 > 60 ⇒ reject. Không pass `now`: entries
    // có `createdAt = NOW()`, cap check cũng lấy `NOW()` ⇒ cùng day window.
    for (let i = 0; i < 7; i++) {
      const res = await prisma.$transaction((tx) =>
        territory.addInfluenceTx(tx, {
          characterId: u.characterId,
          regionKey: 'son_coc',
          sourceKey: 'dungeon_clear',
          sourceId: `dr-${i}`,
        }),
      );
      expect(res).not.toBeNull();
    }
    const rejected = await prisma.$transaction((tx) =>
      territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-7',
      }),
    );
    expect(rejected).toBeNull();
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows).toHaveLength(7);
  });
});

describe('TerritoryService.getRegions', () => {
  it('parity 9 region với MAP_REGIONS, totalPoints=0 khi chưa có influence', async () => {
    const view = await territory.getRegions();
    expect(view.regions).toHaveLength(MAP_REGIONS.length);
    for (const r of view.regions) {
      expect(r.totalPoints).toBe(0);
      expect(r.contributors).toBe(0);
      expect(r.topSectId).toBeNull();
      expect(r.topSectName).toBeNull();
    }
    // Order theo sortOrder ascending.
    for (let i = 1; i < view.regions.length; i++) {
      expect(view.regions[i - 1].sortOrder).toBeLessThanOrEqual(
        view.regions[i].sortOrder,
      );
    }
  });

  it('aggregate per region: totalPoints + contributors + topSect', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA1 = await makeUserChar(prisma, { sectId: sectA.id });
    const uA2 = await makeUserChar(prisma, { sectId: sectA.id });
    const uB1 = await makeUserChar(prisma, { sectId: sectB.id });

    await prisma.$transaction(async (tx) => {
      await territory.addInfluenceTx(tx, {
        characterId: uA1.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await territory.addInfluenceTx(tx, {
        characterId: uA2.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-2',
      });
      await territory.addInfluenceTx(tx, {
        characterId: uB1.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-3',
      });
    });

    const view = await territory.getRegions();
    const sonCoc = view.regions.find((r) => r.regionKey === 'son_coc');
    expect(sonCoc).toBeDefined();
    expect(sonCoc!.totalPoints).toBeGreaterThan(0);
    expect(sonCoc!.contributors).toBe(3);
    // SectA có 2 contribs > SectB 1 ⇒ topSect = sectA.
    expect(sonCoc!.topSectId).toBe(sectA.id);
    expect(sonCoc!.topSectName).toBe(sectA.name);
    expect(sonCoc!.topSectPoints).toBeGreaterThan(0);
  });
});

describe('TerritoryService.getRegionLeaderboard', () => {
  it('region key không hợp lệ → throw REGION_INVALID', async () => {
    await expect(
      territory.getRegionLeaderboard('not_a_region'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('region không có influence → rows rỗng', async () => {
    const lb = await territory.getRegionLeaderboard('son_coc');
    expect(lb.regionKey).toBe('son_coc');
    expect(lb.rows).toHaveLength(0);
  });

  it('aggregate theo sectId, descending điểm, tie-break sectId asc', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA1 = await makeUserChar(prisma, { sectId: sectA.id });
    const uA2 = await makeUserChar(prisma, { sectId: sectA.id });
    const uB1 = await makeUserChar(prisma, { sectId: sectB.id });

    await prisma.$transaction(async (tx) => {
      // SectA: 2 dungeon_clear = 16 pts
      await territory.addInfluenceTx(tx, {
        characterId: uA1.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await territory.addInfluenceTx(tx, {
        characterId: uA2.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-2',
      });
      // SectB: 1 dungeon_clear = 8 pts
      await territory.addInfluenceTx(tx, {
        characterId: uB1.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-3',
      });
    });

    const lb = await territory.getRegionLeaderboard('son_coc');
    expect(lb.rows).toHaveLength(2);
    expect(lb.rows[0].sectId).toBe(sectA.id);
    expect(lb.rows[0].rank).toBe(1);
    expect(lb.rows[0].contributors).toBe(2);
    expect(lb.rows[1].sectId).toBe(sectB.id);
    expect(lb.rows[1].rank).toBe(2);
    expect(lb.rows[1].contributors).toBe(1);
  });

  it('region influence chỉ aggregate trong region đó (không bleed cross-region)', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await prisma.$transaction(async (tx) => {
      await territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await territory.addInfluenceTx(tx, {
        characterId: u.characterId,
        regionKey: 'kim_son_mach',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-2',
      });
    });
    const lbSonCoc = await territory.getRegionLeaderboard('son_coc');
    const lbKimSon = await territory.getRegionLeaderboard('kim_son_mach');
    expect(lbSonCoc.rows).toHaveLength(1);
    expect(lbKimSon.rows).toHaveLength(1);
    expect(lbSonCoc.rows[0].sectId).toBe(sect.id);
    expect(lbKimSon.rows[0].sectId).toBe(sect.id);
  });
});

describe('TerritoryService.getMyTerritory', () => {
  it('không có character → throw NO_CHARACTER', async () => {
    await expect(
      territory.getMyTerritory('non-existent-user-id'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('character không có sect → hasSect=false, regions list đầy đủ với sectPoints=0', async () => {
    const u = await makeUserChar(prisma);
    const view = await territory.getMyTerritory(u.userId);
    expect(view.hasSect).toBe(false);
    expect(view.sectId).toBeNull();
    expect(view.sectName).toBeNull();
    expect(view.regions).toHaveLength(MAP_REGIONS.length);
    for (const r of view.regions) {
      expect(r.sectPoints).toBe(0);
      expect(r.sectRank).toBeNull();
      expect(r.personalPoints).toBe(0);
    }
  });

  it('character có sect + contribute → rank + points correct cho region đó', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA = await makeUserChar(prisma, { sectId: sectA.id });
    const uB = await makeUserChar(prisma, { sectId: sectB.id });

    await prisma.$transaction(async (tx) => {
      // SectA contrib son_coc 16pts (2 dungeon)
      await territory.addInfluenceTx(tx, {
        characterId: uA.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await territory.addInfluenceTx(tx, {
        characterId: uA.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-2',
      });
      // SectB contrib son_coc 8pts (1 dungeon) → rank 2
      await territory.addInfluenceTx(tx, {
        characterId: uB.characterId,
        regionKey: 'son_coc',
        sourceKey: 'dungeon_clear',
        sourceId: 'dr-3',
      });
    });

    const viewA = await territory.getMyTerritory(uA.userId);
    expect(viewA.hasSect).toBe(true);
    expect(viewA.sectId).toBe(sectA.id);
    const sonCocA = viewA.regions.find((r) => r.regionKey === 'son_coc');
    expect(sonCocA!.sectRank).toBe(1);
    expect(sonCocA!.sectPoints).toBeGreaterThan(0);
    expect(sonCocA!.personalPoints).toBeGreaterThan(0);

    const viewB = await territory.getMyTerritory(uB.userId);
    const sonCocB = viewB.regions.find((r) => r.regionKey === 'son_coc');
    expect(sonCocB!.sectRank).toBe(2);
  });
});
