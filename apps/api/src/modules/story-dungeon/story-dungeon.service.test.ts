/**
 * Phase 12.8.A Story Dungeon Catalog + API Foundation — integration tests.
 *
 * Coverage spec:
 *   1. catalog invariant         — `packages/shared/src/story-dungeons.test.ts`.
 *   2. listForUser baseline      — Phàm Nhân, KHÔNG quest accept → mọi entry locked.
 *   3. listForUser quest accepted — step progress đạt count → status=available.
 *   4. listForUser quest claimed  — status=cleared.
 *   5. listForUser realm gate    — Phàm Nhân không đủ minRealm Kim Đan → locked.
 *   6. getByKey returns single template view + status.
 *   7. getByKey throws DUNGEON_NOT_FOUND cho key không tồn tại / disabled.
 *   8. listForUser throws NO_CHARACTER nếu user chưa có character row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { StoryDungeonError, StoryDungeonService } from './story-dungeon.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let service: StoryDungeonService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new StoryDungeonService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const KEY_PHAMNHAN = 'story_dgn_phamnhan_back_mountain';
const KEY_LUYENKHI = 'story_dgn_luyenkhi_hac_lam_trial';
const KEY_KIM_DAN = 'story_dgn_kim_dan_kim_son_thien_lo';
const QUEST_PHAMNHAN_REALM = 'phamnhan_realm_01';
const QUEST_LUYENKHI = 'luyenkhi_main_01';

async function seedQuest(
  prisma: PrismaService,
  characterId: string,
  questKey: string,
  status: 'ACCEPTED' | 'COMPLETED' | 'CLAIMED',
  stepProgress: Record<string, number>,
): Promise<void> {
  await prisma.questProgress.create({
    data: {
      characterId,
      questKey,
      status,
      acceptedAt: new Date(),
      stepProgress: stepProgress as Prisma.InputJsonValue,
      completedAt: status === 'ACCEPTED' ? null : new Date(),
      claimedAt: status === 'CLAIMED' ? new Date() : null,
    },
  });
}

describe('StoryDungeonService.listForUser', () => {
  it('throws NO_CHARACTER nếu user chưa có character row', async () => {
    const user = await prisma.user.create({
      data: { email: 'no-char@xt.local', passwordHash: 'x' },
    });
    await expect(service.listForUser(user.id)).rejects.toThrow(
      new StoryDungeonError('NO_CHARACTER'),
    );
  });

  it('Phàm Nhân không có quest accepted → mọi entry status=locked', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await service.listForUser(userId);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const v of list) {
      expect(v.status, `${v.key}`).toBe('locked');
    }
  });

  it('quest accepted + step progress đạt count → status=available cho entry tương ứng', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // phamnhan_realm_01 step_01 (talk count=1).
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
      step_01: 1,
    });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_PHAMNHAN)!;
    expect(entry.status).toBe('available');
    // Các entry khác vẫn locked vì quest tương ứng chưa accept.
    const luyen = list.find((v) => v.key === KEY_LUYENKHI)!;
    expect(luyen.status).toBe('locked');
  });

  it('quest accepted nhưng step progress chưa đạt count → status=locked', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
      step_01: 0,
    });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_PHAMNHAN)!;
    expect(entry.status).toBe('locked');
  });

  it('quest CLAIMED → status=cleared', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'CLAIMED', {
      step_01: 1,
      step_02: 1,
      step_03: 1,
    });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_PHAMNHAN)!;
    expect(entry.status).toBe('cleared');
  });

  it('quest COMPLETED → status=available (mọi step coi như đã đạt)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await seedQuest(prisma, characterId, QUEST_LUYENKHI, 'COMPLETED', {
      step_01: 0,
      step_02: 0,
    });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_LUYENKHI)!;
    expect(entry.status).toBe('available');
  });

  it('Phàm Nhân không đủ minRealm Kim Đan → entry Kim Đan vẫn locked dù quest accepted', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await seedQuest(prisma, characterId, 'kim_dan_main_01', 'ACCEPTED', {
      step_01: 1,
      step_02: 1,
    });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_KIM_DAN)!;
    expect(entry.status).toBe('locked');
  });

  it('view shape — boss preview + monster preview + rewardHint hydrated', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await service.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_PHAMNHAN)!;
    expect(entry.titleVi.length).toBeGreaterThan(0);
    expect(entry.descriptionVi.length).toBeGreaterThan(0);
    expect(entry.regionKey).toBe('son_coc');
    expect(entry.recommendedRealm).toBe('phamnhan');
    expect(entry.requiredQuestKey).toBe(QUEST_PHAMNHAN_REALM);
    expect(entry.requiredQuestStep).toBe('step_01');
    expect(entry.monsters.length).toBe(3);
    for (const m of entry.monsters) {
      expect(m.key.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
    }
    expect(entry.rewardHint?.linhThach).toBe(80);
    expect(entry.rewardHint?.exp).toBe(150);
    expect(entry.rewardHint?.items?.length).toBe(1);
  });
});

describe('StoryDungeonService.getByKey', () => {
  it('trả về template + status', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const view = await service.getByKey(userId, KEY_PHAMNHAN);
    expect(view.key).toBe(KEY_PHAMNHAN);
    expect(view.status).toBe('locked');
  });

  it('throws DUNGEON_NOT_FOUND cho key không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.getByKey(userId, 'story_dgn_xxx_does_not_exist'),
    ).rejects.toThrow(new StoryDungeonError('DUNGEON_NOT_FOUND'));
  });

  it('reflects quest progress mutation between calls (server-authoritative)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    let view = await service.getByKey(userId, KEY_PHAMNHAN);
    expect(view.status).toBe('locked');
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
      step_01: 1,
    });
    view = await service.getByKey(userId, KEY_PHAMNHAN);
    expect(view.status).toBe('available');
  });
});
