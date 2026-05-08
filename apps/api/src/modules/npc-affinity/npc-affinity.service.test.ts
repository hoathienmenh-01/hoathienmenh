/**
 * Phase 12.10.A — NpcAffinityService integration tests.
 *
 * Coverage:
 *   1. tier helper đúng                     — `npc-affinity.test.ts` (shared).
 *   2. add affinity success                 — `addAffinityTx` lazy-create + add delta.
 *   3. cap min/max                          — clamp `[minScore, maxScore]` của catalog.
 *   4. delta validation                     — non-zero integer, |delta| ≤ cap.
 *   5. unknown npcKey rejected              — `NPC_AFFINITY_UNKNOWN`.
 *   6. listForCharacter / getForNpc fallback initialScore khi chưa có row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
  affinityTierForScore,
  npcAffinityDefForKey,
  NPC_AFFINITY,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import {
  NpcAffinityError,
  NpcAffinityService,
} from './npc-affinity.service';

let prisma: PrismaService;
let service: NpcAffinityService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new NpcAffinityService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NPC_LANG = 'npc_lang_van_sinh';
const NPC_MOC = 'npc_moc_thanh_y';

describe('NpcAffinityService.addAffinityTx', () => {
  it('lazy-create row với initialScore + add positive delta', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;

    const res = await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: 5,
      source: 'STORY_DIALOGUE_CHOICE',
    });

    expect(res.previousScore).toBe(def.initialScore);
    expect(res.newScore).toBe(def.initialScore + 5);
    expect(res.npcKey).toBe(NPC_LANG);

    const row = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_LANG } },
      select: { score: true },
    });
    expect(row?.score).toBe(def.initialScore + 5);
  });

  it('add negative delta giảm score', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;

    await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: 10,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    const res = await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: -3,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    expect(res.previousScore).toBe(def.initialScore + 10);
    expect(res.newScore).toBe(def.initialScore + 7);
  });

  it('clamp score tại maxScore của catalog', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;

    // Add nhiều lần để vượt maxScore.
    let lastScore = def.initialScore;
    while (lastScore < def.maxScore) {
      const res = await service.addAffinity({
        characterId,
        npcKey: NPC_LANG,
        delta: AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
        source: 'QUEST_REWARD',
      });
      lastScore = res.newScore;
      // Safety break nếu maxScore quá lớn.
      if (lastScore >= def.maxScore) break;
    }
    expect(lastScore).toBe(def.maxScore);

    // Add thêm — clamp vẫn = maxScore (delta apply nhưng newScore = maxScore).
    const after = await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: 5,
      source: 'QUEST_REWARD',
    });
    expect(after.newScore).toBe(def.maxScore);
  });

  it('clamp score tại minScore của catalog', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;

    // Add âm nhiều lần.
    let lastScore = def.initialScore;
    while (lastScore > def.minScore) {
      const res = await service.addAffinity({
        characterId,
        npcKey: NPC_LANG,
        delta: -AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
        source: 'STORY_DIALOGUE_CHOICE',
      });
      lastScore = res.newScore;
      if (lastScore <= def.minScore) break;
    }
    expect(lastScore).toBe(def.minScore);

    // Floor đã chạm — add thêm âm vẫn = minScore.
    const after = await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: -5,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    expect(after.newScore).toBe(def.minScore);
  });

  it('throws NPC_AFFINITY_UNKNOWN cho npcKey không thuộc catalog', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.addAffinity({
        characterId,
        npcKey: 'npc_does_not_exist',
        delta: 5,
        source: 'STORY_DIALOGUE_CHOICE',
      }),
    ).rejects.toThrow(NpcAffinityError);
  });

  it('throws INVALID_DELTA cho delta=0', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.addAffinity({
        characterId,
        npcKey: NPC_LANG,
        delta: 0,
        source: 'STORY_DIALOGUE_CHOICE',
      }),
    ).rejects.toThrow(/INVALID_DELTA/);
  });

  it('throws CAP_EXCEEDED cho |delta| vượt cap quest reward', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.addAffinity({
        characterId,
        npcKey: NPC_LANG,
        delta: AFFINITY_DELTA_CAP_PER_QUEST_REWARD + 1,
        source: 'QUEST_REWARD',
      }),
    ).rejects.toThrow(/CAP_EXCEEDED/);
  });

  it('tierChanged=true khi cross tier threshold', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;
    // Add 1 lần ngay vào range tier ban_huu (≥30).
    // Init = 0 (xa_la), +30 → ban_huu (qua quen_biet 10+).
    const res = await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: 30,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    expect(def.initialScore).toBeLessThan(30);
    expect(res.tierChanged).toBe(true);
    expect(affinityTierForScore(res.newScore).key).not.toBe(
      affinityTierForScore(def.initialScore).key,
    );
  });
});

describe('NpcAffinityService.listForCharacter / getForNpc', () => {
  it('list trả tất cả NPC catalog với fallback initialScore khi chưa có row', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await service.listForCharacter(characterId);
    expect(list).toHaveLength(NPC_AFFINITY.length);
    for (const view of list) {
      const def = npcAffinityDefForKey(view.npcKey)!;
      expect(view.score).toBe(def.initialScore);
      expect(view.minScore).toBe(def.minScore);
      expect(view.maxScore).toBe(def.maxScore);
      expect(view.unlocks.length).toBeGreaterThan(0);
    }
  });

  it('list reflect score sau add', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.addAffinity({
      characterId,
      npcKey: NPC_MOC,
      delta: 12,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    const list = await service.listForCharacter(characterId);
    const moc = list.find((v) => v.npcKey === NPC_MOC)!;
    const def = npcAffinityDefForKey(NPC_MOC)!;
    expect(moc.score).toBe(def.initialScore + 12);
  });

  it('getForNpc fallback initialScore khi chưa có row', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const view = await service.getForNpc(characterId, NPC_LANG);
    const def = npcAffinityDefForKey(NPC_LANG)!;
    expect(view.score).toBe(def.initialScore);
  });

  it('getForNpc throws NPC_AFFINITY_UNKNOWN cho key sai', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(service.getForNpc(characterId, 'npc_bogus')).rejects.toThrow(
      NpcAffinityError,
    );
  });

  it('view.nextTier null khi đã đạt tier cao nhất', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_LANG)!;
    // Push to maxScore.
    let cur = def.initialScore;
    while (cur < def.maxScore) {
      const res = await service.addAffinity({
        characterId,
        npcKey: NPC_LANG,
        delta: AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
        source: 'QUEST_REWARD',
      });
      cur = res.newScore;
    }
    const view = await service.getForNpc(characterId, NPC_LANG);
    expect(view.score).toBe(def.maxScore);
    // Nếu maxScore ≥ tier cuối → nextTier null.
    if (view.score >= 100) {
      expect(view.nextTier).toBeNull();
    }
  });
});

describe('NpcAffinityService.loadScoreMap', () => {
  it('returns empty map cho character chưa có affinity row', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const map = await service.loadScoreMap(characterId);
    expect(map.size).toBe(0);
  });

  it('returns map với score đã set', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.addAffinity({
      characterId,
      npcKey: NPC_LANG,
      delta: 7,
      source: 'STORY_DIALOGUE_CHOICE',
    });
    const map = await service.loadScoreMap(characterId);
    const def = npcAffinityDefForKey(NPC_LANG)!;
    expect(map.get(NPC_LANG)).toBe(def.initialScore + 7);
  });

  it('resolveScore static helper fallback initialScore cho missing key', () => {
    const map = new Map<string, number>();
    const score = NpcAffinityService.resolveScore(map, NPC_LANG);
    const def = npcAffinityDefForKey(NPC_LANG)!;
    expect(score).toBe(def.initialScore);
  });

  it('resolveScore returns map value khi có row', () => {
    const map = new Map<string, number>([[NPC_LANG, 42]]);
    expect(NpcAffinityService.resolveScore(map, NPC_LANG)).toBe(42);
  });
});
