/**
 * Phase 12.10.D — NpcRelationshipChainService integration tests.
 *
 * Coverage:
 *   1. listForCharacter trả full chain catalog của NPC (lock state + quest
 *      progress derive từ QuestProgress).
 *   2. claimChain reject `CHAIN_LOCKED_TIER` khi affinity tier < required.
 *   3. claimChain reject `CHAIN_NOT_COMPLETABLE` khi quest chưa CLAIMED.
 *   4. claimChain success path → ghi storyFlags + grant affinity/currency
 *      idempotent.
 *   5. claimChain retry → CHAIN_ALREADY_CLAIMED, KHÔNG double-grant.
 *   6. hidden chain visible chỉ khi tier reached.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NPC_RELATIONSHIP_QUEST_CHAINS,
  npcAffinityDefForKey,
  npcRelationshipChainByKey,
} from '@xuantoi/shared';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeNpcRelationshipChainService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { NpcRelationshipChainError } from './npc-relationship-chain.service';

let prisma: PrismaService;
let svc: ReturnType<typeof makeNpcRelationshipChainService>;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = makeNpcRelationshipChainService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NPC_HAN_DA = 'npc_han_da';
const CHAIN_HAN_DA = 'relchain_han_da_truce';
const QUEST_HAN_DA = 'luyenkhi_npc_01';
const NPC_TO_NGUYET_LY = 'npc_to_nguyet_ly';
const CHAIN_TO_NGUYET_LY_HIDDEN = 'relchain_to_nguyet_ly_lineage';

async function setQuestClaimed(
  characterId: string,
  questKey: string,
): Promise<void> {
  await prisma.questProgress.upsert({
    where: { characterId_questKey: { characterId, questKey } },
    create: {
      characterId,
      questKey,
      status: 'CLAIMED',
      stepProgress: {} as Prisma.InputJsonValue,
      acceptedAt: new Date(),
      completedAt: new Date(),
      claimedAt: new Date(),
    },
    update: {
      status: 'CLAIMED',
      claimedAt: new Date(),
      completedAt: new Date(),
    },
  });
}

async function setAffinity(
  characterId: string,
  npcKey: string,
  score: number,
): Promise<void> {
  await prisma.characterNpcAffinity.upsert({
    where: { characterId_npcKey: { characterId, npcKey } },
    create: { characterId, npcKey, score },
    update: { score },
  });
}

describe('NpcRelationshipChainService.listForCharacter', () => {
  it('trả tất cả chain của NPC + state derive từ flags', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });

    const list = await svc.chains.listForCharacter(characterId, NPC_HAN_DA);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const chain = list.find((c) => c.chainKey === CHAIN_HAN_DA)!;
    expect(chain.npcKey).toBe(NPC_HAN_DA);
    expect(chain.tierUnlocked).toBe(false); // initial xa_la, requires quen_biet
    expect(chain.claimed).toBe(false);
    expect(chain.totalCount).toBe(1);
    expect(chain.claimedCount).toBe(0);
    expect(chain.completable).toBe(false);
  });

  it('hidden chain không visible khi tier chưa đủ', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await svc.chains.listForCharacter(characterId, NPC_TO_NGUYET_LY);
    const hidden = list.find((c) => c.chainKey === CHAIN_TO_NGUYET_LY_HIDDEN);
    expect(hidden).toBeDefined();
    expect(hidden!.hidden).toBe(true);
    expect(hidden!.visible).toBe(false);
  });

  it('hidden chain visible khi tier đã reached', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = npcAffinityDefForKey(NPC_TO_NGUYET_LY)!;
    // ban_huu tier minScore = 30 — clamp tới catalog max nếu cần.
    await setAffinity(characterId, NPC_TO_NGUYET_LY, Math.min(60, def.maxScore));
    const list = await svc.chains.listForCharacter(characterId, NPC_TO_NGUYET_LY);
    const hidden = list.find((c) => c.chainKey === CHAIN_TO_NGUYET_LY_HIDDEN)!;
    expect(hidden.tierUnlocked).toBe(true);
    expect(hidden.visible).toBe(true);
  });

  it('reflect quest progress khi quest CLAIMED', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setQuestClaimed(characterId, QUEST_HAN_DA);
    const list = await svc.chains.listForCharacter(characterId, NPC_HAN_DA);
    const chain = list.find((c) => c.chainKey === CHAIN_HAN_DA)!;
    expect(chain.claimedCount).toBe(1);
    expect(chain.completable).toBe(true);
  });
});

describe('NpcRelationshipChainService.claimChain', () => {
  it('CHAIN_LOCKED_TIER khi affinity tier < required', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setQuestClaimed(characterId, QUEST_HAN_DA);
    // Score = 0 → tier xa_la < quen_biet (required).
    await expect(
      svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA }),
    ).rejects.toBeInstanceOf(NpcRelationshipChainError);
  });

  it('CHAIN_NOT_COMPLETABLE khi quest chưa CLAIMED', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, NPC_HAN_DA, 30);
    await expect(
      svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA }),
    ).rejects.toMatchObject({ code: 'CHAIN_NOT_COMPLETABLE' });
  });

  it('CHAIN_UNKNOWN cho chainKey không tồn tại', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      svc.chains.claimChain({ characterId, chainKey: 'relchain_does_not_exist' }),
    ).rejects.toMatchObject({ code: 'CHAIN_UNKNOWN' });
  });

  it('claim success grants affinity + linhThach + items + ghi flags', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, NPC_HAN_DA, 30); // quen_biet
    await setQuestClaimed(characterId, QUEST_HAN_DA);

    const before = await prisma.character.findUnique({
      where: { id: characterId },
      select: { linhThach: true, exp: true },
    });

    const def = npcRelationshipChainByKey(CHAIN_HAN_DA)!;
    const receipt = await svc.chains.claimChain({
      characterId,
      chainKey: CHAIN_HAN_DA,
    });

    expect(receipt.granted.affinity).toBe(def.rewardHint.affinity);
    expect(receipt.granted.linhThach).toBe(def.rewardHint.linhThach);
    expect(receipt.granted.exp).toBe(def.rewardHint.exp);
    expect(receipt.claimedAt).toBeInstanceOf(Date);

    // Currency ledger viết 1 row reason NPC_RELATIONSHIP_CHAIN_REWARD.
    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        reason: 'NPC_RELATIONSHIP_CHAIN_REWARD',
      },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(Number(ledger[0].delta)).toBe(def.rewardHint.linhThach);

    // storyFlags chứa claim flag + endingFlags (mọi key trong endingFlags).
    const after = await prisma.character.findUnique({
      where: { id: characterId },
      select: { storyFlags: true, exp: true, linhThach: true },
    });
    const flags = after?.storyFlags as Record<string, unknown>;
    expect(flags['relchain_han_da_truce_claimed']).toBe('1');
    for (const k of Object.keys(def.endingFlags)) {
      expect(flags[k]).toBeDefined();
    }
    expect(Number(after!.linhThach) - Number(before!.linhThach)).toBe(def.rewardHint.linhThach);

    // Affinity score increased.
    const aff = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_HAN_DA } },
      select: { score: true },
    });
    expect(aff!.score).toBeGreaterThanOrEqual(30 + def.rewardHint.affinity - 1);
  });

  it('CHAIN_ALREADY_CLAIMED idempotent — retry KHÔNG double-grant', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, NPC_HAN_DA, 30);
    await setQuestClaimed(characterId, QUEST_HAN_DA);

    await svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA });

    await expect(
      svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA }),
    ).rejects.toMatchObject({ code: 'CHAIN_ALREADY_CLAIMED' });

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'NPC_RELATIONSHIP_CHAIN_REWARD' },
    });
    expect(ledger.length).toBe(1);
  });

  it('parallel claim — đúng 1 winner, KHÔNG double-grant (race-safe)', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, NPC_HAN_DA, 30);
    await setQuestClaimed(characterId, QUEST_HAN_DA);

    const results = await Promise.allSettled([
      svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA }),
      svc.chains.claimChain({ characterId, chainKey: CHAIN_HAN_DA }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'NPC_RELATIONSHIP_CHAIN_REWARD' },
    });
    expect(ledger.length).toBe(1);
  });
});

describe('catalog static checks (sanity)', () => {
  it('every catalog chain queryable via listForCharacter', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const npcKeys = Array.from(
      new Set(NPC_RELATIONSHIP_QUEST_CHAINS.map((c) => c.npcKey)),
    );
    for (const npcKey of npcKeys) {
      const list = await svc.chains.listForCharacter(characterId, npcKey);
      const expected = NPC_RELATIONSHIP_QUEST_CHAINS.filter(
        (c) => c.npcKey === npcKey,
      );
      expect(list.length).toBe(expected.length);
    }
  });
});
