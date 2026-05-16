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
  npcGiftPreferenceForKey,
  NPC_AFFINITY,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { CharacterService } from '../character/character.service';
import { RealtimeService } from '../realtime/realtime.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  NpcAffinityError,
  NpcAffinityService,
} from './npc-affinity.service';

let prisma: PrismaService;
let service: NpcAffinityService;
let inventory: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  service = new NpcAffinityService(prisma, inventory);
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

/**
 * Phase 12.10.B — gift integration test.
 *
 * Coverage:
 *   - gift success: consume 1 stack, +affinity, log row insert.
 *   - reject ITEM_NOT_IN_INVENTORY: character không có item.
 *   - reject ITEM_NOT_ACCEPTED: item ngoài catalog NPC.
 *   - reject NPC_GIFT_NOT_CONFIGURED: NPC không có gift catalog.
 *   - reject DAILY_LIMIT_REACHED: vượt `dailyLimit`.
 *   - daily reset: dayBucket khác → count reset (giả lập = `now` override).
 *   - getDailyGiftCounts trả used/limit/remaining đúng.
 */
describe('NpcAffinityService.giftNpc', () => {
  const NPC_LANG = 'npc_lang_van_sinh';
  const ACCEPTED_ITEM = 'linh_lo_dan';

  it('success: consume 1 stack + add affinity + log row + return view', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const giftDef = npcGiftPreferenceForKey(NPC_LANG)!;
    const affDef = npcAffinityDefForKey(NPC_LANG)!;

    await inventory.grant(
      characterId,
      [{ itemKey: ACCEPTED_ITEM, qty: 3 }],
      { reason: 'ADMIN_GRANT' },
    );

    const res = await service.giftNpc({
      characterId,
      npcKey: NPC_LANG,
      itemKey: ACCEPTED_ITEM,
    });

    expect(res.npcKey).toBe(NPC_LANG);
    expect(res.itemKey).toBe(ACCEPTED_ITEM);
    expect(res.affinityDelta).toBeGreaterThan(0);
    expect(res.previousScore).toBe(affDef.initialScore);
    expect(res.newScore).toBe(affDef.initialScore + res.affinityDelta);
    expect(res.sequence).toBe(1);
    expect(res.dailyLimit).toBe(giftDef.dailyLimit);
    expect(res.remainingToday).toBe(giftDef.dailyLimit - 1);

    // Inventory: qty giảm còn 2.
    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId, itemKey: ACCEPTED_ITEM },
    });
    expect(inv.qty).toBe(2);

    // Log row inserted.
    const log = await prisma.characterNpcGiftLog.findFirstOrThrow({
      where: { characterId, npcKey: NPC_LANG },
    });
    expect(log.itemKey).toBe(ACCEPTED_ITEM);
    expect(log.affinityDelta).toBe(res.affinityDelta);
    expect(log.sequence).toBe(1);

    // ItemLedger row inserted với reason NPC_GIFT.
    const ledger = await prisma.itemLedger.findFirstOrThrow({
      where: { characterId, itemKey: ACCEPTED_ITEM, qtyDelta: -1 },
    });
    expect(ledger.reason).toBe('NPC_GIFT');

    // Affinity row updated.
    const aff = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_LANG } },
      select: { score: true },
    });
    expect(aff?.score).toBe(res.newScore);
  });

  it('reject ITEM_NOT_IN_INVENTORY: character không có item', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });

    await expect(
      service.giftNpc({
        characterId,
        npcKey: NPC_LANG,
        itemKey: ACCEPTED_ITEM,
      }),
    ).rejects.toThrow(/ITEM_NOT_IN_INVENTORY/);

    // Không leak log row hoặc affinity update.
    const logCount = await prisma.characterNpcGiftLog.count({
      where: { characterId },
    });
    expect(logCount).toBe(0);
    const affCount = await prisma.characterNpcAffinity.count({
      where: { characterId },
    });
    expect(affCount).toBe(0);
  });

  it('reject ITEM_NOT_ACCEPTED: item ngoài catalog NPC', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // `so_kiem` không nằm trong acceptedItems của npc_lang_van_sinh.
    await inventory.grant(
      characterId,
      [{ itemKey: 'so_kiem', qty: 1 }],
      { reason: 'ADMIN_GRANT' },
    );
    await expect(
      service.giftNpc({
        characterId,
        npcKey: NPC_LANG,
        itemKey: 'so_kiem',
      }),
    ).rejects.toThrow(/ITEM_NOT_ACCEPTED/);

    // Inventory không bị consume.
    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId, itemKey: 'so_kiem' },
    });
    expect(inv.qty).toBe(1);
  });

  it('reject NPC_GIFT_NOT_CONFIGURED: NPC trong affinity catalog nhưng không có gift catalog', async () => {
    // Sanity: nếu mọi NPC đều có gift catalog thì test này skip.
    const noGift = NPC_AFFINITY.find((d) => !npcGiftPreferenceForKey(d.npcKey));
    if (!noGift) return;
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.giftNpc({
        characterId,
        npcKey: noGift.npcKey,
        itemKey: ACCEPTED_ITEM,
      }),
    ).rejects.toThrow(/NPC_GIFT_NOT_CONFIGURED/);
  });

  it('reject DAILY_LIMIT_REACHED: gift đến `dailyLimit` lần là OK, lần kế throw', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const giftDef = npcGiftPreferenceForKey(NPC_LANG)!;
    // Cấp đủ item cho `dailyLimit + 1` lần để chứng minh limit, không phải
    // do hết item.
    await inventory.grant(
      characterId,
      [{ itemKey: ACCEPTED_ITEM, qty: giftDef.dailyLimit + 1 }],
      { reason: 'ADMIN_GRANT' },
    );

    for (let i = 0; i < giftDef.dailyLimit; i++) {
      const res = await service.giftNpc({
        characterId,
        npcKey: NPC_LANG,
        itemKey: ACCEPTED_ITEM,
      });
      expect(res.sequence).toBe(i + 1);
      expect(res.remainingToday).toBe(giftDef.dailyLimit - (i + 1));
    }

    await expect(
      service.giftNpc({
        characterId,
        npcKey: NPC_LANG,
        itemKey: ACCEPTED_ITEM,
      }),
    ).rejects.toThrow(/DAILY_LIMIT_REACHED/);

    // Sau khi reject, inventory vẫn còn 1 (lần gift cuối KHÔNG consume).
    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId, itemKey: ACCEPTED_ITEM },
    });
    expect(inv.qty).toBe(1);
  });

  it('daily reset: dayBucket khác → count reset', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const giftDef = npcGiftPreferenceForKey(NPC_LANG)!;
    await inventory.grant(
      characterId,
      [{ itemKey: ACCEPTED_ITEM, qty: giftDef.dailyLimit + 1 }],
      { reason: 'ADMIN_GRANT' },
    );

    // Day 1 — fill limit.
    const day1 = new Date('2026-06-01T05:00:00Z');
    for (let i = 0; i < giftDef.dailyLimit; i++) {
      await service.giftNpc({
        characterId,
        npcKey: NPC_LANG,
        itemKey: ACCEPTED_ITEM,
        now: day1,
      });
    }

    // Day 2 — count reset, gift sequence=1 lại.
    const day2 = new Date('2026-06-02T05:00:00Z');
    const res = await service.giftNpc({
      characterId,
      npcKey: NPC_LANG,
      itemKey: ACCEPTED_ITEM,
      now: day2,
    });
    expect(res.sequence).toBe(1);
    expect(res.dayBucket).toBe('2026-06-02');
  });

  it('getDailyGiftCounts trả used/limit/remaining đúng', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const giftDef = npcGiftPreferenceForKey(NPC_LANG)!;
    await inventory.grant(
      characterId,
      [{ itemKey: ACCEPTED_ITEM, qty: 2 }],
      { reason: 'ADMIN_GRANT' },
    );

    // Trước gift: count = 0.
    const before = await service.getDailyGiftCounts(characterId);
    expect(before.get(NPC_LANG)).toEqual({
      used: 0,
      limit: giftDef.dailyLimit,
      remaining: giftDef.dailyLimit,
    });

    // Gift 2 lần.
    await service.giftNpc({ characterId, npcKey: NPC_LANG, itemKey: ACCEPTED_ITEM });
    await service.giftNpc({ characterId, npcKey: NPC_LANG, itemKey: ACCEPTED_ITEM });

    const after = await service.getDailyGiftCounts(characterId);
    expect(after.get(NPC_LANG)).toEqual({
      used: 2,
      limit: giftDef.dailyLimit,
      remaining: giftDef.dailyLimit - 2,
    });
  });

  it('dayBucketFor trả ISO YYYY-MM-DD theo timezone ICT (Asia/Ho_Chi_Minh)', () => {
    // 00:00 UTC = 07:00 ICT — vẫn cùng ngày ICT 2026-06-09.
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T00:00:00Z'))).toBe(
      '2026-06-09',
    );

    // Boundary 1: 23:30 ICT (16:30 UTC) cùng ngày — chưa reset.
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T16:30:00Z'))).toBe(
      '2026-06-09',
    );
    // Boundary 2: 16:59:59 UTC = 23:59:59 ICT — cùng ngày, sát reset.
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T16:59:59Z'))).toBe(
      '2026-06-09',
    );
    // Boundary 3: 17:00:00 UTC = 00:00:00 ICT hôm sau — ICT reset → bucket
    // mới `2026-06-10`. Đây là điểm khác biệt chính với behavior UTC cũ
    // (UTC bucket trước fix vẫn còn `2026-06-09` ở mốc này).
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T17:00:00Z'))).toBe(
      '2026-06-10',
    );
    // Boundary 4: 00:30 ICT (17:30 UTC) — ngày mới ICT.
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T17:30:00Z'))).toBe(
      '2026-06-10',
    );

    // Boundary 5: 23:59:59 UTC = 06:59:59 ICT hôm sau — bucket ICT đã sang
    // ngày sau từ rất lâu (so với UTC vẫn ngày cũ 2026-06-09).
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-09T23:59:59Z'))).toBe(
      '2026-06-10',
    );

    // Boundary 6: 00:00 UTC ngày sau = 07:00 ICT — vẫn cùng bucket
    // 2026-06-10 với boundary 3+4+5 (giữa ngày ICT, không reset).
    expect(NpcAffinityService.dayBucketFor(new Date('2026-06-10T00:00:00Z'))).toBe(
      '2026-06-10',
    );
  });
});
