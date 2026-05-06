import { Injectable, Optional } from '@nestjs/common';
import {
  CurrencyKind,
  DungeonRunStatus,
  Prisma,
  type DungeonRun,
} from '@prisma/client';
import {
  DUNGEONS,
  REALMS,
  dungeonByKey,
  monsterByKey,
  realmByKey,
  type DungeonDef,
  type DungeonRunReward,
  type MonsterDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { startOfLocalDay } from '../combat/combat.service';

/**
 * Phase 12.2.B — DungeonRun runtime service.
 *
 * Khác `CombatService` (turn-based single Encounter):
 *  - DungeonRun = multi-encounter expedition. Mỗi `next()` call auto-resolve
 *    1 encounter (kill monster + quest track + advance index). Không có
 *    skill choice / MP / HP per encounter. Đơn giản hơn combat — phù hợp
 *    farm-loop sau khi player đã clear nội dung lần đầu via combat.
 *  - DungeonRun reward = bonus deterministic claim sau khi clear toàn bộ
 *    encounter (linhThach + tienNgoc + exp + items). Khác `DUNGEON_LOOT`
 *    của combat flow là per-encounter random drop.
 *
 * Server-authoritative invariants:
 *  - Realm gate: player.realmKey order >= dungeon.recommendedRealm order.
 *    Khác combat (chỉ "gợi ý", không cản) — DungeonRun siết chặt hơn.
 *  - Daily limit: count `DungeonRun` rows trong cửa sổ DAILY local tz
 *    (mirror `combat.service` `startOfLocalDay`). Slot daily đã tiêu sẽ
 *    KHÔNG refund khi run ABANDONED — anti-grind.
 *  - Ownership: mọi mutation (`next`, `claim`) check `run.characterId`
 *    match user's character.
 *  - Idempotent claim: `tx.dungeonRun.updateMany({ where: { id, status:
 *    COMPLETED, claimedAt: null }, data: { status: CLAIMED, claimedAt }})`
 *    CAS guard. Race 2 claim cùng runId → đúng 1 winner ghi 1 ledger row.
 *  - Quest hook: `QuestService.track('kill','monster', id, 1)` cho mỗi id
 *    trong [monster.key, ...questTargetIds] khi resolve encounter (mirror
 *    `combat.service` PR-6 fail-soft pattern). FE KHÔNG tự cộng quest.
 */

export class DungeonRunError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'DUNGEON_NOT_FOUND'
      | 'DUNGEON_LOCKED_REALM'
      | 'DUNGEON_DAILY_LIMIT_REACHED'
      | 'STAMINA_LOW'
      | 'ALREADY_IN_RUN'
      | 'RUN_NOT_FOUND'
      | 'RUN_NOT_OWNED'
      | 'RUN_NOT_ACTIVE'
      | 'RUN_NOT_COMPLETED'
      | 'RUN_ALREADY_CLAIMED'
      | 'RUN_NO_REWARD',
  ) {
    super(code);
  }
}

export interface DungeonAvailability {
  dungeon: DungeonDef;
  /** Player có đạt realm gate không. */
  unlocked: boolean;
  /** `false` khi `unlocked=false` hoặc đã hết slot daily. */
  startable: boolean;
  /** `staminaEntry > player.stamina`. */
  staminaShort: boolean;
  /** Số slot daily đã dùng / dailyLimit (null nếu không giới hạn). */
  dailyUsed: number;
  dailyLimit: number | null;
  /** Lý do (nếu có) ngăn `start`: `LOCKED_REALM` / `DAILY_LIMIT` / `STAMINA_LOW`. */
  lockReason: 'LOCKED_REALM' | 'DAILY_LIMIT' | 'STAMINA_LOW' | null;
}

export interface DungeonRunView {
  id: string;
  templateKey: string;
  status: DungeonRunStatus;
  encounterIndex: number;
  totalEncounters: number;
  /** Monster `dungeon.monsters[encounterIndex]` (next monster cần đánh).
   * `null` khi run COMPLETED/CLAIMED/ABANDONED hoặc index out-of-range. */
  currentMonster: MonsterDef | null;
  killedMonsters: Array<{ monsterKey: string; killedAt: string }>;
  startedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  /** Reward catalog snapshot — FE render preview claim button. */
  reward: DungeonRunReward | null;
}

export interface DungeonListView {
  available: DungeonAvailability[];
  activeRun: DungeonRunView | null;
}

export interface DungeonClaimResult {
  runId: string;
  templateKey: string;
  claimedAt: Date;
  granted: {
    linhThach: number;
    tienNgoc: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
}

interface KilledMonsterEntry {
  monsterKey: string;
  killedAt: string;
}

function readKilledMonsters(json: Prisma.JsonValue | null): KilledMonsterEntry[] {
  if (!Array.isArray(json)) return [];
  const out: KilledMonsterEntry[] = [];
  for (const v of json) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof (v as Record<string, unknown>).monsterKey === 'string' &&
      typeof (v as Record<string, unknown>).killedAt === 'string'
    ) {
      out.push({
        monsterKey: (v as Record<string, string>).monsterKey,
        killedAt: (v as Record<string, string>).killedAt,
      });
    }
  }
  return out;
}

/**
 * Phase 12.2.B — Đọc env `MISSION_RESET_TZ` để xác định timezone của mốc
 * reset DAILY (mirror `combat.service.getCombatResetTz`). Mặc định
 * `Asia/Ho_Chi_Minh`. DungeonRun reuse cùng zone với combat dailyLimit /
 * mission DAILY / daily-login streak để keep daily-bucket invariant đồng nhất.
 */
function getDungeonRunResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

@Injectable()
export class DungeonRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    @Optional() private readonly quests?: QuestService,
  ) {}

  /**
   * GET /dungeons/me — list catalog với availability flag + active run nếu có.
   * Realm gate + daily-slot count + stamina-check tính per-dungeon.
   */
  async listForUser(userId: string): Promise<DungeonListView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        realmKey: true,
        stamina: true,
      },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const playerRealm = realmByKey(char.realmKey);
    const playerOrder = playerRealm?.order ?? -1;

    // Đếm daily count cho từng dungeon (1 query gộp).
    const tz = getDungeonRunResetTz();
    const dayStart = startOfLocalDay(new Date(), tz);
    const grouped = await this.prisma.dungeonRun.groupBy({
      by: ['templateKey'],
      where: {
        characterId: char.id,
        startedAt: { gte: dayStart },
      },
      _count: { _all: true },
    });
    const usedByKey = new Map<string, number>();
    for (const g of grouped) usedByKey.set(g.templateKey, g._count._all);

    const available: DungeonAvailability[] = [];
    for (const d of DUNGEONS) {
      const required = realmByKey(d.recommendedRealm);
      const requiredOrder = required?.order ?? 0;
      const unlocked = playerOrder >= requiredOrder;
      const used = usedByKey.get(d.key) ?? 0;
      const limit = typeof d.dailyLimit === 'number' && d.dailyLimit > 0 ? d.dailyLimit : null;
      const dailyExceeded = limit !== null && used >= limit;
      const staminaShort = char.stamina < d.staminaEntry;
      let lockReason: DungeonAvailability['lockReason'] = null;
      if (!unlocked) lockReason = 'LOCKED_REALM';
      else if (dailyExceeded) lockReason = 'DAILY_LIMIT';
      else if (staminaShort) lockReason = 'STAMINA_LOW';
      available.push({
        dungeon: d,
        unlocked,
        startable: unlocked && !dailyExceeded && !staminaShort,
        staminaShort,
        dailyUsed: used,
        dailyLimit: limit,
        lockReason,
      });
    }

    const active = await this.prisma.dungeonRun.findFirst({
      where: { characterId: char.id, status: DungeonRunStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
    });
    return {
      available,
      activeRun: active ? this.toView(active) : null,
    };
  }

  /**
   * POST /dungeons/:templateKey/start — start run mới.
   * Validate ordered: NO_CHARACTER → DUNGEON_NOT_FOUND → DUNGEON_LOCKED_REALM
   * → DUNGEON_DAILY_LIMIT_REACHED → STAMINA_LOW → ALREADY_IN_RUN → create.
   */
  async startRun(userId: string, templateKey: string): Promise<DungeonRunView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true, stamina: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const dungeon = dungeonByKey(templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const required = realmByKey(dungeon.recommendedRealm);
    const requiredOrder = required?.order ?? 0;
    const playerRealm = realmByKey(char.realmKey);
    const playerOrder = playerRealm?.order ?? -1;
    if (playerOrder < requiredOrder) {
      throw new DungeonRunError('DUNGEON_LOCKED_REALM');
    }

    if (typeof dungeon.dailyLimit === 'number' && dungeon.dailyLimit > 0) {
      const tz = getDungeonRunResetTz();
      const dayStart = startOfLocalDay(new Date(), tz);
      const todayCount = await this.prisma.dungeonRun.count({
        where: {
          characterId: char.id,
          templateKey,
          startedAt: { gte: dayStart },
        },
      });
      if (todayCount >= dungeon.dailyLimit) {
        throw new DungeonRunError('DUNGEON_DAILY_LIMIT_REACHED');
      }
    }

    if (char.stamina < dungeon.staminaEntry) {
      throw new DungeonRunError('STAMINA_LOW');
    }

    const existingActive = await this.prisma.dungeonRun.findFirst({
      where: { characterId: char.id, status: DungeonRunStatus.ACTIVE },
      select: { id: true },
    });
    if (existingActive) throw new DungeonRunError('ALREADY_IN_RUN');

    // Validate dungeon catalog: ít nhất 1 monster + monster resolve được.
    if (dungeon.monsters.length === 0) {
      throw new DungeonRunError('DUNGEON_NOT_FOUND');
    }
    const firstMonster = monsterByKey(dungeon.monsters[0]);
    if (!firstMonster) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    // Atomic: trừ stamina + create run trong cùng transaction (anti-race
    // ALREADY_IN_RUN window). Nếu stamina raced (concurrent action khác
    // tiêu stamina), updateMany count=0 → throw STAMINA_LOW.
    const run = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.character.updateMany({
        where: { id: char.id, stamina: { gte: dungeon.staminaEntry } },
        data: { stamina: { decrement: dungeon.staminaEntry } },
      });
      if (upd.count !== 1) throw new DungeonRunError('STAMINA_LOW');

      return tx.dungeonRun.create({
        data: {
          characterId: char.id,
          templateKey,
          status: DungeonRunStatus.ACTIVE,
          encounterIndex: 0,
          killedMonsters: [] as Prisma.InputJsonValue,
        },
      });
    });

    return this.toView(run);
  }

  /**
   * POST /dungeon-runs/:runId/next — advance 1 encounter.
   * Resolve monster `dungeon.monsters[encounterIndex]` as killed:
   *   1. Track quest kill (`monster.key` + `questTargetIds[]`) fail-soft.
   *   2. Append to `killedMonsters` JSON.
   *   3. Increment `encounterIndex`.
   *   4. Nếu hết list → status=COMPLETED, set `completedAt`.
   *
   * Atomic với CAS guard `status=ACTIVE` updateMany count check chống race
   * 2 next call cùng runId.
   */
  async nextEncounter(userId: string, runId: string): Promise<DungeonRunView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const run = await this.prisma.dungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new DungeonRunError('RUN_NOT_FOUND');
    if (run.characterId !== char.id) throw new DungeonRunError('RUN_NOT_OWNED');
    if (run.status !== DungeonRunStatus.ACTIVE) {
      throw new DungeonRunError('RUN_NOT_ACTIVE');
    }

    const dungeon = dungeonByKey(run.templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const idx = run.encounterIndex;
    if (idx >= dungeon.monsters.length) {
      // Edge case: index past end nhưng status vẫn ACTIVE — đẩy về COMPLETED.
      throw new DungeonRunError('RUN_NOT_ACTIVE');
    }
    const monsterKey = dungeon.monsters[idx];
    const monster = monsterByKey(monsterKey);
    if (!monster) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const nextIndex = idx + 1;
    const isLast = nextIndex >= dungeon.monsters.length;
    const nowIso = new Date().toISOString();
    const killed = readKilledMonsters(run.killedMonsters);
    killed.push({ monsterKey, killedAt: nowIso });

    // CAS guard: chỉ advance nếu vẫn ACTIVE + encounterIndex chưa thay đổi.
    const upd = await this.prisma.dungeonRun.updateMany({
      where: { id: run.id, status: DungeonRunStatus.ACTIVE, encounterIndex: idx },
      data: {
        encounterIndex: nextIndex,
        killedMonsters: killed as unknown as Prisma.InputJsonValue,
        status: isLast ? DungeonRunStatus.COMPLETED : DungeonRunStatus.ACTIVE,
        completedAt: isLast ? new Date() : null,
      },
    });
    if (upd.count !== 1) throw new DungeonRunError('RUN_NOT_ACTIVE');

    // Phase 12 PR-6 — quest kill step tracking, fail-soft. Mirror
    // `combat.service` flow: track `monster.key` + mọi `questTargetIds[*]`
    // (placeholder ánh xạ vào quest targetId trừu tượng như `son_thu`).
    if (this.quests) {
      const trackIds = new Set<string>([monster.key]);
      for (const id of monster.questTargetIds ?? []) trackIds.add(id);
      for (const id of trackIds) {
        try {
          await this.quests.track(char.id, 'kill', 'monster', id, 1);
        } catch {
          // fail-soft: quest tracking lỗi không nên break dungeon flow.
        }
      }
    }

    const fresh = await this.prisma.dungeonRun.findUnique({ where: { id: run.id } });
    return this.toView(fresh!);
  }

  /**
   * POST /dungeon-runs/:runId/claim — claim reward bonus.
   *
   * Idempotency CAS guard `claimedAt=null` (mirror QuestService.claim Phase 12
   * PR-3). Atomic transaction:
   *   1. CAS updateMany {status: COMPLETED, claimedAt: null} → CLAIMED.
   *   2. CurrencyService.applyTx (linhThach/tienNgoc) với reason
   *      'DUNGEON_RUN_REWARD' + refType='DungeonRun' + refId=runId.
   *   3. tx.character.update({ exp: { increment } }).
   *   4. InventoryService.grantTx (items) với cùng reason/refType/refId.
   *
   * Race 2 claim cùng runId → đúng 1 winner ghi 1 ledger row / runId.
   */
  async claimRun(userId: string, runId: string): Promise<DungeonClaimResult> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const run = await this.prisma.dungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new DungeonRunError('RUN_NOT_FOUND');
    if (run.characterId !== char.id) throw new DungeonRunError('RUN_NOT_OWNED');
    if (run.status === DungeonRunStatus.CLAIMED || run.claimedAt !== null) {
      throw new DungeonRunError('RUN_ALREADY_CLAIMED');
    }
    if (run.status !== DungeonRunStatus.COMPLETED) {
      throw new DungeonRunError('RUN_NOT_COMPLETED');
    }

    const dungeon = dungeonByKey(run.templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');
    const reward = dungeon.runReward;
    if (!reward) throw new DungeonRunError('RUN_NO_REWARD');

    const characterId = char.id;

    return this.prisma.$transaction(async (tx) => {
      // CAS race guard.
      const claimedAt = new Date();
      const upd = await tx.dungeonRun.updateMany({
        where: { id: run.id, status: DungeonRunStatus.COMPLETED, claimedAt: null },
        data: { status: DungeonRunStatus.CLAIMED, claimedAt },
      });
      if (upd.count !== 1) {
        throw new DungeonRunError('RUN_ALREADY_CLAIMED');
      }

      const linhThach = reward.linhThach ?? 0;
      const tienNgoc = reward.tienNgoc ?? 0;
      const exp = reward.exp ?? 0;

      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
          refId: run.id,
        });
      }
      if (tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(tienNgoc),
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
          refId: run.id,
        });
      }
      if (exp > 0) {
        await tx.character.update({
          where: { id: characterId },
          data: { exp: { increment: BigInt(exp) } },
        });
      }

      const grantedItems: Array<{ itemKey: string; qty: number }> = [];
      if (reward.items && reward.items.length > 0) {
        const grantList = reward.items.map((it) => ({
          itemKey: it.itemKey,
          qty: it.qty,
        }));
        await this.inventory.grantTx(tx, characterId, grantList, {
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
          refId: run.id,
        });
        grantedItems.push(...grantList);
      }

      return {
        runId: run.id,
        templateKey: run.templateKey,
        claimedAt,
        granted: {
          linhThach,
          tienNgoc,
          exp,
          items: grantedItems,
        },
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────────────────

  private toView(run: DungeonRun): DungeonRunView {
    const dungeon = dungeonByKey(run.templateKey);
    const totalEncounters = dungeon?.monsters.length ?? 0;
    const idx = run.encounterIndex;
    const currentMonsterKey =
      dungeon && run.status === DungeonRunStatus.ACTIVE && idx < totalEncounters
        ? dungeon.monsters[idx]
        : null;
    const currentMonster = currentMonsterKey ? monsterByKey(currentMonsterKey) ?? null : null;
    return {
      id: run.id,
      templateKey: run.templateKey,
      status: run.status,
      encounterIndex: idx,
      totalEncounters,
      currentMonster,
      killedMonsters: readKilledMonsters(run.killedMonsters),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      claimedAt: run.claimedAt ? run.claimedAt.toISOString() : null,
      reward: dungeon?.runReward ?? null,
    };
  }
}

// Re-export catalog reference for tests.
export { DUNGEONS, REALMS };
