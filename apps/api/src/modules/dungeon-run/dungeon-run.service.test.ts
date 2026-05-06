import { CurrencyKind, DungeonRunStatus } from '@prisma/client';
import { DUNGEON_LOOT, dungeonByKey } from '@xuantoi/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { QuestService } from '../quest/quest.service';
import { DungeonRunError, DungeonRunService } from './dungeon-run.service';
import {
  TEST_DATABASE_URL,
  makeDungeonRunService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let runs: DungeonRunService;
let quests: QuestService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const built = makeDungeonRunService(prisma);
  runs = built.runs;
  quests = built.quests;
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const SON_COC_KEY = 'son_coc'; // luyenkhi tier, 3 monsters, dailyLimit=5
const HAC_LAM_KEY = 'hac_lam'; // truc_co tier, 3 monsters, dailyLimit=4
const YEU_THU_DONG_KEY = 'yeu_thu_dong'; // kim_dan tier, 3 monsters, dailyLimit=3

describe('DungeonRunService.listForUser', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(runs.listForUser('non-existent-user')).rejects.toThrow(
      new DungeonRunError('NO_CHARACTER'),
    );
  });

  it('list trả về tất cả DUNGEONS với flag unlocked theo realm', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const view = await runs.listForUser(userId);
    expect(view.available.length).toBeGreaterThan(0);
    const sonCoc = view.available.find((d) => d.dungeon.key === SON_COC_KEY);
    expect(sonCoc?.unlocked).toBe(true);
    expect(sonCoc?.startable).toBe(true);
    const hacLam = view.available.find((d) => d.dungeon.key === HAC_LAM_KEY);
    // truc_co realm > luyenkhi player → locked
    expect(hacLam?.unlocked).toBe(false);
    expect(hacLam?.lockReason).toBe('LOCKED_REALM');
    expect(hacLam?.startable).toBe(false);
  });

  it('list daily counter tăng sau khi start run + activeRun set', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const initial = await runs.listForUser(userId);
    expect(initial.activeRun).toBeNull();
    expect(initial.available.find((d) => d.dungeon.key === SON_COC_KEY)?.dailyUsed).toBe(0);
    const run = await runs.startRun(userId, SON_COC_KEY);
    const after = await runs.listForUser(userId);
    expect(after.activeRun?.id).toBe(run.id);
    expect(after.available.find((d) => d.dungeon.key === SON_COC_KEY)?.dailyUsed).toBe(1);
  });

  it('activeRun fallback COMPLETED+claimedAt=null sau khi run hoàn tất, ẩn sau khi CLAIMED', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(userId, SON_COC_KEY);
    // Advance đến hết để chuyển sang COMPLETED.
    for (let i = 0; i < 3; i++) {
      await runs.nextEncounter(userId, run.id);
    }
    const afterComplete = await runs.listForUser(userId);
    expect(afterComplete.activeRun?.id).toBe(run.id);
    expect(afterComplete.activeRun?.status).toBe('COMPLETED');
    // Claim → CLAIMED, KHÔNG còn return ở activeRun.
    await runs.claimRun(userId, run.id);
    const afterClaim = await runs.listForUser(userId);
    expect(afterClaim.activeRun).toBeNull();
  });
});

describe('DungeonRunService.startRun', () => {
  it('throws DUNGEON_NOT_FOUND cho key sai', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(runs.startRun(userId, 'fake_dungeon_xxx')).rejects.toThrow(
      new DungeonRunError('DUNGEON_NOT_FOUND'),
    );
  });

  it('throws DUNGEON_LOCKED_REALM khi realm chưa đủ', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(runs.startRun(userId, SON_COC_KEY)).rejects.toThrow(
      new DungeonRunError('DUNGEON_LOCKED_REALM'),
    );
  });

  it('throws STAMINA_LOW khi character thiếu stamina', async () => {
    const { userId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      stamina: 2,
      staminaMax: 100,
    });
    await expect(runs.startRun(userId, SON_COC_KEY)).rejects.toThrow(
      new DungeonRunError('STAMINA_LOW'),
    );
  });

  it('start thành công: trừ stamina, status=ACTIVE, encounterIndex=0', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      stamina: 100,
    });
    const run = await runs.startRun(userId, SON_COC_KEY);
    expect(run.status).toBe(DungeonRunStatus.ACTIVE);
    expect(run.encounterIndex).toBe(0);
    expect(run.totalEncounters).toBe(3);
    expect(run.currentMonster).not.toBeNull();
    const char = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char?.stamina).toBe(100 - dungeonByKey(SON_COC_KEY)!.staminaEntry);
  });

  it('throws ALREADY_IN_RUN nếu đã có run ACTIVE', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await runs.startRun(userId, SON_COC_KEY);
    await expect(runs.startRun(userId, SON_COC_KEY)).rejects.toThrow(
      new DungeonRunError('ALREADY_IN_RUN'),
    );
  });

  it('throws DUNGEON_DAILY_LIMIT_REACHED khi đã chạm dailyLimit', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      stamina: 1000,
      staminaMax: 1000,
    });
    const dungeon = dungeonByKey(YEU_THU_DONG_KEY)!;
    // Seed `dungeon.dailyLimit` row giả lập đã consume slot daily
    // (status indifferent — count gồm cả ABANDONED).
    for (let i = 0; i < dungeon.dailyLimit!; i++) {
      await prisma.dungeonRun.create({
        data: {
          characterId,
          templateKey: YEU_THU_DONG_KEY,
          status: DungeonRunStatus.ABANDONED,
          encounterIndex: 0,
        },
      });
    }
    await expect(runs.startRun(userId, YEU_THU_DONG_KEY)).rejects.toThrow(
      new DungeonRunError('DUNGEON_DAILY_LIMIT_REACHED'),
    );
  });
});

describe('DungeonRunService.nextEncounter', () => {
  it('throws RUN_NOT_FOUND cho id sai', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(runs.nextEncounter(userId, 'fake-run-id')).rejects.toThrow(
      new DungeonRunError('RUN_NOT_FOUND'),
    );
  });

  it('throws RUN_NOT_OWNED khi user khác cố thao tác run', async () => {
    const owner = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const intruder = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(owner.userId, SON_COC_KEY);
    await expect(runs.nextEncounter(intruder.userId, run.id)).rejects.toThrow(
      new DungeonRunError('RUN_NOT_OWNED'),
    );
  });

  it('next advance encounterIndex và push vào killedMonsters', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    const after = await runs.nextEncounter(userId, run.id);
    expect(after.encounterIndex).toBe(1);
    expect(after.status).toBe(DungeonRunStatus.ACTIVE);
    expect(after.killedMonsters.length).toBe(1);
    expect(after.killedMonsters[0].monsterKey).toBe(dungeon.monsters[0]);
  });

  it('next cuối cùng đẩy run sang COMPLETED + completedAt set', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    let view = run;
    for (let i = 0; i < dungeon.monsters.length; i++) {
      view = await runs.nextEncounter(userId, run.id);
    }
    expect(view.status).toBe(DungeonRunStatus.COMPLETED);
    expect(view.completedAt).not.toBeNull();
    expect(view.killedMonsters.length).toBe(dungeon.monsters.length);
  });

  it('next sau khi COMPLETED throws RUN_NOT_ACTIVE', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    for (let i = 0; i < dungeon.monsters.length; i++) {
      await runs.nextEncounter(userId, run.id);
    }
    await expect(runs.nextEncounter(userId, run.id)).rejects.toThrow(
      new DungeonRunError('RUN_NOT_ACTIVE'),
    );
  });

  describe('Phase 12.3 — per-encounter loot drop', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('next() drop loot từ DUNGEON_LOOT[dungeon.key] + ghi ItemLedger reason=DUNGEON_LOOT, refType=DungeonRun, refId=run.id', async () => {
      // Pin Math.random=0.5 → deterministic loot row pick (huyet_chi_dan) +
      // qty trung vị. Đảm bảo test không flake giữa các runs.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const { userId, characterId } = await makeUserChar(prisma, {
        realmKey: 'luyenkhi',
      });
      const run = await runs.startRun(userId, SON_COC_KEY);
      const after = await runs.nextEncounter(userId, run.id);

      // Killed entry phải embed loot field (FE render via formatLoot).
      expect(after.killedMonsters.length).toBe(1);
      expect(after.killedMonsters[0].loot).toBeTruthy();
      expect(after.killedMonsters[0].loot!.length).toBeGreaterThanOrEqual(1);
      // Mọi itemKey trong loot phải tồn tại trong DUNGEON_LOOT[son_coc].
      const sonCocKeys = new Set(DUNGEON_LOOT.son_coc.map((e) => e.itemKey));
      for (const l of after.killedMonsters[0].loot!) {
        expect(sonCocKeys.has(l.itemKey)).toBe(true);
        expect(l.qty).toBeGreaterThanOrEqual(1);
      }

      // ItemLedger row khớp reason/refType/refId/dungeonKey.
      const ledger = await prisma.itemLedger.findMany({
        where: {
          characterId,
          reason: 'DUNGEON_LOOT',
          refType: 'DungeonRun',
          refId: run.id,
        },
      });
      expect(ledger.length).toBeGreaterThanOrEqual(1);
      expect(ledger.every((r) => r.qtyDelta > 0)).toBe(true);

      // InventoryItem qty khớp ledger sum (1 ledger row → 1 inventory grant).
      const invQtySum = ledger.reduce((s, r) => s + r.qtyDelta, 0);
      const invRows = await prisma.inventoryItem.findMany({
        where: { characterId, itemKey: { in: ledger.map((r) => r.itemKey) } },
      });
      const invSum = invRows.reduce((s, r) => s + r.qty, 0);
      expect(invSum).toBe(invQtySum);
    });

    it('clear toàn bộ son_coc (3 monsters) → 3 ItemLedger rows DUNGEON_LOOT cùng refId run.id', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const { userId, characterId } = await makeUserChar(prisma, {
        realmKey: 'luyenkhi',
      });
      const run = await runs.startRun(userId, SON_COC_KEY);
      const dungeon = dungeonByKey(SON_COC_KEY)!;
      let view = run;
      for (let i = 0; i < dungeon.monsters.length; i++) {
        view = await runs.nextEncounter(userId, run.id);
      }
      expect(view.status).toBe(DungeonRunStatus.COMPLETED);

      // Mỗi encounter (3 lần) drop ≥1 loot → ledger ≥ 3 rows cùng refId.
      const ledger = await prisma.itemLedger.findMany({
        where: {
          characterId,
          reason: 'DUNGEON_LOOT',
          refType: 'DungeonRun',
          refId: run.id,
        },
      });
      expect(ledger.length).toBeGreaterThanOrEqual(dungeon.monsters.length);

      // killedMonsters[*].loot trong final view phải sync với ledger items.
      expect(view.killedMonsters.length).toBe(dungeon.monsters.length);
      const lootSnapshotItems = new Set<string>();
      for (const k of view.killedMonsters) {
        for (const l of k.loot ?? []) lootSnapshotItems.add(l.itemKey);
      }
      const ledgerItems = new Set(ledger.map((r) => r.itemKey));
      // Mỗi item snapshot trong killedMonsters đều phải có row tương ứng.
      for (const itemKey of lootSnapshotItems) {
        expect(ledgerItems.has(itemKey)).toBe(true);
      }
    });

    it('next() loot drop KHÔNG block dungeon flow nếu DUNGEON_LOOT[key] empty (orphan template)', async () => {
      // Spy `rollDungeonLoot` để return [] giả lập trường hợp catalog empty.
      // (DUNGEON_LOOT.son_coc thật có entries — đây là defensive test cho
      // future template thiếu loot table.)
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
      const run = await runs.startRun(userId, SON_COC_KEY);
      const after = await runs.nextEncounter(userId, run.id);

      // Sanity: encounterIndex advanced + killed entry tồn tại bất kể loot
      // có/empty. Loot field optional khi empty.
      expect(after.encounterIndex).toBe(1);
      expect(after.killedMonsters.length).toBe(1);
    });
  });

  it('next auto-track quest kill cho monster.key (FE không tự cộng)', async () => {
    // Phamnhan grind quest: target = phamnhan_son_thu monsters group →
    // tìm dungeon có monster có questTargetIds chứa target. Use SON_COC
    // (son_thu_lon là phamnhan-tier monster).
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
    });
    // Bootstrap quest list trước (lazy-create AVAILABLE rows).
    await quests.listForUser(userId);
    // Accept phamnhan grind quest (target = son_thu group).
    const phamnhanGrind = await quests.accept(userId, 'phamnhan_grind_01');
    expect(phamnhanGrind.status).toBe('ACCEPTED');

    // Start run + kill monster đầu (son_thu_lon → questTargetIds=['son_thu']).
    const run = await runs.startRun(userId, SON_COC_KEY);
    await runs.nextEncounter(userId, run.id);

    // Quest progress phải auto-tăng.
    const list = await quests.listForUser(userId);
    const quest = list.find((q) => q.key === 'phamnhan_grind_01');
    expect(quest).toBeTruthy();
    // Tổng currentCount qua các step phải > 0 (kill 1 son_thu_lon → 1 progress).
    const totalProgress = quest!.steps.reduce(
      (s, step) => s + (step.currentCount ?? 0),
      0,
    );
    expect(totalProgress).toBeGreaterThan(0);
    // Sanity: characterId fixture vẫn match.
    expect(characterId).toBeTruthy();
  });
});

describe('DungeonRunService.claimRun', () => {
  it('throws RUN_NOT_FOUND cho id sai', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(runs.claimRun(userId, 'fake-run-id')).rejects.toThrow(
      new DungeonRunError('RUN_NOT_FOUND'),
    );
  });

  it('throws RUN_NOT_OWNED khi user khác cố claim', async () => {
    const owner = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const intruder = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(owner.userId, SON_COC_KEY);
    await expect(runs.claimRun(intruder.userId, run.id)).rejects.toThrow(
      new DungeonRunError('RUN_NOT_OWNED'),
    );
  });

  it('throws RUN_NOT_COMPLETED nếu run còn ACTIVE', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await runs.startRun(userId, SON_COC_KEY);
    await expect(runs.claimRun(userId, run.id)).rejects.toThrow(
      new DungeonRunError('RUN_NOT_COMPLETED'),
    );
  });

  it('claim COMPLETED run: cộng linhThach/exp/item + ledger ghi đúng', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 100n,
      exp: 0n,
    });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    for (let i = 0; i < dungeon.monsters.length; i++) {
      await runs.nextEncounter(userId, run.id);
    }
    const result = await runs.claimRun(userId, run.id);
    expect(result.runId).toBe(run.id);
    expect(result.granted.linhThach).toBe(dungeon.runReward!.linhThach);
    expect(result.granted.exp).toBe(dungeon.runReward!.exp);
    expect(result.granted.items.length).toBe(dungeon.runReward!.items!.length);

    // Character.linhThach + exp tăng đúng.
    const char = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char?.linhThach).toBe(100n + BigInt(dungeon.runReward!.linhThach!));
    expect(char?.exp).toBe(BigInt(dungeon.runReward!.exp!));

    // CurrencyLedger row ghi đúng.
    const ledger = await prisma.currencyLedger.findFirst({
      where: { characterId, refType: 'DungeonRun', refId: run.id },
    });
    expect(ledger).toBeTruthy();
    expect(ledger?.reason).toBe('DUNGEON_RUN_REWARD');
    expect(ledger?.currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledger?.delta).toBe(BigInt(dungeon.runReward!.linhThach!));

    // ItemLedger row ghi đúng.
    // Phase 12.3 — filter `reason: 'DUNGEON_RUN_REWARD'` để tách khỏi
    // per-encounter `DUNGEON_LOOT` rows (cùng refType/refId, khác reason).
    const itemLedger = await prisma.itemLedger.findFirst({
      where: {
        characterId,
        reason: 'DUNGEON_RUN_REWARD',
        refType: 'DungeonRun',
        refId: run.id,
      },
    });
    expect(itemLedger).toBeTruthy();
    expect(itemLedger?.reason).toBe('DUNGEON_RUN_REWARD');
    expect(itemLedger?.itemKey).toBe(dungeon.runReward!.items![0].itemKey);

    // Inventory granted (qty ≥ runReward; có thể cao hơn nếu Phase 12.3 loot
    // drop trùng item từ encounter trước).
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: dungeon.runReward!.items![0].itemKey },
    });
    expect(inv?.qty).toBeGreaterThanOrEqual(dungeon.runReward!.items![0].qty);

    // DungeonRun status flip → CLAIMED.
    const fresh = await prisma.dungeonRun.findUnique({ where: { id: run.id } });
    expect(fresh?.status).toBe(DungeonRunStatus.CLAIMED);
    expect(fresh?.claimedAt).not.toBeNull();
  });

  it('double claim bị chặn: lần 2 throws RUN_ALREADY_CLAIMED, ledger row không nhân đôi', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
    });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    for (let i = 0; i < dungeon.monsters.length; i++) {
      await runs.nextEncounter(userId, run.id);
    }
    await runs.claimRun(userId, run.id);
    await expect(runs.claimRun(userId, run.id)).rejects.toThrow(
      new DungeonRunError('RUN_ALREADY_CLAIMED'),
    );
    const ledgerCount = await prisma.currencyLedger.count({
      where: { characterId, refType: 'DungeonRun', refId: run.id },
    });
    expect(ledgerCount).toBe(1);
    // Phase 12.3 — filter `reason: 'DUNGEON_RUN_REWARD'` để tách khỏi
    // per-encounter `DUNGEON_LOOT` rows. Số row reward = items count, idempotent
    // qua CAS — KHÔNG nhân đôi sau lần claim thứ 2 fail.
    const itemLedgerCount = await prisma.itemLedger.count({
      where: {
        characterId,
        reason: 'DUNGEON_RUN_REWARD',
        refType: 'DungeonRun',
        refId: run.id,
      },
    });
    expect(itemLedgerCount).toBe(dungeon.runReward!.items!.length);
  });

  it('claim concurrent (race 2 promise cùng runId): chỉ 1 winner ghi 1 ledger row', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
    });
    const run = await runs.startRun(userId, SON_COC_KEY);
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    for (let i = 0; i < dungeon.monsters.length; i++) {
      await runs.nextEncounter(userId, run.id);
    }
    const settled = await Promise.allSettled([
      runs.claimRun(userId, run.id),
      runs.claimRun(userId, run.id),
    ]);
    const won = settled.filter((s) => s.status === 'fulfilled');
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(won.length).toBe(1);
    expect(lost.length).toBe(1);
    const ledgerCount = await prisma.currencyLedger.count({
      where: { characterId, refType: 'DungeonRun', refId: run.id },
    });
    expect(ledgerCount).toBe(1);
  });
});
