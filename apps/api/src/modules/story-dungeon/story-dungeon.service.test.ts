/**
 * Phase 12.8.A + 12.8.B Story Dungeon — integration tests.
 *
 * Phase 12.8.A coverage (read-only):
 *   1. catalog invariant         — `packages/shared/src/story-dungeons.test.ts`.
 *   2. listForUser baseline      — Phàm Nhân, KHÔNG quest accept → mọi entry locked.
 *   3. listForUser quest accepted — step progress đạt count → status=available.
 *   4. listForUser quest claimed  — status=cleared.
 *   5. listForUser realm gate    — Phàm Nhân không đủ minRealm Kim Đan → locked.
 *   6. getByKey returns single template view + status.
 *   7. getByKey throws DUNGEON_NOT_FOUND cho key không tồn tại / disabled.
 *   8. listForUser throws NO_CHARACTER nếu user chưa có character row.
 *
 * Phase 12.8.B coverage (runtime + quest integration, 15 spec cases):
 *   1. list available story dungeon (read-only path baseline).
 *   2. locked dungeon cannot start.
 *   3. start story dungeon success.
 *   4. one-time dungeon cannot start again after clear/claim.
 *   5. advance step success.
 *   6. invalid advance reject.
 *   7. clear success.
 *   8. clear updates quest progress.
 *   9. claim reward success.
 *  10. double claim reject / no double reward.
 *  11. concurrent claim race only one success.
 *  12. non-owner cannot advance/claim run.
 *  13. retry clear does not double quest progress.
 *  14. existing dungeon-run tests vẫn pass (separate `dungeon-run.service.test.ts`).
 *  15. existing quest tests vẫn pass (separate `quest.service.test.ts`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind, Prisma, StoryDungeonRunStatus } from '@prisma/client';
import { storyDungeonByKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  StoryDungeonError,
  StoryDungeonService,
} from './story-dungeon.service';
import {
  TEST_DATABASE_URL,
  makeStoryDungeonService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let service: StoryDungeonService;
/** Phase 12.8.B runtime fixture — wired via DI helper (currency/inventory/quests). */
let runtime: ReturnType<typeof makeStoryDungeonService>;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new StoryDungeonService(prisma);
  runtime = makeStoryDungeonService(prisma);
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

// ============================================================================
// Phase 12.8.B — Runtime + Quest Integration tests (15 spec cases)
// ============================================================================

/**
 * Helper Phase 12.8.B — bootstrap player + quest accept để dungeon `available`.
 * Mirror compute logic: seed `phamnhan_realm_01` ACCEPTED + step_01 progress=1.
 */
async function bootstrapPhamNhanReady(
  realmKey: string = 'phamnhan',
): Promise<{ userId: string; characterId: string }> {
  const { userId, characterId } = await makeUserChar(prisma, { realmKey });
  await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
    step_01: 1,
  });
  return { userId, characterId };
}

async function advanceUntilCleared(userId: string, runId: string): Promise<void> {
  const template = storyDungeonByKey(KEY_PHAMNHAN)!;
  for (let i = 0; i < template.monsterKeys.length; i++) {
    await runtime.story.advance(userId, runId);
  }
  await runtime.story.clear(userId, runId);
}

describe('Phase 12.8.B — StoryDungeonService runtime', () => {
  // [Test 1] list available story dungeon
  it('[1] list available story dungeon — entry phamnhan available sau khi quest accepted', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const list = await runtime.story.listForUser(userId);
    const entry = list.find((v) => v.key === KEY_PHAMNHAN)!;
    expect(entry.status).toBe('available');
    expect(entry.monsters.length).toBeGreaterThan(0);
  });

  // [Test 2] locked dungeon cannot start
  it('[2] locked dungeon cannot start — DUNGEON_LOCKED', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Không seed quest → status=locked.
    await expect(runtime.story.startRun(userId, KEY_PHAMNHAN)).rejects.toThrow(
      new StoryDungeonError('DUNGEON_LOCKED'),
    );
  });

  // [Test 3] start story dungeon success
  it('[3] start story dungeon success — row ACTIVE + currentStep=0', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    expect(run.status).toBe(StoryDungeonRunStatus.ACTIVE);
    expect(run.currentStep).toBe(0);
    expect(run.totalSteps).toBe(3);
    expect(run.currentMonster).not.toBeNull();
    expect(run.killedMonsters).toEqual([]);
    expect(run.clearedAt).toBeNull();
    expect(run.claimedAt).toBeNull();

    const dbRow = await prisma.storyDungeonRun.findUnique({ where: { id: run.id } });
    expect(dbRow).toBeTruthy();
    expect(dbRow?.characterId).toBe(characterId);
    expect(dbRow?.templateKey).toBe(KEY_PHAMNHAN);
  });

  it('[3.idem] start retry cùng templateKey — trả lại run ACTIVE hiện có (idempotent)', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const first = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    const second = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    expect(second.id).toBe(first.id);
    const count = await prisma.storyDungeonRun.count({});
    expect(count).toBe(1);
  });

  // [Test 4] one-time dungeon cannot start again after clear/claim
  it('[4] one-time dungeon cannot start again after clear/claim — DUNGEON_ALREADY_CLEARED', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    await runtime.story.claim(userId, run.id);
    await expect(runtime.story.startRun(userId, KEY_PHAMNHAN)).rejects.toThrow(
      new StoryDungeonError('DUNGEON_ALREADY_CLEARED'),
    );
  });

  // [Test 5] advance step success
  it('[5] advance step success — currentStep++ + killedMonsters appended', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    const advanced = await runtime.story.advance(userId, run.id);
    expect(advanced.currentStep).toBe(1);
    expect(advanced.killedMonsters.length).toBe(1);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    expect(advanced.killedMonsters[0].monsterKey).toBe(template.monsterKeys[0]);
  });

  // [Test 6] invalid advance reject
  it('[6.a] invalid advance reject — RUN_NOT_ACTIVE khi run đã CLEARED', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    await expect(runtime.story.advance(userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_ACTIVE'),
    );
  });

  it('[6.b] invalid advance reject — RUN_NOT_FOUND cho id sai', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    await expect(runtime.story.advance(userId, 'cnotaid')).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_FOUND'),
    );
  });

  it('[6.c] invalid advance reject — RUN_STEP_INVALID nếu currentStep đã chạm cuối nhưng còn ACTIVE (defensive)', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    // Defensive: tạo row giả lập state inconsistent (status=ACTIVE,
    // currentStep=length) — service phải reject thay vì throw out-of-range.
    const row = await prisma.storyDungeonRun.create({
      data: {
        characterId,
        templateKey: KEY_PHAMNHAN,
        status: StoryDungeonRunStatus.ACTIVE,
        currentStep: template.monsterKeys.length,
        killedMonsters: [] as Prisma.InputJsonValue,
      },
    });
    await expect(runtime.story.advance(userId, row.id)).rejects.toThrow(
      new StoryDungeonError('RUN_STEP_INVALID'),
    );
  });

  // [Test 7] clear success
  it('[7] clear success — status CLEARED + clearedAt set', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    for (let i = 0; i < template.monsterKeys.length; i++) {
      await runtime.story.advance(userId, run.id);
    }
    const cleared = await runtime.story.clear(userId, run.id);
    expect(cleared.status).toBe(StoryDungeonRunStatus.CLEARED);
    expect(cleared.clearedAt).not.toBeNull();
    expect(cleared.claimedAt).toBeNull();
  });

  it('[7.invalid] clear khi chưa hết encounter → RUN_STEP_INVALID', async () => {
    const { userId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await runtime.story.advance(userId, run.id); // currentStep=1 < total=3.
    await expect(runtime.story.clear(userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_STEP_INVALID'),
    );
  });

  // [Test 8] clear updates quest progress
  it('[8] clear updates quest progress — stepProgress[step_01]=1 + auto-COMPLETE nếu mọi step done', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Seed quest ACCEPTED nhưng step_01 chưa progress (0). story dungeon
    // template require step_01 — set progress=1 để compute=`available` ngay
    // từ start.
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
      step_01: 1,
      step_02: 1,
      step_03: 1,
    });
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    const after = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId,
          questKey: QUEST_PHAMNHAN_REALM,
        },
      },
    });
    // Mọi step done → auto-COMPLETED.
    expect(after?.status).toBe('COMPLETED');
    expect(after?.completedAt).not.toBeNull();
  });

  it('[8.partial] clear updates quest progress — chỉ bump requiredQuestStep, các step khác không đụng', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Seed quest ACCEPTED, step_01=1 (đã đạt), step_02/step_03 chưa.
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'ACCEPTED', {
      step_01: 1,
      step_02: 0,
      step_03: 0,
    });
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    const after = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId,
          questKey: QUEST_PHAMNHAN_REALM,
        },
      },
    });
    // Chưa đủ step → vẫn ACCEPTED, KHÔNG auto-COMPLETE.
    expect(after?.status).toBe('ACCEPTED');
    expect(after?.completedAt).toBeNull();
  });

  // [Test 9] claim reward success
  it('[9] claim reward success — currency/exp/item granted + status=CLAIMED + ledger rows ghi đúng', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    const charBefore = await prisma.character.findUnique({ where: { id: characterId } });
    const linhBefore = charBefore!.linhThach;
    const expBefore = charBefore!.exp;

    const result = await runtime.story.claim(userId, run.id);
    expect(result.runId).toBe(run.id);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    const reward = template.rewardHint!;
    expect(result.granted.linhThach).toBe(reward.linhThach ?? 0);
    expect(result.granted.exp).toBe(reward.exp ?? 0);
    expect(result.granted.items.length).toBe(reward.items?.length ?? 0);

    const charAfter = await prisma.character.findUnique({ where: { id: characterId } });
    expect(charAfter?.linhThach).toBe(linhBefore + BigInt(reward.linhThach ?? 0));
    expect(charAfter?.exp).toBe(expBefore + BigInt(reward.exp ?? 0));

    const ledger = await prisma.currencyLedger.findFirst({
      where: {
        characterId,
        reason: 'STORY_DUNGEON_REWARD',
        refType: 'StoryDungeonRun',
        refId: run.id,
      },
    });
    expect(ledger).toBeTruthy();
    expect(ledger?.currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledger?.delta).toBe(BigInt(reward.linhThach ?? 0));

    const itemLedger = await prisma.itemLedger.findFirst({
      where: {
        characterId,
        reason: 'STORY_DUNGEON_REWARD',
        refType: 'StoryDungeonRun',
        refId: run.id,
      },
    });
    expect(itemLedger).toBeTruthy();

    const dbRow = await prisma.storyDungeonRun.findUnique({ where: { id: run.id } });
    expect(dbRow?.status).toBe(StoryDungeonRunStatus.CLAIMED);
    expect(dbRow?.claimedAt).not.toBeNull();
  });

  // [Test 10] double claim reject / no double reward
  it('[10] double claim reject / no double reward — lần 2 throws RUN_ALREADY_CLAIMED', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);
    await runtime.story.claim(userId, run.id);

    await expect(runtime.story.claim(userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_ALREADY_CLAIMED'),
    );

    const ledgerCount = await prisma.currencyLedger.count({
      where: {
        characterId,
        reason: 'STORY_DUNGEON_REWARD',
        refType: 'StoryDungeonRun',
        refId: run.id,
      },
    });
    expect(ledgerCount).toBe(1);

    const itemLedgerCount = await prisma.itemLedger.count({
      where: {
        characterId,
        reason: 'STORY_DUNGEON_REWARD',
        refType: 'StoryDungeonRun',
        refId: run.id,
      },
    });
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    expect(itemLedgerCount).toBe(template.rewardHint!.items?.length ?? 0);
  });

  // [Test 11] concurrent claim race only one success
  it('[11] concurrent claim race — chỉ 1 winner, ledger không nhân đôi', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    await advanceUntilCleared(userId, run.id);

    const settled = await Promise.allSettled([
      runtime.story.claim(userId, run.id),
      runtime.story.claim(userId, run.id),
    ]);
    const won = settled.filter((s) => s.status === 'fulfilled');
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(won.length).toBe(1);
    expect(lost.length).toBe(1);

    const ledgerCount = await prisma.currencyLedger.count({
      where: {
        characterId,
        reason: 'STORY_DUNGEON_REWARD',
        refType: 'StoryDungeonRun',
        refId: run.id,
      },
    });
    expect(ledgerCount).toBe(1);
  });

  // [Test 12] non-owner cannot advance/claim run
  it('[12.a] non-owner cannot advance — RUN_NOT_OWNED', async () => {
    const owner = await bootstrapPhamNhanReady();
    const intruder = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(owner.userId, KEY_PHAMNHAN);
    await expect(runtime.story.advance(intruder.userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_OWNED'),
    );
  });

  it('[12.b] non-owner cannot claim — RUN_NOT_OWNED', async () => {
    const owner = await bootstrapPhamNhanReady();
    const intruder = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(owner.userId, KEY_PHAMNHAN);
    await advanceUntilCleared(owner.userId, run.id);
    await expect(runtime.story.claim(intruder.userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_OWNED'),
    );
  });

  it('[12.c] non-owner cannot clear — RUN_NOT_OWNED', async () => {
    const owner = await bootstrapPhamNhanReady();
    const intruder = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(owner.userId, KEY_PHAMNHAN);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    for (let i = 0; i < template.monsterKeys.length; i++) {
      await runtime.story.advance(owner.userId, run.id);
    }
    await expect(runtime.story.clear(intruder.userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_OWNED'),
    );
  });

  // [Test 13] retry clear does not double quest progress
  it('[13] retry clear does not double quest progress — CAS guard chặn double clear', async () => {
    const { userId, characterId } = await bootstrapPhamNhanReady();
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    for (let i = 0; i < template.monsterKeys.length; i++) {
      await runtime.story.advance(userId, run.id);
    }
    await runtime.story.clear(userId, run.id);
    // 2nd clear → RUN_NOT_ACTIVE (status đã CLEARED).
    await expect(runtime.story.clear(userId, run.id)).rejects.toThrow(
      new StoryDungeonError('RUN_NOT_ACTIVE'),
    );

    const after = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId,
          questKey: QUEST_PHAMNHAN_REALM,
        },
      },
    });
    // step_01 progress vẫn = stepDef.count (1), không double bump.
    const sp = (after?.stepProgress as Record<string, number>) ?? {};
    expect(sp.step_01).toBe(1);
  });

  it('[13.b] clear khi quest đã CLAIMED không throw 500 (fail-soft)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Seed quest đã CLAIMED nhưng dungeon vẫn `cleared` (status=cleared
    // KHÔNG block start... wait — actually computeStoryDungeonStatus =
    // 'cleared' khi quest CLAIMED → start sẽ pass since status !== 'locked').
    // Để test fail-soft branch, ta seed quest CLAIMED + then start +
    // advance + clear → code path applyQuestStepAdvance gặp status=CLAIMED
    // → return early không throw.
    await seedQuest(prisma, characterId, QUEST_PHAMNHAN_REALM, 'CLAIMED', {
      step_01: 1,
      step_02: 1,
      step_03: 1,
    });
    // Tuy nhiên oneTime dungeon: nếu (characterId, templateKey) đã có row
    // claimedAt thì block. Đây là quest CLAIMED chứ KHÔNG phải dungeon
    // claimed → start vẫn pass.
    const run = await runtime.story.startRun(userId, KEY_PHAMNHAN);
    const template = storyDungeonByKey(KEY_PHAMNHAN)!;
    for (let i = 0; i < template.monsterKeys.length; i++) {
      await runtime.story.advance(userId, run.id);
    }
    // Clear KHÔNG throw dù quest đã CLAIMED.
    const cleared = await runtime.story.clear(userId, run.id);
    expect(cleared.status).toBe(StoryDungeonRunStatus.CLEARED);
    // Quest vẫn CLAIMED (không revert).
    const after = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId,
          questKey: QUEST_PHAMNHAN_REALM,
        },
      },
    });
    expect(after?.status).toBe('CLAIMED');
  });
});
